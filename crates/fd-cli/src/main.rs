//! `fd` — filedesk 명령줄. 출력은 JSON 이다 (에이전트가 그대로 읽게).
//! 2026.11.11 : 목록 · 문서 묶기 · 메모. 사본 조회(`fd dupes` · `fd status`)는 2단계 색인과 함께 붙는다.

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
}

#[derive(Subcommand)]
enum MemoCmd {
    /// 메모 목록. 폴더를 주면 그 바로 아래(와 `이전판/`)만
    Ls { dir: Option<PathBuf> },
    /// 메모 하나
    Get { path: PathBuf },
    /// 메모를 붙인다. 빈 글("")이면 뗀다
    Set { path: PathBuf, text: String },
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
    let groups = fd_core::group_dir(path, recursive, &fd_core::NameRules::load());
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
