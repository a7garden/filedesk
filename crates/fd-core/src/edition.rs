//! 새 판 이름 짓기.
//!
//! - 판은 마지막 자리를 하나 올린다 (`v1.6` → `v1.7` · `v36` → `v37` · `rev3` → `rev4` · `제3판` → `제4판`). 판 꼴 · 대소문자는 그대로.
//! - 날짜는 오늘로, 원래 날짜 꼴 그대로 (`20261111` · `2026-11-11` · `2026.11.11` · `261111`).
//! - 판 · 날짜 조각 말고는 원래 이름을 그대로 둔다 (`_내부용` 같은 꼬리 · 띄어쓰기 포함).
//! - 판도 날짜도 없으면 짓지 않는다 — 어떤 꼴로 붙일지는 폴더 관례가 정할 일이다 (`convention`).
//!
//! 2026.11.11 : 과업 규격(`<문서명>_v<판>_<YYYYMMDD>` · `_` 로 나눈 조각)만 읽던 것을 넓혔다 — 띄어 쓴 이름 · 판만 · 날짜만 있는 이름도 새 판을 낸다.
//!              정의서(`LDM_D…`)는 하루 한 판이라 같은 날 새 판을 막던 규칙을 뺐다 — 한 회사 규격이라 일반 탐색기에 둘 수 없다 (DESIGN [1-1]).
//!              대신 계획(`EditionPlan::note`)이 「오늘 판이 이미 있다 · 이 문서는 지금까지 하루 한 판이었다」를 알리고, 사람이 고른다.

use std::sync::OnceLock;

use regex::Regex;

/// 새 판 이름을 지을 수 없을 때의 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditionError {
    /// 판 · 날짜 조각이 둘 다 없다.
    NotStandard,
    /// 판은 없고 날짜만 있는데 그 날짜가 이미 오늘이다 — 이름이 같아진다.
    SameDay,
}

impl std::fmt::Display for EditionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditionError::NotStandard => f.write_str("이름에 판(v3 · rev3 · 제3판)도 날짜도 없어 새 판 이름을 지을 수 없다 — 이름에 판이나 날짜를 넣은 뒤 다시"),
            EditionError::SameDay => f.write_str("이름에 판 없이 날짜만 있는데 오늘 날짜다 — 새 판 이름이 지금 이름과 같아진다. 이름에 판(v2)을 넣거나 오늘 판을 그대로 고친다"),
        }
    }
}

static RE_VER_KO: OnceLock<Regex> = OnceLock::new();
static RE_DATE8: OnceLock<Regex> = OnceLock::new();
static RE_DATE6: OnceLock<Regex> = OnceLock::new();

use crate::docname::{re, valid_ymd, ver_re};

/// 앞뒤가 글자 경계인가 — 낱말 속의 v(`dev2`) · 더 긴 숫자 속의 날짜를 잡지 않으려고. regex 크레이트에 뒤보기가 없어 직접 본다.
fn bounded(s: &str, start: usize, end: usize, digits_only: bool) -> bool {
    let before = s[..start].chars().next_back();
    let after = s[end..].chars().next();
    let edge = |c: Option<char>| match c {
        None => true,
        Some(c) if digits_only => !c.is_ascii_digit(),
        Some(c) => !c.is_ascii_alphanumeric(),
    };
    edge(before) && edge(after)
}

/// (판 숫자의 자리, 숫자 글자). 판 꼴 `v`/`ver`/`rev` 를 먼저, 없으면 `제N판`.
fn find_version(stem: &str) -> Option<(usize, usize)> {
    for c in ver_re().captures_iter(stem) {
        let all = c.get(0).unwrap();
        if bounded(stem, all.start(), all.end(), false) {
            let n = c.get(1).unwrap();
            return Some((n.start(), n.end()));
        }
    }
    let ko = re(&RE_VER_KO, r"제?(\d+)판");
    for c in ko.captures_iter(stem) {
        let all = c.get(0).unwrap();
        if bounded(stem, all.start(), all.end(), false) {
            let n = c.get(1).unwrap();
            return Some((n.start(), n.end()));
        }
    }
    None
}

/// 이름 속 날짜 — (자리, 끝, 같은 꼴로 쓴 오늘). 여덟 자리(구분자 있어도)를 먼저, 없으면 여섯 자리.
fn find_date(stem: &str, today: &str) -> Option<(usize, usize, String)> {
    let (ty, tm, td) = (&today[..4], &today[4..6], &today[6..8]);
    let d8 = re(&RE_DATE8, r"(\d{4})([-.]?)(\d{2})([-.]?)(\d{2})");
    for c in d8.captures_iter(stem) {
        let all = c.get(0).unwrap();
        if c[2] != c[4] || !bounded(stem, all.start(), all.end(), true) {
            continue;
        }
        let (y, m, d) = (c[1].parse().unwrap_or(0), c[3].parse().unwrap_or(0), c[5].parse().unwrap_or(0));
        if valid_ymd(y, m, d) {
            let sep = &c[2];
            return Some((all.start(), all.end(), format!("{ty}{sep}{tm}{sep}{td}")));
        }
    }
    let d6 = re(&RE_DATE6, r"\d{6}");
    for m in d6.find_iter(stem) {
        let t = m.as_str();
        let (y, mo, d) = (2000 + t[..2].parse::<u32>().unwrap_or(0), t[2..4].parse().unwrap_or(0), t[4..].parse().unwrap_or(0));
        if bounded(stem, m.start(), m.end(), true) && valid_ymd(y, mo, d) {
            return Some((m.start(), m.end(), format!("{}{tm}{td}", &ty[2..])));
        }
    }
    None
}

/// 판 숫자의 마지막 자리를 하나 올린다 (`1.6` → `1.7`). 이름 제안(`convention`)도 같은 것을 쓴다.
pub(crate) fn bump(digits: &str) -> String {
    let mut parts: Vec<u64> = digits.split('.').map(|p| p.parse().unwrap_or(0)).collect();
    if let Some(last) = parts.last_mut() {
        *last += 1;
    }
    parts.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(".")
}

/// `name` 의 다음 판 이름. `today` 는 `YYYYMMDD`.
pub fn next_edition_name(name: &str, today: &str) -> Result<String, EditionError> {
    let (stem, ext) = crate::docname::split_name(name);
    let ver = find_version(stem);
    let date = find_date(stem, today);
    if ver.is_none() && date.is_none() {
        return Err(EditionError::NotStandard);
    }
    if ver.is_none() {
        let (s, e, _) = date.as_ref().unwrap();
        let digits: String = stem[*s..*e].chars().filter(|c| c.is_ascii_digit()).collect();
        if digits == today || digits == today[2..] {
            return Err(EditionError::SameDay);
        }
    }
    // 뒤쪽 조각부터 바꿔야 앞쪽 자리가 밀리지 않는다.
    let mut edits: Vec<(usize, usize, String)> = Vec::new();
    if let Some((s, e)) = ver {
        edits.push((s, e, bump(&stem[s..e])));
    }
    if let Some((s, e, t)) = date {
        edits.push((s, e, t));
    }
    edits.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = stem.to_string();
    for (s, e, t) in edits {
        out.replace_range(s..e, &t);
    }
    Ok(format!("{out}{ext}"))
}

/// 새 판 계획 — 무엇을 복사해 어떤 이름으로 두고, 무엇을 `이전판/` 으로 보내는가.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionPlan {
    /// 복사해 올 판 (pdf 를 골랐으면 같은 판의 원본으로 바뀐다).
    pub source: String,
    pub new_name: String,
    pub new_path: String,
    /// 이전판으로 보낼 파일 (지난 판과 그 판의 다른 꼴).
    pub retire: Vec<String>,
    pub history: String,
    /// 사람이 알고 고를 것 — 오늘 판이 이미 있다 · 이 문서는 지금까지 하루 한 판이었다. 막지는 않는다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// 새 판 계획을 세운다. 판 규칙으로 다음 이름을 짓고, 같은 판의 다른 꼴(pdf 등)까지 `이전판/` 으로 보낼 목록을 만든다.
/// 화면과 명령줄이 같은 계획을 먼저 보이고, 실행할 때 다시 세워 그대로 한다 (보인 뒤 폴더가 바뀌었을 수 있어서).
/// 2026.11.11 : 앱(`lib.rs`)에 있던 것을 명령줄(`fd edition`)도 쓰도록 옮겼다.
pub fn plan(path: &std::path::Path, today: &str) -> Result<EditionPlan, String> {
    use crate::docname::parse;
    use crate::docs::{history_dir, is_history_name, is_rendition};
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("파일 이름이 없다")?;
    let folder = path.parent().ok_or("상위 폴더가 없다")?.to_path_buf();
    if folder.file_name().is_some_and(|n| is_history_name(&n.to_string_lossy())) {
        return Err("「이전판」 폴더 안의 파일에서는 새 판을 내지 않는다 — 그 위 폴더의 최신판에서 낸다".into());
    }
    if !path.is_file() {
        return Err(format!("{}: 파일이 없다", path.display()));
    }
    let new_name = next_edition_name(&name, today).map_err(|e| e.to_string())?;
    let me = parse(&name);
    let same_edition = |n: &str| {
        let o = parse(n);
        o.key == me.key && o.version == me.version && o.date == me.date && o.time == me.time
    };
    let mut retire: Vec<String> = std::fs::read_dir(&folder)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| same_edition(&e.file_name().to_string_lossy()))
        .map(|e| e.path().to_string_lossy().into_owned())
        .collect();
    retire.sort();
    // 보기용 꼴(pdf)을 골랐어도 같은 판에 원본이 있으면 원본에서 낸다. 새 판 이름도 원본 확장자로.
    if is_rendition(&me.ext) {
        let src_name = retire
            .iter()
            .filter_map(|p| std::path::Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()))
            .find(|n| !is_rendition(&parse(n).ext));
        if let Some(src_name) = src_name {
            return plan(&folder.join(&src_name), today);
        }
    }
    Ok(EditionPlan {
        source: path.to_string_lossy().into_owned(),
        new_path: folder.join(&new_name).to_string_lossy().into_owned(),
        new_name,
        retire,
        history: history_dir(&folder).to_string_lossy().into_owned(),
        note: same_day_note(&folder, &me.key, today),
    })
}

/// 오늘 판이 이미 있으면 알린다. 지난 판들이 모두 다른 날이면(셋 이상) 「하루 한 판」이 이 문서의 관례라고 덧붙인다.
/// 2026.11.11 : 정의서만 같은 날 새 판을 막던 규칙(`LDM_D…`)의 일반판 — 이름 머리가 아니라 그 문서의 지난 판에서 읽는다.
fn same_day_note(folder: &std::path::Path, key: &str, today: &str) -> Option<String> {
    let groups = crate::docs::group_dir(folder, false);
    let g = groups.iter().find(|g| g.key == key)?;
    let mut eds: Vec<(&Vec<u32>, &str)> = g.files.iter().filter(|f| !f.parsed.date.is_empty()).map(|f| (&f.parsed.version, f.parsed.date.as_str())).collect();
    eds.sort();
    eds.dedup();
    let todays: Vec<String> = eds.iter().filter(|(_, d)| *d == today).map(|(v, _)| v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(".")).collect();
    if todays.is_empty() {
        return None;
    }
    let mut sorted: Vec<&str> = eds.iter().map(|(_, d)| *d).collect();
    sorted.sort();
    sorted.dedup();
    let one_a_day = eds.len() >= 3 && sorted.len() == eds.len();
    let have = todays.iter().map(|v| if v.is_empty() { "오늘 판".to_string() } else { format!("v{v}") }).collect::<Vec<_>>().join(" · ");
    Some(if one_a_day {
        format!("오늘 낸 판({have})이 이미 있다 — 이 문서는 지금까지 하루에 한 판이었다. 오늘 판을 그대로 고칠 수도 있다")
    } else {
        format!("오늘 낸 판({have})이 이미 있다 — 같은 날 판을 하나 더 올린다")
    })
}

/// 계획대로 하면 덮어쓸 자리 — 새 판 이름이 이미 있거나, 이전판에 같은 이름이 있으면.
/// 셸은 겹치면 창을 띄워 묻는데, 명령줄은 묻는 창 없이 멈춰야 해서 먼저 본다.
pub fn collisions(plan: &EditionPlan) -> Vec<String> {
    let hist = std::path::Path::new(&plan.history);
    let mut out: Vec<String> = Vec::new();
    if std::path::Path::new(&plan.new_path).exists() {
        out.push(plan.new_path.clone());
    }
    out.extend(crate::docs::history_collisions(&plan.retire, hist));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bumps_last_part_and_sets_today() {
        assert_eq!(
            next_edition_name("LDM_D09_테이블(컬럼)정의서_예시과업_v1.8_20261016.xlsx", "20261111").unwrap(),
            "LDM_D09_테이블(컬럼)정의서_예시과업_v1.9_20261111.xlsx"
        );
        assert_eq!(next_edition_name("예시과업_최종보고_v36_20261110.pptx", "20261111").unwrap(), "예시과업_최종보고_v37_20261111.pptx");
        assert_eq!(
            next_edition_name("예시과업_운영배포매뉴얼_v0.4_20261016_내부용.docx", "20261111").unwrap(),
            "예시과업_운영배포매뉴얼_v0.5_20261111_내부용.docx"
        );
    }

    #[test]
    fn same_day_bumps_version_and_date_only_name_stops() {
        // 이름 머리(`LDM_D`)로 막지 않는다 — 계획의 note 가 알린다.
        assert_eq!(next_edition_name("LDM_D14_공통코드_정의서_v0.2_20261111.xlsx", "20261111").unwrap(), "LDM_D14_공통코드_정의서_v0.3_20261111.xlsx");
        assert_eq!(next_edition_name("근거보고서_서식확인요청_v7_20261111.hwpx", "20261111").unwrap(), "근거보고서_서식확인요청_v8_20261111.hwpx");
        assert_eq!(next_edition_name("회의록_20261111.hwpx", "20261111"), Err(EditionError::SameDay));
        assert_eq!(next_edition_name("2026-11-11 회의록.docx", "20261111"), Err(EditionError::SameDay));
    }

    #[test]
    fn many_shapes_keep_their_own_form() {
        assert_eq!(next_edition_name("회의록 v3.docx", "20261111").unwrap(), "회의록 v4.docx");
        assert_eq!(next_edition_name("Budget V1.2 - draft.xlsx", "20261111").unwrap(), "Budget V1.3 - draft.xlsx");
        assert_eq!(next_edition_name("spec-rev3.pdf.docx", "20261111").unwrap(), "spec-rev4.pdf.docx");
        assert_eq!(next_edition_name("2026-11-10 회의록.docx", "20261111").unwrap(), "2026-11-11 회의록.docx");
        assert_eq!(next_edition_name("회의록_2026.11.10_v2.hwpx", "20261111").unwrap(), "회의록_2026.11.11_v3.hwpx");
        assert_eq!(next_edition_name("261110_결과보고.hwpx", "20261111").unwrap(), "261111_결과보고.hwpx");
        assert_eq!(next_edition_name("사업계획_제3판.hwpx", "20261111").unwrap(), "사업계획_제4판.hwpx");
        assert_eq!(next_edition_name("예시과업_담당자매뉴얼_20261027_홍길동.pptx", "20261111").unwrap(), "예시과업_담당자매뉴얼_20261111_홍길동.pptx");
    }

    #[test]
    fn rejects_names_without_edition_or_date() {
        assert_eq!(next_edition_name("[중간보고] 발표.pptx", "20261111"), Err(EditionError::NotStandard));
        // 낱말 속 v · 판이 아닌 숫자는 판으로 보지 않는다.
        assert_eq!(next_edition_name("devops2 overview.pdf", "20261111"), Err(EditionError::NotStandard));
        assert_eq!(next_edition_name("IMG_1234.jpg", "20261111"), Err(EditionError::NotStandard));
    }
}
