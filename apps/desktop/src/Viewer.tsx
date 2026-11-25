// 앱 안 보기 — 목록 자리를 덮고 파일 하나를 연다. 닫으면(Esc · 마우스 뒤로) 그 줄로 돌아간다.
//
// 목차
//   [1] 틀 — 머리(이름 · 꼴 · 상태 · 확대 · 크게 보기 · 기본 앱으로) · 단축키
//       확대 · 축소: Ctrl+= · Ctrl+- · Ctrl+0 · Ctrl+휠 — 모든 보기가 같은 배율(zoom)을 받는다 (글은 글자 크기, 표는 칸, 그림 · 쪽은 크기)
//       크게 보기(F11): 나눈 칸을 그대로 둔 채 이 보기만 왼쪽 열 오른쪽 전체를 덮는다. Esc 는 먼저 크게 보기를 푼다 (2026.11.25)
//   [2] 글 — 불러오기 · 멈추면 저장 · 밖에서 바뀐 것
//   [3] 마크다운 — 옵시디언처럼 렌더된 채로 고친다 (@atomic-editor/editor · oxb 편집기의 바탕). 그림 · 링크는 문서 폴더 기준
//   [4] 글 파일(txt · log) — 기호를 그리지 않는 고정폭 편집기
//   [5] 그림 — 맞춤 ↔ 원래 크기 · ←/→ 같은 폴더의 그림
//   [6] 표(csv · tsv) — 칸을 골라 고치기 · 찾기 · 바꾸기 · 줄 더하기 · 지우기 · 되돌리기 (2026.11.25)
//   [7] 엑셀 — 시트를 표([6])로 읽기만 한다 · 아래 시트 탭 (2026.11.25)
//   파워포인트는 SlidesView.tsx — 쪽을 HTML 로 그린다 (pptx.ts)
//
// 2026.11.11 : 처음 만들었다. 저장 단추를 두지 않고 입력이 멈추면 쓴다(docket 메모와 같게) — Ctrl+S 는 바로 쓴다.
// 읽은 인코딩 · 줄끝 그대로 쓰고(fd-core textfile), 연 사이 밖에서 바뀌었으면 덮지 않고 묻는다.
// 2026.11.11 : 마크다운의 보기 · 편집 · 나란히 세 갈래를 걷었다 — 사용자 요청. 보는 화면이 곧 고치는 화면이다 (커서가 있는 줄만 기호가 드러난다).
// 2026.11.11 : 문서 속 웹 그림(https)은 그린다 (tauri.conf.json CSP img-src) — 옵시디언과 같다. 받은 문서를 열기만 해도
//   그 서버에 요청이 가지만, 이 앱에서 여는 md 는 대개 내 노트 · README 라 그림이 비는 쪽이 더 불편하다고 보았다.
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { AtomicCodeMirrorEditor } from "@atomic-editor/editor";
import "@atomic-editor/editor/styles.css";
import { api, type Entry } from "./api";
import { findKit, openFind } from "./editorFind";
import SlidesView from "./SlidesView";
import { errText, formatBytes, parentOf } from "./util";
import {
  ENCODING_LABEL,
  foreignShare,
  IMAGE_EXTS,
  localPath,
  MD_EXTS,
  parseTable,
  quoteCell,
  readSheets,
  type Sheet,
  rawUrl,
  runnable,
  TABLE_EXTS,
  tableSep,
  textApi,
  viewKind,
  type TableRow,
  type TextFile,
} from "./viewable";

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

/** 확대 단계 — 브라우저와 비슷한 눈금. */
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
/** 지금 배율에서 `k` 칸 (+1 확대 · -1 축소). 눈금 사이의 값(그림 맞춤에서 시작)이면 가까운 다음 눈금으로. */
function stepZoom(z: number, k: number): number {
  if (k > 0) return ZOOMS.find((v) => v > z + 0.001) ?? ZOOMS[ZOOMS.length - 1];
  return [...ZOOMS].reverse().find((v) => v < z - 0.001) ?? ZOOMS[0];
}

/** 찾기 · 바꾸기 열기 (Viewer 가 들고 본문이 단다). `replace` 면 바꿀 칸부터. */
type FindRef = React.MutableRefObject<((replace: boolean) => void) | null>;

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
  /** 확대 배율 — 1 이 기본(글은 기본 글자 크기, 그림은 맞춤 · 원래 크기, 쪽은 칸 너비). 파일을 옮겨도(그림 ← →) 남는다. */
  const [zoom, setZoom] = useState(1);
  const zoomBy = (k: number) => setZoom((z) => stepZoom(z, k));
  /** 크게 보기 — 나눈 칸 · 다른 탭 위를 덮는다. 2026.11.25 사용자 요청: 칸을 합치지 않고 미리보기만 크게. */
  const [max, setMax] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Ctrl+휠 — 웹뷰 자체 확대는 꺼져 있어(zoomHotkeysEnabled) 막지 않으면 굴리기만 된다. passive 로는 막을 수 없어 직접 단다.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  /** 열기 실패 같은 알림. 칸의 알림 줄(.msg)은 이 보기 밑에 깔려 보이지 않아 여기서 띄운다. 2026.11.11 리뷰에서 고쳤다. */
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [p.target.path]);
  const fail = (e: unknown) => setNote(errText(e));
  /** 남은 글을 쓰고 떠나도 되는가 — 밖에서 바뀐 것을 묻는 중이면 false (고친 글이 버려진다). */
  const flush = useRef<() => Promise<boolean>>(async () => true);
  /** 찾기 · 바꾸기 열기 — 지금 보이는 본문(편집기 · 표)이 단다. 편집기 밖에 초점이 있을 때의 Ctrl+F · Ctrl+H 를 여기로 보낸다. */
  const findRef = useRef<((replace: boolean) => void) | null>(null);
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
    void flush.current().then((ok) => (ok ? p.onClose() : setNote("다른 곳에서 수정됨 · 다시 읽기 또는 덮어쓰기 선택")));
  const external = () => void flush.current().then(() => api.openItem(p.target.path).catch(fail));

  /** 마크다운 속 링크 — 웹 주소는 브라우저로, 앱 안에서 볼 파일은 여기서, 나머지는 기본 앱으로. */
  const openLink = (href: string) => {
    if (/^https?:/i.test(href)) return void textApi.openUrl(href).catch(fail);
    const path = localPath(href, p.target.path);
    if (!path) return;
    // 실행되는 파일 · 다른 서버의 경로는 링크로 열지 않는다 — 받은 문서 하나로 프로그램이 돌거나 로그인 정보가 남의 서버로 가지 않게 (2026.11.11 리뷰)
    if (runnable(path)) return setNote(`실행 파일 링크는 열지 않음: ${path}`);
    if (foreignShare(path, p.target.path)) return setNote(`다른 서버 경로는 링크로 열지 않음: ${path}`);
    if (viewKind(path.split(".").pop() ?? ""))
      void flush.current().then((ok) => (ok ? p.onPick(targetOf(path)) : setNote("다른 곳에서 수정됨 · 다시 읽기 또는 덮어쓰기 선택")));
    else api.openItem(path).catch(fail);
  };

  useEffect(() => {
    if (!p.active) return;
    // 편집기의 떠 있는 것(표 칸 메뉴 · 자동 완성)이 있을 때의 Esc 는 그것만 닫는다. 표 메뉴는 Esc 를 받고도 막지 않아(preventDefault)
    // 아래 처리기까지 오고, 그때는 이미 메뉴가 사라져 있으므로 잡는 단계에서 미리 본다 (2026.11.11 리뷰)
    let popup = false;
    const onKeyFirst = (e: KeyboardEvent) => {
      popup = e.key === "Escape" && !!document.querySelector(".cm-atomic-table-menu, .cm-tooltip-autocomplete");
      // Ctrl+F 찾기 · Ctrl+H 바꾸기 — 편집기 글 안이면 편집기가 받는다(findKit). 밖(머리 · 표 · 찾기 판의 칸)이면 여기서 연다.
      //   찾기 판의 칸은 편집기 단축키가 닿지 않는다. 잡는 단계에서 막아야 앱의 Ctrl+H(숨김 파일 보기)가 함께 돌지 않는다.
      const lk = e.key.toLowerCase();
      if (e.ctrlKey && !e.altKey && !e.shiftKey && (lk === "f" || lk === "h") && findRef.current && !(e.target as HTMLElement).closest?.(".cm-content")) {
        e.preventDefault();
        e.stopPropagation();
        findRef.current(lk === "h");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      // 편집기 찾기 칸의 Esc 같은 것은 편집기가 먼저 받는다
      if (e.defaultPrevented || popup) return;
      const lk = e.key.toLowerCase();
      if (e.key === "Escape") {
        e.preventDefault();
        if (note) setNote("");
        else if (max) setMax(false);
        else close();
      } else if (e.ctrlKey && !e.altKey && lk === "s") {
        e.preventDefault();
        void flush.current();
      } else if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        // 표의 줄 더하기 · 지우기는 Ctrl+Shift+= · Ctrl+Shift+- 라 겹치지 않는다
        e.preventDefault();
        if (e.key === "0") setZoom(1);
        else zoomBy(e.key === "-" ? -1 : 1);
      } else if (e.key === "F11") {
        e.preventDefault();
        setMax((v) => !v);
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
    <div
      ref={root}
      className={"viewer" + (max ? " max" : "")}
      role="region"
      aria-label={`${p.target.name} 보기`}
      style={{ "--zoom": zoom } as React.CSSProperties}
    >
      <div className="viewer-head">
        <button className="viewer-back" onClick={close} title={`${folder} 목록으로 · Esc`}>
          <span aria-hidden="true">←</span>
          <span className="viewer-folder">{folder.split("\\").pop() || folder}</span>
        </button>
        <span className="viewer-name" title={p.target.path}>
          {p.target.name}
        </span>
        <span className="viewer-info">{info}</span>
        <span className="viewer-zoom" role="group" aria-label="확대">
          <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} aria-label="축소" title="축소 · Ctrl+- · Ctrl+휠">
            −
          </button>
          <button type="button" className="viewer-zoom-pct" onClick={() => setZoom(1)} title="원래 배율로 · Ctrl+0">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="확대" title="확대 · Ctrl+= · Ctrl+휠">
            +
          </button>
        </span>
        <button className="viewer-act" onClick={() => setMax((v) => !v)} aria-pressed={max} title={max ? "칸 안으로 되돌리기 · F11 · Esc" : "이 보기만 크게 · F11"}>
          {max ? "칸으로" : "크게 보기"}
        </button>
        <button className="viewer-act" onClick={external} title="기본 앱으로 열기">
          기본 앱으로 열기
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
          table={TABLE_EXTS.has(p.target.ext.toLowerCase()) ? p.target.ext.toLowerCase() : null}
          liveModified={p.liveModified}
          setInfo={setInfo}
          flushRef={flush}
          findRef={findRef}
          onLink={openLink}
        />
      ) : kind === "sheet" ? (
        <SheetView key={p.target.path} path={p.target.path} liveModified={p.liveModified} setInfo={setInfo} findRef={findRef} />
      ) : kind === "slides" ? (
        <SlidesView key={p.target.path} path={p.target.path} liveModified={p.liveModified} setInfo={setInfo} findRef={findRef} active={p.active} zoom={zoom} />
      ) : kind === "image" ? (
        <ImageView target={p.target} siblings={p.siblings} setInfo={setInfo} onPick={p.onPick} active={p.active} zoom={zoom} setZoom={setZoom} />
      ) : null}
    </div>
  );
}

// ───────── [2] 글 ─────────

type Status = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

function TextView(p: {
  path: string;
  md: boolean;
  /** csv · tsv 면 그 확장자 — 표로 먼저 보인다. */
  table: string | null;
  liveModified?: number;
  setInfo: (n: React.ReactNode) => void;
  flushRef: React.RefObject<() => Promise<boolean>>;
  findRef: FindRef;
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
  /** 표로 보는 중인가 (csv · tsv). 고치려면 글로 바꾼다 — 표 칸에서 고치면 따옴표 · 구분자를 다시 써야 해서 원래 글 꼴이 흐트러진다. */
  const [asTable, setAsTable] = useState(true);

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

  const statusText: Record<Status, string> = { loading: "여는 중", saved: "저장됨", dirty: "수정 중", saving: "저장하는 중", conflict: "", error: "" };
  useEffect(() => {
    p.setInfo(
      file && (
        <>
          {p.table && (
            <span className="cs-seg" role="group" aria-label="보기">
              <button type="button" aria-pressed={asTable} onClick={() => setAsTable(true)}>
                표
              </button>
              <button type="button" aria-pressed={!asTable} onClick={() => setAsTable(false)} title="글로 보고 고치기">
                글
              </button>
            </span>
          )}
          <span title="읽은 인코딩 · 줄바꿈 그대로 저장">
            {ENCODING_LABEL[file.encoding]} · {file.crlf ? "CRLF" : "LF"}
          </span>
          <span className={"viewer-status " + status}>{statusText[status]}</span>
        </>
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, status, asTable]);

  if (status === "error" && !file)
    return (
      <div className="viewer-empty">
        <p>앱 안에서 열 수 없다. {err}</p>
      </div>
    );
  if (!file) return <div className="viewer-empty" />;

  return (
    <>
      {status === "conflict" && (
        <div className="viewer-bar warn" role="alertdialog">
          <span>다른 곳에서 파일이 수정됨 · 여기서 고친 내용은 저장 전</span>
          <button className="act" onClick={() => void load()}>
            저장된 파일 다시 읽기
          </button>
          <button className="act primary" onClick={() => void save(true)}>
            수정한 내용으로 덮어쓰기
          </button>
        </div>
      )}
      {file.mixed && (
        <div className="viewer-bar" role="note">
          <span>줄바꿈(CRLF · LF)이 섞인 파일이라 읽기 전용</span>
        </div>
      )}
      {status === "error" && (
        <div className="viewer-bar warn" role="alert">
          <span>저장하지 못했다. {err}</span>
          {/* 강제(force)로 쓰지 않는다 — 실패한 사이 다른 곳에서 고쳤으면 다시 묻게 (2026.11.11 리뷰) */}
          <button className="act" onClick={() => void save()}>
            다시 저장
          </button>
        </div>
      )}
      <div className="viewer-text">
        {p.md ? (
          <MdEditor key={rev} doc={p.path} source={file.text} readOnly={file.mixed} onChange={change} onLink={p.onLink} findRef={p.findRef} />
        ) : p.table && asTable ? (
          <TableView
            text={text}
            sep={tableSep(p.table, text)}
            readOnly={file.mixed}
            readOnlyWhy="줄바꿈(CRLF · LF)이 섞인 파일이라 읽기 전용"
            onChange={change}
            findRef={p.findRef}
          />
        ) : (
          <div className="viewer-pane">
            <PlainEditor value={text} readOnly={file.mixed} onChange={change} findRef={p.findRef} />
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

function MdEditor({
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

// ───────── [4] 글 파일 ─────────

const plainTheme = EditorView.theme({
  "&": { fontSize: "13px", color: "var(--ink)", height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { display: "none" },
});
function PlainEditor({ value, readOnly, onChange, findRef }: { value: string; readOnly: boolean; onChange: (v: string) => void; findRef: FindRef }) {
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

function ImageView(p: {
  target: ViewTarget;
  siblings: Entry[];
  setInfo: (n: React.ReactNode) => void;
  onPick: (t: ViewTarget) => void;
  active: boolean;
  /** 보기 배율 — 1 이면 맞춤 · 원래 크기 그대로, 아니면 원래 크기의 배율. */
  zoom: number;
  setZoom: (z: number) => void;
}) {
  const [fit, setFit] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  /** 맞춤일 때 그림이 원래 크기의 몇 배로 그려지나 — 맞춤에서 확대하면 거기서부터 키운다 (2026.11.25). */
  const fitScale = () => {
    const el = stage.current;
    if (!el || !dims) return 1;
    return Math.min(1, (el.clientWidth - 32) / dims.w, (el.clientHeight - 32) / dims.h);
  };
  const zoomed = p.zoom !== 1;
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
      else if (e.key === " " || e.key === "0") p.zoom !== 1 ? p.setZoom(1) : setFit((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (broken)
    return (
      <div className="viewer-empty">
        <p>앱에서 표시할 수 없는 그림</p>
      </div>
    );
  return (
    <div
      ref={stage}
      className={"image-stage" + (zoomed ? " zoomed" : fit ? " fit" : " actual")}
      onClick={() => (zoomed ? p.setZoom(1) : setFit((v) => !v))}
      title={zoomed ? "눌러서 배율 풀기 · Ctrl+0" : fit ? "눌러서 원래 크기 · Space" : "눌러서 화면에 맞춤 · Space"}
    >
      <img
        style={zoomed && dims ? { width: dims.w * (fit ? fitScale() : 1) * p.zoom, height: dims.h * (fit ? fitScale() : 1) * p.zoom } : undefined}
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

// ───────── [6] 표 ─────────
//
// 칸을 고르고(누르기 · 화살표) 고친다(두 번 누르기 · F2 · Enter · 바로 치기). 고친 칸은 원본 글의 그 칸 자리만 바꿔 써서
// 따옴표 · 줄끝 · 다른 칸의 꼴이 그대로 남는다 (parseTable 의 자리). 찾기 · 바꾸기는 칸 글을 기준으로 한다.
// 2026.11.25 : 읽기만 하던 표에 고치기 · 찾기 · 바꾸기 · 줄 더하기 · 지우기 · 되돌리기를 더했다 (사용자 요청).

/** 한 번에 그리는 줄 수 — 넘으면 앞부분만 그리고 알린다. 수만 줄을 칸마다 DOM 으로 그리면 창이 멈춘다. */
const TABLE_MAX_ROWS = 5000;
/** 표에서 되돌릴 수 있는 단계 수. */
const TABLE_UNDO = 100;

type Pos = { r: number; c: number };
type Edits = { s: number; e: number; t: string }[];

/** 글의 여러 자리를 한 번에 바꾼다 — 뒤에서부터 바꿔 앞 자리가 밀리지 않게. */
function applyEdits(text: string, edits: Edits): string {
  let out = text;
  for (const d of [...edits].sort((a, b) => b.s - a.s)) out = out.slice(0, d.s) + d.t + out.slice(d.e);
  return out;
}

/** 칸 하나를 `v` 로 쓰는 바꿈. 짧은 줄(칸이 모자란 줄)이면 줄 끝에 구분자를 채워 그 칸을 만든다. */
function cellEdit(rows: TableRow[], { r, c }: Pos, v: string, sep: string): Edits {
  const row = rows[r];
  const cell = row.cells[c];
  if (cell) return [{ s: cell.s, e: cell.e, t: quoteCell(v, sep, cell.q) }];
  const end = row.cells[row.cells.length - 1].e;
  return [{ s: end, e: end, t: sep.repeat(c - row.cells.length + 1) + quoteCell(v, sep) }];
}

/** 대소문자 무시 · 구분 찾기. 찾은 자리들(시작)을 돌려준다. */
function findIn(v: string, q: string, cs: boolean): number[] {
  if (!q) return [];
  const hay = cs ? v : v.toLowerCase();
  const needle = cs ? q : q.toLowerCase();
  const at: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) at.push(i);
  return at;
}

/** 칸 글 안의 찾은 말을 모두 `rep` 로. */
function replaceIn(v: string, q: string, rep: string, cs: boolean): string {
  const at = findIn(v, q, cs);
  let out = "";
  let last = 0;
  for (const i of at) (out += v.slice(last, i) + rep), (last = i + q.length);
  return out + v.slice(last);
}

/** 칸 글 — 찾은 말을 밝힌다. */
function Marked({ v, q, cs }: { v: string; q: string; cs: boolean }) {
  const at = findIn(v, q, cs);
  if (at.length === 0) return <>{v}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  at.forEach((i, k) => {
    parts.push(v.slice(last, i), <mark key={k}>{v.slice(i, i + q.length)}</mark>);
    last = i + q.length;
  });
  parts.push(v.slice(last));
  return <>{parts}</>;
}

/** 엑셀 열 이름 — 0 → A, 25 → Z, 26 → AA. */
const colName = (n: number): string => (n < 26 ? "" : colName(Math.floor(n / 26) - 1)) + String.fromCharCode(65 + (n % 26));

/** csv · tsv 를 표로. 첫 줄은 머리로 고정하고, 왼쪽에 줄 번호를 둔다.
 *  엑셀 시트(`sheet`)면 읽기만 하고, 머리에 열 글자(A · B …)를 두고 모든 줄을 몸통으로 그린다 — 줄 번호 · 열 글자는 시트의 실제 자리다. */
function TableView(p: {
  text?: string;
  sep?: string;
  /** 엑셀 시트 — 글 대신 칸을 받는다. `origin` 은 첫 칸의 시트 안 자리 (0 부터). */
  sheet?: { rows: TableRow[]; origin: { row: number; col: number }; note?: string };
  readOnly: boolean;
  /** 고칠 수 없는 까닭 — 고치려 할 때 알린다. */
  readOnlyWhy?: string;
  onChange?: (v: string) => void;
  findRef: FindRef;
}) {
  const text = p.text ?? "";
  const sep = p.sep ?? ",";
  const sheet = p.sheet;
  const rows = useMemo(() => sheet?.rows ?? parseTable(text, sep), [sheet, text, sep]);
  const cols = rows.reduce((n, r) => Math.max(n, r.cells.length), 0);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  /** 몸통의 첫 줄 — 글 표는 머리 줄(0)을 뺀 1, 시트는 0. */
  const first = sheet ? 0 : 1;
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<Pos | null>(null);
  /** 고치는 칸과 그 칸에 친 글. */
  const [edit, setEdit] = useState<(Pos & { v: string }) | null>(null);
  /** 고치기를 한 번만 끝낸다 — Enter 로 끝낸 뒤 칸이 사라지며 blur 가 또 와도 다시 쓰지 않게. */
  const editing = useRef(false);
  const [find, setFind] = useState({ open: false, rep: false, q: "", to: "", cs: false, only: false });
  const findInput = useRef<HTMLInputElement>(null);
  const repInput = useRef<HTMLInputElement>(null);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const [said, setSaid] = useState("");

  /** 글을 바꾸고 되돌릴 자리를 쌓는다. 저장은 글 보기와 같은 길(멈추면 저장)이다. */
  const commit = (next: string) => {
    if (next === text || !p.onChange) return;
    undo.current = [...undo.current.slice(-(TABLE_UNDO - 1)), text];
    redo.current = [];
    p.onChange(next);
  };
  const step = (back: boolean) => {
    const from = back ? undo.current : redo.current;
    const prev = from.pop();
    if (prev == null || !p.onChange) return;
    (back ? redo : undo).current.push(text);
    p.onChange(prev);
  };

  // 찾은 칸들 — 머리 줄도 찾는다. 「맞는 줄만」이면 몸통 줄을 거른다.
  const hits = useMemo(() => {
    const out: Pos[] = [];
    if (!find.open || !find.q) return out;
    rows.forEach((row, r) => row.cells.forEach((cell, c) => findIn(cell.v, find.q, find.cs).length && out.push({ r, c })));
    return out;
  }, [rows, find.open, find.q, find.cs]);
  const hitSet = useMemo(() => new Set(hits.map((h) => `${h.r}:${h.c}`)), [hits]);
  const cur = sel ? hits.findIndex((h) => h.r === sel.r && h.c === sel.c) : -1;

  const body = useMemo(() => {
    const all = rows.map((_, r) => r).slice(first);
    const kept = find.open && find.only && find.q ? all.filter((r) => rows[r].cells.some((_, c) => hitSet.has(`${r}:${c}`))) : all;
    return kept;
  }, [rows, first, find.open, find.only, find.q, hitSet]);
  const shown = body.slice(0, TABLE_MAX_ROWS);

  // 파일을 연 두 번 누르기의 둘째 누르기가 막 그려진 표 위에 떨어져 칸 글이 파랗게 골라진 채 열렸다 — 열 때 한 번 푼다
  useEffect(() => window.getSelection()?.removeAllRanges(), []);

  // 고른 칸을 보이게 — 머리 줄 · 줄 번호 열은 붙어 있으므로 그만큼 비켜 둔다 (CSS scroll-margin)
  useEffect(() => {
    if (!sel) return;
    box.current?.querySelector<HTMLElement>(`[data-r="${sel.r}"][data-c="${sel.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  // 밖에서 누른 Ctrl+F · Ctrl+H 를 받는다 (Viewer)
  useEffect(() => {
    p.findRef.current = (rep) => {
      setFind((f) => ({ ...f, open: true, rep: f.rep || (rep && !p.readOnly) }));
      requestAnimationFrame(() => ((rep && !p.readOnly ? repInput : findInput).current ?? findInput.current)?.select());
    };
    return () => {
      p.findRef.current = null;
    };
  });

  const go = (k: number) => {
    if (hits.length === 0) return setSaid(find.q ? "찾은 칸 없음" : "");
    const i = cur < 0 ? (k > 0 ? 0 : hits.length - 1) : (cur + k + hits.length) % hits.length;
    setSel(hits[i]);
    setSaid("");
    if (hits[i].r >= first && !shown.includes(hits[i].r)) setSaid(`${hits[i].r}째 줄은 앞 ${TABLE_MAX_ROWS.toLocaleString()}줄 밖이라 표에 없음`);
  };
  /** 지금 칸의 찾은 말을 바꾸고 다음으로. 지금 칸이 찾은 칸이 아니면 먼저 그리로 간다. */
  const replaceOne = () => {
    if (p.readOnly || !find.q) return;
    if (cur < 0) return go(1);
    const h = hits[cur];
    commit(applyEdits(text, cellEdit(rows, h, replaceIn(rows[h.r].cells[h.c].v, find.q, find.to, find.cs), sep)));
    // 바꾼 뒤 찾은 칸 목록이 다시 만들어진다 — 다음 칸은 같은 차례 자리에 온다
    const next = hits[cur + 1] ?? hits[0];
    setSel(next && !(next.r === h.r && next.c === h.c) ? next : null);
  };
  const replaceAll = () => {
    if (p.readOnly || !find.q || hits.length === 0) return;
    commit(applyEdits(text, hits.flatMap((h) => cellEdit(rows, h, replaceIn(rows[h.r].cells[h.c].v, find.q, find.to, find.cs), sep))));
    setSaid(`${hits.length}칸을 바꿈`);
  };

  const startEdit = (pos: Pos, v?: string) => {
    if (p.readOnly) return setSaid(p.readOnlyWhy ?? "읽기 전용");
    editing.current = true;
    setEdit({ ...pos, v: v ?? rows[pos.r]?.cells[pos.c]?.v ?? "" });
  };
  const endEdit = (save: boolean, move?: Pos) => {
    if (!edit || !editing.current) return;
    editing.current = false;
    if (save && edit.v !== (rows[edit.r]?.cells[edit.c]?.v ?? "")) commit(applyEdits(text, cellEdit(rows, edit, edit.v, sep)));
    setEdit(null);
    if (move) setSel(move);
    box.current?.focus();
  };

  /** 줄 더하기 — 고른 줄 아래에 빈 줄. 고른 줄이 없으면 맨 끝. */
  const addRow = () => {
    if (p.readOnly || rows.length === 0) return;
    const r = sel?.r ?? rows.length - 1;
    const row = rows[r];
    const blank = sep.repeat(Math.max(cols - 1, 0));
    // 마지막 줄 뒤에 줄끝이 없으면 줄끝부터 붙인다
    const t = row.next > row.e ? blank + eol : eol + blank;
    commit(applyEdits(text, [{ s: row.next > row.e ? row.next : row.e, e: row.next > row.e ? row.next : row.e, t }]));
    setSel({ r: r + 1, c: sel?.c ?? 0 });
  };
  /** 줄 지우기 — 고른 줄을 줄끝까지. 머리 줄은 지우지 않는다. */
  const delRow = () => {
    if (p.readOnly || !sel || sel.r === 0) return;
    const row = rows[sel.r];
    // 마지막 줄이면 앞 줄의 줄끝을 함께 지운다 — 빈 줄이 남지 않게
    const s = row.next > row.e ? row.s : rows[sel.r - 1].e;
    commit(applyEdits(text, [{ s, e: row.next > row.e ? row.next : row.e, t: "" }]));
    setSel({ r: Math.min(sel.r, rows.length - 2), c: sel.c });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (edit || (e.target as HTMLElement).closest("input")) return;
    const ctrl = e.ctrlKey && !e.altKey;
    const k = e.key;
    const move = (dr: number, dc: number) => {
      const at = sel ?? { r: 0, c: 0 };
      // 줄은 보이는 차례로 옮긴다 (「맞는 줄만」이면 걸러진 줄 사이를)
      const order = sheet ? shown : [0, ...shown];
      const i = Math.max(0, order.indexOf(at.r));
      const r = order[Math.min(order.length - 1, Math.max(0, i + dr))];
      setSel({ r, c: Math.min(cols - 1, Math.max(0, at.c + dc)) });
    };
    let done = true;
    if (k === "ArrowDown") move(1, 0);
    else if (k === "ArrowUp") move(-1, 0);
    else if (k === "ArrowRight" || (k === "Tab" && !e.shiftKey)) move(0, 1);
    else if (k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) move(0, -1);
    else if (k === "PageDown") move(20, 0);
    else if (k === "PageUp") move(-20, 0);
    else if (ctrl && k === "Home") setSel({ r: first === 0 ? (shown[0] ?? 0) : 0, c: 0 });
    else if (ctrl && k === "End") setSel({ r: shown[shown.length - 1] ?? 0, c: cols - 1 });
    else if ((k === "Enter" || k === "F2") && sel) startEdit(sel);
    else if (k === "F3") go(e.shiftKey ? -1 : 1);
    else if ((k === "Delete" || k === "Backspace") && sel && !p.readOnly) commit(applyEdits(text, cellEdit(rows, sel, "", sep)));
    else if (ctrl && e.key.toLowerCase() === "z") step(!e.shiftKey);
    else if (ctrl && e.key.toLowerCase() === "y") step(false);
    else if (ctrl && e.key.toLowerCase() === "c" && sel) void navigator.clipboard.writeText(rows[sel.r]?.cells[sel.c]?.v ?? "");
    // 2026.11.25 : Ctrl+= · Ctrl+- 는 확대 · 축소(보기 전체)에 주고 줄은 Ctrl+Shift 로 옮겼다 — 엑셀의 줄 넣기도 Ctrl+Shift++ 다
    else if (ctrl && e.shiftKey && (e.code === "Equal" || k === "+" || k === "=")) addRow();
    else if (ctrl && e.shiftKey && (e.code === "Minus" || k === "_" || k === "-")) delRow();
    // 고른 칸에서 바로 치면 그 칸을 비우고 고치기 시작 (엑셀과 같다). 고칠 칸을 이 키를 받는 중에 바로 띄우고 초점을 옮겨
    //   글자가 그 칸에 들어가게 한다 — 한글은 조합 중이라 키가 「Process」로 오고 글자를 알 수 없다. 막지 않는다(preventDefault 없이).
    else if (sel && !e.ctrlKey && !e.altKey && !e.metaKey && (k.length === 1 || k === "Process")) {
      flushSync(() => startEdit(sel, ""));
      done = false;
    }
    else if (k === "Escape" && find.open) setFind((f) => ({ ...f, open: false }));
    else if (k === "Escape" && sel) setSel(null);
    else done = false;
    if (done) e.preventDefault();
  };

  const onFindKey = (e: React.KeyboardEvent, isRep: boolean) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isRep && e.ctrlKey) replaceAll();
      else if (isRep) replaceOne();
      else go(e.shiftKey ? -1 : 1);
    } else if (e.key === "F3") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFind((f) => ({ ...f, open: false }));
      box.current?.focus();
    }
  };

  if (rows.length === 0) return <div className="viewer-empty">{sheet ? "빈 시트" : "빈 파일"}</div>;

  const cell = (r: number, c: number, head: boolean) => {
    const v = rows[r].cells[c]?.v ?? "";
    const isSel = sel?.r === r && sel.c === c;
    const cls = [isSel ? "sel" : "", hitSet.has(`${r}:${c}`) ? "hit" : ""].join(" ").trim() || undefined;
    const Tag = head ? "th" : "td";
    return (
      <Tag
        key={c}
        className={cls}
        data-r={r}
        data-c={c}
        title={v.length > 40 || v.includes("\n") ? v : undefined}
        onMouseDown={() => setSel({ r, c })}
        onDoubleClick={() => startEdit({ r, c })}
      >
        {edit?.r === r && edit.c === c ? (
          <input
            className="cell-edit"
            autoFocus
            value={edit.v}
            onChange={(e) => setEdit({ ...edit, v: e.target.value })}
            onBlur={() => endEdit(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const order = sheet ? shown : [0, ...shown];
                endEdit(true, { r: order[order.indexOf(r) + 1] ?? r, c });
              }
              else if (e.key === "Tab") e.preventDefault(), endEdit(true, { r, c: Math.min(cols - 1, Math.max(0, c + (e.shiftKey ? -1 : 1))) });
              else if (e.key === "Escape") e.preventDefault(), endEdit(false);
            }}
          />
        ) : (
          <Marked v={v} q={find.open ? find.q : ""} cs={find.cs} />
        )}
      </Tag>
    );
  };

  return (
    <div className="viewer-table">
      {find.open && (
        <div className="table-find" role="search">
          <div className="table-find-row">
            <input
              ref={findInput}
              className="table-find-q"
              placeholder="찾을 말"
              aria-label="찾을 말"
              value={find.q}
              autoFocus
              onChange={(e) => (setFind({ ...find, q: e.target.value }), setSaid(""))}
              onKeyDown={(e) => onFindKey(e, false)}
            />
            <span className="table-find-count" aria-live="polite">
              {find.q ? (hits.length ? `${cur >= 0 ? cur + 1 : "-"} / ${hits.length}칸` : "없음") : ""}
            </span>
            <button type="button" className="act" onClick={() => go(-1)} title="이전 · Shift+Enter">
              이전
            </button>
            <button type="button" className="act" onClick={() => go(1)} title="다음 · Enter">
              다음
            </button>
            <label className="table-find-opt">
              <input type="checkbox" checked={find.cs} onChange={(e) => setFind({ ...find, cs: e.target.checked })} />
              대소문자
            </label>
            <label className="table-find-opt">
              <input type="checkbox" checked={find.only} onChange={(e) => setFind({ ...find, only: e.target.checked })} />
              맞는 줄만
            </label>
            {!p.readOnly && (
              <button type="button" className="act" aria-pressed={find.rep} onClick={() => setFind({ ...find, rep: !find.rep })} title="바꾸기 · Ctrl+H">
                바꾸기
              </button>
            )}
            <button type="button" className="act table-find-x" onClick={() => (setFind({ ...find, open: false }), box.current?.focus())} aria-label="닫기" title="닫기 · Esc">
              ×
            </button>
          </div>
          {find.rep && !p.readOnly && (
            <div className="table-find-row">
              <input
                ref={repInput}
                className="table-find-q"
                placeholder="바꿀 말"
                aria-label="바꿀 말"
                value={find.to}
                onChange={(e) => setFind({ ...find, to: e.target.value })}
                onKeyDown={(e) => onFindKey(e, true)}
              />
              <button type="button" className="act" onClick={replaceOne} title="지금 칸을 바꾸고 다음으로 · Enter">
                바꾸기
              </button>
              <button type="button" className="act" onClick={replaceAll} title="찾은 칸 모두 · Ctrl+Enter">
                모두 바꾸기
              </button>
            </div>
          )}
        </div>
      )}
      {/* 아래 끝은 즐겨찾기 독의 손잡이 글자와 겹쳐 위에 둔다 */}
      <div className="table-hint">
        {p.readOnly
          ? `${sheet ? "읽기 전용 미리보기 · 고치기는 기본 앱으로 · " : ""}Ctrl+F 찾기 · Ctrl+C 칸 복사`
          : "두 번 누르기 · Enter · 바로 치기로 고치기 · Ctrl+F 찾기 · Ctrl+H 바꾸기 · Ctrl+Shift++ 줄 더하기 · Ctrl+Shift+- 줄 지우기 · Ctrl+Z 되돌리기 · Ctrl+휠 확대"}
      </div>
      {(said || sheet?.note || body.length > TABLE_MAX_ROWS) && (
        <div className="viewer-bar" role="note">
          <span>{said || sheet?.note || `${body.length.toLocaleString()}줄 중 앞 ${TABLE_MAX_ROWS.toLocaleString()}줄만 표시 · 전체는 「글」이나 기본 앱으로`}</span>
        </div>
      )}
      <div className="viewer-table-scroll" ref={box} tabIndex={0} onKeyDown={onKey} aria-label="표 · 화살표로 칸 고르기 · Enter 로 고치기">
        <table>
          <thead>
            <tr>
              <th className="n" aria-label="줄 번호" />
              {sheet
                ? Array.from({ length: cols }, (_, c) => (
                    <th key={c} className="col">
                      {colName(sheet.origin.col + c)}
                    </th>
                  ))
                : Array.from({ length: cols }, (_, c) => cell(0, c, true))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r}>
                <td className="n">{sheet ? sheet.origin.row + r + 1 : r}</td>
                {Array.from({ length: cols }, (_, c) => cell(r, c, false))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────── [7] 엑셀 ─────────

/** 엑셀 · 스프레드시트를 시트마다 표로. 읽기만 한다 — 다시 쓰면 서식 · 수식이 깨지므로 고치기는 기본 앱으로.
 *  보이는 값만 옮긴다 (날짜는 날짜로, 숫자 서식 · 색 · 병합은 옮기지 않는다 · fd-core sheet). */
function SheetView(p: { path: string; liveModified?: number; setInfo: (n: React.ReactNode) => void; findRef: FindRef }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [err, setErr] = useState("");
  const [at, setAt] = useState(0);
  useEffect(() => {
    let gone = false;
    readSheets(p.path)
      .then((v) => {
        if (gone) return;
        setSheets(v);
        // 밖에서 고쳐 다시 읽어도 보던 시트에 남는다
        setAt((i) => Math.min(i, Math.max(v.length - 1, 0)));
      })
      .catch((e) => !gone && setErr(errText(e)));
    return () => {
      gone = true;
    };
  }, [p.path, p.liveModified]);
  const sheet = sheets?.[at];
  useEffect(() => {
    p.setInfo(sheets && <span>{`${sheets.length}개 시트 · 읽기 전용`}</span>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets]);
  const table = useMemo(
    () =>
      sheet && {
        rows: sheet.rows.map((cells) => ({ cells: cells.map((v) => ({ v, s: 0, e: 0, q: false })), s: 0, e: 0, next: 0 })),
        origin: { row: sheet.row0, col: sheet.col0 },
        note: sheet.truncated ? `${sheet.totalRows.toLocaleString()}줄 중 앞 ${sheet.rows.length.toLocaleString()}줄 · 256열까지만 표시 · 전체는 기본 앱으로` : undefined,
      },
    [sheet],
  );
  if (err)
    return (
      <div className="viewer-empty">
        <p>앱 안에서 열 수 없다. {err}</p>
      </div>
    );
  if (!sheets || !table) return <div className="viewer-empty" />;
  return (
    <div className="viewer-sheet">
      <TableView key={at} sheet={table} readOnly readOnlyWhy="엑셀 미리보기는 읽기 전용 · 고치기는 「기본 앱으로 열기」" findRef={p.findRef} />
      {/* 시트가 하나여도 탭을 둔다 — 엑셀과 같게. 2026.11.25 : 하나면 숨겼더니 시트 탭이 안 보인다는 지적과 겹쳐 어느 시트를 보는지 알 길이 없었다 */}
      <div className="sheet-tabs" role="tablist" aria-label="시트">
        {sheets.map((s, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === at} onClick={() => setAt(i)} title={s.name}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
