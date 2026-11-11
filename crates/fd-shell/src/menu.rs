//! 오른쪽 메뉴 — 탐색기와 같은 셸 메뉴를 그대로 띄운다 (TortoiseSVN · 반디집 · 연결 프로그램 · 보내기 …).
//!
//! 「보내기」 · 「연결 프로그램」 같은 하위 메뉴와 아이콘은 메뉴가 열릴 때 셸 확장이 그린다.
//! 그 메시지(WM_INITMENUPOPUP · WM_DRAWITEM · WM_MEASUREITEM · WM_MENUCHAR)를 메뉴 동안 IContextMenu2/3 으로
//! 넘겨 주지 않으면 하위 메뉴가 빈 채로 열린다. 그래서 메뉴를 띄우는 동안만 창을 서브클래싱한다.

use std::ffi::CString;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_SHIFT};
use windows::Win32::UI::Shell::{
    BHID_SFObject, BHID_SFUIObject, CMF_CANRENAME, CMF_EXPLORE, CMF_EXTENDEDVERBS, CMF_NORMAL,
    CMIC_MASK_PTINVOKE, CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX, DefSubclassProc,
    GCS_VERBW, IContextMenu, IContextMenu2, IContextMenu3, IShellFolder, RemoveWindowSubclass, SetWindowSubclass,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, GetCursorPos, SW_SHOWNORMAL, TPM_RETURNCMD, TPM_RIGHTBUTTON, TrackPopupMenuEx,
    WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR,
};
use windows::core::{HSTRING, Interface, PCSTR, PCWSTR, PSTR};

use crate::com::{hwnd, item_array, shell_item};
use crate::{RawHwnd, Result};

/// windows 크레이트에 빠져 있어 직접 둔다 (ShObjIdl.h · SEE_MASK_UNICODE 와 같은 값).
const CMIC_MASK_UNICODE: u32 = 0x0000_4000;
const FIRST_ID: u32 = 1;
const LAST_ID: u32 = 0x7FFF;
const SUBCLASS_ID: usize = 0xFD01;

/// 메뉴에서 고른 결과.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuPick {
    /// 아무것도 고르지 않고 닫았다.
    None,
    /// 「이름 바꾸기」 — 셸이 아니라 목록 칸에서 바로 고치도록 화면에 돌려준다 (탐색기와 같은 동작).
    Rename,
    /// 셸이 실행했다. 동사(verb)를 알 수 있으면 함께 (예: `delete` · `properties`).
    Invoked(String),
}

/// 고른 항목들의 메뉴. 주 스레드에서 부른다.
pub fn show_items_menu(owner: RawHwnd, paths: &[String], dir: &str) -> Result<MenuPick> {
    let arr = item_array(paths)?;
    let cm: IContextMenu = unsafe { arr.BindToHandler(None, &BHID_SFUIObject) }?;
    run_menu(hwnd(owner), &cm, dir, CMF_CANRENAME)
}

/// 빈 곳 메뉴 (새로 만들기 · 붙여넣기 · 속성). 주 스레드에서 부른다.
pub fn show_background_menu(owner: RawHwnd, dir: &str) -> Result<MenuPick> {
    let folder: IShellFolder = unsafe { shell_item(dir)?.BindToHandler(None, &BHID_SFObject) }?;
    let cm: IContextMenu = unsafe { folder.CreateViewObject(hwnd(owner)) }?;
    run_menu(hwnd(owner), &cm, dir, 0)
}

/// 메뉴 없이 셸 동사를 바로 실행한다 — `copy` · `cut` · `paste` · `properties` · `delete`.
/// 단축키(Ctrl+C 등)가 탐색기와 같은 결과를 내도록 셸의 같은 동사를 쓴다. 주 스레드에서 부른다.
pub fn invoke_verb(owner: RawHwnd, paths: &[String], verb: &str, dir: &str) -> Result<()> {
    let arr = item_array(paths)?;
    let cm: IContextMenu = unsafe { arr.BindToHandler(None, &BHID_SFUIObject) }?;
    let menu = unsafe { CreatePopupMenu() }?;
    // 일부 셸 확장은 QueryContextMenu 를 거치지 않은 InvokeCommand 를 거절한다.
    let r = unsafe { cm.QueryContextMenu(menu, 0, FIRST_ID, LAST_ID, CMF_NORMAL) }.ok();
    let out = r.and_then(|_| {
        let verb_a = CString::new(verb).unwrap_or_default();
        let verb_w = HSTRING::from(verb);
        invoke(&cm, hwnd(owner), PCSTR(verb_a.as_ptr() as _), PCWSTR(verb_w.as_ptr()), dir)
    });
    unsafe {
        let _ = DestroyMenu(menu);
    }
    Ok(out?)
}

fn run_menu(owner: HWND, cm: &IContextMenu, dir: &str, extra: u32) -> Result<MenuPick> {
    let menu = unsafe { CreatePopupMenu() }?;
    let mut flags = CMF_NORMAL | CMF_EXPLORE | extra;
    // Shift 를 누르고 열면 탐색기처럼 숨은 동사(「경로로 복사」 등)까지 보인다.
    if unsafe { GetKeyState(VK_SHIFT.0 as i32) } < 0 {
        flags |= CMF_EXTENDEDVERBS;
    }
    let result = (|| -> Result<MenuPick> {
        unsafe { cm.QueryContextMenu(menu, 0, FIRST_ID, LAST_ID, flags) }.ok()?;
        let mut pt = POINT::default();
        unsafe { GetCursorPos(&mut pt) }?;

        let data = cm as *const IContextMenu as usize;
        unsafe {
            let _ = SetWindowSubclass(owner, Some(subclass_proc), SUBCLASS_ID, data);
        }
        let picked = unsafe { TrackPopupMenuEx(menu, (TPM_RETURNCMD | TPM_RIGHTBUTTON).0, pt.x, pt.y, owner, None) };
        unsafe {
            let _ = RemoveWindowSubclass(owner, Some(subclass_proc), SUBCLASS_ID);
        }

        let id = picked.0 as u32;
        if id < FIRST_ID {
            return Ok(MenuPick::None);
        }
        let offset = (id - FIRST_ID) as usize;
        let verb = command_verb(cm, offset);
        if verb.eq_ignore_ascii_case("rename") {
            return Ok(MenuPick::Rename);
        }
        // 고른 순번 그대로 실행한다 (MAKEINTRESOURCE 꼴 — 포인터 자리에 순번).
        invoke(cm, owner, PCSTR(offset as *const u8), PCWSTR(offset as *const u16), dir)?;
        Ok(MenuPick::Invoked(verb))
    })();
    unsafe {
        let _ = DestroyMenu(menu);
    }
    result
}

fn command_verb(cm: &IContextMenu, offset: usize) -> String {
    let mut buf = [0u16; 128];
    let ok = unsafe { cm.GetCommandString(offset, GCS_VERBW, None, PSTR(buf.as_mut_ptr() as *mut u8), buf.len() as u32) };
    if ok.is_err() {
        return String::new();
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

fn invoke(cm: &IContextMenu, owner: HWND, verb: PCSTR, verb_w: PCWSTR, dir: &str) -> windows::core::Result<()> {
    let dir_w = HSTRING::from(dir);
    let mut pt = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut pt);
    }
    // CMIC_MASK_SHIFT_DOWN 은 일부러 넣지 않는다. 넣으면 「삭제」가 휴지통을 건너뛰는 영구 삭제가 된다 — 지우기는 늘 휴지통으로.
    let info = CMINVOKECOMMANDINFOEX {
        cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
        fMask: CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE,
        hwnd: owner,
        lpVerb: verb,
        lpVerbW: verb_w,
        lpDirectoryW: PCWSTR(dir_w.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ptInvoke: pt,
        ..Default::default()
    };
    unsafe { cm.InvokeCommand(&info as *const CMINVOKECOMMANDINFOEX as *const CMINVOKECOMMANDINFO) }
}

unsafe extern "system" fn subclass_proc(
    window: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    if matches!(msg, WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR) && data != 0 {
        let cm = unsafe { &*(data as *const IContextMenu) };
        if let Ok(cm3) = cm.cast::<IContextMenu3>() {
            let mut out = LRESULT(0);
            if unsafe { cm3.HandleMenuMsg2(msg, wparam, lparam, Some(&mut out)) }.is_ok() {
                return out;
            }
        } else if msg != WM_MENUCHAR {
            if let Ok(cm2) = cm.cast::<IContextMenu2>() {
                if unsafe { cm2.HandleMenuMsg(msg, wparam, lparam) }.is_ok() {
                    return LRESULT(if msg == WM_INITMENUPOPUP { 0 } else { 1 });
                }
            }
        }
    }
    unsafe { DefSubclassProc(window, msg, wparam, lparam) }
}
