//! 실행 취소 (Ctrl+Z) — 이 앱에서 한 파일 작업을 거꾸로 돌린다.
//!
//! 2026.11.17 : 사용자 요청 「탐색기보다 불편한 점」 첫째. 셸 작업에 FOF_ALLOWUNDO 를 주지만, 그 되돌리기 기록은
//!   탐색기 프로세스 안에 있어 이 앱에서는 Ctrl+Z 로 꺼낼 수 없다. 그래서 작업마다 「무엇을 어디로」를 여기에 쌓는다.
//!
//! 쌓는 것: 이름 바꾸기 · 옮기기 · 복사 · 휴지통 · 새 폴더 · 새 판 · 지난 판 옮기기.
//! 되돌리기도 셸 작업(IFileOperation)이라 진행 창 · 충돌 창은 탐색기와 같다. 휴지통만 예외 — 아래 `restore_recycled`.
//!
//! 지키는 것 — 작업 전에 이미 있던 자리는 기록하지 않는다. 같은 이름을 「바꾸기」로 덮은 복사를 되돌리며
//!   새 파일을 휴지통에 보내면 덮이기 전 파일은 돌아오지 않는데, 그것을 되돌렸다고 말하면 안 된다.
//! 앱을 끄면 기록이 사라진다 (탐색기도 같다).

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// 쌓아 두는 수. 탐색기와 비슷하게 넉넉히.
const KEEP: usize = 50;

#[derive(Debug, Clone)]
pub enum Step {
    Rename { from: String, to: String },
    /// (원래 자리, 옮긴 자리)
    Move { pairs: Vec<(String, String)> },
    /// 새로 생긴 사본
    Copy { made: Vec<String> },
    /// 휴지통으로 보낸 원래 경로 · 보낸 때(유닉스 초)
    Recycle { paths: Vec<String>, at: i64 },
    NewFolder { path: String },
    /// 한 번의 동작이 여럿을 한 것 (새 판 = 사본 + 지난 판 옮기기). 거꾸로 돌린다.
    Batch { label: String, steps: Vec<Step> },
}

impl Step {
    /// 메뉴 · 알림에 쓸 이름 — 「실행 취소: 이름 바꾸기」.
    pub fn label(&self) -> String {
        let n = |k: usize| if k > 1 { format!(" ({k}개)") } else { String::new() };
        match self {
            Step::Rename { .. } => "이름 바꾸기".into(),
            Step::Move { pairs } => format!("옮기기{}", n(pairs.len())),
            Step::Copy { made } => format!("복사{}", n(made.len())),
            Step::Recycle { paths, .. } => format!("휴지통으로 보내기{}", n(paths.len())),
            Step::NewFolder { .. } => "새 폴더".into(),
            Step::Batch { label, .. } => label.clone(),
        }
    }
}

static STACK: Mutex<Vec<Step>> = Mutex::new(Vec::new());

pub fn push(s: Step) {
    let mut st = STACK.lock().unwrap();
    st.push(s);
    let over = st.len().saturating_sub(KEEP);
    st.drain(..over);
}

pub fn pop() -> Option<Step> {
    STACK.lock().unwrap().pop()
}

pub fn peek() -> Option<String> {
    STACK.lock().unwrap().last().map(Step::label)
}

pub fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn exists(p: &str) -> bool {
    Path::new(p).symlink_metadata().is_ok()
}

fn name_of(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// 복사 · 옮기기 전에 세운 계획 — 갈 자리마다 그 자리가 이미 있었는지.
pub struct Planned {
    items: Vec<(String, String, bool)>,
    dest: String,
    /// 복사 전 대상 폴더의 이름들 — 「- 복사본」 · 「(2)」 로 붙은 사본을 찾으려고
    before: std::collections::HashSet<String>,
}

pub fn plan_transfer(paths: &[String], dest: &str) -> Planned {
    let items = paths
        .iter()
        .map(|p| {
            let to = Path::new(dest).join(name_of(p)).to_string_lossy().into_owned();
            let had = exists(&to);
            (p.clone(), to, had)
        })
        .collect();
    Planned { items, dest: dest.to_string(), before: names_in(dest) }
}

fn names_in(dir: &str) -> std::collections::HashSet<String> {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect())
        .unwrap_or_default()
}

/// 작업 뒤 실제로 바뀐 것만 남긴다 (중간에 취소 · 건너뛰기한 것은 빠진다).
pub fn step_of(p: Planned, mv: bool) -> Option<Step> {
    if mv {
        let pairs: Vec<(String, String)> =
            p.items.into_iter().filter(|(from, to, had)| !had && exists(to) && !exists(from)).map(|(f, t, _)| (f, t)).collect();
        return (!pairs.is_empty()).then_some(Step::Move { pairs });
    }
    let mut made: Vec<String> = p.items.iter().filter(|(_, to, had)| !had && exists(to)).map(|(_, t, _)| t.clone()).collect();
    // 같은 폴더에 복사하거나 「둘 다 두기」를 고르면 셸이 이름을 바꿔 붙인다 (「보고서 - 복사본.hwpx」 · 「보고서 (2).hwpx」).
    //   새로 생긴 이름 가운데 셸이 붙이는 꼴과 똑같은 것만 사본으로 본다 — 그사이 받은 다른 파일을 휴지통에 보내지 않게.
    // 2026.11.18 : 원본 이름 앞부분으로 시작하면 사본으로 보던 것을 바꿨다 (리뷰 지적). `a.txt` 를 복사하는 사이 받은 `app_setup.exe` 까지 되돌리기가 휴지통에 보냈다.
    let names: Vec<String> = p.items.iter().map(|(f, _, _)| name_of(f).to_lowercase()).filter(|s| !s.is_empty()).collect();
    for n in names_in(&p.dest).difference(&p.before) {
        let full = Path::new(&p.dest).join(n).to_string_lossy().into_owned();
        if names.iter().any(|s| is_copy_name(n, s)) && !made.iter().any(|m| m.eq_ignore_ascii_case(&full)) {
            // names_in 은 작은 글자라 실제 이름으로 되찾는다
            if let Some(real) = real_name(&p.dest, n) {
                made.push(real);
            }
        }
    }
    (!made.is_empty()).then_some(Step::Copy { made })
}

/// `n` 이 셸이 `src` 의 사본에 붙이는 이름인가 — 「a - 복사본.txt」 · 「a - copy.txt」 · 「a (2).txt」 · 「a - 복사본 (2).txt」.
/// 둘 다 작은 글자. 폴더 이름의 점(「2026.11」)은 확장자가 아니므로 이름 전체로도 맞춰 본다.
fn is_copy_name(n: &str, src: &str) -> bool {
    let p = Path::new(src);
    let mut splits = vec![(src.to_string(), String::new())];
    if let (Some(s), Some(e)) = (p.file_stem(), p.extension()) {
        splits.push((s.to_string_lossy().into_owned(), format!(".{}", e.to_string_lossy())));
    }
    splits.iter().any(|(stem, ext)| n.strip_prefix(stem.as_str()).and_then(|r| r.strip_suffix(ext.as_str())).is_some_and(copy_tail))
}

/// 원본 이름 뒤에 셸이 붙이는 꼬리 — 「 - 복사본」 · 「 - copy」 와 「 (번호)」 의 조합. 빈 꼬리는 사본이 아니다.
fn copy_tail(t: &str) -> bool {
    let (marked, rest) = match t.strip_prefix(" - 복사본").or_else(|| t.strip_prefix(" - copy")) {
        Some(r) => (true, r),
        None => (false, t),
    };
    if rest.is_empty() {
        return marked;
    }
    rest.strip_prefix(" (").and_then(|r| r.strip_suffix(')')).is_some_and(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()))
}

fn real_name(dir: &str, lower: &str) -> Option<String> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .find(|e| e.file_name().to_string_lossy().to_lowercase() == lower)
        .map(|e| e.path().to_string_lossy().into_owned())
}

/// 되돌리기 한 번에 할 셸 작업. 셸 호출은 lib.rs 가 STA 스레드에서 한다.
pub enum Action {
    Rename { path: String, name: String, memo_from: String },
    /// 이 자리들을 이 폴더로 옮긴다
    MoveBack { paths: Vec<String>, dest: String },
    Recycle { paths: Vec<String> },
    Restore { paths: Vec<String>, since: i64 },
}

/// 단계를 셸 작업 목록으로. 이미 사라졌거나 다른 것이 자리를 차지한 항목은 빼고, 뺀 수를 함께 준다.
pub fn actions(s: Step) -> (Vec<Action>, usize) {
    let mut out = Vec::new();
    let mut skipped = 0;
    collect(s, &mut out, &mut skipped);
    (out, skipped)
}

fn collect(s: Step, out: &mut Vec<Action>, skipped: &mut usize) {
    match s {
        Step::Rename { from, to } => {
            // 대소문자만 바꾼 이름(report → Report)은 두 경로가 같은 파일이라 `exists(from)` 이 늘 참이다 — 그때는 묻지 않는다
            let case_only = from.to_lowercase() == to.to_lowercase();
            if exists(&to) && (case_only || !exists(&from)) {
                out.push(Action::Rename { path: to, name: name_of(&from), memo_from: from });
            } else {
                *skipped += 1;
            }
        }
        Step::Move { pairs } => {
            // 원래 폴더마다 한 번씩 옮긴다
            let mut by_dir: Vec<(String, Vec<String>)> = Vec::new();
            for (from, to) in pairs {
                if !exists(&to) || exists(&from) {
                    *skipped += 1;
                    continue;
                }
                let dir = Path::new(&from).parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
                match by_dir.iter_mut().find(|(d, _)| d.eq_ignore_ascii_case(&dir)) {
                    Some((_, v)) => v.push(to),
                    None => by_dir.push((dir, vec![to])),
                }
            }
            out.extend(by_dir.into_iter().map(|(dest, paths)| Action::MoveBack { paths, dest }));
        }
        Step::Copy { made } => {
            let (live, gone): (Vec<String>, Vec<String>) = made.into_iter().partition(|p| exists(p));
            *skipped += gone.len();
            if !live.is_empty() {
                out.push(Action::Recycle { paths: live });
            }
        }
        Step::Recycle { paths, at } => out.push(Action::Restore { paths, since: at }),
        Step::NewFolder { path } => {
            // 그사이 무언가를 넣었으면 지우지 않는다 — 탐색기는 넣은 것째 휴지통에 보내지만, 「새 폴더 취소」로 파일까지 치우는 건 놀랍다
            let empty = std::fs::read_dir(&path).map(|mut rd| rd.next().is_none()).unwrap_or(false);
            if empty {
                out.push(Action::Recycle { paths: vec![path] });
            } else {
                *skipped += 1;
            }
        }
        Step::Batch { steps, .. } => {
            for s in steps.into_iter().rev() {
                collect(s, out, skipped);
            }
        }
    }
}

// ───────── 휴지통에서 되살리기 ─────────
//
// 셸에는 「이 경로에서 방금 지운 그 항목을 되살려라」는 API 가 없다 (휴지통 폴더를 훑어 「복원」 동사를 고르는 길은 이름이
// 화면 표시 이름이라 같은 이름이 여럿이면 가려내지 못한다). 그래서 휴지통의 기록 파일을 직접 읽는다.
// 드라이브마다 `X:\$Recycle.Bin\<사용자 SID>\` 에 `$Ixxxx`(원래 경로 · 지운 때) · `$Rxxxx`(내용)가 짝으로 있다.
// 되살리기 = `$R` 을 원래 경로로 이름 바꾸기 + `$I` 지우기. 같은 볼륨 안 이름 바꾸기라 내용을 복사하지 않고, 실패해도 `$R` 은 그대로 남는다.

/// `$I` 파일 — (원래 경로, 지운 때 유닉스 초).
fn read_info(p: &Path) -> Option<(String, i64)> {
    let b = std::fs::read(p).ok()?;
    if b.len() < 24 {
        return None;
    }
    let ver = i64::from_le_bytes(b[0..8].try_into().ok()?);
    let ft = i64::from_le_bytes(b[16..24].try_into().ok()?);
    let at = ft / 10_000_000 - 11_644_473_600;
    let wide: Vec<u16> = match ver {
        // Windows 10 이후 — 글자 수(u32) 다음에 경로
        2 => {
            let n = u32::from_le_bytes(b.get(24..28)?.try_into().ok()?) as usize;
            b.get(28..28 + n * 2)?.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect()
        }
        // Vista ~ 8 — MAX_PATH 고정 칸
        1 => b.get(24..)?.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect(),
        _ => return None,
    };
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    Some((String::from_utf16_lossy(&wide[..len]), at))
}

/// 휴지통에서 `paths` 를 원래 자리로. `since` 보다 앞서 지운 것(같은 경로를 예전에 지운 것)은 건드리지 않는다.
/// 돌려주는 값: (되살린 경로, 찾지 못했거나 자리가 차 있어 못 한 경로).
/// 2026.11.18 : 드라이브마다 휴지통을 한 번만 훑는다 (리뷰 지적). 경로마다 훑으면 200개 × 휴지통 5000개 = 기록 파일 백만 번을 읽었다.
pub fn restore_recycled(paths: &[String], since: i64) -> (Vec<String>, Vec<String>) {
    let mut done = Vec::new();
    let mut missed = Vec::new();
    let mut bins: std::collections::HashMap<String, std::collections::HashMap<String, (i64, std::path::PathBuf)>> = Default::default();
    for p in paths {
        let root = Path::new(p).components().next().map(|c| c.as_os_str().to_string_lossy().to_lowercase());
        let found = match root {
            Some(r) if !exists(p) => bins.entry(r.clone()).or_insert_with(|| scan_bin(&r, since)).remove(&p.to_lowercase()),
            _ => None,
        };
        match found.and_then(|(_, info)| put_back(&info, p)) {
            Some(()) => done.push(p.clone()),
            None => missed.push(p.clone()),
        }
    }
    (done, missed)
}

/// 한 드라이브의 휴지통 — 원래 경로(작은 글자)마다 `since` 뒤에 지운 가장 새 `$I`.
fn scan_bin(root: &str, since: i64) -> std::collections::HashMap<String, (i64, std::path::PathBuf)> {
    let mut out: std::collections::HashMap<String, (i64, std::path::PathBuf)> = Default::default();
    let bin = Path::new(&format!("{root}\\")).join("$Recycle.Bin");
    let Ok(sids) = std::fs::read_dir(&bin) else { return out };
    // 다른 사용자의 SID 폴더는 읽기가 막혀 있어 저절로 건너뛴다
    for sid in sids.flatten() {
        let Ok(rd) = std::fs::read_dir(sid.path()) else { continue };
        for f in rd.flatten() {
            if !f.file_name().to_string_lossy().starts_with("$I") {
                continue;
            }
            let Some((orig, at)) = read_info(&f.path()) else { continue };
            // 지운 때는 초 단위로 돌아 2초 여유를 둔다
            if at + 2 < since {
                continue;
            }
            let key = orig.to_lowercase();
            if out.get(&key).map_or(true, |(t, _)| at > *t) {
                out.insert(key, (at, f.path()));
            }
        }
    }
    out
}

/// `$R` 을 원래 자리로 옮기고 `$I` 를 지운다.
fn put_back(info: &Path, path: &str) -> Option<()> {
    let data = info.with_file_name(format!("$R{}", &info.file_name()?.to_string_lossy()[2..]));
    if let Some(parent) = Path::new(path).parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::rename(&data, path).ok()?;
    let _ = std::fs::remove_file(&info);
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn info_v2() {
        let path = r"D:\문서\보고서.hwpx";
        let wide: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let ft: i64 = (1_700_000_000 + 11_644_473_600) * 10_000_000;
        let mut b = Vec::new();
        b.extend(2i64.to_le_bytes());
        b.extend(1234i64.to_le_bytes());
        b.extend(ft.to_le_bytes());
        b.extend((wide.len() as u32).to_le_bytes());
        for c in &wide {
            b.extend(c.to_le_bytes());
        }
        let dir = std::env::temp_dir().join(format!("fd-undo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("$Iabc.hwpx");
        std::fs::write(&f, &b).unwrap();
        assert_eq!(read_info(&f), Some((path.to_string(), 1_700_000_000)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn batch_reverses() {
        let s = Step::Batch {
            label: "새 판".into(),
            steps: vec![Step::Copy { made: vec![] }, Step::Recycle { paths: vec!["a".into()], at: 1 }],
        };
        let (acts, _) = actions(s);
        assert!(matches!(acts.first(), Some(Action::Restore { .. })));
    }

    #[test]
    fn copy_names() {
        assert!(is_copy_name("a - 복사본.txt", "a.txt"));
        assert!(is_copy_name("a - copy (2).txt", "a.txt"));
        assert!(is_copy_name("a (3).txt", "a.txt"));
        assert!(is_copy_name("2026.11 - 복사본", "2026.11"));
        assert!(!is_copy_name("app_setup.exe", "a.txt"));
        assert!(!is_copy_name("a.txt", "a.txt"));
        assert!(!is_copy_name("2026_report.pdf", "2026"));
        assert!(!is_copy_name("a (x).txt", "a.txt"));
    }

    #[test]
    fn keeps_last() {
        for i in 0..KEEP + 5 {
            push(Step::NewFolder { path: format!("x{i}") });
        }
        assert_eq!(STACK.lock().unwrap().len(), KEEP);
    }
}
