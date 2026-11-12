//! [10] 색인 — 찾기 조건 · 스마트 폴더가 어디서 찾을지 고르고, 본문 색인을 채우고, 색인 서비스를 설치한다.
//!
//! 찾는 길 (`run_query`)
//!   1. 메모 · 색 표시 조건(`색:빨강` · `메모:있음`)이 있으면 메모 파일에서 바로 — 그 표시가 붙은 것만 맞을 수 있다.
//!   2. 아니면 이름 색인 — 관리자 서비스가 답하면 서비스, 아니면 앱 안 엔진. 색인에 없는 뿌리(NAS · 아직 만드는 드라이브)는 그 자리에서 훑는다.
//!   3. 메모 글에서만 맞는 것을 더한다 (색인은 메모를 모른다).
//!   4. 「문서 본문까지」면 본문 색인에서 더한다. 한 글자 말뿐이라 좁힐 수 없으면 그 자리 훑기가 본문을 읽는다.
//!
//! 2026.11.12 : 처음 씀.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use fd_content::{ContentIndex, ContentStatus, Worker};
use fd_core::query::{Clock, QuerySpec};
use fd_core::search::{Found, Root};
use fd_index::proto::{IndexStatus, QueryOut, Request, Response};
use fd_index::{Engine, is_under, norm};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

type CmdResult<T> = Result<T, String>;

/// 앱이 들고 있는 색인 상태.
#[derive(Default)]
pub struct IndexHub {
    /// 서비스가 없을 때만.
    local: Mutex<Option<Engine>>,
    content: Mutex<Option<Worker>>,
    exclude: Mutex<Vec<String>>,
}

fn base_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("kr.seesun.filedesk"))
}

fn exclude_file() -> Option<PathBuf> {
    base_dir().map(|d| d.join("index-exclude.json"))
}

fn load_exclude() -> Vec<String> {
    exclude_file().and_then(|f| std::fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn fixed_drives() -> Vec<String> {
    fd_shell::places::drive_details().into_iter().filter(|d| d.kind == "fixed").map(|d| d.path).collect()
}

/// 색인에 맡기지 않을 자리 — NAS(UNC) · 네트워크 드라이브 · 이동식.
fn is_remote(path: &str) -> bool {
    if path.starts_with(r"\\") || path.starts_with("//") {
        return true;
    }
    let root: String = path.chars().take(2).collect::<String>() + "\\";
    fd_shell::system::drive_kind(&root) != "fixed"
}

impl IndexHub {
    fn local(&self) -> Option<Engine> {
        self.local.lock().unwrap().clone()
    }

    fn worker(&self) -> Option<Worker> {
        self.content.lock().unwrap().clone()
    }

    /// 켤 때 한 번 — 뒤 스레드에서 서비스를 보고, 없으면 앱 안 엔진을 띄우고, 본문 색인을 채운다.
    pub fn start(app: &AppHandle) {
        let app = app.clone();
        let _ = std::thread::Builder::new().name("fd-index-hub".into()).spawn(move || {
            let hub = app.state::<IndexHub>();
            let exclude = load_exclude();
            *hub.exclude.lock().unwrap() = exclude.clone();
            if fd_index::client::service_version().is_some() {
                let _ = fd_index::client::call(&Request::Exclude { paths: exclude.clone() });
            } else {
                hub.start_local(&exclude);
            }
            if let (Some(dir), Some(base)) = (fd_content::default_dir(), base_dir()) {
                match ContentIndex::open(&dir, true) {
                    Ok(ix) => {
                        let w = Worker::start(Arc::new(ix), base.join("content-work"), fd_index::scope::Scope::for_current_user(&exclude), fd_shell::system::background_thread);
                        *hub.content.lock().unwrap() = Some(w);
                    }
                    Err(e) => eprintln!("{e}"),
                }
            }
            hub.feed();
        });
    }

    fn start_local(&self, exclude: &[String]) {
        let Some(base) = base_dir() else { return };
        let e = Engine::start(fixed_drives(), base.join("index"), exclude.to_vec());
        *self.local.lock().unwrap() = Some(e);
    }

    /// 이름 색인에 묻는다. 서비스도 앱 안 엔진도 없으면 None.
    fn index_query(&self, spec: &QuerySpec, roots: Option<Vec<Root>>, all: bool, limit: usize) -> Option<(QueryOut, bool)> {
        if let Ok(Response::Query(q)) = fd_index::client::call(&Request::Query { spec: spec.clone(), roots: roots.clone(), all, limit }) {
            return Some((q, true));
        }
        self.local().map(|e| (e.query(spec, roots.as_deref(), all, limit), false))
    }

    fn index_status(&self) -> IndexStatus {
        if let Ok(Response::Status(s)) = fd_index::client::call(&Request::Status) {
            return s;
        }
        self.local().map(|e| e.status()).unwrap_or_default()
    }

    fn changes(&self, since: u64) -> Option<(fd_index::Changes, bool)> {
        if let Ok(Response::Changes(c)) = fd_index::client::call(&Request::Changes { since }) {
            return Some((c, true));
        }
        self.local().map(|e| (e.changes(since), false))
    }

    /// 본문 색인에 넣을 문서를 이름 색인에서 모두 받아 넘긴다.
    fn enumerate(&self) {
        let Some(w) = self.worker() else { return };
        for ext in fd_core::text::EXTS {
            let spec = QuerySpec { exts: vec![ext.to_string()], ..Default::default() };
            if let Some((out, _)) = self.index_query(&spec, None, false, 200_000) {
                for e in out.items {
                    w.offer(&e.path, &e.ext, e.size, e.modified);
                }
            }
        }
    }

    /// 이름 색인이 다 서면 문서를 넘기고, 그 뒤로는 5초마다 바뀐 파일을 따라간다.
    fn feed(&self) {
        // 이름 색인이 설 때까지 (만드는 중인 드라이브가 있으면 기다린다 — 오류 난 드라이브는 기다리지 않는다)
        let t = Instant::now();
        loop {
            let st = self.index_status();
            if !st.volumes.is_empty() && st.volumes.iter().all(|v| v.state != "building" && v.state != "rebuild") {
                break;
            }
            if t.elapsed() > Duration::from_secs(3600) {
                break;
            }
            std::thread::sleep(Duration::from_secs(5));
        }
        self.enumerate();
        let (mut seq, mut from_service) = self.changes(0).map(|(c, s)| (c.seq, s)).unwrap_or((0, false));
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let Some(w) = self.worker() else { continue };
            let Some((ch, svc)) = self.changes(seq) else { continue };
            if svc != from_service {
                // 서비스로 갈아탔다(또는 그 반대) — 번호가 다른 기록이다
                from_service = svc;
                seq = ch.seq;
                self.enumerate();
                continue;
            }
            seq = ch.seq;
            if ch.reset || ch.paths.iter().any(|p| p.is_empty()) {
                self.enumerate();
                continue;
            }
            for p in ch.paths {
                w.offer_path(&p);
            }
        }
    }
}

// ───────────────────────── 찾기 ─────────────────────────

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueryScope {
    /// 모든 고정 드라이브.
    pub all: bool,
    pub roots: Vec<Root>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryArgs {
    pub scope: QueryScope,
    pub text: String,
    /// (id, 이름, 확장자들) — 화면 설정의 종류.
    #[serde(default)]
    pub kinds: Vec<(String, String, Vec<String>)>,
    #[serde(default)]
    pub show_hidden: bool,
    #[serde(default)]
    pub content: bool,
    #[serde(default)]
    pub tz_offset_min: i32,
    #[serde(default)]
    pub limit: Option<usize>,
    /// 뒤에서 세는 찾기(왼쪽 개수 · 고치기 창 미리 보기) — 칸의 찾기를 멈추지 않고, 그 자리 훑기는 상한까지 끝낸다.
    #[serde(default)]
    pub background: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub items: Vec<Found>,
    pub spec: QuerySpec,
    pub truncated: bool,
    pub cancelled: bool,
    pub scanned: usize,
    /// 어느 길로 찾았나 — `service` · `local` · `live` · `content` · `notes`.
    pub sources: Vec<String>,
    /// 이름 색인을 맞춘 때 (가장 오래된 것).
    pub indexed_at: i64,
    /// 색인이 다 서지 않아 일부만 찾았다.
    pub partial: bool,
    pub content_status: Option<ContentStatus>,
}

/// 뿌리 안인가 — 하위까지(`recursive`)면 그 아래 어디든, 아니면 바로 아래만. 뿌리 자신은 아니다.
fn in_roots(path: &str, scope: &QueryScope) -> bool {
    if scope.all {
        return true;
    }
    let p = norm(path);
    scope.roots.iter().any(|r| {
        let root = norm(&r.path);
        if p == root || !is_under(&p, &root) {
            return false;
        }
        r.recursive || Path::new(&p).parent().map(|x| norm(&x.to_string_lossy())) == Some(root)
    })
}

fn spec_of(text: &str, kinds: &[(String, String, Vec<String>)], tz: i32) -> QuerySpec {
    let mut spec = fd_core::query::parse(text, Clock::now(tz));
    let table = if kinds.is_empty() { fd_core::query::default_kinds() } else { kinds.to_vec() };
    spec.resolve_kinds(&table);
    spec
}

pub fn run_query(hub: &IndexHub, a: QueryArgs, generation: Option<u64>) -> QueryResult {
    let spec = spec_of(&a.text, &a.kinds, a.tz_offset_min);
    let limit = a.limit.unwrap_or(2000).clamp(1, 20_000);
    let mut r = QueryResult { spec: spec.clone(), ..Default::default() };
    if spec.is_empty() || (!a.scope.all && a.scope.roots.is_empty()) {
        return r;
    }
    let store = fd_core::memo::default_file().and_then(|f| fd_core::memo::MemoStore::load(&f).ok());
    let (memos, colors) = fd_core::search::load_notes();
    let mut seen: HashSet<String> = HashSet::new();
    let push = |r: &mut QueryResult, seen: &mut HashSet<String>, f: Found| {
        if seen.insert(norm(&f.entry.path)) {
            r.items.push(f);
        }
    };
    let notes_of = |path: &str| {
        let k = fd_core::memo::key(path);
        (memos.get(&k).cloned(), colors.get(&k).cloned())
    };

    if spec.needs_notes() {
        // 1. 메모 · 색 표시가 붙은 것만 맞을 수 있다 — 메모 파일에서 바로
        r.sources.push("notes".into());
        if let Some(s) = &store {
            for m in s.all() {
                if !in_roots(&m.path, &a.scope) {
                    continue;
                }
                let Some(e) = fd_core::list::entry_at(Path::new(&m.path)) else { continue };
                if !a.show_hidden && e.attrs & (fd_core::list::ATTR_HIDDEN | fd_core::list::ATTR_SYSTEM) != 0 {
                    continue;
                }
                let memo = (!m.text.is_empty()).then(|| m.text.clone());
                if spec.entry_ok(&e, memo.as_deref(), m.color.as_deref()).is_some() {
                    push(&mut r, &mut seen, Found { entry: e, memo, snippet: None });
                }
            }
        }
    } else {
        // 2. 이름 색인 · 그 자리 훑기
        let (remote, local_roots): (Vec<Root>, Vec<Root>) = a.scope.roots.iter().cloned().partition(|x| is_remote(&x.path));
        let mut live: Vec<Root> = remote;
        let index_roots = if a.scope.all { None } else { Some(local_roots.clone()) };
        let asked = a.scope.all || !local_roots.is_empty();
        match asked.then(|| hub.index_query(&spec, index_roots, a.show_hidden, limit)).flatten() {
            Some((out, svc)) => {
                r.sources.push(if svc { "service".into() } else { "local".into() });
                r.indexed_at = out.indexed_at;
                r.truncated |= out.truncated;
                for e in out.items {
                    let (memo, color) = notes_of(&e.path);
                    if spec.entry_ok(&e, memo.as_deref(), color.as_deref()).is_some() {
                        push(&mut r, &mut seen, Found { entry: e, memo, snippet: None });
                    }
                }
                if !out.unresolved.is_empty() {
                    r.partial = a.scope.all;
                    live.extend(out.unresolved);
                }
            }
            None => live.extend(local_roots),
        }
        // 3. 메모 글에서만 맞는 것
        if !spec.terms.is_empty()
            && let Some(s) = &store
        {
            for m in s.all().filter(|m| !m.text.is_empty()) {
                if seen.contains(&norm(&m.path)) || !in_roots(&m.path, &a.scope) || !spec.terms_in(&m.text.to_lowercase()) {
                    continue;
                }
                let Some(e) = fd_core::list::entry_at(Path::new(&m.path)) else { continue };
                if spec.entry_ok(&e, Some(&m.text), m.color.as_deref()).is_some() {
                    push(&mut r, &mut seen, Found { entry: e, memo: Some(m.text.clone()), snippet: None });
                }
            }
        }
        // 그 자리 훑기 — 본문까지면 여기서 그 뿌리의 본문도 읽는다
        if !live.is_empty() {
            r.sources.push("live".into());
            // 「모든 드라이브」인데 아직 색인이 없는 드라이브는 시간 상한 안에서만
            let res = fd_core::search::query(&live, &spec, a.show_hidden, &memos, &colors, a.content, limit, Duration::from_secs(8), generation);
            r.scanned += res.scanned;
            r.truncated |= res.truncated;
            r.cancelled |= res.cancelled;
            for f in res.items {
                push(&mut r, &mut seen, f);
            }
        }
    }

    // 4. 본문 색인
    if a.content && !spec.terms.is_empty() && !r.cancelled
        && let Some(w) = hub.worker()
    {
        r.content_status = Some(w.status());
        match w.index().search(&spec.terms, limit) {
            Some(hits) => {
                r.sources.push("content".into());
                for h in hits {
                    if !in_roots(&h.path, &a.scope) || seen.contains(&norm(&h.path)) {
                        continue;
                    }
                    let Some(e) = fd_core::list::entry_at(Path::new(&h.path)) else {
                        w.forget(&h.path);
                        continue;
                    };
                    let (memo, color) = notes_of(&e.path);
                    if !a.show_hidden && e.attrs & (fd_core::list::ATTR_HIDDEN | fd_core::list::ATTR_SYSTEM) != 0 {
                        continue;
                    }
                    if spec.meta_ok(e.is_dir, &e.ext, e.size, e.modified, e.created) && spec.notes_ok(memo.as_deref(), color.as_deref()) && !spec.excluded_by(&e.name.to_lowercase()) {
                        push(&mut r, &mut seen, Found { entry: e, memo, snippet: Some(h.snippet) });
                    }
                }
            }
            None => r.partial = true,
        }
        if r.content_status.as_ref().is_some_and(|s| s.queued > 0) {
            r.partial = true;
        }
    }

    if r.items.len() > limit {
        r.items.truncate(limit);
        r.truncated = true;
    }
    for f in &mut r.items {
        f.entry.kind = fd_shell::icon::type_name(&f.entry.ext, f.entry.is_dir);
    }
    r
}

#[tauri::command]
pub fn parse_query(text: String, kinds: Option<Vec<(String, String, Vec<String>)>>, tz_offset_min: Option<i32>) -> QuerySpec {
    spec_of(&text, &kinds.unwrap_or_default(), tz_offset_min.unwrap_or(0))
}

/// 조건으로 찾는다 — 찾기 칸(하위 폴더까지 · 모든 드라이브 · 문서 본문까지) · 스마트 폴더 · 왼쪽 개수.
/// 새 찾기가 오면 앞선 그 자리 훑기는 멈춘다 (`search::next_generation`).
#[tauri::command]
pub async fn query_files(app: AppHandle, args: QueryArgs) -> CmdResult<QueryResult> {
    let generation = (!args.background).then(fd_core::search::next_generation);
    tauri::async_runtime::spawn_blocking(move || {
        let hub = app.state::<IndexHub>();
        run_query(&hub, args, generation)
    })
    .await
    .map_err(|e| e.to_string())
}

// ───────────────────────── 상태 · 설정 ─────────────────────────

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubStatus {
    pub index: IndexStatus,
    pub content: Option<ContentStatus>,
    /// 앱과 함께 깔린 서비스 실행 파일이 있는가 (설치 단추를 보일지).
    pub bundled: bool,
    /// 앱이 아는 규약 판 — 서비스 판이 다르면 「서비스 업데이트」.
    pub app_version: u32,
    pub exclude: Vec<String>,
}

fn bundled_indexd(app: &AppHandle) -> Option<PathBuf> {
    let res = app.path().resource_dir().ok().map(|d| d.join("fd-indexd.exe"));
    let beside = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("fd-indexd.exe")));
    [res, beside].into_iter().flatten().find(|p| p.is_file())
}

fn hub_status(app: &AppHandle) -> HubStatus {
    let hub = app.state::<IndexHub>();
    HubStatus {
        index: hub.index_status(),
        content: hub.worker().map(|w| w.status()),
        bundled: bundled_indexd(app).is_some(),
        app_version: fd_index::proto::VERSION,
        exclude: hub.exclude.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub async fn index_status(app: AppHandle) -> CmdResult<HubStatus> {
    tauri::async_runtime::spawn_blocking(move || hub_status(&app)).await.map_err(|e| e.to_string())
}

/// 다시 만들기 — 이름 색인과 본문 색인을 처음부터.
#[tauri::command]
pub async fn index_rebuild(app: AppHandle) -> CmdResult<HubStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let hub = app.state::<IndexHub>();
        if fd_index::client::call(&Request::Rebuild).is_err()
            && let Some(e) = hub.local()
        {
            e.rebuild();
        }
        if let Some(w) = hub.worker() {
            w.clear();
        }
        let app2 = app.clone();
        let _ = std::thread::Builder::new().name("fd-content-again".into()).spawn(move || app2.state::<IndexHub>().enumerate());
        hub_status(&app)
    })
    .await
    .map_err(|e| e.to_string())
}

/// 결과 · 색인에서 뺄 폴더를 통째로 바꾼다.
#[tauri::command]
pub async fn index_exclude(app: AppHandle, paths: Vec<String>) -> CmdResult<HubStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let hub = app.state::<IndexHub>();
        let paths: Vec<String> = paths.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
        if let Some(f) = exclude_file() {
            if let Some(d) = f.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            std::fs::write(&f, serde_json::to_vec_pretty(&paths).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
        *hub.exclude.lock().unwrap() = paths.clone();
        let _ = fd_index::client::call(&Request::Exclude { paths: paths.clone() });
        if let Some(e) = hub.local() {
            e.set_exclude(paths.clone());
        }
        if let Some(w) = hub.worker() {
            w.set_scope(fd_index::scope::Scope::for_current_user(&paths));
        }
        Ok(hub_status(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn content_pause(app: AppHandle, paused: bool) {
    if let Some(w) = app.state::<IndexHub>().worker() {
        w.pause(paused);
    }
}

/// 서비스 설치 · 업데이트 · 지우기 — UAC 로 앱과 함께 깔린 `fd-indexd.exe` 를 관리자 권한으로 띄운다.
#[tauri::command]
pub async fn service_setup(app: AppHandle, action: String) -> CmdResult<HubStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe = bundled_indexd(&app).ok_or("색인 서비스 파일(fd-indexd.exe)이 앱 옆에 없다 — 설치 파일로 깐 앱에서 한다")?;
        let args = match action.as_str() {
            "install" => {
                let sid = fd_shell::system::user_sid().ok_or("이 사용자의 SID 를 읽지 못했다")?;
                let profile = std::env::var("USERPROFILE").unwrap_or_default();
                format!("install --sid {sid} --profile \"{profile}\"")
            }
            "update" => "update".to_string(),
            "uninstall" => "uninstall".to_string(),
            _ => return Err(format!("모르는 일: {action}")),
        };
        let code = fd_shell::system::run_elevated(&exe.to_string_lossy(), &args).map_err(|e| e.to_string())?;
        if code != 0 {
            let what = if action == "uninstall" { "지우지" } else { "설치하지" };
            return Err(format!("색인 서비스를 {what} 못했다 (끝난 코드 {code}) — %ProgramData%\\filedesk\\service.log 에 까닭이 있다"));
        }
        let hub = app.state::<IndexHub>();
        if action == "uninstall" {
            let exclude = hub.exclude.lock().unwrap().clone();
            if hub.local().is_none() {
                hub.start_local(&exclude);
            }
        } else {
            // 서비스가 파이프를 열 때까지
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(15) && fd_index::client::service_version().is_none() {
                std::thread::sleep(Duration::from_millis(300));
            }
            if fd_index::client::service_version().is_some() {
                if let Some(e) = hub.local.lock().unwrap().take() {
                    e.stop();
                }
                let exclude = hub.exclude.lock().unwrap().clone();
                let _ = fd_index::client::call(&Request::Exclude { paths: exclude });
            }
        }
        Ok(hub_status(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}
