// 앱 안 보기 — 파워포인트 미리보기. 쪽을 HTML 로 그려(pptx.ts) 위에서 아래로 늘어놓는다. 읽기만 한다.
//
// 목차
//   [1] 불러오기 — raw: 로 파일을 받아 쪽마다 그린다 (앞쪽부터 보인다)
//   [2] 쪽 — 그림자 뿌리(shadow root)에 쪽 HTML 을 넣고 칸 너비에 맞춰 줄인다
//   [3] 찾기 — 쪽 글에서 찾고 그 자리를 밝힌다 (CSS Custom Highlight)
//   [4] 단축키 — PageDown · PageUp · Home · End 로 쪽 넘기기
//
// 2026.11.25 : 사용자 요청으로 더했다. 변환은 ClaudePPT 의 PPTX 가져오기를 옮겨 온 것이다 (pptx.ts 머리말).
// 쪽마다 그림자 뿌리에 넣는 까닭: 쪽 HTML 은 절대 위치 · 자기 글꼴 · 자기 서식을 갖는다 — 앱 서식과 섞이면 둘 다 깨진다.
//   iframe 보다 가볍고, 그림 blob 주소를 그대로 쓴다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderPptx, slideCss, type SlidePreview } from "./pptx";
import { errText } from "./util";
import { rawUrl } from "./viewable";

type Props = {
  path: string;
  /** 목록의 수정 시각 — 밖에서 고치면 다시 그린다. */
  liveModified?: number;
  setInfo: (n: React.ReactNode) => void;
  findRef: React.MutableRefObject<((replace: boolean) => void) | null>;
  active: boolean;
};

/** 못 옮긴 것의 이름 (pptx.ts 의 warnings). */
const WARN: Record<string, string> = { chart: "차트", object: "SmartArt · 개체", emf: "EMF 그림", custGeom: "자유형 도형" };
/** 쪽 너비 상한 — 넓은 창에서 쪽이 너무 커지지 않게. */
const MAX_W = 1100;

// ───────── [1] 불러오기 ─────────

export default function SlidesView(p: Props) {
  const [slides, setSlides] = useState<SlidePreview[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<{ size: { w: number; h: number }; font: string; warnings: string[] } | null>(null);
  const [err, setErr] = useState("");
  const [cur, setCur] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let gone = false;
    let revoke = () => {};
    setSlides([]);
    setTotal(0);
    setMeta(null);
    setErr("");
    fetch(rawUrl(p.path, p.liveModified))
      .then((r) => {
        if (!r.ok) throw new Error("파일을 읽지 못함");
        return r.arrayBuffer();
      })
      .then((buf) =>
        renderPptx(
          new Uint8Array(buf),
          (_, n, s) => {
            if (gone) return;
            setTotal(n);
            setSlides((v) => [...v, s]);
          },
          () => gone,
        ),
      )
      .then((res) => {
        revoke = res.revoke;
        // 다 그리기 전에 다른 파일로 갔으면 만든 그림을 바로 푼다
        if (gone) return res.revoke();
        setMeta({ size: res.size, font: res.font, warnings: res.warnings });
        if (res.slides.length === 0) setErr("쪽이 없는 파일");
      })
      .catch((e) => !gone && setErr(errText(e).includes("presentation.xml") ? "파워포인트 파일이 아니거나 손상됨" : errText(e)));
    return () => {
      gone = true;
      revoke();
    };
  }, [p.path, p.liveModified]);

  // 쪽 크기는 다 읽기 전에도 첫 쪽에서 안다 — 쪽 틀은 16:9 로 두고 다 읽으면 맞춘다
  const size = meta?.size ?? { w: 1280, h: 720 };
  const css = useMemo(() => slideCss(size, meta?.font ?? "") + "::highlight(fd-find) { background: rgba(255, 200, 0, 0.45); } ::highlight(fd-find-cur) { background: rgba(255, 140, 0, 0.75); }", [size.w, size.h, meta?.font]);

  // 칸 너비에 맞춰 쪽을 줄인다
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(MAX_W, el.clientWidth - 48)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = width > 0 ? width / size.w : 0;

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
  }, [slides.length]);

  useEffect(() => {
    p.setInfo(
      <span>
        {total ? `${cur + 1} / ${total}쪽` : "여는 중"}
        {total > slides.length ? ` · 그리는 중 ${slides.length}` : ""} · 읽기 전용
      </span>,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, total, slides.length]);

  // ───────── [3] 찾기 ─────────

  const [find, setFind] = useState({ open: false, q: "" });
  const [hit, setHit] = useState(-1);
  const findInput = useRef<HTMLInputElement>(null);
  const ranges = useRef<Range[]>([]);
  useEffect(() => {
    p.findRef.current = () => {
      setFind((f) => ({ ...f, open: true }));
      requestAnimationFrame(() => findInput.current?.select());
    };
    return () => {
      p.findRef.current = null;
    };
  });
  // 찾은 자리를 모은다 — 쪽마다 그림자 뿌리의 글 마디를 훑는다. 한 낱말이 서식으로 나뉘어 있으면(굵게 한 글자 등) 그 낱말은 못 찾는다.
  useEffect(() => {
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const out: Range[] = [];
    const q = find.open ? find.q.toLowerCase() : "";
    if (q) {
      for (const host of scroller.current?.querySelectorAll<HTMLElement>(".slide-host") ?? []) {
        const root = host.shadowRoot;
        if (!root) continue;
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const t = (n.textContent ?? "").toLowerCase();
          for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) {
            const r = new Range();
            r.setStart(n, i);
            r.setEnd(n, i + q.length);
            out.push(r);
          }
        }
      }
    }
    ranges.current = out;
    setHit(-1);
    if (hl) {
      const H = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
      if (out.length) hl.set("fd-find", new H(...out));
      else hl.delete("fd-find");
      hl.delete("fd-find-cur");
    }
    return () => {
      hl?.delete("fd-find");
      hl?.delete("fd-find-cur");
    };
  }, [find.open, find.q, slides.length, scale]);
  const go = (k: number) => {
    const all = ranges.current;
    if (!all.length) return;
    const i = hit < 0 ? (k > 0 ? 0 : all.length - 1) : (hit + k + all.length) % all.length;
    setHit(i);
    const hl = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const H = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    hl?.set("fd-find-cur", new H(all[i]));
    // 그림자 뿌리 안 글의 자리를 화면 좌표로 — 그 쪽 카드를 굴려 가운데로
    const el = all[i].startContainer.parentElement;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const slidesWithHit = useMemo(() => {
    if (!find.open || !find.q) return 0;
    const q = find.q.toLowerCase();
    return slides.filter((s) => s.text.toLowerCase().includes(q) || s.notes.toLowerCase().includes(q)).length;
  }, [find.open, find.q, slides]);

  // ───────── [4] 단축키 ─────────

  const jump = (i: number) => {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    scroller.current?.querySelector(`[data-i="${n}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    const k = e.key;
    let done = true;
    if (k === "PageDown" || k === " " || k === "ArrowRight") jump(cur + 1);
    else if (k === "PageUp" || k === "ArrowLeft") jump(cur - 1);
    else if (k === "Home") jump(0);
    else if (k === "End") jump(slides.length - 1);
    else if (k === "F3") go(e.shiftKey ? -1 : 1);
    else done = false;
    if (done) e.preventDefault();
  };
  // 열자마자 쪽 넘기기 키가 듣게
  useEffect(() => {
    if (p.active) scroller.current?.focus();
  }, [p.active]);

  const warn = meta?.warnings.map((w) => WARN[w]).filter(Boolean) ?? [];
  return (
    <div className="viewer-slides">
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
              {find.q ? (ranges.current.length ? `${hit >= 0 ? hit + 1 : "-"} / ${ranges.current.length}곳 · ${slidesWithHit}쪽` : slidesWithHit ? `메모에서 ${slidesWithHit}쪽` : "없음") : ""}
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
      {warn.length > 0 && (
        <div className="viewer-bar" role="note">
          <span>{warn.join(" · ")}은(는) 자리만 점선으로 표시 · 정확한 모양은 기본 앱으로</span>
        </div>
      )}
      <div className="slides-scroll" ref={scroller} tabIndex={0} onKeyDown={onKey} aria-label="쪽 · PageDown · PageUp 으로 넘기기">
        {scale > 0 &&
          slides.map((s, i) => (
            <section className="slide-card" key={i} data-i={i} aria-label={`${i + 1}쪽${s.title ? ` · ${s.title}` : ""}`}>
              <div className="slide-no">
                {i + 1}
                {s.title && <span className="slide-title">{s.title}</span>}
              </div>
              <div className="slide-frame" style={{ width: size.w * scale, height: size.h * scale }}>
                <SlideHost html={s.html} css={css} scale={scale} size={size} />
              </div>
              {s.notes && <p className="slide-notes">{s.notes}</p>}
            </section>
          ))}
        {!err && total > slides.length && <div className="viewer-empty slides-loading">쪽을 그리는 중 · {slides.length} / {total}</div>}
      </div>
    </div>
  );
}

// ───────── [2] 쪽 ─────────

function SlideHost({ html, css, scale, size }: { html: string; css: string; scale: number; size: { w: number; h: number } }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${css}</style>${html}`;
  }, [html, css]);
  return <div className="slide-host" ref={host} style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} />;
}
