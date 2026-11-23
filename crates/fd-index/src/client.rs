//! 이름 파이프 손님 — 앱 · 명령줄이 색인 서비스에 묻는다. 서비스가 없으면 곧바로 Err (앱은 앱 안 엔진으로, 명령줄은 그 자리 훑기로).

use std::io;
use std::time::Duration;

use crate::proto::{PIPE, Request, Response, VERSION, read_frame, write_frame};

/// 물음 하나를 보내고 답을 받는다. 파이프가 바쁘면(모든 자리가 쓰는 중) 잠깐씩 몇 번 다시 해 본다.
pub fn call(req: &Request) -> io::Result<Response> {
    let mut last = None;
    for _ in 0..20 {
        match std::fs::OpenOptions::new().read(true).write(true).open(PIPE) {
            Ok(mut f) => {
                write_frame(&mut f, req)?;
                return read_frame(&mut f);
            }
            // 231 = ERROR_PIPE_BUSY
            Err(e) if e.raw_os_error() == Some(231) => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap_or_else(|| io::Error::other("색인 서비스가 바쁘다")))
}

/// 서비스가 답하면 그 판 번호. 없거나 판이 너무 다르면 None.
pub fn service_version() -> Option<u32> {
    match call(&Request::Hello { version: VERSION }).ok()? {
        Response::Hello { version, .. } if version.abs_diff(VERSION) <= 1 => Some(version),
        _ => None,
    }
}

/// 서비스 실행 파일의 판 (`0.1.12` 꼴). 서비스가 없으면 None.
/// 2026.11.18 : 규약 판(`VERSION`)이 같아도 서비스 파일은 옛 판일 수 있다 — 앱 업데이트는 서비스를 바꾸지 않는다.
pub fn service_build() -> Option<String> {
    match call(&Request::Hello { version: VERSION }).ok()? {
        Response::Hello { server, .. } => Some(server),
        _ => None,
    }
}

/// 답이 오류면 Err 로 바꾼다.
pub fn expect(resp: Response) -> io::Result<Response> {
    match resp {
        Response::Error { message } => Err(io::Error::other(message)),
        r => Ok(r),
    }
}
