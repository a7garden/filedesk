//! 정리 — 「정본이 따로 있는 사본」을 찾아 정리함으로 옮기고, 기록대로 되돌린다.
//!
//! 계획 → 적용 → 되돌리기 (PLAN 3단계). 이 모듈은 셸을 거치지 않는다 — 같은 드라이브 안 이름 바꾸기(이동)만 하므로
//! 내용을 복사하지 않고, 실패해도 원본이 그 자리에 남는다.
//!
//! - 계획: 쓸어 볼 자리(바탕화면 · 다운로드 …)의 파일 중, 남길 자리(과업 루트)에 **내용이 똑같은** 파일이 있는 것.
//!   크기로 먼저 거르고, 크기가 같은 것만 전체 내용 해시(blake3)로 맞춘다. 이름은 보지 않는다.
//! - 적용: 계획 속 파일을 `<정리함>/<드라이브>/<원래 경로>` 로 옮긴다. 옮기기 직전에 크기 · 수정 시각이 계획 때와 같은지 다시 본다.
//!   하나씩 옮길 때마다 기록(manifest)에 적는다 — 도중에 멈춰도 옮긴 것까지는 되돌릴 수 있게.
//! - 되돌리기: 기록대로 제자리에 옮겨 놓는다. 그 자리에 이미 다른 파일이 생겼으면 덮지 않고 건너뛴다.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

/// 훑지 않는 폴더 — 코드 저장소 속 · 생성물. 여기의 같은 파일은 일부러 둔 것이다. 점으로 시작하는 폴더도 모두 건너뛴다.
const SKIP_DIRS: &[&str] = &["node_modules", "target", "__pycache__"];

/// 정본으로 치지 않는 자리 (남길 자리 안에서도). 2026.11.11 실제 계획에서 잡혔다 —
/// `.claude/worktrees/…` 같은 임시 작업 사본을 정본으로 삼으면, 그 사본이 지워질 때 파일이 어디에도 안 남는다.
/// `작업` 은 진행 중이라 지워질 수 있고, `dist` 는 생성물이다.
const NOT_CANON_DIRS: &[&str] = &["작업", "dist"];

/// 영상 편집 프로젝트 — 안의 미디어를 절대 경로로 가리키므로 옮기면 프로젝트가 깨진다.
/// 하위 폴더에 프로젝트 파일이 있으면 그 폴더를 통째로 두고(바탕화면 영상 작업 폴더: 프로젝트 · Source · Export),
/// 쓸어 볼 자리 맨 위에 흩어진 프로젝트 파일은 그것이 가리키는 파일만 지킨다 (다운로드 맨 위의 .camproj 하나 때문에 다운로드 전체를 건너뛰지 않게).
const PROJECT_EXTS: &[&str] = &["camproj", "tscproj", "prproj", "aep"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyItem {
    /// 계획을 보일 때 묶는 이름 (예: 「바탕화면」 · 「다운로드」).
    pub area: String,
    pub path: String,
    pub size: u64,
    pub modified: i64,
    /// 내용이 똑같은 정본 (여럿이면 하나만).
    pub keep: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TidyPlan {
    pub keep_roots: Vec<String>,
    pub sweep: Vec<(String, String)>,
    pub items: Vec<TidyItem>,
    /// 쓸어 본 파일 수 (계획에 든 것 + 정본이 없어 남긴 것).
    pub scanned: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    pub from: String,
    pub to: String,
    pub size: u64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub moved: Vec<Moved>,
    /// 옮기지 않은 것과 까닭 (바뀜 · 없어짐 · 실패).
    pub skipped: Vec<(String, String)>,
}

struct FileInfo {
    path: PathBuf,
    size: u64,
    modified: i64,
}

fn mtime(meta: &std::fs::Metadata) -> i64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn skip_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    // 바로가기는 정본을 가리키는 창구라 남긴다 (지침: 바탕화면에는 (정본).lnk). 오피스 잠금 파일 · 시스템 파일도.
    lower.ends_with(".lnk") || lower == "desktop.ini" || lower == "thumbs.db" || name.starts_with("~$")
}

#[derive(Clone, Copy, PartialEq)]
enum Walk {
    /// 쓸어 볼 자리 — 영상 프로젝트 폴더를 건너뛴다.
    Sweep,
    /// 남길 자리 — 정본이 아닌 자리를 건너뛴다.
    Keep,
}

fn has_project_file(dir: &Path) -> bool {
    std::fs::read_dir(dir).map(|rd| {
        rd.flatten().any(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            PROJECT_EXTS.iter().any(|x| n.ends_with(&format!(".{x}")))
        })
    })
    .unwrap_or(false)
}

/// 프로젝트 파일이 가리키는 미디어 경로 (소문자). 절대 경로는 그대로, 이름만 있으면 프로젝트 폴더 기준.
fn project_refs(project: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(project) else { return Vec::new() };
    let text = String::from_utf8_lossy(&bytes);
    let base = project.parent().unwrap_or(Path::new(""));
    let mut out = Vec::new();
    // 따옴표 · 꺾쇠 사이의 조각 중 파일 확장자로 끝나는 것
    for raw in text.split(|c| c == '"' || c == '<' || c == '>') {
        let r = raw.trim();
        if r.len() < 5 || r.len() > 400 || r.contains(['\r', '\n']) {
            continue;
        }
        let r = r.split('!').next().unwrap_or(r); // `기초조사.trec!$audio1.mp4` 꼴
        let has_ext = Path::new(r).extension().is_some_and(|e| e.len() <= 5 && e.to_string_lossy().chars().all(|c| c.is_ascii_alphanumeric()));
        if !has_ext {
            continue;
        }
        // 프로젝트 파일은 XML 이라 `&` · `'` 가 `&amp;` · `&apos;` 로 적혀 있다 — 풀지 않으면 실제 경로와 안 맞아 지키지 못한다.
        let r = xml_unescape(r);
        let p = if r.len() > 2 && r.as_bytes()[1] == b':' { PathBuf::from(&r) } else { base.join(&r) };
        out.push(path_key(&p));
    }
    out
}

fn xml_unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(end) = tail.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let ent = &tail[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "apos" => Some('\''),
            "quot" => Some('"'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// 경로 비교 열쇠 — 소문자 · 구분자 하나로 (프로젝트 파일은 `/` 와 `\` 를 섞어 쓴다).
/// Windows 경로는 대소문자를 가리지 않으므로 비교는 늘 이 열쇠로 한다 (`Path::starts_with` 는 가린다).
fn path_key(p: &Path) -> String {
    let mut s = p.to_string_lossy().replace('/', "\\").to_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// `child` 가 `parent` 와 같거나 그 아래인가 (대소문자 무시).
fn is_within(child: &Path, parent: &Path) -> bool {
    let (c, p) = (path_key(child), path_key(parent));
    c == p || c.starts_with(&format!("{}\\", p.trim_end_matches('\\')))
}

/// 정리함 표시 — 정리함 맨 위에 둔다. 이 파일이 있는 폴더는 계획이 쓸지 않는다
/// (정리함을 쓸어 볼 자리 안에 두면 다음 계획이 정리함 속 사본을 다시 옮기려 한다).
pub const BOX_MARKER: &str = ".filedesk-정리함";

/// `root` 를 훑는다. `exclude` 중 `root` 아래에 있는 것만 뺀다 — 조상이나 자기 자신은 빼지 않는다.
/// 그래야 저장소 전체(`D:\문서`)를 쓸면서 그 안의 사업 하나를 정본으로 줘도, 양쪽 다 빈 계획이 되지 않는다.
fn walk(root: &Path, out: &mut Vec<FileInfo>, exclude: &[PathBuf], mode: Walk) {
    let inside: Vec<PathBuf> = exclude.iter().filter(|x| !is_within(root, x) && is_within(x, root)).cloned().collect();
    walk_inner(root, out, &inside, mode, true)
}

fn walk_inner(dir: &Path, out: &mut Vec<FileInfo>, exclude: &[PathBuf], mode: Walk, is_root: bool) {
    if exclude.iter().any(|x| is_within(dir, x)) {
        return;
    }
    if dir.join(BOX_MARKER).exists() {
        return;
    }
    if mode == Walk::Sweep && !is_root && has_project_file(dir) {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_symlink() {
            continue; // 정션 · 링크는 따라가지 않는다 (같은 파일을 두 번 세지 않게)
        }
        if ft.is_dir() {
            let skip = name.starts_with('.')
                || SKIP_DIRS.contains(&name.as_str())
                || (mode == Walk::Keep && NOT_CANON_DIRS.contains(&name.as_str()));
            if !skip {
                walk_inner(&p, out, exclude, mode, false);
            }
        } else if ft.is_file() && !skip_name(&name) {
            if let Ok(m) = e.metadata() {
                if m.len() > 0 {
                    out.push(FileInfo { path: p, size: m.len(), modified: mtime(&m) });
                }
            }
        }
    }
}

/// 파일 전체 내용의 해시.
pub fn hash_file(p: &Path) -> std::io::Result<[u8; 32]> {
    let mut f = std::fs::File::open(p)?;
    let mut h = blake3::Hasher::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(*h.finalize().as_bytes())
}

/// 여러 파일을 스레드 여럿으로 해시한다. 읽지 못한 파일은 결과에서 빠진다.
fn hash_many(paths: Vec<PathBuf>) -> HashMap<PathBuf, [u8; 32]> {
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunks: Vec<Vec<PathBuf>> = {
        let mut c: Vec<Vec<PathBuf>> = (0..workers).map(|_| Vec::new()).collect();
        for (i, p) in paths.into_iter().enumerate() {
            c[i % workers].push(p);
        }
        c
    };
    std::thread::scope(|s| {
        let handles: Vec<_> = chunks
            .into_iter()
            .map(|chunk| s.spawn(move || chunk.into_iter().filter_map(|p| hash_file(&p).ok().map(|h| (p, h))).collect::<Vec<_>>()))
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

/// 정리 계획을 세운다. `sweep` 은 (보일 이름, 경로) · `keep` 은 정본이 있는 자리.
pub fn plan(sweep: &[(String, PathBuf)], keep: &[PathBuf]) -> TidyPlan {
    // 쓸어 볼 파일. 남길 자리 안은 쓸지 않는다 (겹쳐 지정했을 때 정본을 치우지 않게).
    let mut sweep_files: Vec<(String, FileInfo)> = Vec::new();
    for (area, root) in sweep {
        // 안쪽에 따로 지정한 자리(예: 바탕화면 속 옛 루트)는 바깥 자리에서 빼고 따로 센다 — 두 번 세지 않게.
        let mut exclude: Vec<PathBuf> = keep.to_vec();
        exclude.extend(sweep.iter().map(|(_, p)| p.clone()).filter(|p| path_key(p) != path_key(root) && is_within(p, root)));
        let mut v = Vec::new();
        walk(root, &mut v, &exclude, Walk::Sweep);
        sweep_files.extend(v.into_iter().map(|f| (area.clone(), f)));
    }
    // 쓸어 볼 자리 맨 위의 프로젝트 파일이 가리키는 파일은 뺀다.
    let mut protected: HashSet<String> = HashSet::new();
    for (_, root) in sweep {
        if let Ok(rd) = std::fs::read_dir(root) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if PROJECT_EXTS.iter().any(|x| n.ends_with(&format!(".{x}"))) {
                    protected.extend(project_refs(&e.path()));
                }
            }
        }
    }
    sweep_files.retain(|(_, f)| !protected.contains(&path_key(&f.path)));
    let sizes: HashSet<u64> = sweep_files.iter().map(|(_, f)| f.size).collect();

    // 남길 자리의 파일 — 쓸어 볼 자리 안은 정본으로 치지 않는다 (옛 루트끼리 서로를 정본으로 삼지 않게).
    let sweep_roots: Vec<PathBuf> = sweep.iter().map(|(_, p)| p.clone()).collect();
    let mut keep_files = Vec::new();
    for root in keep {
        walk(root, &mut keep_files, &sweep_roots, Walk::Keep);
    }
    keep_files.retain(|f| sizes.contains(&f.size));
    let keep_sizes: HashSet<u64> = keep_files.iter().map(|f| f.size).collect();

    // 크기가 겹치는 것만 해시한다.
    let candidates: Vec<&(String, FileInfo)> = sweep_files.iter().filter(|(_, f)| keep_sizes.contains(&f.size)).collect();
    let mut to_hash: Vec<PathBuf> = candidates.iter().map(|(_, f)| f.path.clone()).collect();
    to_hash.extend(keep_files.iter().map(|f| f.path.clone()));
    let hashes = hash_many(to_hash);

    let mut keep_by_hash: HashMap<[u8; 32], &FileInfo> = HashMap::new();
    for f in &keep_files {
        if let Some(h) = hashes.get(&f.path) {
            keep_by_hash.entry(*h).or_insert(f);
        }
    }
    let mut items: Vec<TidyItem> = candidates
        .into_iter()
        .filter_map(|(area, f)| {
            let h = hashes.get(&f.path)?;
            let k = keep_by_hash.get(h)?;
            // 자기 자신을 정본으로 삼지 않는다 — 그러면 적용이 정본 그 자체를 정리함으로 옮긴다.
            if path_key(&k.path) == path_key(&f.path) {
                return None;
            }
            Some(TidyItem {
                area: area.clone(),
                path: f.path.to_string_lossy().into_owned(),
                size: f.size,
                modified: f.modified,
                keep: k.path.to_string_lossy().into_owned(),
            })
        })
        .collect();
    items.sort_by(|a, b| a.path.cmp(&b.path));

    TidyPlan {
        keep_roots: keep.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        sweep: sweep.iter().map(|(n, p)| (n.clone(), p.to_string_lossy().into_owned())).collect(),
        scanned: sweep_files.len(),
        items,
    }
}

/// `C:\a\b.txt` → `<base>\C\a\b.txt`
fn quarantine_path(base: &Path, original: &Path) -> PathBuf {
    let s = original.to_string_lossy();
    let rel = s.replacen(':', "", 1);
    base.join(rel.trim_start_matches('\\'))
}

/// 계획을 적용한다 — 파일을 정리함으로 옮긴다. `only` 가 있으면 그 이름의 묶음(area)만.
/// 기록은 `manifest_path` 에 하나 옮길 때마다 다시 쓴다. **기록이 이미 있으면 이어 쓴다** —
/// 묶음별로 나눠 적용(`--only`)하거나 같은 계획을 두 번 돌려도 앞선 되돌리기 기록이 지워지지 않게.
pub fn apply(plan: &TidyPlan, base: &Path, only: Option<&[String]>, manifest_path: &Path) -> std::io::Result<Manifest> {
    let mut m: Manifest = match std::fs::read_to_string(manifest_path) {
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, format!("기존 기록을 읽지 못했다 — 덮지 않고 멈춘다: {e}")))?,
        Err(_) => Manifest::default(),
    };
    std::fs::create_dir_all(base)?;
    std::fs::write(base.join(BOX_MARKER), b"filedesk tidy box\n")?;
    for it in &plan.items {
        if only.is_some_and(|o| !o.contains(&it.area)) {
            continue;
        }
        let from = Path::new(&it.path);
        let meta = match std::fs::metadata(from) {
            Ok(x) => x,
            Err(_) => {
                m.skipped.push((it.path.clone(), "없어짐".into()));
                continue;
            }
        };
        if meta.len() != it.size || mtime(&meta) != it.modified {
            m.skipped.push((it.path.clone(), "계획 뒤에 바뀜".into()));
            continue;
        }
        if !Path::new(&it.keep).is_file() {
            m.skipped.push((it.path.clone(), "정본이 없어짐".into()));
            continue;
        }
        let to = quarantine_path(base, from);
        let res = to.parent().map(std::fs::create_dir_all).unwrap_or(Ok(())).and_then(|_| {
            if to.exists() {
                Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "정리함에 같은 경로가 있다"))
            } else {
                std::fs::rename(from, &to)
            }
        });
        match res {
            Ok(()) => m.moved.push(Moved { from: it.path.clone(), to: to.to_string_lossy().into_owned(), size: it.size }),
            Err(e) => m.skipped.push((it.path.clone(), e.to_string())),
        }
        write_manifest(manifest_path, &m)?;
    }
    write_manifest(manifest_path, &m)?;
    Ok(m)
}

fn write_manifest(p: &Path, m: &Manifest) -> std::io::Result<()> {
    let tmp = p.with_extension("json.tmp");
    let mut f = std::fs::File::create(&tmp)?;
    f.write_all(serde_json::to_string_pretty(m).expect("직렬화").as_bytes())?;
    drop(f);
    std::fs::rename(tmp, p)
}

/// 기록대로 제자리에 돌려놓는다. 돌려놓은 수와 건너뛴 것(까닭)을 준다.
pub fn undo(m: &Manifest) -> (usize, Vec<(String, String)>) {
    let mut done = 0;
    let mut skipped = Vec::new();
    for mv in m.moved.iter().rev() {
        let (from, to) = (Path::new(&mv.from), Path::new(&mv.to));
        if from.exists() {
            skipped.push((mv.from.clone(), "제자리에 이미 파일이 있다".into()));
            continue;
        }
        let r = from.parent().map(std::fs::create_dir_all).unwrap_or(Ok(())).and_then(|_| std::fs::rename(to, from));
        match r {
            Ok(()) => done += 1,
            Err(e) => skipped.push((mv.from.clone(), e.to_string())),
        }
    }
    (done, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_apply_undo_roundtrip() {
        let t = std::env::temp_dir().join(format!("fd-tidy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        let (keep, desk, box_) = (t.join("루트"), t.join("바탕화면"), t.join("정리함"));
        std::fs::create_dir_all(keep.join("산출물")).unwrap();
        std::fs::create_dir_all(desk.join("옛루트/구현")).unwrap();
        std::fs::write(keep.join("산출물/정의서_v1.xlsx"), b"same content").unwrap();
        std::fs::write(desk.join("옛루트/구현/다른이름.xlsx"), b"same content").unwrap(); // 이름이 달라도 내용이 같으면 사본
        std::fs::write(desk.join("혼자만있음.txt"), b"only here").unwrap();
        std::fs::write(desk.join("크기만같음.txt"), b"same contenX").unwrap(); // 크기는 같고 내용은 다름
        std::fs::write(desk.join("정본 (정본).lnk"), b"same content").unwrap(); // 바로가기는 남긴다

        let p = plan(&[("바탕화면".into(), desk.clone())], &[keep.clone()]);
        assert_eq!(p.items.len(), 1, "{:?}", p.items);
        assert!(p.items[0].path.ends_with("다른이름.xlsx"));

        let mf = t.join("manifest.json");
        let m = apply(&p, &box_, None, &mf).unwrap();
        assert_eq!(m.moved.len(), 1);
        assert!(!desk.join("옛루트/구현/다른이름.xlsx").exists());
        assert!(Path::new(&m.moved[0].to).is_file());
        assert!(desk.join("혼자만있음.txt").is_file());

        let saved: Manifest = serde_json::from_str(&std::fs::read_to_string(&mf).unwrap()).unwrap();
        let (n, skipped) = undo(&saved);
        assert_eq!((n, skipped.len()), (1, 0));
        assert_eq!(std::fs::read(desk.join("옛루트/구현/다른이름.xlsx")).unwrap(), b"same content");
        std::fs::remove_dir_all(&t).unwrap();
    }

    #[test]
    fn temporary_copies_are_not_canon_and_projects_are_left() {
        let t = std::env::temp_dir().join(format!("fd-tidy3-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        for d in ["k/.claude/worktrees/x", "k/작업", "s/영상", "s/옛"] {
            std::fs::create_dir_all(t.join(d)).unwrap();
        }
        std::fs::write(t.join("k/.claude/worktrees/x/a.txt"), b"only-in-worktree").unwrap();
        std::fs::write(t.join("k/작업/b.txt"), b"only-in-work").unwrap();
        std::fs::write(t.join("s/옛/a.txt"), b"only-in-worktree").unwrap();
        std::fs::write(t.join("s/옛/b.txt"), b"only-in-work").unwrap();
        std::fs::write(t.join("k/clip.mp4"), b"clip").unwrap();
        std::fs::write(t.join("s/영상/clip.mp4"), b"clip").unwrap();
        std::fs::write(t.join("s/영상/편집.camproj"), b"{}").unwrap();
        // 맨 위에 흩어진 프로젝트: 가리키는 파일만 지키고 나머지는 정리 대상
        std::fs::write(t.join("k/ref.mp4"), b"ref").unwrap();
        std::fs::write(t.join("k/free.mp4"), b"free").unwrap();
        std::fs::write(t.join("s/ref.mp4"), b"ref").unwrap();
        std::fs::write(t.join("s/free.mp4"), b"free").unwrap();
        let abs = t.join("s/ref.mp4").to_string_lossy().into_owned();
        std::fs::write(t.join("s/top.camproj"), format!("<Media src=\"{abs}\"/>")).unwrap();
        let p = plan(&[("s".into(), t.join("s"))], &[t.join("k")]);
        let names: Vec<_> = p.items.iter().map(|i| Path::new(&i.path).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["free.mp4"], "{:?}", p.items);
        std::fs::remove_dir_all(&t).unwrap();
    }

    fn tmp(tag: &str) -> PathBuf {
        let t = std::env::temp_dir().join(format!("fd-tidy-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        std::fs::create_dir_all(&t).unwrap();
        t
    }

    // 리뷰 11-11: 정본 자리가 쓸 자리 안에 있어도(저장소 전체를 쓸고 그 안 사업을 정본으로) 빈 계획이 되지 않는다.
    #[test]
    fn keep_nested_in_sweep_still_plans() {
        let t = tmp("nest");
        std::fs::create_dir_all(t.join("문서/사업/2026/X/산출물")).unwrap();
        std::fs::create_dir_all(t.join("문서/공통")).unwrap();
        std::fs::write(t.join("문서/사업/2026/X/산출물/a.pptx"), b"canon").unwrap();
        std::fs::write(t.join("문서/공통/a 사본.pptx"), b"canon").unwrap();
        let p = plan(&[("문서".into(), t.join("문서"))], &[t.join("문서/사업/2026/X")]);
        assert_eq!(p.items.len(), 1, "{:?}", p.items);
        assert!(p.items[0].path.ends_with("a 사본.pptx"));
        std::fs::remove_dir_all(&t).unwrap();
    }

    // 리뷰 11-11: 대소문자만 다른 경로로 겹쳐 줘도 정본이 자기 자신을 정본으로 삼아 옮겨지지 않는다.
    #[test]
    fn never_plans_canon_itself() {
        let t = tmp("self");
        std::fs::create_dir_all(t.join("Root/k")).unwrap();
        std::fs::write(t.join("Root/k/only.txt"), b"x").unwrap();
        let upper = PathBuf::from(t.join("Root").to_string_lossy().to_uppercase());
        let p = plan(&[("w".into(), upper)], &[t.join("Root/k")]);
        assert!(p.items.is_empty(), "{:?}", p.items);
        std::fs::remove_dir_all(&t).unwrap();
    }

    // 리뷰 11-11: 프로젝트 XML 속 `&amp;` 를 풀어 실제 경로와 맞춘다.
    #[test]
    fn project_refs_decode_xml_entities() {
        let t = tmp("xml");
        std::fs::create_dir_all(t.join("k")).unwrap();
        std::fs::create_dir_all(t.join("s")).unwrap();
        std::fs::write(t.join("k/R&D 영상.mp4"), b"clip").unwrap();
        std::fs::write(t.join("s/R&D 영상.mp4"), b"clip").unwrap();
        let abs = t.join("s").join("R&amp;D 영상.mp4").to_string_lossy().into_owned();
        std::fs::write(t.join("s/p.camproj"), format!("<Media src=\"{abs}\"/>")).unwrap();
        let p = plan(&[("s".into(), t.join("s"))], &[t.join("k")]);
        assert!(p.items.is_empty(), "{:?}", p.items);
        assert_eq!(xml_unescape("a&amp;b&apos;c&#44;&#x41;&bogus;"), "a&b'c,A&bogus;");
        std::fs::remove_dir_all(&t).unwrap();
    }

    // 리뷰 11-11: 나눠 적용해도 앞선 기록이 남고, 정리함은 다음 계획이 쓸지 않는다.
    #[test]
    fn apply_appends_manifest_and_box_is_not_swept() {
        let t = tmp("append");
        for d in ["k", "s/a", "s/b"] {
            std::fs::create_dir_all(t.join(d)).unwrap();
        }
        std::fs::write(t.join("k/1.txt"), b"one").unwrap();
        std::fs::write(t.join("k/2.txt"), b"two").unwrap();
        std::fs::write(t.join("s/a/1.txt"), b"one").unwrap();
        std::fs::write(t.join("s/b/2.txt"), b"two").unwrap();
        let p = plan(&[("a".into(), t.join("s/a")), ("b".into(), t.join("s/b"))], &[t.join("k")]);
        let bx = t.join("s/정리함"); // 쓸 자리 안에 둔 정리함
        let mf = bx.join("manifest.json");
        apply(&p, &bx, Some(&["a".to_string()]), &mf).unwrap();
        let m = apply(&p, &bx, Some(&["b".to_string()]), &mf).unwrap();
        assert_eq!(m.moved.len(), 2, "두 번째 적용이 첫 기록을 지우지 않는다");
        let again = plan(&[("s".into(), t.join("s"))], &[t.join("k")]);
        assert!(again.items.is_empty(), "정리함 속 사본을 다시 계획하지 않는다: {:?}", again.items);
        let (n, _) = undo(&serde_json::from_str(&std::fs::read_to_string(&mf).unwrap()).unwrap());
        assert_eq!(n, 2);
        assert!(t.join("s/a/1.txt").is_file() && t.join("s/b/2.txt").is_file());
        std::fs::remove_dir_all(&t).unwrap();
    }

    #[test]
    fn changed_after_plan_is_skipped() {
        let t = std::env::temp_dir().join(format!("fd-tidy2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        std::fs::create_dir_all(t.join("k")).unwrap();
        std::fs::create_dir_all(t.join("s")).unwrap();
        std::fs::write(t.join("k/a.txt"), b"abc").unwrap();
        std::fs::write(t.join("s/a.txt"), b"abc").unwrap();
        let p = plan(&[("s".into(), t.join("s"))], &[t.join("k")]);
        assert_eq!(p.items.len(), 1);
        std::fs::write(t.join("s/a.txt"), b"abcd").unwrap(); // 계획 뒤에 고침
        let m = apply(&p, &t.join("box"), None, &t.join("m.json")).unwrap();
        assert_eq!(m.moved.len(), 0);
        assert!(t.join("s/a.txt").is_file());
        std::fs::remove_dir_all(&t).unwrap();
    }
}
