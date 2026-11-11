//! 메모 — 사용자가 파일 · 폴더에 붙인 글. filedesk 가 따로 관리한다 (`%APPDATA%\kr.seesun.filedesk\memos.json`).
//!
//! 파일 안이나 옆(대체 데이터 스트림 · desktop.ini · 옆 파일)에 쓰지 않는다 — 정본 영역은 읽기만 하고,
//! 옆에 쓰면 NAS 미러 · 메일 첨부로 메모가 함께 나가 버린다.
//!
//! 열쇠는 경로다. 앱 밖(탐색기 · 다른 프로그램)에서 옮기거나 이름을 바꾸면 경로가 끊기므로 NTFS 파일 ID 를 같이 둔다.
//! 경로가 사라진 메모(「떠돌이」)는 같은 ID 를 가진 파일이 있는 폴더를 열 때 새 경로로 다시 붙는다 (`relink`).
//! 앱 안에서 이름을 바꾸면 그 자리에서 바로 옮긴다 (`moved`).
//!
//! 앱과 명령줄(`fd memo`)이 같은 파일을 쓴다 — 오래 들고 있지 않고 매번 읽고 · 고치고 · 쓴다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memo {
    /// 마지막으로 알던 경로 (원래 대소문자 그대로).
    pub path: String,
    pub text: String,
    /// NTFS 파일 ID (`<볼륨 일련번호>-<파일 번호>`). 못 얻으면 없다 — NAS · FAT 드라이브.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// 고친 때 (유닉스 밀리초).
    pub updated: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Disk {
    memos: Vec<Memo>,
}

/// 메모 묶음. 경로를 소문자 · 역슬래시로 고른 값으로 찾는다 (Windows 경로는 대소문자를 가리지 않는다).
#[derive(Debug, Default)]
pub struct MemoStore {
    items: BTreeMap<String, Memo>,
}

pub fn key(path: &str) -> String {
    let mut s = path.replace('/', "\\");
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

fn parent_key(k: &str) -> &str {
    k.rfind('\\').map(|i| &k[..i]).unwrap_or("")
}

/// 기본 메모 파일 — 앱 설정과 같은 폴더.
pub fn default_file() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("kr.seesun.filedesk").join("memos.json"))
}

impl MemoStore {
    /// 없으면 빈 묶음. 읽을 수 없는 꼴이면 오류 — 빈 것으로 보고 덮어쓰면 메모를 다 잃는다.
    pub fn load(file: &Path) -> Result<Self, String> {
        let raw = match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(format!("{}: {e}", file.display())),
        };
        let disk: Disk = serde_json::from_str(&raw).map_err(|e| format!("메모 파일을 읽지 못했다 ({}): {e}", file.display()))?;
        Ok(Self { items: disk.memos.into_iter().map(|m| (key(&m.path), m)).collect() })
    }

    /// 임시 파일에 쓰고 바꿔 끼운다 — 쓰다 멈춰도 메모 파일이 반쯤 잘리지 않게.
    pub fn save(&self, file: &Path) -> Result<(), String> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let disk = Disk { memos: self.items.values().cloned().collect() };
        let body = serde_json::to_string_pretty(&disk).map_err(|e| e.to_string())?;
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, file).map_err(|e| e.to_string())
    }

    pub fn get(&self, path: &str) -> Option<&Memo> {
        self.items.get(&key(path))
    }

    pub fn all(&self) -> impl Iterator<Item = &Memo> {
        self.items.values()
    }

    /// `dir` 바로 아래 항목의 메모. `이전판/` 안도 함께 — 목록이 판을 펼쳐 그 파일들을 보이므로.
    pub fn in_dir(&self, dir: &str) -> Vec<&Memo> {
        let d = key(dir);
        let hist = format!("{d}\\{}", crate::docs::HISTORY_DIR);
        self.items.iter().filter(|(k, _)| parent_key(k) == d || parent_key(k) == hist).map(|(_, m)| m).collect()
    }

    /// 메모를 붙인다. 빈 글이면 뗀다. 돌려주는 값은 남은 메모.
    pub fn set(&mut self, path: &str, text: &str, id: Option<String>, now: i64) -> Option<&Memo> {
        let k = key(path);
        let text = text.trim();
        if text.is_empty() {
            self.items.remove(&k);
            return None;
        }
        self.items.insert(k.clone(), Memo { path: path.to_string(), text: text.to_string(), id, updated: now });
        self.items.get(&k)
    }

    /// `from` 이 `to` 로 옮겨졌다 (이름 바꾸기 · 옮기기). 폴더면 안에 든 메모도 함께. 옮긴 수를 돌려준다.
    pub fn moved(&mut self, from: &str, to: &str) -> usize {
        let f = key(from);
        let to = to.trim_end_matches('\\');
        let hits: Vec<String> = self.items.keys().filter(|k| **k == f || k.starts_with(&format!("{f}\\"))).cloned().collect();
        for k in &hits {
            let mut m = self.items.remove(k).expect("방금 찾은 열쇠");
            m.path = format!("{to}{}", &m.path[from.trim_end_matches('\\').len()..]);
            self.items.insert(key(&m.path), m);
        }
        hits.len()
    }

    /// 경로가 사라진 메모 중 ID 가 있는 것.
    pub fn strays(&self) -> Vec<&Memo> {
        self.items.values().filter(|m| m.id.is_some() && !Path::new(&m.path).exists()).collect()
    }

    /// 떠돌이 메모를 `found`(경로, ID) 와 맞춰 새 경로로 붙인다. 붙인 수를 돌려준다.
    pub fn relink(&mut self, found: &[(String, String)]) -> usize {
        let strays: Vec<(String, String)> =
            self.strays().into_iter().filter_map(|m| Some((key(&m.path), m.id.clone()?))).collect();
        let mut n = 0;
        for (k, id) in strays {
            if let Some((path, _)) = found.iter().find(|(_, fid)| *fid == id) {
                if self.items.contains_key(&key(path)) {
                    continue; // 새 자리에 이미 메모가 있으면 덮지 않는다
                }
                let old = self.items[&k].path.clone();
                n += self.moved(&old, path).min(1);
            }
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_clear() {
        let mut s = MemoStore::default();
        s.set(r"D:\문서\보고서.pptx", "  발주처 검토 중 ", None, 1);
        assert_eq!(s.get(r"d:\문서\보고서.PPTX").unwrap().text, "발주처 검토 중");
        assert!(s.set(r"D:\문서\보고서.pptx", "", None, 2).is_none());
        assert!(s.get(r"D:\문서\보고서.pptx").is_none());
    }

    #[test]
    fn in_dir_includes_history() {
        let mut s = MemoStore::default();
        s.set(r"D:\a\x.txt", "1", None, 1);
        s.set(r"D:\a\이전판\x_v1.txt", "2", None, 1);
        s.set(r"D:\a\b\y.txt", "3", None, 1);
        let mut t: Vec<_> = s.in_dir(r"D:\a\").iter().map(|m| m.text.clone()).collect();
        t.sort();
        assert_eq!(t, ["1", "2"]);
    }

    #[test]
    fn folder_rename_carries_children() {
        let mut s = MemoStore::default();
        s.set(r"D:\a\옛이름", "폴더", None, 1);
        s.set(r"D:\a\옛이름\x.txt", "안", None, 1);
        s.set(r"D:\a\옛이름2", "남", None, 1);
        assert_eq!(s.moved(r"D:\a\옛이름", r"D:\a\새이름"), 2);
        assert_eq!(s.get(r"D:\a\새이름\x.txt").unwrap().path, r"D:\a\새이름\x.txt");
        assert!(s.get(r"D:\a\옛이름2").is_some(), "이름이 앞부분만 같은 폴더는 그대로");
    }

    #[test]
    fn relink_by_id_and_round_trip() {
        let dir = std::env::temp_dir().join(format!("fd-memo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("memos.json");
        let mut s = MemoStore::default();
        s.set(r"Z:\없는\옛자리.txt", "따라온다", Some("1-42".into()), 1);
        s.save(&file).unwrap();
        let mut s = MemoStore::load(&file).unwrap();
        assert_eq!(s.strays().len(), 1);
        assert_eq!(s.relink(&[(r"D:\새자리.txt".into(), "1-42".into())]), 1);
        assert_eq!(s.get(r"D:\새자리.txt").unwrap().text, "따라온다");
        std::fs::remove_dir_all(&dir).ok();
    }
}
