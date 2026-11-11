//! 문서 안의 글 뽑기 — 하위 폴더까지 찾기(`search`)가 이름 · 메모에서 못 찾은 파일의 본문을 본다.
//!
//! 목차
//! 1. 상한 · 다루는 확장자
//! 2. 캐시 — (경로, 수정 시각, 크기) → 글
//! 3. 뽑기 — 확장자별로 가른다
//! 4. zip 문서 (hwpx · docx · pptx · xlsx) — XML 의 `<t>` 글자만
//! 5. pdf — 패닉을 가둔다
//! 6. 글 파일 (txt · md · csv) — UTF-8, 안 되면 CP949
//! 7. 맞춤 · 스니펫
//!
//! 정확한 서식은 버린다. 찾는 말이 들어 있는지와 그 앞뒤 몇 글자만 있으면 된다.
//! 색인은 두지 않는다 — 디스크 색인은 낡는 것을 따로 챙겨야 하고, 찾기 한 번에 다시 보는 파일은 메모리 캐시로 충분하다.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// ───────────────────────── 1. 상한 · 다루는 확장자 ─────────────────────────

/// 통째로 읽는 파일(pdf · 글 파일)은 이보다 크면 열지 않는다 — 큰 pdf 하나가 찾기 시간 예산을 혼자 다 쓴다.
/// zip 문서(hwpx · docx · pptx · xlsx)에는 걸지 않는다 — 크기는 거의 그림이고 글 XML 만 골라 푸니 크기와 시간이 상관없다.
/// 2026.11.11 : 실제 산출물 폴더의 pptx 87개 중 48개가 화면 캡처로 50MB 를 넘어, 처음처럼 모두에 걸면 절반을 못 찾았다.
pub const MAX_FILE: u64 = 50 * 1024 * 1024;
/// 뽑은 글은 여기서 자른다 — 캐시가 파일 몇 개로 가득 차지 않게.
pub const MAX_TEXT: usize = 2 * 1024 * 1024;
/// zip 안 XML 한 개를 풀어 읽는 상한 — 압축 폭탄(작은 파일이 수 GB 로 풀림)에 메모리를 다 쓰지 않게.
const MAX_XML: u64 = 64 * 1024 * 1024;
/// 캐시 전체 글 크기 상한.
const MAX_CACHE: usize = 64 * 1024 * 1024;

/// 본문을 뽑는 확장자. 옛 hwp(바이너리 복합 문서)는 아직 없다.
pub const EXTS: &[&str] = &["hwpx", "docx", "pptx", "xlsx", "xlsm", "pdf", "txt", "md", "csv"];

/// 이 확장자(소문자)의 본문을 뽑는가.
pub fn searchable(ext: &str) -> bool {
    EXTS.contains(&ext)
}

/// 이 확장자 · 크기의 파일을 열어 볼 만한가 (`MAX_FILE` 은 통째로 읽는 것에만).
pub fn worth(ext: &str, size: u64) -> bool {
    searchable(ext) && (size <= MAX_FILE || matches!(ext, "hwpx" | "docx" | "pptx" | "xlsx" | "xlsm"))
}

// ───────────────────────── 2. 캐시 ─────────────────────────

/// 경로 → (수정 시각, 크기, 글). 못 뽑은 파일(None)도 담는다 — 깨진 pdf 를 칠 때마다 다시 열지 않게.
struct Cache {
    map: HashMap<PathBuf, (i64, u64, Option<Arc<str>>)>,
    bytes: usize,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

/// 캐시를 거쳐 뽑는다. 화면은 글자를 칠 때마다 같은 폴더를 다시 찾으므로 두 번째부터는 파일을 열지 않는다.
/// 수정 시각이나 크기가 다르면 새로 뽑는다.
pub fn cached(path: &Path, modified: i64, size: u64) -> Option<Arc<str>> {
    if let Ok(g) = CACHE.lock()
        && let Some((m, s, t)) = g.as_ref().and_then(|c| c.map.get(path))
        && *m == modified
        && *s == size
    {
        return t.clone();
    }
    // 뽑는 동안은 잠그지 않는다 — 큰 pdf 하나가 다른 찾기를 막지 않게.
    let text: Option<Arc<str>> = extract(path).map(Arc::from);
    if let Ok(mut g) = CACHE.lock() {
        let c = g.get_or_insert_with(|| Cache { map: HashMap::new(), bytes: 0 });
        let n = text.as_ref().map_or(0, |t| t.len());
        if c.bytes + n > MAX_CACHE {
            // 오래된 것부터 고르지 않고 통째로 비운다 — 찾기 한 번이 다시 채우고, 순서 기록을 두는 것보다 단순하다.
            c.map.clear();
            c.bytes = 0;
        }
        if let Some((_, _, Some(old))) = c.map.insert(path.to_path_buf(), (modified, size, text.clone())) {
            c.bytes -= old.len();
        }
        c.bytes += n;
    }
    text
}

// ───────────────────────── 3. 뽑기 ─────────────────────────

/// 파일 본문의 글. 다루지 않는 확장자 · 너무 큰 파일 · 깨진 파일 · 글이 없는 파일은 None.
pub fn extract(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    if !worth(&ext, std::fs::metadata(path).ok()?.len()) {
        return None;
    }
    let mut text = match ext.as_str() {
        "hwpx" => zip_text(path, |n| numbered(n, "Contents/section", ".xml"))?,
        "docx" => zip_text(path, |n| (n == "word/document.xml").then_some(0))?,
        "pptx" => zip_text(path, |n| numbered(n, "ppt/slides/slide", ".xml"))?,
        // 공유 글(sharedStrings)이 먼저, 시트 안에 바로 적힌 글(inline)이 뒤에.
        "xlsx" | "xlsm" => zip_text(path, |n| if n == "xl/sharedStrings.xml" { Some(0) } else { numbered(n, "xl/worksheets/sheet", ".xml").map(|i| i + 1) })?,
        "pdf" => pdf_text(path)?,
        _ => plain_text(path)?,
    };
    if text.len() > MAX_TEXT {
        let mut end = MAX_TEXT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    (!text.trim().is_empty()).then_some(text)
}

/// `prefix<번호>suffix` 꼴 이름의 번호. section10 이 section2 뒤에 오도록 글자가 아니라 번호로 늘어놓는다.
fn numbered(name: &str, prefix: &str, suffix: &str) -> Option<u64> {
    name.strip_prefix(prefix)?.strip_suffix(suffix)?.parse().ok()
}

// ───────────────────────── 4. zip 문서 ─────────────────────────

/// zip 안에서 `pick` 이 번호를 주는 XML 을 번호 순서로 읽어 글자를 잇는다.
fn zip_text(path: &Path, pick: impl Fn(&str) -> Option<u64>) -> Option<String> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
    let mut parts: Vec<(u64, String)> = zip.file_names().filter_map(|n| n.ok()).filter_map(|n| pick(&n).map(|i| (i, n.into_owned()))).collect();
    parts.sort();
    let mut out = String::new();
    for (_, name) in parts {
        let Ok(f) = zip.by_name(&name) else { continue };
        let mut xml = String::new();
        if f.take(MAX_XML).read_to_string(&mut xml).is_err() {
            continue; // 한 조각이 깨져도 나머지 글은 살린다
        }
        xml_text(&xml, &mut out);
        if out.len() >= MAX_TEXT {
            break;
        }
    }
    Some(out)
}

/// XML 에서 `<t>`(이름공간 무관 — `w:t` · `a:t` · `hp:t` · 엑셀 `t`) 안의 글자만 잇는다.
///
/// 태그를 그냥 다 걷으면 필드 코드 · 지운 글(`w:delText`) · 셀 숫자 값까지 섞인다. 반대로 태그마다 빈칸을 넣으면
/// 한 낱말이 서식 조각(run) 둘로 갈린 「산림|재난」이 「산림 재난」이 되어 못 찾는다 — 그래서 문단 끝에서만 줄을 바꾼다.
fn xml_text(xml: &str, out: &mut String) {
    let mut in_t = 0usize;
    let mut rest = xml;
    while let Some(lt) = rest.find('<') {
        if in_t > 0 {
            unescape(&rest[..lt], out);
        }
        let after = &rest[lt + 1..];
        let Some(gt) = after.find('>') else { break };
        let tag = &after[..gt];
        rest = &after[gt + 1..];
        if tag.starts_with('?') || tag.starts_with('!') {
            continue;
        }
        let closing = tag.starts_with('/');
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
        let local = name.rsplit(':').next().unwrap_or(name);
        match local {
            "t" if closing => in_t = in_t.saturating_sub(1),
            "t" if !tag.ends_with('/') => in_t += 1,
            "tab" | "br" | "cr" | "lineBreak" => push_sep(out, ' '),
            // 문단 · 엑셀 공유 글 · 셀 · 행 · 표 칸이 끝나면 줄을 바꾼다 — 옆 칸 글자가 붙어 없는 말이 맞지 않게.
            "p" | "si" | "c" | "row" | "tc" if closing => push_sep(out, '\n'),
            _ => {}
        }
    }
}

fn push_sep(out: &mut String, sep: char) {
    if !out.is_empty() && !out.ends_with(char::is_whitespace) {
        out.push(sep);
    }
}

/// XML 글자 참조를 푼다 (`&amp;` · `&#44032;` …). 모르는 꼴은 그대로 둔다.
fn unescape(s: &str, out: &mut String) {
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let Some(semi) = after.find(';').filter(|&i| i <= 10) else {
            out.push('&');
            rest = after;
            continue;
        };
        let ent = &after[..semi];
        let ch = match ent {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => ent
                .strip_prefix("#x")
                .or_else(|| ent.strip_prefix("#X"))
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &after[semi + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
}

// ───────────────────────── 5. pdf ─────────────────────────

thread_local! {
    /// 이 스레드가 pdf 를 읽는 중이다 — 그동안 난 패닉은 알리지 않는다.
    static IN_PDF: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// pdf 크레이트는 이상한 파일에서 패닉이 잦다. `catch_unwind` 로 가두어 None 으로 바꾼다.
/// 기본 패닉 알림은 표준 오류에 찍혀 `fd` 의 「실패면 표준 오류에 JSON 한 줄」 약속을 어지럽히므로, pdf 를 읽는 동안만 끈다.
fn pdf_text(path: &Path) -> Option<String> {
    static HOOK: std::sync::Once = std::sync::Once::new();
    HOOK.call_once(|| {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !IN_PDF.with(|f| f.get()) {
                prev(info);
            }
        }));
    });
    let buf = std::fs::read(path).ok()?;
    IN_PDF.with(|f| f.set(true));
    let r = std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(&buf));
    IN_PDF.with(|f| f.set(false));
    r.ok()?.ok()
}

// ───────────────────────── 6. 글 파일 ─────────────────────────

/// UTF-8(BOM 무관) · UTF-16(BOM 있을 때)로 읽고, 둘 다 아니면 CP949 로 본다 — 옛 한글 메모장 · 엑셀 csv 는 대개 CP949 다.
fn plain_text(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if let Some((enc, bom)) = encoding_rs::Encoding::for_bom(&bytes) {
        return Some(enc.decode_without_bom_handling(&bytes[bom..]).0.into_owned());
    }
    match String::from_utf8(bytes) {
        Ok(s) => Some(s),
        Err(e) => Some(encoding_rs::EUC_KR.decode_without_bom_handling(e.as_bytes()).0.into_owned()),
    }
}

// ───────────────────────── 7. 맞춤 · 스니펫 ─────────────────────────

/// 스니펫에서 맞은 말 앞뒤로 보일 글자 수.
const AROUND: usize = 40;

/// `terms`(소문자)가 `text` 에 다 들어 있으면 첫 말 앞뒤 `AROUND` 글자를 한 줄로 돌려준다. 하나라도 없으면 None.
pub fn snippet(text: &str, terms: &[String]) -> Option<String> {
    let lower = text.to_lowercase();
    if terms.is_empty() || !terms.iter().all(|t| lower.contains(t.as_str())) {
        return None;
    }
    let pos = lower.find(terms[0].as_str())?;
    let end = pos + terms[0].len();
    // 소문자로 바꿔도 길이가 같으면(한글 · 영문은 거의 늘 그렇다) 원문에서 자른다. 아니면 위치가 어긋나니 소문자 글에서 자른다.
    let base = if lower.len() == text.len() && text.is_char_boundary(pos) && text.is_char_boundary(end) { text } else { lower.as_str() };
    let start = base[..pos].char_indices().rev().nth(AROUND - 1).map_or(0, |(i, _)| i);
    let stop = base[end..].char_indices().nth(AROUND).map_or(base.len(), |(i, _)| end + i);
    let body = base[start..stop].split_whitespace().collect::<Vec<_>>().join(" ");
    Some(format!("{}{}{}", if start > 0 { "…" } else { "" }, body, if stop < base.len() { "…" } else { "" }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    /// 작은 zip 문서를 코드로 만든다 — 시험 자료 파일을 저장소에 두지 않으려고.
    pub(crate) fn write_zip(path: &Path, parts: &[(&str, &str)]) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in parts {
            z.start_file(*name, opt).unwrap();
            z.write_all(body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn xml_keeps_split_runs_and_drops_noise() {
        let mut out = String::new();
        xml_text(r#"<w:p><w:r><w:t>산림</w:t></w:r><w:r><w:t xml:space="preserve">재난 &amp; 예방</w:t></w:r><w:delText>지운글</w:delText></w:p><w:p><w:r><w:t>다음&#44032;</w:t></w:r></w:p>"#, &mut out);
        assert_eq!(out.trim_end(), "산림재난 & 예방\n다음가");
    }

    #[test]
    fn extracts_office_and_text() {
        let d = std::env::temp_dir().join(format!("fd-text-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        write_zip(&d.join("a.hwpx"), &[("Contents/section1.xml", "<hp:p><hp:run><hp:t>둘째</hp:t></hp:run></hp:p>"), ("Contents/section0.xml", "<hp:p><hp:run><hp:t>첫째<hp:tab/>쪽</hp:t></hp:run></hp:p>"), ("Contents/header.xml", "<hp:t>머리</hp:t>")]);
        assert_eq!(extract(&d.join("a.hwpx")).unwrap().trim_end(), "첫째 쪽\n둘째");
        write_zip(&d.join("b.xlsx"), &[("xl/sharedStrings.xml", "<sst><si><t>공유</t></si></sst>"), ("xl/worksheets/sheet1.xml", r#"<c t="n"><v>42</v></c><c t="inlineStr"><is><t>바로</t></is></c>"#)]);
        assert_eq!(extract(&d.join("b.xlsx")).unwrap().trim_end(), "공유\n바로");
        let (cp949, _, _) = encoding_rs::EUC_KR.encode("옛 메모장 글");
        std::fs::write(d.join("c.txt"), &cp949).unwrap();
        assert_eq!(extract(&d.join("c.txt")).unwrap(), "옛 메모장 글");
        std::fs::write(d.join("broken.pdf"), b"%PDF-1.4 not really").unwrap();
        assert_eq!(extract(&d.join("broken.pdf")), None); // 패닉 없이 None
        std::fs::write(d.join("broken.docx"), b"not a zip").unwrap();
        assert_eq!(extract(&d.join("broken.docx")), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn snippet_around_first_term() {
        let text = format!("{}산림재난\n대응 계획{}", "가".repeat(50), "나".repeat(50));
        let s = snippet(&text, &["산림재난".into(), "계획".into()]).unwrap();
        assert!(s.starts_with('…') && s.ends_with('…'));
        assert!(s.contains("산림재난 대응 계획"));
        assert_eq!(snippet(&text, &["없는말".into()]), None);
        assert_eq!(snippet("Forest FIRE", &["fire".into()]).unwrap(), "Forest FIRE");
    }
}
