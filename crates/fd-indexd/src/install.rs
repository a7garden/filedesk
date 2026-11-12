//! 서비스 설치 · 업데이트 · 지우기. 관리자 권한으로 돈다 (앱이 UAC 로 띄운다).
//!
//! - 실행 파일은 `%ProgramFiles%\filedesk\fd-indexd.exe` 로 복사해 그것을 등록한다. 앱은 사용자 폴더에 깔리는데,
//!   사용자가 쓸 수 있는 자리의 exe 를 SYSTEM 서비스로 돌리면 그 exe 를 바꿔 끼워 관리자 권한을 얻는 길이 생긴다.
//! - 색인 스냅숏 · 설정은 `%ProgramData%\filedesk\` — SYSTEM · Administrators 만 열게 상속을 끊는다.

use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use fd_index::proto::SERVICE_NAME;
use windows_service::service::{ServiceAccess, ServiceErrorControl, ServiceInfo, ServiceStartType, ServiceState, ServiceType};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

use crate::state::{Config, data_dir, load_config, log, save_config};

const DISPLAY_NAME: &str = "filedesk 색인";
const DESCRIPTION: &str = "filedesk 의 빠른 찾기 — 고정 드라이브의 파일 이름 · 크기 · 때를 색인한다. 파일 내용은 읽지 않는다.";

fn program_dir() -> PathBuf {
    let pf = std::env::var("ProgramW6432").or_else(|_| std::env::var("ProgramFiles")).unwrap_or_else(|_| r"C:\Program Files".into());
    PathBuf::from(pf).join("filedesk")
}

pub fn installed_exe() -> PathBuf {
    program_dir().join("fd-indexd.exe")
}

fn info() -> ServiceInfo {
    ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from(DISPLAY_NAME),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: installed_exe(),
        launch_arguments: vec![OsString::from("run")],
        dependencies: vec![],
        account_name: None, // LocalSystem — 볼륨을 열려면 관리자 권한이 든다
        account_password: None,
    }
}

/// 서비스가 있으면 멈추고 멈출 때까지 기다린다 (실행 파일을 바꿔 끼우려고).
fn stop_existing(manager: &ServiceManager) {
    let Ok(svc) = manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS | ServiceAccess::STOP) else { return };
    if svc.query_status().map(|s| s.current_state == ServiceState::Stopped).unwrap_or(true) {
        return;
    }
    let _ = svc.stop();
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(20) {
        if svc.query_status().map(|s| s.current_state == ServiceState::Stopped).unwrap_or(true) {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// 설치 또는 업데이트. `sid` · `profile` 이 비면(업데이트) 있던 설정을 그대로 쓴다.
pub fn install(sid: Option<String>, profile: Option<String>) -> Result<(), String> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE).map_err(|e| format!("서비스 관리자를 열지 못했다 (관리자 권한이 필요하다): {e}"))?;
    stop_existing(&manager);

    // 1. 실행 파일
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(program_dir()).map_err(|e| format!("{}: {e}", program_dir().display()))?;
    if me != installed_exe() {
        // 멈춘 직후에는 파일이 잠시 잠겨 있을 수 있다
        let mut last = String::new();
        for _ in 0..25 {
            match std::fs::copy(&me, installed_exe()) {
                Ok(_) => {
                    last.clear();
                    break;
                }
                Err(e) => {
                    last = e.to_string();
                    std::thread::sleep(Duration::from_millis(200));
                }
            }
        }
        if !last.is_empty() {
            return Err(format!("{}: {last}", installed_exe().display()));
        }
    }

    // 2. 설정 · 자료 폴더
    let mut cfg: Config = load_config();
    if let Some(s) = sid.filter(|s| !s.is_empty()) {
        cfg.sid = s;
    }
    if let Some(p) = profile.filter(|p| !p.is_empty()) {
        cfg.profile = p;
    }
    save_config(&cfg).map_err(|e| e.to_string())?;
    let _ = std::process::Command::new("icacls")
        .arg(data_dir())
        .args(["/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/q"])
        .status();

    // 3. 서비스 등록 (있으면 설정을 바꾼다)
    let access = ServiceAccess::CHANGE_CONFIG | ServiceAccess::START | ServiceAccess::QUERY_STATUS | ServiceAccess::STOP;
    let svc = match manager.open_service(SERVICE_NAME, access) {
        Ok(s) => {
            s.change_config(&info()).map_err(|e| format!("서비스 설정을 바꾸지 못했다: {e}"))?;
            s
        }
        Err(_) => manager.create_service(&info(), access).map_err(|e| format!("서비스를 만들지 못했다: {e}"))?,
    };
    let _ = svc.set_description(DESCRIPTION);
    svc.start(&[] as &[&OsStr]).map_err(|e| format!("서비스를 시작하지 못했다: {e}"))?;
    log(&format!("설치 · 업데이트 {}", env!("CARGO_PKG_VERSION")));
    Ok(())
}

/// 서비스 지우기 — 멈추고 등록을 지우고, 복사한 실행 파일과 색인 자료를 지운다.
pub fn uninstall() -> Result<(), String> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).map_err(|e| format!("서비스 관리자를 열지 못했다 (관리자 권한이 필요하다): {e}"))?;
    stop_existing(&manager);
    if let Ok(svc) = manager.open_service(SERVICE_NAME, ServiceAccess::DELETE) {
        svc.delete().map_err(|e| format!("서비스를 지우지 못했다: {e}"))?;
    }
    let me = std::env::current_exe().ok();
    if me.as_deref() != Some(installed_exe().as_path()) {
        let _ = std::fs::remove_file(installed_exe());
        let _ = std::fs::remove_dir(program_dir());
    }
    let _ = std::fs::remove_dir_all(data_dir());
    Ok(())
}
