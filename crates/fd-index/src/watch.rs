//! 폴더 감시로 표 따라가기 — 훑어 채운 볼륨(NTFS 가 아니거나 서비스가 없을 때).
//!
//! `ReadDirectoryChangesW`(notify) 로 드라이브 뿌리를 하위까지 본다. 알려 온 경로마다 `walk::refresh` 를 부를 수 있게 넘기고,
//! 버퍼가 넘쳐 무엇이 바뀌었는지 잃으면(`need_rescan`) 그 뿌리를 다시 훑으라고 넘긴다.

use std::path::PathBuf;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// 감시가 넘기는 일.
pub enum Change {
    /// 이 경로들을 맞춘다.
    Paths(Vec<PathBuf>),
    /// 무엇이 바뀌었는지 잃었다 — 이 뿌리를 다시 훑는다.
    Rescan(PathBuf),
}

/// 뿌리들을 하위까지 본다. 돌려받은 감시를 들고 있어야 계속 본다 (버리면 멈춘다).
pub fn watch(roots: &[PathBuf], on: impl Fn(Change) + Send + 'static) -> notify::Result<RecommendedWatcher> {
    let rs: Vec<PathBuf> = roots.to_vec();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| match res {
        Ok(ev) => {
            if ev.need_rescan() {
                let root = ev.paths.first().and_then(|p| rs.iter().find(|r| p.starts_with(r)).cloned()).or_else(|| rs.first().cloned());
                if let Some(r) = root {
                    on(Change::Rescan(r));
                }
                return;
            }
            if !ev.paths.is_empty() {
                on(Change::Paths(ev.paths));
            }
        }
        Err(_) => {
            // 감시 자체가 깨졌다 — 모든 뿌리를 다시 훑게 한다.
            for r in &rs {
                on(Change::Rescan(r.clone()));
            }
        }
    })?;
    for r in roots {
        // 하나가 안 되어도(권한) 나머지는 본다.
        let _ = w.watch(r, RecursiveMode::Recursive);
    }
    Ok(w)
}
