//! 과업 · 자리 — 과업 루트를 알아보고, 루트 아래 폴더마다 역할을 붙인다.
//!
//! 기준은 과업 지침 「폴더 이름 규격」의 루트 열 폴더다. 2026.11.11 : 설정으로 고치기 전까지 이 이름표로 추정한다.
//! 역할이 동작을 바꾼다 — 받은 것 · 보관 자리는 지우기 · 이름 바꾸기 전에 묻는다 (지침: 받은 것은 고치지 않는다).

use std::path::Path;
use std::time::{Duration, SystemTime};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// 사람이 내는 것의 정본 자리 (산출물 · 매뉴얼)
    Canon,
    /// 받은 것 — 고치지 않는다 (자료)
    Received,
    /// 다 쓴 것 — 고치지 않는다 (아카이브)
    Archive,
    /// 진행 중 (작업 · 스크린샷)
    Work,
    /// 지난 판 (`이전판/`)
    History,
    /// 과업 관리 · 설계 · 지침 같은 글
    Notes,
    /// 코드 · 생성물
    Code,
}

/// 루트 바로 아래 폴더 이름 → 역할. 화면에 이 순서로 보인다.
pub const AREAS: &[(&str, Role)] = &[
    ("산출물", Role::Canon),
    ("매뉴얼", Role::Canon),
    ("자료", Role::Received),
    ("작업", Role::Work),
    ("스크린샷", Role::Work),
    ("과업", Role::Notes),
    ("설계", Role::Notes),
    ("지식", Role::Notes),
    ("지침", Role::Notes),
    ("아카이브", Role::Archive),
];

/// 과업 루트인가 — `산출물` 폴더가 있거나, 프로젝트 단위 문서 저장소의 `사업\<연도>\<프로젝트명>` 자리면 과업으로 본다.
pub fn is_project_root(dir: &Path) -> bool {
    dir.join("산출물").is_dir() || in_store_slot(dir)
}

/// `…\사업\2026\예시사업` 꼴인가 (2026-11-11 부터 문서 저장소 `D:\문서\사업\<연도>\<사업명>`).
fn in_store_slot(dir: &Path) -> bool {
    let year = dir.parent();
    let biz = year.and_then(Path::parent);
    match (year.and_then(Path::file_name), biz.and_then(Path::file_name)) {
        (Some(y), Some(b)) => b == STORE_PROJECTS && is_year(&y.to_string_lossy()) && dir.is_dir(),
        _ => false,
    }
}

fn is_year(s: &str) -> bool {
    s.len() == 4 && s.starts_with("20") && s.chars().all(|c| c.is_ascii_digit())
}

/// 문서 저장소 안 프로젝트를 모아 두는 폴더 이름. 화면 말은 「프로젝트」지만 디스크의 폴더 이름은 `사업` 그대로다 (2026.11.11).
pub const STORE_PROJECTS: &str = "사업";
/// 새 프로젝트를 만들 때 까는 자리 — 나머지(스크린샷 · 작업 …)는 필요할 때 만든다.
pub const NEW_PROJECT_AREAS: &[&str] = &["산출물", "자료", "아카이브"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreProject {
    pub name: String,
    pub path: String,
    pub areas: Vec<Area>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreYear {
    pub year: String,
    pub projects: Vec<StoreProject>,
}

/// 저장소의 연도별 프로젝트 (최근 연도가 앞).
pub fn store_projects(store: &Path) -> Vec<StoreYear> {
    let Ok(rd) = std::fs::read_dir(store.join(STORE_PROJECTS)) else { return Vec::new() };
    let mut years: Vec<StoreYear> = rd
        .flatten()
        .filter(|e| e.path().is_dir() && is_year(&e.file_name().to_string_lossy()))
        .map(|y| {
            let mut projects: Vec<StoreProject> = std::fs::read_dir(y.path())
                .map(|rd| {
                    rd.flatten()
                        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
                        .map(|p| StoreProject {
                            name: p.file_name().to_string_lossy().into_owned(),
                            path: p.path().to_string_lossy().into_owned(),
                            areas: areas(&p.path()),
                        })
                        .collect()
                })
                .unwrap_or_default();
            projects.sort_by(|a, b| a.name.cmp(&b.name));
            StoreYear { year: y.file_name().to_string_lossy().into_owned(), projects }
        })
        .collect();
    years.sort_by(|a, b| b.year.cmp(&a.year));
    years
}

/// 새 프로젝트 — `<저장소>\사업\<연도>\<이름>` 과 기본 자리를 만든다. 이미 있으면 만들지 않는다.
pub fn create_project(store: &Path, year: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    if !is_year(year) {
        return Err(format!("연도가 네 자리가 아니다: {year}"));
    }
    if name.is_empty() || name.chars().any(|c| r#"\/:*?"<>|"#.contains(c)) || name.starts_with('.') {
        return Err(r#"프로젝트 이름에 쓸 수 없는 글자가 있다 (\ / : * ? " < > |)"#.into());
    }
    let dir = store.join(STORE_PROJECTS).join(year).join(name);
    if dir.exists() {
        return Err(format!("이미 있다: {}", dir.display()));
    }
    for a in NEW_PROJECT_AREAS {
        std::fs::create_dir_all(dir.join(a)).map_err(|e| e.to_string())?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub name: String,
    pub path: String,
    pub role: Role,
}

/// 과업 루트의 자리 목록 (있는 것만). 과업 루트가 아니면 빈 목록.
pub fn areas(root: &Path) -> Vec<Area> {
    if !is_project_root(root) {
        return Vec::new();
    }
    AREAS
        .iter()
        .filter(|(n, _)| root.join(n).is_dir())
        .map(|(n, r)| Area { name: (*n).into(), path: root.join(n).to_string_lossy().into_owned(), role: *r })
        .collect()
}

/// `path` 의 역할. 과업 루트 아래면 첫 조각으로, 어디서든 `이전판` 안이면 지난 판.
/// 과업 밖이거나 모르는 자리면 None.
pub fn role_of(path: &Path) -> Option<Role> {
    if path.components().any(|c| c.as_os_str() == crate::docs::HISTORY_DIR) {
        return Some(Role::History);
    }
    let mut cur = Some(path);
    while let Some(p) = cur {
        if let Some(parent) = p.parent() {
            if is_project_root(parent) {
                let name = p.file_name()?.to_string_lossy();
                return AREAS.iter().find(|(n, _)| *n == name).map(|(_, r)| *r);
            }
        }
        cur = p.parent();
    }
    None
}

/// 폴더 바로 아래에서 최근 `days` 일 안에 생기거나 바뀐 파일 수 — 「들어온 곳」에 보이는 숫자.
pub fn recent_count(dir: &Path, days: u64) -> usize {
    let since = SystemTime::now() - Duration::from_secs(days * 86_400);
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .filter(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            !n.starts_with('.') && !n.starts_with("~$") && !n.eq_ignore_ascii_case("desktop.ini")
        })
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .filter(|m| m.modified().is_ok_and(|t| t >= since) || m.created().is_ok_and(|t| t >= since))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_layout() {
        let store = std::env::temp_dir().join(format!("fd-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&store);
        let p = create_project(&store, "2027", "새 사업").unwrap();
        assert!(Path::new(&p).join("산출물").is_dir());
        assert!(create_project(&store, "2027", "새 사업").is_err(), "있으면 만들지 않는다");
        assert!(create_project(&store, "27", "x").is_err());
        assert!(create_project(&store, "2027", "a/b").is_err());
        std::fs::create_dir_all(store.join("사업/2026/예시사업/제안서")).unwrap(); // 산출물이 없어도 사업 자리면 과업
        let years = store_projects(&store);
        assert_eq!(years.iter().map(|y| y.year.as_str()).collect::<Vec<_>>(), ["2027", "2026"]);
        assert!(is_project_root(&store.join("사업/2026/예시사업")));
        assert!(!is_project_root(&store.join("사업/2026/예시사업/제안서")));
        assert_eq!(role_of(&Path::new(&p).join("자료")), Some(Role::Received));
        std::fs::remove_dir_all(&store).unwrap();
    }

    #[test]
    fn roles_inside_project() {
        let root = std::env::temp_dir().join(format!("fd-proj-{}", std::process::id()));
        for d in ["산출물/보고/이전판", "자료/회의", "작업"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        assert!(is_project_root(&root));
        assert_eq!(role_of(&root.join("산출물/보고")), Some(Role::Canon));
        assert_eq!(role_of(&root.join("산출물/보고/이전판")), Some(Role::History));
        assert_eq!(role_of(&root.join("자료/회의")), Some(Role::Received));
        assert_eq!(role_of(&root), None);
        let names: Vec<_> = areas(&root).into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["산출물", "자료", "작업"]);
        std::fs::write(root.join("작업/새.txt"), b"x").unwrap();
        assert_eq!(recent_count(&root.join("작업"), 3), 1);
        std::fs::remove_dir_all(&root).unwrap();
    }
}
