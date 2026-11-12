//! 볼륨 하나의 표.
//!
//! 항목마다 열쇠가 있다 — NTFS 는 MFT 레코드 번호(FRN 의 아래 48비트), 훑어 채운 볼륨은 1 부터 매긴 번호.
//! 경로는 들고 있지 않고 상위 열쇠 사슬로 그때 만든다 — 폴더 이름이 바뀌어도 그 한 줄만 고치면 된다.
//! 2026.11.12 : 처음 씀. 100만 항목에 메모리 100MB 남짓을 쓴다 (이름 둘 · 숫자 여섯).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// 표를 채운 방법.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    /// MFT 를 읽고 USN 저널로 따라간다 (관리자 서비스).
    Ntfs,
    /// 폴더를 훑고 폴더 감시로 따라간다.
    Walk,
}

#[derive(Debug, Clone)]
pub struct Node {
    pub key: u64,
    pub parent: u64,
    pub name: Box<str>,
    /// 소문자 이름 — 찾을 때 견준다.
    pub lower: Box<str>,
    pub size: u64,
    pub modified: i64,
    pub created: i64,
    pub attrs: u32,
    pub is_dir: bool,
}

impl Node {
    pub fn new(key: u64, parent: u64, name: &str, size: u64, modified: i64, created: i64, attrs: u32, is_dir: bool) -> Self {
        Node { key, parent, name: name.into(), lower: name.to_lowercase().into(), size, modified, created, attrs, is_dir }
    }

    /// 소문자 확장자 — `fd_core::list` 와 같게 (폴더 · 점으로 시작하는 이름은 없음).
    pub fn ext(&self) -> &str {
        if self.is_dir {
            return "";
        }
        match self.lower.rfind('.') {
            Some(i) if i > 0 => &self.lower[i + 1..],
            _ => "",
        }
    }
}

/// 사슬을 따라 올라갈 깊이 상한 — 고장 난 표에서 끝없이 돌지 않게.
const MAX_DEPTH: usize = 512;

#[derive(Debug, Clone)]
pub struct Volume {
    /// `C:\` 꼴.
    pub root: String,
    /// 뿌리 폴더의 열쇠 (NTFS 5 · 훑기 0).
    pub root_key: u64,
    pub method: Method,
    /// USN 저널 ID · 다음에 읽을 USN (NTFS). 훑기는 0.
    pub journal_id: u64,
    pub next_usn: i64,
    /// 마지막으로 다 맞춘 때 (유닉스 밀리초).
    pub updated: i64,
    /// 훑기 볼륨이 다음에 줄 열쇠.
    pub next_key: u64,
    slots: Vec<Option<Node>>,
    free: Vec<u32>,
    by_key: HashMap<u64, u32>,
    /// (상위 열쇠, 소문자 이름) → 열쇠. 훑기 볼륨만 — 폴더 감시는 경로로 알려 와서 경로에서 열쇠를 찾아야 한다.
    by_name: Option<HashMap<(u64, Box<str>), u64>>,
}

impl Volume {
    pub fn new(root: &str, method: Method) -> Self {
        let mut root = root.replace('/', "\\");
        if !root.ends_with('\\') {
            root.push('\\');
        }
        let root_key = if method == Method::Ntfs { 5 } else { 0 };
        Volume {
            root,
            root_key,
            method,
            journal_id: 0,
            next_usn: 0,
            updated: 0,
            next_key: 1,
            slots: Vec::new(),
            free: Vec::new(),
            by_key: HashMap::new(),
            by_name: if method == Method::Walk { Some(HashMap::new()) } else { None },
        }
    }

    pub fn len(&self) -> usize {
        self.by_key.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_key.is_empty()
    }

    /// 모든 칸 (빈 칸은 None) — 찾기가 나눠 본다.
    pub fn slots(&self) -> &[Option<Node>] {
        &self.slots
    }

    pub fn get(&self, key: u64) -> Option<&Node> {
        self.by_key.get(&key).and_then(|&i| self.slots[i as usize].as_ref())
    }

    /// 넣거나 바꾼다 (같은 열쇠가 있으면 바꾼다).
    pub fn upsert(&mut self, node: Node) {
        if let Some(names) = &mut self.by_name {
            if let Some(old) = self.by_key.get(&node.key).and_then(|&i| self.slots[i as usize].as_ref()) {
                names.remove(&(old.parent, old.lower.clone()));
            }
            names.insert((node.parent, node.lower.clone()), node.key);
        }
        if let Some(&i) = self.by_key.get(&node.key) {
            self.slots[i as usize] = Some(node);
            return;
        }
        let key = node.key;
        let i = match self.free.pop() {
            Some(i) => {
                self.slots[i as usize] = Some(node);
                i
            }
            None => {
                self.slots.push(Some(node));
                (self.slots.len() - 1) as u32
            }
        };
        self.by_key.insert(key, i);
    }

    /// 항목 하나를 뺀다 (그 아래는 그대로 — NTFS 는 지운 하위 항목마다 따로 알려 온다).
    pub fn remove(&mut self, key: u64) -> Option<Node> {
        let i = self.by_key.remove(&key)?;
        let node = self.slots[i as usize].take()?;
        self.free.push(i);
        if let Some(names) = &mut self.by_name {
            names.remove(&(node.parent, node.lower.clone()));
        }
        Some(node)
    }

    /// 항목과 그 아래를 모두 뺀다 (훑기 볼륨 — 폴더 감시는 지운 폴더 하나만 알려 온다).
    pub fn remove_tree(&mut self, key: u64) -> usize {
        let doomed: Vec<u64> = self.slots.iter().flatten().filter(|n| n.key == key || self.descends_from(n, key)).map(|n| n.key).collect();
        let n = doomed.len();
        for k in doomed {
            self.remove(k);
        }
        n
    }

    /// `n` 이 `ancestor` 아래에 있는가 (자기 자신은 아니다).
    pub fn descends_from(&self, n: &Node, ancestor: u64) -> bool {
        let mut cur = n.parent;
        for _ in 0..MAX_DEPTH {
            if cur == ancestor {
                return true;
            }
            if cur == self.root_key {
                return false;
            }
            match self.get(cur) {
                Some(p) if p.key != p.parent => cur = p.parent,
                _ => return false,
            }
        }
        false
    }

    /// 경로를 만든다. 사슬이 끊겼으면(상위가 아직 없다 · 고장) None.
    pub fn path_of(&self, n: &Node) -> Option<String> {
        if n.key == self.root_key {
            return Some(self.root.clone());
        }
        let mut parts: Vec<&str> = vec![&n.name];
        let mut cur = n.parent;
        for _ in 0..MAX_DEPTH {
            if cur == self.root_key {
                parts.reverse();
                return Some(format!("{}{}", self.root, parts.join("\\")));
            }
            let p = self.get(cur)?;
            if p.key == p.parent {
                return None;
            }
            parts.push(&p.name);
            cur = p.parent;
        }
        None
    }

    /// 경로 → 열쇠. 뿌리면 뿌리 열쇠. 이 볼륨 밖이거나 표에 없으면 None.
    /// 훑기 볼륨은 이름 표로 바로, NTFS 볼륨은 칸을 훑는다 (찾기 뿌리를 풀 때만 쓰니 드물다).
    pub fn find_path(&self, path: &str) -> Option<u64> {
        let p = crate::norm(path);
        let root = crate::norm(&self.root);
        if !crate::is_under(&p, &root) {
            return None;
        }
        let rest = p[root.len()..].trim_start_matches('\\');
        let mut cur = self.root_key;
        for comp in rest.split('\\').filter(|c| !c.is_empty()) {
            cur = match &self.by_name {
                Some(names) => *names.get(&(cur, Box::<str>::from(comp)))?,
                None => self.slots.iter().flatten().find(|n| n.parent == cur && &*n.lower == comp && n.key != cur)?.key,
            };
        }
        Some(cur)
    }

    /// 훑기 볼륨의 새 열쇠.
    pub fn fresh_key(&mut self) -> u64 {
        let k = self.next_key;
        self.next_key += 1;
        k
    }

    /// 다른 볼륨의 칸을 통째로 받는다 (다시 훑은 결과로 갈아 끼울 때).
    pub fn replace_with(&mut self, other: Volume) {
        *self = other;
    }

    /// 칸을 차례로 (스냅숏 쓰기).
    pub fn iter(&self) -> impl Iterator<Item = &Node> {
        self.slots.iter().flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn walk_vol() -> Volume {
        let mut v = Volume::new("C:\\", Method::Walk);
        v.upsert(Node::new(1, 0, "문서", 0, 1, 1, 0x10, true));
        v.upsert(Node::new(2, 1, "보고.PDF", 10, 1, 1, 0, false));
        v.upsert(Node::new(3, 1, "가", 0, 1, 1, 0x10, true));
        v.upsert(Node::new(4, 3, "회의.txt", 5, 1, 1, 0, false));
        v
    }

    #[test]
    fn paths_and_lookup() {
        let v = walk_vol();
        assert_eq!(v.path_of(v.get(4).unwrap()).as_deref(), Some(r"C:\문서\가\회의.txt"));
        assert_eq!(v.find_path(r"c:\문서\가"), Some(3));
        assert_eq!(v.find_path(r"C:\"), Some(0));
        assert_eq!(v.find_path(r"D:\문서"), None);
        assert_eq!(v.get(2).unwrap().ext(), "pdf");
        assert!(v.descends_from(v.get(4).unwrap(), 1));
        assert!(!v.descends_from(v.get(2).unwrap(), 3));
    }

    #[test]
    fn rename_and_remove_tree() {
        let mut v = walk_vol();
        v.upsert(Node::new(3, 1, "나", 0, 1, 1, 0x10, true));
        assert_eq!(v.find_path(r"C:\문서\가"), None);
        assert_eq!(v.find_path(r"C:\문서\나"), Some(3));
        assert_eq!(v.remove_tree(3), 2);
        assert_eq!(v.len(), 2);
        // 빈 칸을 다시 쓴다
        v.upsert(Node::new(9, 1, "새.txt", 1, 1, 1, 0, false));
        assert_eq!(v.slots().len(), 4);
    }

    #[test]
    fn ntfs_lookup_scans() {
        let mut v = Volume::new("D:", Method::Ntfs);
        v.upsert(Node::new(5, 5, ".", 0, 1, 1, 0x10, true));
        v.upsert(Node::new(40, 5, "Work", 0, 1, 1, 0x10, true));
        assert_eq!(v.find_path(r"d:\work"), Some(40));
        assert_eq!(v.path_of(v.get(40).unwrap()).as_deref(), Some(r"D:\Work"));
    }
}
