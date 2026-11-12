//! 결과 · 본문 색인에서 뺄 자리.
//!
//! - 다른 Windows 계정의 사용자 폴더 — 관리자 서비스는 모든 이름을 보지만, 화면에는 이 사용자 몫만 보인다.
//! - 훑지 않는 폴더(`fd_core::search::skip_dir` — node_modules · .git · Windows …) — 그 자리 훑기와 결과가 같게.
//! - 사용자가 설정에서 뺀 폴더.
//! - 본문 색인은 여기에 더해 프로그램 폴더(Program Files · ProgramData · AppData)를 뺀다 — 설치 프로그램에 딸려 온 설명서 pdf 수천 개.

use crate::{is_under, norm};

#[derive(Debug, Clone, Default)]
pub struct Scope {
    /// 이 사용자의 프로필 폴더 (`norm` 꼴, `c:\users\me`). 없으면 다른 계정 폴더를 가리지 않는다.
    pub profile: Option<String>,
    /// 사용자가 뺀 폴더 (`norm` 꼴).
    pub exclude: Vec<String>,
}

impl Scope {
    pub fn new(profile: Option<&str>, exclude: &[String]) -> Self {
        Scope { profile: profile.filter(|p| !p.is_empty()).map(norm), exclude: exclude.iter().map(|x| norm(x)).filter(|x| !x.is_empty()).collect() }
    }

    /// 이 사용자 환경(`USERPROFILE`)으로.
    pub fn for_current_user(exclude: &[String]) -> Self {
        Scope::new(std::env::var("USERPROFILE").ok().as_deref(), exclude)
    }

    /// 다른 계정의 사용자 폴더인가 (`c:\users\남\…`). 이 사용자 · Public 은 아니다.
    pub fn other_user(&self, p: &str) -> bool {
        let Some(profile) = &self.profile else { return false };
        let Some(i) = profile.rfind('\\') else { return false };
        let users = &profile[..=i]; // c:\users\
        let own = &profile[i + 1..];
        let Some(rest) = p.strip_prefix(users) else { return false };
        let first = rest.split('\\').next().unwrap_or("");
        !first.is_empty() && first != own && first != "public"
    }

    /// 결과에서 뺄 자리인가. `p` 는 `norm` 꼴.
    pub fn hidden(&self, p: &str) -> bool {
        self.other_user(p) || self.exclude.iter().any(|x| is_under(p, x)) || p.split('\\').skip(1).any(fd_core::search::skip_dir)
    }

    /// 본문 색인에서 뺄 자리인가. `p` 는 `norm` 꼴.
    pub fn no_content(&self, p: &str) -> bool {
        if self.hidden(p) {
            return true;
        }
        let mut comps = p.split('\\');
        let _drive = comps.next();
        let top = comps.next().unwrap_or("");
        matches!(top, "windows" | "program files" | "program files (x86)" | "programdata" | "$recycle.bin" | "system volume information" | "recovery")
            || p.split('\\').any(|c| c == "appdata")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hides_other_accounts_and_program_folders() {
        let s = Scope::new(Some(r"C:\Users\Me"), &[r"D:\temp".to_string()]);
        assert!(s.other_user(r"c:\users\you\desktop\a.pdf"));
        assert!(!s.other_user(r"c:\users\me\desktop\a.pdf"));
        assert!(!s.other_user(r"c:\users\public\a.pdf"));
        assert!(s.hidden(r"d:\temp\x.txt"));
        assert!(s.hidden(r"d:\work\node_modules\x.js"));
        assert!(!s.hidden(r"d:\work\x.js"));
        assert!(s.no_content(r"c:\program files\app\manual.pdf"));
        assert!(s.no_content(r"c:\users\me\appdata\local\x.pdf"));
        assert!(!s.no_content(r"c:\users\me\documents\x.pdf"));
    }
}
