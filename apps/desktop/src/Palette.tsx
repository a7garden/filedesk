// 명령 팔레트 — Ctrl+K. 자리로 가기 · 명령 · 색 모아 보기 · 찾기를 한 칸에서.
//
// 2026.11.11 : 왼쪽 목록이 길어지고(즐겨찾기 · 색 · 드라이브) 명령이 메뉴 · 단축키 · 아래 줄에 흩어져 있어,
//   이름을 아는 곳으로 가거나 이름을 아는 명령을 부르는 데 손이 많이 갔다. 이름 몇 자(초성도 된다: 「ㅅㄹ」→ 산림)로 바로 간다.
//
// 결과 순서: 맞는 정도(앞부분이 맞으면 위) → 묶음 차례(자리 · 명령 · 색). 찾는 말이 있으면 맨 아래에 「찾기」 두 줄이 늘 붙는다.
import { useEffect, useMemo, useRef, useState } from "react";
import { TAG_COLORS, TAG_LABEL, type TagColor } from "./api";
import { TagDot } from "./TagMenu";

export type PaletteItem = {
  id: string;
  group: "위치" | "명령" | "색 표시" | "찾기";
  label: string;
  /** 오른쪽에 흐리게 — 경로 · 단축키. */
  hint?: string;
  color?: TagColor;
  run: () => void;
};

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
/** 한글 음절을 초성으로 (「산림」 → 「ㅅㄹ」). 다른 글자는 그대로. */
function choseong(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
const isJamoOnly = (s: string) => /^[ㄱ-ㅎ\s]+$/.test(s);

/** 맞는 정도 — 0 이면 안 맞는다. 말을 빈칸으로 나눠 모두 들어 있어야 하고, 앞에서 맞으면 높다. */
function score(label: string, hint: string, q: string): number {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const hay = label.toLowerCase();
  const hayAll = `${hay} ${hint.toLowerCase()}`;
  const cho = choseong(label);
  let total = 0;
  for (const t of terms) {
    const jamo = isJamoOnly(t);
    const i = jamo ? cho.indexOf(t) : hay.indexOf(t);
    if (i === 0) total += 3;
    else if (i > 0) total += 2;
    else if (!jamo && hayAll.includes(t)) total += 1;
    else return 0;
  }
  return total;
}

const GROUP_ORDER: PaletteItem["group"][] = ["위치", "명령", "색 표시", "찾기"];

export default function Palette({ items, onSearch, onClose }: { items: PaletteItem[]; onSearch: (q: string, scope: "below" | "content") => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const shown = useMemo(() => {
    const colorItems: PaletteItem[] = TAG_COLORS.map((c) => ({
      id: `color:${c}`,
      group: "색 표시",
      label: `${TAG_LABEL[c]} 표시 모아 보기`,
      color: c,
      run: () => window.dispatchEvent(new CustomEvent("fd:tagged", { detail: c })),
    }));
    const scored = [...items, ...colorItems]
      .map((it) => ({ it, s: score(it.label, it.hint ?? "", q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || GROUP_ORDER.indexOf(a.it.group) - GROUP_ORDER.indexOf(b.it.group))
      .slice(0, 40)
      .map((x) => x.it);
    const query = q.trim();
    if (query) {
      scored.push(
        { id: "find:below", group: "찾기", label: `하위 폴더까지 「${query}」`, hint: "이름 · 메모", run: () => onSearch(query, "below") },
        { id: "find:content", group: "찾기", label: `문서 본문까지 「${query}」`, hint: "hwpx · docx · pptx · xlsx · pdf", run: () => onSearch(query, "content") },
      );
    }
    return scored;
  }, [items, q, onSearch]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <div className="pal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="명령 팔레트">
        <input
          ref={inputRef}
          className="pal-input"
          value={q}
          placeholder="위치 · 명령 · 색 표시 — 초성으로도 찾는다 (ㅅㄹ → 산림)"
          aria-label="찾을 말"
          aria-controls="pal-list"
          aria-activedescendant={shown[at] ? `pal-${shown[at].id}` : undefined}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(shown.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(shown[at]);
            }
          }}
        />
        <ul id="pal-list" ref={listRef} className="pal-list" role="listbox" aria-label="결과">
          {shown.map((it, i) => (
            <li
              key={it.id}
              id={`pal-${it.id}`}
              data-i={i}
              role="option"
              aria-selected={i === at}
              className={"pal-item" + (i === at ? " at" : "") + (i > 0 && shown[i - 1].group !== it.group ? " gap" : "")}
              onMouseMove={() => setAt(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                run(it);
              }}
            >
              <span className="pal-group">{i === 0 || shown[i - 1].group !== it.group ? it.group : ""}</span>
              {it.color && <TagDot color={it.color} />}
              <span className="pal-label">{it.label}</span>
              {it.hint && <span className="pal-hint">{it.hint}</span>}
            </li>
          ))}
          {shown.length === 0 && <li className="pal-empty">맞는 것이 없다</li>}
        </ul>
        <div className="pal-foot">↑↓ 고르기 · Enter 하기 · Esc 닫기</div>
      </div>
    </div>
  );
}
