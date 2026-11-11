//! filedesk 핵심. 운영체제 셸에 기대지 않는 것만 둔다 (셸 연동은 `fd-shell`).
//! 화면과 CLI 가 같은 함수를 부른다 — 사람이 보는 것과 에이전트가 보는 것이 갈리지 않게.

pub mod docname;
pub mod docs;
pub mod edition;
pub mod list;
pub mod memo;
pub mod project;
pub mod search;
pub mod skill;
pub mod tidy;

pub use docname::{DocName, NameRules};
pub use docs::{DocFile, DocGroup, group_dir};
pub use list::{Entry, list_dir};
