//! NTFS 파일 ID — 이름 · 자리가 바뀌어도 같은 파일을 알아본다 (같은 볼륨 안에서). 메모가 앱 밖 옮기기를 따라가는 데 쓴다.

use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::Storage::FileSystem::{BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, GetFileInformationByHandle};

/// `<볼륨 일련번호>-<파일 번호>`. 열 수 없거나 ID 가 없는 드라이브(NAS · FAT)면 None.
/// 내용은 읽지 않는다 — 속성만 묻는 손잡이로 연다 (다른 프로그램이 쓰고 있어도 열린다).
pub fn file_id(path: &str) -> Option<String> {
    let f = std::fs::OpenOptions::new()
        .access_mode(0) // 속성 조회만
        .share_mode(7) // 읽기 · 쓰기 · 지우기 모두 허용
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0) // 폴더도 열리게
        .open(path)
        .ok()?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(f.as_raw_handle()), &mut info) }.ok()?;
    let index = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    (index != 0).then(|| format!("{:08x}-{index:016x}", info.dwVolumeSerialNumber))
}
