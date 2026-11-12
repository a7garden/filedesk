// 끌어서 고르기 — 목록 · 격자의 빈 곳(목록이면 줄의 이름 밖)을 누르고 끌면 네모를 그려, 네모에 걸린 항목을 고른다. 탐색기와 같다.
//
// 2026.11.12 : 사용자 요청으로 더했다. 그전에는 여러 개를 고르려면 Ctrl · Shift 누르기뿐이었다.
//
// 목록은 보이는 줄만 그린다(가상 스크롤). 그래서 걸린 항목을 DOM 으로만 세면, 끌며 스크롤해 화면 밖으로 나간 줄이 고른 것에서 빠진다.
// 한 번 그려진 항목의 자리(내용 좌표)를 끌기 동안 기억해 두고, 네모와 겹치는지는 그 기억으로 센다.
// 목록 위 · 아래 가장자리 가까이 끌면 그쪽으로 스크롤한다 — 화면보다 긴 범위를 한 번에 고르는 길이다.
import { useEffect, useRef, useState, type RefObject } from "react";

/** 네모를 그리기 시작하는 움직임(px) — 그 전에는 그냥 누르기다. */
const START_PX = 5;
/** 위 · 아래 가장자리에서 이만큼 안쪽이면 스크롤한다(px). */
const EDGE_PX = 28;
/** 한 번에 스크롤하는 최대 양(px · 약 16ms 마다). 가장자리를 넘어설수록 빨라진다. */
const SCROLL_MAX = 24;

type Box = { x: number; y: number; w: number; h: number };
type Drag = {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  on: boolean;
  base: Set<string>;
  seen: Map<string, Box>;
};

/**
 * @param scrollRef 스크롤하는 목록 (`.list`). 항목은 그 안의 `[data-path]`.
 * @param pick 네모에 걸린 경로들 · 시작 때 이미 고른 것(Ctrl 로 시작했을 때만 남긴다)으로 고른 것을 정한다.
 */
export function useMarquee(scrollRef: RefObject<HTMLDivElement | null>, selectable: (path: string) => boolean, pick: (hits: string[], base: Set<string>) => void) {
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  // 끌기 동안 바뀌어도 늘 마지막 것을 쓰게 — 효과를 다시 걸지 않는다
  const fns = useRef({ selectable, pick });
  fns.current = { selectable, pick };

  /** 화면 좌표 → 목록 내용 좌표 (스크롤을 더한 값). */
  const toContent = (el: HTMLElement, cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    return { x: cx - r.left + el.scrollLeft, y: cy - r.top + el.scrollTop };
  };

  const update = () => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const p = toContent(el, d.cx, d.cy);
    if (!d.on) {
      if (Math.hypot(p.x - d.x0, p.y - d.y0) < START_PX) return;
      d.on = true;
    }
    const b: Box = { x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) };
    // 지금 그려진 항목의 자리를 기억에 더한다
    const r = el.getBoundingClientRect();
    for (const it of el.querySelectorAll<HTMLElement>("[data-path]")) {
      const path = it.dataset.path!;
      if (!fns.current.selectable(path)) continue;
      const ir = it.getBoundingClientRect();
      d.seen.set(path, { x: ir.left - r.left + el.scrollLeft, y: ir.top - r.top + el.scrollTop, w: ir.width, h: ir.height });
    }
    const hits: string[] = [];
    for (const [path, s] of d.seen) {
      if (s.x < b.x + b.w && s.x + s.w > b.x && s.y < b.y + b.h && s.y + s.h > b.y) hits.push(path);
    }
    setBox(b);
    fns.current.pick(hits, d.base);
  };

  // 가장자리 스크롤 — 마우스가 멈춰 있어도 계속 굴러야 해서 시간으로 돈다. 누르고 있는 동안만 돈다
  const timer = useRef(0);
  const tick = () => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d?.on || !el) return;
    const r = el.getBoundingClientRect();
    const over = d.cy < r.top + EDGE_PX ? d.cy - (r.top + EDGE_PX) : d.cy > r.bottom - EDGE_PX ? d.cy - (r.bottom - EDGE_PX) : 0;
    if (!over) return;
    const before = el.scrollTop;
    el.scrollTop += Math.max(-SCROLL_MAX, Math.min(SCROLL_MAX, over / 2));
    if (el.scrollTop !== before) update();
  };
  const end = () => {
    drag.current = null;
    window.clearInterval(timer.current);
    timer.current = 0;
    setBox(null);
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!(e.buttons & 1)) return end();
      d.cx = e.clientX;
      d.cy = e.clientY;
      update();
    };
    const up = () => {
      if (drag.current) end();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);

  /** 누른 자리에서 시작한다. 움직임이 START_PX 를 넘어야 네모가 선다. base: 남겨 둘 고른 것 (Ctrl 로 시작했을 때만 채운다). */
  const start = (cx: number, cy: number, base: Set<string>) => {
    const el = scrollRef.current;
    if (!el) return;
    const p = toContent(el, cx, cy);
    drag.current = { x0: p.x, y0: p.y, cx, cy, on: false, base, seen: new Map() };
    if (!timer.current) timer.current = window.setInterval(tick, 16);
  };

  /** 지금 네모를 그리는 중인가 — 누르고 아직 START_PX 안이면 아니다. */
  const active = () => !!drag.current?.on;

  return { box, start, active };
}
