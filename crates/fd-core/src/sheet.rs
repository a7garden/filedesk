//! 엑셀 · 스프레드시트 미리보기 — 시트마다 칸 글을 읽는다 (xlsx · xlsm · xlsb · xls · ods).
//!
//! 2026.11.25 : 앱 안 보기에 엑셀 미리보기를 더하며 만들었다 (사용자 요청). 순수 Rust(calamine)라 오피스가 없는 PC 에서도 같다.
//! 보이는 값만 낸다 — 날짜는 날짜로 바꾸지만 숫자 서식(% · 천 단위 쉼표 · 통화)과 글꼴 · 색 · 병합은 옮기지 않는다.
//! 칸을 고치는 일은 하지 않는다 (엑셀 파일을 다시 쓰면 서식 · 수식이 깨진다) — 고치기는 기본 앱으로.

use std::path::Path;

use calamine::{Data, Reader, open_workbook_auto};
use serde::Serialize;

/// 시트마다 내는 줄 수 상한. 넘는 줄은 세기만 한다.
/// 2026.11.27 : 화면 표는 이제 보이는 줄만 그려 줄 수 상한이 없다. 여기 상한은 화면으로 넘기는 글의 양(IPC · JSON)을 묶는다.
pub const MAX_ROWS: usize = 5000;
/// 시트마다 내는 열 수 상한 (XFD 까지 16384 열이 있을 수 있다).
pub const MAX_COLS: usize = 256;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub name: String,
    /// 칸 글. 첫 줄 · 첫 열은 `row0` · `col0` 자리다 (값이 있는 첫 칸부터).
    pub rows: Vec<Vec<String>>,
    /// 값이 있는 첫 칸의 줄 · 열 (0 부터). 화면이 엑셀처럼 줄 번호 · 열 글자(A · B …)를 붙인다.
    pub row0: u32,
    pub col0: u32,
    /// 시트 전체 줄 수 (MAX_ROWS 로 잘리기 전).
    pub total_rows: usize,
    /// 줄이나 열을 상한에서 잘랐는가.
    pub truncated: bool,
    /// 칸을 읽었는가 — 고른 시트만 읽고 나머지는 이름만 낸다 (`read` 풀이).
    pub loaded: bool,
}

/// 칸 값 → 보이는 글.
fn cell_text(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        // 정수로 떨어지는 실수는 「3.0」이 아니라 「3」 — 엑셀은 숫자를 모두 실수로 둔다
        Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{}", *f as i64),
        Data::Float(f) => format!("{f}"),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => if *b { "TRUE" } else { "FALSE" }.into(),
        Data::DateTime(dt) => match dt.as_datetime() {
            // 시각이 0시 정각이면 날짜만 — 날짜 칸이 「2026-11-25 00:00:00」으로 보이지 않게
            Some(t) if t.time() == chrono::NaiveTime::MIN => t.format("%Y-%m-%d").to_string(),
            Some(t) if t.date() == chrono::NaiveDate::from_ymd_opt(1899, 12, 31).unwrap() || t.date() == chrono::NaiveDate::from_ymd_opt(1899, 12, 30).unwrap() => {
                t.format("%H:%M:%S").to_string()
            }
            Some(t) => t.format("%Y-%m-%d %H:%M:%S").to_string(),
            None => dt.as_f64().to_string(),
        },
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{e}"),
    }
}

/// 통합 문서의 시트 목록과 `at` 번째 시트의 칸을 읽는다. 숨긴 시트도 낸다 (이름으로 알 수 있게).
/// 2026.11.27 : 고른 시트만 읽는다. 예전에는 모든 시트를 읽어, 시트 여섯 장(3천 줄 · 50 ~ 145열)인 5MB 파일을 여는 데
///   1.4초가 걸렸다 (첫 시트만이면 0.16초). 다른 시트는 탭을 누를 때 이것을 다시 부른다. `at` 이 시트 수를 넘으면 첫 시트를 읽는다.
pub fn read(path: &Path, at: usize) -> Result<Vec<Sheet>, String> {
    let mut wb = open_workbook_auto(path).map_err(|e| format!("엑셀 파일을 읽지 못함: {e}"))?;
    let names = wb.sheet_names().to_vec();
    let at = if at < names.len() { at } else { 0 };
    let mut out = Vec::with_capacity(names.len());
    for (i, name) in names.into_iter().enumerate() {
        let blank = |name: String, loaded: bool| Sheet { name, rows: Vec::new(), row0: 0, col0: 0, total_rows: 0, truncated: false, loaded };
        if i != at {
            out.push(blank(name, false));
            continue;
        }
        // 차트 시트처럼 칸이 없는 시트는 빈 시트로 둔다
        let Ok(range) = wb.worksheet_range(&name) else {
            out.push(blank(name, true));
            continue;
        };
        let (row0, col0) = range.start().unwrap_or((0, 0));
        let (h, w) = range.get_size();
        let rows: Vec<Vec<String>> = range
            .rows()
            .take(MAX_ROWS)
            .map(|r| {
                let mut v: Vec<String> = r.iter().take(MAX_COLS).map(cell_text).collect();
                // 줄 끝의 빈 칸은 뺀다 — 화면이 가장 긴 줄에 맞춰 채운다
                while v.last().is_some_and(String::is_empty) {
                    v.pop();
                }
                v
            })
            .collect();
        out.push(Sheet { name, rows, row0, col0, total_rows: h, truncated: h > MAX_ROWS || w > MAX_COLS, loaded: true });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_that_are_whole_numbers_drop_the_decimal() {
        assert_eq!(cell_text(&Data::Float(3.0)), "3");
        assert_eq!(cell_text(&Data::Float(2.5)), "2.5");
        assert_eq!(cell_text(&Data::Bool(true)), "TRUE");
        assert_eq!(cell_text(&Data::Empty), "");
    }
}
