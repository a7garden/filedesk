//! 파일 아이콘 · 종류 이름. 셸이 주는 것을 그대로 쓴다 — 탐색기와 같은 그림 · 같은 이름이어야 눈이 헤매지 않는다.
//!
//! 확장자마다 한 번만 묻고 기억한다. exe · lnk · ico 처럼 파일마다 그림이 다른 것만 경로로 묻는다.
//!
//! 2026.11.11 : 격자 보기용 큰 그림 — `i:<크기>:<경로>` 큰 아이콘 · `t:<크기>:<경로>` 미리보기(그림 · pdf · 영상은 내용).
//! IShellItemImageFactory 가 탐색기 「큰 아이콘」 보기와 같은 그림을 준다. 미리보기는 느릴 수 있어 아이콘과 다른 스레드에서 뽑고,
//! 수천 장이 될 수 있어 여기서 기억하지 않는다 (화면 쪽 브라우저 캐시가 맡는다). 미리보기가 없으면 404 — 화면이 아이콘으로 바꿔 그린다.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BLACKNESS, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS,
    DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW, HBITMAP, HGDIOBJ, PatBlt, ReleaseDC, SelectObject, WHITENESS,
};
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SHFILEINFOW, SHGFI_FLAGS, SHGFI_ICON, SHGFI_SMALLICON,
    SHGFI_TYPENAME, SHGFI_USEFILEATTRIBUTES, SHGetFileInfoW, SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT, SIIGBF_THUMBNAILONLY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DI_NORMAL, DestroyIcon, DrawIconEx, GetIconInfo, GetSystemMetrics, HICON, ICONINFO, SM_CXSMICON,
};
use windows::core::HSTRING;

/// 확장자가 같아도 파일마다 아이콘이 다른 것.
pub const PER_FILE_EXTS: &[&str] = &["exe", "lnk", "ico", "url", "msc", "cpl", "scr"];

fn kind_cache() -> &'static Mutex<HashMap<String, String>> {
    static C: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn icon_cache() -> &'static Mutex<HashMap<String, Vec<u8>>> {
    static C: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn query(path: &str, attrs: FILE_FLAGS_AND_ATTRIBUTES, flags: SHGFI_FLAGS) -> Option<SHFILEINFOW> {
    let mut info = SHFILEINFOW::default();
    let r = unsafe {
        SHGetFileInfoW(&HSTRING::from(path), attrs, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, flags)
    };
    (r != 0).then_some(info)
}

/// 「Microsoft PowerPoint 프레젠테이션」 같은 종류 이름.
pub fn type_name(ext: &str, is_dir: bool) -> String {
    let key = if is_dir { "\u{0}dir".to_string() } else { ext.to_string() };
    if let Some(v) = kind_cache().lock().unwrap().get(&key) {
        return v.clone();
    }
    let (probe, attrs) = if is_dir { ("folder".to_string(), FILE_ATTRIBUTE_DIRECTORY) } else { (format!("x.{ext}"), FILE_ATTRIBUTE_NORMAL) };
    let name = query(&probe, attrs, SHGFI_TYPENAME | SHGFI_USEFILEATTRIBUTES)
        .map(|i| {
            let len = i.szTypeName.iter().position(|&c| c == 0).unwrap_or(0);
            String::from_utf16_lossy(&i.szTypeName[..len])
        })
        .unwrap_or_default();
    kind_cache().lock().unwrap().insert(key, name.clone());
    name
}

/// 아이콘 PNG. `key` 꼴: `d` 폴더 · `e:<확장자>` · `f:<경로>` (파일마다 다른 것).
///
/// 셸 아이콘은 한 스레드에서 차례로 뽑는다. 화면이 아이콘 수십 개를 한꺼번에 청하면 요청마다 스레드를 띄워
/// SHGetFileInfo · GDI 를 동시에 부르게 되는데, 그때 일부가 까닭 없이 실패했다 (11-11 앱 시험: pptx · txt 404).
/// 어느 스레드에서 불러도 된다 — 안에서 아이콘 전담 STA 스레드로 넘긴다.
pub fn icon_png(key: &str) -> Option<Vec<u8>> {
    if let Some(v) = icon_cache().lock().unwrap().get(&cache_key(key)) {
        return Some(v.clone());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let w = if key.starts_with("t:") { thumb_worker() } else { icon_worker() };
    w.lock().unwrap().send((key.to_string(), tx)).ok()?;
    rx.recv().ok().flatten()
}

type IconJob = (String, std::sync::mpsc::Sender<Option<Vec<u8>>>);

fn icon_worker() -> &'static Mutex<std::sync::mpsc::Sender<IconJob>> {
    static W: OnceLock<Mutex<std::sync::mpsc::Sender<IconJob>>> = OnceLock::new();
    W.get_or_init(|| spawn_worker("fd-icon"))
}

/// 미리보기 전담 — 큰 그림 · pdf 는 한 장에 수백 ms 걸려, 아이콘 스레드에 섞으면 목록 아이콘이 그만큼 늦게 뜬다.
fn thumb_worker() -> &'static Mutex<std::sync::mpsc::Sender<IconJob>> {
    static W: OnceLock<Mutex<std::sync::mpsc::Sender<IconJob>>> = OnceLock::new();
    W.get_or_init(|| spawn_worker("fd-thumb"))
}

fn spawn_worker(name: &str) -> Mutex<std::sync::mpsc::Sender<IconJob>> {
    let (tx, rx) = std::sync::mpsc::channel::<IconJob>();
    std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let _com = crate::com::ComGuard::sta();
            for (key, reply) in rx {
                // 못 그리면 확장자 없는 일반 파일 아이콘으로 (오프라인 NAS · 지워진 바로가기 대상 등).
                // 미리보기(`t:`)는 바꿔치지 않는다 — 비워 돌려야 화면이 설정대로(셸 · filedesk · 팩) 그림을 고른다.
                let png = if key.starts_with("t:") { extract(&key) } else { extract(&key).or_else(|| extract("e:")) };
                let _ = reply.send(png);
            }
        })
        .expect("아이콘 스레드");
    Mutex::new(tx)
}

/// 큰 아이콘은 확장자마다 같으므로 확장자로 기억한다 (`i:96:C:\a.pptx` → `I:96:pptx`). 미리보기 · 파일마다 다른 것은 경로 그대로.
fn cache_key(key: &str) -> String {
    if let Some(rest) = key.strip_prefix("i:") {
        if let Some((size, path)) = rest.split_once(':') {
            // 앱(`shell:AppsFolder\…`)은 앱마다 그림이 다르다 — 확장자로 묶으면 「…!App」 꼴 끝말이 같은 앱끼리 그림이 섞인다.
            if path.starts_with("shell:") {
                return key.to_string();
            }
            let p = std::path::Path::new(path);
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            let is_dir = p.is_dir();
            if is_dir {
                return format!("I:{size}:\u{0}dir");
            }
            if !PER_FILE_EXTS.contains(&ext.as_str()) {
                return format!("I:{size}:{ext}");
            }
        }
    }
    key.to_string()
}

/// 큰 그림 (IShellItemImageFactory). `icon_only` 면 아이콘, 아니면 미리보기만 — 없으면 None.
/// 2026.11.11 : 미리보기에 THUMBNAILONLY 를 붙였다. 붙이지 않으면 미리보기 처리기가 없는 pdf 에 셸이 아이콘을 대신 줘서,
///   「filedesk 아이콘」을 골라도 격자 보기의 pdf · 영상만 Windows 아이콘으로 남았다.
fn big_image(path: &str, size: i32, icon_only: bool) -> Option<Vec<u8>> {
    let size = size.clamp(16, 256);
    let f: IShellItemImageFactory = unsafe { SHCreateItemFromParsingName(&HSTRING::from(path), None) }.ok()?;
    let flags = if icon_only { SIIGBF_RESIZETOFIT | SIIGBF_ICONONLY } else { SIIGBF_RESIZETOFIT | SIIGBF_THUMBNAILONLY };
    let hbm = unsafe { f.GetImage(SIZE { cx: size, cy: size }, flags) }.ok()?;
    let png = unsafe { bitmap_to_png(hbm) };
    unsafe {
        let _ = DeleteObject(HGDIOBJ(hbm.0));
    }
    png
}

/// 32비트 비트맵 → PNG. 셸 그림은 알파를 곱해 둔 꼴이라 되돌린다. 알파가 하나도 없으면(사진 미리보기) 불투명으로.
unsafe fn bitmap_to_png(hbm: HBITMAP) -> Option<Vec<u8>> {
    let mut bm = BITMAP::default();
    let got = unsafe { GetObjectW(HGDIOBJ(hbm.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _)) };
    if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight);
    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let dc = unsafe { GetDC(None) };
    let lines = unsafe { GetDIBits(dc, hbm, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS) };
    unsafe { ReleaseDC(None, dc) };
    if lines == 0 {
        return None;
    }
    let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
    for p in px.chunks_exact_mut(4) {
        p.swap(0, 2);
        if !has_alpha {
            p[3] = 255;
        } else if p[3] > 0 && p[3] < 255 {
            let a = p[3] as u32;
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(&px).ok()?;
    }
    Some(out)
}

fn extract(key: &str) -> Option<Vec<u8>> {
    let ck = cache_key(key);
    if let Some(v) = icon_cache().lock().unwrap().get(&ck) {
        return Some(v.clone());
    }
    for (prefix, icon_only) in [("i:", true), ("t:", false)] {
        if let Some((size, path)) = key.strip_prefix(prefix).and_then(|r| r.split_once(':')) {
            let png = big_image(path, size.parse().unwrap_or(96), icon_only)?;
            if icon_only {
                icon_cache().lock().unwrap().insert(ck, png.clone());
            }
            return Some(png);
        }
    }
    // 상태 표시(오버레이) 그림만 — 아래 `overlays` 가 준 시스템 그림 목록 번호
    if let Some((size, idx)) = key.strip_prefix("o:").and_then(|r| r.split_once(':')) {
        let png = overlay_png(size.parse().unwrap_or(16), idx.parse().ok()?)?;
        icon_cache().lock().unwrap().insert(key.to_string(), png.clone());
        return Some(png);
    }
    let info = if key == "d" {
        query("folder", FILE_ATTRIBUTE_DIRECTORY, SHGFI_ICON | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES)
    } else if let Some(ext) = key.strip_prefix("e:") {
        let probe = if ext.is_empty() { "file".to_string() } else { format!("x.{ext}") };
        query(&probe, FILE_ATTRIBUTE_NORMAL, SHGFI_ICON | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES)
    } else if let Some(path) = key.strip_prefix("f:") {
        query(path, FILE_FLAGS_AND_ATTRIBUTES(0), SHGFI_ICON | SHGFI_SMALLICON)
    } else {
        None
    }?;
    // 비트맵을 그대로 읽는 길이 빠르지만 아이콘 꼴에 따라 실패한다 (11-11 앱 시험: dll · log). 그때는 직접 그려 읽는다.
    let png = unsafe { icon_to_png(info.hIcon).or_else(|| draw_to_png(info.hIcon)) };
    unsafe {
        let _ = DestroyIcon(info.hIcon);
    }
    let png = png?;
    icon_cache().lock().unwrap().insert(key.to_string(), png.clone());
    Some(png)
}

unsafe fn icon_to_png(icon: HICON) -> Option<Vec<u8>> {
    let mut ii = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut ii) }.ok()?;
    let result = (|| {
        if ii.hbmColor.is_invalid() {
            return None;
        }
        let mut bm = BITMAP::default();
        let got = unsafe {
            GetObjectW(HGDIOBJ(ii.hbmColor.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _))
        };
        if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // 위에서 아래로
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let dc = unsafe { GetDC(None) };
        let lines = unsafe { GetDIBits(dc, ii.hbmColor, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS) };
        unsafe { ReleaseDC(None, dc) };
        if lines == 0 {
            return None;
        }
        // BGRA → RGBA. 알파가 하나도 없으면 옛 아이콘이라 마스크 대신 불투명으로 본다.
        let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
        for p in px.chunks_exact_mut(4) {
            p.swap(0, 2);
            if !has_alpha {
                p[3] = 255;
            }
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().ok()?;
            wr.write_image_data(&px).ok()?;
        }
        Some(out)
    })();
    unsafe {
        if !ii.hbmColor.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
        }
        if !ii.hbmMask.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        }
    }
    result
}

/// 아이콘을 검은 바탕 · 흰 바탕에 한 번씩 그려, 두 그림의 차이로 투명도를 되살린다.
/// 알파가 없는 옛 아이콘 · 마스크 아이콘 · 32비트 아이콘 모두 같은 길로 읽힌다.
unsafe fn draw_to_png(icon: HICON) -> Option<Vec<u8>> {
    let size = unsafe { GetSystemMetrics(SM_CXSMICON) }.max(16);
    let draw = |white: bool| -> Option<Vec<u8>> {
        let bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        unsafe {
            let screen = GetDC(None);
            let dc = CreateCompatibleDC(Some(screen));
            let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
            let bmp = CreateDIBSection(Some(dc), &bi, DIB_RGB_COLORS, &mut bits, None, 0).ok();
            let out = bmp.and_then(|bmp| {
                let old = SelectObject(dc, HGDIOBJ(bmp.0));
                let _ = PatBlt(dc, 0, 0, size, size, if white { WHITENESS } else { BLACKNESS });
                let ok = DrawIconEx(dc, 0, 0, icon, size, size, 0, None, DI_NORMAL).is_ok();
                let px = (ok && !bits.is_null())
                    .then(|| std::slice::from_raw_parts(bits as *const u8, (size * size * 4) as usize).to_vec());
                SelectObject(dc, old);
                let _ = DeleteObject(HGDIOBJ(bmp.0));
                px
            });
            let _ = DeleteDC(dc);
            ReleaseDC(None, screen);
            out
        }
    };
    let black = draw(false)?;
    let white = draw(true)?;
    let mut rgba = vec![0u8; black.len()];
    for i in (0..black.len()).step_by(4) {
        // 흰 바탕 - 검은 바탕 = 255 - 알파 (어느 채널로 봐도 같다)
        let a = 255 - (white[i + 1] as i32 - black[i + 1] as i32).clamp(0, 255);
        rgba[i + 3] = a as u8;
        if a > 0 {
            for (c, src) in [(0usize, 2usize), (1, 1), (2, 0)] {
                rgba[i + c] = ((black[i + src] as i32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, size as u32, size as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(&rgba).ok()?;
    }
    Some(out)
}

// ───────── 상태 표시 (오버레이) ─────────
//
// 2026.11.17 : TortoiseSVN 의 고침 · 충돌 표시, OneDrive 의 동기화 표시처럼 탐색기가 아이콘 위에 겹쳐 그리는 그림.
//   사용자 요청 — SVN 작업복사본을 이 앱으로 열면 어느 파일을 고쳤는지 보이지 않았다.
//   탐색기와 같은 길로 묻는다: 폴더의 IShellIconOverlay 가 등록된 표시 처리기(TortoiseSVN 등)에게 물어
//   시스템 그림 목록 번호를 준다. 그 그림만 따로 뽑아(`o:<크기>:<번호>`) 화면이 아이콘 위에 얹는다 —
//   아이콘과 합쳐 뽑으면 확장자마다 한 장이던 아이콘 기억이 파일마다 한 장이 되어 큰 폴더가 느려진다.

/// `dir` 안 `names` 마다 상태 표시 그림 번호. 없으면 -1. 표시 처리기를 부르므로 STA 스레드에서 부른다.
pub fn overlays(dir: &str, names: &[String]) -> Vec<i32> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{BHID_SFObject, IShellFolder, IShellIconOverlay, IShellItem};
    use windows::core::{Interface, PCWSTR};

    let none = || vec![-1; names.len()];
    let Ok(item): windows::core::Result<IShellItem> = (unsafe { SHCreateItemFromParsingName(&HSTRING::from(dir), None) }) else {
        return none();
    };
    let Ok(folder) = (unsafe { item.BindToHandler::<_, IShellFolder>(None, &BHID_SFObject) }) else {
        return none();
    };
    let Ok(ov) = folder.cast::<IShellIconOverlay>() else {
        return none();
    };
    names
        .iter()
        .map(|n| unsafe {
            let w = HSTRING::from(n.as_str());
            let mut pidl: *mut ITEMIDLIST = std::ptr::null_mut();
            if folder.ParseDisplayName(windows::Win32::Foundation::HWND::default(), None, PCWSTR(w.as_ptr()), None, &mut pidl, std::ptr::null_mut()).is_err() || pidl.is_null() {
                return -1;
            }
            // 표시가 없으면 S_FALSE 로 돌아와 번호가 그대로 남는다 — 0 으로 두고 0 이면 없음
            let mut index = 0i32;
            let mut icon = -1i32;
            if ov.GetOverlayIndex(pidl, &mut index).is_ok() && index > 0 {
                let mut i = 0i32;
                if ov.GetOverlayIconIndex(pidl, &mut i).is_ok() && i > 0 {
                    icon = i;
                }
            }
            CoTaskMemFree(Some(pidl as *const _));
            icon
        })
        .collect()
}

/// 시스템 그림 목록의 `index` 번 그림 (상태 표시는 투명 바탕에 귀퉁이 작은 그림이다).
fn overlay_png(size: i32, index: i32) -> Option<Vec<u8>> {
    use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
    use windows::Win32::UI::Shell::SHGetImageList;
    // SHIL_SMALL(16) · SHIL_LARGE(32) · SHIL_EXTRALARGE(48) · SHIL_JUMBO(256)
    let list = match size {
        ..=16 => 1,
        ..=32 => 0,
        ..=48 => 2,
        _ => 4,
    };
    let il: IImageList = unsafe { SHGetImageList(list) }.ok()?;
    let icon = unsafe { il.GetIcon(index, ILD_TRANSPARENT.0) }.ok()?;
    let png = unsafe { icon_to_png(icon).or_else(|| draw_to_png(icon)) };
    unsafe {
        let _ = DestroyIcon(icon);
    }
    png
}

