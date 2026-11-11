//! 파일 이름에서 「어떤 문서의 몇 판 · 언제」를 읽는다.
//!
//! 과업 산출물 이름 규격(`<문서명>_v<판>_<YYYYMMDD>` · 정의서는 `LDM_Dnn_` 머리)을 기준으로 하되,
//! 받은 파일 · 옛 파일의 흔한 꼴도 읽는다 — 앞 여섯 자리 날짜(`261006_…`) · 띄어 쓴 판(`건의 v2(서식변경)`) ·
//! 작성자 꼬리(`_홍길동`) · 복사 표시(`(1)` · `- 복사본`) · 발송 묶음 순번(`00_` · `별첨3_`).
//!
//! 떼어 낸 뒤 남는 것이 문서 키다. 키가 같으면 같은 문서의 판으로 묶는다.
//! 자동으로 못 묶는 것(문서명을 바꾼 경우)은 사람이 별칭으로 잇는다 — 2단계 `doc_alias`.

use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

/// 판을 가리지 못하는 상태어 — 키에서 빼고 이름 규칙 위반으로 알린다.
/// 2026.11.11 : 설정 파일(`name-rules.json`)로 받던 이름 규칙을 뺐다. 과업 이름 · 사람 이름 목록은 한 과업에만 맞는 말이라
///              일반 탐색기에 둘 까닭이 없고, 작성자 꼬리는 `looks_like_person` 추정으로 뗀다. 상태어는 어디서나 같아 여기 고정한다.
const STATUS_WORDS: &[&str] = &["최종", "진짜", "수정본", "수정전", "복사본", "사본", "임시", "확인용", "최최종", "취합", "검토"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocName {
    /// 묶음 키 (소문자 · 공백 정리).
    pub key: String,
    /// 사람이 볼 문서 이름 (떼어 낸 뒤 남은 원래 글자).
    pub title: String,
    /// 판 번호 조각 (`v1.6` → [1, 6]). 없으면 빈 배열.
    pub version: Vec<u32>,
    /// 날짜 `YYYYMMDD`. 없으면 빈 문자열.
    pub date: String,
    /// 같은 날 둘째 판의 시각 `HHMM`.
    pub time: String,
    pub ext: String,
    /// 이름 규칙 위반 (사람이 읽을 짧은 말).
    pub issues: Vec<String>,
}

impl DocName {
    pub fn version_label(&self) -> String {
        if self.version.is_empty() {
            String::new()
        } else {
            format!("v{}", self.version.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."))
        }
    }
}

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("정규식"))
}

static RE_COPY_TAIL: OnceLock<Regex> = OnceLock::new();
static RE_VER_TOKEN: OnceLock<Regex> = OnceLock::new();
static RE_VER_INLINE: OnceLock<Regex> = OnceLock::new();
static RE_LEAD_DATE_SPACE: OnceLock<Regex> = OnceLock::new();
static RE_ORDER: OnceLock<Regex> = OnceLock::new();
static RE_PAREN_VER: OnceLock<Regex> = OnceLock::new();

/// 분할 압축(.z01 · .001)처럼 확장자가 숫자인 것도 확장자로 본다.
fn split_ext(name: &str) -> (&str, String) {
    match name.rfind('.') {
        Some(i) if i > 0 && name.len() - i <= 8 => (&name[..i], name[i + 1..].to_lowercase()),
        _ => (name, String::new()),
    }
}

fn valid_ymd(y: u32, m: u32, d: u32) -> bool {
    (2000..=2099).contains(&y) && (1..=12).contains(&m) && (1..=31).contains(&d)
}

/// `20261016` · `261016` · `2026-10-16` → `20261016`
fn as_date(tok: &str) -> Option<String> {
    let t: String = tok.chars().filter(|c| *c != '-' && *c != '.').collect();
    if !t.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (y, m, d) = match t.len() {
        8 => (t[..4].parse().ok()?, t[4..6].parse().ok()?, t[6..8].parse().ok()?),
        6 if tok.len() == 6 => (2000 + t[..2].parse::<u32>().ok()?, t[2..4].parse().ok()?, t[4..6].parse().ok()?),
        _ => return None,
    };
    valid_ymd(y, m, d).then(|| format!("{y:04}{m:02}{d:02}"))
}

fn as_time(tok: &str) -> Option<String> {
    if tok.len() != 4 || !tok.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let h: u32 = tok[..2].parse().ok()?;
    let m: u32 = tok[2..].parse().ok()?;
    (h < 24 && m < 60).then(|| tok.to_string())
}

fn parse_version(s: &str) -> Vec<u32> {
    s.split('.').filter_map(|p| p.parse().ok()).collect()
}

pub fn parse(name: &str) -> DocName {
    let (stem, ext) = split_ext(name);
    let mut issues = Vec::new();
    let mut stem = stem.trim().to_string();

    // 1. 복사 표시 꼬리: ` (1)` · ` - 복사본` · ` - Copy (2)`
    let copy_tail = re(&RE_COPY_TAIL, r"(?i)(\s*-\s*(복사본|copy))?(\s*\(\d+\))?$");
    if let Some(m) = copy_tail.find(&stem) {
        if m.start() < stem.len() {
            issues.push("복사 표시".into());
            stem.truncate(m.start());
        }
    }
    // 2. 앞 날짜 + 띄어쓰기: `20260701 예시 사업 …`
    let lead = re(&RE_LEAD_DATE_SPACE, r"^(\d{6}|\d{8})\s+");
    let mut date = String::new();
    if let Some(c) = lead.captures(&stem) {
        if let Some(d) = as_date(&c[1]) {
            date = d;
            stem = stem[c.get(0).unwrap().end()..].to_string();
        }
    }
    // 3. 띄어 쓴 판: `… 건의 v2(서식변경)` → 판만 뽑고 괄호 메모는 버린다.
    let mut version = Vec::new();
    // 뒤가 공백 · `_` · 끝일 때만 판으로 본다 (`v2x` 같은 낱말 속 v 는 아니다). regex 크레이트에 뒤보기가 없어 직접 본다.
    let inline = re(&RE_VER_INLINE, r"(?i)\s+v(\d+(?:\.\d+)*)(\([^)]*\))?");
    let hit = inline.captures_iter(&stem).find(|c| {
        let end = c.get(0).unwrap().end();
        matches!(stem[end..].chars().next(), None | Some(' ') | Some('_'))
    });
    if let Some(c) = hit {
        version = parse_version(&c[1]);
        let m = c.get(0).unwrap();
        stem = format!("{}{}", &stem[..m.start()], &stem[m.end()..]);
    }

    // 4. `_` 로 나눈 조각마다 판 · 날짜 · 시각 · 작성자 · 상태어 · 순번을 떼어 낸다.
    let ver_tok = re(&RE_VER_TOKEN, r"(?i)^v(\d+(?:\.\d+)*)(\(.*\))?$");
    let paren_ver = re(&RE_PAREN_VER, r"(?i)^\(v(\d+(?:\.\d+)*)\)$");
    let order = re(&RE_ORDER, r"^(\d{2}|별첨\d+)$");
    let mut time = String::new();
    let mut kept: Vec<&str> = Vec::new();
    let toks: Vec<&str> = stem.split('_').collect();
    let mut prev_was_date = false;
    for (i, raw) in toks.iter().enumerate() {
        let t = raw.trim();
        if t.is_empty() {
            prev_was_date = false;
            continue;
        }
        if i == 0 && toks.len() > 1 && order.is_match(t) {
            continue; // 발송 묶음 순번 · 별첨 번호
        }
        // 날짜 · 판 뒤에 붙은 괄호 메모는 떼고 본다 (`260916(검토)`).
        let bare = match t.find('(') {
            Some(i) if i > 0 && t.ends_with(')') => &t[..i],
            _ => t,
        };
        if let Some(c) = ver_tok.captures(t).or_else(|| paren_ver.captures(t)) {
            if version.is_empty() {
                version = parse_version(&c[1]);
            }
            prev_was_date = false;
            continue;
        }
        if prev_was_date {
            if let Some(tm) = as_time(t) {
                time = tm;
                prev_was_date = false;
                continue;
            }
        }
        if let Some(d) = as_date(t).or_else(|| as_date(bare)) {
            if date.is_empty() || d > date {
                date = d;
            }
            prev_was_date = true;
            continue;
        }
        prev_was_date = false;
        // 상태어를 먼저 본다 — 「수정전」도 한글 세 글자라 사람 이름으로 잘못 볼 수 있다.
        if STATUS_WORDS.contains(&t) {
            issues.push(format!("상태어 「{t}」"));
            continue;
        }
        if looks_like_person(t) {
            continue;
        }
        kept.push(t);
    }
    // 첫 조각이 순번뿐이라 다 지워졌으면 원래 이름을 쓴다 (`00_반입_안내` 같은 꼴은 순번이 이름의 일부).
    if kept.is_empty() {
        kept = toks.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    }
    let title = kept.join("_");
    let key = title.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");

    if name.contains(' ') {
        issues.push("공백".into());
    }
    if name.contains('—') || name.contains('–') {
        issues.push("줄표".into());
    }
    if version.is_empty() {
        issues.push("판 번호 없음".into());
    }
    if date.is_empty() {
        issues.push("날짜 없음".into());
    }
    if toks.iter().any(|t| t.len() == 6 && as_date(t).is_some()) || lead_six(name) {
        issues.push("여섯 자리 날짜".into());
    }

    DocName { key, title, version, date, time, ext, issues }
}

/// 마지막 조각 근처의 한글 세 글자는 작성자 이름으로 본다 (`…(안)_여채린_260911`).
/// 문서명 조각이 세 글자일 수도 있어(「회의록」) 흔한 문서 낱말은 뺀다.
fn looks_like_person(t: &str) -> bool {
    const NOT_PEOPLE: &[&str] = &["회의록", "발표본", "계획서", "결과서", "보고서", "정의서", "설명서", "안내서", "요청서", "검토표", "체크리스트", "매뉴얼", "기준표", "현황표"];
    let chars: Vec<char> = t.chars().collect();
    chars.len() == 3 && chars.iter().all(|c| ('가'..='힣').contains(c)) && !NOT_PEOPLE.contains(&t)
}

fn lead_six(name: &str) -> bool {
    name.len() > 7 && name.as_bytes()[..6].iter().all(|b| b.is_ascii_digit()) && !name.as_bytes()[6].is_ascii_digit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(n: &str) -> DocName {
        parse(n)
    }

    #[test]
    fn standard_definition_files_group_together() {
        let a = p("LDM_D09_테이블(컬럼)정의서_v1.6_20261016.xlsx");
        let b = p("LDM_D09_테이블(컬럼)정의서_v1.2.xlsx");
        let c = p("LDM_D09_테이블(컬럼)정의서_v1.5_20261001_수정전.xlsx");
        assert_eq!(a.key, "ldm_d09_테이블(컬럼)정의서");
        assert_eq!(a.key, b.key);
        assert_eq!(a.key, c.key);
        assert_eq!(a.version, vec![1, 6]);
        assert_eq!(a.date, "20261016");
        assert!(a.issues.is_empty(), "{:?}", a.issues);
        assert!(c.issues.iter().any(|i| i.contains("수정전")));
        assert!(b.issues.contains(&"날짜 없음".to_string()));
    }

    #[test]
    fn report_with_author_and_time() {
        let a = p("담당자매뉴얼_20261027_홍길동.pptx");
        let b = p("담당자매뉴얼_v14_20261027.pptx");
        assert_eq!(a.key, b.key);
        assert_eq!(a.key, "담당자매뉴얼");
        let m = p("중간보고_회의록_20261006_1342.hwpx");
        assert_eq!((m.date.as_str(), m.time.as_str()), ("20261006", "1342"));
        assert_eq!(m.key, "중간보고_회의록");
    }

    #[test]
    fn received_files_odd_shapes() {
        let a = p("261006_시책건의서_「산림 및 산림과 잇닿은 토지 건축신고 등의 산림재난방지 검토 지침」개정 건의 v2(서식변경)_산사태연구과_이진호 (1).hwpx");
        let b = p("261006_시책건의서_「산림 및 산림과 잇닿은 토지 건축신고 등의 산림재난방지 검토 지침」개정 건의 v2(서식변경)_산사태연구과_이진호.hwpx");
        assert_eq!(a.key, b.key);
        assert_eq!(a.version, vec![2]);
        assert_eq!(a.date, "20261006");
        assert!(a.issues.contains(&"복사 표시".to_string()));
        assert!(a.issues.contains(&"여섯 자리 날짜".to_string()));

        let d = p("20260701 예시 사업 검토 실무회의.pdf");
        assert_eq!(d.date, "20260701");
        assert_eq!(d.key, "예시 사업 검토 실무회의");

        let e = p("20260915_화면정의서_v3.pdf");
        assert_eq!((e.key.as_str(), e.version.as_slice()), ("화면정의서", &[3u32][..]));
    }

    #[test]
    fn bundle_prefixes_are_dropped() {
        let a = p("별첨9_LDM_D14_화면정의서_20260714.pptx");
        let b = p("LDM_D14_화면정의서_20260714.pptx");
        assert_eq!(a.key, b.key);
        let c = p("00_반입_안내.txt");
        assert_eq!(c.key, "반입_안내");
        let d = p("01_진행현황및조치사항.xlsx");
        assert_eq!(d.key, "진행현황및조치사항");
    }

    #[test]
    fn other_authors_and_noted_dates() {
        let a = p("[중간보고] 2026년 산사태 고도화(안)_여채린_260911.pptx");
        let b = p("[중간보고] 2026년 산사태 고도화(안)_v2_취합_260916(검토).pptx");
        assert_eq!(a.key, b.key);
        assert_eq!(b.date, "20260916");
        assert_eq!(b.version, vec![2]);
        // 세 글자 문서 낱말은 사람으로 보지 않는다.
        assert_eq!(p("중간보고_회의록_20261006.hwpx").key, "중간보고_회의록");
    }

    #[test]
    fn split_archives_keep_numeric_ext() {
        let a = p("delivery-custom-20260725-124639569.z04");
        assert_eq!(a.ext, "z04");
    }

    #[test]
    fn same_name_different_docs_stay_apart() {
        // 산출물 번호가 같아도(D14) 문서가 다르면 키가 다르다.
        assert_ne!(p("LDM_D14_공통코드_정의서_v0.2_20261016.xlsx").key, p("LDM_D14_화면정의서_20260714.pptx").key);
    }
}
