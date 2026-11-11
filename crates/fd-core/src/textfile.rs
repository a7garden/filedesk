//! 앱 안 편집기가 여는 글 파일 — 읽은 꼴(글자 인코딩 · 줄끝) 그대로 다시 쓴다.
//!
//! 목차
//! 1. 다루는 확장자 · 상한
//! 2. 읽기 — UTF-8(BOM 있고 없고) · UTF-16(BOM) · 안 되면 CP949, 줄끝은 LF 로 고쳐 넘긴다
//! 3. 쓰기 — 읽을 때의 인코딩 · 줄끝으로 되돌리고, 그사이 밖에서 바뀌었으면 쓰지 않는다.
//!    새 글을 곁의 임시 파일에 먼저 다 쓴 뒤 원본을 덮는다 — 덮다가 멈춰도 온전한 새 글 하나는 남는다
//!
//! 편집기(CodeMirror)는 줄끝을 LF 로만 다룬다. 저장할 때 CRLF 로 되돌리지 않으면
//! 메모장으로 만든 파일을 한 글자만 고쳐도 모든 줄이 바뀐 것으로 보인다.
//! CP949 파일을 UTF-8 로 바꿔 쓰지 않는 것도 같은 까닭이다 — 그 파일을 읽는 다른 프로그램이 깨진다.

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

// ───────────────────────── 1. 다루는 확장자 · 상한 ─────────────────────────

/// 앱 안에서 여는 글 파일 (화면 `viewable.ts` 의 TEXT_EXTS 와 같아야 한다).
pub const EXTS: &[&str] = &["md", "markdown", "txt", "log"];

/// 이보다 큰 글은 열지 않는다 — 편집기가 수십 MB 를 받으면 창이 굳는다. 큰 로그는 기본 앱으로 연다.
pub const MAX_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    /// UTF-8 + BOM (메모장 옛 판 · 엑셀이 만든 파일).
    Utf8bom,
    /// UTF-16 LE + BOM (메모장 「유니코드」).
    Utf16le,
    Utf16be,
    /// 옛 한글 Windows 기본 (EUC-KR 확장).
    Cp949,
}

/// 읽은 글과, 다시 쓸 때 되돌릴 꼴.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextFile {
    /// 줄끝을 LF 로 고친 글.
    pub text: String,
    pub encoding: Encoding,
    /// 줄끝이 CRLF 인가.
    pub crlf: bool,
    /// 줄끝이 섞였거나(CRLF 와 LF) 홀로 쓴 CR 이 있다 — 고쳐 쓰면 줄끝이 한 가지로 바뀌므로 읽기만 한다.
    /// 2026.11.11 : 처음에는 첫 줄끝을 따라 모두 바꿔 썼다. 한 글자만 고쳐도 다른 줄이 바뀌어 리뷰에서 막았다.
    pub mixed: bool,
    /// 읽을 때의 수정 시각 (ms) — 쓰기 전에 밖에서 바뀌었는지 본다.
    pub modified: i64,
}

fn modified_ms(path: &Path) -> std::io::Result<i64> {
    let t = std::fs::metadata(path)?.modified()?;
    Ok(t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0))
}

// ───────────────────────── 2. 읽기 ─────────────────────────

pub fn read(path: &Path) -> Result<TextFile, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err(format!("{}MB 가 넘는 텍스트 파일은 앱 안에서 열지 않는다", MAX_BYTES / 1024 / 1024));
    }
    // 고친 때를 읽기 앞뒤로 재어 같을 때만 받는다 — 읽은 뒤에만 재면, 그사이 다른 프로그램이 쓴 새 시각이 옛 글에 붙어
    // 다음 자동 저장이 「밖에서 안 바뀌었다」로 보고 그 변경을 덮는다. 계속 바뀌면 세 번 만에 그만둔다.
    let mut tries = 0;
    let (bytes, modified) = loop {
        let before = modified_ms(path).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        let after = modified_ms(path).map_err(|e| e.to_string())?;
        if before == after {
            break (bytes, after);
        }
        tries += 1;
        if tries >= 3 {
            return Err("파일이 계속 바뀌고 있어 읽지 못했다 — 잠시 뒤 다시 연다".into());
        }
    };
    let (text, encoding) = decode(&bytes)?;
    let (crlf, mixed) = line_ends(&text);
    Ok(TextFile { text: text.replace("\r\n", "\n"), encoding, crlf, mixed, modified })
}

/// (CRLF 인가, 섞였나). 줄끝이 없으면 LF 로 본다.
fn line_ends(text: &str) -> (bool, bool) {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    let cr = text.matches('\r').count();
    (crlf > 0, (crlf > 0 && crlf != lf) || cr != crlf)
}

fn decode(bytes: &[u8]) -> Result<(String, Encoding), String> {
    if let Some((enc, bom)) = encoding_rs::Encoding::for_bom(bytes) {
        let kind = if enc == encoding_rs::UTF_8 {
            Encoding::Utf8bom
        } else if enc == encoding_rs::UTF_16LE {
            Encoding::Utf16le
        } else {
            Encoding::Utf16be
        };
        return Ok((enc.decode_without_bom_handling(&bytes[bom..]).0.into_owned(), kind));
    }
    // BOM 없는 UTF-16 · 그림 같은 이진 파일은 NUL 이 섞인다. 글로 열어 고쳐 쓰면 파일이 망가진다.
    if bytes.iter().take(64 * 1024).any(|&b| b == 0) {
        return Err("텍스트 파일이 아니다 (바이너리 파일)".into());
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => Ok((s.to_owned(), Encoding::Utf8)),
        Err(_) => {
            let (s, _, bad) = encoding_rs::EUC_KR.decode(bytes);
            if bad {
                return Err("글자 인코딩을 알 수 없다 (UTF-8 · CP949 가 아니다)".into());
            }
            Ok((s.into_owned(), Encoding::Cp949))
        }
    }
}

// ───────────────────────── 3. 쓰기 ─────────────────────────

/// `text`(LF) 를 `encoding` · `crlf` 꼴로 쓴다. 파일 수정 시각이 `expected` 와 다르면 쓰지 않는다 —
/// 편집기를 연 사이 다른 프로그램이 고친 것을 덮어쓰지 않게. 돌려주는 값은 쓴 뒤의 수정 시각.
pub fn write(path: &Path, text: &str, encoding: Encoding, crlf: bool, expected: i64) -> Result<i64, String> {
    let now = modified_ms(path).map_err(|e| e.to_string())?;
    if now != expected {
        return Err("changed".into());
    }
    let text = if crlf { text.replace("\r\n", "\n").replace('\n', "\r\n") } else { text.to_owned() };
    let bytes = encode(&text, encoding)?;
    replace_in_place(path, &bytes)?;
    modified_ms(path).map_err(|e| e.to_string())
}

/// 곁의 임시 파일(`~이름.filedesk-saving`)에 먼저 다 쓰고 디스크에 내린 뒤, 원본을 제자리에서 덮는다.
/// 임시 파일로 바꿔치기(rename)하지 않는 것은 원본의 정체를 지키려는 것이다 — 만든 날짜 · 권한 · 하드 링크가 그대로다.
/// 디스크가 차면 임시 파일에서 멈춰 원본은 그대로고, 원본을 덮다가 멈추면 임시 파일에 온전한 새 글이 남는다 (알림에 경로를 준다).
/// 2026.11.11 : 처음에는 std::fs::write 로 바로 덮었다 — 쓰다 멈추면 원본이 잘린 채 남아 리뷰에서 바꿨다.
fn replace_in_place(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!("~{name}.filedesk-saving"));
    let staged = std::fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    if let Err(e) = staged {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("저장할 자리를 만들지 못했다 — {e}"));
    }
    // 여는 데서 실패하면(읽기 전용 · 다른 프로그램이 잠금) 원본은 손대지 않은 것이니 임시 파일을 치운다
    let mut out = match std::fs::OpenOptions::new().write(true).truncate(true).open(path) {
        Ok(f) => f,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.to_string());
        }
    };
    if let Err(e) = out.write_all(bytes).and_then(|_| out.sync_all()) {
        return Err(format!("원본을 덮다가 멈췄다 ({e}) — 고친 내용은 {} 에 온전히 남아 있다", tmp.display()));
    }
    drop(out);
    let _ = std::fs::remove_file(&tmp);
    Ok(())
}

fn encode(text: &str, encoding: Encoding) -> Result<Vec<u8>, String> {
    Ok(match encoding {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        Encoding::Utf16le => [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(u16::to_le_bytes)).collect(),
        Encoding::Utf16be => [0xFE, 0xFF].into_iter().chain(text.encode_utf16().flat_map(u16::to_be_bytes)).collect(),
        Encoding::Cp949 => {
            let (b, _, bad) = encoding_rs::EUC_KR.encode(text);
            // 이모지 같은 글자는 CP949 에 없다. 몰래 「&#…;」로 바꿔 쓰지 않고 알린다.
            if bad {
                return Err("CP949 파일에 담을 수 없는 글자가 있다 (이모지 · 옛 한글 등)".into());
            }
            b.into_owned()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("fd-textfile-test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn keeps_crlf_and_cp949() {
        let (src, _, _) = encoding_rs::EUC_KR.encode("가나\r\n다라\r\n");
        let p = tmp("cp949.txt", &src);
        let f = read(&p).unwrap();
        assert_eq!(f.text, "가나\n다라\n");
        assert_eq!(f.encoding, Encoding::Cp949);
        assert!(f.crlf);
        write(&p, "가나\n마바\n", f.encoding, f.crlf, f.modified).unwrap();
        let (want, _, _) = encoding_rs::EUC_KR.encode("가나\r\n마바\r\n");
        assert_eq!(std::fs::read(&p).unwrap(), want.into_owned());
    }

    #[test]
    fn keeps_bom() {
        let p = tmp("bom.md", "\u{feff}# 제목\n".as_bytes());
        let f = read(&p).unwrap();
        assert_eq!((f.text.as_str(), f.encoding, f.crlf), ("# 제목\n", Encoding::Utf8bom, false));
        write(&p, "# 새 제목\n", f.encoding, f.crlf, f.modified).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), "\u{feff}# 새 제목\n".as_bytes());
    }

    #[test]
    fn mixed_line_ends() {
        assert_eq!(line_ends("a\r\nb\r\n"), (true, false));
        assert_eq!(line_ends("a\nb\n"), (false, false));
        assert_eq!(line_ends("a"), (false, false));
        assert_eq!(line_ends("a\r\nb\n"), (true, true));
        assert_eq!(line_ends("a\rb\n"), (false, true));
        assert!(read(&tmp("mixed.txt", b"a\r\nb\n")).unwrap().mixed);
    }

    #[test]
    fn keeps_original_and_no_temp_when_locked() {
        let p = tmp("locked.txt", b"old\n");
        let f = read(&p).unwrap();
        let mut perm = std::fs::metadata(&p).unwrap().permissions();
        perm.set_readonly(true);
        std::fs::set_permissions(&p, perm.clone()).unwrap();
        assert!(write(&p, "new\n", f.encoding, f.crlf, f.modified).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), b"old\n");
        let tmp_path = p.with_file_name("~locked.txt.filedesk-saving");
        assert!(!tmp_path.exists());
        #[allow(clippy::permissions_set_readonly_false)]
        perm.set_readonly(false);
        std::fs::set_permissions(&p, perm).unwrap();
        let f = read(&p).unwrap();
        write(&p, "new\n", f.encoding, f.crlf, f.modified).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"new\n");
        assert!(!tmp_path.exists());
    }

    #[test]
    fn refuses_stale_and_binary() {
        let p = tmp("stale.txt", b"a\n");
        let f = read(&p).unwrap();
        assert_eq!(write(&p, "b\n", f.encoding, f.crlf, f.modified - 1000).unwrap_err(), "changed");
        assert!(read(&tmp("bin.txt", b"\x89PNG\0\0")).is_err());
        assert!(encode("😀", Encoding::Cp949).is_err());
    }
}
