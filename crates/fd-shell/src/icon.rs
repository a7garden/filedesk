//! 파일 아이콘 · 종류 이름. 셸이 주는 것을 그대로 쓴다 — 탐색기와 같은 그림 · 같은 이름이어야 눈이 헤매지 않는다.
//!
//! 확장자마다 한 번만 묻고 기억한다. exe · lnk · ico 처럼 파일마다 그림이 다른 것만 경로로 묻는다.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BLACKNESS, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS,
    DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW, HGDIOBJ, PatBlt, ReleaseDC, SelectObject, WHITENESS,
};
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES};
use windows::Win32::UI::Shell::{
    SHFILEINFOW, SHGFI_FLAGS, SHGFI_ICON, SHGFI_SMALLICON, SHGFI_TYPENAME, SHGFI_USEFILEATTRIBUTES, SHGetFileInfoW,
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
    if let Some(v) = icon_cache().lock().unwrap().get(key) {
        return Some(v.clone());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    worker().lock().unwrap().send((key.to_string(), tx)).ok()?;
    rx.recv().ok().flatten()
}

type IconJob = (String, std::sync::mpsc::Sender<Option<Vec<u8>>>);

fn worker() -> &'static Mutex<std::sync::mpsc::Sender<IconJob>> {
    static W: OnceLock<Mutex<std::sync::mpsc::Sender<IconJob>>> = OnceLock::new();
    W.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<IconJob>();
        std::thread::Builder::new()
            .name("fd-icon".into())
            .spawn(move || {
                let _com = crate::com::ComGuard::sta();
                for (key, reply) in rx {
                    // 못 그리면 확장자 없는 일반 파일 아이콘으로 (오프라인 NAS · 지워진 바로가기 대상 등).
                    let png = extract(&key).or_else(|| extract("e:"));
                    let _ = reply.send(png);
                }
            })
            .expect("아이콘 스레드");
        Mutex::new(tx)
    })
}

fn extract(key: &str) -> Option<Vec<u8>> {
    if let Some(v) = icon_cache().lock().unwrap().get(key) {
        return Some(v.clone());
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
