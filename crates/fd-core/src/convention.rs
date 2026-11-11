//! 관례 읽기 · 이름 제안 — 폴더가 이미 쓰는 이름 꼴을 읽고, 그 꼴로 이름을 권한다 (DESIGN [6] · [7]).
//!
//! 규칙을 밖에서 들이지 않는다. 한 회사의 규격(`<문서명>_v<판>_<YYYYMMDD>`)을 정답으로 두지 않고, 사용자 폴더가 쓰는 꼴을 정답으로 본다.
//! 그래서 어느 조직 · 어느 사람의 폴더에서도 같은 코드가 돈다.
//!
//! 목차
//!   [1] 꼴(Shape) — 이름 하나를 「머리(순번 · 연도 · 날짜) + 제목 + 꼬리(판 · 날짜)」와 구분자로 읽는다
//!   [2] 관례(Convention) — 폴더 자식 이름들의 가장 흔한 꼴. 3개 이상 · 60% 이상일 때만. 모자라면 형제 폴더 → 부모 순으로 빌린다
//!   [3] 이름 제안 — 이 폴더 꼴(없으면 그 이름 자신의 꼴)로 다시 짓는다. 복사 표시 · 상태어를 떼고, 판 · 날짜 · 순번을 채운다
//!   [4] 새 폴더 이름 · 꼴과 다른 이름 목록
//!
//! 제목은 바꾸지 않는다 — 내용을 모르니 틀린다. 떼는 것은 어느 꼴에서도 판을 가리지 못하는 것(복사 표시 · 상태어)뿐이다.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::docname::{is_status, is_strong_status, parse, re, split_name, strip_copy_marks, valid_ymd, ver_re};
use crate::edition::bump;
use crate::docs::is_history_name;

/// 관례로 인정하는 최소 이름 수 · 비율. 2026.11.11 : 3개 · 60%. 억지 제안이 잔소리가 되는 것이 가장 나쁘다 — 모자라면 아무것도 권하지 않는다.
const MIN_FOLLOW: usize = 3;
const MIN_SHARE: f32 = 0.6;

// ───────────────────────────── [1] 꼴 ─────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DateForm {
    /// `20261111`
    Ymd8,
    /// `261111`
    Ymd6,
    /// `2026-11-11`
    Dash,
    /// `2026.11.11`
    Dot,
}

impl DateForm {
    fn write(self, ymd: &str) -> String {
        let (y, m, d) = (&ymd[..4], &ymd[4..6], &ymd[6..8]);
        match self {
            DateForm::Ymd8 => ymd.to_string(),
            DateForm::Ymd6 => format!("{}{m}{d}", &y[2..]),
            DateForm::Dash => format!("{y}-{m}-{d}"),
            DateForm::Dot => format!("{y}.{m}.{d}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Lead {
    None,
    /// 앞 순번 `01_` · `3. ` — 자릿수.
    Seq { width: u8 },
    /// 앞 연도 `2026` · `2026_사업`
    Year,
    /// 앞 날짜 `20261111_` · `2026-11-11 `
    Date { form: DateForm },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Tail {
    /// 판 — 머리말 그대로(`v` · `V` · `ver` · `rev`). `제N판` 은 `제판`.
    Version { prefix: String },
    Date { form: DateForm },
}

/// 이름 하나의 꼴.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    pub lead: Lead,
    pub tail: Vec<Tail>,
    /// 꼬리(판 · 날짜) 쪽 구분자. 제목만 있는 이름은 없다.
    pub sep: Option<char>,
    /// 머리(순번 · 연도 · 날짜) 뒤 구분자 — 꼬리 쪽과 다를 수 있다 (`2026-11-01 회의록_v1`).
    pub lead_sep: Option<char>,
}

impl Shape {
    /// 사람이 읽는 견본 — `01_제목` · `제목_v3_20261111`.
    pub fn example(&self) -> String {
        let sep = self.sep.unwrap_or('_').to_string();
        let head = match &self.lead {
            Lead::None => String::new(),
            Lead::Seq { width } => format!("{:0w$}", 1, w = *width as usize),
            Lead::Year => "2026".into(),
            Lead::Date { form } => form.write("20261111"),
        };
        let mut parts: Vec<String> = vec!["제목".into()];
        for t in &self.tail {
            parts.push(match t {
                Tail::Version { prefix } if prefix == "제판" => "제3판".into(),
                Tail::Version { prefix } => format!("{prefix}3"),
                Tail::Date { form } => form.write("20261111"),
            });
        }
        let body = parts.join(&sep);
        if head.is_empty() { body } else { format!("{head}{}{body}", self.lead_sep.or(self.sep).unwrap_or('_')) }
    }
}

static RE_LEAD_DATE: OnceLock<Regex> = OnceLock::new();
static RE_LEAD_YEAR: OnceLock<Regex> = OnceLock::new();
static RE_LEAD_SEQ: OnceLock<Regex> = OnceLock::new();
static RE_VER_KO: OnceLock<Regex> = OnceLock::new();
static RE_DATE: OnceLock<Regex> = OnceLock::new();

/// `20261111` · `261111` · `2026-11-11` · `2026.11.11` → (꼴, `YYYYMMDD`)
fn read_date(tok: &str) -> Option<(DateForm, String)> {
    let digits: String = tok.chars().filter(|c| c.is_ascii_digit()).collect();
    let form = if tok.contains('-') {
        DateForm::Dash
    } else if tok.contains('.') {
        DateForm::Dot
    } else if tok.len() == 6 {
        DateForm::Ymd6
    } else {
        DateForm::Ymd8
    };
    let ymd = match digits.len() {
        8 => digits,
        6 if form == DateForm::Ymd6 => format!("20{digits}"),
        _ => return None,
    };
    let (y, m, d) = (ymd[..4].parse().ok()?, ymd[4..6].parse().ok()?, ymd[6..].parse().ok()?);
    valid_ymd(y, m, d).then_some((form, ymd))
}

fn is_sep(c: char) -> bool {
    matches!(c, '_' | ' ' | '-')
}

/// 이름을 읽은 결과 — 꼴과, 다시 지을 때 쓸 값 · 자리(원래 이름 안의 바이트 자리).
#[derive(Debug, Clone)]
struct Read {
    shape: Shape,
    title: String,
    seq: Option<u32>,
    year: Option<u32>,
    date: Option<String>,
    version: Option<String>,
    /// 판 조각 전체(`v3`)와 숫자(`3`)의 자리.
    ver_span: Option<((usize, usize), (usize, usize))>,
    /// 날짜 조각의 자리와 꼴 (머리 날짜 포함).
    date_span: Option<(usize, usize, DateForm)>,
    /// 꼬리(판 · 날짜) 앞의 구분자.
    tail_sep: Option<char>,
}

/// 이름(확장자 뺀 것) 하나를 읽는다. 구분자는 머리 · 꼬리 곁의 것만 센다 — 제목 속 띄어쓰기는 꼴이 아니다
/// (2026.11.11 : 제목 속 공백을 구분자로 셌더니 `00 공문_…_20260703` 폴더가 「제목 20261111」 꼴로 읽혔다).
fn read(stem: &str) -> Read {
    // 다듬지 않는다 — 여기서 잰 자리(바이트)를 suggest 가 다듬지 않은 이름에 그대로 쓴다.
    // 2026.11.11 리뷰 : 앞 공백이 있는 이름(` 2026.11.10 회의록`)에서 자리가 밀려 이름이 깨지거나, 한글 가운데를 잘라 멈췄다.
    let full = stem;
    let mut lead = Lead::None;
    let (mut seq, mut year, mut date) = (None, None, None);
    let mut lead_sep: Option<char> = None;
    let mut offset = 0usize;
    let mut date_span = None;

    // 머리 — 날짜 · 연도 · 순번 순서로 본다 (`2026` 은 순번이 아니라 연도, `20261111` 은 연도가 아니라 날짜).
    let ld = re(&RE_LEAD_DATE, r"^(\d{4}[-.]\d{2}[-.]\d{2}|\d{8}|\d{6})([_\s-]+|$)");
    let ly = re(&RE_LEAD_YEAR, r"^((?:19|20)\d{2})([_\s-]+|$)");
    let ls = re(&RE_LEAD_SEQ, r"^(\d{1,3})(\.?[_\s-]+|\.\s*|$)");
    if let Some(c) = ld.captures(full).filter(|c| read_date(&c[1]).is_some()) {
        let (form, ymd) = read_date(&c[1]).unwrap();
        lead = Lead::Date { form };
        date = Some(ymd);
        date_span = Some((0, c.get(1).unwrap().end(), form));
        lead_sep = c[2].chars().next().filter(|c| is_sep(*c));
        offset = c.get(0).unwrap().end();
    } else if let Some(c) = ly.captures(full) {
        lead = Lead::Year;
        year = c[1].parse().ok();
        lead_sep = c[2].chars().next().filter(|c| is_sep(*c));
        offset = c.get(0).unwrap().end();
    } else if let Some(c) = ls.captures(full) {
        lead = Lead::Seq { width: c[1].len() as u8 };
        seq = c[1].parse().ok();
        lead_sep = c[2].chars().find(|c| is_sep(*c));
        offset = c.get(0).unwrap().end();
    }
    let rest0 = &full[offset..];

    // 꼬리 — 판 · 날짜를 찾아 자리 순서대로. 판은 낱말 속 v(`dev2`)가 아닐 때만.
    let mut found: Vec<(usize, usize, Tail, String)> = Vec::new();
    let mut ver_span = None;
    for c in ver_re().captures_iter(rest0) {
        let all = c.get(0).unwrap();
        let before = rest0[..all.start()].chars().next_back();
        let after = rest0[all.end()..].chars().next();
        if before.is_none_or(|c| !c.is_ascii_alphanumeric()) && after.is_none_or(|c| !c.is_ascii_alphanumeric()) {
            let n = c.get(1).unwrap();
            let prefix = rest0[all.start()..n.start()].to_string();
            ver_span = Some(((all.start() + offset, all.end() + offset), (n.start() + offset, n.end() + offset)));
            found.push((all.start(), all.end(), Tail::Version { prefix }, c[1].to_string()));
            break;
        }
    }
    if found.is_empty() {
        if let Some(c) = re(&RE_VER_KO, r"제?(\d+)판").captures(rest0) {
            let (all, n) = (c.get(0).unwrap(), c.get(1).unwrap());
            ver_span = Some(((all.start() + offset, all.end() + offset), (n.start() + offset, n.end() + offset)));
            found.push((all.start(), all.end(), Tail::Version { prefix: "제판".into() }, c[1].to_string()));
        }
    }
    let d = re(&RE_DATE, r"\d{4}[-.]\d{2}[-.]\d{2}|\d{8}|\d{6}");
    for m in d.find_iter(rest0) {
        let before = rest0[..m.start()].chars().next_back();
        let after = rest0[m.end()..].chars().next();
        if before.is_some_and(|c| c.is_ascii_digit()) || after.is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        // 판 조각 안의 숫자(`v1.20261111`)는 날짜로 보지 않는다 — 겹친 자리를 지우면 이름이 깨진다.
        if found.iter().any(|f| m.start() < f.1 && f.0 < m.end()) {
            continue;
        }
        if let Some((form, ymd)) = read_date(m.as_str()) {
            if date_span.is_none() {
                date_span = Some((m.start() + offset, m.end() + offset, form));
            }
            found.push((m.start(), m.end(), Tail::Date { form }, ymd));
            break;
        }
    }
    found.sort_by_key(|f| f.0);
    let tail_sep = found.first().and_then(|f| rest0[..f.0].chars().next_back()).filter(|c| is_sep(*c));
    let mut version = None;
    let mut rest = rest0.to_string();
    // 뒤에서부터 지워야 앞 자리가 밀리지 않는다.
    for (s, e, t, val) in found.iter().rev() {
        rest.replace_range(*s..*e, "\u{1}");
        match t {
            Tail::Version { .. } => version = Some(val.clone()),
            Tail::Date { .. } => {
                if date.is_none() {
                    date = Some(val.clone())
                }
            }
        }
    }
    let tail: Vec<Tail> = found.iter().map(|f| f.2.clone()).collect();
    let sep = lead_sep.or(tail_sep);
    // 판 · 날짜를 뺀 자리를 지우고 남은 구분자를 정리한다.
    let cleaned: String = rest
        .split('\u{1}')
        .map(|p| p.trim_matches(is_sep))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(&sep.unwrap_or('_').to_string());

    // 제목에서 복사 표시 · 상태어는 이름 읽기(`docname`)와 같은 판단으로 뗀다.
    // 제목이 비면(`2026` 같은 폴더) 이름 읽기에 넘기지 않는다 — `.x` 만 남아 그것을 제목으로 읽었다.
    let title = if cleaned.is_empty() {
        String::new()
    } else {
        let p = parse(&format!("{cleaned}.x"));
        if p.title.is_empty() { cleaned.clone() } else { p.title }
    };
    Read { shape: Shape { lead, tail, sep, lead_sep }, title, seq, year, date, version, ver_span, date_span, tail_sep }
}

fn split_ext(name: &str, is_dir: bool) -> (&str, &str) {
    if is_dir { (name, "") } else { split_name(name) }
}

// ───────────────────────────── [2] 관례 ─────────────────────────────

/// 이름 무리에서 읽은 꼴.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamePattern {
    pub shape: Shape,
    /// `01_제목` 같은 견본.
    pub example: String,
    pub follow: usize,
    pub total: usize,
    /// 근거 이름 셋.
    pub sample: Vec<String>,
}

/// 관례를 어디서 읽었나.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub pattern: NamePattern,
    /// `here` (이 폴더) · `siblings` (형제 폴더들) · `parent` (부모 폴더)
    pub from: &'static str,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Convention {
    pub files: Option<Found>,
    pub folders: Option<Found>,
}

/// 이름들(파일은 확장자 포함)의 관례. 모자라면 없다.
/// 조각마다 따로 센다 — 머리(순번 · 연도 · 날짜) · 판 · 꼬리 날짜 · 구분자가 저마다 60% 넘게 쓰일 때만 관례에 넣는다.
/// 2026.11.11 : 처음엔 이름 전체 꼴이 같은 것만 셌는데, 실제 폴더는 판만 빠진 이름 · 날짜만 빠진 이름이 섞여 거의 어느 폴더도 넘지 못했다.
pub fn pattern_of(names: &[String], is_dir: bool) -> Option<NamePattern> {
    let total = names.len();
    if total < MIN_FOLLOW {
        return None;
    }
    let reads: Vec<Read> = names.iter().map(|n| read(split_ext(n, is_dir).0)).collect();
    let enough = |k: usize| k >= MIN_FOLLOW && k as f32 >= MIN_SHARE * total as f32;
    fn top<K: std::hash::Hash + Eq + Clone>(it: impl Iterator<Item = K>) -> Option<(K, usize)> {
        let mut c: HashMap<K, usize> = HashMap::new();
        let mut order: Vec<K> = Vec::new();
        for k in it {
            let e = c.entry(k.clone()).or_insert(0);
            if *e == 0 {
                order.push(k);
            }
            *e += 1;
        }
        // 같은 수면 먼저 나온 것 — 매번 같은 답이 나와야 한다.
        order.into_iter().map(|k| (c[&k], k)).fold(None, |best: Option<(K, usize)>, (n, k)| match best {
            Some((_, b)) if b >= n => best,
            _ => Some((k, n)),
        })
    }
    let lead = top(reads.iter().map(|r| r.shape.lead.clone())).filter(|(_, n)| enough(*n)).map(|(l, _)| l).unwrap_or(Lead::None);
    let vers: Vec<&String> = reads.iter().flat_map(|r| r.shape.tail.iter()).filter_map(|t| if let Tail::Version { prefix } = t { Some(prefix) } else { None }).collect();
    let ver = if enough(vers.len()) { top(vers.iter().map(|p| p.to_string())).map(|(p, _)| p) } else { None };
    let dates: Vec<DateForm> = reads.iter().flat_map(|r| r.shape.tail.iter()).filter_map(|t| if let Tail::Date { form } = t { Some(*form) } else { None }).collect();
    let date = if enough(dates.len()) && !matches!(lead, Lead::Date { .. }) { top(dates.into_iter()).map(|(f, _)| f) } else { None };
    let mut tail = Vec::new();
    match (ver, date) {
        (Some(p), Some(f)) => {
            // 판 · 날짜 차례는 둘 다 가진 이름들의 다수결.
            let date_first = reads.iter().filter(|r| r.shape.tail.len() == 2).filter(|r| matches!(r.shape.tail[0], Tail::Date { .. })).count();
            let both = reads.iter().filter(|r| r.shape.tail.len() == 2).count();
            if date_first * 2 > both {
                tail = vec![Tail::Date { form: f }, Tail::Version { prefix: p }];
            } else {
                tail = vec![Tail::Version { prefix: p }, Tail::Date { form: f }];
            }
        }
        (Some(p), None) => tail.push(Tail::Version { prefix: p }),
        (None, Some(f)) => tail.push(Tail::Date { form: f }),
        (None, None) => {}
    }
    // 「제목만」은 관례가 아니다 — 꼴이 정해지지 않은 폴더다. 이것을 관례로 보면 다른 이름의 판 · 날짜를 떼자고 한다 (11-11 다운로드 폴더에서 잡혔다).
    if lead == Lead::None && tail.is_empty() {
        return None;
    }
    // 구분자는 관례에 든 조각 곁의 것으로 센다 — 관례에 없는 앞 순번(`00 공문`)의 공백이 꼬리 구분자(`_20260703`)를 이기지 않게.
    let sep = if tail.is_empty() {
        top(reads.iter().filter_map(|r| r.shape.sep)).map(|(c, _)| c)
    } else {
        top(reads.iter().filter_map(|r| r.tail_sep)).map(|(c, _)| c)
    };
    let lead_sep = if lead == Lead::None {
        None
    } else {
        top(reads.iter().filter(|r| std::mem::discriminant(&r.shape.lead) == std::mem::discriminant(&lead)).filter_map(|r| r.shape.lead_sep)).map(|(c, _)| c)
    };
    let shape = Shape { lead, tail, sep, lead_sep };
    // 따르는 이름 = 관례의 조각을 다 가진 이름 (관례에 없는 조각 · 다른 구분자가 더 있어도 따른 것으로 센다 — 제안이 빼지 않으니까).
    let has_all = |r: &Read| {
        let lead_ok = shape.lead == Lead::None || std::mem::discriminant(&r.shape.lead) == std::mem::discriminant(&shape.lead);
        let ver_ok = !shape.tail.iter().any(|t| matches!(t, Tail::Version { .. })) || r.version.is_some();
        let date_ok = !shape.tail.iter().any(|t| matches!(t, Tail::Date { .. })) || r.date.is_some();
        lead_ok && ver_ok && date_ok
    };
    let who: Vec<&String> = names.iter().zip(&reads).filter(|(_, r)| has_all(r)).map(|(n, _)| n).collect();
    Some(NamePattern { example: shape.example(), follow: who.len(), total, sample: who.iter().take(3).map(|s| s.to_string()).collect(), shape })
}

/// 관례에 넣는 이름인가 — 숨김 · 오피스 잠금 · 바로가기 · 지난 판 폴더는 뺀다.
fn counts(name: &str) -> bool {
    !(name.starts_with('.') || name.starts_with("~$") || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db") || name.to_lowercase().ends_with(".lnk"))
}

/// 관례를 읽을 파일 이름 — 이 폴더와 그 지난 판 폴더. 지난 판도 같은 꼴로 지었으니 표본이 된다.
fn sample_files(dir: &Path) -> Vec<String> {
    let (mut files, _) = children(dir);
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir()) && is_history_name(&e.file_name().to_string_lossy())) {
            files.extend(children(&e.path()).0);
        }
    }
    files
}

/// (파일 이름들, 폴더 이름들)
fn children(dir: &Path) -> (Vec<String>, Vec<String>) {
    let (mut files, mut dirs) = (Vec::new(), Vec::new());
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if !counts(&n) {
                continue;
            }
            match e.file_type() {
                Ok(t) if t.is_dir() => {
                    if !is_history_name(&n) {
                        dirs.push(n)
                    }
                }
                Ok(_) => files.push(n),
                Err(_) => {}
            }
        }
    }
    (files, dirs)
}

/// 폴더 `dir` 의 관례. 파일 꼴은 이 폴더 → 형제 폴더들 → 부모 순으로, 하위 폴더 꼴은 이 폴더 → 사촌(형제 폴더들의 하위 폴더) 순으로 빌린다.
pub fn convention_of(dir: &Path) -> Convention {
    let (_, dirs) = children(dir);
    let files = sample_files(dir);
    let parent = dir.parent().filter(|p| p != &dir);
    let siblings: Vec<std::path::PathBuf> = parent
        .map(|p| children(p).1.into_iter().map(|n| p.join(n)).filter(|s| s != dir).collect())
        .unwrap_or_default();

    let files_found = if files.len() >= MIN_FOLLOW {
        pattern_of(&files, false).map(|pattern| Found { pattern, from: "here" })
    } else {
        let sib: Vec<String> = siblings.iter().flat_map(|s| sample_files(s)).collect();
        pattern_of(&sib, false)
            .map(|pattern| Found { pattern, from: "siblings" })
            .or_else(|| parent.and_then(|p| pattern_of(&children(p).0, false)).map(|pattern| Found { pattern, from: "parent" }))
    };
    let folders_found = if dirs.len() >= MIN_FOLLOW {
        pattern_of(&dirs, true).map(|pattern| Found { pattern, from: "here" })
    } else {
        let cousins: Vec<String> = siblings.iter().flat_map(|s| children(s).1).collect();
        pattern_of(&cousins, true).map(|pattern| Found { pattern, from: "siblings" })
    };
    Convention { files: files_found, folders: folders_found }
}

// ───────────────────────────── [3] 이름 제안 ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub name: String,
    /// 무엇을 왜 바꿨나 (사람이 읽는 말). 비면 바꿀 것이 없다.
    pub changes: Vec<String>,
    /// 따른 꼴의 견본. 폴더 관례가 없으면 이 이름 자신의 꼴이다.
    pub follows: String,
    /// 폴더 관례를 따랐나 (아니면 그 이름 자신의 꼴로 정리만).
    pub by_convention: bool,
}

/// 이름 제안의 맥락.
pub struct Ask<'a> {
    /// 이름이 놓일 폴더 (옮길 곳 · 지금 자리).
    pub dir: &'a Path,
    pub name: &'a str,
    pub is_dir: bool,
    /// 날짜 칸을 새로 채울 때 쓸 날 (`YYYYMMDD`) — 보통 파일의 수정 날, 받은 파일이면 오늘.
    pub date_hint: &'a str,
    /// 그 폴더의 지금 이름 (같은 문서의 판 · 다음 순번을 셀 때). 이 이름 자신은 빼고 준다.
    pub existing: &'a [String],
    /// 다른 자리에서 들여오는가. 그렇다면 같은 판이 이미 있을 때 다음 판으로 올린다 (제자리 이름 고치기에서는 있는 판을 건드리지 않는다).
    pub filing: bool,
}

fn ver_key(v: &str) -> Vec<u64> {
    v.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// 꼬리에 오는 판 · 날짜 · 시각 · 번호 낱말인가 (`v3` · `20261111` · `1530` · `(2)`).
fn tailish(w: &str) -> bool {
    let w = w.trim_matches(|c| c == '(' || c == ')');
    !w.is_empty() && (w.chars().all(|c| c.is_ascii_digit() || c == '.' || c == '-') || ver_re().find(w).is_some_and(|m| m.start() == 0 && m.end() == w.len()))
}

/// 관례 없이 정리만 — 복사 표시와, 꼬리 쪽(뒤에 판 · 날짜 · 숫자 · 다른 상태어만 남은 자리)의 상태어를 뗀다. 나머지 글자는 한 자도 건드리지 않는다.
/// 2026.11.11 : 처음엔 이름 자신의 꼴로 다시 지었는데, 받은 파일의 복잡한 이름(괄호 메모 · 띄어 쓴 판)이 다시 짓기에서 뭉개졌다.
fn tidy_only(stem: &str) -> (String, Vec<String>) {
    let (mut s, copy) = strip_copy_marks(stem);
    let mut changes = Vec::new();
    if copy {
        changes.push("복사본 표시 뗌".to_string());
    }
    // 낱말 경계(_ · 공백 · -)로 나눠 뒤에서부터 본다. 제목 낱말을 만나면 멈춘다 (`위험성_검토_제도` 의 「검토」는 제목이다).
    let mut cuts: Vec<(usize, usize)> = Vec::new();
    let seps: Vec<usize> = s.char_indices().filter(|(_, c)| is_sep(*c)).map(|(i, _)| i).collect();
    let mut end = s.len();
    for &at in seps.iter().rev() {
        let word = &s[at + 1..end];
        // `_` 로 이은 꼬리는 상태어 전부, 띄어 쓰거나 `-` 로 이은 꼬리는 제목 낱말일 수 없는 것만 (docname 과 같은 판단).
        let status = if s[at..].starts_with('_') { is_status(word) } else { is_strong_status(word) };
        if status {
            cuts.push((at, end));
            changes.push(format!("상태 말 「{word}」 뗌"));
        } else if !tailish(word) {
            break;
        }
        end = at;
    }
    for (a, b) in cuts {
        s.replace_range(a..b, "");
    }
    (s, changes)
}

/// 이 폴더 꼴로 이름을 고친다. **더하고 고치기만 하고 빼지 않는다** — 이름에 이미 있는 순번 · 판 · 날짜 · 괄호 메모 · 제목 글자는 그대로 두고,
/// 관례에 있는데 빠진 조각(순번 · 판 · 날짜)을 더하고, 날짜 꼴만 관례 꼴로 바꾼다. 뗄 수 있는 것은 복사 표시 · 상태어뿐 (`tidy_only`).
/// 2026.11.11 : 처음엔 관례 꼴로 이름을 새로 지었는데, 관례에 없는 조각(판 `v1` · 앞 순번 `00 `)을 지웠다 — 실제 보고 폴더에서 잡혔다.
/// 다른 이름에서 미리 읽어 둘 것 — 같은 문서의 판 · 다음 순번을 셀 때 쓴다.
/// 2026.11.11 리뷰 : `deviations` 가 이름마다 다른 이름 전부를 다시 읽어(이름 수의 제곱) 큰 폴더에서 몇 분 걸렸다 — 한 번 읽고 같이 쓴다.
#[derive(Debug, Clone)]
struct Known {
    key: String,
    version: Option<String>,
    seq: Option<u32>,
}

fn known_of(name: &str, is_dir: bool) -> Known {
    let r = read(split_ext(name, is_dir).0);
    Known { key: parse(name).key, version: r.version, seq: r.seq }
}

/// 이 폴더 꼴로 이름을 고친다 — `ask.existing` 을 읽어 `suggest_known` 으로.
pub fn suggest(ask: &Ask, conv: &Convention) -> Suggestion {
    let known: Vec<Known> = ask.existing.iter().map(|n| known_of(n, ask.is_dir)).collect();
    suggest_known(ask, conv, &known, None)
}

/// `known` 은 그 폴더 이름들을 미리 읽은 것, `skip` 은 그중 이 이름 자신의 자리.
fn suggest_known(ask: &Ask, conv: &Convention, known: &[Known], skip: Option<usize>) -> Suggestion {
    let others = || known.iter().enumerate().filter(move |(i, _)| Some(*i) != skip).map(|(_, k)| k);
    let (stem, ext) = split_ext(ask.name, ask.is_dir);
    let (base, mut changes) = tidy_only(stem);
    let base = if base.trim().is_empty() { stem.to_string() } else { base };
    let found = if ask.is_dir { conv.folders.as_ref() } else { conv.files.as_ref() };
    let Some(found) = found else {
        let name = format!("{base}{ext}");
        let changes = if name == ask.name { Vec::new() } else { changes };
        return Suggestion { name, changes, follows: String::new(), by_convention: false };
    };
    let shape = &found.pattern.shape;
    let me = read(&base);
    let sep = me.tail_sep.or(shape.sep).unwrap_or('_');
    let lead_sep = shape.lead_sep.or(shape.sep).unwrap_or('_');

    // 같은 문서(키가 같은 이름)의 가장 높은 판 — 판을 새로 붙이거나, 들여올 때 같은 판이 겹치면 다음 판으로.
    let my_key = parse(&format!("{base}{ext}")).key;
    let same_doc_max = others().filter(|k| k.key == my_key).filter_map(|k| k.version.clone()).max_by_key(|v| ver_key(v));
    let next_ver = || same_doc_max.as_deref().map_or("1".to_string(), bump);

    // 원래 이름 안을 고치는 것 (자리, 끝, 새 글자). 뒤에서부터 고친다.
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    let date_form = match &shape.lead {
        Lead::Date { form } => Some(*form),
        _ => shape.tail.iter().find_map(|t| if let Tail::Date { form } = t { Some(*form) } else { None }),
    };
    if let (Some(want), Some((s, e, have)), Some(d)) = (date_form, me.date_span, me.date.as_deref()) {
        if want != have {
            edits.push((s, e, want.write(d)));
            changes.push(format!("날짜 형식 {} → {}", &base[s..e], want.write(d)));
        }
    }
    if let (true, Some((_, (s, e))), Some(v)) = (ask.filing, me.ver_span, me.version.as_deref()) {
        if let Some(m) = same_doc_max.as_deref().filter(|m| ver_key(v) <= ver_key(m)) {
            edits.push((s, e, bump(m)));
            changes.push(format!("판 {} ({m} 다음 · 같은 판이 이미 있다)", bump(m)));
        }
    }

    // 머리 — 이름에 없을 때만 더한다.
    let mut head = String::new();
    match &shape.lead {
        Lead::Seq { width } if me.shape.lead == Lead::None => {
            let next = others().filter_map(|k| k.seq).max().map_or(1, |m| m + 1);
            head = format!("{next:0w$}{lead_sep}", w = *width as usize);
            changes.push(format!("순번 {next:0w$}", w = *width as usize));
        }
        Lead::Year if me.shape.lead == Lead::None => {
            head = format!("{}{lead_sep}", &ask.date_hint[..4]);
            changes.push(format!("연도 {}", &ask.date_hint[..4]));
        }
        Lead::Date { form } if me.date.is_none() && me.shape.lead == Lead::None => {
            head = format!("{}{lead_sep}", form.write(ask.date_hint));
            changes.push(format!("날짜 {}", form.write(ask.date_hint)));
        }
        _ => {}
    }

    // 꼬리 — 관례에 있는데 빠진 판 · 날짜를 관례 차례대로 넣는다. 짝(날짜 · 판)이 이미 있으면 그 앞에.
    let ver_text = |prefix: &str, v: &str| if prefix == "제판" { format!("제{v}판") } else { format!("{prefix}{v}") };
    let want_ver = shape.tail.iter().find_map(|t| if let Tail::Version { prefix } = t { Some(prefix.clone()) } else { None });
    let want_date = shape.tail.iter().find_map(|t| if let Tail::Date { form } = t { Some(*form) } else { None });
    let ver_first = matches!(shape.tail.first(), Some(Tail::Version { .. }));
    let need_ver = want_ver.is_some() && me.ver_span.is_none();
    let need_date = want_date.is_some() && me.date_span.is_none();
    let tail_date_at = me.date_span.filter(|_| !matches!(me.shape.lead, Lead::Date { .. })).map(|(s, _, _)| s);
    let mut pieces: Vec<String> = Vec::new(); // 맨 뒤에 붙일 것, 차례대로
    let ver_piece = need_ver.then(|| {
        let t = ver_text(want_ver.as_deref().unwrap(), &next_ver());
        changes.push(format!("판 {t}"));
        t
    });
    let date_piece = need_date.then(|| {
        let t = want_date.unwrap().write(ask.date_hint);
        changes.push(format!("날짜 {t}"));
        t
    });
    match (ver_piece, date_piece) {
        (Some(v), Some(d)) => {
            if ver_first {
                pieces.extend([v, d]);
            } else {
                pieces.extend([d, v]);
            }
        }
        (Some(v), None) => match tail_date_at {
            // 「판 → 날짜」 꼴인데 날짜가 꼬리에 있으면 그 앞에 넣는다.
            Some(s) if ver_first => edits.push((s, s, format!("{v}{sep}"))),
            _ => pieces.push(v),
        },
        (None, Some(d)) => match me.ver_span {
            // 「날짜 → 판」 꼴인데 판이 이미 있으면 그 앞에 넣는다.
            Some(((s, _), _)) if !ver_first => edits.push((s, s, format!("{d}{sep}"))),
            _ => pieces.push(d),
        },
        (None, None) => {}
    }

    edits.sort_by(|a, b| b.0.cmp(&a.0));
    let mut body = base.clone();
    for (s, e, t) in edits {
        body.replace_range(s..e, &t);
    }
    let tail_add: String = pieces.iter().map(|p| format!("{sep}{p}")).collect();
    let name = format!("{head}{body}{tail_add}{ext}");
    if name == ask.name {
        changes.clear();
    }
    Suggestion { name, changes, follows: shape.example(), by_convention: true }
}

/// 파일 · 폴더 하나의 이름 제안 — `dir` 에 놓일 때. 그 폴더의 관례 · 지금 이름들을 직접 읽는다.
/// 같은 폴더인가 — 대소문자 · 빗금 방향 · 끝 빗금이 달라도 같다 (Windows 경로). 둘 다 있으면 실제 자리로 견준다.
/// 2026.11.11 리뷰 : `C:\Work` 와 `c:\work` 를 다른 폴더로 보아, 제자리 이름 고치기를 「들여오기」로 셈해 판을 올렸다.
pub fn same_dir(a: &Path, b: &Path) -> bool {
    if let (Ok(x), Ok(y)) = (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        return x == y;
    }
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

pub fn suggest_for(path: &Path, dir: &Path, date_hint: &str) -> Suggestion {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let is_dir = path.is_dir();
    let here = path.parent().is_some_and(|p| same_dir(p, dir));
    let (files, dirs) = children(dir);
    let existing: Vec<String> = (if is_dir { dirs } else { files }).into_iter().filter(|n| !(here && n.eq_ignore_ascii_case(&name))).collect();
    let filing = !here;
    suggest(&Ask { dir, name: &name, is_dir, date_hint, existing: &existing, filing }, &convention_of(dir))
}

// ───────────────────────────── [4] 새 폴더 · 꼴과 다른 이름 ─────────────────────────────

/// 새 폴더 이름 — 하위 폴더 관례로 미리 채울 머리 (`05_` · `2027` · `20261111_`). 관례가 없으면 없다.
pub fn new_folder_name(dir: &Path, today: &str) -> Option<String> {
    new_folder_name_in(dir, &convention_of(dir), today)
}

/// 이미 읽은 관례로 — `fd conv` 처럼 관례 · 새 폴더 이름 · 다른 이름을 함께 낼 때 형제 폴더를 여러 번 훑지 않게.
pub fn new_folder_name_in(dir: &Path, conv: &Convention, today: &str) -> Option<String> {
    let f = conv.folders.as_ref()?;
    let sep = f.pattern.shape.lead_sep.or(f.pattern.shape.sep).unwrap_or('_');
    let (_, dirs) = children(dir);
    let reads: Vec<Read> = dirs.iter().map(|n| read(n)).collect();
    match f.pattern.shape.lead {
        Lead::Seq { width } => {
            let next = reads.iter().filter_map(|r| r.seq).max().map_or(1, |m| m + 1);
            Some(format!("{next:0w$}{sep}", w = width as usize))
        }
        Lead::Year => {
            let this: u32 = today[..4].parse().ok()?;
            let have: Vec<u32> = reads.iter().filter_map(|r| r.year).collect();
            let y = if have.contains(&this) { have.iter().max().map_or(this, |m| m + 1) } else { this };
            Some(if reads.iter().any(|r| r.title.is_empty() || r.title.chars().all(|c| c.is_ascii_digit())) { y.to_string() } else { format!("{y}{sep}") })
        }
        Lead::Date { form } => Some(format!("{}{sep}", form.write(today))),
        Lead::None => None,
    }
}

/// 이 폴더 관례와 다른 이름 — (지금 이름, 제안). 관례를 이 폴더에서 읽었을 때만 (빌려 온 관례로 남의 폴더를 고치자고 하지 않는다).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deviation {
    pub path: String,
    pub name: String,
    pub suggestion: Suggestion,
}

pub fn deviations(dir: &Path, date_of: impl Fn(&Path) -> String) -> Vec<Deviation> {
    deviations_in(dir, &convention_of(dir), date_of)
}

/// 이미 읽은 관례로. 제안한 이름을 차례로 「있는 이름」에 넣어 가며 센다 — 순번 없는 파일 여럿이 모두 같은 다음 번호(`04_`)를 받지 않게.
pub fn deviations_in(dir: &Path, conv: &Convention, date_of: impl Fn(&Path) -> String) -> Vec<Deviation> {
    let (files, dirs) = children(dir);
    let mut out = Vec::new();
    for (names, is_dir, found) in [(&files, false, &conv.files), (&dirs, true, &conv.folders)] {
        if !found.as_ref().is_some_and(|f| f.from == "here") {
            continue;
        }
        let mut known: Vec<Known> = names.iter().map(|n| known_of(n, is_dir)).collect();
        for (i, n) in names.iter().enumerate() {
            let path = dir.join(n);
            let hint = date_of(&path);
            let s = suggest_known(&Ask { dir, name: n, is_dir, date_hint: &hint, existing: &[], filing: false }, conv, &known, Some(i));
            if s.name != *n {
                known[i] = known_of(&s.name, is_dir);
                out.push(Deviation { path: path.to_string_lossy().into_owned(), name: n.clone(), suggestion: s });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn conv_of(files: &[&str]) -> Convention {
        Convention { files: pattern_of(&names(files), false).map(|pattern| Found { pattern, from: "here" }), folders: None }
    }

    fn sug(files: &[&str], name: &str, hint: &str) -> Suggestion {
        let c = conv_of(files);
        let ex = names(files);
        suggest(&Ask { dir: Path::new("."), name, is_dir: false, date_hint: hint, existing: &ex, filing: true }, &c)
    }

    #[test]
    fn reads_shapes() {
        assert_eq!(read("01_회의록").shape.lead, Lead::Seq { width: 2 });
        assert_eq!(read("3. 회의록").shape.lead, Lead::Seq { width: 1 });
        assert_eq!(read("2026").shape.lead, Lead::Year);
        assert_eq!(read("2026-11-11 회의록").shape.lead, Lead::Date { form: DateForm::Dash });
        let r = read("결과보고_v3_20261111");
        assert_eq!(r.title, "결과보고");
        assert_eq!(r.shape.tail, vec![Tail::Version { prefix: "v".into() }, Tail::Date { form: DateForm::Ymd8 }]);
        assert_eq!(r.shape.sep, Some('_'));
        let r = read("Budget Q3 rev2");
        assert_eq!((r.title.as_str(), r.version.as_deref(), r.shape.sep), ("Budget Q3", Some("2"), Some(' ')));
    }

    #[test]
    fn convention_needs_three_and_sixty_percent() {
        assert!(pattern_of(&names(&["01_a.txt", "02_b.txt"]), false).is_none());
        assert!(pattern_of(&names(&["01_a.txt", "02_b.txt", "c.txt", "d.txt"]), false).is_none());
        let p = pattern_of(&names(&["01_a.txt", "02_b.txt", "03_c.txt", "d.txt"]), false).unwrap();
        assert_eq!((p.follow, p.total, p.example.as_str()), (3, 4, "01_제목"));
    }

    #[test]
    fn suggests_in_the_folder_shape() {
        // 제목_v판_날짜 폴더 — 받은 파일의 복사 표시 · 상태어를 떼고 다음 판 · 날짜를 채운다.
        let folder = ["결과보고_v1_20261101.hwpx", "결과보고_v2_20261105.hwpx", "계획서_v3_20261020.hwpx"];
        let s = sug(&folder, "결과보고 최종(1).hwpx", "20261111");
        assert_eq!(s.name, "결과보고_v3_20261111.hwpx", "{:?}", s.changes);
        assert!(s.by_convention);
        // 날짜 먼저 쓰는 폴더 (영어 이름).
        let folder = ["2026-10-01 kickoff notes.md", "2026-10-15 design review.md", "2026-11-02 retro.md"];
        assert_eq!(sug(&folder, "Copy of standup.md", "20261111").name, "2026-11-11 standup.md");
        // 순번 폴더 — 다음 번호.
        let folder = ["01_요구사항.docx", "02_설계.docx", "03_구현.docx"];
        assert_eq!(sug(&folder, "시험 계획.docx", "20261111").name, "04_시험 계획.docx");
    }

    #[test]
    fn without_convention_only_cleans_in_its_own_shape() {
        let s = sug(&["a.txt", "b.png"], "Quarterly Report - Copy (2).docx", "20261111");
        assert_eq!(s.name, "Quarterly Report.docx");
        assert!(!s.by_convention);
        let s = sug(&[], "meeting notes v3 FINAL.docx", "20261111");
        assert_eq!(s.name, "meeting notes v3.docx");
        // 바꿀 것이 없으면 그대로 · 바꾼 것 없음.
        let s = sug(&[], "회의록_v3_20261111.hwpx", "20261111");
        assert_eq!(s.name, "회의록_v3_20261111.hwpx");
        assert!(s.changes.is_empty());
    }

    #[test]
    fn keeps_title_and_author() {
        let folder = ["결과보고_v1_20261101.hwpx", "결과보고_v2_20261105.hwpx", "계획서_v3_20261020.hwpx"];
        let s = sug(&folder, "검토의견_홍길동.hwpx", "20261110");
        assert_eq!(s.name, "검토의견_홍길동_v1_20261110.hwpx");
    }

    #[test]
    fn new_folder_and_deviations_on_disk() {
        // 부모를 따로 둔다 — 임시 폴더 바로 아래면 남의 폴더들이 형제로 읽힌다.
        let base = std::env::temp_dir().join(format!("fd-conv-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("과제");
        for d in ["01_기획", "02_설계", "03_구현"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        assert_eq!(new_folder_name(&root, "20261111").as_deref(), Some("04_"));
        let docs = root.join("01_기획");
        for f in ["회의록_v1_20261101.md", "회의록_v2_20261102.md", "요구_v1_20261103.md", "요구 정리 최종.md"] {
            std::fs::write(docs.join(f), "x").unwrap();
        }
        let dev = deviations(&docs, |_| "20261111".into());
        assert_eq!(dev.len(), 1, "{dev:?}");
        assert_eq!(dev[0].suggestion.name, "요구 정리_v1_20261111.md");
        // 새 폴더(파일 없음)는 형제 폴더의 꼴을 빌린다.
        let conv = convention_of(&root.join("02_설계"));
        assert_eq!(conv.files.as_ref().map(|f| f.from), Some("siblings"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn review_fixes() {
        // 2026.11.11 리뷰에서 잡힌 것.
        // 머리 뒤 구분자는 꼬리 쪽과 따로 센다 — `2026-11-01 회의록_v1` 폴더에서 `2026-11-11_standup` 이 아니라 `2026-11-11 standup`.
        let folder = ["2026-11-01 회의록_v1.md", "2026-11-03 설계_v2.md", "2026-11-05 회고_v1.md"];
        assert_eq!(sug(&folder, "standup_v1.md", "20261111").name, "2026-11-11 standup_v1.md");
        // 확장자 없는 이름의 `.11` 은 날짜 조각이다.
        assert_eq!(read(split_ext("결과보고_2026.11.11", false).0).date.as_deref(), Some("20261111"));

        let base = std::env::temp_dir().join(format!("fd-conv-review-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        // 연도 폴더 — 빈 제목이 `.x` 로 읽혀 `2027_` 을 권하던 것.
        let years = base.join("연도");
        for d in ["2024", "2025", "2026"] {
            std::fs::create_dir_all(years.join(d)).unwrap();
        }
        assert_eq!(new_folder_name(&years, "20261111").as_deref(), Some("2027"));
        // 순번 없는 파일 여럿이 모두 같은 다음 번호를 받던 것.
        let seq = base.join("순번");
        std::fs::create_dir_all(&seq).unwrap();
        for f in ["01_a.md", "02_b.md", "03_c.md", "메모.md", "참고.md"] {
            std::fs::write(seq.join(f), "x").unwrap();
        }
        let mut got: Vec<String> = deviations(&seq, |_| "20261111".into()).into_iter().map(|d| d.suggestion.name).collect();
        got.sort();
        assert_eq!(got, vec!["04_메모.md".to_string(), "05_참고.md".to_string()]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn review_fixes_2() {
        // 앞 공백이 있는 이름도 자리가 밀리지 않는다.
        let folder = ["2026-11-01 회의록.md", "2026-11-03 설계.md", "2026-11-05 회고.md"];
        assert_eq!(sug(&folder, " 2026.11.10 회의록.md", "20261111").name, " 2026-11-10 회의록.md");
        // 같은 폴더는 대소문자 · 빗금이 달라도 같다.
        let d = std::env::temp_dir();
        let up = std::path::PathBuf::from(d.to_string_lossy().to_uppercase() + "\\");
        assert!(same_dir(&d, &up));
    }
}
