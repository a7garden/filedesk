//! 창 없이 돌릴 수 있는 셸 연동 시험. 메뉴 · 끌기는 사람 손이 필요해 여기서 다루지 않는다.
//! 휴지통 시험은 사용자 휴지통을 어지럽혀서 두지 않는다.
#![cfg(windows)]

use std::path::PathBuf;

use fd_shell::ops::{self, Outcome};
use fd_shell::{icon, places, run_sta};

fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("fd-shell-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn type_names_and_icons() {
    run_sta(|| {
        assert!(!icon::type_name("txt", false).is_empty(), "txt 종류 이름");
        assert!(!icon::type_name("", true).is_empty(), "폴더 종류 이름");
        let png = icon::icon_png("e:txt").expect("txt 아이콘");
        assert_eq!(&png[1..4], b"PNG");
        assert!(icon::icon_png("d").is_some(), "폴더 아이콘");
        // 11-11 앱 시험에서 404 가 났던 꼴 · 확장자 없음
        for k in ["e:dll", "e:log", "e:", "e:없는확장자"] {
            assert!(icon::icon_png(k).is_some(), "{k} 아이콘");
        }
    });
}

#[test]
fn places_exist() {
    run_sta(|| {
        let known = places::known_folders();
        assert!(known.iter().any(|p| p.name == "바탕화면"));
        assert!(places::drives().iter().any(|p| p.path == "C:\\"));
        assert_eq!(places::expand_env("%SystemDrive%\\x"), "C:\\x");
    });
}

#[test]
fn rename_and_copy_through_shell() {
    let d = temp_dir("ops");
    let a = d.join("가.txt");
    std::fs::write(&a, b"hello").unwrap();
    let sub = ops::new_folder(d.to_str().unwrap()).unwrap();
    assert!(sub.ends_with("새 폴더"));
    let sub2 = ops::new_folder(d.to_str().unwrap()).unwrap();
    assert!(sub2.ends_with("새 폴더 (2)"));

    let a_s = a.to_string_lossy().into_owned();
    let sub_c = sub.clone();
    let r = run_sta(move || {
        let r1 = ops::rename(0, &a_s, "나.txt").unwrap();
        let b = a_s.replace("가.txt", "나.txt");
        let r2 = ops::transfer(0, &[b], &sub_c, false).unwrap();
        (r1, r2)
    });
    assert_eq!(r, (Outcome::Done, Outcome::Done));
    assert!(d.join("나.txt").is_file(), "이름이 바뀌었다");
    assert_eq!(std::fs::read(PathBuf::from(&sub).join("나.txt")).unwrap(), b"hello", "복사됐다");
    std::fs::remove_dir_all(&d).unwrap();
}

#[test]
fn resolves_shortcut() {
    // 시작 메뉴에 늘 있는 바로가기 하나로 본다. 없으면 건너뛴다.
    let start = PathBuf::from(std::env::var("ProgramData").unwrap()).join(r"Microsoft\Windows\Start Menu\Programs");
    let lnk = walk_first_lnk(&start);
    let Some(lnk) = lnk else { return };
    let target = run_sta(move || ops::resolve_link(lnk.to_str().unwrap()));
    assert!(target.is_some(), "바로가기 대상을 읽는다");
}

fn walk_first_lnk(dir: &std::path::Path) -> Option<PathBuf> {
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.extension().is_some_and(|x| x == "lnk") {
            return Some(p);
        }
        if p.is_dir() {
            if let Some(f) = walk_first_lnk(&p) {
                return Some(f);
            }
        }
    }
    None
}

#[test]
fn new_edition_copies_and_retires() {
    let d = temp_dir("edition");
    let old = d.join("보고_v3_20261110.pptx");
    let old_pdf = d.join("보고_v3_20261110.pdf");
    std::fs::write(&old, b"pptx").unwrap();
    std::fs::write(&old_pdf, b"pdf").unwrap();
    let hist = d.join("이전판");
    let (src, h) = (old.to_string_lossy().into_owned(), hist.to_string_lossy().into_owned());
    let retire = vec![src.clone(), old_pdf.to_string_lossy().into_owned()];
    let r = run_sta(move || ops::new_edition(0, &src, "보고_v4_20261111.pptx", &retire, &h).unwrap());
    assert_eq!(r, Outcome::Done);
    assert_eq!(std::fs::read(d.join("보고_v4_20261111.pptx")).unwrap(), b"pptx", "새 판");
    assert!(hist.join("보고_v3_20261110.pptx").is_file() && hist.join("보고_v3_20261110.pdf").is_file(), "지난 판은 이전판으로");
    assert!(!old.exists());
    std::fs::remove_dir_all(&d).unwrap();
}

/// 파일 ID 는 이름을 바꿔도 같다 — 메모가 앱 밖 이름 바꾸기 · 옮기기를 따라가는 근거.
#[test]
fn file_id_survives_rename() {
    let dir = std::env::temp_dir().join(format!("fd-fileid-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let a = dir.join("가.txt");
    let b = dir.join("나.txt");
    std::fs::write(&a, b"x").unwrap();
    let before = fd_shell::fileid::file_id(&a.to_string_lossy()).expect("NTFS 임시 폴더");
    std::fs::rename(&a, &b).unwrap();
    assert_eq!(fd_shell::fileid::file_id(&b.to_string_lossy()).as_deref(), Some(before.as_str()));
    assert!(fd_shell::fileid::file_id(&dir.to_string_lossy()).is_some(), "폴더도");
    std::fs::remove_dir_all(&dir).ok();
}
