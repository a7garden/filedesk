//! filedesk 이름 색인 — 「모든 드라이브」를 그 자리에서 훑지 않고 몇십 ms 안에 찾으려고.
//!
//! 목차
//!   table    볼륨 하나의 표 (항목 열쇠 → 이름 · 상위 · 크기 · 때 · 특성)
//!   snapshot 표를 디스크에 쓰고 읽기 — 켤 때 바로 쓰고 바뀐 것만 다시 본다
//!   query    조건(`fd_core::query::QuerySpec`)으로 표에서 찾기 (rayon 으로 나눠 본다)
//!   walk     폴더를 나눠 훑어 표 채우기 · 경로 하나 고치기 (NTFS 가 아니거나 서비스가 없을 때)
//!   watch    폴더 감시로 표 따라가기
//!   engine   앱 안 엔진 — 서비스가 없을 때 앱이 직접 색인한다
//!   proto    색인 서비스(`fd-indexd`)와 이름 파이프로 주고받는 규약
//!   client   이름 파이프 손님 쪽
//!   scope    결과 · 본문 색인에서 뺄 자리 (다른 계정 폴더 · 프로그램 폴더)
//!
//! 원칙 — 색인은 투영일 뿐이다. 지워도 다시 만들고, 파일 안이나 옆에 아무것도 쓰지 않는다.
//! 파일 내용은 읽지 않는다 (본문 색인은 사용자 권한의 `fd-content` 가 한다).

pub mod client;
pub mod engine;
pub mod proto;
pub mod query;
pub mod scope;
pub mod snapshot;
pub mod table;
pub mod walk;
pub mod watch;

pub use engine::Engine;
pub use proto::{Changes, IndexStatus, QueryOut, VolStatus};
pub use table::{Method, Node, Volume};

/// 유닉스 밀리초 — 지금.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// 경로를 견주는 꼴 — 소문자 · 역빗금 · 끝 빗금 없음 (드라이브 뿌리 `c:\` 는 그대로).
pub fn norm(p: &str) -> String {
    let mut s = p.replace('/', "\\").to_lowercase();
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s
}

/// `path` 가 `root` 이거나 그 아래인가 (둘 다 `norm` 꼴).
pub fn is_under(path: &str, root: &str) -> bool {
    if path == root {
        return true;
    }
    if root.ends_with('\\') {
        return path.starts_with(root);
    }
    path.len() > root.len() && path.starts_with(root) && path.as_bytes()[root.len()] == b'\\'
}
