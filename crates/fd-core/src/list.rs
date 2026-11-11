//! 폴더 한 칸 읽기.

use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Windows 파일 특성 비트. 숨김 · 시스템을 걸러 탐색기 기본 보기와 같게 한다.
const ATTR_HIDDEN: u32 = 0x2;
const ATTR_SYSTEM: u32 = 0x4;
const ATTR_DIRECTORY: u32 = 0x10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// 수정 시각 (유닉스 밀리초). 읽지 못하면 0.
    pub modified: i64,
    pub attrs: u32,
    /// 소문자 확장자. 폴더 · 확장자 없음은 빈 문자열.
    pub ext: String,
    /// 파일 종류 이름 (「Microsoft PowerPoint 프레젠테이션」). 셸이 채운다 — 여기서는 비워 둔다.
    pub kind: String,
}

/// `path` 바로 아래 항목을 읽는다. `show_hidden` 이 거짓이면 숨김 · 시스템 항목을 뺀다.
///
/// Windows 에서 `DirEntry::metadata` 는 FindNextFile 이 이미 준 값을 쓰므로 항목마다 추가 호출이 없다.
/// 읽다가 한 항목이 실패해도(권한 · 지워짐) 나머지는 돌려준다 — 한 파일 때문에 폴더 전체가 안 보이면 탐색기 대용이 못 된다.
pub fn list_dir(path: &Path, show_hidden: bool) -> io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for item in std::fs::read_dir(path)? {
        let Ok(item) = item else { continue };
        let Some(e) = entry_of(&item) else { continue };
        if !show_hidden && e.attrs & (ATTR_HIDDEN | ATTR_SYSTEM) != 0 {
            continue;
        }
        out.push(e);
    }
    Ok(out)
}

/// 항목 하나. 특성을 읽지 못하면(권한 · 지워짐) None. 하위 폴더까지 찾기(`search`)도 이것을 쓴다.
pub fn entry_of(item: &std::fs::DirEntry) -> Option<Entry> {
    let meta = item.metadata().ok()?;
    Some(entry_from(item.path(), item.file_name().to_string_lossy().into_owned(), &meta))
}

/// 경로 하나의 항목 — 폴더를 읽지 않고 흩어진 경로를 모아 보일 때 (색 표시 모아 보기). 없거나 못 읽으면 None.
pub fn entry_at(path: &Path) -> Option<Entry> {
    let meta = std::fs::metadata(path).ok()?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    Some(entry_from(path.to_path_buf(), name, &meta))
}

fn entry_from(path: std::path::PathBuf, name: String, meta: &std::fs::Metadata) -> Entry {
    let attrs = file_attrs(meta);
    // 정션 · 심볼릭 링크 폴더는 is_dir() 이 거짓이라 특성 비트로 본다.
    let is_dir = meta.is_dir() || attrs & ATTR_DIRECTORY != 0;
    let ext = if is_dir {
        String::new()
    } else {
        Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Entry {
        path: path.to_string_lossy().into_owned(),
        name,
        is_dir,
        size: if is_dir { 0 } else { meta.len() },
        modified,
        attrs,
        ext,
        kind: String::new(),
    }
}

#[cfg(windows)]
fn file_attrs(meta: &std::fs::Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    meta.file_attributes()
}

#[cfg(not(windows))]
fn file_attrs(_meta: &std::fs::Metadata) -> u32 {
    0
}

/// 폴더들 바로 아래에서 최근 `days` 일 안에 생기거나 바뀐 파일 — 왼쪽 「새 파일」(다운로드 · 바탕화면)의 목록. 최근 것부터.
/// 2026.11.11 : 개수만 내던 것을 목록으로 바꿨다. 숫자만으로는 무엇이 들어왔는지 몰라 결국 폴더를 열어 봐야 했다.
/// 차례는 만든 때 · 고친 때 중 늦은 쪽이다 — 복사해 온 파일은 고친 때가 옛날 그대로라 고친 때만 보면 맨 아래로 간다.
/// 숨김 · 시스템 파일과 오피스 임시(`~$…`)는 뺀다. 사람이 받은 파일이 아니다.
pub fn recent_files(dirs: &[&Path], days: u64) -> Vec<Entry> {
    let since = std::time::SystemTime::now() - std::time::Duration::from_secs(days * 86_400);
    let mut found: Vec<(std::time::SystemTime, Entry)> = Vec::new();
    for dir in dirs {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        for item in rd.flatten() {
            let n = item.file_name();
            let n = n.to_string_lossy();
            if n.starts_with('.') || n.starts_with("~$") || n.eq_ignore_ascii_case("desktop.ini") {
                continue;
            }
            let Ok(meta) = item.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let at = [meta.modified().ok(), meta.created().ok()].into_iter().flatten().max();
            let Some(at) = at.filter(|t| *t >= since) else { continue };
            let e = entry_from(item.path(), n.into_owned(), &meta);
            if e.attrs & (ATTR_HIDDEN | ATTR_SYSTEM) != 0 {
                continue;
            }
            found.push((at, e));
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, e)| e).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_files_and_dirs() {
        let dir = std::env::temp_dir().join(format!("fd-core-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("보고서_v1.2_20261111.PPTX"), b"x").unwrap();
        let mut list = list_dir(&dir, false).unwrap();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|e| e.is_dir && e.name == "sub"));
        let f = list.iter().find(|e| !e.is_dir).unwrap();
        assert_eq!(f.ext, "pptx");
        assert_eq!(f.size, 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recent_files_skips_temp_and_folders() {
        let dir = std::env::temp_dir().join(format!("fd-core-recent-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("받은.pdf"), b"x").unwrap();
        std::fs::write(dir.join("~$열린문서.docx"), b"x").unwrap();
        let got = recent_files(&[dir.as_path()], 3);
        assert_eq!(got.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["받은.pdf"]);
        assert!(recent_files(&[dir.join("없는 폴더").as_path()], 3).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
