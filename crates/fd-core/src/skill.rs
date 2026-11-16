//! 에이전트 스킬 — 에이전트가 `fd` 명령줄로 파일을 다루고 찾게 하는 안내서.
//!
//! 본문의 정본은 저장소의 `skills/filedesk/SKILL.md` 다. 실행 파일에 넣어 두고, 설치할 때 `{{FD}}` 를 이 PC 의 fd.exe 경로로 바꾼다.
//! 앱(설정 창 「에이전트 스킬」)과 명령줄(`fd skill install`)이 같은 함수로 설치한다 — 앱을 새 판으로 올린 뒤 다시 설치하면
//! 명령과 설명이 늘 같은 판이다.
//!
//! 2026.11.13 : Claude Code 한 곳 → 이 PC 에 깔린 에이전트를 감지해 고른 곳마다. 본문은 공용 스킬 꼴(Agent Skills ·
//! `<자리>/filedesk/SKILL.md` · 머리말 name · description)이라 어느 에이전트나 그대로 읽는다. 에이전트마다 다른 것은 자리뿐이다.

use std::path::{Path, PathBuf};

use serde::Serialize;

const SKILL: &str = include_str!("../../../skills/filedesk/SKILL.md");

/// 스킬을 읽는 에이전트 하나. 경로는 모두 사용자 폴더 기준.
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    /// 이 폴더가 있으면 깔린 것으로 본다 (에이전트가 처음 켤 때 만든다).
    marker: &'static str,
    /// 스킬 폴더들의 자리.
    dir: &'static str,
}

/// 2026.11.13 : 이 PC 에서 확인한 것은 claude · codex · copilot 이다. gemini · cursor · opencode 는 각 도구의 문서대로 넣었다 (실기 미확인).
/// codex 는 공용 자리 `~/.agents/skills` 를 읽는다 — 옛 자리 `~/.codex/skills` 에도 쓰면 같은 스킬이 두 번 뜬다.
pub const AGENTS: &[Agent] = &[
    Agent { id: "claude",   name: "Claude Code",    marker: ".claude",          dir: ".claude/skills" },
    Agent { id: "codex",    name: "Codex",          marker: ".codex",           dir: ".agents/skills" },
    Agent { id: "copilot",  name: "GitHub Copilot", marker: ".copilot",         dir: ".copilot/skills" },
    Agent { id: "gemini",   name: "Gemini CLI",     marker: ".gemini",          dir: ".gemini/skills" },
    Agent { id: "cursor",   name: "Cursor",         marker: ".cursor",          dir: ".cursor/skills" },
    Agent { id: "opencode", name: "OpenCode",       marker: ".config/opencode", dir: ".config/opencode/skills" },
];

/// 에이전트 하나의 설치 상태 — 앱 설정 · `fd skill agents` 가 그대로 낸다.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub name: String,
    /// 설치 자리 (`…/filedesk/SKILL.md`).
    pub file: PathBuf,
    /// 이 PC 에 깔려 있는가.
    pub detected: bool,
    /// 설치된 스킬의 판. 없으면 설치 안 됨.
    pub installed: Option<String>,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

fn target(home: &Path, a: &Agent) -> Target {
    // 빗금으로 적은 자리를 마디로 이어 Windows 꼴(역빗금)로만 만든다 — 섞인 경로는 사람에게 보이는 자리 · JSON 에서 어색하다.
    let at = |rel: &str| rel.split('/').fold(home.to_path_buf(), |p, c| p.join(c));
    let file = at(a.dir).join("filedesk").join("SKILL.md");
    Target {
        id: a.id.into(),
        name: a.name.into(),
        detected: at(a.marker).is_dir(),
        installed: installed_version(&file),
        file,
    }
}

/// 모든 에이전트의 상태 (감지 못 한 것도 — 화면이 「감지 못 함」으로 보인다).
pub fn targets() -> Vec<Target> {
    let Some(h) = home() else { return Vec::new() };
    AGENTS.iter().map(|a| target(&h, a)).collect()
}

/// 에이전트 id 로 상태를 찾는다.
pub fn find(id: &str) -> Result<Target, String> {
    targets().into_iter().find(|t| t.id == id).ok_or_else(|| {
        let ids: Vec<_> = AGENTS.iter().map(|a| a.id).collect();
        format!("모르는 에이전트: {id} (있는 것: {})", ids.join(" · "))
    })
}

/// 설치할 본문. `fd` 는 fd.exe 경로.
pub fn render(fd: &Path) -> String {
    SKILL.replace("{{FD}}", &fd.to_string_lossy().replace('\\', "/")).replace("{{VERSION}}", env!("CARGO_PKG_VERSION"))
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

/// 뺀다 — 우리가 쓴 SKILL.md 만 지우고, 폴더가 비면 폴더도. 돌려주는 값은 지운 것이 있었는지.
/// 같은 이름의 남의 스킬(머리말 name 이 filedesk 가 아님)이면 손대지 않고 오류를 낸다.
pub fn uninstall(file: &Path) -> Result<bool, String> {
    let Ok(s) = std::fs::read_to_string(file) else { return Ok(false) };
    if !s.lines().any(|l| l.trim() == "name: filedesk") {
        return Err(format!("{}: filedesk 가 쓴 스킬이 아니라 두었다", file.display()));
    }
    std::fs::remove_file(file).map_err(|e| format!("{}: {e}", file.display()))?;
    if let Some(d) = file.parent() {
        let _ = std::fs::remove_dir(d); // 사람이 더 넣은 파일이 있으면 비지 않아 실패한다 — 그대로 둔다
    }
    Ok(true)
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
        assert!(uninstall(&f).unwrap());
        assert!(!f.parent().unwrap().exists());
        assert!(!uninstall(&f).unwrap());
    }

    #[test]
    fn detects_by_marker_and_keeps_foreign_skill() {
        let h = std::env::temp_dir().join(format!("fd-home-{}", std::process::id()));
        std::fs::create_dir_all(h.join(".codex")).unwrap();
        let codex = target(&h, AGENTS.iter().find(|a| a.id == "codex").unwrap());
        assert!(codex.detected);
        assert!(codex.file.ends_with(Path::new(".agents").join("skills").join("filedesk").join("SKILL.md")));
        assert!(!target(&h, &AGENTS[0]).detected);
        // 남의 filedesk 스킬은 지우지 않는다.
        std::fs::create_dir_all(codex.file.parent().unwrap()).unwrap();
        std::fs::write(&codex.file, "---\nname: other\n---\n").unwrap();
        assert!(uninstall(&codex.file).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }
}
