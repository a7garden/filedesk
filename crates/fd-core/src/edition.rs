//! 새 판 이름 짓기 — 과업 지침 「파일 이름 규격」 · 「관리 문서 등록부」의 판 규칙.
//!
//! - 판은 마지막 자리를 하나 올린다 (`v1.6` → `v1.7` · `v36` → `v37`).
//! - 날짜는 오늘로.
//! - 정의서(`LDM_D…`)는 판이 하루에 하나다 — 오늘 판이 이미 있으면 새 판을 만들지 않고 그 판을 고치게 한다.
//!   보고 문서는 같은 날 두 번 내면 판을 올린다 (날짜는 그대로).
//! - 판 · 날짜 조각 말고는 원래 이름을 그대로 둔다 (`_내부용` 같은 꼬리 포함).

/// 이름 규격 밖이라 새 판을 지을 수 없을 때의 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditionError {
    /// `_v<판>` · `_<YYYYMMDD>` 조각이 없다.
    NotStandard,
    /// 정의서인데 오늘 판이 이미 있다.
    SameDayDefinition,
}

impl std::fmt::Display for EditionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EditionError::NotStandard => f.write_str("이름이 <문서명>_v<판>_<YYYYMMDD> 꼴이 아니라 새 판 이름을 지을 수 없다"),
            EditionError::SameDayDefinition => f.write_str("정의서는 판이 하루에 하나다 — 오늘 판을 그대로 고친다"),
        }
    }
}

fn is_version(t: &str) -> bool {
    let b = t.as_bytes();
    b.len() >= 2
        && (b[0] == b'v' || b[0] == b'V')
        && t[1..].split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn is_date8(t: &str) -> bool {
    t.len() == 8 && t.starts_with("20") && t.chars().all(|c| c.is_ascii_digit())
}

fn bump(v: &str) -> String {
    let mut parts: Vec<u64> = v[1..].split('.').map(|p| p.parse().unwrap_or(0)).collect();
    if let Some(last) = parts.last_mut() {
        *last += 1;
    }
    format!("{}{}", &v[..1], parts.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."))
}

/// `name` 의 다음 판 이름. `today` 는 `YYYYMMDD`.
pub fn next_edition_name(name: &str, today: &str) -> Result<String, EditionError> {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut toks: Vec<String> = stem.split('_').map(str::to_string).collect();
    let vi = toks.iter().position(|t| is_version(t)).ok_or(EditionError::NotStandard)?;
    let di = toks.iter().position(|t| is_date8(t)).ok_or(EditionError::NotStandard)?;
    let is_definition = stem.starts_with("LDM_D");
    if toks[di] == today && is_definition {
        return Err(EditionError::SameDayDefinition);
    }
    toks[vi] = bump(&toks[vi]);
    toks[di] = today.to_string();
    Ok(format!("{}{}", toks.join("_"), ext))
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
}

/// 새 판 계획을 세운다. 판 규칙으로 다음 이름을 짓고, 같은 판의 다른 꼴(pdf 등)까지 `이전판/` 으로 보낼 목록을 만든다.
/// 화면과 명령줄이 같은 계획을 먼저 보이고, 실행할 때 다시 세워 그대로 한다 (보인 뒤 폴더가 바뀌었을 수 있어서).
/// 2026.11.11 : 앱(`lib.rs`)에 있던 것을 명령줄(`fd edition`)도 쓰도록 옮겼다.
pub fn plan(path: &std::path::Path, today: &str, rules: &crate::NameRules) -> Result<EditionPlan, String> {
    use crate::docname::parse;
    use crate::docs::{HISTORY_DIR, is_rendition};
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("파일 이름이 없다")?;
    let folder = path.parent().ok_or("상위 폴더가 없다")?.to_path_buf();
    if folder.file_name().is_some_and(|n| n == HISTORY_DIR) {
        return Err("이전판 안의 파일에서는 새 판을 내지 않는다 — 정본 폴더의 최신판에서 낸다".into());
    }
    if !path.is_file() {
        return Err(format!("{}: 파일이 없다", path.display()));
    }
    let new_name = next_edition_name(&name, today).map_err(|e| e.to_string())?;
    let me = parse(&name, rules);
    let same_edition = |n: &str| {
        let o = parse(n, rules);
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
            .find(|n| !is_rendition(&parse(n, rules).ext));
        if let Some(src_name) = src_name {
            return plan(&folder.join(&src_name), today, rules);
        }
    }
    Ok(EditionPlan {
        source: path.to_string_lossy().into_owned(),
        new_path: folder.join(&new_name).to_string_lossy().into_owned(),
        new_name,
        retire,
        history: folder.join(HISTORY_DIR).to_string_lossy().into_owned(),
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
    fn same_day_rules() {
        assert_eq!(
            next_edition_name("LDM_D14_공통코드_정의서_v0.2_20261111.xlsx", "20261111"),
            Err(EditionError::SameDayDefinition)
        );
        assert_eq!(next_edition_name("근거보고서_서식확인요청_v7_20261111.hwpx", "20261111").unwrap(), "근거보고서_서식확인요청_v8_20261111.hwpx");
    }

    #[test]
    fn rejects_nonstandard() {
        assert_eq!(next_edition_name("예시과업_담당자매뉴얼_20261027_홍길동.pptx", "20261111"), Err(EditionError::NotStandard));
        assert_eq!(next_edition_name("[중간보고] 발표.pptx", "20261111"), Err(EditionError::NotStandard));
    }
}
