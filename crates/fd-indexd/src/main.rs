//! `fd-indexd` — filedesk 색인 서비스.
//!
//! 관리자 권한(LocalSystem)으로 고정 드라이브의 NTFS MFT 를 읽어 이름 색인을 몇 초 만에 채우고, USN 저널로 바뀐 것을 따라간다.
//! NTFS 가 아닌 고정 드라이브는 훑기 · 감시로 채운다. 앱 · 명령줄은 이름 파이프(`fd_index::proto`)로 묻는다.
//! 파일 내용은 읽지 않는다 — 본문 색인은 사용자 권한의 앱이 한다 (남이 만든 문서의 파서 결함이 관리자 권한 탈취로 번지지 않게).
//!
//! 명령
//!   fd-indexd install --sid <SID> --profile <프로필 폴더>   설치 (관리자)
//!   fd-indexd update                                         실행 파일만 바꿔 끼운다 (관리자)
//!   fd-indexd uninstall                                      지우기 (관리자)
//!   fd-indexd run                                            서비스 관리자가 부른다
//!   fd-indexd console                                        서비스 없이 앞에서 돌린다 (관리자 · 문제 볼 때)
//!
//! 2026.11.12 : 처음 씀.

#[cfg(windows)]
mod install;
#[cfg(windows)]
mod ntfs;
#[cfg(windows)]
mod pipe;
#[cfg(windows)]
mod state;

#[cfg(not(windows))]
fn main() {
    eprintln!("fd-indexd 는 Windows 에서만 돈다");
}

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opt = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let result = match args.first().map(String::as_str) {
        Some("install") => install::install(opt("--sid"), opt("--profile")),
        Some("update") => install::install(None, None),
        Some("uninstall") => install::uninstall(),
        Some("run") => service::dispatch(),
        Some("console") => service::console(),
        Some("version") => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => Err("쓰는 법: fd-indexd install --sid <SID> --profile <폴더> | update | uninstall | run | console".into()),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            state::log(&e);
            eprintln!("{}", serde_json::json!({ "error": e }));
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(windows)]
mod service {
    use std::ffi::OsString;
    use std::sync::mpsc;
    use std::time::Duration;

    use fd_index::proto::SERVICE_NAME;
    use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    use crate::state::{State, log};

    define_windows_service!(ffi_service_main, service_main);

    pub fn dispatch() -> Result<(), String> {
        service_dispatcher::start(SERVICE_NAME, ffi_service_main).map_err(|e| format!("서비스 관리자가 부른 것이 아니다 — 앞에서 돌리려면 console: {e}"))
    }

    fn service_main(_args: Vec<OsString>) {
        if let Err(e) = run_service() {
            log(&format!("서비스가 멈췄다: {e}"));
        }
    }

    fn status(state: ServiceState) -> ServiceStatus {
        ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: if state == ServiceState::Running { ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN } else { ServiceControlAccept::empty() },
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::from_secs(10),
            process_id: None,
        }
    }

    fn run_service() -> windows_service::Result<()> {
        let (tx, rx) = mpsc::channel();
        let handler = move |ev| match ev {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        };
        let h = service_control_handler::register(SERVICE_NAME, handler)?;
        h.set_service_status(status(ServiceState::Running))?;
        let state = State::start();
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build();
        match rt {
            Ok(rt) => {
                rt.spawn(crate::pipe::serve(state.clone()));
                let _ = rx.recv();
                h.set_service_status(status(ServiceState::StopPending))?;
                state.stop();
                rt.shutdown_timeout(Duration::from_secs(2));
            }
            Err(e) => log(&format!("비동기 실행기를 만들지 못했다: {e}")),
        }
        h.set_service_status(status(ServiceState::Stopped))?;
        Ok(())
    }

    /// 서비스 없이 앞에서 돈다 — Enter 를 누르면 멈춘다.
    pub fn console() -> Result<(), String> {
        let state = State::start();
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().map_err(|e| e.to_string())?;
        rt.spawn(crate::pipe::serve(state.clone()));
        println!("색인 서비스를 앞에서 돌린다 — Enter 를 누르면 멈춘다");
        let mut line = String::new();
        let _ = std::io::stdin().read_line(&mut line);
        state.stop();
        rt.shutdown_timeout(Duration::from_secs(2));
        Ok(())
    }
}
