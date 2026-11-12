//! 하위 폴더까지 찾기 — 이름 · 메모 글에 찾는 말이 다 들어 있는 항목.
//!
//! 화면의 「거르기」는 지금 폴더만 본다. 어디 있는지 모르는 파일은 이것으로 찾는다 (앱 Shift+Enter · `fd find`).
//! 색인 없이 그 자리에서 훑는다 — 수만 개 폴더도 몇 초 안에 끝나고, 색인을 두면 그 색인이 낡는 것을 따로 챙겨야 한다.
//! 끝이 없을 수 있어(드라이브 통째) 개수 · 시간 상한을 둔다. 상한에 닿으면 `truncated` 로 알린다.
//! 2026.11.11 : `content` 를 켜면 이름 · 메모에서 안 맞은 문서의 본문(`text`)까지 본다. 맞은 자리 앞뒤 글은 `snippet` 으로.
//! 2026.11.12 : 찾기 조건(`query`)과 여러 뿌리 · 하위 폴더를 안 보는 뿌리를 받는 `query` 를 더했다. 색인(`fd-index`)이 있으면 화면은 색인을 먼저 쓰고,
//!              이것은 색인 밖(NAS · 색인을 만드는 중)을 맡는다.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::list::{ATTR_HIDDEN, ATTR_REPARSE, ATTR_SYSTEM, Entry, entry_of};
use crate::query::QuerySpec;

/// 훑지 않는 폴더 — 사람이 찾는 파일이 없고, 들어가면 수십만 개다.
const SKIP_DIRS: &[&str] = &["node_modules", ".git", ".svn", "$recycle.bin", "system volume information", "target", "windows"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    #[serde(flatten)]
    pub entry: Entry,
    /// 메모 글에서 맞았으면 그 메모.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    /// 본문에서 맞았으면 맞은 말 앞뒤 글 (한 줄).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub root: String,
    pub query: String,
    pub items: Vec<Found>,
    /// 본 항목 수.
    pub scanned: usize,
    /// 개수 · 시간 상한에 닿아 다 보지 못했다.
    pub truncated: bool,
    /// 새 찾기가 시작돼 그만두었다.
    pub cancelled: bool,
}

/// 앞선 찾기를 그만두게 하는 번호 — 화면에서 글자를 칠 때마다 새 찾기가 시작된다.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// 새 찾기 번호를 받는다. 이 번호보다 앞선 찾기는 다음 폴더에서 멈춘다.
pub fn next_generation() -> u64 {
    GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

/// 찾는 뿌리. `recursive` 가 거짓이면 그 폴더 바로 아래만 본다 (스마트 폴더 「최근 파일」의 다운로드 · 바탕화면).
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub path: String,
    #[serde(default = "yes")]
    pub recursive: bool,
}

fn yes() -> bool {
    true
}

/// 훑지 않는 폴더 이름인가 (소문자로 견준다). 색인도 같은 목록을 쓴다.
pub fn skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name.to_lowercase().as_str())
}

/// 메모 · 색 표시를 모두 읽어 경로 열쇠(`memo::key`) → 글 · 색 으로. 메모 파일이 없으면 빈 것.
pub fn load_notes() -> (HashMap<String, String>, HashMap<String, String>) {
    let mut text = HashMap::new();
    let mut color = HashMap::new();
    if let Some(s) = crate::memo::default_file().and_then(|f| crate::memo::MemoStore::load(&f).ok()) {
        for m in s.all() {
            let k = crate::memo::key(&m.path);
            if !m.text.is_empty() {
                text.insert(k.clone(), m.text.clone());
            }
            if let Some(c) = &m.color {
                color.insert(k, c.clone());
            }
        }
    }
    (text, color)
}

/// `root` 아래에서 찾는다. `query` 를 빈칸으로 나눈 말이 이름(또는 메모)에 다 들어 있으면 맞다 (대소문자 무시).
/// `memos` 는 경로 열쇠(`memo::key`) → 글. 숨김 · 시스템 항목은 `all` 일 때만.
/// `content` 면 이름 · 메모에서 안 맞은 문서(`text::EXTS`)의 본문까지 본다 — 파일을 열어야 하니 훨씬 느리다.
/// 2026.11.12 : 조건(`query::QuerySpec`)으로 찾는 `query` 의 얇은 껍데기가 됐다. 찾는 말을 조건으로 풀지 않는다 — 예전과 같은 뜻.
#[allow(clippy::too_many_arguments)]
pub fn find(root: &Path, query: &str, all: bool, memos: &HashMap<String, String>, content: bool, limit: usize, budget: Duration, generation: Option<u64>) -> SearchResult {
    let roots = [Root { path: root.to_string_lossy().into_owned(), recursive: true }];
    let mut r = self::query(&roots, &QuerySpec::terms_only(query), all, memos, &HashMap::new(), content, limit, budget, generation);
    r.query = query.to_string();
    r
}

/// 뿌리들 아래에서 조건에 맞는 항목을 그 자리에서 훑어 찾는다 — 색인 밖(NAS · 색인을 만드는 중) 범위와 `fd query --live` 가 쓴다.
/// `memos` · `colors` 는 경로 열쇠(`memo::key`) → 메모 글 · 색. 조건이 비어 있으면 아무것도 찾지 않는다.
#[allow(clippy::too_many_arguments)]
pub fn query(
    roots: &[Root],
    spec: &QuerySpec,
    all: bool,
    memos: &HashMap<String, String>,
    colors: &HashMap<String, String>,
    content: bool,
    limit: usize,
    budget: Duration,
    generation: Option<u64>,
) -> SearchResult {
    let terms = &spec.terms;
    let started = Instant::now();
    let root_label = roots.iter().map(|r| r.path.as_str()).collect::<Vec<_>>().join(" · ");
    let mut out = SearchResult { root: root_label, query: terms.join(" "), items: Vec::new(), scanned: 0, truncated: false, cancelled: false };
    if spec.is_empty() {
        return out;
    }
    let stale = || generation.is_some_and(|g| g != GENERATION.load(Ordering::SeqCst));
    // pdf 는 한 개에 수 초가 걸린다 (실제 산출물 폴더 2026.11.11 실측: pdf 74개 305초 · 나머지 문서 246개 4초).
    // 훑으면서 바로 읽으면 앞쪽 pdf 몇 개가 예산을 다 써 빠른 문서들을 못 본다 — 그래서 모아 두었다가 맨 뒤에 여럿이 나눠 읽는다.
    let mut slow: Vec<(Entry, Option<String>)> = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, bool)> = roots.iter().rev().map(|r| (std::path::PathBuf::from(&r.path), r.recursive)).collect();
    'dirs: while let Some((dir, deep)) = stack.pop() {
        if stale() {
            out.cancelled = true;
            break;
        }
        if started.elapsed() > budget || out.items.len() >= limit {
            out.truncated = true;
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for item in rd.flatten() {
            out.scanned += 1;
            let Some(e) = entry_of(&item) else { continue };
            if !all && e.attrs & (ATTR_HIDDEN | ATTR_SYSTEM) != 0 {
                continue;
            }
            if deep && e.is_dir && !skip_dir(&e.name) && e.attrs & ATTR_REPARSE == 0 {
                stack.push((item.path(), true));
            }
            let key = crate::memo::key(&e.path);
            let memo = memos.get(&key);
            let color = colors.get(&key).map(String::as_str);
            if spec.entry_ok(&e, memo.map(String::as_str), color).is_some() {
                out.items.push(Found { entry: e, memo: memo.cloned(), snippet: None });
            } else if content
                && !terms.is_empty()
                && !e.is_dir
                && crate::text::worth(&e.ext, e.size)
                && spec.meta_ok(e.is_dir, &e.ext, e.size, e.modified, e.created)
                && spec.notes_ok(memo.map(String::as_str), color)
                && !spec.excluded_by(&e.name.to_lowercase())
            {
                // 파일 하나를 여는 데 수백 ms 가 걸릴 수 있어 폴더 사이가 아니라 파일마다 그만둘 때인지 본다.
                if stale() {
                    out.cancelled = true;
                    break 'dirs;
                }
                if started.elapsed() > budget {
                    out.truncated = true;
                    break 'dirs;
                }
                if e.ext == "pdf" {
                    slow.push((e, memo.cloned()));
                    continue;
                }
                let found = crate::text::cached(Path::new(&e.path), e.modified, e.size).and_then(|t| crate::text::snippet(&t, terms));
                if let Some(s) = found {
                    out.items.push(Found { entry: e, memo: memo.cloned(), snippet: Some(s) });
                }
            }
            if out.items.len() >= limit {
                out.truncated = true;
                break;
            }
        }
    }
    if !slow.is_empty() && !out.cancelled && !out.truncated {
        slow_pass(&slow, terms, &stale, limit, started, budget, &mut out);
    }
    out
}

/// 미뤄 둔 pdf 를 스레드 몇 개가 나눠 읽는다. 스레드마다 다음 파일을 집기 전에 예산 · 세대 · 개수를 본다.
/// 이미 읽고 있는 파일은 끝까지 읽으므로 예산을 그 한 파일만큼 넘길 수 있다.
fn slow_pass(slow: &[(Entry, Option<String>)], terms: &[String], stale: &(dyn Fn() -> bool + Sync), limit: usize, started: Instant, budget: Duration, out: &mut SearchResult) {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    // 넷까지만 — pdf 하나가 메모리를 수백 MB 쓸 수 있고, 화면 스레드가 굶지 않게.
    let workers = std::thread::available_parallelism().map_or(2, |n| n.get().min(4)).min(slow.len());
    let next = AtomicUsize::new(0);
    let cancelled = AtomicBool::new(false);
    let truncated = AtomicBool::new(false);
    let have = out.items.len();
    let found: Mutex<Vec<Found>> = Mutex::new(Vec::new());
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| {
                loop {
                    if stale() {
                        cancelled.store(true, Ordering::Relaxed);
                        break;
                    }
                    if started.elapsed() > budget || have + found.lock().map_or(0, |f| f.len()) >= limit {
                        truncated.store(true, Ordering::Relaxed);
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some((e, memo)) = slow.get(i) else { break };
                    let hit = crate::text::cached(Path::new(&e.path), e.modified, e.size).and_then(|t| crate::text::snippet(&t, terms));
                    if let (Some(sn), Ok(mut f)) = (hit, found.lock()) {
                        f.push(Found { entry: e.clone(), memo: memo.clone(), snippet: Some(sn) });
                    }
                }
            });
        }
    });
    let mut found = found.into_inner().unwrap_or_default();
    // 스레드가 끝난 순서는 매번 다르다 — 결과 순서가 흔들리지 않게 경로로 늘어놓는다.
    found.sort_by(|a, b| a.entry.path.cmp(&b.entry.path));
    found.truncate(limit.saturating_sub(have));
    out.items.extend(found);
    // 다 읽었으면 마지막에 본 스레드가 「개수 상한」을 잘못 알렸을 수 있다 — 남은 파일이 없으면 자른 것이 아니다.
    out.truncated = truncated.load(Ordering::Relaxed) && next.load(Ordering::Relaxed) < slow.len();
    out.cancelled = cancelled.load(Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_by_all_terms_and_memo() {
        let d = std::env::temp_dir().join(format!("fd-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("가/나")).unwrap();
        std::fs::create_dir_all(d.join("node_modules")).unwrap();
        for f in ["가/보고서_v1.pptx", "가/나/보고서_최종.hwpx", "가/회의록.txt", "node_modules/보고서.js"] {
            std::fs::write(d.join(f), "").unwrap();
        }
        let mut memos = HashMap::new();
        memos.insert(crate::memo::key(&d.join("가/회의록.txt").to_string_lossy()), "보고서 근거 회의".to_string());
        let r = find(&d, "보고서", false, &memos, false, 100, Duration::from_secs(5), None);
        let mut names: Vec<&str> = r.items.iter().map(|f| f.entry.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["보고서_v1.pptx", "보고서_최종.hwpx", "회의록.txt"]); // node_modules 는 건너뛴다
        let r = find(&d, "보고서 최종", false, &memos, false, 100, Duration::from_secs(5), None);
        assert_eq!(r.items.len(), 1);
        let r = find(&d, "보고서", false, &memos, false, 1, Duration::from_secs(5), None);
        assert!(r.truncated);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn finds_by_content_with_snippet() {
        let d = std::env::temp_dir().join(format!("fd-search-content-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("가")).unwrap();
        crate::text::tests::write_zip(&d.join("가/보고.docx"), &[("word/document.xml", "<w:body><w:p><w:r><w:t>이 사업은 산림</w:t></w:r><w:r><w:t>재난 예방을 다룬다</w:t></w:r></w:p></w:body>")]);
        crate::text::tests::write_zip(&d.join("계획.hwpx"), &[("Contents/section0.xml", "<hp:p><hp:run><hp:t>산림재난 대응 계획</hp:t></hp:run></hp:p>")]);
        let (cp949, _, _) = encoding_rs::EUC_KR.encode("회의 메모: 산림재난 대책");
        std::fs::write(d.join("가/회의.txt"), &cp949).unwrap();
        std::fs::write(d.join("다른.txt"), "관계없는 글").unwrap();
        std::fs::write(d.join("가/깨진.pdf"), "산림재난 — pdf 가 아니다").unwrap(); // 뒤로 미룬 pdf 차례를 지나되 걸리지 않는다
        std::fs::write(d.join("산림재난_목록.csv"), "이름에서 맞는다").unwrap();
        let memos = HashMap::new();
        // 끄면 이름에서만
        let r = find(&d, "산림재난", false, &memos, false, 100, Duration::from_secs(5), None);
        assert_eq!(r.items.len(), 1);
        let r = find(&d, "산림재난", false, &memos, true, 100, Duration::from_secs(5), None);
        let mut got: Vec<(&str, Option<&str>)> = r.items.iter().map(|f| (f.entry.name.as_str(), f.snippet.as_deref())).collect();
        got.sort();
        assert_eq!(got, [("계획.hwpx", Some("산림재난 대응 계획")), ("보고.docx", Some("이 사업은 산림재난 예방을 다룬다")), ("산림재난_목록.csv", None), ("회의.txt", Some("회의 메모: 산림재난 대책"))]);
        // 말이 다 들어 있어야 한다
        let r = find(&d, "산림재난 대응", false, &memos, true, 100, Duration::from_secs(5), None);
        assert_eq!(r.items.len(), 1);
        // 두 번째는 캐시에서 — 결과가 같다
        let r = find(&d, "산림재난 대응", false, &memos, true, 100, Duration::from_secs(5), None);
        assert_eq!(r.items[0].entry.name, "계획.hwpx");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn query_by_conditions_and_shallow_roots() {
        let d = std::env::temp_dir().join(format!("fd-search-query-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("가")).unwrap();
        std::fs::write(d.join("위.pdf"), "x").unwrap();
        std::fs::write(d.join("위.txt"), "x").unwrap();
        std::fs::write(d.join("가/아래.pdf"), "x").unwrap();
        let clock = crate::query::Clock::now(540);
        let spec = crate::query::parse("확장자:pdf 고친:1일", clock);
        let none = HashMap::new();
        let names = |roots: &[Root]| {
            let mut v: Vec<String> = query(roots, &spec, false, &none, &none, false, 100, Duration::from_secs(5), None).items.into_iter().map(|f| f.entry.name).collect();
            v.sort();
            v
        };
        let root = d.to_string_lossy().into_owned();
        // 찾는 말 없이 조건만으로도 찾는다
        assert_eq!(names(&[Root { path: root.clone(), recursive: true }]), ["아래.pdf", "위.pdf"]);
        // 하위 폴더를 안 보는 뿌리
        assert_eq!(names(&[Root { path: root.clone(), recursive: false }]), ["위.pdf"]);
        // 색 조건은 색 표시가 있는 것만
        let mut colors = HashMap::new();
        colors.insert(crate::memo::key(&d.join("위.pdf").to_string_lossy()), "red".to_string());
        let red = crate::query::parse("색:빨강", clock);
        let r = query(&[Root { path: root, recursive: true }], &red, false, &none, &colors, false, 100, Duration::from_secs(5), None);
        assert_eq!(r.items.len(), 1);
        let _ = std::fs::remove_dir_all(&d);
    }
}
