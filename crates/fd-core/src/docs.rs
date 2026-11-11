//! 문서 단위로 묶기 — 한 폴더(와 그 `이전판/`) 또는 그 아래 전부의 파일을 문서 키로 묶고,
//! 판 순서 · 최신판 · 과업 규칙에 어긋난 곳을 판단한다.
//!
//! 규칙의 원본은 과업 지침 「산출물」: 정본 폴더에는 최신판 하나 · 지난 판은 `이전판/` · 판은 하루에 하나.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::docname::{DocName, NameRules, parse};

/// 지난 판을 모아 두는 하위 폴더 이름 (과업 지침).
pub const HISTORY_DIR: &str = "이전판";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: i64,
    /// `이전판/` 안에 있는가.
    pub in_history: bool,
    pub parsed: DocName,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocGroup {
    pub key: String,
    pub title: String,
    /// 최신이 앞. 최신은 날짜 → 판 → 시각 → 수정 시각 순으로 가린다.
    pub files: Vec<DocFile>,
    /// 묶음 전체의 문제 (판 겹침 · 거꾸로 · 정본 자리에 판 여럿).
    pub issues: Vec<String>,
}

/// 같은 판 안에서는 고칠 수 있는 원본(pptx · xlsx · hwpx …)이 pdf 같은 보기용 꼴보다 앞이다.
/// 그러지 않으면 최신판이 pdf 로 잡혀 새 판을 pdf 에서 내게 된다 (2026-11-11 앱 시험에서 잡힘).
pub fn is_rendition(ext: &str) -> bool {
    matches!(ext, "pdf" | "png" | "jpg" | "jpeg" | "mp4" | "zip")
}

fn rank(f: &DocFile) -> (String, Vec<u32>, String, bool, i64) {
    (f.parsed.date.clone(), f.parsed.version.clone(), f.parsed.time.clone(), !is_rendition(&f.parsed.ext), f.modified)
}

/// 판 하나 = 같은 판 번호 · 날짜 · 시각. pptx 와 pdf 처럼 꼴만 다른 것은 한 판으로 센다.
fn edition(f: &DocFile) -> (Vec<u32>, String, String) {
    (f.parsed.version.clone(), f.parsed.date.clone(), f.parsed.time.clone())
}

fn read_files(dir: &Path, in_history: bool, recursive: bool, rules: &NameRules, out: &mut Vec<DocFile>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for item in rd.flatten() {
        let Ok(meta) = item.metadata() else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with("~$") || name.eq_ignore_ascii_case("desktop.ini") {
            continue; // 숨김 · 오피스 잠금 파일
        }
        let path = item.path();
        if meta.is_dir() {
            let is_hist = name == HISTORY_DIR;
            if is_hist || recursive {
                read_files(&path, in_history || is_hist, recursive, rules, out);
            }
            continue;
        }
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push(DocFile {
            parsed: parse(&name, rules),
            path: path.to_string_lossy().into_owned(),
            name,
            size: meta.len(),
            modified,
            in_history,
        });
    }
}

/// `dir` 의 파일(과 `이전판/`)을 문서로 묶는다. `recursive` 면 아래 폴더 전부.
pub fn group_dir(dir: &Path, recursive: bool, rules: &NameRules) -> Vec<DocGroup> {
    let mut files = Vec::new();
    read_files(dir, false, recursive, rules, &mut files);
    group_files(files)
}

pub fn group_files(files: Vec<DocFile>) -> Vec<DocGroup> {
    let mut by: BTreeMap<String, Vec<DocFile>> = BTreeMap::new();
    for f in files {
        by.entry(f.parsed.key.clone()).or_default().push(f);
    }
    let mut out: Vec<DocGroup> = by
        .into_iter()
        .map(|(key, mut files)| {
            files.sort_by(|a, b| rank(b).cmp(&rank(a)));
            let title = files[0].parsed.title.clone();
            let issues = group_issues(&files);
            DocGroup { key, title, files, issues }
        })
        .collect();
    out.sort_by(|a, b| a.title.cmp(&b.title));
    out
}

/// 최신판 자리에 남은 지난 판 — 최신판과 같은 폴더 · 이전판 밖인데 최신판(과 그 판의 다른 꼴)이 아닌 파일.
/// 「지난 판을 이전판으로」가 옮길 목록이다. 최신판이 이전판 안에만 있으면 옮길 것이 없다.
pub fn stale_in_place(g: &DocGroup) -> Vec<String> {
    let Some(latest) = g.files.first().filter(|f| !f.in_history) else { return Vec::new() };
    let folder = Path::new(&latest.path).parent();
    let now = edition(latest);
    g.files
        .iter()
        .filter(|f| !f.in_history && Path::new(&f.path).parent() == folder && edition(f) != now)
        .map(|f| f.path.clone())
        .collect()
}

/// 폴더 `dir` 의 문서 `key` 에서 최신판 자리에 남은 지난 판. 화면의 「지난 판을 이전판으로」와 `fd retire --doc` 이 쓴다.
pub fn stale_of(dir: &Path, key: &str, rules: &NameRules) -> Result<Vec<String>, String> {
    let groups = group_dir(dir, false, rules);
    let g = groups.iter().find(|g| g.key == key).ok_or("문서를 찾지 못했다 — 폴더가 바뀌었다")?;
    Ok(stale_in_place(g))
}

/// 폴더 `dir` 의 모든 문서에서 최신판 자리에 남은 지난 판 — `(문서 키, 제목, 옮길 파일)`. 옮길 것이 없는 문서는 뺀다.
pub fn stale_all(dir: &Path, rules: &NameRules) -> Vec<(String, String, Vec<String>)> {
    group_dir(dir, false, rules)
        .iter()
        .map(|g| (g.key.clone(), g.title.clone(), stale_in_place(g)))
        .filter(|(_, _, v)| !v.is_empty())
        .collect()
}

/// `paths` 를 `history` 로 옮기면 이름이 겹치는 것 — 이미 같은 이름이 이전판에 있다.
pub fn history_collisions(paths: &[String], history: &Path) -> Vec<String> {
    paths
        .iter()
        .filter_map(|p| Path::new(p).file_name())
        .map(|n| history.join(n))
        .filter(|t| t.exists())
        .map(|t| t.to_string_lossy().into_owned())
        .collect()
}

fn group_issues(files: &[DocFile]) -> Vec<String> {
    let mut issues = Vec::new();

    // 같은 판 번호에 날짜가 둘 이상 — 판 번호를 다시 썼다.
    let mut dates_by_ver: BTreeMap<Vec<u32>, Vec<String>> = BTreeMap::new();
    for f in files.iter().filter(|f| !f.parsed.version.is_empty() && !f.parsed.date.is_empty()) {
        let d = dates_by_ver.entry(f.parsed.version.clone()).or_default();
        if !d.contains(&f.parsed.date) {
            d.push(f.parsed.date.clone());
        }
    }
    for (v, mut ds) in dates_by_ver {
        if ds.len() > 1 {
            ds.sort();
            let label = format!("v{}", v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."));
            let days: Vec<String> = ds.iter().map(|d| format!("{}-{}", &d[4..6], &d[6..8])).collect();
            issues.push(format!("{label} 이 여러 날짜에 있다 ({})", days.join(" · ")));
        }
    }

    // 날짜는 늦은데 판 번호가 작다 — 판 번호를 다시 매겼거나 잘못 붙였다.
    let mut dated: Vec<&DocFile> = files.iter().filter(|f| !f.parsed.version.is_empty() && !f.parsed.date.is_empty()).collect();
    dated.sort_by(|a, b| (&a.parsed.date, &a.parsed.version).cmp(&(&b.parsed.date, &b.parsed.version)));
    if dated.windows(2).any(|w| w[1].parsed.date > w[0].parsed.date && w[1].parsed.version < w[0].parsed.version) {
        issues.push("날짜 순서와 판 순서가 어긋난다".into());
    }

    // 정본 자리(이전판 밖)에 판이 여럿 — 폴더마다 센다.
    let mut current: BTreeMap<PathBuf, Vec<(Vec<u32>, String, String)>> = BTreeMap::new();
    for f in files.iter().filter(|f| !f.in_history) {
        let parent = Path::new(&f.path).parent().map(Path::to_path_buf).unwrap_or_default();
        let e = current.entry(parent).or_default();
        let ed = edition(f);
        if !e.contains(&ed) {
            e.push(ed);
        }
    }
    for (dir, eds) in current {
        if eds.len() > 1 {
            let folder = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            // 2026.11.11 : 「— 최신판 하나만 두고 나머지는 이전판으로」를 뺐다. 화면은 문제 줄 곁의 「지난 판을 이전판으로」 단추가 그 말을 한다.
            issues.push(format!("「{folder}」에 판이 {}개", eds.len()));
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(name: &str, dir: &str, hist: bool) -> DocFile {
        DocFile {
            parsed: parse(name, &NameRules::default()),
            path: format!("{dir}\\{name}"),
            name: name.into(),
            size: 1,
            modified: 0,
            in_history: hist,
        }
    }

    #[test]
    fn picks_latest_and_flags_reused_version() {
        let g = group_files(vec![
            f("LDM_D14_공통코드_정의서_v0.3_20261001.xlsx", r"D14\이전판", true),
            f("LDM_D14_공통코드_정의서_v0.3_20261015.xlsx", r"D14\이전판", true),
            f("LDM_D14_공통코드_정의서_v0.2_20261016.xlsx", "D14", false),
        ]);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].files[0].name, "LDM_D14_공통코드_정의서_v0.2_20261016.xlsx");
        assert!(g[0].issues.iter().any(|i| i.starts_with("v0.3 이 여러 날짜")), "{:?}", g[0].issues);
        assert!(g[0].issues.iter().any(|i| i.contains("어긋난다")));
    }

    #[test]
    fn source_format_beats_pdf_in_same_edition() {
        let mut pdf = f("보고서_v3_20261101.pdf", "보고", false);
        pdf.modified = 10; // pdf 를 나중에 뽑았어도
        let g = group_files(vec![pdf, f("보고서_v3_20261101.pptx", "보고", false)]);
        assert_eq!(g[0].files[0].name, "보고서_v3_20261101.pptx");
    }

    #[test]
    fn two_current_editions_flagged_but_formats_are_one() {
        let g = group_files(vec![
            f("담당자매뉴얼_v1.1_20261102.pptx", "사용안내", false),
            f("담당자매뉴얼_v1.1_20261102.pdf", "사용안내", false),
        ]);
        assert!(g[0].issues.is_empty(), "{:?}", g[0].issues);
        let g = group_files(vec![
            f("담당자매뉴얼_v1.1_20261102.pptx", "사용안내", false),
            f("담당자매뉴얼_v1.1_20261102.pdf", "사용안내", false),
            f("담당자매뉴얼_v1.0_20261101.pptx", "사용안내", false),
        ]);
        assert!(g[0].issues.iter().any(|i| i.contains("판이 2개")));
        // 옮길 것은 지난 판(v1.0) 하나 — 최신판의 pdf 는 남는다.
        let stale = stale_in_place(&g[0]);
        assert_eq!(stale.len(), 1, "{stale:?}");
        assert!(stale[0].contains("v1.0"));
    }
}
