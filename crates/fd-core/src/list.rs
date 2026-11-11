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
    let attrs = file_attrs(&meta);
    // 정션 · 심볼릭 링크 폴더는 is_dir() 이 거짓이라 특성 비트로 본다.
    let is_dir = meta.is_dir() || attrs & ATTR_DIRECTORY != 0;
    let name = item.file_name().to_string_lossy().into_owned();
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
    Some(Entry {
        path: item.path().to_string_lossy().into_owned(),
        name,
        is_dir,
        size: if is_dir { 0 } else { meta.len() },
        modified,
        attrs,
        ext,
        kind: String::new(),
    })
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
}
