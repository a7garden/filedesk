// 판 목록 — 문서 하나의 판을 「이전판」 폴더에 든 것까지 새 판부터 한 줄씩 보인다. 판 글자(「v4 · 4판」)를 누르거나 메뉴 「판 목록 보기」로 연다.
//
// 2026.11.12 : 지난 판은 목록 보기에서 문서를 펼쳐야만 보였다 — 격자 보기에는 펼칠 자리가 없고, 펼침 꺾쇠는 작아 지나치기 쉽다.
//              판 눈금 점은 언제 · 어디에를 보이지만 무엇인지는 마우스를 올려야 알았다. 같은 내용을 누르면 뜨는 목록으로 준다.
// 2026.11.13 : 판 눈금(EditionTicks)을 걷었다 — 판이 언제 · 어디에 있는지는 이 목록만 말한다.
//
//   줄 하나 = 판 하나 (pptx · pdf 처럼 꼴만 다른 것은 한 줄, 꼴마다 여는 단추) · 줄을 누르면 첫 꼴을 연다
//   「폴더」 = 그 판이 든 폴더로 간다 (이전판 폴더 안을 탐색기처럼 보고 싶을 때)
//   ↑ ↓ 로 옮기고 Enter 로 연다 · 밖을 누르거나 Esc 면 닫힌다
import { useEffect, useRef } from "react";
import type { DocFile, DocGroup } from "./api";

type Props = {
  x: number;
  y: number;
  group: DocGroup;
  onOpen: (f: DocFile) => void;
  onFolder: (f: DocFile) => void;
  onClose: () => void;
};

type Ed = { key: string; files: DocFile[]; at: number; ver: number[]; here: boolean; retire: boolean; flag: boolean };

const cmpVer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** 판 날짜(YYYYMMDD)를 밀리초로. 이름에 날짜가 없으면 파일 고친 시각. */
function editionTime(f: DocFile): number {
  const d = f.parsed.date;
  return d.length === 8 ? Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) : f.modified;
}

/** 판 하나의 열쇠 — 판 번호 · 날짜 · 시각이 같으면 꼴만 다른 한 판. 목록의 「N판」도 이것으로 센다. */
export const editionKey = (f: DocFile) => `${f.parsed.version.join(".")}|${f.parsed.date}|${f.parsed.time}`;

/** 판으로 묶는다. 새 판이 위로. */
function editions(files: DocFile[]): Ed[] {
  const by = new Map<string, Ed>();
  for (const f of files) {
    const k = editionKey(f);
    const e = by.get(k);
    if (e) {
      e.files.push(f);
      e.here ||= !f.inHistory;
      e.retire ||= f.retire;
      e.flag ||= f.dupVer || f.backOrder;
    } else {
      by.set(k, { key: k, files: [f], at: editionTime(f), ver: f.parsed.version, here: !f.inHistory, retire: f.retire, flag: f.dupVer || f.backOrder });
    }
  }
  // 이 폴더에 있는 꼴을 먼저 — 줄을 누르면 여는 것이 첫 꼴이다
  for (const e of by.values()) e.files.sort((a, b) => Number(a.inHistory) - Number(b.inHistory));
  return [...by.values()].sort((a, b) => b.at - a.at || cmpVer(b.ver, a.ver));
}

const pad = (n: number) => String(n).padStart(2, "0");

function dateText(f: DocFile): string {
  const d = f.parsed.date;
  if (d.length === 8) {
    const t = f.parsed.time;
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}${t.length >= 4 ? ` ${t.slice(0, 2)}:${t.slice(2, 4)}` : ""}`;
  }
  const m = new Date(f.modified);
  return `날짜 없음 · 고친 날 ${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
}

const extOf = (f: DocFile) => f.parsed.ext || f.name.split(".").pop() || "";

export default function EditionList({ x, y, group, onOpen, onFolder, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const eds = editions(group.files);
  const here = eds.filter((e) => e.here).length;

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(".ed-main")?.focus();
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
  }, [onClose]);

  // 창 밖으로 나가지 않게 — 줄 수만큼 높이를 어림해 위로 올린다 (목록이 길면 안에서 굴린다)
  const W = 400;
  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - Math.min(56 + eds.length * 34, 420) - 8));

  return (
    <div
      className="ed-list"
      ref={box}
      role="dialog"
      aria-label={`${group.title} 판 목록`}
      style={{ left, top, width: W }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const btns = [...(box.current?.querySelectorAll<HTMLButtonElement>(".ed-main") ?? [])];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length]?.focus();
      }}
    >
      <div className="ed-head">
        <span className="ed-title" title={group.title}>
          {group.title}
        </span>
        <span className="muted">
          {eds.length}판 · 이 폴더 {here} · 「이전판」 폴더 {eds.length - here}
        </span>
      </div>
      <ul className="ed-rows">
        {eds.map((e) => {
          const first = e.files[0];
          const note = [e.retire ? "옮길 판" : "", e.flag ? "판 번호 · 순서 확인" : ""].filter(Boolean).join(" · ");
          return (
            <li key={e.key} className={"ed-row" + (e.here ? " here" : "")}>
              <button className="ed-main" onClick={() => onOpen(first)} title={e.files.map((f) => f.path).join("\n")}>
                <span className={"ed-dot" + (e.here ? " here" : "") + (e.retire ? " retire" : "") + (e.flag ? " flag" : "")} aria-hidden />
                <span className="ed-ver">{e.ver.length ? `v${e.ver.join(".")}` : "판 없음"}</span>
                <span className="ed-date">{dateText(first)}</span>
                <span className="ed-where">{e.here ? "이 폴더" : "이전판"}</span>
                {note && <span className="ed-note">{note}</span>}
              </button>
              <span className="ed-exts">
                {e.files.map((f) => (
                  <button key={f.path} className="ed-ext" onClick={() => onOpen(f)} title={`${f.name} 열기`}>
                    {extOf(f)}
                  </button>
                ))}
                <button className="ed-ext" onClick={() => onFolder(first)} title="이 판이 든 폴더로 간다">
                  폴더
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
