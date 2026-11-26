// 글 편집기 — 마크다운(렌더된 채로 고치기)과 글 파일(고정폭). Viewer.tsx 의 [3] · [4] 를 떼어 왔다.
//
// 2026.11.26 : 따로 뗀 까닭 — CodeMirror · 언어 묶음 · 마크다운 편집기가 보기 묶음의 대부분(약 860KB 중 700KB 남짓)이라,
//   그림 · 한글 · 파워포인트를 처음 열 때도 이것을 다 읽고 해석하느라 늦었다. 이제 글 파일을 열 때만 불러온다 (Viewer 의 lazy).
//   앱이 켜진 뒤 한가할 때 미리 불러 두므로(preload.ts) 글 파일을 처음 열 때도 대개 기다리지 않는다.
import { useEffect, useMemo, useRef } from "react";
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

const plainTheme = EditorView.theme({
  "&": { fontSize: "13px", color: "var(--ink)", height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { display: "none" },
});
export function PlainEditor({ value, readOnly, onChange, findRef }: { value: string; readOnly: boolean; onChange: (v: string) => void; findRef: FindRef }) {
  const view = useRef<EditorView | null>(null);
  // 읽기 전용이면 찾기 판의 바꿀 칸도 숨는다 (EditorState.readOnly) — editable 만 끄면 「모두 바꾸기」로 고쳐졌다
  const extensions = useMemo(() => [plainTheme, EditorView.lineWrapping, EditorState.readOnly.of(readOnly), findKit(view, true)], [readOnly]);
  useFindRef(findRef, view);
  return (
    <div className="cm-fd cm-code">
      <CodeMirror
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
