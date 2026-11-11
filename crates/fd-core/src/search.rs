//! 하위 폴더까지 찾기 — 이름 · 메모 글에 찾는 말이 다 들어 있는 항목.
//!
//! 화면의 「거르기」는 지금 폴더만 본다. 어디 있는지 모르는 파일은 이것으로 찾는다 (앱 Shift+Enter · `fd find`).
//! 색인 없이 그 자리에서 훑는다 — 수만 개 폴더도 몇 초 안에 끝나고, 색인을 두면 그 색인이 낡는 것을 따로 챙겨야 한다.
//! 끝이 없을 수 있어(드라이브 통째) 개수 · 시간 상한을 둔다. 상한에 닿으면 `truncated` 로 알린다.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::list::{Entry, entry_of};

/// 훑지 않는 폴더 — 사람이 찾는 파일이 없고, 들어가면 수십만 개다.
const SKIP_DIRS: &[&str] = &["node_modules", ".git", ".svn", "$recycle.bin", "system volume information", "target", "windows"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    #[serde(flatten)]
    pub entry: Entry,
    /// 메모 글에서 맞았으면 그 메모.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub root: String,
    pub query: String,
    pub items: Vec<Found>,
    /// 본 항목 수.
    pub scanned: usize,
    /// 개수 · 시간 상한에 닿아 다 보지 못했다.
    pub truncated: bool,
    /// 새 찾기가 시작돼 그만두었다.
    pub cancelled: bool,
}

/// 앞선 찾기를 그만두게 하는 번호 — 화면에서 글자를 칠 때마다 새 찾기가 시작된다.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// 새 찾기 번호를 받는다. 이 번호보다 앞선 찾기는 다음 폴더에서 멈춘다.
pub fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

/// `root` 아래에서 찾는다. `query` 를 빈칸으로 나눈 말이 이름(또는 메모)에 다 들어 있으면 맞다 (대소문자 무시).
/// `memos` 는 경로 열쇠(`memo::key`) → 글. 숨김 · 시스템 항목은 `all` 일 때만.
pub fn find(root: &Path, query: &str, all: bool, memos: &HashMap<String, String>, limit: usize, budget: Duration, generation: Option<u64>) -> SearchResult {
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    let started = Instant::now();
    let mut out = SearchResult { root: root.to_string_lossy().into_owned(), query: query.to_string(), items: Vec::new(), scanned: 0, truncated: false, cancelled: false };
    if terms.is_empty() {
        return out;
    }
    let hits = |s: &str| {
        let s = s.to_lowercase();
        terms.iter().all(|t| s.contains(t.as_str()))
    };
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if generation.is_some_and(|g| g != GENERATION.load(Ordering::SeqCst)) {
            out.cancelled = true;
            break;
        }
        if started.elapsed() > budget || out.items.len() >= limit {
            out.truncated = true;
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for item in rd.flatten() {
            out.scanned += 1;
            let Some(e) = entry_of(&item) else { continue };
            if !all && e.attrs & 0x6 != 0 {
                continue; // 숨김(0x2) · 시스템(0x4)
            }
            if e.is_dir && !SKIP_DIRS.contains(&e.name.to_lowercase().as_str()) && e.attrs & 0x400 == 0 {
                stack.push(item.path()); // 0x400 = 연결 지점 — 따라가면 같은 곳을 두 번 · 끝없이 돈다
            }
            let memo = memos.get(&crate::memo::key(&e.path));
            if hits(&e.name) {
                out.items.push(Found { entry: e, memo: memo.cloned() });
            } else if let Some(m) = memo.filter(|m| hits(m)) {
                out.items.push(Found { entry: e, memo: Some(m.clone()) });
            }
            if out.items.len() >= limit {
                out.truncated = true;
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_by_all_terms_and_memo() {
        let d = std::env::temp_dir().join(format!("fd-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("가/나")).unwrap();
        std::fs::create_dir_all(d.join("node_modules")).unwrap();
        for f in ["가/보고서_v1.pptx", "가/나/보고서_최종.hwpx", "가/회의록.txt", "node_modules/보고서.js"] {
            std::fs::write(d.join(f), "").unwrap();
        }
        let mut memos = HashMap::new();
        memos.insert(crate::memo::key(&d.join("가/회의록.txt").to_string_lossy()), "보고서 근거 회의".to_string());
        let r = find(&d, "보고서", false, &memos, 100, Duration::from_secs(5), None);
        let mut names: Vec<&str> = r.items.iter().map(|f| f.entry.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["보고서_v1.pptx", "보고서_최종.hwpx", "회의록.txt"]); // node_modules 는 건너뛴다
        let r = find(&d, "보고서 최종", false, &memos, 100, Duration::from_secs(5), None);
        assert_eq!(r.items.len(), 1);
        let r = find(&d, "보고서", false, &memos, 1, Duration::from_secs(5), None);
        assert!(r.truncated);
        let _ = std::fs::remove_dir_all(&d);
    }
}
