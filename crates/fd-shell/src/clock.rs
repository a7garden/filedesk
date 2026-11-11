//! 오늘 날짜 (이 PC 의 시간대). 새 판 이름의 `_YYYYMMDD` 조각에 쓴다.
//! 화면은 브라우저 시계로 날짜를 넘기고, 명령줄은 이것을 쓴다 — UTC 로 지으면 아침 9시 전에 어제 날짜가 붙는다.

/// `YYYYMMDD`.
pub fn today() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}{:02}{:02}", t.wYear, t.wMonth, t.wDay)
}
