// 오른쪽 메뉴 — filedesk 가 그리는 메뉴. 자주 하는 일을 먼저 두고, 셸 메뉴 전체는 맨 아래 「더 보기」로 연다.
//
// 2026.11.13 : 사용자 요청. 셸 메뉴 위에 filedesk 항목을 얹던 것(11.11~)은 셸 확장(TortoiseSVN · 반디집 · 보내기 …)이 늘어날수록
//   길어져 자주 쓰는 일이 묻혔고, 색 · 판 같은 filedesk 일은 Windows 메뉴 꼴(글 한 줄)에 갇혔다. Windows 11 처럼 두 겹으로 나눈다 —
//   이 메뉴는 짧게, 셸 일은 「더 보기」 · Shift+오른쪽 단추 · Shift+F10.
//
// 항목 꼴 넷: 글 항목(하위 메뉴 가능) · 구분선 "sep" · 그림 단추 줄(잘라내기 · 복사 …, `quick`) · 색 점 줄(`colors`).
// 키보드: ↑ ↓ 항목 · ← → 줄 안에서 옮기기 · 하위 메뉴 열고 닫기 · Enter 고르기 · Esc 한 겹 닫기.
// 고르면 메뉴를 먼저 닫고 다음 그림에서 일을 한다 — 「더 보기」의 셸 메뉴가 이 메뉴 위에 겹쳐 뜨지 않게.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { TAG_COLORS, TAG_LABEL, type TagColor } from "./api";

export type QuickIcon = "cut" | "copy" | "rename" | "trash";
export type CtxItem = { label: string; hint?: string; run?: () => void; children?: CtxEntry[]; disabled?: boolean; checked?: boolean; strong?: boolean };
export type CtxEntry =
  | "sep"
  | CtxItem
  | { quick: { icon: QuickIcon; label: string; hint?: string; run: () => void; disabled?: boolean }[] }
  | { colors: TagColor | null | undefined; pick: (c: TagColor | null) => void };

export type CtxMenuState = { x: number; y: number; label: string; items: CtxEntry[] };

/** 메뉴를 띄운다. 밖을 누르거나 · 창이 초점을 잃거나 · 크기가 바뀌면 닫힌다. */
export default function ContextMenu({ menu, onClose }: { menu: CtxMenuState; onClose: () => void }) {
  useEffect(() => {
    const away = (e: MouseEvent) => !(e.target as HTMLElement).closest?.(".ctx-menu") && onClose();
    window.addEventListener("mousedown", away, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return <Level x={menu.x} y={menu.y} flipX={menu.x} items={menu.items} label={menu.label} close={onClose} />;
}

type LevelProps = {
  x: number;
  y: number;
  /** 오른쪽이 모자랄 때 이 x 에 오른쪽 끝을 맞춘다 — 첫 겹은 누른 자리, 하위 메뉴는 부모 메뉴의 왼쪽 끝. */
  flipX: number;
  items: CtxEntry[];
  label: string;
  close: () => void;
  /** 하위 메뉴만 — 이 겹을 닫고 부모 항목으로 초점을 돌린다. */
  back?: () => void;
  focusFirst?: boolean;
};

function Level({ x, y, flipX, items, label, close, back, focusFirst }: LevelProps) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [sub, setSub] = useState<{ i: number; x: number; y: number; flipX: number; focus: boolean } | null>(null);
  const hover = useRef(0);

  // 재고 나서 놓는다 — 창 오른쪽 · 아래 끝을 넘으면 반대로 편다.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = x + w > window.innerWidth - 4 ? Math.max(4, flipX - w) : x;
    const top = y + h > window.innerHeight - 4 ? Math.max(4, window.innerHeight - 4 - h) : y;
    setPos({ left, top });
  }, [x, y, flipX]);

  useEffect(() => {
    if (!pos) return;
    if (focusFirst) stops()[0]?.focus();
    else box.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos != null]);
  useEffect(() => () => window.clearTimeout(hover.current), []);

  /** ↑ ↓ 가 서는 자리 — 글 항목 하나 · 단추 줄 하나가 한 자리. */
  const stops = (): HTMLElement[] => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>(":scope > [data-stop]") ?? [])];
    return all
      .map((s) => (s.tagName === "BUTTON" ? s : (s.querySelector<HTMLElement>("button.on:not(:disabled)") ?? s.querySelector<HTMLElement>("button:not(:disabled)"))))
      .filter((b): b is HTMLElement => !!b && !(b as HTMLButtonElement).disabled);
  };

  const openSub = (i: number, el: HTMLElement, focus: boolean) => {
    const r = el.getBoundingClientRect();
    const parent = box.current!.getBoundingClientRect();
    setSub({ i, x: parent.right - 2, y: r.top - 5, flipX: parent.left + 2, focus });
  };

  const choose = (run?: () => void) => {
    close();
    if (run) requestAnimationFrame(() => run());
  };

  const onKey = (e: ReactKeyboardEvent) => {
    // 이 메뉴 안의 키는 목록 단축키로 새지 않게 여기서 끝낸다
    e.stopPropagation();
    const a = document.activeElement as HTMLElement | null;
    // 하위 메뉴가 받은 키는 그쪽이 처리했다
    if (a && !box.current?.contains(a) && a !== box.current) return;
    const row = a?.closest(".ctx-row");
    const list = stops();
    const at = list.findIndex((s) => s === a || (row && row.contains(s)));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      list[at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + d + list.length) % list.length]?.focus();
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && row && a) {
      e.preventDefault();
      const btns = [...row.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const i = btns.indexOf(a as HTMLButtonElement);
      btns[(i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length]?.focus();
    } else if (e.key === "ArrowRight" && a?.dataset.i && a.getAttribute("aria-haspopup")) {
      e.preventDefault();
      openSub(Number(a.dataset.i), a, true);
    } else if (e.key === "ArrowLeft" && back) {
      e.preventDefault();
      back();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (back) back();
      else close();
    } else if (e.key === "Tab") e.preventDefault();
  };

  const subItem = sub ? (items[sub.i] as CtxItem) : null;

  return (
    <>
      <div
        ref={box}
        className="ctx-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? undefined : "hidden" }}
        onKeyDown={onKey}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {items.map((it, i) => {
          if (it === "sep") return <div key={i} className="pop-sep" role="separator" />;
          if ("quick" in it)
            return (
              <div key={i} className="ctx-row ctx-quick" role="group" data-stop onMouseEnter={() => setSub(null)}>
                {it.quick.map((q) => (
                  <button
                    key={q.icon}
                    role="menuitem"
                    disabled={q.disabled}
                    aria-label={q.label}
                    title={q.hint ? `${q.label} (${q.hint})` : q.label}
                    onClick={() => choose(q.run)}
                  >
                    <QuickGlyph icon={q.icon} />
                  </button>
                ))}
              </div>
            );
          if ("colors" in it)
            return (
              <div key={i} className="ctx-row ctx-colors" role="group" aria-label="색 표시" data-stop onMouseEnter={() => setSub(null)}>
                {TAG_COLORS.map((c, n) => (
                  <button
                    key={c}
                    role="menuitemradio"
                    aria-checked={it.colors === c}
                    aria-label={TAG_LABEL[c]}
                    title={`${TAG_LABEL[c]} (Alt+${n + 1})`}
                    className={`tag-swatch tag-${c}` + (it.colors === c ? " on" : "")}
                    onClick={() => choose(() => it.pick(it.colors === c ? null : c))}
                  />
                ))}
                <button className="ctx-clear" role="menuitem" disabled={!it.colors} aria-label="색 지우기" title="색 지우기 (Alt+0)" onClick={() => choose(() => it.pick(null))}>
                  ×
                </button>
              </div>
            );
          const hasSub = !!it.children?.length;
          return (
            <button
              key={i}
              data-stop
              data-i={i}
              className={"ctx-item" + (it.strong ? " strong" : "") + (sub?.i === i ? " sub-open" : "")}
              role={it.checked != null ? "menuitemcheckbox" : "menuitem"}
              aria-checked={it.checked}
              aria-haspopup={hasSub ? "menu" : undefined}
              aria-expanded={hasSub ? sub?.i === i : undefined}
              disabled={it.disabled}
              onMouseEnter={(e) => {
                window.clearTimeout(hover.current);
                const el = e.currentTarget;
                // 하위 메뉴는 잠깐 머물러야 열고 닫는다 — 대각선으로 하위 메뉴로 가는 손이 다른 항목을 스쳐도 닫히지 않게
                hover.current = window.setTimeout(() => (hasSub ? openSub(i, el, false) : setSub(null)), 140);
              }}
              onClick={(e) => (hasSub ? openSub(i, e.currentTarget, false) : choose(it.run))}
            >
              <span className="pop-check">{it.checked ? "✓" : ""}</span>
              <span className="ctx-label">{it.label}</span>
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
              {hasSub && <span className="ctx-more" aria-hidden="true">›</span>}
            </button>
          );
        })}
      </div>
      {sub && subItem?.children && (
        <Level
          key={sub.i}
          x={sub.x}
          y={sub.y}
          flipX={sub.flipX}
          items={subItem.children}
          label={subItem.label}
          close={close}
          focusFirst={sub.focus}
          back={() => {
            const i = sub.i;
            setSub(null);
            box.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.focus();
          }}
        />
      )}
    </>
  );
}

/** 단추 줄 그림 — 16 칸 선 그림. 자리 그림(PlaceGlyph)과 같은 굵기. */
function QuickGlyph({ icon }: { icon: QuickIcon }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const body: Record<QuickIcon, ReactNode> = {
    cut: (
      <>
        <circle cx="4.5" cy="11.5" r="2" {...p} />
        <circle cx="11.5" cy="11.5" r="2" {...p} />
        <path d="M6 10 11.5 2.5M10 10 4.5 2.5" {...p} />
      </>
    ),
    copy: (
      <>
        <rect x="5.5" y="5.5" width="8" height="8.5" rx="1.5" {...p} />
        <path d="M3.5 10.5h-.25c-.69 0-1.25-.56-1.25-1.25v-6c0-.69.56-1.25 1.25-1.25h6c.69 0 1.25.56 1.25 1.25v.25" {...p} />
      </>
    ),
    rename: (
      <>
        <path d="M2 4.5h7M2 11.5h5" {...p} />
        <path d="M12 2.5v11M10.5 2.5h3M10.5 13.5h3" {...p} />
      </>
    ),
    trash: (
      <>
        <path d="M2.5 4h11M6.5 4V2.75h3V4" {...p} />
        <path d="M4 4l.6 8.6c.05.8.7 1.4 1.5 1.4h3.8c.8 0 1.45-.6 1.5-1.4L12 4M6.75 7v4.5M9.25 7v4.5" {...p} />
      </>
    ),
  };
  return (
    <svg className="glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {body[icon]}
    </svg>
  );
}
