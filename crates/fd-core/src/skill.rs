//! Claude Code 스킬 — 에이전트가 `fd` 명령줄로 파일을 다루게 하는 안내서.
//!
//! 본문의 정본은 저장소의 `skills/filedesk/SKILL.md` 다. 실행 파일에 넣어 두고, 설치할 때 `{{FD}}` 를 이 PC 의 fd.exe 경로로 바꾼다.
//! 앱(설정 창 「Claude 스킬」)과 명령줄(`fd skill install`)이 같은 함수로 설치한다 — 앱을 새 판으로 올린 뒤 다시 설치하면
//! 명령과 설명이 늘 같은 판이다.

use std::path::{Path, PathBuf};

const SKILL: &str = include_str!("../../../skills/filedesk/SKILL.md");

/// 설치할 본문. `fd` 는 fd.exe 경로.
pub fn render(fd: &Path) -> String {
    SKILL.replace("{{FD}}", &fd.to_string_lossy().replace('\\', "/")).replace("{{VERSION}}", env!("CARGO_PKG_VERSION"))
}

/// 기본 설치 자리 — `~/.claude/skills/filedesk/SKILL.md`.
pub fn default_file() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude").join("skills").join("filedesk").join("SKILL.md"))
}

/// 설치된 스킬의 판 (`filedesk 0.1.2` 꼴 머리에서 읽는다). 없으면 None.
pub fn installed_version(file: &Path) -> Option<String> {
    let s = std::fs::read_to_string(file).ok()?;
    // 「filedesk 」 뒤에 숫자가 오는 첫 자리 — 제목(`# filedesk — …`)처럼 판이 아닌 곳은 건너뛴다.
    s.match_indices("filedesk ").find_map(|(i, m)| {
        let v: String = s[i + m.len()..].chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        (!v.is_empty()).then_some(v)
    })
}

/// 켤 때 다시 쓸 것인가 — 이미 깐 스킬의 판이 이 판과 다르거나, 본문에 이 fd.exe 경로가 없을 때만.
/// 2026.11.11 리뷰 : 본문이 조금이라도 다르면 켤 때마다 덮어써서, 사람이 고친 스킬이 사라졌다. 같은 판 · 같은 경로면 손대지 않는다.
pub fn needs_refresh(file: &Path, fd: &Path) -> bool {
    let Ok(now) = std::fs::read_to_string(file) else { return false };
    let path = fd.to_string_lossy().replace('\\', "/");
    installed_version(file).as_deref() != Some(env!("CARGO_PKG_VERSION")) || !now.contains(&path)
}

/// 설치한다. 돌려주는 값은 바꿔 쓴 것인지(이미 있었는지).
pub fn install(file: &Path, fd: &Path) -> Result<bool, String> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    let had = file.exists();
    std::fs::write(file, render(fd)).map_err(|e| format!("{}: {e}", file.display()))?;
    Ok(had)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_path_and_version() {
        let s = render(Path::new(r"C:\Users\a\AppData\Local\filedesk\fd.exe"));
        assert!(s.contains("FD=\"C:/Users/a/AppData/Local/filedesk/fd.exe\""));
        assert!(!s.contains("{{"));
        let f = std::env::temp_dir().join(format!("fd-skill-{}", std::process::id())).join("SKILL.md");
        assert!(!install(&f, Path::new("fd.exe")).unwrap());
        assert_eq!(installed_version(&f).as_deref(), Some(env!("CARGO_PKG_VERSION")));
        // 같은 판 · 같은 경로면 사람이 고친 것을 두고, 경로가 바뀌면 다시 쓴다.
        std::fs::write(&f, render(Path::new("fd.exe")) + "\n내가 더한 줄\n").unwrap();
        assert!(!needs_refresh(&f, Path::new("fd.exe")));
        assert!(needs_refresh(&f, Path::new(r"C:\other\fd.exe")));
        let _ = std::fs::remove_dir_all(f.parent().unwrap());
    }
}
