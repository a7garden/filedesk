//! 색인 서비스(`fd-indexd`)와 이름 파이프로 주고받는 규약.
//!
//! 연결 하나에 물음 하나 · 답 하나. 틀마다 길이(u32, 작은 끝) + JSON.
//! 판 번호(`VERSION`)를 `Hello` 로 주고받는다. 앱과 서비스의 판이 한 칸 달라도 서로 읽도록, 칸을 더할 때는 `#[serde(default)]` 를 단다.

use std::io::{self, Read, Write};

use fd_core::list::Entry;
use fd_core::query::QuerySpec;
use fd_core::search::Root;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub const PIPE: &str = r"\\.\pipe\filedesk-index";
pub const SERVICE_NAME: &str = "filedesk-index";
/// 규약 판. 칸을 빼거나 뜻을 바꾸면 올린다.
pub const VERSION: u32 = 1;
/// 틀 하나의 상한 — 고장 난 길이로 메모리를 다 쓰지 않게.
const MAX_FRAME: usize = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Request {
    Hello { version: u32 },
    /// `roots` 가 없으면 모든 볼륨.
    Query { spec: QuerySpec, roots: Option<Vec<Root>>, all: bool, limit: usize },
    Status,
    Rebuild,
    /// 결과에서 뺄 폴더를 통째로 바꾼다.
    Exclude { paths: Vec<String> },
    /// `since` 뒤로 바뀐 파일 (본문 색인이 따라간다).
    Changes { since: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Response {
    Hello { version: u32, server: String },
    Query(QueryOut),
    Status(IndexStatus),
    Changes(Changes),
    Ok,
    Error { message: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueryOut {
    pub items: Vec<Entry>,
    pub truncated: bool,
    /// 색인에 없는 뿌리 — 부르는 쪽이 그 자리에서 훑는다.
    pub unresolved: Vec<Root>,
    /// 결과를 낸 볼륨 중 가장 오래 전에 맞춘 때.
    pub indexed_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VolStatus {
    pub root: String,
    /// `ntfs` · `walk`
    pub method: String,
    pub files: u64,
    pub updated: i64,
    /// `ready` · `building` · `error`
    pub state: String,
    /// USN 저널로 따라가는 중인가 (NTFS).
    pub usn: bool,
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IndexStatus {
    /// 관리자 서비스가 답했는가 (아니면 앱 안 엔진).
    pub service: bool,
    pub service_version: u32,
    pub volumes: Vec<VolStatus>,
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Changes {
    /// 다음 물음에 줄 번호.
    pub seq: u64,
    /// 바뀐 파일 경로 (지워졌으면 그 경로 그대로 — 받는 쪽이 있는지 본다).
    pub paths: Vec<String>,
    /// 기록이 넘쳐 앞부분을 잃었다 — 받는 쪽이 처음부터 다시 맞춘다.
    pub reset: bool,
}

pub fn write_frame(w: &mut impl Write, v: &impl Serialize) -> io::Result<()> {
    let b = serde_json::to_vec(v).map_err(io::Error::other)?;
    w.write_all(&(b.len() as u32).to_le_bytes())?;
    w.write_all(&b)?;
    w.flush()
}

pub fn read_frame<T: DeserializeOwned>(r: &mut impl Read) -> io::Result<T> {
    let mut n = [0u8; 4];
    r.read_exact(&mut n)?;
    let n = u32::from_le_bytes(n) as usize;
    if n > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "틀이 너무 크다"));
    }
    let mut b = vec![0u8; n];
    r.read_exact(&mut b)?;
    serde_json::from_slice(&b).map_err(io::Error::other)
}

/// 틀 하나를 바이트로 (비동기 서버가 한 번에 쓴다).
pub fn encode(v: &impl Serialize) -> io::Result<Vec<u8>> {
    let b = serde_json::to_vec(v).map_err(io::Error::other)?;
    let mut out = Vec::with_capacity(b.len() + 4);
    out.extend_from_slice(&(b.len() as u32).to_le_bytes());
    out.extend_from_slice(&b);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let req = Request::Query { spec: QuerySpec::terms_only("보고"), roots: Some(vec![Root { path: r"C:\가".into(), recursive: false }]), all: false, limit: 10 };
        let mut buf = Vec::new();
        write_frame(&mut buf, &req).unwrap();
        assert_eq!(buf, encode(&req).unwrap());
        let back: Request = read_frame(&mut buf.as_slice()).unwrap();
        match back {
            Request::Query { spec, roots, limit, .. } => {
                assert_eq!(spec.terms, ["보고"]);
                assert_eq!(roots.unwrap()[0].recursive, false);
                assert_eq!(limit, 10);
            }
            _ => panic!("물음 꼴이 바뀌었다"),
        }
        let resp = Response::Query(QueryOut { truncated: true, ..Default::default() });
        let mut buf = Vec::new();
        write_frame(&mut buf, &resp).unwrap();
        assert!(matches!(read_frame::<Response>(&mut buf.as_slice()).unwrap(), Response::Query(QueryOut { truncated: true, .. })));
    }
}
