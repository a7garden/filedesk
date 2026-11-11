// 색 표시 고르기 — Finder 꼬리표처럼 일곱 색 중 하나. 목록 줄 · 왼쪽 즐겨찾기가 같은 꼴을 쓴다.
// 마우스 자리(또는 단추 아래)에 뜨고, 고르거나 · 밖을 누르거나 · Esc 면 닫힌다. 키보드는 ← → 로 옮기고 Enter.
import { useEffect, useRef, type ReactNode } from "react";
import { TAG_COLORS, TAG_LABEL, type TagColor } from "./api";

type Props = {
  x: number;
  y: number;
  current?: TagColor | null;
  onPick: (c: TagColor | null) => void;
  onClose: () => void;
  /** 색 아래에 덧붙일 동작 (즐겨찾기에서 빼기 등). */
  extra?: ReactNode;
};

export function TagDot({ color, title }: { color?: TagColor | null; title?: string }) {
  if (!color) return null;
  return <span className={`tag-dot tag-${color}`} role="img" aria-label={`색 표시 ${TAG_LABEL[color]}`} title={title ?? TAG_LABEL[color]} />;
}

export default function TagMenu({ x, y, current, onPick, onClose, extra }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(current ? `[data-color=${current}]` : "button")?.focus();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [current, onClose]);

  // 창 밖으로 나가지 않게 — 오른쪽 · 아래 끝에서 연 경우.
  const left = Math.min(x, window.innerWidth - 236);
  const top = Math.min(y, window.innerHeight - (extra ? 112 : 76));

  return (
    <div
      className="tag-menu"
      ref={box}
      role="menu"
      aria-label="색 표시"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const btns = [...(box.current?.querySelectorAll<HTMLButtonElement>(".tag-swatch") ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          btns[(i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length]?.focus();
        }
      }}
    >
      <div className="tag-row">
        {TAG_COLORS.map((c, i) => (
          <button
            key={c}
            role="menuitemradio"
            aria-checked={current === c}
            data-color={c}
            className={`tag-swatch tag-${c}` + (current === c ? " on" : "")}
            title={`${TAG_LABEL[c]} (Alt+${i + 1})`}
            aria-label={TAG_LABEL[c]}
            onClick={() => onPick(current === c ? null : c)}
          />
        ))}
      </div>
      {current && (
        <button className="tag-clear" role="menuitem" onClick={() => onPick(null)}>
          색 지우기 <span className="muted">Alt+0</span>
        </button>
      )}
      {extra}
    </div>
  );
}
