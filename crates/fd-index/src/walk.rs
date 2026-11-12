//! 폴더를 나눠 훑어 표를 채운다 — NTFS 가 아닌 드라이브(exFAT · ReFS)와, 관리자 서비스가 없을 때의 앱 안 엔진이 쓴다.
//!
//! 하위 폴더마다 rayon 일감으로 나눠 읽고(`std::fs::read_dir` — Windows 에서는 FindNextFile 이 준 특성을 그대로 써서 항목마다 따로 묻지 않는다),
//! 다 읽은 나무를 한 번에 표에 넣는다. 열쇠는 넣을 때 매긴다.
//! 훑지 않는 폴더(`fd_core::search::skip_dir`) · 연결 지점(정션)은 들어가지 않는다 — 그 자리 훑기와 같은 결과가 나오게.

use std::path::{Path, PathBuf};
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
    v.reserve(count(&tree));
    let root_key = v.root_key;
    insert_tree(&mut v, root_key, tree);
    v.updated = crate::now_ms();
    v
}

fn count(items: &[Item]) -> usize {
    items.iter().map(|it| 1 + count(&it.children)).sum()
}

/// 훑지 않는 폴더 안의 경로인가 — 뿌리 아래 마디 중 마지막을 뺀 어느 하나라도 `skip_dir` 이면.
/// 마지막 마디는 보지 않는다: 훑기도 `node_modules` 폴더 자신은 담고 그 안만 들어가지 않는다.
/// 2026.11.12 : 감시가 알려 온 경로를 이것으로 거른다. 거르지 않아 빌드 산출물(`target`) · `Windows` 안이
/// 감시로 계속 들어와, 실측 D: 표의 37% 가 `target` 안이었다.
pub fn skipped(v: &Volume, path: &Path) -> bool {
    let p = crate::norm(&path.to_string_lossy());
    let root = crate::norm(&v.root);
    let Some(rest) = p.strip_prefix(root.as_str()) else { return false };
    let comps: Vec<&str> = rest.split('\\').filter(|c| !c.is_empty()).collect();
    comps.len() > 1 && comps[..comps.len() - 1].iter().any(|c| fd_core::search::skip_dir(c))
}

/// 감시가 알려 온 경로들을 표에 맞춘다. 없어졌으면 그 아래까지 빼고, 새 폴더면 그 아래까지 훑는다.
/// 훑지 않는 폴더 안은 건너뛴다. 맞춘 경로들을 돌려준다 (본문 색인이 따라간다).
pub fn refresh(v: &mut Volume, paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut gone_dirs = Vec::new();
    let mut done = Vec::new();
    for p in paths {
        if !skipped(v, p) && refresh_one(v, p, &mut gone_dirs) {
            done.push(p.clone());
        }
    }
    // 없어진 폴더는 모아서 한 번에 — 그 아래를 찾느라 표를 통째로 훑는다
    v.remove_trees(&gone_dirs, true);
    done
}

/// 경로 하나. 상위 폴더가 아직 표에 없으면 상위부터 맞춘다. 없어진 폴더는 `gone_dirs` 에 모으고 여기서 빼지 않는다
/// (먼저 빼면 그 아래 항목의 사슬이 끊겨 `remove_trees` 가 찾지 못한다). 고친 것이 있으면 참.
fn refresh_one(v: &mut Volume, path: &Path, gone_dirs: &mut Vec<u64>) -> bool {
    let p = path.to_string_lossy();
    if crate::norm(&p) == crate::norm(&v.root) {
        return false;
    }
    let existing = v.find_path(&p);
    let Some(e) = entry_at(path) else {
        let Some(k) = existing else { return false };
        // 파일은 그 한 칸만 — 아래가 없으니 표를 훑을 까닭이 없다
        if v.get(k).is_some_and(|n| n.is_dir) {
            gone_dirs.push(k);
        } else {
            v.remove(k);
        }
        return true;
    };
    let Some(parent_path) = path.parent() else { return false };
    let parent = match v.find_path(&parent_path.to_string_lossy()) {
        Some(k) => k,
        None => {
            if !refresh_one(v, parent_path, gone_dirs) {
                return false;
            }
            match v.find_path(&parent_path.to_string_lossy()) {
                Some(k) => k,
                None => return false,
            }
        }
    };
    let key = existing.unwrap_or_else(|| v.fresh_key());
    let was_dir = existing.and_then(|k| v.get(k)).is_some_and(|n| n.is_dir);
    v.upsert(Node::new(key, parent, &e.name, e.size, e.modified, e.created, e.attrs, e.is_dir));
    // 새로 생긴 폴더(옮겨 왔거나 풀었다)는 안에 든 것까지 — 감시는 폴더 하나만 알려 온다.
    // 훑지 않는 폴더는 훑기와 같게 자신만 담고 안은 들어가지 않는다.
    if e.is_dir && !was_dir && e.attrs & ATTR_REPARSE == 0 && !fd_core::search::skip_dir(&e.name) {
        let tree = read_tree(path, &Progress::default());
        v.reserve(count(&tree));
        insert_tree(v, key, tree);
    }
    true
}

/// 폴더 하나를 다시 훑는다 (감시 버퍼가 넘쳤을 때). 그 아래를 빼고 새로 넣는다.
pub fn rescan(v: &mut Volume, dir: &Path) {
    let Some(key) = v.find_path(&dir.to_string_lossy()) else { return };
    v.remove_trees(&[key], false);
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
        assert_eq!(refresh(&mut v, &[d.join("다")]).len(), 1);
        assert!(v.find_path(&d.join("다/라/새.md").to_string_lossy()).is_some());
        // 훑지 않는 폴더 안은 감시가 알려 와도 담지 않는다
        std::fs::create_dir_all(d.join("node_modules/pkg/lib")).unwrap();
        std::fs::write(d.join("node_modules/pkg/lib/a.js"), "x").unwrap();
        assert!(refresh(&mut v, &[d.join("node_modules/pkg/lib/a.js"), d.join("node_modules/pkg")]).is_empty());
        assert_eq!(v.len(), 8); // 지은 것 다섯 · 다 · 라 · 새.md
        // 새로 생긴 훑지 않는 폴더는 자신만
        std::fs::create_dir_all(d.join("다/target/debug")).unwrap();
        refresh(&mut v, &[d.join("다/target")]);
        assert!(v.find_path(&d.join("다/target").to_string_lossy()).is_some());
        assert!(v.find_path(&d.join("다/target/debug").to_string_lossy()).is_none());
        // 지운 파일 하나 · 지운 폴더는 그 아래까지 — 한 번에
        std::fs::remove_file(d.join("다/라/새.md")).unwrap();
        std::fs::remove_dir_all(d.join("가")).unwrap();
        assert_eq!(refresh(&mut v, &[d.join("다/라/새.md"), d.join("가")]).len(), 2);
        assert!(v.find_path(&d.join("가/보고.pdf").to_string_lossy()).is_none());
        assert!(v.find_path(&d.join("다/라/새.md").to_string_lossy()).is_none());
        assert_eq!(v.len(), 4); // node_modules · 다 · 라 · target
        // 다시 훑기는 폴더 자신을 남긴다
        std::fs::write(d.join("다/라/b.txt"), "x").unwrap();
        rescan(&mut v, &d.join("다"));
        assert!(v.find_path(&d.join("다/라/b.txt").to_string_lossy()).is_some());
        assert!(v.find_path(&d.join("다").to_string_lossy()).is_some());
        let _ = std::fs::remove_dir_all(&d);
    }
}
