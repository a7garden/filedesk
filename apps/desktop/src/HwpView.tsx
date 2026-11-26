// 앱 안 보기 — 한글(hwp · hwpx) 미리보기. rhwp(@rhwp/core · Rust + WASM)가 쪽마다 SVG 로 그린 것을 위에서 아래로 늘어놓는다. 읽기만 한다.
//
// 목차
//   [1] 엔진 — WASM 을 처음 한글 파일을 열 때(또는 목록에서 한글 파일에 머물 때) 한 번만 불러온다 (28MB · 앱 시작을 늦추지 않게 · hwpEngine.ts)
//   [2] 불러오기 — raw: 로 파일을 받아 쪽마다 그린다 (앞쪽부터 보인다 · 쪽 사이에 숨을 돌려 화면이 멈추지 않게)
//   [3] 쪽 — 그림자 뿌리(shadow root)에 쪽 SVG 를 넣고 칸 너비에 맞춰 줄인다
//   [4] 찾기 — 쪽 글자를 이어 붙여 찾고 그 자리를 밝힌다 (CSS Custom Highlight)
//   [5] 단축키 — PageDown · PageUp · Home · End 로 쪽 넘기기
//
// 2026.11.25 : 사용자 요청으로 더했다. 엔진은 rhwp 0.9.1 (MIT · github.com/edwardkim/rhwp) — 옛 hwp(바이너리)와 hwpx 를 함께 읽고 쪽을 나눠 그린다.
// 쪽마다 그림자 뿌리에 넣는 까닭: rhwp 의 SVG 는 쪽마다 같은 id(body-clip-3 등)의 clipPath 를 쓴다 — 한 문서에 늘어놓으면 앞 쪽의 것이 잡혀 글이 잘린다.
// 파워포인트 보기(SlidesView)와 같은 쪽 틀 · 서식(.slide-*)을 쓴다 — 쪽 보기는 하나의 모양으로.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { engineReady, loadEngine } from "./hwpEngine";
import Skeleton from "./Skeleton";
import { errText } from "./util";
import { rawUrl, stripHasFocus } from "./viewable";

type Props = {
  path: string;
  /** 목록의 수정 시각 — 밖에서 고치면 다시 그린다. */
  liveModified?: number;
  setInfo: (n: React.ReactNode) => void;
  findRef: React.MutableRefObject<((replace: boolean) => void) | null>;
  active: boolean;
  /** 보기 배율 — 1 이면 칸 너비에 맞춘 크기. */
  zoom: number;
};

/** 쪽 너비 상한 — A4 세로가 넓은 창에서 너무 커지지 않게. */
const MAX_W = 900;

// ───────── [1] 엔진 ─────────
// hwpEngine.ts — 목록이 미리 데울 수 있게 따로 뒀다 (2026.11.26)

// ───────── [2] 불러오기 ─────────

type Page = { svg: string; w: number; h: number };

export default function HwpView(p: Props) {
  const [pages, setPages] = useState<Page[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [cur, setCur] = useState(0);
  /** 엔진을 처음 불러오는 열기인가 — 처음이면 1초 남짓 걸려 까닭을 함께 알린다. */
  const [coldStart] = useState(() => !engineReady());
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let gone = false;
    let doc: { free(): void } | null = null;
    setPages([]);
    setTotal(0);
    setErr("");
    (async () => {
      const [m, buf] = await Promise.all([
        loadEngine(),
        fetch(rawUrl(p.path, p.liveModified)).then((r) => {
          if (!r.ok) throw new Error("파일을 읽지 못함");
          return r.arrayBuffer();
        }),
      ]);
      if (gone) return;
      const d = new m.HwpDocument(new Uint8Array(buf));
      doc = d;
      const n = d.pageCount();
      setTotal(n);
      if (n === 0) return setErr("쪽이 없는 문서");
      for (let i = 0; i < n && !gone; i++) {
        const info = JSON.parse(d.getPageInfo(i)) as { width: number; height: number };
        const svg = d.renderPageSvg(i);
        if (gone) break;
        setPages((v) => [...v, { svg, w: info.width, h: info.height }]);
        // 쪽 하나에 수십 ms — 사이마다 화면에 차례를 넘겨 굴리기 · 키가 멈추지 않게
        await new Promise((r) => setTimeout(r, 0));
      }
    })().catch((e) => {
      if (gone) return;
      const t = errText(e);
      setErr(/password|암호|encrypt/i.test(t) ? "암호가 걸린 문서 · 기본 앱으로" : /distribut|배포용/i.test(t) ? "배포용 문서는 열 수 없음 · 기본 앱으로" : `한글 문서를 읽지 못함 · ${t}`);
    });
    return () => {
      gone = true;
      // 그리는 중이면 그 루프가 끝난 뒤 풀리도록 한 박자 늦춘다 (렌더 도중 풀면 WASM 이 해제된 문서를 만진다)
      setTimeout(() => doc?.free(), 0);
    };
  }, [p.path, p.liveModified]);

  // 칸 너비에 맞춰 쪽을 줄인다 — 쪽마다 크기가 달라도(가로 쪽) 같은 배율로, 가장 넓은 쪽을 기준으로
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(MAX_W, el.clientWidth - 48)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const widest = useMemo(() => pages.reduce((w, pg) => Math.max(w, pg.w), 0) || 794, [pages]);
  const scale = width > 0 ? (width / widest) * p.zoom : 0;

  // 지금 보이는 쪽 — 머리에 「3 / 24쪽」
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setCur(Number((e.target as HTMLElement).dataset.i));
      },
      { root: el, rootMargin: "-45% 0px -45% 0px" },
    );
    el.querySelectorAll(".slide-card").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [pages.length]);

  useEffect(() => {
    p.setInfo(
      <span>
        {total ? `${cur + 1} / ${total}쪽` : "여는 중"}
        {total > pages.length && !err ? ` · 그리는 중 ${pages.length}` : ""} · 읽기 전용
      </span>,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, total, pages.length, err]);

  // ───────── [4] 찾기 ─────────

  const [find, setFind] = useState({ open: false, q: "" });
  const [hit, setHit] = useState(-1);
  const findInput = useRef<HTMLInputElement>(null);
  /** 찾은 곳마다 그 글자들의 자리 — rhwp 는 글자 하나를 <text> 하나로 그려 한 곳이 여러 Range 다. */
  const hits = useRef<Range[][]>([]);
  /** 찾은 곳을 다시 모은 횟수 — hits 는 ref 라 바뀌어도 다시 그리지 않는다. 찾은 수 · 쪽 수 글자를 고치려고 센다. */
  const [, setFound] = useState(0);
  useEffect(() => {
    p.findRef.current = () => {
      setFind((f) => ({ ...f, open: true }));
      requestAnimationFrame(() => findInput.current?.select());
    };
    return () => {
      p.findRef.current = null;
    };
  });
  // 쪽마다 글 마디를 차례로 이어 붙이고(빈칸은 그리지 않으니 빼고) 찾는다. 찾을 말의 빈칸도 뺀다 — 「산림 인접」이 「산림인접」과 맞는다.
  useEffect(() => {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const out: Range[][] = [];
    const q = find.open ? find.q.toLowerCase().replace(/\s+/g, "") : "";
    if (q) {
      for (const host of scroller.current?.querySelectorAll<HTMLElement>(".slide-host") ?? []) {
        const root = host.shadowRoot;
        if (!root) continue;
        const at: { n: Text; i: number }[] = [];
        let s = "";
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
          if (n.parentElement?.closest("style")) continue;
          const t = n.data;
          for (let i = 0; i < t.length; i++) {
            if (/\s/.test(t[i])) continue;
            s += t[i].toLowerCase();
            at.push({ n, i });
          }
        }
        for (let k = s.indexOf(q); k >= 0; k = s.indexOf(q, k + q.length)) {
          const rs: Range[] = [];
          for (let j = k; j < k + q.length; j++) {
            const r = new Range();
            r.setStart(at[j].n, at[j].i);
            r.setEnd(at[j].n, at[j].i + 1);
            rs.push(r);
          }
          out.push(rs);
        }
      }
    }
    hits.current = out;
    setFound((n) => n + 1);
    setHit(-1);
    if (hl) {
      const H = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
      if (out.length) hl.set("fd-find", new H(...out.flat()));
      else hl.delete("fd-find");
      hl.delete("fd-find-cur");
    }
    return () => {
      hl?.delete("fd-find");
      hl?.delete("fd-find-cur");
    };
  }, [find.open, find.q, pages.length, scale]);
  const go = (k: number) => {
    const all = hits.current;
    if (!all.length) return;
    const i = hit < 0 ? (k > 0 ? 0 : all.length - 1) : (hit + k + all.length) % all.length;
    setHit(i);
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    hl?.set("fd-find-cur", new H(...all[i]));
    all[i][0].startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const pagesWithHit = new Set(hits.current.map((h) => h[0].startContainer.getRootNode())).size;

  // ───────── [5] 단축키 ─────────

  const jump = (i: number) => {
    const n = Math.max(0, Math.min(pages.length - 1, i));
    scroller.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    const k = e.key;
    let done = true;
    if (k === "PageDown") jump(cur + 1);
    else if (k === "PageUp") jump(cur - 1);
    else if (k === "Home" && e.ctrlKey) jump(0);
    else if (k === "End" && e.ctrlKey) jump(pages.length - 1);
    else if (k === "F3") go(e.shiftKey ? -1 : 1);
    else done = false;
    if (done) e.preventDefault();
  };
  // 열자마자 쪽 넘기기 · 화살표 굴리기 키가 듣게
  useEffect(() => {
    if (p.active && !stripHasFocus()) scroller.current?.focus();
  }, [p.active]);

  return (
    <div className="viewer-slides">
      {!err && pages.length > 0 && total > pages.length && <div className="busy-line" aria-hidden="true" />}
      {find.open && (
        <div className="table-find" role="search">
          <div className="table-find-row">
            <input
              ref={findInput}
              className="table-find-q"
              placeholder="찾을 말"
              aria-label="찾을 말"
              autoFocus
              value={find.q}
              onChange={(e) => setFind({ ...find, q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "F3") e.preventDefault(), go(e.shiftKey ? -1 : 1);
                else if (e.key === "Escape") e.preventDefault(), setFind({ ...find, open: false }), scroller.current?.focus();
              }}
            />
            <span className="table-find-count" aria-live="polite">
              {find.q.trim() ? (hits.current.length ? `${hit >= 0 ? hit + 1 : "-"} / ${hits.current.length}곳 · ${pagesWithHit}쪽` : "없음") : ""}
            </span>
            <button type="button" className="act" onClick={() => go(-1)} title="이전 · Shift+Enter">
              이전
            </button>
            <button type="button" className="act" onClick={() => go(1)} title="다음 · Enter">
              다음
            </button>
            <button type="button" className="act table-find-x" onClick={() => (setFind({ ...find, open: false }), scroller.current?.focus())} aria-label="닫기" title="닫기 · Esc">
              ×
            </button>
          </div>
        </div>
      )}
      {err && (
        <div className="viewer-bar warn" role="alert">
          <span>{err}</span>
        </div>
      )}
      <div className="slides-scroll" ref={scroller} tabIndex={0} onKeyDown={onKey} aria-label="쪽 · PageDown · PageUp 으로 넘기기">
        {scale > 0 &&
          pages.map((pg, i) => (
            <section className="slide-card hwp-page" key={i} data-i={i} aria-label={`${i + 1}쪽`}>
              <div className="slide-no">{i + 1}</div>
              <div className="slide-frame" style={{ width: pg.w * scale, height: pg.h * scale }}>
                <PageHost svg={pg.svg} scale={scale} w={pg.w} h={pg.h} />
              </div>
            </section>
          ))}
        {/* 첫 쪽이 오기 전 — 쪽 모양 자리. 2026.11.26 : 예전 「여는 중」 글은 조건(total > 0)에 걸려 한 번도 보이지 않았고 빈 칸이었다 */}
        {!err && pages.length === 0 && <Skeleton kind="pages" note={coldStart ? "한글 읽기 엔진을 처음 불러오는 중" : undefined} />}
        {!err && pages.length > 0 && total > pages.length && <div className="viewer-empty slides-loading">쪽을 그리는 중 · {pages.length} / {total}</div>}
      </div>
    </div>
  );
}

// ───────── [3] 쪽 ─────────

/** 찾기 강조 — 그림자 뿌리 안이라 앱 서식이 닿지 않아 여기에 둔다. */
const PAGE_CSS = "svg { display: block; } ::highlight(fd-find) { fill: #000; background: rgba(255, 200, 0, 0.6); } ::highlight(fd-find-cur) { background: rgba(255, 140, 0, 0.85); }";

function PageHost({ svg, scale, w, h }: { svg: string; scale: number; w: number; h: number }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    // rhwp 가 만든 SVG 다. 그래도 스크립트 · 이벤트 속성은 걷는다 — 문서 안 개체가 그대로 옮겨져 올 수 있어서 (CSP 도 막는다)
    const clean = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");
    root.innerHTML = `<style>${PAGE_CSS}</style>${clean}`;
  }, [svg]);
  return <div className="slide-host" ref={host} style={{ width: w, height: h, transform: `scale(${scale})` }} />;
}
