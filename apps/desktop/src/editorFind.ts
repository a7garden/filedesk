// 앱 안 보기 편집기(마크다운 · 글)의 찾기 · 바꾸기 — CodeMirror 찾기 판을 한국어로 · Ctrl+H 로 바꿀 칸부터 · 밖에서 열기.
//
// 2026.11.25 : 사용자 요청 「각 뷰어에서 수정 · 검색 · 치환이 편리하게」. 두 편집기 모두 CodeMirror 찾기 판을 품고 있었지만
//   글자가 영어(Find · Replace · match case …)였고, Ctrl+H 는 앱의 「숨김 파일 보기」로 가서 바꾸기를 바로 열 길이 없었다.
//   편집기 밖(머리 단추를 누른 뒤)에서 Ctrl+F 를 누르면 아무 일도 없었다 — 편집기 창(view)을 받아 두고 Viewer 가 연다.
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { closeSearchPanel, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, SearchQuery, setSearchQuery } from "@codemirror/search";

/** 찾기 판 글자 (@codemirror/search 가 state.phrase 로 묻는 것). */
const PHRASES = {
  Find: "찾을 말",
  Replace: "바꿀 말",
  next: "다음",
  previous: "이전",
  all: "모두 고르기",
  "match case": "대소문자",
  regexp: "정규식",
  "by word": "낱말 단위",
  replace: "바꾸기",
  "replace all": "모두 바꾸기",
  close: "닫기",
  "current match": "지금 찾은 곳",
  "on line": "줄",
  "replaced $ matches": "$곳을 바꿈",
  "replaced match on line $": "$줄을 바꿈",
  "Go to line": "줄로 가기",
  go: "가기",
};

/** 찾기 판을 열고, `replace` 면 바꿀 칸에 초점을 둔다. 읽기 전용이면 바꿀 칸이 없어 찾을 칸에 남는다. */
export function openFind(view: EditorView, replace: boolean) {
  view.focus();
  openSearchPanel(view);
  // 판은 열 때 찾을 칸에 초점을 준다 — 그 뒤에 옮긴다
  requestAnimationFrame(() => {
    dressAtomicPanel(view);
    const box = view.dom.querySelector<HTMLInputElement>(`.cm-search input[name=${replace ? "replace" : "search"}]`);
    box?.focus();
    box?.select();
  });
}

/** 마크다운 편집기(@atomic-editor)의 찾기 판 — 찾기만 있고 글자가 영어다. 판을 바꿔 끼울 수 없어(search 설정의 createPanel 이 겹치면
 *  CodeMirror 가 오류를 낸다) 열린 판에 한국어 글자 · 바꾸기 줄 · Esc 닫기를 덧붙인다. 판이 열릴 때마다 한 번. */
const COUNT_KO = (t: string) => (t === "No matches" ? "없음" : t.replace(/^(\d+\+?) match(es)?$/, "$1곳"));
const BUTTON_KO: Record<string, string> = { "Previous match": "이전 · Shift+Enter", "Next match": "다음 · Enter", Close: "닫기 · Esc" };
function dressAtomicPanel(view: EditorView) {
  const panel = view.dom.querySelector<HTMLElement>(".atomic-editor-search-panel");
  if (!panel || panel.dataset.fd) return;
  panel.dataset.fd = "1";
  panel.setAttribute("aria-label", "찾기");
  const q = panel.querySelector<HTMLInputElement>(".cm-atomic-search-input");
  if (q) {
    q.placeholder = "찾을 말";
    q.setAttribute("aria-label", "찾을 말");
    q.name = "search";
  }
  for (const b of panel.querySelectorAll<HTMLButtonElement>(".cm-atomic-search-btn")) {
    const ko = BUTTON_KO[b.getAttribute("aria-label") ?? ""];
    if (ko) b.setAttribute("aria-label", ko), (b.title = ko);
  }
  const count = panel.querySelector(".cm-atomic-search-count");
  if (count) {
    const fix = () => {
      const t = count.textContent ?? "";
      if (COUNT_KO(t) !== t) count.textContent = COUNT_KO(t);
    };
    fix();
    new MutationObserver(fix).observe(count, { childList: true, characterData: true, subtree: true });
  }
  // 판의 칸은 편집기 글 밖이라 편집기 단축키가 닿지 않는다 — Esc 를 여기서 받지 않으면 보기 전체가 닫혔다
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
      view.focus();
    } else if (e.key === "Enter" && e.shiftKey && (e.target as HTMLElement).getAttribute("name") === "search") {
      e.preventDefault();
      panel.querySelector<HTMLButtonElement>(".cm-atomic-search-btn")?.click();
    }
  });
  if (view.state.readOnly) return;
  const row = document.createElement("div");
  row.className = "fd-replace";
  const input = document.createElement("input");
  input.type = "text";
  input.name = "replace";
  input.className = "cm-atomic-search-input";
  input.placeholder = "바꿀 말";
  input.setAttribute("aria-label", "바꿀 말");
  const run = (all: boolean) => {
    const cur = getSearchQuery(view.state);
    const query = new SearchQuery({ search: cur.search, caseSensitive: cur.caseSensitive, regexp: cur.regexp, wholeWord: cur.wholeWord, replace: input.value });
    view.dispatch({ effects: setSearchQuery.of(query) });
    (all ? replaceAll : replaceNext)(view);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    run(e.ctrlKey);
  });
  const button = (label: string, title: string, all: boolean) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fd-replace-btn";
    b.name = all ? "replaceAll" : "replace";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", () => run(all));
    return b;
  };
  row.append(input, button("바꾸기", "지금 찾은 곳을 바꾸고 다음으로 · Enter", false), button("모두 바꾸기", "Ctrl+Enter", true));
  panel.append(row);
}

/** 편집기에 붙일 것. `own` 이면 찾기 판도 여기서 단다 (마크다운 편집기는 제 판을 이미 단다). `viewRef` 에 지금 편집기 창을 둔다. */
export function findKit(viewRef: { current: EditorView | null }, own: boolean): Extension {
  return [
    EditorState.phrases.of(PHRASES),
    own ? search({ top: true }) : [],
    // 앱의 Ctrl+H(숨김 파일)보다 먼저 받는다 — 편집기가 막으면(preventDefault) 앱은 넘어간다 (App [단축키])
    Prec.highest(keymap.of([{ key: "Mod-h", run: (v) => (openFind(v, true), true) }])),
    ViewPlugin.define((view) => {
      viewRef.current = view;
      return {
        // 편집기 안 Ctrl+F 로 판이 열려도 꾸민다 (판은 이 갱신 뒤에 붙는다)
        update: () => queueMicrotask(() => dressAtomicPanel(view)),
        destroy() {
          if (viewRef.current === view) viewRef.current = null;
        },
      };
    }),
  ];
}
