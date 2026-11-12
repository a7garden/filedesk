//! 본문 색인을 채우는 뒷일.
//!
//! - 할 일 줄이 둘이다: 빠른 문서(hwpx · docx · pptx · xlsx · txt · md · csv)와 pdf. pdf 는 한 개에 수 초가 걸려
//!   (2026.11.11 실측: pdf 74개 305초 · 나머지 246개 4초) 빠른 문서를 막지 않게 따로, 스레드 둘까지만 쓴다.
//! - 이미 담긴 문서(고친 때 · 크기가 같다)는 건너뛴다 — 껐다 켜도 이어서 한다.
//! - 뽑다가 앱이 죽은 파일은 다음에 건너뛴다 (`current-N.txt` 에 적어 두고, 켤 때 남아 있으면 「못 뽑는 파일」로 옮긴다).
//!   못 뽑은 파일(깨진 pdf · 암호)은 `failed.txt` 에 적고, 고친 때가 바뀌기 전에는 다시 하지 않는다.
//! - 「잠시 멈춤」이면 쉰다. 스레드는 시작할 때 `on_thread` 로 우선순위를 낮춘다 (화면 쪽이 넘긴다).
//! - 바뀐 것은 20초마다 한 번 commit 한다.

use std::collections::{HashSet, VecDeque};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use fd_index::scope::Scope;
use serde::Serialize;

use crate::ContentIndex;

const PDF_WORKERS: usize = 2;
const COMMIT_EVERY: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentStatus {
    /// 담긴 문서 수.
    pub indexed: u64,
    /// 남은 일 (pdf 포함).
    pub queued: u64,
    pub pdf_left: u64,
    pub failed: u64,
    pub paused: bool,
}

struct Job {
    path: String,
    modified: i64,
    size: u64,
}

struct Inner {
    index: Arc<ContentIndex>,
    dir: PathBuf,
    fast: Mutex<VecDeque<Job>>,
    slow: Mutex<VecDeque<Job>>,
    queued: Mutex<HashSet<String>>,
    failed: Mutex<HashSet<String>>,
    scope: RwLock<Scope>,
    paused: AtomicBool,
    stop: AtomicBool,
    dirty: AtomicBool,
    done: AtomicU64,
}

#[derive(Clone)]
pub struct Worker {
    inner: Arc<Inner>,
}

fn fail_key(path: &str, modified: i64) -> String {
    format!("{}|{modified}", fd_index::norm(path))
}

impl Worker {
    /// 뒷일을 시작한다. `dir` 은 기록(`failed.txt` · `current-N.txt`) 자리.
    pub fn start(index: Arc<ContentIndex>, dir: PathBuf, scope: Scope, on_thread: fn()) -> Worker {
        let _ = std::fs::create_dir_all(&dir);
        let mut failed: HashSet<String> = std::fs::read_to_string(dir.join("failed.txt")).unwrap_or_default().lines().map(str::to_string).collect();
        // 뽑다가 죽은 파일
        for i in 0..=PDF_WORKERS {
            let f = dir.join(format!("current-{i}.txt"));
            if let Ok(s) = std::fs::read_to_string(&f) {
                if !s.trim().is_empty() {
                    failed.insert(s.trim().to_string());
                    let _ = append(&dir.join("failed.txt"), s.trim());
                }
                let _ = std::fs::remove_file(&f);
            }
        }
        let w = Worker {
            inner: Arc::new(Inner {
                index,
                dir,
                fast: Mutex::new(VecDeque::new()),
                slow: Mutex::new(VecDeque::new()),
                queued: Mutex::new(HashSet::new()),
                failed: Mutex::new(failed),
                scope: RwLock::new(scope),
                paused: AtomicBool::new(false),
                stop: AtomicBool::new(false),
                dirty: AtomicBool::new(false),
                done: AtomicU64::new(0),
            }),
        };
        for slot in 0..=PDF_WORKERS {
            let me = w.clone();
            let _ = std::thread::Builder::new().name(format!("fd-content-{slot}")).spawn(move || {
                on_thread();
                me.run(slot);
            });
        }
        let me = w.clone();
        let _ = std::thread::Builder::new().name("fd-content-commit".into()).spawn(move || me.committer());
        w
    }

    /// 이 문서를 담을 일감으로 받는다 (담을 만하고 · 범위 안이고 · 아직 안 담겼으면).
    pub fn offer(&self, path: &str, ext: &str, size: u64, modified: i64) {
        if !fd_core::text::worth(ext, size) {
            return;
        }
        let key = fd_index::norm(path);
        if self.inner.scope.read().unwrap().no_content(&key) {
            return;
        }
        if self.inner.failed.lock().unwrap().contains(&fail_key(path, modified)) {
            return;
        }
        if self.inner.index.lookup(path) == Some((modified, size)) {
            return;
        }
        if !self.inner.queued.lock().unwrap().insert(key) {
            return;
        }
        let job = Job { path: path.to_string(), modified, size };
        if ext == "pdf" {
            self.inner.slow.lock().unwrap().push_back(job);
        } else {
            self.inner.fast.lock().unwrap().push_back(job);
        }
    }

    /// 바뀐 경로 하나 — 있으면 다시 담고, 없어졌으면 뺀다.
    pub fn offer_path(&self, path: &str) {
        match fd_core::list::entry_at(std::path::Path::new(path)) {
            Some(e) if !e.is_dir => self.offer(&e.path, &e.ext, e.size, e.modified),
            Some(_) => {}
            None => {
                self.inner.index.remove(path);
                self.inner.dirty.store(true, Ordering::Relaxed);
            }
        }
    }

    /// 찾기 결과에서 없어진 문서를 뺀다.
    pub fn forget(&self, path: &str) {
        self.inner.index.remove(path);
        self.inner.dirty.store(true, Ordering::Relaxed);
    }

    pub fn set_scope(&self, scope: Scope) {
        *self.inner.scope.write().unwrap() = scope;
    }

    pub fn pause(&self, on: bool) {
        self.inner.paused.store(on, Ordering::Relaxed);
    }

    pub fn stop(&self) {
        self.inner.stop.store(true, Ordering::Relaxed);
        let _ = self.inner.index.commit();
    }

    pub fn status(&self) -> ContentStatus {
        let fast = self.inner.fast.lock().unwrap().len() as u64;
        let slow = self.inner.slow.lock().unwrap().len() as u64;
        ContentStatus {
            indexed: self.inner.index.count(),
            queued: fast + slow,
            pdf_left: slow,
            failed: self.inner.failed.lock().unwrap().len() as u64,
            paused: self.inner.paused.load(Ordering::Relaxed),
        }
    }

    /// 다 지우고 처음부터 (일감은 부르는 쪽이 다시 준다).
    pub fn clear(&self) {
        self.inner.fast.lock().unwrap().clear();
        self.inner.slow.lock().unwrap().clear();
        self.inner.queued.lock().unwrap().clear();
        self.inner.failed.lock().unwrap().clear();
        let _ = std::fs::remove_file(self.inner.dir.join("failed.txt"));
        let _ = self.inner.index.clear();
    }

    pub fn index(&self) -> &Arc<ContentIndex> {
        &self.inner.index
    }

    /// 0 번은 빠른 문서, 나머지는 pdf.
    fn run(&self, slot: usize) {
        let current = self.inner.dir.join(format!("current-{slot}.txt"));
        while !self.inner.stop.load(Ordering::Relaxed) {
            if self.inner.paused.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
            let job = if slot == 0 { self.inner.fast.lock().unwrap().pop_front() } else { self.inner.slow.lock().unwrap().pop_front() };
            let Some(job) = job else {
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };
            let key = fail_key(&job.path, job.modified);
            let _ = std::fs::write(&current, &key);
            let text = fd_core::text::extract(std::path::Path::new(&job.path));
            let _ = std::fs::remove_file(&current);
            self.inner.queued.lock().unwrap().remove(&fd_index::norm(&job.path));
            match text {
                Some(t) if !t.trim().is_empty() => {
                    if self.inner.index.upsert(&job.path, job.modified, job.size, &t).is_ok() {
                        self.inner.dirty.store(true, Ordering::Relaxed);
                    }
                }
                _ => {
                    let _ = append(&self.inner.dir.join("failed.txt"), &key);
                    self.inner.failed.lock().unwrap().insert(key);
                }
            }
            self.inner.done.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn committer(&self) {
        let mut last = Instant::now();
        while !self.inner.stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_secs(1));
            if last.elapsed() >= COMMIT_EVERY && self.inner.dirty.swap(false, Ordering::Relaxed) {
                let _ = self.inner.index.commit();
                last = Instant::now();
            }
        }
    }
}

fn append(file: &std::path::Path, line: &str) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file)?;
    writeln!(f, "{line}")
}
