//! 오늘 날짜 (이 PC 의 시간대). 새 판 이름의 `_YYYYMMDD` 조각에 쓴다.
//! 화면은 브라우저 시계로 날짜를 넘기고, 명령줄은 이것을 쓴다 — UTC 로 지으면 아침 9시 전에 어제 날짜가 붙는다.

/// `YYYYMMDD`.
pub fn today() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}{:02}{:02}", t.wYear, t.wMonth, t.wDay)
}

/// 유닉스 밀리초(파일 수정 시각)의 이 PC 날짜 `YYYYMMDD`. 이름 제안이 날짜 칸을 채울 때 쓴다 — 옛 파일 이름에 오늘 날짜를 붙이면 언제 것인지 거짓말이 된다.
pub fn date_of_ms(ms: i64) -> String {
    use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows::Win32::System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime};
    // 1601-01-01 부터 100 나노초 단위.
    let ticks = (ms.max(0) as u64 + 11_644_473_600_000) * 10_000;
    let ft = FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 };
    let (mut utc, mut local) = (SYSTEMTIME::default(), SYSTEMTIME::default());
    unsafe {
        if FileTimeToSystemTime(&ft, &mut utc).is_err() || SystemTimeToTzSpecificLocalTime(None, &utc, &mut local).is_err() {
            return today();
        }
    }
    format!("{:04}{:02}{:02}", local.wYear, local.wMonth, local.wDay)
}
