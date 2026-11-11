// 앱 안 보기 — 목록 자리를 덮고 파일 하나를 연다. 닫으면(Esc · 마우스 뒤로) 그 줄로 돌아간다.
//
// 목차
//   [1] 틀 — 머리(이름 · 꼴 · 상태 · 기본 앱으로 · 닫기) · 단축키
//   [2] 글 — 불러오기 · 멈추면 저장 · 밖에서 바뀐 것
//   [3] 마크다운 — 옵시디언처럼 렌더된 채로 고친다 (@atomic-editor/editor · oxb 편집기의 바탕). 그림 · 링크는 문서 폴더 기준
//   [4] 글 파일(txt · log) — 기호를 그리지 않는 고정폭 편집기
//   [5] 그림 — 맞춤 ↔ 원래 크기 · ←/→ 같은 폴더의 그림
//
// 2026.11.11 : 처음 만들었다. 저장 단추를 두지 않고 입력이 멈추면 쓴다(docket 메모와 같게) — Ctrl+S 는 바로 쓴다.
// 읽은 인코딩 · 줄끝 그대로 쓰고(fd-core textfile), 연 사이 밖에서 바뀌었으면 덮지 않고 묻는다.
// 2026.11.11 : 마크다운의 보기 · 편집 · 나란히 세 갈래를 걷었다 — 사용자 요청. 보는 화면이 곧 고치는 화면이다 (커서가 있는 줄만 기호가 드러난다).
// 2026.11.11 : 문서 속 웹 그림(https)은 그린다 (tauri.conf.json CSP img-src) — 옵시디언과 같다. 받은 문서를 열기만 해도
//   그 서버에 요청이 가지만, 이 앱에서 여는 md 는 대개 내 노트 · README 라 그림이 비는 쪽이 더 불편하다고 보았다.
import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import { AtomicCodeMirrorEditor } from "@atomic-editor/editor";
import "@atomic-editor/editor/styles.css";
import { api, type Entry } from "./api";
import { errText, formatBytes, parentOf } from "./util";
import { ENCODING_LABEL, foreignShare, IMAGE_EXTS, localPath, MD_EXTS, rawUrl, runnable, textApi, viewKind, type TextFile } from "./viewable";

/** 여는 파일. 목록 밖(마크다운 링크로 간 파일)도 열 수 있어 Entry 전체를 받지 않는다. */
export type ViewTarget = Pick<Entry, "path" | "name" | "ext" | "modified"> & { size?: number };

type Props = {
  target: ViewTarget;
  /** 지금 폴더의 줄 (그림 ←/→ 차례). */
  siblings: Entry[];
  /** 목록에 보이는 이 파일의 수정 시각 — 밖에서 고치면 바뀐다. 목록 밖 파일이면 undefined. */
  liveModified?: number;
  /** 키보드를 받는 칸인가. */
  active: boolean;
  onPick: (t: ViewTarget) => void;
  onClose: () => void;
  /** 목록이 보기를 닫기 전에 묻는 자리 — 남은 글을 쓰고, 겹침을 묻는 중이면 false. */
  guardRef?: React.MutableRefObject<() => Promise<boolean>>;
};

const targetOf = (path: string): ViewTarget => {
  const name = path.split("\\").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return { path, name, ext: dot > 0 ? name.slice(dot + 1).toLowerCase() : "", modified: 0 };
};

// ───────── [1] 틀 ─────────

export default function Viewer(p: Props) {
  const kind = viewKind(p.target.ext);
  const isMd = MD_EXTS.has(p.target.ext.toLowerCase());
  /** 머리 가운데 칸 — 글은 인코딩 · 저장 상태, 그림은 크기 · 차례. 아래 본문이 채운다. */
  const [info, setInfo] = useState<React.ReactNode>(null);
  /** 열기 실패 같은 알림. 칸의 알림 줄(.msg)은 이 보기 밑에 깔려 보이지 않아 여기서 띄운다. 2026.11.11 리뷰에서 고쳤다. */
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [p.target.path]);
  const fail = (e: unknown) => setNote(errText(e));
  /** 남은 글을 쓰고 떠나도 되는가 — 밖에서 바뀐 것을 묻는 중이면 false (고친 글이 버려진다). */
  const flush = useRef<() => Promise<boolean>>(async () => true);
  if (p.guardRef) p.guardRef.current = () => flush.current();
  // 닫힌 뒤에는 묻지 않는다 — 남은 처리기가 닫힌 보기의 저장을 다시 부르지 않게.
  const guardRef = p.guardRef;
  useEffect(
    () => () => {
      if (guardRef) guardRef.current = async () => true;
    },
    [guardRef],
  );

  const close = () =>
    void flush.current().then((ok) => (ok ? p.onClose() : setNote("다른 곳에서 고친 것과 겹친다 — 아래에서 다시 읽을지 덮어쓸지 먼저 고른다")));
  const external = () => void flush.current().then(() => api.openItem(p.target.path).catch(fail));

  /** 마크다운 속 링크 — 웹 주소는 브라우저로, 앱 안에서 볼 파일은 여기서, 나머지는 기본 앱으로. */
  const openLink = (href: string) => {
    if (/^https?:/i.test(href)) return void textApi.openUrl(href).catch(fail);
    const path = localPath(href, p.target.path);
    if (!path) return;
    // 실행되는 파일 · 다른 서버의 경로는 링크로 열지 않는다 — 받은 문서 하나로 프로그램이 돌거나 로그인 정보가 남의 서버로 가지 않게 (2026.11.11 리뷰)
    if (runnable(path)) return setNote(`실행 파일 링크는 열지 않는다 — 필요하면 목록에서 직접 연다: ${path}`);
    if (foreignShare(path, p.target.path)) return setNote(`다른 서버의 경로는 링크로 열지 않는다 — 필요하면 주소 줄에 넣어 연다: ${path}`);
    if (viewKind(path.split(".").pop() ?? ""))
      void flush.current().then((ok) => (ok ? p.onPick(targetOf(path)) : setNote("다른 곳에서 고친 것과 겹친다 — 먼저 다시 읽을지 덮어쓸지 고른다")));
    else api.openItem(path).catch(fail);
  };

  useEffect(() => {
    if (!p.active) return;
    // 편집기의 떠 있는 것(표 칸 메뉴 · 자동 완성)이 있을 때의 Esc 는 그것만 닫는다. 표 메뉴는 Esc 를 받고도 막지 않아(preventDefault)
    // 아래 처리기까지 오고, 그때는 이미 메뉴가 사라져 있으므로 잡는 단계에서 미리 본다 (2026.11.11 리뷰)
    let popup = false;
    const onKeyFirst = (e: KeyboardEvent) => {
      popup = e.key === "Escape" && !!document.querySelector(".cm-atomic-table-menu, .cm-tooltip-autocomplete");
    };
    const onKey = (e: KeyboardEvent) => {
      // 편집기 찾기 칸의 Esc 같은 것은 편집기가 먼저 받는다
      if (e.defaultPrevented || popup) return;
      const lk = e.key.toLowerCase();
      if (e.key === "Escape") {
        e.preventDefault();
        if (note) setNote("");
        else close();
      } else if (e.ctrlKey && !e.altKey && lk === "s") {
        e.preventDefault();
        void flush.current();
      }
    };
    // 마우스 뒤로 단추는 폴더 이력보다 먼저 받아 보기를 닫는다 (App 은 같은 창의 나중 처리기)
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3) return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("keydown", onKeyFirst, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKeyFirst, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse, true);
    };
  });

  const folder = parentOf(p.target.path) ?? "";
  return (
    <div className="viewer" role="region" aria-label={`${p.target.name} 보기`}>
      <div className="viewer-head">
        <button className="viewer-back" onClick={close} title={`${folder} 목록으로 · Esc`}>
          <span aria-hidden="true">←</span>
          <span className="viewer-folder">{folder.split("\\").pop() || folder}</span>
        </button>
        <span className="viewer-name" title={p.target.path}>
          {p.target.name}
        </span>
        <span className="viewer-info">{info}</span>
        <button className="viewer-act" onClick={external} title="Windows 에 정해진 앱으로 연다">
          기본 앱으로 열기
        </button>
        <button className="viewer-x" onClick={close} title="닫기 · Esc" aria-label="닫기">
          ×
        </button>
      </div>
      {note && (
        <div className="viewer-bar warn" role="alert">
          <span>{note}</span>
          <button className="act" onClick={() => setNote("")}>
            닫기
          </button>
        </div>
      )}
      {kind === "text" ? (
        <TextView
          key={p.target.path}
          path={p.target.path}
          md={isMd}
          liveModified={p.liveModified}
          setInfo={setInfo}
          flushRef={flush}
          onLink={openLink}
        />
      ) : kind === "image" ? (
        <ImageView target={p.target} siblings={p.siblings} setInfo={setInfo} onPick={p.onPick} active={p.active} />
      ) : null}
    </div>
  );
}

// ───────── [2] 글 ─────────

type Status = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

function TextView(p: {
  path: string;
  md: boolean;
  liveModified?: number;
  setInfo: (n: React.ReactNode) => void;
  flushRef: React.RefObject<() => Promise<boolean>>;
  onLink: (href: string) => void;
}) {
  const [file, setFile] = useState<TextFile | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [err, setErr] = useState("");
  /** 디스크에 있는 글 · 그 수정 시각 — 저장할 것이 있는지, 밖에서 바뀌었는지 견준다. */
  const disk = useRef({ text: "", modified: 0 });
  const latest = useRef("");
  latest.current = text;
  const busy = useRef<Promise<void> | null>(null);
  const timer = useRef(0);
  /** 다시 읽은 횟수 — 마크다운 편집기는 처음 받은 글만 쓰므로, 디스크에서 다시 읽으면 이 값으로 새로 띄운다. */
  const [rev, setRev] = useState(0);

  const load = () =>
    textApi
      .read(p.path)
      .then((f) => {
        disk.current = { text: f.text, modified: f.modified };
        setFile(f);
        setText(f.text);
        setRev((r) => r + 1);
        setStatus("saved");
      })
      .catch((e) => {
        setErr(errText(e));
        setStatus("error");
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.path]);

  /** 디스크와 다르면 쓴다. 쓰는 중에 또 부르면 끝난 뒤 한 번 더 본다 — 두 번 쓰기가 엇갈려 옛 글이 이기지 않게. */
  const save = async (force = false): Promise<void> => {
    window.clearTimeout(timer.current);
    if (busy.current) {
      await busy.current;
      return save(force);
    }
    const f = file;
    const want = latest.current;
    if (!f || (want === disk.current.text && !force)) return;
    const run = (async () => {
      setStatus("saving");
      try {
        const base = force ? await textApi.modifiedOf(p.path) : disk.current.modified;
        const m = await textApi.write(p.path, { ...f, text: want }, base);
        disk.current = { text: want, modified: m };
        setStatus(latest.current === want ? "saved" : "dirty");
      } catch (e) {
        const msg = errText(e);
        if (msg === "changed") setStatus("conflict");
        else {
          setErr(msg);
          setStatus("error");
        }
      }
    })();
    busy.current = run;
    await run;
    busy.current = null;
  };
  // 밖에서 바뀐 것을 묻는 중에는 쓰지 않고 false 로 떠나지 못하게 한다 — 덮을지는 사람이 고른다.
  // 2026.11.11 리뷰 : 예전에는 그대로 닫혀 여기서 고친 글이 말없이 버려졌다
  const flush = () => (status === "conflict" ? Promise.resolve(false) : save().then(() => true));
  const own = useRef(flush);
  own.current = flush;
  p.flushRef.current = flush;
  // 닫거나 다른 파일로 갈 때 남은 것을 쓴다. 제 것을 부른다 — 다음 파일의 편집기가 먼저 그려져 flushRef 는 이미 그쪽을 가리킨다
  useEffect(() => () => void own.current(), []);

  const change = (v: string) => {
    // 읽기만 하는 파일 — 편집기도 막아 두었지만, 편집기가 스스로 낸 바뀜(체크 상자 등)도 쓰지 않는다
    if (file?.mixed) return;
    setText(v);
    if (status === "conflict") return;
    setStatus(v === disk.current.text ? "saved" : "dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 800);
  };

  // 밖(다른 편집기 · 동기화)에서 고쳤고 이쪽에 고친 것이 없으면 따라간다. 고친 것이 있으면 저장할 때 묻는다.
  useEffect(() => {
    if (p.liveModified && p.liveModified !== disk.current.modified && status === "saved" && !busy.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.liveModified]);

  const statusText: Record<Status, string> = { loading: "여는 중", saved: "저장됨", dirty: "고치는 중", saving: "저장하는 중", conflict: "", error: "" };
  useEffect(() => {
    p.setInfo(
      file && (
        <>
          <span title="읽은 인코딩 · 줄바꿈 방식 그대로 저장한다">
            {ENCODING_LABEL[file.encoding]} · {file.crlf ? "CRLF" : "LF"}
          </span>
          <span className={"viewer-status " + status}>{statusText[status]}</span>
        </>
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, status]);

  if (status === "error" && !file)
    return (
      <div className="viewer-empty">
        <p>앱 안에서 열 수 없다 — {err}</p>
      </div>
    );
  if (!file) return <div className="viewer-empty" />;

  return (
    <>
      {status === "conflict" && (
        <div className="viewer-bar warn" role="alertdialog">
          <span>연 뒤에 다른 곳에서 이 파일을 고쳤다. 여기서 고친 것은 아직 저장하지 않았다.</span>
          <button className="act" onClick={() => void load()}>
            저장된 파일 다시 읽기
          </button>
          <button className="act primary" onClick={() => void save(true)}>
            고친 내용으로 덮어쓰기
          </button>
        </div>
      )}
      {file.mixed && (
        <div className="viewer-bar" role="note">
          <span>줄바꿈 방식(CRLF · LF)이 섞인 파일이라 읽기만 한다 — 여기서 고치면 다른 줄의 줄바꿈까지 바뀐다. 고치려면 「기본 앱으로 열기」.</span>
        </div>
      )}
      {status === "error" && (
        <div className="viewer-bar warn" role="alert">
          <span>저장하지 못했다 — {err}</span>
          {/* 강제(force)로 쓰지 않는다 — 실패한 사이 다른 곳에서 고쳤으면 다시 묻게 (2026.11.11 리뷰) */}
          <button className="act" onClick={() => void save()}>
            다시 저장
          </button>
        </div>
      )}
      <div className="viewer-text">
        {p.md ? (
          <MdEditor key={rev} doc={p.path} source={file.text} readOnly={file.mixed} onChange={change} onLink={p.onLink} />
        ) : (
          <div className="viewer-pane">
            <PlainEditor value={text} readOnly={file.mixed} onChange={change} />
          </div>
        )}
      </div>
    </>
  );
}

// ───────── [3] 마크다운 ─────────

/** 편집기가 그린 그림의 주소를 문서 폴더 기준 파일로 바꾼다. 편집기는 `![](그림.png)` 의 주소를 그대로 img 에 넣어
 *  앱 주소(tauri.localhost) 기준으로 찾다 못 그린다. 표 칸의 그림도 같다. */
function fixImages(root: HTMLElement, doc: string) {
  for (const img of root.querySelectorAll<HTMLImageElement>("img:not([data-fd])")) {
    img.dataset.fd = "1";
    const local = localPath(img.getAttribute("src") ?? "", doc);
    // 다른 서버의 그림은 읽지 않는다 — 문서를 열기만 해도 그 서버에 Windows 로그인 정보가 건너간다 (2026.11.11 리뷰)
    if (local && foreignShare(local, doc)) {
      img.removeAttribute("src");
      img.alt = `다른 서버의 그림은 그리지 않는다: ${local}`;
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

function MdEditor({ doc, source, readOnly, onChange, onLink }: { doc: string; source: string; readOnly: boolean; onChange: (v: string) => void; onLink: (href: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cbs = useRef({ onChange, onLink });
  cbs.current = { onChange, onLink };
  const extensions = useMemo(() => [ctrlLink(cbs)], []);
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

// ───────── [4] 글 파일 ─────────

const plainTheme = EditorView.theme({
  "&": { fontSize: "13px", color: "var(--ink)", height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { display: "none" },
});
const PLAIN_EXT = [plainTheme, EditorView.lineWrapping];

function PlainEditor({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange: (v: string) => void }) {
  return (
    <div className="cm-fd cm-code">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={PLAIN_EXT}
        editable={!readOnly}
        autoFocus
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

// ───────── [5] 그림 ─────────

function ImageView(p: { target: ViewTarget; siblings: Entry[]; setInfo: (n: React.ReactNode) => void; onPick: (t: ViewTarget) => void; active: boolean }) {
  const [fit, setFit] = useState(true);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const images = useMemo(() => p.siblings.filter((e) => !e.isDir && IMAGE_EXTS.has(e.ext.toLowerCase())), [p.siblings]);
  const at = images.findIndex((e) => e.path.toLowerCase() === p.target.path.toLowerCase());

  useEffect(() => {
    setDims(null);
    setBroken(false);
  }, [p.target.path]);

  useEffect(() => {
    const size = p.target.size ?? images[at]?.size;
    p.setInfo(
      <>
        {dims && (
          <span>
            {dims.w} × {dims.h}
          </span>
        )}
        {size != null && <span>{formatBytes(size)}</span>}
        {at >= 0 && images.length > 1 && (
          <span title="← → 같은 폴더의 그림">
            {at + 1} / {images.length}
          </span>
        )}
      </>,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, at, images.length, p.target.path]);

  const step = (d: number) => {
    if (at < 0 || images.length < 2) return;
    p.onPick(images[(at + d + images.length) % images.length]);
  };
  useEffect(() => {
    if (!p.active) return;
    const onKey = (e: KeyboardEvent) => {
      // 설정 창 · 팔레트의 글 칸에서 친 화살표 · 띄어쓰기는 그쪽 것이다
      if (e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
      else if (e.key === "Home" && images.length) p.onPick(images[0]);
      else if (e.key === "End" && images.length) p.onPick(images[images.length - 1]);
      else if (e.key === " " || e.key === "0") setFit((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (broken)
    return (
      <div className="viewer-empty">
        <p>이 그림은 앱 안에서 그리지 못했다. 「기본 앱으로 열기」를 쓴다.</p>
      </div>
    );
  return (
    <div className={"image-stage" + (fit ? " fit" : " actual")} onClick={() => setFit((v) => !v)} title={fit ? "눌러서 원래 크기 · Space" : "눌러서 화면에 맞춤 · Space"}>
      <img
        key={p.target.path}
        src={rawUrl(p.target.path, p.target.modified)}
        alt={p.target.name}
        draggable={false}
        onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={() => setBroken(true)}
      />
      {images.length > 1 && at >= 0 && (
        <>
          <button className="image-step prev" aria-label="앞 그림 · ←" onClick={(e) => (e.stopPropagation(), step(-1))}>
            ‹
          </button>
          <button className="image-step next" aria-label="다음 그림 · →" onClick={(e) => (e.stopPropagation(), step(1))}>
            ›
          </button>
        </>
      )}
    </div>
  );
}
