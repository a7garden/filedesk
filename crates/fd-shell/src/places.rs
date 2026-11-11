//! 왼쪽 위치 목록 · 경로 풀기 · 키 상태.

use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, KF_FLAG_DEFAULT, SHGetKnownFolderPath,
};
use windows::core::{GUID, HSTRING};

#[derive(Debug, Clone)]
pub struct Place {
    pub name: String,
    pub path: String,
}

/// 바탕화면 · 다운로드 · 문서. 사용자가 위치를 옮겨 두었어도(D: 등) 실제 경로를 준다.
pub fn known_folders() -> Vec<Place> {
    [(&FOLDERID_Desktop, "바탕화면"), (&FOLDERID_Downloads, "다운로드"), (&FOLDERID_Documents, "문서")]
        .into_iter()
        .filter_map(|(id, name)| known(id).map(|path| Place { name: name.into(), path }))
        .collect()
}

fn known(id: &GUID) -> Option<String> {
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as _));
        s
    }
}

/// 드라이브 한 칸 — 왼쪽 「이 PC」 줄이 문자 · 볼륨 이름 · 남은 용량 띠로 그린다.
#[derive(Debug, Clone)]
pub struct Drive {
    /// `C:\`
    pub path: String,
    /// 볼륨 이름. 없으면 종류 이름(로컬 디스크 · 이동식 디스크 …).
    pub label: String,
    /// `fixed` · `removable` · `network` · `cd`
    pub kind: &'static str,
    /// 바이트. 모르면 0 — 네트워크 · CD 는 묻지 않는다 (연결이 끊긴 네트워크 드라이브는 몇십 초 멈춘다).
    pub total: u64,
    pub free: u64,
}

/// 드라이브 목록. 이름은 탐색기처럼 「볼륨 이름 (C:)」.
pub fn drives() -> Vec<Place> {
    drive_details().into_iter().map(|d| Place { name: format!("{} ({})", d.label, &d.path[..2]), path: d.path }).collect()
}

/// 드라이브 목록과 용량.
pub fn drive_details() -> Vec<Drive> {
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| {
            let root = format!("{}:\\", (b'A' + i) as char);
            let label = volume_label(&root);
            let kind = unsafe { GetDriveTypeW(&HSTRING::from(root.as_str())) };
            // 2 이동식 · 3 고정 · 4 네트워크 · 5 CD
            let fallback = match kind {
                2 => "이동식 디스크",
                4 => "네트워크 드라이브",
                5 => "CD 드라이브",
                _ => "로컬 디스크",
            };
            let shown = if label.is_empty() { fallback.to_string() } else { label };
            let kind = match kind {
                2 => "removable",
                4 => "network",
                5 => "cd",
                _ => "fixed",
            };
            let (total, free) = if kind == "fixed" || kind == "removable" { space(&root) } else { (0, 0) };
            Drive { path: root, label: shown, kind, total, free }
        })
        .collect()
}

fn space(root: &str) -> (u64, u64) {
    let (mut free, mut total) = (0u64, 0u64);
    let ok = unsafe { GetDiskFreeSpaceExW(&HSTRING::from(root), Some(&mut free), Some(&mut total), None) };
    if ok.is_err() { (0, 0) } else { (total, free) }
}

fn volume_label(root: &str) -> String {
    let mut name = [0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(&HSTRING::from(root), Some(&mut name), None, None, None, None)
    };
    if ok.is_err() {
        return String::new();
    }
    let len = name.iter().position(|&c| c == 0).unwrap_or(0);
    String::from_utf16_lossy(&name[..len])
}

/// 주소창 입력의 `%USERPROFILE%` 같은 환경 변수를 푼다.
pub fn expand_env(input: &str) -> String {
    if !input.contains('%') {
        return input.to_string();
    }
    let src = HSTRING::from(input);
    let mut buf = vec![0u16; 32768];
    let n = unsafe { ExpandEnvironmentStringsW(&src, Some(&mut buf)) } as usize;
    if n == 0 || n > buf.len() {
        return input.to_string();
    }
    String::from_utf16_lossy(&buf[..n.saturating_sub(1)])
}

/// 지금 Ctrl · Shift 가 눌려 있는지. 끌어다 놓을 때 복사/이동을 고르는 데 쓴다 (탐색기 규칙).
pub fn modifier_keys() -> (bool, bool) {
    unsafe { (GetKeyState(VK_CONTROL.0 as i32) < 0, GetKeyState(VK_SHIFT.0 as i32) < 0) }
}
