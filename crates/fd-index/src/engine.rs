//! 앱 안 엔진 — 관리자 서비스가 없을 때 앱이 직접 색인한다 (설치하지 않았거나, 보안 프로그램이 막았거나, 개발 중).
//!
//! 켤 때 스냅숏을 읽어 바로 찾게 하고, 뒤에서 드라이브마다 다시 훑어 갈아 끼운 뒤 폴더 감시로 따라간다.
//! 하루에 한 번 다시 훑어 감시가 놓친 것(앱이 꺼져 있던 동안의 변경)을 맞춘다.
//! 2026.11.12 : 처음 씀. 서비스는 같은 표 · 찾기를 쓰되 NTFS 는 MFT · USN 으로 채운다 (`fd-indexd`).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use fd_core::query::QuerySpec;
use fd_core::search::Root;

use crate::proto::{Changes, IndexStatus, QueryOut, VolStatus};
use crate::scope::Scope;
use crate::table::Volume;
use crate::walk::Progress;
use crate::watch::Change;

/// 바뀐 파일 기록의 상한 — 넘치면 앞부분을 버리고 받는 쪽에 「처음부터」를 알린다.
const CHANGE_CAP: usize = 20_000;
/// 다시 훑는 간격.
const FULL_RESCAN: Duration = Duration::from_secs(24 * 3600);
/// 바뀐 것이 있을 때 스냅숏을 쓰는 간격.
const SAVE_EVERY: Duration = Duration::from_secs(600);

/// 바뀐 파일 기록 — 본문 색인이 따라간다.
#[derive(Default)]
pub struct ChangeLog {
    seq: u64,
    items: VecDeque<(u64, String)>,
}

impl ChangeLog {
    pub fn push(&mut self, path: String) {
        self.seq += 1;
        self.items.push_back((self.seq, path));
        while self.items.len() > CHANGE_CAP {
            self.items.pop_front();
        }
    }

    pub fn since(&self, since: u64) -> Changes {
        let first = self.items.front().map_or(self.seq + 1, |x| x.0);
        let reset = since + 1 < first && since < self.seq;
        Changes { seq: self.seq, paths: self.items.iter().filter(|x| x.0 > since).map(|x| x.1.clone()).collect(), reset }
    }
}

struct Inner {
    vols: RwLock<Vec<Volume>>,
    status: Mutex<Vec<VolStatus>>,
    dir: PathBuf,
    scope: RwLock<Scope>,
    changes: Mutex<ChangeLog>,
    progress: Progress,
    dirty: Mutex<bool>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    /// 드라이브 뿌리들(`C:\` …)을 색인하기 시작한다. `dir` 은 스냅숏 자리.
    pub fn start(roots: Vec<String>, dir: PathBuf, exclude: Vec<String>) -> Engine {
        let status = roots.iter().map(|r| VolStatus { root: r.clone(), method: "walk".into(), state: "building".into(), ..Default::default() }).collect();
        let e = Engine {
            inner: Arc::new(Inner {
                vols: RwLock::new(Vec::new()),
                status: Mutex::new(status),
                dir,
                scope: RwLock::new(Scope::for_current_user(&exclude)),
                changes: Mutex::new(ChangeLog::default()),
                progress: Progress::default(),
                dirty: Mutex::new(false),
                watcher: Mutex::new(None),
            }),
        };
        let me = e.clone();
        let _ = std::thread::Builder::new().name("fd-index".into()).spawn(move || me.run(roots));
        e
    }

    fn run(&self, roots: Vec<String>) {
        // 1. 스냅숏 — 있으면 바로 찾게
        for r in &roots {
            if let Ok(v) = crate::snapshot::load(&crate::snapshot::file_for(&self.inner.dir, r)) {
                self.set_status(r, |s| {
                    s.files = v.len() as u64;
                    s.updated = v.updated;
                    s.state = "ready".into();
                    s.note = "지난번 색인 — 다시 맞추는 중".into();
                });
                self.put(v);
            }
        }
        // 2. 감시 먼저 켠다 — 훑는 동안 바뀐 것도 잡게
        let paths: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
        let me = self.clone();
        if let Ok(w) = crate::watch::watch(&paths, move |c| me.on_change(c)) {
            *self.inner.watcher.lock().unwrap() = Some(w);
        }
        // 3. 다시 훑어 갈아 끼우고, 하루마다 되풀이
        loop {
            for r in &roots {
                if self.inner.progress.cancel.load(Ordering::Relaxed) {
                    return;
                }
                self.rebuild_one(r);
            }
            let mut waited = Duration::ZERO;
            while waited < FULL_RESCAN {
                std::thread::sleep(Duration::from_secs(5));
                waited += Duration::from_secs(5);
                if self.inner.progress.cancel.load(Ordering::Relaxed) {
                    return;
                }
                if waited.as_secs() % SAVE_EVERY.as_secs() == 0 {
                    self.save_if_dirty();
                }
                if self.take_rebuild_request() {
                    break;
                }
            }
        }
    }

    fn rebuild_one(&self, root: &str) {
        self.set_status(root, |s| s.state = if s.files > 0 { "ready".into() } else { "building".into() });
        let v = crate::walk::build(root, &self.inner.progress);
        if self.inner.progress.cancel.load(Ordering::Relaxed) {
            return;
        }
        let _ = crate::snapshot::save(&v, &crate::snapshot::file_for(&self.inner.dir, root));
        self.set_status(root, |s| {
            s.files = v.len() as u64;
            s.updated = v.updated;
            s.state = "ready".into();
            s.note.clear();
        });
        self.put(v);
        // 처음부터 다시 맞췄다 — 본문 색인도 다시 맞추게
        let mut c = self.inner.changes.lock().unwrap();
        c.push(String::new());
    }

    fn put(&self, v: Volume) {
        let mut vols = self.inner.vols.write().unwrap();
        match vols.iter_mut().find(|x| crate::norm(&x.root) == crate::norm(&v.root)) {
            Some(old) => *old = v,
            None => vols.push(v),
        }
    }

    fn set_status(&self, root: &str, f: impl FnOnce(&mut VolStatus)) {
        let mut st = self.inner.status.lock().unwrap();
        if let Some(s) = st.iter_mut().find(|s| crate::norm(&s.root) == crate::norm(root)) {
            f(s);
        }
    }

    fn on_change(&self, c: Change) {
        match c {
            Change::Paths(ps) => {
                let mut vols = self.inner.vols.write().unwrap();
                let mut log = self.inner.changes.lock().unwrap();
                for p in ps {
                    let s = crate::norm(&p.to_string_lossy());
                    if let Some(v) = vols.iter_mut().find(|v| crate::is_under(&s, &crate::norm(&v.root))) {
                        if crate::walk::refresh(v, &p) {
                            v.updated = crate::now_ms();
                        }
                    }
                    log.push(p.to_string_lossy().into_owned());
                }
                *self.inner.dirty.lock().unwrap() = true;
            }
            Change::Rescan(root) => {
                let mut vols = self.inner.vols.write().unwrap();
                let s = crate::norm(&root.to_string_lossy());
                if let Some(v) = vols.iter_mut().find(|v| crate::norm(&v.root) == s) {
                    crate::walk::rescan(v, &root);
                    v.updated = crate::now_ms();
                }
                self.inner.changes.lock().unwrap().push(String::new());
            }
        }
    }

    fn save_if_dirty(&self) {
        let mut d = self.inner.dirty.lock().unwrap();
        if !*d {
            return;
        }
        *d = false;
        drop(d);
        let vols = self.inner.vols.read().unwrap();
        for v in vols.iter() {
            let _ = crate::snapshot::save(v, &crate::snapshot::file_for(&self.inner.dir, &v.root));
        }
    }

    fn take_rebuild_request(&self) -> bool {
        let mut st = self.inner.status.lock().unwrap();
        let asked = st.iter().any(|s| s.state == "rebuild");
        if asked {
            for s in st.iter_mut() {
                s.state = "building".into();
            }
        }
        asked
    }

    /// 조건으로 찾는다. 아직 색인이 없는 뿌리는 `unresolved` 로 돌아온다.
    pub fn query(&self, spec: &QuerySpec, roots: Option<&[Root]>, all: bool, limit: usize) -> QueryOut {
        let vols = self.inner.vols.read().unwrap();
        let refs: Vec<&Volume> = vols.iter().collect();
        let scope = self.inner.scope.read().unwrap();
        let mut out = crate::query::search(&refs, spec, roots, all, limit, &scope);
        // 「모든 드라이브」인데 아직 색인이 없는 드라이브가 있으면 알린다 (부르는 쪽이 「일부 훑음」을 보인다).
        if roots.is_none() {
            let st = self.inner.status.lock().unwrap();
            for s in st.iter() {
                if !refs.iter().any(|v| crate::norm(&v.root) == crate::norm(&s.root)) {
                    out.unresolved.push(Root { path: s.root.clone(), recursive: true });
                }
            }
        }
        out
    }

    /// 이 뿌리를 색인이 맡는가 (볼륨이 이미 올라와 있다).
    pub fn covers(&self, path: &str) -> bool {
        let vols = self.inner.vols.read().unwrap();
        let refs: Vec<&Volume> = vols.iter().collect();
        crate::query::covers(&refs, path)
    }

    pub fn status(&self) -> IndexStatus {
        let st = self.inner.status.lock().unwrap().clone();
        let exclude = self.inner.scope.read().unwrap().exclude.clone();
        IndexStatus { service: false, service_version: 0, volumes: st, exclude }
    }

    /// 다시 만들기 — 다음 차례를 기다리지 않고 곧 다시 훑는다.
    pub fn rebuild(&self) {
        let mut st = self.inner.status.lock().unwrap();
        for s in st.iter_mut() {
            s.state = "rebuild".into();
        }
    }

    pub fn set_exclude(&self, paths: Vec<String>) {
        *self.inner.scope.write().unwrap() = Scope::for_current_user(&paths);
    }

    /// 뺄 자리를 통째로 — 서비스는 SYSTEM 계정이라 `USERPROFILE` 이 그 사용자가 아니다. 설치할 때 받은 프로필로 만든다.
    pub fn set_scope(&self, scope: Scope) {
        *self.inner.scope.write().unwrap() = scope;
    }

    pub fn changes(&self, since: u64) -> Changes {
        self.inner.changes.lock().unwrap().since(since)
    }

    /// 멈춘다 (감시를 풀고 스냅숏을 쓴다). 관리자 서비스로 갈아탈 때.
    pub fn stop(&self) {
        self.inner.progress.cancel.store(true, Ordering::Relaxed);
        *self.inner.watcher.lock().unwrap() = None;
        self.save_if_dirty();
    }

    /// 스냅숏 자리.
    pub fn dir(&self) -> &Path {
        &self.inner.dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn change_log_resets_when_overflowed() {
        let mut c = ChangeLog::default();
        c.push("a".into());
        c.push("b".into());
        let all = c.since(0);
        assert_eq!((all.seq, all.paths.len(), all.reset), (2, 2, false));
        assert_eq!(c.since(1).paths, ["b"]);
        for i in 0..CHANGE_CAP + 5 {
            c.push(format!("{i}"));
        }
        assert!(c.since(1).reset);
        assert!(!c.since(c.since(0).seq).reset);
    }
}
