//! COM 초기화 · 셸 항목 만들기.

use std::ffi::c_void;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoTaskMemFree, CoUninitialize,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    IShellItem, IShellItemArray, SHCreateItemFromParsingName, SHCreateShellItemArrayFromIDLists,
    SHGetIDListFromObject,
};
use windows::core::HSTRING;

use crate::{RawHwnd, Result, ShellError};

/// 이 스레드에 STA 를 연다. 이미 열려 있으면(S_FALSE) 짝을 맞춰 닫고, 다른 꼴로 열려 있으면 건드리지 않는다.
pub(crate) struct ComGuard(bool);

impl ComGuard {
    pub(crate) fn sta() -> Self {
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        ComGuard(hr.is_ok())
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

/// 새 STA 스레드에서 `f` 를 돌리고 끝날 때까지 기다린다.
/// IFileOperation 의 진행 창은 이 스레드에서 메시지를 돌리므로 주 스레드가 막히지 않는다.
pub fn run_sta<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::spawn(move || {
        let _com = ComGuard::sta();
        f()
    })
    .join()
    .expect("셸 작업 스레드가 죽었다")
}

pub(crate) fn hwnd(raw: RawHwnd) -> HWND {
    HWND(raw as *mut c_void)
}

pub(crate) fn shell_item(path: &str) -> Result<IShellItem> {
    unsafe { SHCreateItemFromParsingName(&HSTRING::from(path), None) }
        .map_err(|e| ShellError(format!("{path}: {}", ShellError::from(e))))
}

/// 여러 경로를 셸 항목 묶음으로. 오른쪽 메뉴 · 끌기 · 복사가 모두 이 묶음을 받는다.
pub(crate) fn item_array(paths: &[String]) -> Result<IShellItemArray> {
    if paths.is_empty() {
        return Err(ShellError("고른 항목이 없다".into()));
    }
    let mut pidls: Vec<*const ITEMIDLIST> = Vec::with_capacity(paths.len());
    let mut failed = None;
    for p in paths {
        match shell_item(p).and_then(|it| unsafe { SHGetIDListFromObject(&it) }.map_err(ShellError::from)) {
            Ok(pidl) => pidls.push(pidl as *const ITEMIDLIST),
            Err(e) => {
                failed = Some(e);
                break;
            }
        }
    }
    let result = match failed {
        Some(e) => Err(e),
        None => unsafe { SHCreateShellItemArrayFromIDLists(&pidls) }.map_err(ShellError::from),
    };
    for p in pidls {
        unsafe { CoTaskMemFree(Some(p as *const c_void)) };
    }
    result
}
