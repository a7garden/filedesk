//! 표에서 조건으로 찾기.
//!
//! 1. 칸을 rayon 으로 나눠 보며 이름 · 크기 · 때 · 확장자 · 뿌리 조건만 본다 (경로를 만들지 않으니 100만 칸도 몇십 ms).
//! 2. 맞은 칸을 최근 것부터 늘어놓는다 — 조건이 느슨해 넘쳐도 가장 쓸모 있는 쪽이 남게.
//! 3. 앞에서부터 묶음으로 경로를 만들어 뺄 자리를 거르고, `limit` 을 넘기면 멈춘다.
//!
//! 2026.11.12 : 2 와 3 의 차례를 바꿨다. 맞은 칸 모두의 경로를 만든 뒤 자르던 때는 `e` 처럼 수십만 칸이 맞는 말이
//! 750ms 걸렸다 (경로 만들기가 거의 전부). 지금은 남길 만큼만 만들어 50ms.
//!
//! 메모 · 색 표시 조건은 여기서 보지 않는다 (색인은 메모를 모른다). 부르는 쪽이 메모 파일로 거른다.

use fd_core::list::{ATTR_HIDDEN, ATTR_SYSTEM, Entry};
use fd_core::query::QuerySpec;
use fd_core::search::Root;
use rayon::prelude::*;

use crate::proto::QueryOut;
use crate::scope::Scope;
use crate::table::{Node, Volume};
use crate::{is_under, norm};

/// 볼륨들에서 찾는다. `roots` 가 None 이면 모든 볼륨 전체.
/// 어느 볼륨에도 없는 뿌리는 `unresolved` 로 돌려준다 (부르는 쪽이 그 자리에서 훑는다).
pub fn search(vols: &[&Volume], spec: &QuerySpec, roots: Option<&[Root]>, all: bool, limit: usize, scope: &Scope) -> QueryOut {
    let mut out = QueryOut::default();
    // (때, 볼륨 차례, 칸)
    let mut cands: Vec<(i64, usize, &Node)> = Vec::new();
    let mut oldest = i64::MAX;
    let mut used = vec![false; roots.map_or(0, |r| r.len())];
    for (vi, v) in vols.iter().enumerate() {
        // 이 볼륨에 든 뿌리 → (열쇠, 하위까지)
        let keys: Option<Vec<(u64, bool)>> = roots.map(|rs| {
            rs.iter()
                .enumerate()
                .filter_map(|(i, r)| {
                    let k = v.find_path(&r.path)?;
                    used[i] = true;
                    Some((k, r.recursive))
                })
                .collect()
        });
        if keys.as_ref().is_some_and(|k| k.is_empty()) {
            continue;
        }
        oldest = oldest.min(v.updated);
        let mut part: Vec<(i64, usize, &Node)> = v
            .slots()
            .par_iter()
            .filter_map(|s| s.as_ref())
            .filter(|n| n.key != v.root_key && meta_hit(n, spec, all))
            .filter(|n| match &keys {
                None => true,
                Some(ks) => ks.iter().any(|&(k, deep)| if deep { v.descends_from(n, k) } else { n.parent == k }),
            })
            .map(|n| (n.modified.max(n.created), vi, n))
            .collect();
        cands.append(&mut part);
    }
    if let Some(rs) = roots {
        out.unresolved = rs.iter().zip(&used).filter(|(_, u)| !**u).map(|(r, _)| r.clone()).collect();
    }
    cands.par_sort_unstable_by(|a, b| b.0.cmp(&a.0));
    // 뺄 자리(node_modules · 다른 계정)가 얼마나 섞였는지 모르니 묶음으로 나눠 만든다 — 한 묶음은 넉넉히 limit 만큼
    let chunk = limit.clamp(256, 8192);
    let mut items: Vec<Entry> = Vec::with_capacity(limit.min(cands.len()) + 1);
    for part in cands.chunks(chunk) {
        let mut built: Vec<Entry> = part
            .par_iter()
            .filter_map(|&(_, vi, n)| {
                let path = vols[vi].path_of(n)?;
                if scope.hidden(&norm(&path)) {
                    return None;
                }
                Some(entry_of(n, path))
            })
            .collect();
        items.append(&mut built);
        if items.len() > limit {
            break;
        }
    }
    if items.len() > limit {
        items.truncate(limit);
        out.truncated = true;
    }
    out.items = items;
    out.indexed_at = if oldest == i64::MAX { 0 } else { oldest };
    out
}

/// 경로를 만들지 않고 볼 수 있는 조건 — 숨김 · 이름 · 빼는 말 · 크기 · 때 · 확장자 · 종류.
fn meta_hit(n: &Node, spec: &QuerySpec, all: bool) -> bool {
    if !all && n.attrs & (ATTR_HIDDEN | ATTR_SYSTEM) != 0 {
        return false;
    }
    let lower = n.lower();
    spec.terms_in(lower) && !spec.excluded_by(lower) && spec.meta_ok(n.is_dir, n.ext(), n.size, n.modified, n.created)
}

pub fn entry_of(n: &Node, path: String) -> Entry {
    Entry {
        name: n.name.to_string(),
        path,
        is_dir: n.is_dir,
        size: if n.is_dir { 0 } else { n.size },
        modified: n.modified,
        created: n.created,
        attrs: n.attrs,
        ext: n.ext().to_string(),
        kind: String::new(),
    }
}

/// 뿌리가 이 볼륨들 중 하나에 드는가 (색인으로 찾을 수 있는가).
pub fn covers(vols: &[&Volume], path: &str) -> bool {
    let p = norm(path);
    vols.iter().any(|v| is_under(&p, &norm(&v.root)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::table::Method;

    fn vol() -> Volume {
        let mut v = Volume::new("C:\\", Method::Walk);
        v.upsert(Node::new(1, 0, "문서", 0, 100, 100, 0x10, true));
        v.upsert(Node::new(2, 1, "결과보고.pdf", 10, 300, 0, 0, false));
        v.upsert(Node::new(3, 1, "가", 0, 100, 100, 0x10, true));
        v.upsert(Node::new(4, 3, "결과보고_초안.pdf", 5, 200, 0, 0, false));
        v.upsert(Node::new(5, 0, "node_modules", 0, 100, 100, 0x10, true));
        v.upsert(Node::new(6, 5, "결과보고.pdf", 5, 400, 0, 0, false));
        v.upsert(Node::new(7, 1, "숨김보고.pdf", 5, 500, 0, 0x2, false));
        v
    }

    fn names(o: &QueryOut) -> Vec<&str> {
        o.items.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn finds_with_roots_scope_and_order() {
        let v = vol();
        let scope = Scope::default();
        let spec = fd_core::query::QuerySpec::terms_only("보고");
        // 모든 볼륨 — node_modules · 숨김은 빠지고, 최근 것부터
        let all = search(&[&v], &spec, None, false, 100, &scope);
        assert_eq!(names(&all), ["결과보고.pdf", "결과보고_초안.pdf"]);
        // 하위 폴더를 안 보는 뿌리
        let shallow = search(&[&v], &spec, Some(&[Root { path: r"C:\문서".into(), recursive: false }]), false, 100, &scope);
        assert_eq!(names(&shallow), ["결과보고.pdf"]);
        // 색인에 없는 뿌리
        let miss = search(&[&v], &spec, Some(&[Root { path: r"\\nas\공유".into(), recursive: true }]), false, 100, &scope);
        assert!(miss.items.is_empty());
        assert_eq!(miss.unresolved.len(), 1);
        // 자르기
        let one = search(&[&v], &spec, None, true, 1, &scope);
        assert!(one.truncated);
        assert_eq!(names(&one), ["숨김보고.pdf"]);
        // 빼는 말
        let not = fd_core::query::parse("보고 -초안", fd_core::query::Clock::now(540));
        assert_eq!(names(&search(&[&v], &not, None, false, 100, &scope)), ["결과보고.pdf"]);
    }
}
