// 끌어서 차례 바꾸기 — 세로 목록 하나. 설정 「사이드바」 구획 · 「종류」 줄이 쓴다.
//
//   잡는 곳(손잡이 단추)을 누르고 끌면 그 줄이 손을 따라오고, 지나치는 줄들이 비켜서서 놓일 자리가 열린다. 놓으면 그 자리로.
//   손잡이에 초점을 두고 ↑ ↓ 로도 옮긴다 (끌 수 없는 사람 · 키보드만 쓰는 사람).
//
//   2026.11.24 : ↑ ↓ 단추 두 개를 줄마다 두던 것을 바꿨다 — 사용자 요청. 다섯 칸 옮기려면 다섯 번 눌러야 했고,
//   단추가 줄마다 서서 목록이 시끄러웠다.
//   웹 끌기(HTML5 DnD)를 쓰지 않는다 — Tauri 가 창 밖 파일 끌기를 받으려고 막아 두었다. 포인터 움직임으로 짠다 (KindsEditor 칩 · FavDock 과 같다).
import { useRef, useState } from "react";

type Drag = { from: number; to: number; dy: number; startY: number; tops: number[]; hs: number[]; shift: number };

/** n 줄 목록의 끌기. 줄마다 `data-sort-item` 을 달고, 손잡이에 handle(i) 를, 줄에 item(i) 를 펼친다.
 *  onMove(from, to) — from 줄을 to 자리로 (to 는 옮긴 뒤 차례). */
export function useDragSort<E extends HTMLElement = HTMLElement>(n: number, onMove: (from: number, to: number) => void) {
  const list = useRef<E>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const rows = () => [...(list.current?.querySelectorAll<HTMLElement>(":scope > [data-sort-item]") ?? [])];

  /** 옮긴 뒤 손잡이 초점을 따라 보낸다 — 키보드로 연달아 옮길 수 있게. */
  const refocus = (to: number) =>
    requestAnimationFrame(() => rows()[to]?.querySelector<HTMLElement>("[data-sort-handle]")?.focus());

  const handle = (i: number, label: string) => ({
    "data-sort-handle": "",
    "aria-label": `${label} 순서 바꾸기`,
    title: "끌어서 순서 바꾸기 · 방향키 ↑ ↓",
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rs = rows().map((r) => r.getBoundingClientRect());
      if (rs.length !== n) return;
      const tops = rs.map((r) => r.top);
      const hs = rs.map((r) => r.height);
      // 비켜서는 거리 = 끈 줄 높이 + 줄 사이 틈
      const gap = n > 1 ? tops[1] - tops[0] - hs[0] : 0;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ from: i, to: i, dy: 0, startY: e.clientY, tops, hs, shift: hs[i] + gap });
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) =>
      setDrag((d) => {
        if (!d) return d;
        // 목록 밖으로 나가지 않게 — 맨 위 · 맨 아래 줄 자리까지만
        const lo = d.tops[0] - d.tops[d.from];
        const hi = d.tops[n - 1] + d.hs[n - 1] - (d.tops[d.from] + d.hs[d.from]);
        const dy = Math.max(lo, Math.min(hi, e.clientY - d.startY));
        const mid = d.tops[d.from] + d.hs[d.from] / 2 + dy;
        let to = 0;
        for (let j = 0; j < n; j++) if (j !== d.from && d.tops[j] + d.hs[j] / 2 < mid) to++;
        return { ...d, dy, to };
      }),
    onPointerUp: () => {
      if (drag && drag.to !== drag.from) onMove(drag.from, drag.to);
      setDrag(null);
    },
    onLostPointerCapture: () => setDrag(null),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const d = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const to = i + d;
      if (to < 0 || to >= n) return;
      onMove(i, to);
      refocus(to);
    },
  });

  /** 줄의 자리 — 끈 줄은 손을 따라가고, 그 사이 줄은 한 칸 비켜선다. */
  const item = (i: number) => {
    if (!drag) return { "data-sort-item": "" };
    const { from, to, dy, shift } = drag;
    let y = 0;
    if (i === from) y = dy;
    else if (from < to && i > from && i <= to) y = -shift;
    else if (to < from && i >= to && i < from) y = shift;
    return {
      "data-sort-item": "",
      "data-lifted": i === from ? "" : undefined,
      style: { transform: y ? `translateY(${y}px)` : undefined },
    };
  };

  return { list, handle, item, dragging: drag != null };
}

/** 배열에서 from 을 빼 to 자리에 넣는다. */
export function moveTo<T>(xs: T[], from: number, to: number): T[] {
  const n = [...xs];
  const [x] = n.splice(from, 1);
  n.splice(to, 0, x);
  return n;
}
