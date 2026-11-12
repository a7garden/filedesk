//! NTFS 볼륨을 직접 읽는다 — MFT 로 표를 몇 초 만에 채우고, USN 저널로 바뀐 것을 따라간다. 관리자 권한이 든다.
//!
//! 목차
//!   1. 볼륨 열기 · 부트 섹터 · 섹터 맞춰 읽기
//!   2. MFT 레코드 풀기 — fixup · $STANDARD_INFORMATION · $FILE_NAME · $DATA
//!   3. 데이터 런 — $MFT 가 디스크 어디에 흩어져 있는지
//!   4. MFT 통째로 읽기 → 표
//!   5. USN 저널 — 지난 자리부터 읽고, 바뀐 레코드만 다시 푼다
//!
//! 읽기만 한다. 볼륨에 아무것도 쓰지 않는다. 파일 내용(`$DATA` 의 값)은 보지 않고 크기만 본다.
//! 2026.11.12 : 처음 씀. `$MFT` 자신의 데이터가 확장 레코드로 넘친(속성 목록이 있는) 볼륨은 아직 다루지 않는다 — 그런 볼륨은 훑기로 채운다.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io;
use std::os::windows::fs::{FileExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;

use fd_index::table::{Method, Node, Volume};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::IO::DeviceIoControl;

const FSCTL_QUERY_USN_JOURNAL: u32 = 0x0009_00F4;
const FSCTL_READ_USN_JOURNAL: u32 = 0x0009_00BB;
const ERROR_JOURNAL_NOT_ACTIVE: i32 = 1179;
const ERROR_JOURNAL_ENTRY_DELETED: i32 = 1181;
const ROOT_RECORD: u64 = 5;
/// 이 아래 번호는 NTFS 자신의 파일($MFT · $LogFile …) — 뿌리(5)만 남긴다.
const FIRST_USER_RECORD: u64 = 24;
const USN_REASON_FILE_DELETE: u32 = 0x0000_0200;

// ───────────────────────── 1. 볼륨 ─────────────────────────

pub struct NtfsVol {
    file: File,
    /// `C:\`
    pub root: String,
    sector: u64,
    cluster: u64,
    record_size: u64,
    /// $MFT 데이터 런 — (LCN, 클러스터 수).
    runs: Vec<(u64, u64)>,
}

impl NtfsVol {
    /// `C:\` 를 연다. NTFS 가 아니면 Err.
    pub fn open(root: &str) -> io::Result<NtfsVol> {
        let letter = root.chars().next().filter(|c| c.is_ascii_alphabetic()).ok_or_else(|| io::Error::other("드라이브 문자가 없다"))?;
        // FILE_SHARE_READ | FILE_SHARE_WRITE — 볼륨을 쓰는 다른 프로그램을 막지 않는다.
        let file = std::fs::OpenOptions::new().read(true).share_mode(0x1 | 0x2).open(format!(r"\\.\{letter}:"))?;
        let mut boot = [0u8; 512];
        file.seek_read(&mut boot, 0)?;
        if &boot[3..11] != b"NTFS    " {
            return Err(io::Error::other("NTFS 가 아니다"));
        }
        let sector = u16::from_le_bytes([boot[0x0B], boot[0x0C]]) as u64;
        let cluster = sector * boot[0x0D] as u64;
        let mft_lcn = u64::from_le_bytes(boot[0x30..0x38].try_into().unwrap());
        let cpr = boot[0x40] as i8;
        let record_size = if cpr < 0 { 1u64 << (-cpr as u32) } else { cpr as u64 * cluster };
        if sector == 0 || cluster == 0 || record_size == 0 || record_size > 64 * 1024 {
            return Err(io::Error::other("부트 섹터를 읽지 못했다"));
        }
        // 레코드 0 을 읽을 동안만 쓰는 가짜 런 — $MFT 의 앞머리는 늘 이어져 있다.
        let mut v = NtfsVol { file, root: format!("{}:\\", letter.to_ascii_uppercase()), sector, cluster, record_size, runs: vec![(mft_lcn, 16)] };
        v.load_runs()?;
        Ok(v)
    }

    /// 섹터에 맞춰 읽는다 — 볼륨 손잡이는 섹터 단위로만 읽힌다.
    fn read_disk(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        let start = offset / self.sector * self.sector;
        let end = (offset + len as u64).div_ceil(self.sector) * self.sector;
        let mut buf = vec![0u8; (end - start) as usize];
        let mut got = 0;
        while got < buf.len() {
            let n = self.file.seek_read(&mut buf[got..], start + got as u64)?;
            if n == 0 {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "볼륨 끝"));
            }
            got += n;
        }
        let skip = (offset - start) as usize;
        Ok(buf[skip..skip + len].to_vec())
    }

    /// MFT 안 바이트 위치 → 디스크 위치.
    fn disk_offset(&self, mft_off: u64) -> Option<u64> {
        let mut vcn = 0u64;
        let c = mft_off / self.cluster;
        for &(lcn, len) in &self.runs {
            if c < vcn + len {
                return Some((lcn + (c - vcn)) * self.cluster + mft_off % self.cluster);
            }
            vcn += len;
        }
        None
    }

    /// 레코드 수 (데이터 런이 덮는 만큼).
    pub fn record_count(&self) -> u64 {
        self.runs.iter().map(|r| r.1).sum::<u64>() * self.cluster / self.record_size
    }

    /// 레코드 하나를 읽어 fixup 까지.
    fn read_record(&self, number: u64) -> io::Result<Option<Vec<u8>>> {
        let off = number * self.record_size;
        // 레코드가 클러스터보다 크면 두 런에 걸칠 수 있다 — 클러스터마다 따로 찾는다.
        let mut rec = Vec::with_capacity(self.record_size as usize);
        let mut done = 0u64;
        while done < self.record_size {
            let Some(d) = self.disk_offset(off + done) else { return Ok(None) };
            let take = (self.cluster - (off + done) % self.cluster).min(self.record_size - done);
            rec.extend(self.read_disk(d, take as usize)?);
            done += take;
        }
        Ok(fixup(&mut rec, self.sector).then_some(rec))
    }

    /// 레코드 0($MFT)의 이름 없는 $DATA 에서 데이터 런을 읽는다.
    fn load_runs(&mut self) -> io::Result<()> {
        let rec = self.read_record(0)?.ok_or_else(|| io::Error::other("$MFT 레코드를 읽지 못했다"))?;
        let runs = attrs(&rec).find_map(|a| (a.kind == 0x80 && a.name_len == 0 && a.non_resident).then(|| decode_runs(&rec[a.start..a.end], a.runlist)).flatten());
        match runs {
            Some(r) if !r.is_empty() => {
                self.runs = r;
                Ok(())
            }
            _ => Err(io::Error::other("$MFT 데이터 런을 풀지 못했다")),
        }
    }
}

// ───────────────────────── 2. 레코드 풀기 ─────────────────────────

/// 레코드 끝 두 바이트(섹터마다)를 업데이트 시퀀스 배열 값으로 되돌린다. 맞지 않으면(찢어진 레코드) 거짓.
fn fixup(rec: &mut [u8], sector: u64) -> bool {
    if rec.len() < 48 || &rec[0..4] != b"FILE" {
        return false;
    }
    let usa_off = u16::from_le_bytes([rec[4], rec[5]]) as usize;
    let usa_count = u16::from_le_bytes([rec[6], rec[7]]) as usize;
    // 업데이트 시퀀스는 늘 512 바이트마다다 (섹터 크기와 상관없이).
    let _ = sector;
    let stride = 512usize;
    if usa_count == 0 || usa_off + usa_count * 2 > rec.len() {
        return false;
    }
    let usn = [rec[usa_off], rec[usa_off + 1]];
    for i in 1..usa_count {
        let end = i * stride;
        if end > rec.len() {
            break;
        }
        if rec[end - 2..end] != usn {
            return false;
        }
        rec[end - 2] = rec[usa_off + i * 2];
        rec[end - 1] = rec[usa_off + i * 2 + 1];
    }
    true
}

struct Attr {
    kind: u32,
    non_resident: bool,
    name_len: u8,
    start: usize,
    end: usize,
    /// 상주: 값 위치 · 길이. 비상주: 런 목록 위치(속성 안 상대)와 시작 VCN · 데이터 크기.
    value_off: usize,
    value_len: usize,
    runlist: usize,
    start_vcn: u64,
    data_size: u64,
}

fn le16(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn le32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn le64(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}

/// 레코드의 속성들. 망가진 길이를 만나면 거기서 멈춘다.
fn attrs(rec: &[u8]) -> impl Iterator<Item = Attr> + '_ {
    let used = (le32(rec, 0x18) as usize).min(rec.len());
    let mut at = le16(rec, 0x14) as usize;
    std::iter::from_fn(move || {
        if at + 16 > used {
            return None;
        }
        let kind = le32(rec, at);
        if kind == 0xFFFF_FFFF {
            return None;
        }
        let len = le32(rec, at + 4) as usize;
        if len < 16 || at + len > used {
            return None;
        }
        let non_resident = rec[at + 8] != 0;
        let a = if non_resident {
            if len < 0x40 {
                return None;
            }
            Attr {
                kind,
                non_resident,
                name_len: rec[at + 9],
                start: at,
                end: at + len,
                value_off: 0,
                value_len: 0,
                runlist: le16(rec, at + 0x20) as usize,
                start_vcn: le64(rec, at + 0x10),
                data_size: le64(rec, at + 0x30),
            }
        } else {
            let vlen = le32(rec, at + 0x10) as usize;
            let voff = le16(rec, at + 0x14) as usize;
            if voff + vlen > len {
                return None;
            }
            Attr { kind, non_resident, name_len: rec[at + 9], start: at, end: at + len, value_off: at + voff, value_len: vlen, runlist: 0, start_vcn: 0, data_size: vlen as u64 }
        };
        at += len;
        Some(a)
    })
}

/// FILETIME(1601 부터 100ns) → 유닉스 밀리초.
fn filetime_ms(ft: u64) -> i64 {
    (ft / 10_000) as i64 - 11_644_473_600_000
}

/// 풀어 낸 레코드.
#[derive(Debug, Default, Clone)]
pub struct Rec {
    pub number: u64,
    /// 확장 레코드면 기본 레코드 번호. 기본이면 0.
    pub base: u64,
    pub in_use: bool,
    pub is_dir: bool,
    /// (상위 번호, 이름 공간, 이름). 이름 공간 2 는 8.3 짧은 이름.
    pub names: Vec<(u64, u8, String)>,
    pub size: Option<u64>,
    /// (만든 때, 고친 때, 특성)
    pub si: Option<(i64, i64, u32)>,
}

impl Rec {
    /// 사람이 보는 이름 — 짧은 이름(8.3)은 다른 이름이 없을 때만.
    pub fn best_name(&self) -> Option<&(u64, u8, String)> {
        self.names.iter().find(|n| n.1 != 2).or_else(|| self.names.first())
    }
}

pub fn parse_record(rec: &[u8], number: u64) -> Rec {
    let flags = le16(rec, 0x16);
    let mut r = Rec { number, base: le64(rec, 0x20) & 0x0000_FFFF_FFFF_FFFF, in_use: flags & 0x1 != 0, is_dir: flags & 0x2 != 0, ..Default::default() };
    for a in attrs(rec) {
        match a.kind {
            0x10 if !a.non_resident && a.value_len >= 0x24 => {
                let v = &rec[a.value_off..a.value_off + a.value_len];
                r.si = Some((filetime_ms(le64(v, 0)), filetime_ms(le64(v, 8)), le32(v, 0x20)));
            }
            0x30 if !a.non_resident && a.value_len >= 0x42 => {
                let v = &rec[a.value_off..a.value_off + a.value_len];
                let n = v[0x40] as usize;
                if 0x42 + n * 2 <= v.len() {
                    let units: Vec<u16> = (0..n).map(|i| le16(v, 0x42 + i * 2)).collect();
                    r.names.push((le64(v, 0) & 0x0000_FFFF_FFFF_FFFF, v[0x41], String::from_utf16_lossy(&units)));
                }
            }
            0x80 if a.name_len == 0 => {
                if !a.non_resident || a.start_vcn == 0 {
                    r.size = Some(a.data_size);
                }
            }
            _ => {}
        }
    }
    r
}

// ───────────────────────── 3. 데이터 런 ─────────────────────────

/// 비상주 속성의 런 목록 → (LCN, 클러스터 수). 성긴 런(LCN 없음)은 건너뛴다.
fn decode_runs(attr: &[u8], runlist: usize) -> Option<Vec<(u64, u64)>> {
    let mut out = Vec::new();
    let mut at = runlist;
    let mut lcn: i64 = 0;
    while at < attr.len() {
        let h = attr[at];
        if h == 0 {
            break;
        }
        let ln = (h & 0x0F) as usize;
        let on = (h >> 4) as usize;
        at += 1;
        if ln == 0 || ln > 8 || on > 8 || at + ln + on > attr.len() {
            return None;
        }
        let mut len = 0u64;
        for i in 0..ln {
            len |= (attr[at + i] as u64) << (8 * i);
        }
        at += ln;
        if on == 0 {
            continue; // 성긴 런
        }
        let mut off = 0i64;
        for i in 0..on {
            off |= (attr[at + i] as i64) << (8 * i);
        }
        // 부호 늘이기
        if attr[at + on - 1] & 0x80 != 0 && on < 8 {
            off |= -1i64 << (8 * on);
        }
        at += on;
        lcn += off;
        if lcn < 0 {
            return None;
        }
        out.push((lcn as u64, len));
    }
    Some(out)
}

// ───────────────────────── 4. MFT 통째로 ─────────────────────────

/// 레코드 하나를 표의 항목으로. 쓰지 않는 · 확장 · 시스템 · 이름 없는 레코드는 None.
fn node_of(r: &Rec) -> Option<Node> {
    if !r.in_use || r.base != 0 || (r.number < FIRST_USER_RECORD && r.number != ROOT_RECORD) {
        return None;
    }
    let (parent, _, name) = r.best_name()?;
    let (created, modified, attrs) = r.si.unwrap_or((0, 0, 0));
    let attrs = if r.is_dir { attrs | 0x10 } else { attrs };
    Some(Node::new(r.number, *parent, name, if r.is_dir { 0 } else { r.size.unwrap_or(0) }, modified, created, attrs, r.is_dir))
}

/// MFT 를 통째로 읽어 새 표를 만든다. 확장 레코드에 넘친 이름 · 크기는 끝에 기본 레코드에 붙인다.
pub fn read_all(v: &NtfsVol) -> io::Result<Volume> {
    let mut vol = Volume::new(&v.root, Method::Ntfs);
    // 기본 레코드에 이름이 없던 것(이름이 확장 레코드에만 있다) · 확장 레코드
    let mut nameless: HashMap<u64, Rec> = HashMap::new();
    let mut extra: Vec<Rec> = Vec::new();
    const CHUNK: u64 = 4 * 1024 * 1024;
    let mut mft_off = 0u64;
    for &(lcn, len) in &v.runs {
        let run_bytes = len * v.cluster;
        let mut done = 0u64;
        while done < run_bytes {
            let take = (run_bytes - done).min(CHUNK) / v.record_size * v.record_size;
            if take == 0 {
                break;
            }
            let buf = v.read_disk(lcn * v.cluster + done, take as usize)?;
            for (i, raw) in buf.chunks_exact(v.record_size as usize).enumerate() {
                let number = (mft_off + done) / v.record_size + i as u64;
                let mut rec = raw.to_vec();
                if !fixup(&mut rec, v.sector) {
                    continue;
                }
                let r = parse_record(&rec, number);
                if !r.in_use {
                    continue;
                }
                if r.base != 0 {
                    extra.push(r);
                } else if let Some(n) = node_of(&r) {
                    vol.upsert(n);
                } else if r.names.is_empty() && (r.number >= FIRST_USER_RECORD) {
                    nameless.insert(r.number, r);
                }
            }
            done += take;
        }
        mft_off += run_bytes;
    }
    for x in extra {
        if let Some(mut base) = nameless.remove(&x.base) {
            base.names.extend(x.names.iter().cloned());
            if base.size.is_none() {
                base.size = x.size;
            }
            match node_of(&base) {
                Some(n) => vol.upsert(n),
                None => {
                    nameless.insert(base.number, base);
                }
            }
        } else if let Some(n) = vol.get(x.base).cloned() {
            // 크기가 확장 레코드에 있었다
            if let Some(s) = x.size
                && !n.is_dir
                && n.size == 0
            {
                vol.upsert(Node { size: s, ..n });
            }
        }
    }
    vol.updated = fd_index::now_ms();
    Ok(vol)
}

// ───────────────────────── 5. USN 저널 ─────────────────────────

pub struct Journal {
    pub id: u64,
    pub first: i64,
    pub next: i64,
    pub lowest_valid: i64,
}

fn ioctl(v: &NtfsVol, code: u32, input: &[u8], out: &mut [u8]) -> io::Result<usize> {
    let mut returned = 0u32;
    let h = HANDLE(v.file.as_raw_handle());
    let r = unsafe {
        DeviceIoControl(
            h,
            code,
            if input.is_empty() { None } else { Some(input.as_ptr() as *const _) },
            input.len() as u32,
            Some(out.as_mut_ptr() as *mut _),
            out.len() as u32,
            Some(&mut returned as *mut u32),
            None,
        )
    };
    r.map_err(|e| io::Error::from_raw_os_error((e.code().0 & 0xFFFF) as i32))?;
    Ok(returned as usize)
}

/// 저널 상태. 저널이 꺼져 있으면 Ok(None).
pub fn query_journal(v: &NtfsVol) -> io::Result<Option<Journal>> {
    let mut out = [0u8; 80];
    match ioctl(v, FSCTL_QUERY_USN_JOURNAL, &[], &mut out) {
        Ok(n) if n >= 56 => Ok(Some(Journal { id: le64(&out, 0), first: le64(&out, 8) as i64, next: le64(&out, 16) as i64, lowest_valid: le64(&out, 24) as i64 })),
        Ok(_) => Err(io::Error::other("USN 저널 답이 짧다")),
        Err(e) if e.raw_os_error() == Some(ERROR_JOURNAL_NOT_ACTIVE) => Ok(None),
        Err(e) => Err(e),
    }
}

/// 따라가기 결과.
pub enum Follow {
    /// 맞췄다 — 바뀐 경로들 (지운 것은 지우기 전 경로).
    Changed(Vec<String>),
    /// 저널이 끊겼다(ID 가 바뀌었거나 지난 자리가 지워졌다) — MFT 를 다시 읽어야 한다.
    Lost,
}

/// `vol.next_usn` 부터 저널을 읽어 표를 맞춘다.
pub fn follow(v: &mut NtfsVol, vol: &mut Volume) -> io::Result<Follow> {
    let Some(j) = query_journal(v)? else { return Ok(Follow::Lost) };
    if j.id != vol.journal_id || vol.next_usn < j.lowest_valid {
        return Ok(Follow::Lost);
    }
    let mut changed: HashSet<u64> = HashSet::new();
    let mut deleted: HashSet<u64> = HashSet::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        // READ_USN_JOURNAL_DATA_V0: StartUsn · ReasonMask · ReturnOnlyOnClose · Timeout · BytesToWaitFor · UsnJournalID
        let mut input = Vec::with_capacity(40);
        input.extend_from_slice(&vol.next_usn.to_le_bytes());
        input.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        input.extend_from_slice(&0u32.to_le_bytes());
        input.extend_from_slice(&0u64.to_le_bytes());
        input.extend_from_slice(&0u64.to_le_bytes());
        input.extend_from_slice(&j.id.to_le_bytes());
        let n = match ioctl(v, FSCTL_READ_USN_JOURNAL, &input, &mut buf) {
            Ok(n) => n,
            Err(e) if e.raw_os_error() == Some(ERROR_JOURNAL_ENTRY_DELETED) => return Ok(Follow::Lost),
            Err(e) => return Err(e),
        };
        if n < 8 {
            break;
        }
        let next = le64(&buf, 0) as i64;
        let mut at = 8usize;
        while at + 0x3C <= n {
            let len = le32(&buf, at) as usize;
            if len == 0 || at + len > n {
                break;
            }
            let major = le16(&buf, at + 4);
            if major == 2 {
                let frn = le64(&buf, at + 8) & 0x0000_FFFF_FFFF_FFFF;
                let reason = le32(&buf, at + 0x28);
                if reason & USN_REASON_FILE_DELETE != 0 {
                    deleted.insert(frn);
                    changed.remove(&frn);
                } else {
                    changed.insert(frn);
                    deleted.remove(&frn);
                }
            }
            at += len;
        }
        // 레코드 없이 다음 USN(8 바이트)만 왔으면 다 읽었다.
        let had = n > 8;
        vol.next_usn = next;
        if !had {
            break;
        }
    }
    let mut paths = Vec::new();
    for frn in deleted {
        if let Some(n) = vol.get(frn).cloned() {
            if let Some(p) = vol.path_of(&n) {
                paths.push(p);
            }
            vol.remove(frn);
        }
    }
    // 먼저 다 넣고 나서 경로를 만든다 — 같은 때 새로 생긴 폴더 안의 파일도 경로가 나오게.
    let mut upserted = Vec::new();
    for frn in changed {
        if frn >= v.record_count() {
            v.load_runs()?; // MFT 가 자랐다
        }
        let node = v.read_record(frn)?.map(|rec| parse_record(&rec, frn)).and_then(|r| node_of(&r));
        match node {
            Some(n) => {
                vol.upsert(n);
                upserted.push(frn);
            }
            None => {
                vol.remove(frn);
            }
        }
    }
    for frn in upserted {
        if let Some(p) = vol.get(frn).and_then(|n| vol.path_of(n)) {
            paths.push(p);
        }
    }
    if !paths.is_empty() {
        vol.updated = fd_index::now_ms();
    }
    Ok(Follow::Changed(paths))
}

/// 새 표를 만든 직후 저널 자리를 맞춘다 — 이 뒤로 바뀐 것만 따라간다.
pub fn stamp(v: &NtfsVol, vol: &mut Volume) -> io::Result<bool> {
    match query_journal(v)? {
        Some(j) => {
            vol.journal_id = j.id;
            vol.next_usn = j.next;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1024 바이트 FILE 레코드를 만든다 — 업데이트 시퀀스 · 속성(SI · FN · DATA).
    fn fake_record(parent: u64, name: &str, size: u64, dir: bool) -> Vec<u8> {
        let mut r = vec![0u8; 1024];
        r[0..4].copy_from_slice(b"FILE");
        r[4..6].copy_from_slice(&0x30u16.to_le_bytes()); // USA 위치
        r[6..8].copy_from_slice(&3u16.to_le_bytes()); // USN + 섹터 둘
        r[0x14..0x16].copy_from_slice(&0x38u16.to_le_bytes()); // 첫 속성
        r[0x16..0x18].copy_from_slice(&(if dir { 3u16 } else { 1u16 }).to_le_bytes());
        let mut at = 0x38usize;
        let mut put_resident = |r: &mut Vec<u8>, kind: u32, value: &[u8]| {
            let len = (0x18 + value.len()).div_ceil(8) * 8;
            r[at..at + 4].copy_from_slice(&kind.to_le_bytes());
            r[at + 4..at + 8].copy_from_slice(&(len as u32).to_le_bytes());
            r[at + 0x10..at + 0x14].copy_from_slice(&(value.len() as u32).to_le_bytes());
            r[at + 0x14..at + 0x16].copy_from_slice(&0x18u16.to_le_bytes());
            r[at + 0x18..at + 0x18 + value.len()].copy_from_slice(value);
            at += len;
        };
        let ft = (11_644_473_600_000u64 + 1_000) * 10_000; // 유닉스 1초
        let mut si = vec![0u8; 0x48];
        si[0..8].copy_from_slice(&ft.to_le_bytes());
        si[8..16].copy_from_slice(&ft.to_le_bytes());
        si[0x20..0x24].copy_from_slice(&0x20u32.to_le_bytes());
        put_resident(&mut r, 0x10, &si);
        let units: Vec<u16> = name.encode_utf16().collect();
        let mut fname = vec![0u8; 0x42 + units.len() * 2];
        fname[0..8].copy_from_slice(&parent.to_le_bytes());
        fname[0x40] = units.len() as u8;
        fname[0x41] = 1;
        for (i, u) in units.iter().enumerate() {
            fname[0x42 + i * 2..0x44 + i * 2].copy_from_slice(&u.to_le_bytes());
        }
        put_resident(&mut r, 0x30, &fname);
        if !dir {
            put_resident(&mut r, 0x80, &vec![0u8; size as usize]);
        }
        r[at..at + 4].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        r[0x18..0x1C].copy_from_slice(&((at + 8) as u32).to_le_bytes());
        // 섹터 끝 두 바이트를 USN 으로 바꾸고 원래 값을 배열에 둔다
        let usn = [0x07u8, 0x00];
        r[0x30..0x32].copy_from_slice(&usn);
        for i in 1..3 {
            let end = i * 512;
            let (a, b) = (r[end - 2], r[end - 1]);
            r[0x30 + i * 2] = a;
            r[0x31 + i * 2] = b;
            r[end - 2] = usn[0];
            r[end - 1] = usn[1];
        }
        r
    }

    #[test]
    fn parses_fake_records() {
        let mut rec = fake_record(40, "보고서_v1.pdf", 12, false);
        assert!(fixup(&mut rec, 512));
        let r = parse_record(&rec, 100);
        assert!(r.in_use && !r.is_dir);
        assert_eq!(r.best_name().map(|n| (n.0, n.2.as_str())), Some((40, "보고서_v1.pdf")));
        assert_eq!(r.size, Some(12));
        assert_eq!(r.si.map(|s| s.1), Some(1_000));
        let n = node_of(&r).unwrap();
        assert_eq!((n.key, n.parent, n.size, n.ext()), (100, 40, 12, "pdf"));
        // 시스템 레코드는 빠진다
        assert!(node_of(&parse_record(&rec, 3)).is_none());
        // 찢어진 레코드
        let mut torn = fake_record(40, "x", 1, false);
        torn[510] ^= 0xFF;
        assert!(!fixup(&mut torn, 512));
    }

    #[test]
    fn decodes_runs_with_negative_offsets() {
        // 길이 1바이트 · 위치 2바이트: (0x10 클러스터 @ 0x1000), 그다음 (8 @ -0x800 상대)
        let runs = [0x21u8, 0x10, 0x00, 0x10, 0x21, 0x08, 0x00, 0xF8, 0x00];
        assert_eq!(decode_runs(&runs, 0), Some(vec![(0x1000, 0x10), (0x800, 8)]));
    }
}
