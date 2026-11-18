//! 셸 파일 작업 (IFileOperation). `run_sta` 스레드 안에서 부른다.
//!
//! 진행 창 · 충돌 창 · 실행 취소(탐색기 Ctrl+Z)를 셸이 맡는다.

use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::UI::Shell::{
    FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOCONFIRMMKDIR, FOF_WANTNUKEWARNING, FOFX_RECYCLEONDELETE, FileOperation,
    IFileOperation,
};
use windows::core::HSTRING;

use crate::com::{hwnd, item_array, shell_item};
use crate::{RawHwnd, Result, ShellError};

/// 사용자가 진행 창에서 「취소」를 누르면 PerformOperations 가 이 값으로 실패한다 — 오류가 아니라 취소로 본다.
const COPYENGINE_E_USER_CANCELLED: i32 = 0x8027_0000_u32 as i32;

/// 작업 결과.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Done,
    /// 사용자가 중간에 취소했거나 일부를 건너뛰었다.
    Aborted,
}

fn new_op(owner: RawHwnd, flags: u32) -> Result<IFileOperation> {
    let op: IFileOperation = unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_ALL) }?;
    unsafe {
        op.SetOwnerWindow(hwnd(owner))?;
        op.SetOperationFlags(windows::Win32::UI::Shell::FILEOPERATION_FLAGS(flags))?;
    }
    Ok(op)
}

fn perform(op: &IFileOperation) -> Result<Outcome> {
    match unsafe { op.PerformOperations() } {
        Ok(()) => {}
        Err(e) if e.code().0 == COPYENGINE_E_USER_CANCELLED => return Ok(Outcome::Aborted),
        Err(e) => return Err(ShellError::from(e)),
    }
    let aborted = unsafe { op.GetAnyOperationsAborted() }?.as_bool();
    Ok(if aborted { Outcome::Aborted } else { Outcome::Done })
}

/// 이름 바꾸기. 같은 이름이 있으면 셸이 묻는다.
pub fn rename(owner: RawHwnd, path: &str, new_name: &str) -> Result<Outcome> {
    let op = new_op(owner, FOF_ALLOWUNDO.0)?;
    let item = shell_item(path)?;
    unsafe { op.RenameItem(&item, &HSTRING::from(new_name), None) }?;
    perform(&op)
}

/// 휴지통으로 보낸다.
///
/// 확인 창은 묻지 않되(FOF_NOCONFIRMATION), 휴지통에 들어가지 않는 파일(너무 크거나 NAS 경로)은
/// 영구 삭제 전에 반드시 묻게 한다(FOF_WANTNUKEWARNING). 묻지 않고 영구 삭제되는 길을 남기지 않으려고.
pub fn recycle(owner: RawHwnd, paths: &[String]) -> Result<Outcome> {
    let flags = FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_WANTNUKEWARNING.0 | FOFX_RECYCLEONDELETE.0;
    let op = new_op(owner, flags)?;
    let arr = item_array(paths)?;
    unsafe { op.DeleteItems(&arr) }?;
    perform(&op)
}

/// 복사 또는 이동. 이름이 겹치면 셸이 「바꾸기 · 건너뛰기 · 비교」 창을 띄운다.
pub fn transfer(owner: RawHwnd, paths: &[String], dest_dir: &str, mv: bool) -> Result<Outcome> {
    let op = new_op(owner, FOF_ALLOWUNDO.0 | FOF_NOCONFIRMMKDIR.0)?;
    let arr = item_array(paths)?;
    let dest = shell_item(dest_dir)?;
    unsafe {
        if mv {
            op.MoveItems(&arr, &dest)?;
        } else {
            op.CopyItems(&arr, &dest)?;
        }
    }
    perform(&op)
}

/// 지난 판을 `history_dir`(`이전판/`)로 옮긴다. 폴더가 없으면 만든다. 한 번의 작업이라 탐색기 Ctrl+Z 로 함께 되돌아간다.
pub fn retire(owner: RawHwnd, paths: &[String], history_dir: &str) -> Result<Outcome> {
    std::fs::create_dir_all(history_dir).map_err(|e| ShellError(format!("{history_dir}: {e}")))?;
    transfer(owner, paths, history_dir, true)
}

/// 새 판 — `src` 를 같은 폴더에 `new_name` 으로 복사하고, `retire` (지난 판 · 그 판의 다른 꼴)를 `history_dir` 로 옮긴다.
/// 한 번의 작업이라 탐색기 Ctrl+Z 로도 함께 되돌아간다. 이름이 겹치면 셸이 묻는다.
pub fn new_edition(owner: RawHwnd, src: &str, new_name: &str, retire: &[String], history_dir: &str) -> Result<Outcome> {
    std::fs::create_dir_all(history_dir).map_err(|e| ShellError(format!("{history_dir}: {e}")))?;
    let folder = std::path::Path::new(src)
        .parent()
        .ok_or_else(|| ShellError(format!("{src}: 상위 폴더 없음")))?
        .to_string_lossy()
        .into_owned();
    let op = new_op(owner, FOF_ALLOWUNDO.0 | FOF_NOCONFIRMMKDIR.0)?;
    let item = shell_item(src)?;
    let dest = shell_item(&folder)?;
    unsafe { op.CopyItem(&item, &dest, &HSTRING::from(new_name), None) }?;
    if !retire.is_empty() {
        let arr = item_array(retire)?;
        let hist = shell_item(history_dir)?;
        unsafe { op.MoveItems(&arr, &hist) }?;
    }
    perform(&op)
}

/// 새 폴더. 「새 폴더」 · 「새 폴더 (2)」 … 비어 있는 이름을 골라 만들고 그 경로를 돌려준다.
/// 빈 폴더 하나를 만드는 일이라 셸을 거치지 않는다 — 셸 NewItem 은 실제로 붙은 이름을 돌려받기가 번거롭다.
pub fn new_folder(dir: &str) -> Result<String> {
    let base = std::path::Path::new(dir);
    for n in 1..1000 {
        let name = if n == 1 { "새 폴더".to_string() } else { format!("새 폴더 ({n})") };
        let p = base.join(&name);
        match std::fs::create_dir(&p) {
            Ok(()) => return Ok(p.to_string_lossy().into_owned()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(ShellError(format!("새 폴더를 만들지 못했다: {e}"))),
        }
    }
    Err(ShellError("새 폴더 이름을 정할 수 없음".into()))
}

/// 기본 프로그램으로 연다 (더블클릭과 같다).
pub fn open(owner: RawHwnd, path: &str, dir: &str) -> Result<()> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let r = unsafe {
        ShellExecuteW(Some(hwnd(owner)), None, &HSTRING::from(path), None, &HSTRING::from(dir), SW_SHOWNORMAL)
    };
    // 32 이하는 실패 (ShellExecute 의 옛 규약). 연결 프로그램이 없으면 셸이 고르기 창을 스스로 띄운다.
    if (r.0 as isize) <= 32 {
        return Err(ShellError(format!("열지 못했다: {path}")));
    }
    Ok(())
}

/// 바로가기(.lnk)가 가리키는 경로. 폴더 바로가기를 탐색기가 아니라 이 앱 안에서 따라가려고.
pub fn resolve_link(path: &str) -> Option<String> {
    use windows::Win32::System::Com::{IPersistFile, STGM_READ};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use windows::core::Interface;
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
        link.cast::<IPersistFile>().ok()?.Load(&HSTRING::from(path), STGM_READ).ok()?;
        let mut buf = [0u16; 32768];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let len = buf.iter().position(|&c| c == 0).unwrap_or(0);
        (len > 0).then(|| String::from_utf16_lossy(&buf[..len]))
    }
}

/// 클립보드의 파일 목록과 잘라내기 여부 — 탐색기 · 이 앱이 복사 · 잘라내기로 올린 것 (CF_HDROP + 「Preferred DropEffect」).
/// 파일이 아니면 None. 2026.11.17 : 붙여넣기를 셸 동사에서 IFileOperation 으로 바꾸며 더했다 —
/// 셸 「붙여넣기」 동사는 무엇이 어디로 갔는지 돌려주지 않아 실행 취소를 쌓을 수 없었다.
pub fn clipboard_files() -> Option<(Vec<String>, bool)> {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
    use windows::core::w;

    // 다른 프로그램이 잠깐 열고 있으면 실패한다 — 몇 번 다시 해 본다
    let mut opened = false;
    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            opened = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
    if !opened {
        return None;
    }
    let read = || -> Option<(Vec<String>, bool)> {
        unsafe { IsClipboardFormatAvailable(CF_HDROP.0 as u32) }.ok()?;
        let h: HANDLE = unsafe { GetClipboardData(CF_HDROP.0 as u32) }.ok()?;
        let drop = HDROP(h.0);
        let n = unsafe { DragQueryFileW(drop, u32::MAX, None) };
        let mut files = Vec::with_capacity(n as usize);
        for i in 0..n {
            let len = unsafe { DragQueryFileW(drop, i, None) } as usize;
            let mut buf = vec![0u16; len + 1];
            let got = unsafe { DragQueryFileW(drop, i, Some(&mut buf)) } as usize;
            files.push(String::from_utf16_lossy(&buf[..got]));
        }
        let fmt = unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) };
        let mv = (|| {
            unsafe { IsClipboardFormatAvailable(fmt) }.ok()?;
            let h: HANDLE = unsafe { GetClipboardData(fmt) }.ok()?;
            let g = HGLOBAL(h.0);
            let p = unsafe { GlobalLock(g) } as *const u32;
            if p.is_null() {
                return None;
            }
            let v = unsafe { *p };
            unsafe {
                let _ = GlobalUnlock(g);
            }
            // DROPEFFECT_MOVE
            Some(v & 2 != 0)
        })()
        .unwrap_or(false);
        (!files.is_empty()).then_some((files, mv))
    };
    let out = read();
    unsafe {
        let _ = CloseClipboard();
    }
    out
}

/// 잘라낸 것을 붙여넣은 뒤 클립보드를 비운다 — 탐색기와 같게. 옮긴 자리에는 원본이 없어 다시 붙여넣을 것이 없다.
pub fn clear_clipboard() {
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard};
    unsafe {
        if OpenClipboard(None).is_ok() {
            let _ = EmptyClipboard();
            let _ = CloseClipboard();
        }
    }
}
