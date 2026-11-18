//! 설치된 앱 — 시작 메뉴 「모든 앱」(`shell:AppsFolder`) 그대로. 데스크톱 앱 · 스토어 앱(계산기 · 설정)을 한 목록으로 준다.
//! 2026.11.18 : 사용자 요청 — 팔레트(Ctrl+K)에서 앱도 이름으로 찾아 열고, 왼쪽 열 「앱」에 고정한다.
//!
//! 시작 메뉴 폴더(.lnk)를 훑지 않고 AppsFolder 를 묻는 까닭: 스토어 앱은 바로가기 파일이 없고, 이름도 Windows 가 보이는 말(「계산기」)로 온다.
//! 여는 것도 `shell:AppsFolder\<id>` 하나로 둘 다 된다.

use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, KF_FLAG_DEFAULT, SHGetKnownFolderItem, SIGDN, SIGDN_NORMALDISPLAY,
    SIGDN_PARENTRELATIVEPARSING, ShellExecuteW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{HSTRING, w};

use crate::{Result, ShellError};

#[derive(Debug, Clone)]
pub struct App {
    /// 시작 메뉴에 보이는 이름.
    pub name: String,
    /// AppsFolder 안의 이름 — 스토어 앱은 AUMID(`Microsoft.WindowsCalculator_…!App`), 데스크톱 앱은 실행 파일 경로나 알려진 폴더 꼴.
    pub id: String,
}

/// 모든 앱. 제거 프로그램 · 도움말 · 웹 주소처럼 「앱을 연다」가 아닌 것은 뺀다. STA 스레드에서 부른다.
pub fn list() -> Vec<App> {
    let mut out = Vec::new();
    unsafe {
        let Ok(folder): windows::core::Result<IShellItem> = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) else {
            return out;
        };
        let Ok(items): windows::core::Result<IEnumShellItems> = folder.BindToHandler(None, &BHID_EnumItems) else {
            return out;
        };
        loop {
            let mut one = [None];
            let mut got = 0u32;
            if items.Next(&mut one, Some(&mut got)).is_err() || got == 0 {
                break;
            }
            let Some(it) = one[0].take() else { break };
            let (Some(name), Some(id)) = (display(&it, SIGDN_NORMALDISPLAY), display(&it, SIGDN_PARENTRELATIVEPARSING)) else { continue };
            if skip(&name, &id) {
                continue;
            }
            out.push(App { name, id });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

unsafe fn display(it: &IShellItem, how: SIGDN) -> Option<String> {
    let p = unsafe { it.GetDisplayName(how) }.ok()?;
    let s = unsafe { p.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s.filter(|s| !s.is_empty())
}

fn skip(name: &str, id: &str) -> bool {
    let n = name.to_lowercase();
    let i = id.to_lowercase();
    n.contains("uninstall") || name.contains("제거") || [".url", ".chm", ".txt", ".pdf", ".htm", ".html", ".rtf"].iter().any(|e| i.ends_with(e)) || i.starts_with("http")
}

/// 앱을 연다. `id` 가 경로(`C:\…\a.exe` · `.lnk`)면 그 파일을, 아니면 AppsFolder 의 그 앱을.
pub fn launch(id: &str) -> Result<()> {
    let target = if is_path(id) { id.to_string() } else { format!("shell:AppsFolder\\{id}") };
    let r = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(target), None, None, SW_SHOWNORMAL) };
    // ShellExecute 는 32 이하를 오류로 돌려준다.
    if r.0 as isize <= 32 { Err(ShellError(format!("앱을 열지 못했다 ({})", r.0 as isize))) } else { Ok(()) }
}

/// 드라이브 · 네트워크 경로인가 — 왼쪽 열에 끌어 놓은 실행 파일 · 바로가기.
pub fn is_path(id: &str) -> bool {
    id.get(1..3) == Some(":\\") || id.starts_with("\\\\")
}

/// 아이콘을 뽑을 셸 이름 — fdicon 의 `i:<크기>:` 에 그대로 넘긴다.
pub fn icon_name(id: &str) -> String {
    if is_path(id) { id.to_string() } else { format!("shell:AppsFolder\\{id}") }
}
