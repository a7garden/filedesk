//! 색인을 돕는 작은 셸 · 시스템 호출 — 이 사용자의 SID · 드라이브 종류 · 관리자로 띄우기 · 뒷일 스레드 우선순위.
//! 2026.11.12 : 색인 서비스(`fd-indexd`)를 설치하면서 더했다.

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentThread, GetExitCodeProcess, INFINITE, OpenProcessToken, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
    WaitForSingleObject,
};
use windows::Win32::UI::Shell::{SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
use windows::core::{HSTRING, PCWSTR, PWSTR, w};

use crate::{Result, ShellError};

/// 이 프로세스 사용자의 SID 글 (`S-1-5-21-…`).
pub fn user_sid() -> Option<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
        let mut need = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut need);
        // u64 칸으로 잡는다 — TOKEN_USER 는 포인터를 담아 8 바이트에 맞춰 놓여야 한다.
        let mut buf = vec![0u64; (need.max(64) as usize).div_ceil(8)];
        let ok = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut _), (buf.len() * 8) as u32, &mut need);
        let _ = CloseHandle(token);
        ok.ok()?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut s = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut s).ok()?;
        // 글 하나(수십 바이트)라 놓아 주지 않는다 — 설치할 때 한 번만 부른다.
        s.to_string().ok()
    }
}

/// 드라이브 종류 — `fixed` · `removable` · `network` · `cd` · `unknown`. `root` 는 `C:\` 꼴.
pub fn drive_kind(root: &str) -> &'static str {
    match unsafe { GetDriveTypeW(&HSTRING::from(root)) } {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "cd",
        _ => "unknown",
    }
}

/// 관리자 권한으로 띄우고 끝날 때까지 기다린다 (UAC 창이 뜬다). 끝난 코드를 돌려준다.
/// 사용자가 UAC 에서 「아니요」를 누르면 Err 「취소」.
pub fn run_elevated(exe: &str, args: &str) -> Result<u32> {
    let file = HSTRING::from(exe);
    let params = HSTRING::from(args);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        if let Err(e) = ShellExecuteExW(&mut info) {
            // 1223 = ERROR_CANCELLED
            if e.code().0 as u32 & 0xFFFF == 1223 {
                return Err(ShellError("관리자 권한 묻기를 취소했다".into()));
            }
            return Err(ShellError::from(e));
        }
        if info.hProcess.is_invalid() {
            return Ok(0);
        }
        let _ = WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 0u32;
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        Ok(code)
    }
}

/// 지금 스레드를 뒷일 우선순위로 (입출력 · CPU 를 화면에 양보한다).
pub fn background_thread() {
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN);
    }
}
