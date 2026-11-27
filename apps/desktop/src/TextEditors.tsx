// 글 편집기 — 마크다운(렌더된 채로 고치기)과 글 파일(고정폭). Viewer.tsx 의 [3] · [4] 를 떼어 왔다.
//
// 2026.11.26 : 따로 뗀 까닭 — CodeMirror · 언어 묶음 · 마크다운 편집기가 보기 묶음의 대부분(약 860KB 중 700KB 남짓)이라,
//   그림 · 한글 · 파워포인트를 처음 열 때도 이것을 다 읽고 해석하느라 늦었다. 이제 글 파일을 열 때만 불러온다 (Viewer 의 lazy).
//   앱이 켜진 뒤 한가할 때 미리 불러 두므로(preload.ts) 글 파일을 처음 열 때도 대개 기다리지 않는다.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { AtomicCodeMirrorEditor } from "@atomic-editor/editor";
import "@atomic-editor/editor/styles.css";
import { findKit, openFind } from "./editorFind";
import { foreignShare, IMAGE_EXTS, localPath, rawUrl, stripHasFocus } from "./viewable";

/** 찾기 · 바꾸기 열기 (Viewer 가 들고 본문이 단다). `replace` 면 바꿀 칸부터. */
type FindRef = React.MutableRefObject<((replace: boolean) => void) | null>;

// ───────── 마크다운 ─────────

/** 편집기가 그린 그림의 주소를 문서 폴더 기준 파일로 바꾼다. 편집기는 `![](그림.png)` 의 주소를 그대로 img 에 넣어
 *  앱 주소(tauri.localhost) 기준으로 찾다 못 그린다. 표 칸의 그림도 같다. */
function fixImages(root: HTMLElement, doc: string) {
  for (const img of root.querySelectorAll<HTMLImageElement>("img:not([data-fd])")) {
    img.dataset.fd = "1";
    const local = localPath(img.getAttribute("src") ?? "", doc);
    // 다른 서버의 그림은 읽지 않는다 — 문서를 열기만 해도 그 서버에 Windows 로그인 정보가 건너간다 (2026.11.11 리뷰)
    if (local && foreignShare(local, doc)) {
      img.removeAttribute("src");
      img.alt = `다른 서버 그림은 표시하지 않음: ${local}`;
    } else if (local && IMAGE_EXTS.has((local.split(".").pop() ?? "").toLowerCase())) img.src = rawUrl(local);
  }
}

/** Ctrl+누르기로 링크를 연다 (옵시디언과 같게). 편집기는 링크 끝의 작은 아이콘을 눌러야만 열고, 글자를 누르면 고치기로 들어간다. */
function ctrlLink(open: React.RefObject<{ onLink: (href: string) => void }>) {
  return EditorView.domEventHandlers({
    mousedown: (e, view) => {
      if (!e.ctrlKey || e.button !== 0) return false;
      const el = (e.target as HTMLElement).closest(".cm-atomic-link");
      if (!el) return false;
      let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(view.state).resolveInner(view.posAtDOM(el), 1);
      while (node && node.name !== "Link" && node.name !== "URL") node = node.parent;
      const url = node?.name === "URL" ? node : node?.getChild("URL");
      if (!url) return false;
      e.preventDefault();
      open.current.onLink(view.state.doc.sliceString(url.from, url.to));
      return true;
    },
  });
}

export function MdEditor({
  doc,
  source,
  readOnly,
  onChange,
  onLink,
  findRef,
}: {
  doc: string;
  source: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  onLink: (href: string) => void;
  findRef: FindRef;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cbs = useRef({ onChange, onLink });
  cbs.current = { onChange, onLink };
  const view = useRef<EditorView | null>(null);
  // 찾기 판은 편집기가 제 것을 단다 (own = false) — 글자 · Ctrl+H 만 더한다
  const extensions = useMemo(() => [ctrlLink(cbs), findKit(view, false)], []);
  useFindRef(findRef, view);
  // 열자마자 굴리기 · 치기가 듣게 — 글 파일 편집기(autoFocus)와 같게. 편집기는 뒤늦게 서므로 설 때까지 몇 박자 기다린다 (2026.11.25)
  useEffect(() => {
    let n = 0;
    let raf = 0;
    const tryFocus = () => {
      if (view.current) return stripHasFocus() || view.current.focus();
      if (++n < 60) raf = requestAnimationFrame(tryFocus);
    };
    raf = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(raf);
  }, [doc]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    fixImages(el, doc);
    // 편집기는 보이는 줄만 그리고 굴릴 때 다시 만든다 — 새로 붙는 그림마다 고친다
    const mo = new MutationObserver(() => fixImages(el, doc));
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [doc]);
  return (
    <div className="md-live" ref={box}>
      <AtomicCodeMirrorEditor
        documentId={doc}
        markdownSource={source}
        readOnly={readOnly}
        codeLanguages={languages}
        extensions={extensions}
        onMarkdownChange={(v) => cbs.current.onChange(v)}
        onLinkClick={(url) => cbs.current.onLink(url)}
      />
    </div>
  );
}

/** 찾기 열기를 Viewer 에 단다 — 편집기 밖에서 누른 Ctrl+F · Ctrl+H 가 이 편집기의 찾기 판을 연다. */
function useFindRef(findRef: FindRef, view: React.RefObject<EditorView | null>) {
  useEffect(() => {
    findRef.current = (replace) => view.current && openFind(view.current, replace);
    return () => {
      findRef.current = null;
    };
  }, [findRef, view]);
}

// ───────── 글 파일 ─────────

/** 이 요소를 품고 굴러가는 가장 가까운 칸 (자기 자신 포함). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

const plainTheme = EditorView.theme({
  "&": { fontSize: "13px", color: "var(--ink)", height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { display: "none" },
});
export function PlainEditor({
  value,
  readOnly,
  onChange,
  findRef,
  follow = false,
}: {
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  findRef: FindRef;
  /** 맨 끝을 따라간다 — 열면 끝에 서고, 끝을 보는 동안 글이 늘면(쓰는 중인 로그를 다시 읽으면) 계속 끝을 보인다.
   *  위로 굴려 읽는 중에는 끌어내리지 않는다. 끝부분만 읽은 큰 파일(Viewer)이 쓴다 (2026.11.27). */
  follow?: boolean;
}) {
  const view = useRef<EditorView | null>(null);
  // 읽기 전용이면 찾기 판의 바꿀 칸도 숨는다 (EditorState.readOnly) — editable 만 끄면 「모두 바꾸기」로 고쳐졌다
  const extensions = useMemo(() => [plainTheme, EditorView.lineWrapping, EditorState.readOnly.of(readOnly), findKit(view, true)], [readOnly]);
  useFindRef(findRef, view);
  const cm = useRef<EditorView | null>(null);
  const atEnd = useRef(true);
  /** 굴러가는 칸과 마지막으로 굴린 자리 — 새 글을 받으면 편집기가 글 전체를 갈아 끼워 맨 위로 돌아가므로 되돌려 놓는다.
   *  굴러가는 칸은 편집기 안(.cm-scroller)이 아니라 그것을 품은 바깥 칸일 수 있다 (Viewer 의 .viewer-pane — 편집기가 글 높이만큼 늘어난다).
   *  그래서 문서 전체의 굴림을 잡는 단계에서 받아, 편집기를 품은 칸의 것만 쓴다. */
  const scroller = useRef<HTMLElement | null>(null);
  const lastTop = useRef(0);
  useEffect(() => {
    if (!follow) return;
    const onScroll = (e: Event) => {
      const s = e.target as HTMLElement;
      if (!(s instanceof HTMLElement) || !cm.current || !s.contains(cm.current.dom)) return;
      scroller.current = s;
      atEnd.current = s.scrollTop + s.clientHeight >= s.scrollHeight - 8;
      lastTop.current = s.scrollTop;
    };
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [follow]);
  const toEnd = () => {
    const v = cm.current;
    if (!v) return;
    const end = v.state.doc.length;
    v.dispatch({ selection: { anchor: end }, effects: EditorView.scrollIntoView(end, { y: "end" }) });
    // 편집기는 안 그린 줄의 높이를 어림해 두어, 끝으로 가도 실제 줄을 재고 나면 바닥에서 조금 떠 있다.
    //   굴러가는 칸을 바닥에 붙이고 높이가 멎을 때까지 몇 장 더 붙인다
    const s = (scroller.current ??= scrollParent(v.dom));
    if (!s) return;
    let n = 0;
    let h = -1;
    const stick = () => {
      if (s.scrollHeight === h || ++n > 8) return;
      h = s.scrollHeight;
      s.scrollTop = h;
      requestAnimationFrame(stick);
    };
    requestAnimationFrame(stick);
  };
  // 편집기가 새 글을 받은 뒤(자식의 효과가 먼저 돈다) 끝으로 — 위로 굴려 읽던 중이면 그 자리로.
  //   읽던 자리는 픽셀로 되돌린다. 끝부분의 시작이 늘어난 만큼 밀려 몇 줄 어긋날 수 있지만, 맨 위로 튀는 것보다 낫다.
  //   자리는 편집기가 글을 갈기 전(레이아웃 효과 · 편집기는 효과에서 간다)에 잡아 둔다 — 갈면서 나는 굴림 소식이 먼저 와 맨 위로 적힐 수 있다
  const before = useRef({ end: true, top: 0 });
  useLayoutEffect(() => {
    before.current = { end: atEnd.current, top: lastTop.current };
  }, [value]);
  useEffect(() => {
    if (!follow) return;
    const { end, top } = before.current;
    requestAnimationFrame(() => {
      atEnd.current = end;
      if (end) toEnd();
      else if (scroller.current) scroller.current.scrollTop = top;
    });
  }, [value, follow]);
  return (
    <div className="cm-fd cm-code">
      <CodeMirror
        onCreateEditor={(v) => {
          cm.current = v;
          if (follow) requestAnimationFrame(toEnd);
        }}
        value={value}
        onChange={onChange}
        extensions={extensions}
        editable={!readOnly}
        autoFocus={!stripHasFocus()}
        height="100%"
        theme="none"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          closeBrackets: false,
          bracketMatching: false,
          indentOnInput: false,
          syntaxHighlighting: false,
        }}
      />
    </div>
  );
}
