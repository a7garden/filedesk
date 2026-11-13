//! 앱 밖으로 끌기 — 메일 · 메신저 · 탐색기에 파일을 끌어다 놓는다.
//!
//! 셸이 만든 데이터 개체(BHID_DataObject)와 SHDoDragDrop 을 쓴다. 탐색기와 같은 끌기 그림 · 복사/이동 표시가 나오고,
//! 받는 쪽이 이동을 고르면 받는 쪽(탐색기)이 직접 옮긴다.
//!
//! 2026.11.13 : 끌기 소스(IDropSource)를 직접 둔다 — 끄는 동안 커서 자리를 `on_move` 로 알리려고.
//!   SHDoDragDrop 은 주 스레드를 끌기가 끝날 때까지 붙잡는다. 그동안 웹 화면이 받아야 할 「끄는 중」 알림(wry DragOver)은
//!   Tauri 가 이벤트 루프 대기열로 보내 끌기가 끝난 뒤에야 닿았고, 그래서 앱 안에서 줄을 끌어 독에 가져가도 독이 열리지 않았다 (사용자 지적).
//!   QueryContinueDrag 는 끄는 동안 이 주 스레드에서 거듭 불리므로 여기서 커서 자리를 읽어 넘긴다. 받는 쪽은 대기열을 거치지 않는 길로 화면에 전한다.

use std::cell::Cell;
use std::rc::Rc;

use windows::Win32::Foundation::{DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HWND, POINT, S_OK};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, IDropSource, IDropSource_Impl};
use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::Shell::{BHID_DataObject, SHDoDragDrop};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
use windows::core::{BOOL, HRESULT, implement};

use crate::com::{hwnd, item_array};
use crate::{RawHwnd, Result};

/// 끄는 동안의 커서 자리 — 창 안쪽 물리 픽셀(창 왼쪽 위가 0). 끌기가 끝나면 None 한 번.
pub type OnMove = Box<MoveFn>;
type MoveFn = dyn Fn(Option<(i32, i32)>) + Send;

#[implement(IDropSource)]
struct Source {
    owner: HWND,
    last: Cell<(i32, i32)>,
    on_move: Rc<MoveFn>,
}

impl IDropSource_Impl for Source_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        // 기본 끌기 소스와 같은 판단 — Esc 면 그만두고, 끌기를 시작한 왼쪽 단추를 떼면 놓는다
        if escape.as_bool() {
            return DRAGDROP_S_CANCEL;
        }
        if keys.0 & MK_LBUTTON.0 == 0 {
            return DRAGDROP_S_DROP;
        }
        let mut pt = POINT::default();
        if unsafe { GetCursorPos(&mut pt) }.is_ok() && unsafe { ScreenToClient(self.owner, &mut pt) }.as_bool() && self.last.get() != (pt.x, pt.y) {
            self.last.set((pt.x, pt.y));
            (self.on_move)(Some((pt.x, pt.y)));
        }
        S_OK
    }

    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

/// 끌기를 시작하고 놓을 때까지 기다린다. 돌려주는 값은 받는 쪽이 고른 효과 (0 = 취소 · 1 복사 · 2 이동 · 4 바로가기).
/// 마우스 단추가 눌린 동안 주 스레드에서 불러야 한다. `on_move` 는 끄는 동안 커서 자리(위 OnMove)를 받는다.
pub fn drag_out(owner: RawHwnd, paths: &[String], on_move: OnMove) -> Result<u32> {
    let arr = item_array(paths)?;
    let data: IDataObject = unsafe { arr.BindToHandler(None, &BHID_DataObject) }?;
    let on_move: Rc<MoveFn> = Rc::from(on_move);
    let source: IDropSource = Source { owner: hwnd(owner), last: Cell::new((i32::MIN, i32::MIN)), on_move: on_move.clone() }.into();
    let result = unsafe { SHDoDragDrop(Some(hwnd(owner)), &data, &source, DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK) };
    // 끝났음을 알린다 — 앱 밖에 놓았거나 그만둔 때도 화면이 열어 둔 독을 접게
    on_move(None);
    Ok(result?.0)
}
