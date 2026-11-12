//! 찾기 조건 — 찾기 칸 · 스마트 폴더 · 색인 · `fd query` 가 같은 문법을 쓴다.
//!
//! 찾는 말 사이에 `열쇠:값` 을 섞어 적는다. 열쇠는 한글이 기본이고 영어 별칭도 받는다.
//!
//! | 열쇠 | 값 | 뜻 |
//! | - | - | - |
//! | `고친` · `날짜` · `modified` · `date` | `오늘` · `어제` · `3일` · `<7일` · `>30일` · `2주` · `6달` · `1년` · `12시간` · `2026-11-01` · `2026-11-01..2026-11-10` | 생긴 때 · 고친 때 중 늦은 것 |
//! | `크기` · `size` | `>10MB` · `<1KB` · `1MB..1GB` | 파일 크기 (폴더는 맞지 않는다) |
//! | `확장자` · `ext` | `pdf` · `pdf,hwpx` | 확장자 |
//! | `종류` · `kind` · `type` | `문서` · `폴더` · `파일` | 설정의 종류 이름 (부르는 쪽이 확장자로 푼다) |
//! | `색` · `color` | `빨강` · `red` · `있음` | 색 표시 |
//! | `메모` · `memo` | `있음` · `없음` | 메모가 붙었는가 |
//!
//! 값이 없는 낱말은 지금처럼 이름(과 메모)에 다 들어 있어야 맞는다. `-낱말` 은 그 낱말이 든 것을 뺀다.
//! 「고친」이 생긴 때까지 보는 까닭: 받거나 복사해 온 파일은 고친 때가 옛날 그대로라, 고친 때만 보면 방금 들어온 파일이 빠진다
//! (왼쪽 「최근 파일」 · `list::recent_files` 와 같은 뜻).

use serde::{Deserialize, Serialize};

use crate::list::Entry;

pub const DAY_MS: i64 = 86_400_000;
const HOUR_MS: i64 = 3_600_000;

/// 지금 시각과 이 PC 시간대 — 「오늘」 · 날짜 값을 그날 0시로 풀 때 쓴다.
#[derive(Debug, Clone, Copy)]
pub struct Clock {
    /// 유닉스 밀리초.
    pub now: i64,
    /// UTC 보다 몇 분 앞서는가 (한국 +540).
    pub tz_offset_min: i32,
}

impl Clock {
    pub fn now(tz_offset_min: i32) -> Self {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        Clock { now, tz_offset_min }
    }
    fn off(&self) -> i64 {
        self.tz_offset_min as i64 * 60_000
    }
    /// `t` 가 든 날의 0시 (이 PC 시간대).
    pub fn day_start(&self, t: i64) -> i64 {
        (t + self.off()).div_euclid(DAY_MS) * DAY_MS - self.off()
    }
    /// 그 날짜의 0시 (이 PC 시간대).
    fn date_start(&self, y: i64, m: i64, d: i64) -> i64 {
        days_from_civil(y, m, d) * DAY_MS - self.off()
    }
}

/// 1970-01-01 부터의 날 수 (그레고리력, H. Hinnant 의 식).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 화면이 조건마다 그리는 칩 — `raw` 는 찾기 칸에 적힌 그대로(× 를 누르면 그 글을 뗀다), `label` 은 사람이 읽는 말.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Chip {
    pub raw: String,
    pub label: String,
}

/// 풀어 낸 조건. 비어 있는 칸은 거르지 않는다.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct QuerySpec {
    /// 이름(이나 메모)에 다 들어 있어야 하는 말 (소문자).
    pub terms: Vec<String>,
    /// 들어 있으면 빼는 말 (소문자).
    pub not_terms: Vec<String>,
    /// 생긴 때 · 고친 때 중 늦은 것이 `after` 이상 · `before` 미만 (유닉스 밀리초).
    pub after: Option<i64>,
    pub before: Option<i64>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    /// 확장자 (소문자, 점 없이).
    pub exts: Vec<String>,
    /// 종류 이름 그대로 — `resolve_kinds` 가 `kind_exts` 로 푼다.
    pub kinds: Vec<String>,
    pub kind_exts: Vec<String>,
    /// `Some(true)` 폴더만 · `Some(false)` 파일만.
    pub dirs: Option<bool>,
    /// 색 표시 (memo::COLORS 의 영어 이름).
    pub colors: Vec<String>,
    /// 색 표시가 아무것이나 있는 것.
    pub any_color: bool,
    /// `Some(true)` 메모가 있는 것 · `Some(false)` 없는 것.
    pub memo: Option<bool>,
    pub chips: Vec<Chip>,
    /// 풀지 못한 조건 — 화면이 경고로 보인다. 그 조건은 걸지 않는다(종류는 아무것도 맞지 않게 남긴다).
    pub errors: Vec<String>,
}

enum Key {
    When,
    Size,
    Ext,
    Kind,
    Color,
    Memo,
}

fn key_of(k: &str) -> Option<Key> {
    Some(match k.to_lowercase().as_str() {
        "고친" | "날짜" | "고친날" | "modified" | "date" => Key::When,
        "크기" | "size" => Key::Size,
        "확장자" | "ext" => Key::Ext,
        "종류" | "kind" | "type" => Key::Kind,
        "색" | "color" => Key::Color,
        "메모" | "memo" => Key::Memo,
        _ => return None,
    })
}

const COLOR_NAMES: &[(&str, &str)] = &[
    ("빨강", "red"),
    ("주황", "orange"),
    ("노랑", "yellow"),
    ("초록", "green"),
    ("파랑", "blue"),
    ("보라", "purple"),
    ("회색", "gray"),
];

/// 빈칸으로 나누되 큰따옴표 안은 한 덩어리로.
fn tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in text.chars() {
        if c == '"' {
            quoted = !quoted;
        } else if c.is_whitespace() && !quoted {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// 찾기 칸 글을 조건으로 푼다.
pub fn parse(text: &str, clock: Clock) -> QuerySpec {
    let mut q = QuerySpec::default();
    for tok in tokens(text) {
        if let Some((k, v)) = tok.split_once(':')
            && let Some(key) = key_of(k)
        {
            let v = v.trim();
            if v.is_empty() {
                // 「고친:」까지만 친 중 — 칠 때마다 경고가 깜박이지 않게 조용히 건너뛴다.
                continue;
            }
            match q.apply(key, v, clock) {
                Ok(label) => q.chips.push(Chip { raw: tok.clone(), label }),
                Err(e) => q.errors.push(e),
            }
            continue;
        }
        if let Some(rest) = tok.strip_prefix('-')
            && !rest.is_empty()
        {
            q.not_terms.push(rest.to_lowercase());
            q.chips.push(Chip { raw: tok.clone(), label: format!("「{rest}」 빼기") });
            continue;
        }
        q.terms.push(tok.to_lowercase());
    }
    q
}

impl QuerySpec {
    /// 찾는 말만 있는 조건 — 예전 찾기(`search::find`)와 같은 뜻.
    pub fn terms_only(text: &str) -> Self {
        QuerySpec { terms: text.split_whitespace().map(str::to_lowercase).collect(), ..Default::default() }
    }

    fn apply(&mut self, key: Key, v: &str, clock: Clock) -> Result<String, String> {
        match key {
            Key::When => {
                let (after, before, label) = parse_when(v, clock).ok_or_else(|| format!("고친 날 「{v}」을 모른다 — 오늘 · 3일 · <7일 · >30일 · 2026-11-01 · 2026-11-01..2026-11-10"))?;
                self.after = after;
                self.before = before;
                Ok(label)
            }
            Key::Size => {
                let (min, max, label) = parse_size(v).ok_or_else(|| format!("크기 「{v}」를 모른다 — >10MB · <1KB · 1MB..1GB"))?;
                self.min_size = min;
                self.max_size = max;
                Ok(label)
            }
            Key::Ext => {
                let xs: Vec<String> = v.split([',', '·']).map(|x| x.trim().trim_start_matches('*').trim_start_matches('.').to_lowercase()).filter(|x| !x.is_empty()).collect();
                if xs.is_empty() {
                    return Err(format!("확장자 「{v}」를 모른다"));
                }
                let label = xs.iter().map(|x| format!(".{x}")).collect::<Vec<_>>().join(" · ");
                for x in xs {
                    if !self.exts.contains(&x) {
                        self.exts.push(x);
                    }
                }
                Ok(label)
            }
            Key::Kind => {
                let mut shown = Vec::new();
                for x in v.split([',', '·']).map(str::trim).filter(|x| !x.is_empty()) {
                    match x.to_lowercase().as_str() {
                        "폴더" | "folder" | "dir" => {
                            self.dirs = Some(true);
                            shown.push("폴더".to_string());
                        }
                        "파일" | "file" => {
                            self.dirs = Some(false);
                            shown.push("파일".to_string());
                        }
                        _ => {
                            self.kinds.push(x.to_string());
                            shown.push(x.to_string());
                        }
                    }
                }
                if shown.is_empty() {
                    return Err(format!("종류 「{v}」를 모른다"));
                }
                Ok(shown.join(" · "))
            }
            Key::Color => {
                let mut shown = Vec::new();
                for x in v.split([',', '·']).map(str::trim).filter(|x| !x.is_empty()) {
                    let lx = x.to_lowercase();
                    if matches!(lx.as_str(), "있음" | "any" | "yes") {
                        self.any_color = true;
                        shown.push("색 표시 있음".to_string());
                    } else if let Some((ko, en)) = COLOR_NAMES.iter().find(|(ko, en)| *ko == lx || *en == lx) {
                        self.colors.push((*en).to_string());
                        shown.push(format!("{ko} 표시"));
                    } else {
                        return Err(format!("색 「{x}」를 모른다 — 빨강 · 주황 · 노랑 · 초록 · 파랑 · 보라 · 회색 · 있음"));
                    }
                }
                if shown.is_empty() {
                    return Err(format!("색 「{v}」를 모른다"));
                }
                Ok(shown.join(" · "))
            }
            Key::Memo => match v.to_lowercase().as_str() {
                "있음" | "yes" | "true" | "o" => {
                    self.memo = Some(true);
                    Ok("메모 있음".into())
                }
                "없음" | "no" | "false" | "x" => {
                    self.memo = Some(false);
                    Ok("메모 없음".into())
                }
                _ => Err(format!("메모 「{v}」를 모른다 — 있음 · 없음 (메모 글로 찾으려면 그냥 낱말로 적는다)")),
            },
        }
    }

    /// 걸러 낼 조건(찾는 말 밖)이 하나라도 있는가.
    pub fn has_filters(&self) -> bool {
        self.after.is_some()
            || self.before.is_some()
            || self.min_size.is_some()
            || self.max_size.is_some()
            || !self.exts.is_empty()
            || !self.kinds.is_empty()
            || self.dirs.is_some()
            || !self.colors.is_empty()
            || self.any_color
            || self.memo.is_some()
            || !self.not_terms.is_empty()
    }

    /// 아무것도 거르지 않는다 — 찾을 것이 없다.
    pub fn is_empty(&self) -> bool {
        self.terms.is_empty() && !self.has_filters()
    }

    /// 메모 · 색 표시를 봐야 가릴 수 있는 조건 (색인은 메모를 모른다).
    pub fn needs_notes(&self) -> bool {
        !self.colors.is_empty() || self.any_color || self.memo == Some(true)
    }

    /// `종류:` 이름을 확장자로 푼다. `table` 은 (id, 이름, 확장자들). 모르는 이름은 `errors` 에 적고, 아무것도 맞지 않게 남긴다.
    pub fn resolve_kinds(&mut self, table: &[(String, String, Vec<String>)]) {
        let mut unknown = Vec::new();
        for k in &self.kinds {
            let lk = k.to_lowercase();
            match table.iter().find(|(id, label, _)| id.to_lowercase() == lk || label.to_lowercase() == lk || label.replace(' ', "").to_lowercase() == lk) {
                Some((_, _, exts)) => {
                    for x in exts {
                        let x = x.to_lowercase();
                        if !self.kind_exts.contains(&x) {
                            self.kind_exts.push(x);
                        }
                    }
                }
                None => unknown.push(k.clone()),
            }
        }
        for k in unknown {
            self.errors.push(format!("종류 「{k}」가 설정에 없다"));
        }
    }

    /// 이름 · 메모 밖의 조건 — 폴더/파일 · 확장자 · 종류 · 크기 · 때.
    pub fn meta_ok(&self, is_dir: bool, ext: &str, size: u64, modified: i64, created: i64) -> bool {
        if let Some(d) = self.dirs
            && d != is_dir
        {
            return false;
        }
        if !self.exts.is_empty() && (is_dir || !self.exts.iter().any(|x| x == ext)) {
            return false;
        }
        if !self.kinds.is_empty() && (is_dir || !self.kind_exts.iter().any(|x| x == ext)) {
            return false;
        }
        if self.min_size.is_some() || self.max_size.is_some() {
            if is_dir {
                return false;
            }
            if self.min_size.is_some_and(|m| size < m) || self.max_size.is_some_and(|m| size >= m) {
                return false;
            }
        }
        if self.after.is_some() || self.before.is_some() {
            let t = modified.max(created);
            if t <= 0 || self.after.is_some_and(|a| t < a) || self.before.is_some_and(|b| t >= b) {
                return false;
            }
        }
        true
    }

    /// 찾는 말이 `hay`(소문자)에 다 들어 있는가. 찾는 말이 없으면 참.
    pub fn terms_in(&self, hay: &str) -> bool {
        self.terms.iter().all(|t| hay.contains(t.as_str()))
    }

    /// 빼는 말이 `hay`(소문자)에 하나라도 있는가.
    pub fn excluded_by(&self, hay: &str) -> bool {
        self.not_terms.iter().any(|t| hay.contains(t.as_str()))
    }

    /// 메모 · 색 표시 조건.
    pub fn notes_ok(&self, memo: Option<&str>, color: Option<&str>) -> bool {
        let has_memo = memo.is_some_and(|m| !m.is_empty());
        if let Some(want) = self.memo
            && want != has_memo
        {
            return false;
        }
        if self.any_color && color.is_none() {
            return false;
        }
        if !self.colors.is_empty() && !color.is_some_and(|c| self.colors.iter().any(|x| x == c)) {
            return false;
        }
        true
    }

    /// 본문 밖의 모든 조건으로 항목 하나를 본다. 맞으면 `Some(메모에서 맞았는가)`.
    pub fn entry_ok(&self, e: &Entry, memo: Option<&str>, color: Option<&str>) -> Option<bool> {
        if !self.meta_ok(e.is_dir, &e.ext, e.size, e.modified, e.created) || !self.notes_ok(memo, color) {
            return None;
        }
        let name = e.name.to_lowercase();
        let memo_l = memo.map(str::to_lowercase).unwrap_or_default();
        if self.excluded_by(&name) || (!memo_l.is_empty() && self.excluded_by(&memo_l)) {
            return None;
        }
        if self.terms_in(&name) {
            return Some(false);
        }
        if !memo_l.is_empty() && self.terms_in(&memo_l) {
            return Some(true);
        }
        None
    }
}

/// 고친 날 값 → (이상, 미만, 읽는 말).
fn parse_when(v: &str, c: Clock) -> Option<(Option<i64>, Option<i64>, String)> {
    let v = v.trim().to_lowercase();
    if let Some((a, b)) = v.split_once("..") {
        let from = if a.is_empty() { None } else { Some(parse_date(a, c)?) };
        let to = if b.is_empty() { None } else { Some(parse_date(b, c)? + DAY_MS) };
        if from.is_none() && to.is_none() {
            return None;
        }
        return Some((from, to, format!("고친 날 {}~{}", a, b)));
    }
    match v.as_str() {
        "오늘" | "today" => return Some((Some(c.day_start(c.now)), None, "오늘 고침".into())),
        "어제" | "yesterday" => {
            let t = c.day_start(c.now);
            return Some((Some(t - DAY_MS), Some(t), "어제 고침".into()));
        }
        _ => {}
    }
    if let Some(d) = parse_date(&v, c) {
        return Some((Some(d), Some(d + DAY_MS), format!("{v} 고침")));
    }
    let (older, rest) = if let Some(r) = v.strip_prefix('>') {
        (true, r)
    } else if let Some(r) = v.strip_prefix('<') {
        (false, r)
    } else {
        (false, v.as_str())
    };
    let (ms, shown) = parse_span(rest.trim())?;
    Some(if older { (None, Some(c.now - ms), format!("{shown} 넘게 안 고침")) } else { (Some(c.now - ms), None, format!("{shown} 안에 고침")) })
}

/// `2026-11-01` · `20261101` · `2026.11.01` → 그날 0시.
fn parse_date(v: &str, c: Clock) -> Option<i64> {
    let digits: String = v.chars().filter(|ch| ch.is_ascii_digit()).collect();
    let sep_ok = v.chars().all(|ch| ch.is_ascii_digit() || matches!(ch, '-' | '.' | '/'));
    if !sep_ok || digits.len() != 8 {
        return None;
    }
    let y: i64 = digits[..4].parse().ok()?;
    let m: i64 = digits[4..6].parse().ok()?;
    let d: i64 = digits[6..].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(c.date_start(y, m, d))
}

/// `3일` · `2주` · `6달` · `1년` · `12시간` · `3d` · `2w` · `6m` · `1y` · `12h` → (밀리초, 읽는 말).
fn parse_span(v: &str) -> Option<(i64, String)> {
    let split = v.find(|ch: char| !ch.is_ascii_digit())?;
    let n: i64 = v[..split].parse().ok()?;
    let unit = &v[split..];
    let (ms, word) = match unit {
        "일" | "d" | "day" | "days" => (DAY_MS, "일"),
        "주" | "w" | "week" | "weeks" => (7 * DAY_MS, "주"),
        "달" | "개월" | "m" | "mo" | "month" | "months" => (30 * DAY_MS, "달"),
        "년" | "y" | "year" | "years" => (365 * DAY_MS, "년"),
        "시간" | "h" | "hour" | "hours" => (HOUR_MS, "시간"),
        _ => return None,
    };
    Some((n * ms, format!("{n}{word}")))
}

/// 크기 값 → (이상, 미만, 읽는 말).
fn parse_size(v: &str) -> Option<(Option<u64>, Option<u64>, String)> {
    let v = v.trim();
    if let Some((a, b)) = v.split_once("..") {
        let lo = if a.is_empty() { None } else { Some(bytes(a)?) };
        let hi = if b.is_empty() { None } else { Some(bytes(b)?) };
        return Some((lo, hi, format!("크기 {a}~{b}")));
    }
    if let Some(r) = v.strip_prefix('<') {
        let r = r.trim_start_matches('=');
        return Some((None, Some(bytes(r)?), format!("{} 미만", r.trim())));
    }
    let r = v.strip_prefix('>').unwrap_or(v).trim_start_matches('=');
    Some((Some(bytes(r)?), None, format!("{} 이상", r.trim())))
}

/// `10MB` · `1.5gb` · `300kb` · `512` → 바이트.
fn bytes(v: &str) -> Option<u64> {
    let v = v.trim().to_lowercase();
    let split = v.find(|ch: char| !(ch.is_ascii_digit() || ch == '.')).unwrap_or(v.len());
    let n: f64 = v[..split].parse().ok()?;
    let mul: f64 = match v[split..].trim() {
        "" | "b" | "바이트" => 1.0,
        "k" | "kb" => 1024.0,
        "m" | "mb" => 1024.0 * 1024.0,
        "g" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    Some((n * mul) as u64)
}

/// 설정을 모를 때(명령줄 · 서비스)의 종류 표 — 화면 `util.ts` `DEFAULT_KINDS` 와 같아야 한다.
pub fn default_kinds() -> Vec<(String, String, Vec<String>)> {
    [
        ("doc", "문서", "hwp hwpx doc docx odt rtf txt md"),
        ("sheet", "표", "xls xlsx xlsm csv ods cell"),
        ("slide", "발표", "ppt pptx odp show key"),
        ("pdf", "PDF", "pdf"),
        ("image", "그림", "png jpg jpeg gif bmp webp svg tif tiff heic ico psd ai"),
        ("media", "영상 · 소리", "mp4 mov avi mkv wmv webm mp3 wav m4a flac"),
        ("archive", "압축", "zip 7z rar alz egg tar gz tgz"),
        ("code", "코드", "js ts tsx jsx java jsp py rs go c cpp h cs sql xml json yml yaml html css sh ps1 bat"),
    ]
    .into_iter()
    .map(|(id, label, exts)| (id.to_string(), label.to_string(), exts.split(' ').map(str::to_string).collect()))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-11-12 12:00 한국 시각.
    fn clock() -> Clock {
        Clock { now: days_from_civil(2026, 11, 12) * DAY_MS + 3 * HOUR_MS, tz_offset_min: 540 }
    }

    fn entry(name: &str, size: u64, modified: i64) -> Entry {
        let ext = name.rsplit_once('.').map(|(_, x)| x.to_lowercase()).unwrap_or_default();
        Entry { name: name.into(), path: format!(r"C:\가\{name}"), is_dir: false, size, modified, created: 0, attrs: 0, ext, kind: String::new() }
    }

    #[test]
    fn plain_words_are_terms() {
        let q = parse("보고서 최종", clock());
        assert_eq!(q.terms, ["보고서", "최종"]);
        assert!(!q.has_filters());
        assert!(q.chips.is_empty());
    }

    #[test]
    fn korean_and_english_keys_mean_the_same() {
        let a = parse("고친:3일 크기:>10MB 확장자:pdf,hwpx 색:빨강 메모:있음", clock());
        let b = parse("modified:3d size:>10mb ext:.pdf,hwpx color:red memo:yes", clock());
        assert_eq!(a.after, b.after);
        assert_eq!(a.min_size, Some(10 * 1024 * 1024));
        assert_eq!(a.min_size, b.min_size);
        assert_eq!(a.exts, ["pdf", "hwpx"]);
        assert_eq!(a.exts, b.exts);
        assert_eq!(a.colors, ["red"]);
        assert_eq!(a.colors, b.colors);
        assert_eq!(a.memo, Some(true));
        assert_eq!(a.chips.len(), 5);
        assert!(a.errors.is_empty() && b.errors.is_empty());
    }

    #[test]
    fn when_values() {
        let c = clock();
        let today = c.day_start(c.now);
        // 한국 0시 = 전날 15시 UTC
        assert_eq!(today, days_from_civil(2026, 11, 12) * DAY_MS - 9 * HOUR_MS);
        assert_eq!(parse("고친:오늘", c).after, Some(today));
        let y = parse("고친:어제", c);
        assert_eq!((y.after, y.before), (Some(today - DAY_MS), Some(today)));
        assert_eq!(parse("고친:3일", c).after, Some(c.now - 3 * DAY_MS));
        assert_eq!(parse("고친:<2주", c).after, Some(c.now - 14 * DAY_MS));
        let old = parse("고친:>30일", c);
        assert_eq!((old.after, old.before), (None, Some(c.now - 30 * DAY_MS)));
        let d = parse("고친:2026-11-01", c);
        assert_eq!(d.after, Some(c.date_start(2026, 11, 1)));
        assert_eq!(d.before, Some(c.date_start(2026, 11, 2)));
        let r = parse("고친:2026-11-01..2026-11-10", c);
        assert_eq!((r.after, r.before), (Some(c.date_start(2026, 11, 1)), Some(c.date_start(2026, 11, 11))));
        assert_eq!(parse("고친:언젠가", c).errors.len(), 1);
        // 치는 중(값 없음)은 조용히 넘어간다
        let typing = parse("고친:", c);
        assert!(typing.errors.is_empty() && !typing.has_filters());
    }

    #[test]
    fn matches_entries() {
        let c = clock();
        let q = parse("보고 고친:3일 확장자:pdf -초안", c);
        assert_eq!(q.entry_ok(&entry("결과보고.pdf", 10, c.now - DAY_MS), None, None), Some(false));
        assert_eq!(q.entry_ok(&entry("결과보고.pdf", 10, c.now - 5 * DAY_MS), None, None), None); // 오래됐다
        assert_eq!(q.entry_ok(&entry("결과보고.hwpx", 10, c.now), None, None), None); // 확장자
        assert_eq!(q.entry_ok(&entry("결과보고_초안.pdf", 10, c.now), None, None), None); // 뺀 말
        // 생긴 때가 최근이면 고친 때가 옛날이어도 맞다 (받은 파일)
        let mut got = entry("결과보고.pdf", 10, c.now - 400 * DAY_MS);
        got.created = c.now - HOUR_MS;
        assert_eq!(q.entry_ok(&got, None, None), Some(false));
        // 메모에서 맞는다
        let m = parse("근거", c);
        assert_eq!(m.entry_ok(&entry("회의.txt", 1, c.now), Some("보고서 근거"), None), Some(true));
    }

    #[test]
    fn size_and_dirs() {
        let q = parse("크기:1MB..10MB", clock());
        assert!(q.meta_ok(false, "pdf", 2 * 1024 * 1024, 1, 0));
        assert!(!q.meta_ok(false, "pdf", 10 * 1024 * 1024, 1, 0));
        assert!(!q.meta_ok(true, "", 0, 1, 0));
        let f = parse("종류:폴더", clock());
        assert!(f.meta_ok(true, "", 0, 1, 0) && !f.meta_ok(false, "pdf", 1, 1, 0));
    }

    #[test]
    fn kinds_resolve_against_table() {
        let mut q = parse("종류:문서", clock());
        q.resolve_kinds(&default_kinds());
        assert!(q.meta_ok(false, "hwpx", 1, 1, 0));
        assert!(!q.meta_ok(false, "pdf", 1, 1, 0));
        let mut bad = parse("종류:없는종류", clock());
        bad.resolve_kinds(&default_kinds());
        assert_eq!(bad.errors.len(), 1);
        assert!(!bad.meta_ok(false, "pdf", 1, 1, 0)); // 모르는 종류는 아무것도 맞지 않는다
    }

    #[test]
    fn colors_and_memo() {
        let q = parse("색:빨강 메모:없음", clock());
        assert!(q.notes_ok(None, Some("red")));
        assert!(!q.notes_ok(Some("글"), Some("red")));
        assert!(!q.notes_ok(None, Some("blue")));
        assert!(q.needs_notes());
        assert!(!parse("메모:없음", clock()).needs_notes());
    }

    #[test]
    fn drive_like_tokens_stay_terms() {
        let q = parse(r"c:\temp 보고", clock());
        assert_eq!(q.terms, [r"c:\temp", "보고"]);
    }
}
