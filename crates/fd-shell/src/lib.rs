//! Windows 셸 연동.
//!
//! 원칙 — 파일을 바꾸는 일은 직접 짜지 않고 셸에 맡긴다 (`IFileOperation` · 셸 동사).
//! 진행 창 · 이름 충돌 창 · 휴지통 · 긴 경로를 탐색기와 똑같이 처리하고, 직접 짠 복사 코드에서 파일을 잃는 일을 없애려고.
//!
//! 스레드 — 메뉴 · 끌기는 창을 가진 UI 스레드(Tauri 주 스레드)에서 불러야 한다. 소유 창과 다른 스레드에서
//! TrackPopupMenu · DoDragDrop 을 부르면 메뉴가 바로 닫히거나 끌기가 시작되지 않는다.
//! 파일 작업 · 열기 · 아이콘은 `run_sta` 로 따로 띄운 STA 스레드에서 돈다 — 주 스레드를 막지 않으려고.

#[cfg(windows)]
pub mod clock;
#[cfg(windows)]
mod com;
#[cfg(windows)]
pub mod drag;
#[cfg(windows)]
pub mod fileid;
#[cfg(windows)]
pub mod icon;
#[cfg(windows)]
pub mod menu;
#[cfg(windows)]
pub mod ops;
#[cfg(windows)]
pub mod places;
#[cfg(windows)]
pub mod system;

#[cfg(windows)]
pub use com::run_sta;

/// 창 손잡이를 스레드 사이로 넘기는 꼴. `HWND` 는 포인터라 `Send` 가 아니다.
pub type RawHwnd = isize;

/// 셸 호출 실패를 사람이 읽을 문장으로.
#[derive(Debug, Clone)]
pub struct ShellError(pub String);

impl std::fmt::Display for ShellError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ShellError {}

#[cfg(windows)]
impl From<windows::core::Error> for ShellError {
    fn from(e: windows::core::Error) -> Self {
        ShellError(format!("{} (0x{:08X})", e.message().trim(), e.code().0 as u32))
    }
}

pub type Result<T> = std::result::Result<T, ShellError>;
