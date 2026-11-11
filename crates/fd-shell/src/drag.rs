//! 앱 밖으로 끌기 — 메일 · 메신저 · 탐색기에 파일을 끌어다 놓는다.
//!
//! 셸이 만든 데이터 개체(BHID_DataObject)와 SHDoDragDrop 을 쓴다. 탐색기와 같은 끌기 그림 · 복사/이동 표시가 나오고,
//! 받는 쪽이 이동을 고르면 받는 쪽(탐색기)이 직접 옮긴다.

use windows::Win32::System::Ole::{DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE};
use windows::Win32::System::Com::IDataObject;
use windows::Win32::UI::Shell::{BHID_DataObject, SHDoDragDrop};

use crate::com::{hwnd, item_array};
use crate::{RawHwnd, Result};

/// 끌기를 시작하고 놓을 때까지 기다린다. 돌려주는 값은 받는 쪽이 고른 효과 (0 = 취소 · 1 복사 · 2 이동 · 4 바로가기).
/// 마우스 단추가 눌린 동안 주 스레드에서 불러야 한다.
pub fn drag_out(owner: RawHwnd, paths: &[String]) -> Result<u32> {
    let arr = item_array(paths)?;
    let data: IDataObject = unsafe { arr.BindToHandler(None, &BHID_DataObject) }?;
    let effect = unsafe { SHDoDragDrop(Some(hwnd(owner)), &data, None, DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK) }?;
    Ok(effect.0)
}
