//! 파일 이름에서 「어떤 문서의 몇 판 · 언제」를 읽는다.
//!
//! 과업 산출물 이름 규격(`<문서명>_v<판>_<YYYYMMDD>` · 정의서는 `LDM_Dnn_` 머리)을 기준으로 하되,
//! 받은 파일 · 옛 파일의 흔한 꼴도 읽는다 — 앞 여섯 자리 날짜(`261006_…`) · 띄어 쓴 판(`건의 v2(서식변경)`) ·
//! 작성자 꼬리(`_홍길동`) · 복사 표시(`(1)` · `- 복사본`) · 발송 묶음 순번(`00_` · `별첨3_`).
//!
//! 떼어 낸 뒤 남는 것이 문서 키다. 키가 같으면 같은 문서의 판으로 묶는다.
//! 자동으로 못 묶는 것(문서명을 바꾼 경우)은 사람이 별칭으로 잇는다 — 2단계 `doc_alias`.
//!
//! 2026.11.11 : 한 회사 규격에 묶이지 않게 넓혔다 (DESIGN [1-1] 「보편 신호」) — 운영체제 · 브라우저 · 클라우드의 복사 표시
//!              (`Copy of …` · `… copy 2` · `…의 사본` · `(… conflicted copy …)`), 여러 말의 상태어(`final` · `draft` · `最終`),
//!              판 꼴(`ver2` · `rev3` · `제3판`), 띄어 쓴 날짜(`2026-11-11 회의록` · `회의록 2026-11-11`).
//!              「판 번호 없음」 · 「날짜 없음」 · 「공백」은 그 폴더가 쓰는 꼴에 따라 맞기도 틀리기도 해서 여기서 알리지 않는다 — `convention` 이 폴더 관례와 견줘 알린다.
//!              애매하면 나누는 쪽으로 읽는다 — 다른 문서를 한 문서로 묶으면 「지난 판 옮기기」가 남의 문서를 옮긴다.
//!              그래서 `2차` 는 판으로 보지 않는다 (「2차 회의」처럼 다른 회차라는 뜻이 더 흔하다).

use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

/// 판을 가리지 못하는 상태어 — 키에서 빼고 이름 규칙 위반으로 알린다. 꼬리에 있을 때만 뗀다. 영문은 대소문자를 가리지 않는다.
/// 2026.11.11 : 설정 파일(`name-rules.json`)로 받던 이름 규칙을 뺐다. 과업 이름 · 사람 이름 목록은 한 과업에만 맞는 말이라
///              일반 탐색기에 둘 까닭이 없고, 작성자 꼬리는 `looks_like_person` 추정으로 뗀다. 상태어는 어디서나 같아 여기 고정한다.
/// 2026.11.11 : 영어 · 일본어 상태어를 더했다. `new` · `old` 는 제목 낱말(`What's_new`)로도 흔해 넣지 않는다.
///              리뷰 뒤 `temp` · `tmp` · `backup` · `bak` · `wip` · `latest` 를 뺐다 — `Server_backup` · `Data_temp` 처럼 제목 낱말이 더 흔하다.
const STATUS_WORDS: &[&str] = &[
    "최종", "진짜", "수정본", "수정전", "수정후", "복사본", "사본", "임시", "확인용", "최최종", "최종본", "취합", "검토",
    "final", "fin", "draft", "edited", "revised",
    "最終", "修正", "最新",
];

/// 띄어 쓴 이름(`보고서 최종` · `report-final`)의 꼬리에서도 떼는 상태어 — 제목 낱말일 수 없는 것만.
/// 2026.11.11 : `산림재난 위험성 검토.pdf` 가 `산림재난 위험성.pdf` 와 한 문서로 묶였다 — 띄어 쓴 이름에서는 「검토」 「취합」이 제목인 일이 더 많다.
const STRONG_STATUS_WORDS: &[&str] = &["최종", "최최종", "최종본", "수정본", "복사본", "final", "draft", "最終"];

pub(crate) fn is_status(t: &str) -> bool {
    STATUS_WORDS.iter().any(|w| w.eq_ignore_ascii_case(t))
}

/// 제목 낱말로도 흔한 상태어 — 판 · 날짜가 붙은 이름에서만 상태어로 본다.
const WEAK_STATUS_WORDS: &[&str] = &["검토", "취합", "확인용", "임시", "진짜", "fin", "edited", "revised"];

fn is_weak_status(t: &str) -> bool {
    WEAK_STATUS_WORDS.iter().any(|w| w.eq_ignore_ascii_case(t))
}

pub(crate) fn is_strong_status(t: &str) -> bool {
    STRONG_STATUS_WORDS.iter().any(|w| w.eq_ignore_ascii_case(t))
}

static RE_EDITION_ANY: OnceLock<Regex> = OnceLock::new();

/// 이름 어딘가에 판(`v3` · `rev3` · `제3판`)이 있나 — 낱말 속 v(`dev2`)는 아니다.
fn has_version(s: &str) -> bool {
    let ko = re(&RE_EDITION_ANY, r"제?\d+판");
    ver_re().find_iter(s).chain(ko.find_iter(s)).any(|m| {
        let before = s[..m.start()].chars().next_back();
        let after = s[m.end()..].chars().next();
        before.is_none_or(|c| !c.is_ascii_alphanumeric()) && after.is_none_or(|c| !c.is_ascii_alphanumeric())
    })
}

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
    /// 꼬리에서 뗀 작성자 (`_홍길동`). 키에는 넣지 않지만 이름을 다시 지을 때 되살린다 (`convention`).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub author: String,
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

/// 정규식을 한 번만 짓는다. 이름을 읽는 모듈(`edition` · `convention`)이 함께 쓴다.
pub(crate) fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("정규식"))
}

static RE_COPY_TAIL: OnceLock<Regex> = OnceLock::new();
static RE_VER_TOKEN: OnceLock<Regex> = OnceLock::new();
static RE_VER_INLINE: OnceLock<Regex> = OnceLock::new();
static RE_LEAD_DATE_SPACE: OnceLock<Regex> = OnceLock::new();
static RE_ORDER: OnceLock<Regex> = OnceLock::new();
static RE_PAREN_VER: OnceLock<Regex> = OnceLock::new();
static RE_COPY_LEAD: OnceLock<Regex> = OnceLock::new();
static RE_TAIL_DATE_SPACE: OnceLock<Regex> = OnceLock::new();
static RE_EDITION_KO: OnceLock<Regex> = OnceLock::new();
static RE_EDITION_KO_INLINE: OnceLock<Regex> = OnceLock::new();

/// 판 조각 정규식 — `v3` · `V1.2` · `ver2` · `ver.2` · `rev3`. `edition` 의 새 판 이름 짓기도 같은 꼴을 쓴다.
pub(crate) const VER_BODY: &str = r"(?:v|ver\.?|rev\.?)(\d+(?:\.\d+)*)";

static RE_VER_ANY: OnceLock<Regex> = OnceLock::new();

/// 판 조각 정규식 (`VER_BODY`, 대소문자 무시) — 낱말 경계는 부르는 쪽이 본다.
pub(crate) fn ver_re() -> &'static Regex {
    re(&RE_VER_ANY, &format!(r"(?i){VER_BODY}"))
}

/// 이름을 (줄기, 확장자) 로 — 확장자는 점 뒤 일곱 자까지. 분할 압축(.z01 · .001)도 확장자로 보지만,
/// 숫자만이면 세 자리(`.001`)일 때만 — `결과보고_2026.11.11` 의 `.11` 은 날짜 조각이다.
/// 2026.11.11 : 이름 읽기 · 새 판 · 이름 제안이 저마다 확장자를 다르게 떼어 같은 파일을 다르게 읽었다 — 여기 하나로 모았다.
pub(crate) fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 && name.len() - i <= 8 => {
            let ext = &name[i + 1..];
            let digits = ext.chars().all(|c| c.is_ascii_digit());
            if ext.is_empty() || (digits && ext.len() != 3) { (name, "") } else { (&name[..i], &name[i..]) }
        }
        _ => (name, ""),
    }
}

fn split_ext(name: &str) -> (&str, String) {
    let (stem, ext) = split_name(name);
    (stem, ext.trim_start_matches('.').to_lowercase())
}

pub(crate) fn valid_ymd(y: u32, m: u32, d: u32) -> bool {
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

/// 복사 표시를 뗀다 — (뗀 이름, 뗐나). 여럿이 겹칠 수 있어(`Copy of 보고서 (1)`) 더 없을 때까지.
pub(crate) fn strip_copy_marks(stem: &str) -> (String, bool) {
    let copy_tail = re(
        &RE_COPY_TAIL,
        r"(?i)(?:\s*\([^)]*(?:conflicted copy|충돌 사본|충돌된 사본)[^)]*\)|\s*-\s*(?:복사본|copy|사본)|\s+copy(?:\s+\d+)?|의 사본|\s*\(\d+\))$",
    );
    let copy_lead = re(&RE_COPY_LEAD, r"(?i)^(?:copy of\s+|사본\s*-\s*)");
    let mut stem = stem.to_string();
    let mut any = false;
    loop {
        let before = stem.len();
        if let Some(m) = copy_tail.find(&stem) {
            if m.start() > 0 {
                stem.truncate(m.start());
            }
        }
        if let Some(m) = copy_lead.find(&stem) {
            if m.end() < stem.len() {
                stem = stem[m.end()..].to_string();
            }
        }
        if stem.len() == before {
            return (stem, any);
        }
        any = true;
    }
}

// 이름 문제 문장 — 목록의 문제 줄에 그대로 보인다.
// 2026.11.11 : 「복사 표시」 「줄표」 같은 낱말만 보여 무엇이 문제인지 몰랐다 — 읽히는 문장으로 바꿨다.
pub const ISSUE_COPY: &str = "이름에 복사본 표시가 붙었다";
pub const ISSUE_SIX_DIGIT_DATE: &str = "날짜가 여섯 자리다";
pub const ISSUE_DASH: &str = "이름에 긴 줄표(— –)가 있다";

fn status_issue(word: &str) -> String {
    format!("이름에 「{word}」 같은 상태 말이 붙었다")
}

pub fn parse(name: &str) -> DocName {
    let (stem, ext) = split_ext(name);
    let mut issues = Vec::new();
    let mut stem = stem.trim().to_string();

    // 1. 복사 표시 — 운영체제 · 브라우저 · 클라우드가 붙이는 꼴. 여럿이 겹칠 수 있어(`Copy of 보고서 (1)`) 더 없을 때까지 뗀다.
    //    꼬리: ` (1)` · ` - 복사본` · ` - Copy (2)` · macOS ` copy` · ` copy 2` · 구글 드라이브 `…의 사본` · Dropbox ` (… conflicted copy …)` · `(충돌 사본)`
    //    머리: 구글 드라이브 `Copy of …` · `사본 - …`
    let (bare, had_copy) = strip_copy_marks(&stem);
    if had_copy {
        issues.push(ISSUE_COPY.into());
        stem = bare;
    }
    // 2. 앞 날짜 + 띄어쓰기: `20260701 예시 사업 …` · `2026-11-11 회의록` · 괄호 날짜: `(260115)보도자료-…`
    // 2026.11.11 : 줄표 날짜(`2026-11-03 회의록`)와 띄어 쓴 꼬리 날짜(`회의록 2026-11-10`)는 판이 함께 있을 때만 키에서 뗀다.
    //              날짜만 다른 띄어 쓴 이름은 날마다 다른 문서(그날 회의록)인 일이 많다 — 한 문서로 묶으면 지난 판 옮기기가 남의 회의록을 옮긴다.
    //              (여덟 · 여섯 자리 앞 날짜 `20260701 …` 는 전부터 떼던 대로 둔다.)
    let ver_in_name = has_version(&stem);
    let lead = re(&RE_LEAD_DATE_SPACE, r"^(?:(\d{6}|\d{8}|\d{4}[-.]\d{2}[-.]\d{2})\s+|\((\d{6}|\d{8})\)\s*)");
    let mut date = String::new();
    if let Some(c) = lead.captures(&stem) {
        let tok = c.get(1).or_else(|| c.get(2)).unwrap().as_str();
        if let Some(d) = as_date(tok) {
            if tok.len() == 6 && c.get(2).is_some() {
                issues.push(ISSUE_SIX_DIGIT_DATE.into());
            }
            date = d;
            let dashed = tok.contains(['-', '.']);
            if !dashed || ver_in_name {
                stem = stem[c.get(0).unwrap().end()..].to_string();
            }
        }
    }
    // 2-1. 띄어 쓴 꼬리 날짜: `회의록 2026-11-11` · `회의록 20261111`
    let tail_date = re(&RE_TAIL_DATE_SPACE, r"\s+(\d{8}|\d{4}[-.]\d{2}[-.]\d{2})$");
    if let Some(c) = tail_date.captures(&stem) {
        if let Some(d) = as_date(&c[1]) {
            if date.is_empty() || d > date {
                date = d;
            }
            if ver_in_name {
                let at = c.get(0).unwrap().start();
                stem.truncate(at);
            }
        }
    }
    // 3. 띄어 쓴 판: `… 건의 v2(서식변경)` · `report-v2` · `회의록 rev 3` → 판만 뽑고 괄호 메모는 버린다.
    let mut version = Vec::new();
    // 뒤가 공백 · `_` · `-` · 끝일 때만 판으로 본다 (`v2x` 같은 낱말 속 v 는 아니다). regex 크레이트에 뒤보기가 없어 직접 본다.
    let inline = re(&RE_VER_INLINE, r"(?i)[\s\-]+(?:v|ver\.?\s?|rev\.?\s?)(\d+(?:\.\d+)*)(\([^)]*\))?");
    let hit = inline.captures_iter(&stem).find(|c| {
        let end = c.get(0).unwrap().end();
        matches!(stem[end..].chars().next(), None | Some(' ') | Some('_') | Some('-'))
    });
    if let Some(c) = hit {
        version = parse_version(&c[1]);
        let m = c.get(0).unwrap();
        stem = format!("{}{}", &stem[..m.start()], &stem[m.end()..]);
    }
    // 띄어 쓴 `제N판`: `사업계획 제3판` — 새 판 내기가 이 꼴로 다음 판을 지으니, 읽기도 같아야 판끼리 묶인다 (2026.11.11 리뷰).
    if version.is_empty() {
        let ko = re(&RE_EDITION_KO_INLINE, r"[\s\-]+(제?(\d+)판)");
        let hit = ko.captures_iter(&stem).find(|c| {
            let end = c.get(0).unwrap().end();
            matches!(stem[end..].chars().next(), None | Some(' ') | Some('_') | Some('-'))
        });
        if let Some(c) = hit {
            version = parse_version(&c[2]);
            let m = c.get(0).unwrap();
            stem = format!("{}{}", &stem[..m.start()], &stem[m.end()..]);
        }
    }

    // 4. `_` 로 나눈 조각마다 판 · 날짜 · 시각 · 작성자 · 상태어 · 순번을 떼어 낸다.
    let ver_tok = re(&RE_VER_TOKEN, &format!(r"(?i)^{VER_BODY}(\(.*\))?$"));
    let paren_ver = re(&RE_PAREN_VER, &format!(r"(?i)^\({VER_BODY}\)$"));
    let edition_ko = re(&RE_EDITION_KO, r"^제?(\d+)판$");
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
        if let Some(c) = ver_tok.captures(t).or_else(|| paren_ver.captures(t)).or_else(|| edition_ko.captures(t)) {
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
        kept.push(t);
    }
    // 상태어 · 작성자는 판 · 날짜를 뗀 뒤 꼬리에 남은 것만 뗀다.
    // 2026.11.11 : 자리를 가리지 않고 떼던 것을 꼬리로 좁혔다. 실제 산출물 폴더에서 「위험성」 「대피소」 「표준화」 같은 제목 낱말 24곳이
    //              사람 이름으로, 제목 가운데 「검토」가 상태어로 빠져 다른 문서가 한 키로 합쳐질 수 있었다 — 합쳐지면 이전판 옮기기가 남의 문서를 옮긴다.
    // 상태어를 먼저 본다 — 「수정전」도 한글 세 글자라 사람 이름으로 잘못 볼 수 있다.
    // 2026.11.11 : 작성자는 판이나 날짜가 붙은 이름에서만 뗀다 — 작성자 꼬리는 「판 · 날짜를 단 받은 문서」에 붙는다.
    //              판 · 날짜 없는 `산림재난_위험성` · `산림재난_대피소` 가 둘 다 `산림재난` 으로 묶였다.
    let dated = !date.is_empty() || !version.is_empty();
    let mut authors: Vec<&str> = Vec::new();
    while kept.len() > 1 {
        let last = kept[kept.len() - 1];
        // 「검토」 「취합」 같은 약한 상태어는 판 · 날짜가 붙은 이름에서만 뗀다 — 판 · 날짜 없는 `산림재난_위험성_검토` 의 「검토」는 제목이다 (2026.11.11 리뷰).
        if is_status(last) && (dated || !is_weak_status(last)) {
            issues.push(status_issue(last));
        } else if dated && looks_like_person(last) {
            authors.insert(0, last);
        } else {
            break;
        }
        kept.pop();
    }
    // 첫 조각이 순번뿐이라 다 지워졌으면 원래 이름을 쓴다 (`00_반입_안내` 같은 꼴은 순번이 이름의 일부).
    if kept.is_empty() {
        kept = toks.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    }
    let mut title = kept.join("_");
    // 띄어 쓰거나 `-` 로 이은 이름의 꼬리 상태어: `보고서 최종` · `report-final` · `Report FINAL`
    loop {
        let cut = title.rfind([' ', '-']);
        let Some(i) = cut.filter(|&i| i > 0) else { break };
        let last = title[i + 1..].trim();
        if last.is_empty() || !is_strong_status(last) {
            break;
        }
        issues.push(status_issue(last));
        title.truncate(i);
        title = title.trim_end().to_string();
    }
    let key = title.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");

    if name.contains('—') || name.contains('–') {
        issues.push(ISSUE_DASH.into());
    }
    if toks.iter().any(|t| t.len() == 6 && as_date(t).is_some()) || lead_six(name) {
        issues.push(ISSUE_SIX_DIGIT_DATE.into());
    }

    let author = authors.join("_");
    DocName { key, title, version, date, time, ext, author, issues }
}

/// 마지막 조각 근처의 한글 세 글자는 작성자 이름으로 본다 (`…(안)_여채린_260911`).
/// 문서명 조각이 세 글자일 수도 있어(「회의록」) 흔한 문서 낱말은 뺀다.
/// 2026.11.11 : 첫 글자가 흔한 성씨일 때만 — 「위험성」 「대피소」 「표준화」 같은 제목 낱말이 사람으로 읽혔다.
///              드문 성씨(위 · 표 · 대 …)를 쓰는 사람의 꼬리는 키에 남는다 — 남으면 판이 따로 보일 뿐, 남의 문서를 옮기지는 않는다.
fn looks_like_person(t: &str) -> bool {
    const NOT_PEOPLE: &[&str] = &["회의록", "발표본", "계획서", "결과서", "보고서", "정의서", "설명서", "안내서", "요청서", "검토표", "체크리스트", "매뉴얼", "기준표", "현황표"];
    const SURNAMES: &str = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연";
    let chars: Vec<char> = t.chars().collect();
    chars.len() == 3 && chars.iter().all(|c| ('가'..='힣').contains(c)) && SURNAMES.contains(chars[0]) && !NOT_PEOPLE.contains(&t)
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
        // 날짜 · 판이 없는 것은 폴더 관례와 견줄 일이라 여기서 알리지 않는다 (`convention`).
        assert!(b.issues.is_empty(), "{:?}", b.issues);
    }

    #[test]
    fn copy_marks_from_many_sources() {
        let base = p("Quarterly Report.docx").key;
        for n in [
            "Quarterly Report (1).docx",
            "Quarterly Report - Copy.docx",
            "Quarterly Report - 복사본 (2).docx",
            "Quarterly Report copy.docx",
            "Quarterly Report copy 2.docx",
            "Copy of Quarterly Report.docx",
            "Copy of Quarterly Report (1).docx",
            "Quarterly Report의 사본.docx",
            "Quarterly Report (Hong's conflicted copy 2026-11-11).docx",
        ] {
            let d = p(n);
            assert_eq!(d.key, base, "{n}");
            assert!(d.issues.contains(&ISSUE_COPY.to_string()), "{n}");
        }
    }

    #[test]
    fn status_words_in_many_languages_and_separators() {
        let base = p("budget_2027.xlsx").key;
        assert_eq!(p("budget_2027_FINAL.xlsx").key, base);
        assert_eq!(p("budget_2027_final_final.xlsx").key, base);
        assert_eq!(p("budget_2027-draft.xlsx").key, base);
        assert_eq!(p("budget_2027 최종.xlsx").key, base);
        // 제목 머리의 같은 낱말은 남긴다.
        assert_eq!(p("Final_Exam_Schedule.pdf").key, "final_exam_schedule");
    }

    #[test]
    fn version_and_date_shapes() {
        let a = p("회의록 v3.docx");
        let b = p("회의록 rev 4.docx");
        let c = p("회의록_ver.5_2026-11-11.docx");
        let d = p("회의록_제6판.docx");
        let e = p("report-v2.docx");
        assert_eq!((a.key.as_str(), a.version.as_slice()), ("회의록", &[3u32][..]));
        assert_eq!((b.key.as_str(), b.version.as_slice()), ("회의록", &[4u32][..]));
        assert_eq!((c.key.as_str(), c.version.as_slice(), c.date.as_str()), ("회의록", &[5u32][..], "20261111"));
        assert_eq!((d.key.as_str(), d.version.as_slice()), ("회의록", &[6u32][..]));
        assert_eq!((e.key.as_str(), e.version.as_slice()), ("report", &[2u32][..]));
        // 띄어 쓴 날짜는 판이 함께 있을 때만 키에서 뗀다.
        let f = p("2026-11-11 회의록 v2.docx");
        let g = p("회의록 v3 2026-11-12.docx");
        assert_eq!((f.key.as_str(), f.date.as_str()), ("회의록", "20261111"));
        assert_eq!((g.key.as_str(), g.date.as_str()), ("회의록", "20261112"));
    }

    #[test]
    fn review_merges_stay_apart() {
        // 2026.11.11 리뷰에서 잡힌 「다른 문서가 한 문서로 묶임」.
        // 날짜만 다른 띄어 쓴 이름은 그날그날 다른 문서다.
        let a = p("2026-11-03 회의록.docx");
        assert_ne!(a.key, p("2026-11-10 회의록.docx").key);
        assert_eq!(a.date, "20261103");
        assert_ne!(p("회의록 2026-11-03.docx").key, p("회의록 2026-11-10.docx").key);
        // 띄어 쓴 이름의 「검토」 「취합」은 제목이다.
        assert_ne!(p("산림재난 위험성 검토.pdf").key, p("산림재난 위험성.pdf").key);
        assert_ne!(p("Server backup.docx").key, p("Server.docx").key);
        // 판 · 날짜 없는 이름의 세 글자 · 흔한 성씨가 아닌 세 글자는 작성자가 아니다.
        assert_ne!(p("산림재난_위험성.hwpx").key, p("산림재난_대피소.hwpx").key);
        assert_ne!(p("산림재난_위험성_v1.hwpx").key, p("산림재난_대피소_v1.hwpx").key);
        assert_ne!(p("결과보고_김민수.hwpx").key, p("결과보고_박지훈.hwpx").key);
        // `_` 로 이은 판 · 날짜 없는 이름의 약한 상태어도 제목이다.
        assert_ne!(p("산림재난_위험성_검토.pdf").key, p("산림재난_위험성.pdf").key);
        assert_ne!(p("Shark_fin.jpg").key, p("Shark.jpg").key);
        // 띄어 쓴 `제N판` 도 판이다 — 새 판 내기가 짓는 이름과 묶인다.
        let a = p("사업계획 제3판.hwpx");
        assert_eq!((a.key.as_str(), a.version.as_slice()), ("사업계획", &[3u32][..]));
        assert_eq!(p("사업계획 제4판.hwpx").key, a.key);
    }

    #[test]
    fn numbers_that_are_not_editions_stay_apart() {
        // 다른 문서를 한 문서로 묶으면 지난 판 옮기기가 남의 문서를 옮긴다 — 애매하면 나눈다.
        assert_ne!(p("1차_회의록.hwpx").key, p("2차_회의록.hwpx").key);
        assert_ne!(p("회의록_1차.hwpx").key, p("회의록_2차.hwpx").key);
        assert_ne!(p("IMG_1234.jpg").key, p("IMG_1235.jpg").key);
        assert_ne!(p("ISO9001 점검표.xlsx").key, p("ISO14001 점검표.xlsx").key);
        assert!(p("iPhone15 견적.pdf").version.is_empty());
        assert!(p("devops overview.pdf").version.is_empty());
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
        assert!(a.issues.contains(&ISSUE_COPY.to_string()));
        assert!(a.issues.contains(&ISSUE_SIX_DIGIT_DATE.to_string()));

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
    fn title_words_in_the_middle_stay() {
        // 실제 산출물 폴더에서 잘못 떼던 이름 (2026-11-11).
        let a = p("(260115)보도자료-산림인접건축_산림재난_위험성_검토_제도_도입.pdf");
        assert_eq!(a.key, "보도자료-산림인접건축_산림재난_위험성_검토_제도_도입");
        assert_eq!(a.date, "20260115");
        assert!(a.issues.contains(&ISSUE_SIX_DIGIT_DATE.to_string()));
        assert_eq!(p("내부망_외부망_Apache_구조.md").key, "내부망_외부망_apache_구조");
        assert_eq!(p("산림인접건축_표준화_연계구조_설계서_초안_20260715.docx").key, "산림인접건축_표준화_연계구조_설계서_초안");
        // 제목 낱말이 다르면 다른 문서다.
        assert_ne!(p("대피소_확인_경로_v20.json").key, p("산사태_확인_경로_v20.json").key);
        // 꼬리의 작성자 · 상태어는 여전히 뗀다 (작성자 뒤 상태어도).
        assert_eq!(p("결과보고_홍길동_최종_20261010.hwpx").key, "결과보고");
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
