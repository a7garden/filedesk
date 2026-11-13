// 격자 보기 — 파일을 칸으로 늘어놓는다. 칸 크기 넷(작게 · 보통 · 크게 · 아주 크게)은 설정 · 아래 단추 · Ctrl+휠.
//
// 한 줄에 들어가는 칸 수는 목록 너비로 정하고, 줄 단위로 가상 스크롤한다 (수만 개 폴더도 보이는 줄만 그린다).
// 칸 안 모양(아이콘 · 이름 · 판 · 메모)은 Pane 이 그린다 — 고르기 · 끌기 · 오른쪽 메뉴가 목록과 같은 함수를 쓰게.
// 2026.11.11 : 사용자 요청으로 더했다. 판을 펼치는 일은 목록에서 한다 (칸으로 펼치면 어느 판이 어느 문서 것인지 흐려진다).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** 크기마다 칸 너비 · 그림 크기 (px). 칸 높이 = 그림 + 이름 두 줄 + 덧붙임 한 줄. */
export const TILE = [
  { w: 92, icon: 40 },
  { w: 120, icon: 64 },
  { w: 156, icon: 96 },
  { w: 212, icon: 148 },
];
export const tileHeight = (size: number) => TILE[size].icon + 74;

type Props<T> = {
  items: T[];
  size: number;
  /** 스크롤하는 바깥 목록 (Pane 의 `.list`). */
  scrollEl: RefObject<HTMLDivElement | null>;
  focusIndex: number | null;
  onCols: (n: number) => void;
  renderTile: (item: T, style: CSSProperties) => ReactNode;
};

const PAD = 12;

export default function GridView<T>({ items, size, scrollEl, focusIndex, onCols, renderTile }: Props<T>) {
  const [width, setWidth] = useState(0);
  const t = TILE[Math.min(3, Math.max(0, size))];
  const h = tileHeight(Math.min(3, Math.max(0, size)));

  // 목록 너비를 지켜본다. 2026.11.13 : 새 탭 · 앱을 켤 때 칸이 한 줄에 하나로 굳던 것을 고쳤다.
  //   이 격자는 `.list` 안에 그려진다. 둘이 함께 처음 그려질 때 React 는 자식의 layout effect 를 부모 ref 가 붙기 전에 돌려
  //   scrollEl.current 가 비어 있었고, 너비 0 · 지켜보기 없음으로 남았다. 그래서 layout effect(깜박임 없이) 와
  //   passive effect(ref 가 붙은 뒤) 양쪽에서 붙여 보고, 지켜보던 요소가 바뀌었으면(칸을 다시 그림) 새로 붙는다.
  const watched = useRef<{ el: HTMLElement; ro: ResizeObserver } | null>(null);
  const watch = () => {
    const el = scrollEl.current;
    if (!el || watched.current?.el === el) return;
    watched.current?.ro.disconnect();
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    watched.current = { el, ro };
    setWidth(el.clientWidth);
  };
  useLayoutEffect(watch);
  useEffect(watch);
  useEffect(
    () => () => {
      watched.current?.ro.disconnect();
      watched.current = null;
    },
    [],
  );

  const cols = Math.max(1, Math.floor((width - PAD * 2) / t.w));
  // 칸을 줄 너비에 고르게 펴서 오른쪽에 빈 띠가 남지 않게 한다.
  const cellW = cols > 0 && width ? Math.floor((width - PAD * 2) / cols) : t.w;
  // 중괄호로 감싼다 — 돌려준 값(숫자)을 React 가 정리 함수로 부르면 화면이 죽는다.
  useEffect(() => {
    onCols(cols);
  }, [cols, onCols]);

  const rowCount = Math.ceil(items.length / cols);
  const virt = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl.current,
    estimateSize: () => h,
    overscan: 4,
  });
  useEffect(() => {
    virt.measure();
  }, [h, cols, virt]);

  useEffect(() => {
    if (focusIndex == null) return;
    virt.scrollToIndex(Math.floor(focusIndex / cols), { align: "auto" });
  }, [focusIndex, cols, virt]);

  return (
    <div className="list-inner grid-inner" style={{ height: virt.getTotalSize() + PAD, ["--tile-icon" as string]: `${t.icon}px` }}>
      {virt.getVirtualItems().flatMap((v) => {
        const out: ReactNode[] = [];
        for (let c = 0; c < cols; c++) {
          const i = v.index * cols + c;
          if (i >= items.length) break;
          out.push(renderTile(items[i], { left: PAD + c * cellW, top: PAD / 2 + v.start, width: cellW - 6, height: h - 6 }));
        }
        return out;
      })}
    </div>
  );
}
