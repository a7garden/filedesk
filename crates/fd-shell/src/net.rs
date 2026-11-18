//! NAS · 공유 폴더 — 주소 풀기 · 공유 목록 · 로그인 · 이 PC 가 이미 쓰는 네트워크 위치.
//!
//! 2026.11.13 : 「연결」 칸에 `192.168.0.2` 를 적으면 경로 확인(is_dir)만 해서 늘 「열 수 없다」였다.
//!              서버 이름만으로는 폴더가 아니라(공유가 폴더다) 탐색기처럼 공유 목록을 보여 고르게 하고,
//!              로그인이 필요하면 Windows 로그인 창을 띄운다 — 받은 자격 증명은 Windows 가 탐색기와 함께 쓴다.
//!
//! 목차
//!   [1] 주소 풀기 — `192.168.0.2` · `smb://` · `//` · `\\` 를 `\\서버\공유` 꼴로
//!   [2] 공유 목록 · 로그인 — WNetOpenEnum · WNetAddConnection3
//!   [3] 이 PC 가 쓰던 곳 — 연결된 · 기억된 네트워크 드라이브 · 탐색기 주소 기록 · 네트워크 위치

use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, HANDLE, HWND, NO_ERROR, WIN32_ERROR};
use windows::Win32::NetworkManagement::WNet::{
    CONNECT_INTERACTIVE, CONNECT_PROMPT, NETRESOURCEW, NET_RESOURCE_SCOPE, RESOURCE_CONNECTED, RESOURCE_GLOBALNET,
    RESOURCE_REMEMBERED, RESOURCETYPE_ANY, RESOURCETYPE_DISK, RESOURCEUSAGE_CONTAINER, RESOURCEUSAGE_NONE, WNetAddConnection3W,
    WNetCloseEnum, WNetEnumResourceW, WNetOpenEnumW,
};
use windows::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, KEY_READ, REG_VALUE_TYPE, RegCloseKey, RegEnumValueW, RegOpenKeyExW};
use windows::core::{HSTRING, PWSTR};

use crate::RawHwnd;

// ───────────────────────────── [1] 주소 풀기 ─────────────────────────────

/// 적은 주소를 `\\서버` 또는 `\\서버\공유\…` 로. 네트워크 주소로 읽을 수 없으면 그대로 (드라이브 경로 등).
/// `192.168.0.2` · `nas` · `smb://nas/공유` · `//nas/공유` · `\\nas\공유\` 가 모두 된다.
pub fn normalize(input: &str) -> String {
    let s = input.trim().trim_matches('"').trim();
    let lower = s.to_ascii_lowercase();
    let body = if lower.starts_with("smb://") || lower.starts_with("file://") {
        &s[s.find("//").unwrap_or(0) + 2..]
    } else if s.starts_with("\\\\") || s.starts_with("//") {
        &s[2..]
    } else if looks_like_host(s) {
        s
    } else {
        return s.to_string();
    };
    let parts: Vec<&str> = body.split(['\\', '/']).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return s.to_string();
    }
    format!("\\\\{}", parts.join("\\"))
}

/// 드라이브 문자 · 상대 경로가 아닌 「서버 이름만」 적은 꼴인가 — `192.168.0.2` · `nas` · `nas.local` · `nas\공유`.
fn looks_like_host(s: &str) -> bool {
    let head = s.split(['\\', '/']).next().unwrap_or("");
    !head.is_empty()
        && !head.contains(':')
        && head.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        // 「문서」 같은 한글 폴더 이름은 서버 이름이 아니다. 영숫자만 쓴 상대 경로(`backup`)는 서버로 읽는다 — 주소 칸에 상대 경로를 적을 일이 없다.
        && (head.contains('.') || head.chars().any(|c| c.is_ascii_alphabetic()))
}

/// `\\서버\공유\…` 의 서버 이름. UNC 가 아니면 None.
pub fn server_of(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("\\\\")?;
    let host = rest.split('\\').next()?;
    (!host.is_empty()).then_some(host)
}

/// 서버만 적은 주소인가 (`\\서버`). 서버는 폴더가 아니라 공유를 골라야 열린다.
pub fn is_server_only(path: &str) -> bool {
    server_of(path).is_some_and(|h| path.trim_end_matches('\\').len() == h.len() + 2)
}

// ───────────────────────────── [2] 공유 목록 · 로그인 ─────────────────────────────

/// 공유를 묻다가 막힌 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    /// 로그인이 필요하거나 거절됐다 (5 · 86 · 1326 · 1244 …).
    Denied,
    /// 서버를 찾지 못했다 · 꺼졌다 (53 · 67 · 1222 …).
    Unreachable,
    /// 사용자가 로그인 창을 닫았다 (1223).
    Cancelled,
    Other(u32),
}

impl NetError {
    fn from_code(code: u32) -> Self {
        match code {
            5 | 86 | 1219 | 1244 | 1326 | 1327 | 1328 | 1330 | 1331 | 1909 => NetError::Denied,
            53 | 64 | 67 | 1203 | 1222 | 1231 | 1311 => NetError::Unreachable,
            1223 => NetError::Cancelled,
            c => NetError::Other(c),
        }
    }

    /// 화면에 그대로 내는 문장.
    pub fn message(&self) -> String {
        match self {
            NetError::Denied => "로그인 실패 · 사용자 이름과 암호 확인".into(),
            NetError::Unreachable => "서버를 찾을 수 없음 · 주소와 네트워크 확인".into(),
            NetError::Cancelled => "로그인 취소됨".into(),
            NetError::Other(c) => format!("연결 실패 (오류 {c})"),
        }
    }
}

/// 서버의 디스크 공유 이름들 (`$` 로 끝나는 관리용 공유는 뺀다). 탐색기에서 `\\서버` 를 열었을 때 보이는 것과 같다.
pub fn shares(server: &str) -> Result<Vec<String>, NetError> {
    let remote = HSTRING::from(format!("\\\\{server}"));
    let root = NETRESOURCEW {
        dwScope: RESOURCE_GLOBALNET,
        dwType: RESOURCETYPE_DISK,
        dwUsage: RESOURCEUSAGE_CONTAINER.0,
        lpRemoteName: PWSTR(remote.as_ptr() as *mut u16),
        ..Default::default()
    };
    let mut out: Vec<String> = enumerate(RESOURCE_GLOBALNET, Some(&root))?
        .into_iter()
        .filter_map(|r| r.remote.rsplit('\\').next().map(str::to_string))
        .filter(|n| !n.is_empty() && !n.ends_with('$'))
        .collect();
    out.sort_by_key(|n| n.to_lowercase());
    out.dedup();
    Ok(out)
}

/// 로그인한다 — Windows 로그인 창(「내 자격 증명 기억」 칸 포함)을 띄운다. 이미 로그인돼 있으면 창 없이 끝난다.
/// 서버만 주면 `\\서버\IPC$` 에 붙는다 — 공유 하나가 아니라 서버 단위로 로그인해야 공유 목록도 볼 수 있다.
/// 공유를 주면 그 공유에 붙는다 — 공유마다 권한이 다른 NAS 를 위해. 받은 자격 증명은 탐색기와 함께 쓴다.
pub fn login(owner: RawHwnd, unc: &str) -> Result<(), NetError> {
    let unc = unc.trim_end_matches('\\');
    let (target, kind) = if is_server_only(unc) { (format!("{unc}\\IPC$"), RESOURCETYPE_ANY) } else { (unc.to_string(), RESOURCETYPE_DISK) };
    let remote = HSTRING::from(target);
    let res = NETRESOURCEW { dwType: kind, lpRemoteName: PWSTR(remote.as_ptr() as *mut u16), ..Default::default() };
    let r = unsafe { WNetAddConnection3W(Some(HWND(owner as *mut _)), &res, None, None, CONNECT_INTERACTIVE | CONNECT_PROMPT) };
    // 1219: 같은 서버에 다른 자격 증명으로 이미 붙어 있다 — Windows 는 한 서버에 자격 증명 하나만 둔다. 그 연결을 그대로 쓴다.
    if r == NO_ERROR || r.0 == 1219 { Ok(()) } else { Err(NetError::from_code(r.0)) }
}

struct Res {
    local: String,
    remote: String,
}

fn enumerate(scope: NET_RESOURCE_SCOPE, root: Option<&NETRESOURCEW>) -> Result<Vec<Res>, NetError> {
    let mut handle = HANDLE::default();
    let r = unsafe { WNetOpenEnumW(scope, RESOURCETYPE_DISK, RESOURCEUSAGE_NONE, root.map(|r| r as *const _), &mut handle) };
    if r != NO_ERROR {
        return Err(NetError::from_code(r.0));
    }
    let mut out = Vec::new();
    // 16KB 면 공유 수십 개가 한 번에 온다. 모자라면 ERROR_MORE_DATA 가 와서 늘린다.
    let mut buf: Vec<u64> = vec![0; 16 * 1024 / 8];
    let result = loop {
        let mut count = u32::MAX;
        let mut size = (buf.len() * 8) as u32;
        let r: WIN32_ERROR = unsafe { WNetEnumResourceW(handle, &mut count, buf.as_mut_ptr() as *mut _, &mut size) };
        if r == ERROR_NO_MORE_ITEMS {
            break Ok(());
        }
        if r == ERROR_MORE_DATA {
            buf = vec![0; (size as usize).div_ceil(8) + 1];
            continue;
        }
        if r != NO_ERROR {
            break Err(NetError::from_code(r.0));
        }
        let items = unsafe { std::slice::from_raw_parts(buf.as_ptr() as *const NETRESOURCEW, count as usize) };
        for it in items {
            let remote = unsafe { pwstr(it.lpRemoteName) };
            if !remote.is_empty() {
                out.push(Res { local: unsafe { pwstr(it.lpLocalName) }, remote });
            }
        }
    };
    unsafe {
        let _ = WNetCloseEnum(handle);
    }
    result.map(|_| out)
}

unsafe fn pwstr(p: PWSTR) -> String {
    if p.is_null() { String::new() } else { unsafe { p.to_string().unwrap_or_default() } }
}

// ───────────────────────────── [3] 이 PC 가 쓰던 곳 ─────────────────────────────

/// 이 PC 가 이미 쓰는 네트워크 위치 하나.
#[derive(Debug, Clone)]
pub struct Known {
    /// `\\서버\공유…` 또는 `\\서버`.
    pub path: String,
    /// 어디서 찾았나 — 화면에 그대로 낸다 (「네트워크 드라이브 Z:」 · 「탐색기 주소 기록」 · 「네트워크 위치」).
    pub source: String,
}

/// 「연결」 칸에 한 번 눌러 더할 후보 — 탐색기에 이미 붙어 있거나 적어 본 곳.
/// 같은 곳은 하나만, 먼저 찾은 출처로 둔다 (연결된 드라이브 → 네트워크 위치 → 주소 기록).
pub fn known() -> Vec<Known> {
    let mut out: Vec<Known> = Vec::new();
    let mut push = |path: String, source: String| {
        let path = normalize(&path);
        if server_of(&path).is_none() {
            return;
        }
        let key = path.trim_end_matches('\\').to_lowercase();
        if !out.iter().any(|k| k.path.trim_end_matches('\\').to_lowercase() == key) {
            out.push(Known { path, source });
        }
    };
    for scope in [RESOURCE_CONNECTED, RESOURCE_REMEMBERED] {
        for r in enumerate(scope, None).unwrap_or_default() {
            let source = if r.local.is_empty() { "탐색기에 연결됨".to_string() } else { format!("네트워크 드라이브 {}", r.local) };
            push(r.remote, source);
        }
    }
    for p in network_shortcuts() {
        push(p, "네트워크 위치".into());
    }
    for p in typed_paths() {
        push(p, "탐색기 주소 기록".into());
    }
    out
}

/// `%APPDATA%\Microsoft\Windows\Network Shortcuts` — 탐색기 「네트워크 위치 추가」로 만든 것. 폴더마다 target.lnk 가 있다.
fn network_shortcuts() -> Vec<String> {
    let Ok(appdata) = std::env::var("APPDATA") else { return Vec::new() };
    let dir = std::path::Path::new(&appdata).join("Microsoft\\Windows\\Network Shortcuts");
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let p = e.path();
            let lnk = if p.is_dir() { p.join("target.lnk") } else { p };
            crate::ops::resolve_link(&lnk.to_string_lossy())
        })
        .collect()
}

/// 탐색기 주소창에 적었던 주소 (`HKCU\…\Explorer\TypedPaths` 의 url1 · url2 …) 중 `\\` 로 시작하는 것.
fn typed_paths() -> Vec<String> {
    let mut out = Vec::new();
    let mut key = HKEY::default();
    let sub = HSTRING::from("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedPaths");
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &sub, None, KEY_READ, &mut key) }.is_err() {
        return out;
    }
    for i in 0..64u32 {
        let mut name = [0u16; 256];
        let mut name_len = name.len() as u32;
        let mut data = [0u16; 2048];
        let mut data_len = (data.len() * 2) as u32;
        let mut kind = REG_VALUE_TYPE::default();
        let r = unsafe {
            RegEnumValueW(
                key,
                i,
                Some(PWSTR(name.as_mut_ptr())),
                &mut name_len,
                None,
                Some(&mut kind.0),
                Some(data.as_mut_ptr() as *mut u8),
                Some(&mut data_len),
            )
        };
        if r.is_err() {
            break;
        }
        let n = (data_len as usize / 2).min(data.len());
        let s = String::from_utf16_lossy(&data[..n]).trim_end_matches('\0').to_string();
        if s.starts_with("\\\\") {
            out.push(s);
        }
    }
    unsafe {
        let _ = RegCloseKey(key);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 주소_풀기() {
        assert_eq!(normalize("192.168.0.2"), "\\\\192.168.0.2");
        assert_eq!(normalize(" \\\\192.168.0.2\\ "), "\\\\192.168.0.2");
        assert_eq!(normalize("smb://nas/공유/하위"), "\\\\nas\\공유\\하위");
        assert_eq!(normalize("//nas/공유/"), "\\\\nas\\공유");
        assert_eq!(normalize("192.168.0.2\\docs"), "\\\\192.168.0.2\\docs");
        assert_eq!(normalize("D:\\문서"), "D:\\문서");
        assert_eq!(normalize("문서"), "문서");
        assert!(is_server_only("\\\\192.168.0.2"));
        assert!(!is_server_only("\\\\192.168.0.2\\docs"));
        assert_eq!(server_of("\\\\nas\\a\\b"), Some("nas"));
    }
}
