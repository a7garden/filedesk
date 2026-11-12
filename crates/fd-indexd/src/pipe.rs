//! 이름 파이프 서버 — 설치한 사용자와 관리자만 연다 (SDDL 로 건 ACL).
//!
//! 연결 하나에 물음 하나 · 답 하나 (`fd_index::proto`). 답을 쓴 뒤 손님이 다 읽고 닫을 때까지 기다렸다 끊는다 —
//! 바로 끊으면(DisconnectNamedPipe) 아직 안 읽은 답이 버려진다.

use std::ffi::c_void;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use fd_index::proto::{PIPE, Request, Response, encode};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
use windows::core::HSTRING;

use crate::state::{State, log};

/// 물음 틀의 상한.
const MAX_REQUEST: usize = 1 << 20;

/// 파이프에 걸 보안 특성. SYSTEM · Administrators 는 모두, 설치한 사용자는 읽기 · 쓰기. 다른 사용자는 열지 못한다.
/// 서비스가 사는 동안 쓰므로 놓아 주지 않는다 (한 번만 만든다).
fn security(sid: &str) -> io::Result<usize> {
    let user = if sid.starts_with("S-1-") && sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { format!("(A;;GRGW;;;{sid})") } else { String::new() };
    let sddl = format!("D:P(A;;GA;;;SY)(A;;GA;;;BA){user}");
    let mut sd = PSECURITY_DESCRIPTOR(std::ptr::null_mut());
    let made = unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(&HSTRING::from(sddl), 1, &mut sd, None) };
    made.map_err(|e| io::Error::other(e.message()))?;
    let sa = Box::new(SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: sd.0, ..Default::default() });
    Ok(Box::into_raw(sa) as usize)
}

pub async fn serve(state: Arc<State>) {
    let sa = match security(&state.sid()) {
        Ok(p) => p,
        Err(e) => {
            log(&format!("파이프 보안을 만들지 못했다: {e}"));
            return;
        }
    };
    let mut first = true;
    while !state.stopping() {
        let made = unsafe { ServerOptions::new().first_pipe_instance(first).create_with_security_attributes_raw(PIPE, sa as *mut c_void) };
        let server = match made {
            Ok(s) => s,
            Err(e) => {
                log(&format!("파이프를 만들지 못했다: {e}"));
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        first = false;
        if server.connect().await.is_err() {
            continue;
        }
        let st = state.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(server, st).await {
                log(&format!("물음을 처리하지 못했다: {e}"));
            }
        });
    }
}

async fn handle(mut s: NamedPipeServer, st: Arc<State>) -> io::Result<()> {
    let mut len = [0u8; 4];
    s.read_exact(&mut len).await?;
    let n = u32::from_le_bytes(len) as usize;
    if n > MAX_REQUEST {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "물음이 너무 크다"));
    }
    let mut body = vec![0u8; n];
    s.read_exact(&mut body).await?;
    let resp = match serde_json::from_slice::<Request>(&body) {
        Ok(req) => tokio::task::spawn_blocking(move || st.answer(req)).await.unwrap_or_else(|e| Response::Error { message: e.to_string() }),
        Err(e) => Response::Error { message: format!("물음을 읽지 못했다: {e}") },
    };
    s.write_all(&encode(&resp)?).await?;
    s.flush().await?;
    // 손님이 다 읽고 닫으면 읽기가 끝난다 (0 바이트 · 끊김). 오래 붙잡지 않게 5초까지만.
    let mut one = [0u8; 1];
    let _ = tokio::time::timeout(Duration::from_secs(5), s.read(&mut one)).await;
    Ok(())
}
