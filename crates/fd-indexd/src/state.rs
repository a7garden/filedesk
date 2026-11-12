//! 서비스가 들고 있는 것 — NTFS 볼륨 표 · 그 밖의 고정 드라이브(앱 안 엔진과 같은 훑기 엔진) · 바뀐 파일 기록 · 설정.
//!
//! 뒤 스레드 하나가 1초마다 USN 저널을 읽어 표를 맞추고, 10분마다 바뀐 표를 스냅숏으로 쓴다.
//! 이름 파이프의 물음은 `answer` 가 읽기 자물쇠만 잡고 답한다.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use fd_core::query::QuerySpec;
use fd_core::search::Root;
use fd_index::engine::ChangeLog;
use fd_index::proto::{IndexStatus, QueryOut, Request, Response, VERSION, VolStatus};
use fd_index::scope::Scope;
use fd_index::table::{Method, Volume};
use fd_index::{Engine, norm, snapshot};
use serde::{Deserialize, Serialize};

use crate::ntfs::{self, Follow, NtfsVol};

/// `%ProgramData%\filedesk\config.json` — 설치할 때 쓴다.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// 파이프를 열어 줄 사용자 SID (설치한 사람).
    pub sid: String,
    /// 그 사용자의 프로필 폴더 — 다른 계정 폴더를 결과에서 빼는 기준.
    pub profile: String,
    /// 사용자가 뺀 폴더.
    pub exclude: Vec<String>,
}

pub fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join("filedesk")
}

pub fn config_file() -> PathBuf {
    data_dir().join("config.json")
}

pub fn load_config() -> Config {
    std::fs::read_to_string(config_file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_config(c: &Config) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir())?;
    let tmp = config_file().with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(c).map_err(std::io::Error::other)?)?;
    std::fs::rename(tmp, config_file())
}

/// 서비스 기록 — 사람이 문제를 볼 때만 연다.
pub fn log(msg: &str) {
    use std::io::Write;
    let _ = std::fs::create_dir_all(data_dir());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(data_dir().join("service.log")) {
        let _ = writeln!(f, "{} {msg}", fd_index::now_ms());
    }
}

/// 고정 드라이브 뿌리들 (`C:\` …).
pub fn fixed_drives() -> Vec<String> {
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows::core::HSTRING;
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i) as char))
        .filter(|r| unsafe { GetDriveTypeW(&HSTRING::from(r.as_str())) } == 3) // DRIVE_FIXED
        .collect()
}

pub struct State {
    ntfs: Mutex<Vec<NtfsVol>>,
    /// `ntfs` 와 같은 차례.
    vols: RwLock<Vec<Volume>>,
    status: Mutex<Vec<VolStatus>>,
    walk: Mutex<Option<Engine>>,
    walk_seq: Mutex<u64>,
    scope: RwLock<Scope>,
    changes: Mutex<ChangeLog>,
    config: Mutex<Config>,
    stop: AtomicBool,
    rebuild: AtomicBool,
    dirty: AtomicBool,
}

impl State {
    pub fn start() -> Arc<State> {
        let config = load_config();
        let scope = Scope::new(Some(config.profile.as_str()), &config.exclude);
        let s = Arc::new(State {
            ntfs: Mutex::new(Vec::new()),
            vols: RwLock::new(Vec::new()),
            status: Mutex::new(Vec::new()),
            walk: Mutex::new(None),
            walk_seq: Mutex::new(0),
            scope: RwLock::new(scope),
            changes: Mutex::new(ChangeLog::default()),
            config: Mutex::new(config),
            stop: AtomicBool::new(false),
            rebuild: AtomicBool::new(false),
            dirty: AtomicBool::new(false),
        });
        let me = s.clone();
        let _ = std::thread::Builder::new().name("fd-indexd".into()).spawn(move || me.run());
        s
    }

    pub fn sid(&self) -> String {
        self.config.lock().unwrap().sid.clone()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(e) = self.walk.lock().unwrap().as_ref() {
            e.stop();
        }
        self.save_snapshots();
    }

    pub fn stopping(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    fn snap_dir() -> PathBuf {
        data_dir().join("index")
    }

    fn set_status(&self, root: &str, f: impl FnOnce(&mut VolStatus)) {
        let mut st = self.status.lock().unwrap();
        match st.iter_mut().find(|s| norm(&s.root) == norm(root)) {
            Some(s) => f(s),
            None => {
                let mut s = VolStatus { root: root.to_string(), method: "ntfs".into(), ..Default::default() };
                f(&mut s);
                st.push(s);
            }
        }
    }

    /// MFT 를 통째로 읽어 새 표를 만든다.
    fn full_read(&self, nv: &NtfsVol) -> std::io::Result<Volume> {
        self.set_status(&nv.root, |s| s.state = "building".into());
        let t = Instant::now();
        let mut v = ntfs::read_all(nv)?;
        let usn = ntfs::stamp(nv, &mut v)?;
        log(&format!("{} MFT {}개 {}ms", nv.root, v.len(), t.elapsed().as_millis()));
        self.set_status(&nv.root, |s| {
            s.files = v.len() as u64;
            s.updated = v.updated;
            s.state = "ready".into();
            s.usn = usn;
            s.note = if usn { String::new() } else { "USN 저널 꺼짐 — 바뀐 것은 하루 한 번 다시 읽어 맞춘다".into() };
        });
        Ok(v)
    }

    fn run(self: Arc<Self>) {
        let mut walk_roots = Vec::new();
        for root in fixed_drives() {
            match NtfsVol::open(&root) {
                Ok(mut nv) => {
                    let file = snapshot::file_for(&Self::snap_dir(), &root);
                    let from_snap = snapshot::load(&file).ok().filter(|v| v.method == Method::Ntfs).and_then(|mut v| match ntfs::follow(&mut nv, &mut v) {
                        Ok(Follow::Changed(_)) => Some(v),
                        _ => None,
                    });
                    let vol = match from_snap {
                        Some(v) => {
                            self.set_status(&root, |s| {
                                s.files = v.len() as u64;
                                s.updated = v.updated;
                                s.state = "ready".into();
                                s.usn = true;
                            });
                            Some(v)
                        }
                        None => match self.full_read(&nv) {
                            Ok(v) => Some(v),
                            Err(e) => {
                                log(&format!("{root} MFT 를 읽지 못했다: {e}"));
                                None
                            }
                        },
                    };
                    match vol {
                        Some(v) => {
                            self.vols.write().unwrap().push(v);
                            self.ntfs.lock().unwrap().push(nv);
                            self.dirty.store(true, Ordering::Relaxed);
                        }
                        None => walk_roots.push(root),
                    }
                }
                Err(_) => walk_roots.push(root),
            }
        }
        if !walk_roots.is_empty() {
            let cfg = self.config.lock().unwrap().clone();
            let e = Engine::start(walk_roots, Self::snap_dir().join("walk"), cfg.exclude.clone());
            e.set_scope(Scope::new(Some(cfg.profile.as_str()), &cfg.exclude));
            *self.walk.lock().unwrap() = Some(e);
        }
        self.save_snapshots();
        let mut last_save = Instant::now();
        let mut last_full = Instant::now();
        while !self.stopping() {
            std::thread::sleep(Duration::from_secs(1));
            let full = self.rebuild.swap(false, Ordering::Relaxed) || last_full.elapsed() > Duration::from_secs(24 * 3600);
            if full {
                last_full = Instant::now();
            }
            self.follow_all(full);
            self.pull_walk_changes();
            if last_save.elapsed() > Duration::from_secs(600) {
                self.save_snapshots();
                last_save = Instant::now();
            }
        }
    }

    /// 저널을 따라간다. 끊겼거나 `full` 이면 MFT 를 다시 읽는다.
    fn follow_all(&self, full: bool) {
        let mut handles = self.ntfs.lock().unwrap();
        for (i, nv) in handles.iter_mut().enumerate() {
            let result = if full {
                Ok(Follow::Lost)
            } else {
                let mut vols = self.vols.write().unwrap();
                ntfs::follow(nv, &mut vols[i])
            };
            match result {
                Ok(Follow::Changed(paths)) => {
                    if !paths.is_empty() {
                        let mut c = self.changes.lock().unwrap();
                        for p in paths {
                            c.push(p);
                        }
                        self.dirty.store(true, Ordering::Relaxed);
                        let (files, updated) = {
                            let vols = self.vols.read().unwrap();
                            (vols[i].len() as u64, vols[i].updated)
                        };
                        self.set_status(&nv.root, |s| {
                            s.files = files;
                            s.updated = updated;
                        });
                    }
                }
                Ok(Follow::Lost) => {
                    // 읽는 동안은 지난 표로 답한다 — 다 읽으면 갈아 끼운다.
                    match self.full_read(nv) {
                        Ok(v) => {
                            self.vols.write().unwrap()[i] = v;
                            self.changes.lock().unwrap().push(String::new());
                            self.dirty.store(true, Ordering::Relaxed);
                        }
                        Err(e) => self.set_status(&nv.root, |s| {
                            s.state = "error".into();
                            s.note = format!("MFT 를 다시 읽지 못했다: {e}");
                        }),
                    }
                }
                Err(e) => self.set_status(&nv.root, |s| s.note = format!("USN 저널을 읽지 못했다: {e}")),
            }
        }
    }

    /// 훑기 엔진의 바뀐 파일을 이 기록으로 옮긴다.
    fn pull_walk_changes(&self) {
        let walk = self.walk.lock().unwrap();
        let Some(e) = walk.as_ref() else { return };
        let mut seq = self.walk_seq.lock().unwrap();
        let ch = e.changes(*seq);
        if ch.seq == *seq {
            return;
        }
        *seq = ch.seq;
        let mut c = self.changes.lock().unwrap();
        if ch.reset {
            c.push(String::new());
        }
        for p in ch.paths {
            c.push(p);
        }
    }

    fn save_snapshots(&self) {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let dir = Self::snap_dir();
        for v in self.vols.read().unwrap().iter() {
            if let Err(e) = snapshot::save(v, &snapshot::file_for(&dir, &v.root)) {
                log(&format!("{} 스냅숏을 쓰지 못했다: {e}", v.root));
            }
        }
    }

    fn query(&self, spec: &QuerySpec, roots: Option<Vec<Root>>, all: bool, limit: usize) -> QueryOut {
        let a = {
            let vols = self.vols.read().unwrap();
            let refs: Vec<&Volume> = vols.iter().collect();
            let scope = self.scope.read().unwrap();
            let mut a = fd_index::query::search(&refs, spec, roots.as_deref(), all, limit, &scope);
            if roots.is_none() {
                // 아직 다 읽지 못한 NTFS 드라이브
                for s in self.status.lock().unwrap().iter() {
                    if s.method == "ntfs" && !refs.iter().any(|v| norm(&v.root) == norm(&s.root)) {
                        a.unresolved.push(Root { path: s.root.clone(), recursive: true });
                    }
                }
            }
            a
        };
        let b = self.walk.lock().unwrap().as_ref().map(|e| e.query(spec, roots.as_deref(), all, limit));
        merge(a, b, roots.as_deref(), limit)
    }

    fn status(&self) -> IndexStatus {
        let mut volumes = self.status.lock().unwrap().clone();
        if let Some(e) = self.walk.lock().unwrap().as_ref() {
            volumes.extend(e.status().volumes);
        }
        IndexStatus { service: true, service_version: VERSION, volumes, exclude: self.config.lock().unwrap().exclude.clone() }
    }

    fn set_exclude(&self, paths: Vec<String>) {
        let mut c = self.config.lock().unwrap();
        c.exclude = paths;
        let _ = save_config(&c);
        let scope = Scope::new(Some(c.profile.as_str()), &c.exclude);
        if let Some(e) = self.walk.lock().unwrap().as_ref() {
            e.set_scope(scope.clone());
        }
        *self.scope.write().unwrap() = scope;
    }

    /// 파이프 물음 하나에 답한다.
    pub fn answer(&self, req: Request) -> Response {
        match req {
            Request::Hello { .. } => Response::Hello { version: VERSION, server: env!("CARGO_PKG_VERSION").into() },
            // 앱이 본문 색인 일감을 확장자마다 20만 개까지 받아 간다
            Request::Query { spec, roots, all, limit } => Response::Query(self.query(&spec, roots, all, limit.min(200_000))),
            Request::Status => Response::Status(self.status()),
            Request::Rebuild => {
                self.rebuild.store(true, Ordering::Relaxed);
                if let Some(e) = self.walk.lock().unwrap().as_ref() {
                    e.rebuild();
                }
                Response::Ok
            }
            Request::Exclude { paths } => {
                self.set_exclude(paths);
                Response::Ok
            }
            Request::Changes { since } => Response::Changes(self.changes.lock().unwrap().since(since)),
        }
    }
}

/// NTFS 표 결과와 훑기 엔진 결과를 합친다. 뿌리는 둘 다 못 푼 것만 「색인에 없다」.
pub fn merge(a: QueryOut, b: Option<QueryOut>, roots: Option<&[Root]>, limit: usize) -> QueryOut {
    let Some(b) = b else { return a };
    let mut items: Vec<_> = a.items.into_iter().chain(b.items).collect();
    items.sort_by(|x, y| y.modified.max(y.created).cmp(&x.modified.max(x.created)));
    let truncated = a.truncated || b.truncated || items.len() > limit;
    items.truncate(limit);
    let unresolved = match roots {
        Some(_) => a.unresolved.into_iter().filter(|r| b.unresolved.iter().any(|x| norm(&x.path) == norm(&r.path))).collect(),
        None => a.unresolved.into_iter().chain(b.unresolved).collect(),
    };
    let indexed_at = [a.indexed_at, b.indexed_at].into_iter().filter(|t| *t > 0).min().unwrap_or(0);
    QueryOut { items, truncated, unresolved, indexed_at }
}
