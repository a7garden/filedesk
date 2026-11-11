//! `fd` — filedesk 명령줄. 출력은 JSON 이다 (에이전트가 그대로 읽게).
//! 2026.11.11 : 목록 · 문서 묶기 · 메모. 사본 조회(`fd dupes` · `fd status`)는 2단계 색인과 함께 붙는다.
//! 2026.11.11 : 에이전트 창구로 키웠다 — 새 판 · 이전판 정리 · 휴지통 · Claude 스킬 설치.
//! 2026.11.11 : `fd projects` · `fd where` · `fd rules` 를 뺐다 — 일반 탐색기라 「프로젝트」 · 과업 이름 규칙을 두지 않는다.
//!
//! 약속 (스킬 `skills/filedesk/SKILL.md` 가 이것을 믿는다):
//! - 성공하면 표준 출력에 JSON 하나, 종료 코드 0.
//! - 새 명령은 실패하면 표준 오류에 `{"error": "…"}` 한 줄, 종료 코드 1. 문장은 사람에게 그대로 보여도 되는 한국어다.
//! - 파일을 바꾸는 명령(`edition` · `retire`)은 `--apply` 없이는 계획만 보인다. 휴지통(`trash`)은 되돌릴 수 있어 바로 한다.
//! - 파일 작업은 셸(IFileOperation)이 해서 탐색기 Ctrl+Z 로 되돌아간다. 이름이 겹칠 자리는 먼저 보고 멈춘다 — 셸이 묻는 창을 띄우면 에이전트가 막힌다.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "fd", version, about = "filedesk 명령줄")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 폴더 바로 아래 항목을 JSON 배열로
    Ls {
        path: PathBuf,
        /// 숨김 · 시스템 항목도
        #[arg(long)]
        all: bool,
    },
    /// 파일을 문서 단위로 묶는다 (판 · 날짜 · 최신판 · 규칙 어긋남). 폴더와 그 `이전판/` 을 본다
    Docs {
        path: PathBuf,
        /// 아래 폴더 전부
        #[arg(short, long)]
        recursive: bool,
        /// 묶음 대신 세어 본 숫자와 문제 있는 묶음만
        #[arg(long)]
        summary: bool,
    },
    /// 정리 — 정본이 따로 있는 사본을 찾아 정리함으로 옮기고 되돌린다
    #[command(subcommand)]
    Tidy(Tidy),
    /// 메모 — 파일 · 폴더에 붙인 글 (앱과 같은 메모 파일)
    #[command(subcommand)]
    Memo(MemoCmd),
    /// 새 판 내기 — 다음 판 이름 · 오늘 날짜로 복사하고, 지난 판(과 그 판의 pdf 등)은 `이전판/` 으로. `--apply` 없으면 계획만
    Edition {
        file: PathBuf,
        /// 날짜 `YYYYMMDD` (기본: 오늘)
        #[arg(long)]
        today: Option<String>,
        /// 계획대로 한다
        #[arg(long)]
        apply: bool,
    },
    /// 최신판 자리에 남은 지난 판을 `이전판/` 으로. `--apply` 없으면 계획만
    Retire {
        dir: PathBuf,
        /// 이 문서 키만 (`fd docs` 의 key). 없으면 폴더의 모든 문서
        #[arg(long)]
        doc: Option<String>,
        /// 계획대로 한다
        #[arg(long)]
        apply: bool,
    },
    /// 하위 폴더까지 찾기 — 이름이나 메모 글에 찾는 말이 다 든 항목 (빈칸으로 나눈 말 모두)
    Find {
        dir: PathBuf,
        query: String,
        /// 숨김 · 시스템 항목도
        #[arg(long)]
        all: bool,
        /// 최대 개수
        #[arg(long, default_value_t = 500)]
        limit: usize,
        /// 문서 본문까지 (hwpx · docx · pptx · xlsx · pdf · txt · md · csv). 맞은 항목에 `snippet` 이 붙는다
        #[arg(long)]
        content: bool,
    },
    /// 휴지통으로 보낸다 (휴지통에서 되살릴 수 있다). 휴지통에 못 들어가는 자리(NAS 등)는 지우지 않고 멈춘다
    Trash {
        #[arg(required = true)]
        paths: Vec<PathBuf>,
    },
    /// Claude Code 스킬
    #[command(subcommand)]
    Skill(SkillCmd),
}

#[derive(Subcommand)]
enum SkillCmd {
    /// `~/.claude/skills/filedesk/SKILL.md` 에 스킬을 쓴다 (이 fd.exe 경로를 넣어서). 있으면 이 판으로 바꾼다
    Install {
        /// 스킬 폴더들의 자리 (기본: `~/.claude/skills`)
        #[arg(long)]
        dir: Option<PathBuf>,
    },
    /// 설치할 스킬 본문을 그대로 찍는다
    Show,
}

#[derive(Subcommand)]
enum MemoCmd {
    /// 메모 목록. 폴더를 주면 그 바로 아래(와 `이전판/`)만
    Ls { dir: Option<PathBuf> },
    /// 메모 하나
    Get { path: PathBuf },
    /// 메모를 붙인다. 빈 글("")이면 뗀다
    Set { path: PathBuf, text: String },
    /// 색 표시 — red · orange · yellow · green · blue · purple · gray, 떼려면 none
    Color { path: PathBuf, color: String },
}

#[derive(Subcommand)]
enum Tidy {
    /// 계획만 세운다 (아무것도 옮기지 않는다)
    Plan {
        /// 쓸어 볼 자리 `이름=경로` (여럿)
        #[arg(long, required = true)]
        sweep: Vec<String>,
        /// 정본이 있는 자리 (여럿)
        #[arg(long, required = true)]
        keep: Vec<PathBuf>,
        /// 계획 파일
        #[arg(short, long)]
        out: PathBuf,
    },
    /// 계획대로 정리함으로 옮긴다. 기록은 정리함의 manifest.json
    Apply {
        plan: PathBuf,
        /// 정리함 (쓸어 볼 자리와 같은 드라이브 — 옮기기가 이름 바꾸기로 끝나게)
        #[arg(long = "box")]
        box_dir: PathBuf,
        /// 이 이름의 묶음만 (여럿)
        #[arg(long)]
        only: Vec<String>,
    },
    /// 기록대로 제자리에 돌려놓는다
    Undo { manifest: PathBuf },
}

/// 빗금 경로를 역빗금으로 — 화면이 쓰는 경로와 같은 꼴이어야 결과를 서로 맞춰 볼 수 있다.
fn windows_path(p: PathBuf) -> PathBuf {
    if cfg!(windows) { PathBuf::from(p.to_string_lossy().replace('/', "\\")) } else { p }
}

fn main() -> ExitCode {
    match Cli::parse().cmd {
        Cmd::Ls { path, all } => ls(&windows_path(path), all),
        Cmd::Docs { path, recursive, summary } => docs(&windows_path(path), recursive, summary),
        Cmd::Tidy(t) => tidy(t),
        Cmd::Memo(m) => memo(m),
        Cmd::Edition { file, today, apply } => done(edition(&abs(file), today, apply)),
        Cmd::Retire { dir, doc, apply } => done(retire(&abs(dir), doc.as_deref(), apply)),
        Cmd::Find { dir, query, all, limit, content } => done(find(&abs(dir), &query, all, limit, content)),
        Cmd::Trash { paths } => done(trash(paths.into_iter().map(abs).collect())),
        Cmd::Skill(k) => done(skill(k)),
    }
}

type Out = Result<serde_json::Value, String>;

/// 결과를 약속한 꼴로 내보낸다 — 성공은 표준 출력에 JSON, 실패는 표준 오류에 `{"error"}`.
fn done(r: Out) -> ExitCode {
    match r {
        Ok(v) => {
            println!("{}", serde_json::to_string_pretty(&v).expect("직렬화"));
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{}", serde_json::json!({ "error": e }));
            ExitCode::FAILURE
        }
    }
}

/// 절대 경로 · 역빗금 — 앱 · 메모 파일이 쓰는 꼴과 맞춘다 (상대 경로로 붙인 메모는 앱에서 못 찾는다).
fn abs(p: PathBuf) -> PathBuf {
    let p = windows_path(p);
    std::path::absolute(&p).unwrap_or(p)
}

fn edition(file: &Path, today: Option<String>, apply: bool) -> Out {
    let today = match today {
        Some(t) if t.len() == 8 && t.chars().all(|c| c.is_ascii_digit()) => t,
        Some(t) => return Err(format!("--today 는 YYYYMMDD 꼴이어야 한다: {t}")),
        None => fd_shell::clock::today(),
    };
    let plan = fd_core::edition::plan(file, &today)?;
    let clash = fd_core::edition::collisions(&plan);
    if !apply {
        return Ok(serde_json::json!({ "applied": false, "plan": plan, "collisions": clash }));
    }
    if !clash.is_empty() {
        return Err(format!("이미 있는 이름과 겹친다 — 손으로 정리한 뒤 다시: {}", clash.join(", ")));
    }
    let p = plan.clone();
    let out = fd_shell::run_sta(move || fd_shell::ops::new_edition(0, &p.source, &p.new_name, &p.retire, &p.history));
    match out.map_err(|e| e.to_string())? {
        fd_shell::ops::Outcome::Done => Ok(serde_json::json!({ "applied": true, "plan": plan })),
        fd_shell::ops::Outcome::Aborted => Err("새 판 내기가 중간에 멈췄다 — 폴더를 확인한다".into()),
    }
}

fn retire(dir: &Path, doc: Option<&str>, apply: bool) -> Out {
    if !dir.is_dir() {
        return Err(format!("{}: 폴더가 아니다", dir.display()));
    }
    let docs: Vec<(String, String, Vec<String>)> = match doc {
        Some(k) => vec![(k.to_string(), k.to_string(), fd_core::docs::stale_of(dir, k)?)],
        None => fd_core::docs::stale_all(dir),
    };
    let history = dir.join(fd_core::docs::HISTORY_DIR);
    let paths: Vec<String> = docs.iter().flat_map(|(_, _, v)| v.iter().cloned()).collect();
    let clash = fd_core::docs::history_collisions(&paths, &history);
    let listing: Vec<_> = docs.iter().map(|(k, t, v)| serde_json::json!({ "key": k, "title": t, "move": v })).collect();
    if !apply || paths.is_empty() {
        return Ok(serde_json::json!({ "applied": false, "history": history, "documents": listing, "collisions": clash }));
    }
    if !clash.is_empty() {
        return Err(format!("이전판에 같은 이름이 있다 — 손으로 정리한 뒤 다시: {}", clash.join(", ")));
    }
    let h = history.to_string_lossy().into_owned();
    let n = paths.len();
    let out = fd_shell::run_sta(move || fd_shell::ops::retire(0, &paths, &h));
    match out.map_err(|e| e.to_string())? {
        fd_shell::ops::Outcome::Done => Ok(serde_json::json!({ "applied": true, "moved": n, "history": history, "documents": listing })),
        fd_shell::ops::Outcome::Aborted => Err("옮기기가 중간에 멈췄다 — 폴더를 확인한다".into()),
    }
}

fn find(dir: &Path, query: &str, all: bool, limit: usize, content: bool) -> Out {
    if !dir.is_dir() {
        return Err(format!("{}: 폴더가 아니다", dir.display()));
    }
    let memos: std::collections::HashMap<String, String> = fd_core::memo::default_file()
        .and_then(|f| fd_core::memo::MemoStore::load(&f).ok())
        .map(|s| s.all().filter(|m| !m.text.is_empty()).map(|m| (fd_core::memo::key(&m.path), m.text.clone())).collect())
        .unwrap_or_default();
    let r = fd_core::search::find(dir, query, all, &memos, content, limit, std::time::Duration::from_secs(20), None);
    serde_json::to_value(r).map_err(|e| e.to_string())
}

fn trash(paths: Vec<PathBuf>) -> Out {
    let missing: Vec<String> = paths.iter().filter(|p| !p.exists()).map(|p| p.display().to_string()).collect();
    if !missing.is_empty() {
        return Err(format!("없다: {}", missing.join(", ")));
    }
    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let l = list.clone();
    let out = fd_shell::run_sta(move || fd_shell::ops::recycle(0, &l));
    match out.map_err(|e| e.to_string())? {
        fd_shell::ops::Outcome::Done => Ok(serde_json::json!({ "trashed": list })),
        // 휴지통에 못 들어가는 것은 셸이 영구 삭제를 묻는다 — 「아니오」로 끝나면 여기로 온다.
        fd_shell::ops::Outcome::Aborted => Err("휴지통으로 다 보내지 못했다 — 휴지통에 못 들어가는 자리면 사람이 지운다".into()),
    }
}

fn fd_exe() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("fd"))
}

fn skill(k: SkillCmd) -> Out {
    match k {
        SkillCmd::Show => Ok(serde_json::Value::String(fd_core::skill::render(&fd_exe()))),
        SkillCmd::Install { dir } => {
            let file = match dir {
                Some(d) => d.join("filedesk").join("SKILL.md"),
                None => fd_core::skill::default_file().ok_or("USERPROFILE 이 없다")?,
            };
            let replaced = fd_core::skill::install(&file, &fd_exe())?;
            Ok(serde_json::json!({ "installed": file, "replaced": replaced, "version": env!("CARGO_PKG_VERSION") }))
        }
    }
}

fn memo(m: MemoCmd) -> ExitCode {
    use fd_core::memo::{MemoStore, default_file};
    let Some(file) = default_file() else {
        eprintln!("APPDATA 가 없어 메모 파일 자리를 모른다");
        return ExitCode::FAILURE;
    };
    let mut store = match MemoStore::load(&file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let out = match m {
        MemoCmd::Ls { dir } => match dir.map(windows_path) {
            Some(d) => serde_json::to_value(store.in_dir(&d.to_string_lossy())),
            None => serde_json::to_value(store.all().collect::<Vec<_>>()),
        },
        MemoCmd::Get { path } => serde_json::to_value(store.get(&windows_path(path).to_string_lossy())),
        MemoCmd::Color { path, color } => {
            let path = abs(path);
            if !path.exists() {
                return done(Err(format!("{}: 없다", path.display())));
            }
            let p = path.to_string_lossy().into_owned();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
            let c = (color != "none").then_some(color.as_str());
            let id = file_id(&p);
            let v = match store.set_color(&p, c, id, now) {
                Ok(m) => serde_json::to_value(m),
                Err(e) => return done(Err(e)),
            };
            if let Err(e) = store.save(&file) {
                return done(Err(e));
            }
            v
        }
        MemoCmd::Set { path, text } => {
            let path = windows_path(path);
            if !path.exists() {
                eprintln!("{}: 없다", path.display());
                return ExitCode::FAILURE;
            }
            let p = std::path::absolute(&path).unwrap_or(path).to_string_lossy().into_owned();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
            let id = file_id(&p);
            let v = serde_json::to_value(store.set(&p, &text, id, now));
            if let Err(e) = store.save(&file) {
                eprintln!("{e}");
                return ExitCode::FAILURE;
            }
            v
        }
    };
    println!("{}", serde_json::to_string_pretty(&out.expect("직렬화")).expect("직렬화"));
    ExitCode::SUCCESS
}

#[cfg(windows)]
fn file_id(p: &str) -> Option<String> {
    fd_shell::fileid::file_id(p)
}
#[cfg(not(windows))]
fn file_id(_: &str) -> Option<String> {
    None
}

fn ls(path: &Path, all: bool) -> ExitCode {
    match fd_core::list_dir(path, all) {
        Ok(list) => {
            println!("{}", serde_json::to_string(&list).expect("직렬화"));
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{}: {e}", path.display());
            ExitCode::FAILURE
        }
    }
}

fn docs(path: &Path, recursive: bool, summary: bool) -> ExitCode {
    if !path.is_dir() {
        eprintln!("{}: 폴더가 아니다", path.display());
        return ExitCode::FAILURE;
    }
    let groups = fd_core::group_dir(path, recursive);
    let out = if summary {
        let files: usize = groups.iter().map(|g| g.files.len()).sum();
        let with_issues: Vec<_> = groups
            .iter()
            .filter(|g| !g.issues.is_empty())
            .map(|g| serde_json::json!({ "title": g.title, "files": g.files.len(), "latest": g.files[0].name, "issues": g.issues }))
            .collect();
        serde_json::json!({ "files": files, "documents": groups.len(), "withIssues": with_issues })
    } else {
        serde_json::to_value(&groups).expect("직렬화")
    };
    println!("{}", serde_json::to_string_pretty(&out).expect("직렬화"));
    ExitCode::SUCCESS
}

fn tidy(t: Tidy) -> ExitCode {
    use fd_core::tidy;
    match t {
        Tidy::Plan { sweep, keep, out } => {
            // 잘못 준 인자를 조용히 버리면 「사본 없음」처럼 보이는 빈 계획이 나온다 — 하나라도 틀리면 멈춘다.
            let mut bad = Vec::new();
            let sweep: Vec<(String, PathBuf)> = sweep
                .iter()
                .filter_map(|s| match s.split_once('=') {
                    Some((n, p)) if !n.trim().is_empty() => Some((n.trim().to_string(), windows_path(PathBuf::from(p)))),
                    _ => {
                        bad.push(format!("--sweep 은 「이름=경로」 꼴이어야 한다: {s}"));
                        None
                    }
                })
                .collect();
            let keep: Vec<PathBuf> = keep.into_iter().map(windows_path).collect();
            for p in sweep.iter().map(|(_, p)| p).chain(keep.iter()) {
                if !p.is_dir() {
                    bad.push(format!("폴더가 아니다: {}", p.display()));
                }
            }
            if !bad.is_empty() {
                for b in &bad {
                    eprintln!("{b}");
                }
                return ExitCode::FAILURE;
            }
            let started = std::time::Instant::now();
            let plan = tidy::plan(&sweep, &keep);
            std::fs::write(&out, serde_json::to_string_pretty(&plan).expect("직렬화")).expect("계획 파일");
            let bytes: u64 = plan.items.iter().map(|i| i.size).sum();
            let mut by_area: std::collections::BTreeMap<&str, (usize, u64)> = Default::default();
            for i in &plan.items {
                let e = by_area.entry(i.area.as_str()).or_default();
                e.0 += 1;
                e.1 += i.size;
            }
            let summary = serde_json::json!({
                "plan": out,
                "scanned": plan.scanned,
                "items": plan.items.len(),
                "bytes": bytes,
                "seconds": started.elapsed().as_secs_f32(),
                "byArea": by_area.iter().map(|(k, (n, b))| serde_json::json!({ "area": k, "files": n, "bytes": b })).collect::<Vec<_>>(),
            });
            println!("{}", serde_json::to_string_pretty(&summary).expect("직렬화"));
            ExitCode::SUCCESS
        }
        Tidy::Apply { plan, box_dir, only } => {
            let plan: tidy::TidyPlan = serde_json::from_str(&std::fs::read_to_string(&plan).expect("계획 파일")).expect("계획 꼴");
            let box_dir = windows_path(box_dir);
            let mf = box_dir.join("manifest.json");
            let only = (!only.is_empty()).then_some(only);
            match tidy::apply(&plan, &box_dir, only.as_deref(), &mf) {
                Ok(m) => {
                    let bytes: u64 = m.moved.iter().map(|x| x.size).sum();
                    println!("{}", serde_json::json!({ "moved": m.moved.len(), "bytes": bytes, "skipped": m.skipped, "manifest": mf }));
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("적용 실패: {e} (옮긴 것까지는 {} 에 기록돼 있다)", mf.display());
                    ExitCode::FAILURE
                }
            }
        }
        Tidy::Undo { manifest } => {
            let m: tidy::Manifest = serde_json::from_str(&std::fs::read_to_string(&manifest).expect("기록 파일")).expect("기록 꼴");
            let (n, skipped) = tidy::undo(&m);
            println!("{}", serde_json::json!({ "restored": n, "skipped": skipped }));
            ExitCode::SUCCESS
        }
    }
}
