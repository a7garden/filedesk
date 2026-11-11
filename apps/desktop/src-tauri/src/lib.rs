//! filedesk 데스크톱 — 화면(React)과 셸(`fd-shell`) 사이의 명령.
//!
//! 목차
//!   [1] 공통 — 주 스레드에서 돌리기 · 창 손잡이
//!   [2] 목록 · 위치 · 주소
//!   [3] 열기 · 오른쪽 메뉴 · 셸 동사
//!   [3-1] 앱 안 보기 — 글 파일(md · txt) 읽기 · 쓰기 (`fd-core::textfile`) · 그림은 [9] 아이콘 프로토콜의 `raw:`
//!   [4] 파일 작업 — 이름 바꾸기 · 휴지통 · 복사/이동 · 새 폴더
//!   [5] 끌기 (앱 밖으로)
//!   [6] 폴더 변경 감시
//!   [7] 문서 — 판 묶기 · 새 판 내기 · 지난 판 옮기기
//!   [7-1] 메모 — 파일 · 폴더에 붙인 글 · 색 표시 (filedesk 가 관리 · `fd-core::memo`) · 하위 폴더까지 찾기
//!   [7-2] Claude 스킬 설치 (설정 창)
//!   [8] 설정 (즐겨찾기 · 열어 둔 탭 · 분할 · 열 너비)
//!   [8-1] 새 파일 (다운로드 · 바탕화면)
//!   [8-2] 업데이트 — GitHub 릴리즈의 latest.json (tauri-plugin-updater · 화면 쪽 `updater.ts`)
//!   [9] 아이콘 프로토콜 · 앱 시작

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fd_core::Entry;
use fd_shell::RawHwnd;
use fd_shell::menu::MenuPick;
use fd_shell::ops::Outcome;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

type CmdResult<T> = Result<T, String>;

// ───────────────────────────── [1] 공통 ─────────────────────────────

fn owner(window: &WebviewWindow) -> CmdResult<RawHwnd> {
    window.hwnd().map(|h| h.0 as RawHwnd).map_err(|e| e.to_string())
}

/// 주 스레드에서 `f` 를 돌리고 결과를 기다린다.
/// 오른쪽 메뉴 · 끌기는 창을 가진 스레드에서만 제대로 돈다 (`fd-shell` 머리말).
/// 명령은 async 라 tokio 스레드에서 오므로, 기다리는 일은 blocking 스레드로 넘긴다 — 주 스레드에서 기다리면 서로 막힌다.
async fn on_main<T: Send + 'static>(app: AppHandle, f: impl FnOnce() -> T + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(f());
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// STA 스레드에서 돌린다 (파일 작업 · 열기 · 종류 이름).
async fn on_sta<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(move || fd_shell::run_sta(f)).await.map_err(|e| e.to_string())
}

fn outcome(o: Outcome) -> &'static str {
    match o {
        Outcome::Done => "done",
        Outcome::Aborted => "aborted",
    }
}

// ───────────────────────────── [2] 목록 · 위치 · 주소 ─────────────────────────────

#[tauri::command]
async fn list_dir(path: String, show_hidden: bool) -> CmdResult<Vec<Entry>> {
    on_sta(move || {
        let mut list = fd_core::list_dir(Path::new(&path), show_hidden).map_err(|e| format!("{path}: {e}"))?;
        for e in &mut list {
            e.kind = fd_shell::icon::type_name(&e.ext, e.is_dir);
        }
        Ok(list)
    })
    .await?
}

#[derive(Serialize)]
struct PlaceOut {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct DriveOut {
    path: String,
    label: String,
    kind: &'static str,
    total: u64,
    free: u64,
}

#[derive(Serialize)]
struct Places {
    known: Vec<PlaceOut>,
    drives: Vec<DriveOut>,
}

/// 바탕화면 · 다운로드 · 문서 · 드라이브. 사용자가 고정한 위치는 설정(`[8]`)에 있다.
#[tauri::command]
async fn places() -> CmdResult<Places> {
    on_sta(|| {
        let conv = |v: Vec<fd_shell::places::Place>| v.into_iter().map(|p| PlaceOut { name: p.name, path: p.path }).collect();
        let drives = fd_shell::places::drive_details()
            .into_iter()
            .map(|d| DriveOut { path: d.path, label: d.label, kind: d.kind, total: d.total, free: d.free })
            .collect();
        Places { known: conv(fd_shell::places::known_folders()), drives }
    })
    .await
}

/// 주소창 입력을 폴더 경로로. 환경 변수를 풀고, 상대 경로는 지금 폴더 기준으로 본다.
/// 파일 경로를 넣으면 그 파일이 든 폴더로 간다 (선택은 화면이 맞춘다).
#[tauri::command]
async fn resolve_input(input: String, cwd: String) -> CmdResult<String> {
    // 「C:/a/b」처럼 빗금으로 넣어도 탐색기와 같은 꼴(역빗금)로 맞춘다 — 섞이면 같은 폴더를 다른 경로로 본다.
    let expanded = fd_shell::places::expand_env(input.trim().trim_matches('"')).replace('/', "\\");
    let mut p = PathBuf::from(&expanded);
    if p.is_relative() {
        p = Path::new(&cwd).join(p);
    }
    if p.is_dir() {
        return Ok(p.to_string_lossy().into_owned());
    }
    if p.is_file() {
        if let Some(parent) = p.parent() {
            return Ok(parent.to_string_lossy().into_owned());
        }
    }
    Err(format!("찾을 수 없는 경로: {expanded}"))
}

// ───────────────────────────── [3] 열기 · 오른쪽 메뉴 · 셸 동사 ─────────────────────────────

/// 연다. 폴더(또는 폴더를 가리키는 바로가기)면 열지 않고 이동할 경로를 돌려준다 — 탐색기 새 창이 뜨지 않게.
#[tauri::command]
async fn open_item(window: WebviewWindow, path: String) -> CmdResult<Option<String>> {
    let hwnd = owner(&window)?;
    on_sta(move || {
        let p = Path::new(&path);
        if p.is_dir() {
            return Ok(Some(path));
        }
        if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            if let Some(target) = fd_shell::ops::resolve_link(&path) {
                if Path::new(&target).is_dir() {
                    return Ok(Some(target));
                }
            }
        }
        let dir = p.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
        fd_shell::ops::open(hwnd, &path, &dir).map(|_| None).map_err(|e| e.to_string())
    })
    .await?
}

// ───────────────────────────── [3-1] 앱 안 보기 ─────────────────────────────

/// 앱 안 편집기로 글 파일을 연다. 인코딩 · 줄끝 · 수정 시각을 함께 돌려주고, 화면은 저장할 때 그대로 되넘긴다.
#[tauri::command]
async fn read_text(path: String) -> CmdResult<fd_core::textfile::TextFile> {
    tauri::async_runtime::spawn_blocking(move || fd_core::textfile::read(Path::new(&path))).await.map_err(|e| e.to_string())?
}

/// 고친 글을 쓴다. 연 뒤 밖에서 바뀌었으면 `changed` 로 거절한다 (화면이 다시 읽을지 덮어쓸지 묻는다).
/// 덮어쓰기는 `modified` 에 지금 수정 시각을 넣어 다시 부른다.
#[tauri::command]
async fn write_text(path: String, text: String, encoding: fd_core::textfile::Encoding, crlf: bool, modified: i64) -> CmdResult<i64> {
    tauri::async_runtime::spawn_blocking(move || fd_core::textfile::write(Path::new(&path), &text, encoding, crlf, modified))
        .await
        .map_err(|e| e.to_string())?
}

/// 지금 수정 시각 (ms) — 덮어쓰기 전에 다시 잰다.
#[tauri::command]
fn modified_of(path: String) -> CmdResult<i64> {
    let t = std::fs::metadata(&path).and_then(|m| m.modified()).map_err(|e| e.to_string())?;
    Ok(t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0))
}

fn pick_out(p: MenuPick) -> String {
    match p {
        MenuPick::None => "none".into(),
        MenuPick::Rename => "rename".into(),
        MenuPick::Invoked(v) => format!("invoked:{v}"),
        MenuPick::App(k) => format!("app:{k}"),
    }
}

/// 화면이 보내는 filedesk 메뉴 항목 (`fd_shell::menu::AppItem`). 구분선은 key · label 이 비어 있다.
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct MenuItemIn {
    key: String,
    label: String,
    checked: bool,
    disabled: bool,
    children: Vec<MenuItemIn>,
}

fn app_items(v: Vec<MenuItemIn>) -> Vec<fd_shell::menu::AppItem> {
    v.into_iter()
        .map(|i| fd_shell::menu::AppItem { key: i.key, label: i.label, checked: i.checked, disabled: i.disabled, children: app_items(i.children) })
        .collect()
}

#[tauri::command]
async fn context_menu(app: AppHandle, window: WebviewWindow, paths: Vec<String>, dir: String, items: Option<Vec<MenuItemIn>>) -> CmdResult<String> {
    let hwnd = owner(&window)?;
    let items = app_items(items.unwrap_or_default());
    on_main(app, move || fd_shell::menu::show_items_menu(hwnd, &paths, &dir, &items).map(pick_out).map_err(|e| e.to_string()))
        .await?
}

#[tauri::command]
async fn background_menu(app: AppHandle, window: WebviewWindow, dir: String, items: Option<Vec<MenuItemIn>>) -> CmdResult<String> {
    let hwnd = owner(&window)?;
    let items = app_items(items.unwrap_or_default());
    on_main(app, move || fd_shell::menu::show_background_menu(hwnd, &dir, &items).map(pick_out).map_err(|e| e.to_string()))
        .await?
}

/// `copy` · `cut` · `paste` · `properties`. 붙여넣기는 대상 폴더 하나를 `paths` 로 준다.
#[tauri::command]
async fn shell_verb(app: AppHandle, window: WebviewWindow, paths: Vec<String>, verb: String, dir: String) -> CmdResult<()> {
    const ALLOWED: &[&str] = &["copy", "cut", "paste", "properties"];
    if !ALLOWED.contains(&verb.as_str()) {
        return Err(format!("허용하지 않은 동사: {verb}"));
    }
    let hwnd = owner(&window)?;
    on_main(app, move || fd_shell::menu::invoke_verb(hwnd, &paths, &verb, &dir).map_err(|e| e.to_string())).await?
}

// ───────────────────────────── [4] 파일 작업 ─────────────────────────────

#[tauri::command]
async fn rename(window: WebviewWindow, path: String, new_name: String) -> CmdResult<&'static str> {
    let hwnd = owner(&window)?;
    let (from, name) = (path.clone(), new_name.clone());
    let r = on_sta(move || fd_shell::ops::rename(hwnd, &path, &new_name).map(outcome).map_err(|e| e.to_string())).await??;
    // 메모를 새 이름으로 옮긴다. 실패해도 이름 바꾸기는 끝난 일이라 오류로 돌리지 않는다 — 다음에 그 폴더를 열 때 파일 ID 로 다시 붙는다.
    if r == "done" {
        if let Some(to) = Path::new(&from).parent().map(|d| d.join(&name)) {
            let _ = memo_edit(|s| s.moved(&from, &to.to_string_lossy()) > 0);
        }
    }
    Ok(r)
}

#[tauri::command]
async fn recycle(window: WebviewWindow, paths: Vec<String>) -> CmdResult<&'static str> {
    let hwnd = owner(&window)?;
    on_sta(move || fd_shell::ops::recycle(hwnd, &paths).map(outcome).map_err(|e| e.to_string())).await?
}

#[tauri::command]
async fn new_folder(dir: String) -> CmdResult<String> {
    fd_shell::ops::new_folder(&dir).map_err(|e| e.to_string())
}

fn volume_of(p: &str) -> String {
    let p = p.replace('/', "\\");
    if let Some(rest) = p.strip_prefix("\\\\") {
        // \\서버\공유 까지가 한 볼륨
        let mut it = rest.splitn(3, '\\');
        return format!("\\\\{}\\{}", it.next().unwrap_or(""), it.next().unwrap_or("")).to_lowercase();
    }
    p.chars().take(2).collect::<String>().to_lowercase()
}

/// 끌어다 놓기로 들어온 파일을 `dest` 로. 복사/이동은 탐색기 규칙을 따른다 —
/// Ctrl 복사 · Shift 이동 · 아무것도 없으면 같은 드라이브는 이동 · 다른 드라이브는 복사.
#[tauri::command]
async fn drop_files(window: WebviewWindow, paths: Vec<String>, dest: String) -> CmdResult<&'static str> {
    let hwnd = owner(&window)?;
    let dest_norm = dest.trim_end_matches('\\').to_lowercase();
    let paths: Vec<String> = paths
        .into_iter()
        .filter(|p| {
            let pp = Path::new(p);
            let parent = pp.parent().map(|d| d.to_string_lossy().trim_end_matches('\\').to_lowercase()).unwrap_or_default();
            let lower = p.to_lowercase();
            // 제자리에 놓기 · 폴더를 자기 안으로 놓기는 하지 않는다.
            parent != dest_norm && !dest_norm.starts_with(&format!("{}\\", lower.trim_end_matches('\\'))) && lower != dest_norm
        })
        .collect();
    if paths.is_empty() {
        return Ok("skipped");
    }
    let (ctrl, shift) = fd_shell::places::modifier_keys();
    let mv = if ctrl {
        false
    } else if shift {
        true
    } else {
        paths.iter().all(|p| volume_of(p) == volume_of(&dest))
    };
    on_sta(move || fd_shell::ops::transfer(hwnd, &paths, &dest, mv).map(outcome).map_err(|e| e.to_string())).await?
}

// ───────────────────────────── [5] 끌기 ─────────────────────────────

#[tauri::command]
async fn drag_out(app: AppHandle, window: WebviewWindow, paths: Vec<String>) -> CmdResult<u32> {
    let hwnd = owner(&window)?;
    on_main(app, move || fd_shell::drag::drag_out(hwnd, &paths).map_err(|e| e.to_string())).await?
}

// ───────────────────────────── [6] 폴더 변경 감시 ─────────────────────────────

#[derive(Default)]
struct WatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    dirs: Mutex<HashSet<PathBuf>>,
}

/// 열린 탭들의 폴더를 감시한다. 바뀌면 `fs-changed` 로 그 폴더 경로를 알린다 — 화면이 다시 읽는다.
/// 하위 폴더까지 보지 않는다 (탭이 보는 칸만). NAS 경로는 감시가 안 될 수 있어 실패해도 넘어간다.
#[tauri::command]
fn watch_dirs(app: AppHandle, state: tauri::State<'_, WatchState>, dirs: Vec<String>) -> CmdResult<()> {
    let mut guard = state.watcher.lock().unwrap();
    if guard.is_none() {
        let app2 = app.clone();
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            let mut sent = HashSet::new();
            for p in ev.paths {
                if let Some(parent) = p.parent() {
                    let s = parent.to_string_lossy().into_owned();
                    if sent.insert(s.clone()) {
                        let _ = app2.emit("fs-changed", s);
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
        *guard = Some(w);
    }
    let w = guard.as_mut().unwrap();
    // 그 폴더의 `이전판/` 도 본다 — 감시는 한 단계라, 이전판 안에서만 바뀌면 판 눈금 · 문제 줄이 따라오지 않았다.
    // 이벤트 경로의 상위가 `…\이전판` 이면 화면이 그 위 폴더를 다시 읽는다 (Pane [1]).
    let want: HashSet<PathBuf> = dirs
        .into_iter()
        .map(PathBuf::from)
        .flat_map(|d| {
            // 2026.11.11 : 지난 판 폴더 이름이 여럿이 되어(`이전판` · `지난판` · `old versions` …) 이름 하나로 찾지 않는다.
            let mut v = fd_core::docs::history_dirs(&d);
            v.push(d);
            v
        })
        .collect();
    let mut have = state.dirs.lock().unwrap();
    for gone in have.difference(&want).cloned().collect::<Vec<_>>() {
        let _ = w.unwatch(&gone);
        have.remove(&gone);
    }
    for new in want.difference(&have.clone()).cloned().collect::<Vec<_>>() {
        if w.watch(&new, RecursiveMode::NonRecursive).is_ok() {
            have.insert(new);
        }
    }
    Ok(())
}

// ───────────────────────────── [7] 문서 ─────────────────────────────

/// 폴더(와 그 `이전판/`)를 문서 단위로. 하위 폴더까지 보는 일은 명령줄(`fd docs -r`)이 맡는다.
#[tauri::command]
async fn doc_groups(path: String) -> CmdResult<Vec<fd_core::DocGroup>> {
    tauri::async_runtime::spawn_blocking(move || fd_core::group_dir(Path::new(&path), false))
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn plan_edition(path: String, today: String) -> CmdResult<fd_core::edition::EditionPlan> {
    fd_core::edition::plan(Path::new(&path), &today)
}

/// 새 판 내기. 계획을 다시 세워 그대로 실행한다 (보여 준 뒤 폴더가 바뀌었을 수 있어서). 돌려주는 값은 새 판 경로.
#[tauri::command]
async fn new_edition(window: WebviewWindow, path: String, today: String) -> CmdResult<String> {
    let hwnd = owner(&window)?;
    let plan = fd_core::edition::plan(Path::new(&path), &today)?;
    let fd_core::edition::EditionPlan { source, new_name, new_path, retire, history, .. } = plan;
    let out = on_sta(move || fd_shell::ops::new_edition(hwnd, &source, &new_name, &retire, &history)).await?;
    match out.map_err(|e| e.to_string())? {
        Outcome::Done => Ok(new_path),
        Outcome::Aborted => Err("새 판 내기를 중간에 취소했다".into()),
    }
}

/// 문서 `key` 의 지난 판 중 최신판 자리에 남은 것 — 화면이 「이전판으로 옮김: …」으로 먼저 보여 준다.
fn stale_of(dir: &str, key: &str) -> CmdResult<Vec<String>> {
    fd_core::docs::stale_of(Path::new(dir), key)
}

#[tauri::command]
fn plan_retire(dir: String, key: String) -> CmdResult<Vec<String>> {
    stale_of(&dir, &key)
}

/// 지난 판을 이전판으로. 목록을 다시 세워 그대로 옮긴다 (보여 준 뒤 폴더가 바뀌었을 수 있어서). 돌려주는 값은 옮긴 수.
#[tauri::command]
async fn retire_editions(window: WebviewWindow, dir: String, key: String) -> CmdResult<usize> {
    let hwnd = owner(&window)?;
    let paths = stale_of(&dir, &key)?;
    if paths.is_empty() {
        return Err("옮길 지난 판이 없다".into());
    }
    let history = fd_core::docs::history_dir(Path::new(&paths[0]).parent().ok_or("상위 폴더가 없다")?).to_string_lossy().into_owned();
    let n = paths.len();
    let out = on_sta(move || fd_shell::ops::retire(hwnd, &paths, &history)).await?;
    match out.map_err(|e| e.to_string())? {
        Outcome::Done => Ok(n),
        Outcome::Aborted => Err("옮기기를 중간에 취소했다".into()),
    }
}

// ───────────────────────────── [7-1] 메모 ─────────────────────────────

fn memo_file() -> CmdResult<PathBuf> {
    fd_core::memo::default_file().ok_or_else(|| "APPDATA 가 없어 메모 파일 자리를 모른다".into())
}

/// 메모 파일을 읽고 `f` 로 고친 뒤, 고쳤다고(`true`) 하면 쓴다. 명령줄(`fd memo`)과 같은 파일이라 들고 있지 않는다.
fn memo_edit(f: impl FnOnce(&mut fd_core::memo::MemoStore) -> bool) -> CmdResult<()> {
    let file = memo_file()?;
    let mut s = fd_core::memo::MemoStore::load(&file)?;
    if f(&mut s) {
        s.save(&file)?;
    }
    Ok(())
}

/// 폴더 바로 아래(와 `이전판/`) 항목의 메모. 떠돌이 메모가 있으면 이 폴더 항목의 파일 ID 와 맞춰 본다 —
/// 탐색기에서 옮겨 온 파일의 메모가 여기서 다시 붙는다. 떠돌이가 없으면 ID 를 묻지 않는다 (큰 폴더에서 느려지지 않게).
#[tauri::command]
async fn memos_in(dir: String) -> CmdResult<Vec<fd_core::memo::Memo>> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = memo_file()?;
        let mut s = fd_core::memo::MemoStore::load(&file)?;
        if !s.strays().is_empty() {
            let mut found = Vec::new();
            let mut dirs = fd_core::docs::history_dirs(Path::new(&dir));
            dirs.push(PathBuf::from(&dir));
            for d in dirs {
                for item in std::fs::read_dir(&d).into_iter().flatten().flatten() {
                    let p = item.path().to_string_lossy().into_owned();
                    if let Some(id) = fd_shell::fileid::file_id(&p) {
                        found.push((p, id));
                    }
                }
            }
            if s.relink(&found) > 0 {
                s.save(&file)?;
            }
        }
        Ok(s.in_dir(&dir).into_iter().cloned().collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 메모를 붙인다 (빈 글이면 뗀다). 돌려주는 값은 남은 메모.
#[tauri::command]
async fn set_memo(path: String, text: String) -> CmdResult<Option<fd_core::memo::Memo>> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = fd_shell::fileid::file_id(&path);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let file = memo_file()?;
        let mut s = fd_core::memo::MemoStore::load(&file)?;
        let out = s.set(&path, &text, id, now).cloned();
        s.save(&file)?;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 색 표시를 붙인다 (`None` 이면 뗀다). 돌려주는 값은 남은 항목.
#[tauri::command]
async fn set_color(path: String, color: Option<String>) -> CmdResult<Option<fd_core::memo::Memo>> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = fd_shell::fileid::file_id(&path);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let file = memo_file()?;
        let mut s = fd_core::memo::MemoStore::load(&file)?;
        let out = s.set_color(&path, color.as_deref(), id, now)?.cloned();
        s.save(&file)?;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 여러 경로의 메모 · 색 — 왼쪽 즐겨찾기가 색 점을 그리는 데 쓴다. 없는 경로는 뺀다.
#[tauri::command]
async fn memos_of(paths: Vec<String>) -> CmdResult<Vec<fd_core::memo::Memo>> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = fd_core::memo::MemoStore::load(&memo_file()?)?;
        Ok(paths.iter().filter_map(|p| s.get(p).cloned()).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 하위 폴더까지 찾기 (fd-core `search`). 새 찾기가 오면 앞선 것은 멈춘다 — 글자를 칠 때마다 부르므로.
/// `content` 면 문서 본문까지 본다 (화면에서는 `content: true` · 본문에서 맞은 항목은 `snippet` 이 붙는다).
#[tauri::command]
async fn search_dir(root: String, query: String, show_hidden: bool, content: Option<bool>) -> CmdResult<fd_core::search::SearchResult> {
    let generation = fd_core::search::next_generation();
    tauri::async_runtime::spawn_blocking(move || {
        let memos = fd_core::memo::MemoStore::load(&memo_file()?)?
            .all()
            .filter(|m| !m.text.is_empty())
            .map(|m| (fd_core::memo::key(&m.path), m.text.clone()))
            .collect();
        let mut r = fd_core::search::find(Path::new(&root), &query, show_hidden, &memos, content.unwrap_or(false), 2000, std::time::Duration::from_secs(8), Some(generation));
        for f in &mut r.items {
            f.entry.kind = fd_shell::icon::type_name(&f.entry.ext, f.entry.is_dir);
        }
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 색 표시를 단 항목 모두 — 왼쪽 「색」 · 명령 팔레트가 폴더와 상관없이 모아 보인다 (Finder 꼬리표처럼).
/// `color` 가 없으면 색이 있는 것 모두. 지워졌거나 옮겨져 찾지 못한 것은 뺀다.
#[tauri::command]
async fn tagged(color: Option<String>) -> CmdResult<Vec<fd_core::list::Entry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = fd_core::memo::MemoStore::load(&memo_file()?)?;
        let mut out: Vec<fd_core::list::Entry> = s
            .all()
            .filter(|m| match (&m.color, &color) {
                (Some(c), Some(want)) => c == want,
                (Some(_), None) => true,
                _ => false,
            })
            .filter_map(|m| fd_core::list::entry_at(Path::new(&m.path)))
            .collect();
        for e in &mut out {
            e.kind = fd_shell::icon::type_name(&e.ext, e.is_dir);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 아이콘 팩에 쓸 수 있는 그림 꼴과 그 MIME.
/// 그림 꼴 (화면 `viewable.ts` 의 IMAGE_EXTS 와 같아야 한다). WebView2 가 그대로 그리는 것만.
fn image_mime(file: &str) -> Option<&'static str> {
    let ext = Path::new(file).extension()?.to_string_lossy().to_lowercase();
    Some(match ext.as_str() {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "webp" => "image/webp",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// 아이콘 팩 폴더의 그림 — 파일 이름(확장자 뺀 것, 소문자) → 경로. 이름은 확장자(`pdf`) · 종류(`doc`) · `folder` · `file`.
/// 같은 이름이 여러 꼴이면 svg → png → 나머지 차례로 하나만 (선명한 것 먼저).
#[tauri::command]
fn icon_pack(dir: String) -> CmdResult<std::collections::HashMap<String, String>> {
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("{dir} 을 읽지 못했다 — {e}"))?;
    let rank = |p: &str| match Path::new(p).extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("svg") => 0,
        Some("png") => 1,
        _ => 2,
    };
    let mut out: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for item in rd.flatten() {
        let path = item.path().to_string_lossy().into_owned();
        if image_mime(&path).is_none() {
            continue;
        }
        let Some(stem) = item.path().file_stem().map(|s| s.to_string_lossy().to_lowercase()) else { continue };
        if out.get(&stem).is_none_or(|old| rank(&path) < rank(old)) {
            out.insert(stem, path);
        }
    }
    Ok(out)
}

/// 경로마다 폴더인가 (없으면 false) — 즐겨찾기에 끌어다 놓은 것이 폴더인지 파일인지 가른다.
#[tauri::command]
fn dirs_of(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_dir()).collect()
}

// ───────────────────────────── [7-2] Claude 스킬 ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillStatus {
    /// 설치 자리 (`~/.claude/skills/filedesk/SKILL.md`).
    file: Option<String>,
    /// 설치된 스킬의 판. 없으면 설치 안 됨.
    installed: Option<String>,
    /// 이 앱의 판 — 다르면 다시 설치를 권한다.
    current: String,
    /// 설치 폴더에 fd.exe 가 있는가 (배포 설치본). 없으면 스킬이 부를 명령이 없다.
    has_cli: bool,
}

/// 앱 옆 fd.exe — 설치본은 같은 폴더에 함께 깔린다 (tauri.release.json).
fn fd_exe() -> Option<PathBuf> {
    let p = std::env::current_exe().ok()?.parent()?.join("fd.exe");
    p.is_file().then_some(p)
}

#[tauri::command]
fn skill_status() -> SkillStatus {
    let file = fd_core::skill::default_file();
    SkillStatus {
        installed: file.as_deref().and_then(fd_core::skill::installed_version),
        file: file.map(|f| f.to_string_lossy().into_owned()),
        current: env!("CARGO_PKG_VERSION").to_string(),
        has_cli: fd_exe().is_some(),
    }
}

#[tauri::command]
fn install_skill() -> CmdResult<SkillStatus> {
    let fd = fd_exe().ok_or("앱 폴더에 fd.exe 가 없다 — 설치 파일(릴리스의 setup.exe)로 깔아야 함께 깔린다")?;
    let file = fd_core::skill::default_file().ok_or("USERPROFILE 이 없다")?;
    fd_core::skill::install(&file, &fd)?;
    Ok(skill_status())
}

/// 켤 때 — 이미 깐 스킬이 이 판 · 이 fd.exe 자리와 다르면 다시 쓴다. 깔지 않은 사람에게는 새로 깔지 않는다.
/// 2026.11.11 : 앱만 새 판으로 올리고 스킬을 잊으면 에이전트가 옛 명령 · 옛 경로를 불렀다. 판이 같아도 설치 자리가 바뀌면 경로가 어긋나서 본문째 견준다.
/// 2026.11.11 리뷰 : 판 · 경로가 같으면 손대지 않는다 (사람이 고친 스킬을 지키려고). 저장소의 빌드(`target\…`)로 켰을 때는 쓰지 않는다 —
///              개발판을 한 번 켜기만 해도 설치된 스킬이 `target\debug\fd.exe` 를 가리켰다.
fn refresh_skill() {
    let (Some(fd), Some(file)) = (fd_exe(), fd_core::skill::default_file()) else { return };
    if fd.components().any(|c| c.as_os_str().eq_ignore_ascii_case("target")) {
        return;
    }
    if fd_core::skill::needs_refresh(&file, &fd) {
        let _ = fd_core::skill::install(&file, &fd);
    }
}

// ───────────────────────────── [8] 설정 ─────────────────────────────

fn settings_path(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// 설정은 화면이 꼴을 정한다 — 여기서는 통째로 읽고 쓴다. 없으면 null.
#[tauri::command]
fn load_settings(app: AppHandle) -> CmdResult<serde_json::Value> {
    let p = settings_path(&app)?;
    match std::fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("{}: {e}", p.display())),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

/// 쓰다 꺼져도 설정이 반쯤 남지 않게 임시 파일에 쓰고 바꿔 끼운다.
#[tauri::command]
fn save_settings(app: AppHandle, value: serde_json::Value) -> CmdResult<()> {
    let p = settings_path(&app)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

// ───────────────────────────── [8-1] 새 파일 ─────────────────────────────

/// 다운로드 · 바탕화면에 최근 `days` 일 새로 생기거나 바뀐 파일, 최근 것부터 — 왼쪽 「새 파일」 · 칸의 「새 파일 모두 보기」.
#[tauri::command]
async fn recent_files(paths: Vec<String>, days: u64) -> CmdResult<Vec<fd_core::list::Entry>> {
    tauri::async_runtime::spawn_blocking(move || {
        let dirs: Vec<&Path> = paths.iter().map(Path::new).collect();
        let mut out = fd_core::list::recent_files(&dirs, days);
        for e in &mut out {
            e.kind = fd_shell::icon::type_name(&e.ext, e.is_dir);
        }
        out
    })
    .await
    .map_err(|e| e.to_string())
}

// ───────────────────────────── [9] 아이콘 프로토콜 · 앱 시작 ─────────────────────────────

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ───────────────────────────── [8-2] 업데이트 ─────────────────────────────

/// 설치본(NSIS)으로 돌고 있는가 — 설치 폴더에 uninstall.exe 가 있다. `bun tauri build --no-bundle` 로 만든 exe 는
/// 스스로 바꿔 끼울 설치기가 없어, 화면이 설치 대신 릴리즈 페이지를 연다 (docket 과 같은 판정).
#[tauri::command]
fn update_installable() -> bool {
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|d| d.join("uninstall.exe").is_file())).unwrap_or(false)
}

/// 릴리즈 페이지 · 마크다운 안 링크를 기본 브라우저로. 웹 주소만 연다 — 화면에서 온 글로 아무 프로그램이나 띄우지 않게.
/// 2026.11.11 : https → http · https. 앱 안 마크다운 보기의 링크가 http 인 것도 많다.
#[tauri::command]
async fn open_url(window: WebviewWindow, url: String) -> CmdResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("웹 주소(http · https)만 연다".into());
    }
    let hwnd = owner(&window)?;
    on_sta(move || fd_shell::ops::open(hwnd, &url, "").map_err(|e| e.to_string())).await?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(WatchState::default())
        .setup(|_| {
            std::thread::spawn(refresh_skill);
            Ok(())
        })
        // 화면은 `http://fdicon.localhost/<키>` 로 아이콘을 받는다. 키 꼴은 fd_shell::icon::icon_png.
        .register_asynchronous_uri_scheme_protocol("fdicon", |_ctx, req, responder| {
            let key = percent_decode(req.uri().path().trim_start_matches('/'));
            // 아이콘 팩(`pack:<그림 파일 경로>`) — 사용자가 고른 폴더의 그림을 그대로 준다.
            // 앱 안 그림 보기 · 마크다운 속 그림(`raw:<경로>`)도 같다. 그림 꼴만 (화면이 아무 파일이나 읽어 가지 않게).
            // 큰 사진(수십 MB)을 읽는 동안 다른 요청이 막히지 않게 따로 읽는다.
            if let Some(file) = key.strip_prefix("pack:").or_else(|| key.strip_prefix("raw:")).map(str::to_owned) {
                std::thread::spawn(move || {
                    let resp = match image_mime(&file).and_then(|mime| std::fs::read(&file).ok().map(|b| (mime, b))) {
                        Some((mime, bytes)) => tauri::http::Response::builder().header("Content-Type", mime).header("Cache-Control", "no-cache").body(bytes),
                        None => tauri::http::Response::builder().status(404).body(Vec::new()),
                    };
                    responder.respond(resp.expect("응답"));
                });
                return;
            }
            std::thread::spawn(move || {
                // 아이콘 전담 스레드가 차례로 뽑는다 (fd_shell::icon::icon_png). 못 그리면 일반 파일 아이콘.
                let png = fd_shell::icon::icon_png(&key);
                let resp = match png {
                    Some(bytes) => tauri::http::Response::builder()
                        .header("Content-Type", "image/png")
                        .header("Cache-Control", "max-age=86400")
                        .body(bytes),
                    None => tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(resp.expect("응답"));
            });
        })
        .invoke_handler(tauri::generate_handler![
            list_dir,
            places,
            resolve_input,
            open_item,
            read_text,
            write_text,
            modified_of,
            context_menu,
            background_menu,
            shell_verb,
            rename,
            recycle,
            new_folder,
            drop_files,
            drag_out,
            watch_dirs,
            doc_groups,
            plan_edition,
            new_edition,
            plan_retire,
            retire_editions,
            memos_in,
            set_memo,
            set_color,
            memos_of,
            search_dir,
            dirs_of,
            tagged,
            icon_pack,
            skill_status,
            install_skill,
            update_installable,
            open_url,
            load_settings,
            save_settings,
            recent_files,
        ])
        .run(tauri::generate_context!())
        .expect("filedesk 를 시작하지 못했다");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volumes() {
        assert_eq!(volume_of(r"C:\a\b"), "c:");
        assert_eq!(volume_of(r"\\nas\공유\x"), r"\\nas\공유");
        assert_ne!(volume_of(r"C:\a"), volume_of(r"D:\a"));
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("e%3Apptx"), "e:pptx");
        assert_eq!(percent_decode("f%3AC%3A%5C%EA%B0%80.lnk"), r"f:C:\가.lnk");
    }
}
