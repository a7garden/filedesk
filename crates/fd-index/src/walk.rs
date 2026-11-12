//! 폴더를 나눠 훑어 표를 채운다 — NTFS 가 아닌 드라이브(exFAT · ReFS)와, 관리자 서비스가 없을 때의 앱 안 엔진이 쓴다.
//!
//! 하위 폴더마다 rayon 일감으로 나눠 읽고(`std::fs::read_dir` — Windows 에서는 FindNextFile 이 준 특성을 그대로 써서 항목마다 따로 묻지 않는다),
//! 다 읽은 나무를 한 번에 표에 넣는다. 열쇠는 넣을 때 매긴다.
//! 훑지 않는 폴더(`fd_core::search::skip_dir`) · 연결 지점(정션)은 들어가지 않는다 — 그 자리 훑기와 같은 결과가 나오게.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use fd_core::list::{ATTR_REPARSE, entry_at, entry_of};
use rayon::prelude::*;

use crate::table::{Method, Node, Volume};

/// 읽은 나무 한 마디.
struct Item {
    name: String,
    size: u64,
    modified: i64,
    created: i64,
    attrs: u32,
    is_dir: bool,
    children: Vec<Item>,
}

/// 훑는 동안 센 항목 수 · 그만두기.
#[derive(Default)]
pub struct Progress {
    pub seen: AtomicU64,
    pub cancel: AtomicBool,
}

fn read_tree(dir: &Path, progress: &Progress) -> Vec<Item> {
    if progress.cancel.load(Ordering::Relaxed) {
        return Vec::new();
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut items: Vec<Item> = rd
        .flatten()
        .filter_map(|it| {
            let e = entry_of(&it)?;
            Some(Item { name: e.name, size: e.size, modified: e.modified, created: e.created, attrs: e.attrs, is_dir: e.is_dir, children: Vec::new() })
        })
        .collect();
    progress.seen.fetch_add(items.len() as u64, Ordering::Relaxed);
    items.par_iter_mut().for_each(|it| {
        if it.is_dir && it.attrs & ATTR_REPARSE == 0 && !fd_core::search::skip_dir(&it.name) {
            it.children = read_tree(&dir.join(&it.name), progress);
        }
    });
    items
}

fn insert_tree(v: &mut Volume, parent: u64, items: Vec<Item>) {
    for it in items {
        let key = v.fresh_key();
        v.upsert(Node::new(key, parent, &it.name, it.size, it.modified, it.created, it.attrs, it.is_dir));
        if !it.children.is_empty() {
            insert_tree(v, key, it.children);
        }
    }
}

/// 드라이브 뿌리(`D:\`)를 통째로 훑어 새 표를 만든다.
pub fn build(root: &str, progress: &Progress) -> Volume {
    let mut v = Volume::new(root, Method::Walk);
    let tree = read_tree(Path::new(&v.root), progress);
    let root_key = v.root_key;
    insert_tree(&mut v, root_key, tree);
    v.updated = crate::now_ms();
    v
}

/// 경로 하나를 표에 맞춘다 (폴더 감시가 알려 온 것). 없어졌으면 그 아래까지 빼고, 새 폴더면 그 아래까지 훑는다.
/// 상위 폴더가 아직 표에 없으면 상위부터 맞춘다. 고친 것이 있으면 참.
pub fn refresh(v: &mut Volume, path: &Path) -> bool {
    let p = path.to_string_lossy();
    if crate::norm(&p) == crate::norm(&v.root) {
        return false;
    }
    let existing = v.find_path(&p);
    let Some(e) = entry_at(path) else {
        return existing.is_some_and(|k| v.remove_tree(k) > 0);
    };
    let Some(parent_path) = path.parent() else { return false };
    let parent = match v.find_path(&parent_path.to_string_lossy()) {
        Some(k) => k,
        None => {
            if !refresh(v, parent_path) {
                return false;
            }
            match v.find_path(&parent_path.to_string_lossy()) {
                Some(k) => k,
                None => return false,
            }
        }
    };
    if fd_core::search::skip_dir(&e.name) {
        return false;
    }
    let key = existing.unwrap_or_else(|| v.fresh_key());
    let was_dir = existing.and_then(|k| v.get(k)).is_some_and(|n| n.is_dir);
    v.upsert(Node::new(key, parent, &e.name, e.size, e.modified, e.created, e.attrs, e.is_dir));
    // 새로 생긴 폴더(옮겨 왔거나 풀었다)는 안에 든 것까지 — 감시는 폴더 하나만 알려 온다.
    if e.is_dir && !was_dir && e.attrs & ATTR_REPARSE == 0 {
        let tree = read_tree(path, &Progress::default());
        insert_tree(v, key, tree);
    }
    true
}

/// 폴더 하나를 다시 훑는다 (감시 버퍼가 넘쳤을 때). 그 아래를 빼고 새로 넣는다.
pub fn rescan(v: &mut Volume, dir: &Path) {
    let Some(key) = v.find_path(&dir.to_string_lossy()) else { return };
    let doomed: Vec<u64> = v.iter().filter(|n| v.descends_from(n, key)).map(|n| n.key).collect();
    for k in doomed {
        v.remove(k);
    }
    let tree = read_tree(dir, &Progress::default());
    insert_tree(v, key, tree);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_and_follow_changes() {
        let d = std::env::temp_dir().join(format!("fd-index-walk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("가/나")).unwrap();
        std::fs::create_dir_all(d.join("node_modules")).unwrap();
        std::fs::write(d.join("가/보고.pdf"), "x").unwrap();
        std::fs::write(d.join("가/나/회의.txt"), "x").unwrap();
        std::fs::write(d.join("node_modules/x.js"), "x").unwrap();
        let root = d.to_string_lossy().into_owned();
        let mut v = build(&root, &Progress::default());
        // 가 · 나 · 보고.pdf · 회의.txt · node_modules (안은 훑지 않는다)
        assert_eq!(v.len(), 5);
        assert!(v.find_path(&d.join("가/나/회의.txt").to_string_lossy()).is_some());
        // 새 폴더를 통째로
        std::fs::create_dir_all(d.join("다/라")).unwrap();
        std::fs::write(d.join("다/라/새.md"), "x").unwrap();
        assert!(refresh(&mut v, &d.join("다")));
        assert!(v.find_path(&d.join("다/라/새.md").to_string_lossy()).is_some());
        // 지운 폴더는 그 아래까지
        std::fs::remove_dir_all(d.join("가")).unwrap();
        assert!(refresh(&mut v, &d.join("가")));
        assert!(v.find_path(&d.join("가/보고.pdf").to_string_lossy()).is_none());
        assert_eq!(v.len(), 4); // node_modules · 다 · 라 · 새.md
        let _ = std::fs::remove_dir_all(&d);
    }
}
