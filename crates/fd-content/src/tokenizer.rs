//! 두 글자 조각 — 「산림재난」을 「산림 · 림재 · 재난」으로 담는다.
//!
//! 지금 본문 찾기(`text::snippet`)는 부분 문자열이 들어 있으면 맞다. 낱말 사전으로 나누면 「림재난」 같은 부분 일치를 놓친다.
//! 그래서 글을 소문자로 바꾼 뒤 글자 · 숫자가 이어진 덩어리마다 두 글자씩 겹쳐 담고(한 글자 덩어리는 그대로),
//! 찾을 때도 찾는 말을 같은 방식으로 나눠 「이어진 조각」(구 질의)으로 찾는다. 후보는 저장된 본문으로 한 번 더 확인한다.
//!
//! 조각은 빈칸으로 이어 tantivy 의 기본 토크나이저에 넘긴다 — 조각마다 위치가 하나씩 늘어 구 질의가 그대로 선다.
//! 기본 토크나이저는 글자 · 숫자가 아닌 것에서 끊고 소문자로 바꾸는데, 조각은 이미 그 꼴이라 그대로 지나간다.

/// 덩어리 — 글자 · 숫자가 이어진 것.
fn runs(text: &str) -> impl Iterator<Item = Vec<char>> + '_ {
    let mut chars = text.chars().flat_map(char::to_lowercase).peekable();
    std::iter::from_fn(move || {
        while chars.peek().is_some_and(|c| !c.is_alphanumeric()) {
            chars.next();
        }
        let mut run = Vec::new();
        while let Some(&c) = chars.peek() {
            if !c.is_alphanumeric() {
                break;
            }
            run.push(c);
            chars.next();
        }
        if run.is_empty() { None } else { Some(run) }
    })
}

/// 덩어리 하나의 조각들.
fn grams_of(run: &[char]) -> Vec<String> {
    if run.len() == 1 {
        return vec![run[0].to_string()];
    }
    run.windows(2).map(|w| w.iter().collect()).collect()
}

/// 본문 → 색인에 넣을 조각 글 (빈칸으로 이은 조각들).
pub fn index_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for run in runs(text) {
        for g in grams_of(&run) {
            out.push_str(&g);
            out.push(' ');
        }
    }
    out
}

/// 찾는 말 하나 → 덩어리마다 이어진 조각들. 한 글자 덩어리는 조각이 없어 거르지 못하니 뺀다 (확인 단계가 본다).
/// 하나도 남지 않으면 색인으로 좁힐 수 없다.
pub fn query_runs(term: &str) -> Vec<Vec<String>> {
    runs(term).filter(|r| r.len() >= 2).map(|r| grams_of(&r)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bigrams() {
        assert_eq!(index_text("산림재난 대응"), "산림 림재 재난 대응 ");
        assert_eq!(index_text("Report v1.3"), "re ep po or rt v1 3 ");
        assert_eq!(query_runs("림재난"), vec![vec!["림재".to_string(), "재난".to_string()]]);
        // 한 글자 덩어리는 거르지 못한다
        assert_eq!(query_runs("v1.3"), vec![vec!["v1".to_string()]]);
        assert!(query_runs("가").is_empty());
    }
}
