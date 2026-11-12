//! 표를 디스크에 쓰고 읽기. 켤 때 이것을 읽어 바로 찾게 하고, 그동안 바뀐 것은 USN 저널(NTFS)이나 다시 훑기로 맞춘다.
//!
//! 꼴 (작은 끝): `FDX1` · 판(u32) · 뿌리 · 뿌리 열쇠 · 방법 · 저널 ID · 다음 USN · 맞춘 때 · 다음 열쇠 · 항목 수 · 항목들.
//! 판이 다르거나 끝이 모자라면 버리고 다시 만든다 — 색인은 투영이라 잃는 것이 없다.
//! 쓰다 꺼져도 반쪽 파일이 남지 않게 임시 파일에 다 쓴 뒤 이름을 바꾼다.

use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::table::{Method, Node, Volume};

const MAGIC: &[u8; 4] = b"FDX1";
const VERSION: u32 = 1;

/// 볼륨 뿌리(`C:\`)의 스냅숏 파일 이름 — `c.fdx`.
pub fn file_for(dir: &Path, root: &str) -> PathBuf {
    let letter: String = root.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
    dir.join(format!("{}.fdx", if letter.is_empty() { "vol".into() } else { letter }))
}

pub fn save(v: &Volume, file: &Path) -> io::Result<()> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = file.with_extension("fdx.tmp");
    {
        let mut w = BufWriter::with_capacity(1 << 20, std::fs::File::create(&tmp)?);
        w.write_all(MAGIC)?;
        w.write_all(&VERSION.to_le_bytes())?;
        put_str(&mut w, &v.root)?;
        w.write_all(&v.root_key.to_le_bytes())?;
        w.write_all(&[match v.method {
            Method::Ntfs => 1u8,
            Method::Walk => 2u8,
        }])?;
        w.write_all(&v.journal_id.to_le_bytes())?;
        w.write_all(&v.next_usn.to_le_bytes())?;
        w.write_all(&v.updated.to_le_bytes())?;
        w.write_all(&v.next_key.to_le_bytes())?;
        w.write_all(&(v.len() as u64).to_le_bytes())?;
        for n in v.iter() {
            w.write_all(&n.key.to_le_bytes())?;
            w.write_all(&n.parent.to_le_bytes())?;
            w.write_all(&n.size.to_le_bytes())?;
            w.write_all(&n.modified.to_le_bytes())?;
            w.write_all(&n.created.to_le_bytes())?;
            w.write_all(&n.attrs.to_le_bytes())?;
            w.write_all(&[n.is_dir as u8])?;
            put_str(&mut w, &n.name)?;
        }
        w.flush()?;
    }
    std::fs::rename(&tmp, file)
}

pub fn load(file: &Path) -> io::Result<Volume> {
    let mut r = BufReader::with_capacity(1 << 20, std::fs::File::open(file)?);
    let mut magic = [0u8; 4];
    r.read_exact(&mut magic)?;
    if &magic != MAGIC || u32_of(&mut r)? != VERSION {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "색인 스냅숏 판이 다르다"));
    }
    let root = get_str(&mut r)?;
    let root_key = u64_of(&mut r)?;
    let method = match u8_of(&mut r)? {
        1 => Method::Ntfs,
        2 => Method::Walk,
        _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "색인 스냅숏 방법을 모른다")),
    };
    let mut v = Volume::new(&root, method);
    v.root_key = root_key;
    v.journal_id = u64_of(&mut r)?;
    v.next_usn = u64_of(&mut r)? as i64;
    v.updated = u64_of(&mut r)? as i64;
    v.next_key = u64_of(&mut r)?;
    let count = u64_of(&mut r)?;
    // 고장 난 파일의 엉뚱한 수로 메모리를 잡지 않게 상한을 둔다 — 넘는 만큼은 넣으며 자란다.
    v.reserve(count.min(16_000_000) as usize);
    for _ in 0..count {
        let key = u64_of(&mut r)?;
        let parent = u64_of(&mut r)?;
        let size = u64_of(&mut r)?;
        let modified = u64_of(&mut r)? as i64;
        let created = u64_of(&mut r)? as i64;
        let attrs = u32_of(&mut r)?;
        let is_dir = u8_of(&mut r)? != 0;
        let name = get_str(&mut r)?;
        v.upsert(Node::new(key, parent, &name, size, modified, created, attrs, is_dir));
    }
    Ok(v)
}

fn put_str(w: &mut impl Write, s: &str) -> io::Result<()> {
    let b = s.as_bytes();
    let n = u16::try_from(b.len()).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "이름이 너무 길다"))?;
    w.write_all(&n.to_le_bytes())?;
    w.write_all(b)
}

fn get_str(r: &mut impl Read) -> io::Result<String> {
    let mut n = [0u8; 2];
    r.read_exact(&mut n)?;
    let mut b = vec![0u8; u16::from_le_bytes(n) as usize];
    r.read_exact(&mut b)?;
    String::from_utf8(b).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "이름이 UTF-8 이 아니다"))
}

fn u8_of(r: &mut impl Read) -> io::Result<u8> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

fn u32_of(r: &mut impl Read) -> io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn u64_of(r: &mut impl Read) -> io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_reject_broken() {
        let dir = std::env::temp_dir().join(format!("fd-index-snap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut v = Volume::new("C:\\", Method::Ntfs);
        v.journal_id = 77;
        v.next_usn = 1234;
        v.upsert(Node::new(5, 5, ".", 0, 1, 1, 0x10, true));
        v.upsert(Node::new(40, 5, "보고서_v1.pdf", 99, 10, 20, 0x20, false));
        let f = file_for(&dir, "C:\\");
        assert!(f.ends_with("c.fdx"));
        save(&v, &f).unwrap();
        let back = load(&f).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!((back.journal_id, back.next_usn, back.method), (77, 1234, Method::Ntfs));
        let n = back.get(40).unwrap();
        assert_eq!((&*n.name, n.size, n.modified, n.created), ("보고서_v1.pdf", 99, 10, 20));
        // 잘린 파일은 버린다
        let bytes = std::fs::read(&f).unwrap();
        std::fs::write(&f, &bytes[..bytes.len() - 3]).unwrap();
        assert!(load(&f).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
