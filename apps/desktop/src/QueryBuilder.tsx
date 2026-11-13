// 찾기 조건 만들기 — 찾기 칸 오른쪽 「조건」 단추로 연다. 고친 날 · 크기 · 종류 · 확장자 · 색 · 메모 · 뺄 말을 골라 찾기 칸 글로 만든다.
//
// 고르는 대로 찾기 칸 글을 바로 바꿔, 왼쪽 목록이 그 자리에서 다시 걸러진다 (스마트 폴더 고치기와 같은 오른쪽 옆판).
// 「취소」 · Esc 는 연 때의 글로 되돌린다. 아래에 만들어진 글을 보여 — 다음부터 칸에 바로 적을 수 있게 문법을 익힌다.
// 칸 글을 읽어 처음 값을 채운다. 폼으로 못 담는 조건(날짜 범위 꼴이 다른 것 · 모르는 열쇠)은 「그 밖」에 그대로 남겨 잃지 않는다.
// 문법의 정본은 fd-core query.rs 머리말이다 — 열쇠 · 값을 바꾸면 여기 읽기 · 쓰기도 맞춘다.
// 2026.11.12 : 처음 씀.
// 2026.11.13 : 다시 지었다 (사용자 요청 · bespoke). 일곱 갈래가 늘 「상관없음」 라디오와 함께 펼쳐져 있어, 무엇이 켜졌는지를 훑어 찾아야 했다.
//   켠 조건만 줄로 서고(값은 붙은 단추 줄 · × 로 뺀다), 안 켠 갈래는 아래 「＋ 고친 날 …」 으로 더한다. 찾는 말이 맨 위에 가장 크게.
import { useEffect, useRef, useState } from "react";
import { TAG_COLORS, TAG_LABEL, type TagColor } from "./api";
import { TagDot } from "./TagMenu";
import type { KindDef } from "./util";

type Props = {
  /** 연 때의 찾기 칸 글. */
  initial: string;
  kinds: KindDef[];
  /** 고를 때마다 찾기 칸에 넣는다. */
  onChange: (text: string) => void;
  onClose: () => void;
};

const SPAN_UNITS = ["시간", "일", "주", "달", "년"] as const;
const SIZE_UNITS = ["KB", "MB", "GB"] as const;
type SpanUnit = (typeof SPAN_UNITS)[number];
type SizeUnit = (typeof SIZE_UNITS)[number];

type Form = {
  terms: string;
  nots: string;
  when: "any" | "today" | "yesterday" | "within" | "older" | "range";
  span: string;
  spanUnit: SpanUnit;
  from: string;
  to: string;
  size: "any" | "gt" | "lt" | "between";
  sizeA: string;
  unitA: SizeUnit;
  sizeB: string;
  unitB: SizeUnit;
  target: "any" | "file" | "dir";
  kinds: string[];
  exts: string;
  color: "any" | "has" | "pick";
  colors: TagColor[];
  memo: "any" | "yes" | "no";
  /** 폼으로 못 담은 조건 — 그대로 다시 붙인다. */
  rest: string[];
};

const blank = (): Form => ({
  terms: "",
  nots: "",
  when: "any",
  span: "7",
  spanUnit: "일",
  from: "",
  to: "",
  size: "any",
  sizeA: "10",
  unitA: "MB",
  sizeB: "100",
  unitB: "MB",
  target: "any",
  kinds: [],
  exts: "",
  color: "any",
  colors: [],
  memo: "any",
  rest: [],
});

/** query.rs tokens 와 같게 — 따옴표 안의 빈칸은 끊지 않는다. */
function tokens(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (/\s/.test(c) && !quoted) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

const KEY: Record<string, "when" | "size" | "ext" | "kind" | "color" | "memo"> = {
  고친: "when", 날짜: "when", 고친날: "when", modified: "when", date: "when",
  크기: "size", size: "size",
  확장자: "ext", ext: "ext",
  종류: "kind", kind: "kind", type: "kind",
  색: "color", color: "color",
  메모: "memo", memo: "memo",
};
const SPAN_ALIAS: Record<string, SpanUnit> = { 시간: "시간", h: "시간", 일: "일", d: "일", 주: "주", w: "주", 달: "달", 개월: "달", m: "달", mo: "달", 년: "년", y: "년" };
const COLOR_OF: Record<string, TagColor> = Object.fromEntries(TAG_COLORS.flatMap((c) => [[c, c], [TAG_LABEL[c], c]]));
/** `2026-11-01` · `20261101` · `2026.11.01` → `2026-11-01` (날짜 칸 값). */
const isoDate = (v: string) => {
  const d = v.replace(/[-./]/g, "");
  return /^\d{8}$/.test(d) && /^[\d\-./]+$/.test(v) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : null;
};
/** `10MB` → ["10", "MB"]. 폼 단위(KB · MB · GB) 밖이면 null. */
const sizeParts = (v: string): [string, SizeUnit] | null => {
  const m = /^(\d+(?:\.\d+)?)\s*(k|kb|m|mb|g|gb)$/i.exec(v.trim());
  return m ? [m[1], (m[2][0].toUpperCase() + "B") as SizeUnit] : null;
};

/** 찾기 칸 글 → 폼. 하나라도 못 읽은 조건은 rest 로. */
function read(text: string, kinds: KindDef[]): Form {
  const f = blank();
  const terms: string[] = [];
  const nots: string[] = [];
  for (const tok of tokens(text)) {
    const at = tok.indexOf(":");
    const key = at > 0 ? KEY[tok.slice(0, at).toLowerCase()] : undefined;
    if (!key) {
      if (tok.length > 1 && tok.startsWith("-")) nots.push(tok.slice(1));
      else terms.push(tok);
      continue;
    }
    const v = tok.slice(at + 1).trim();
    const lv = v.toLowerCase();
    let ok = true;
    if (!v) continue;
    if (key === "when") {
      const span = /^([<>])?(\d+)(시간|일|주|달|개월|년|h|d|w|mo|m|y)$/.exec(lv);
      if (lv === "오늘" || lv === "today") f.when = "today";
      else if (lv === "어제" || lv === "yesterday") f.when = "yesterday";
      else if (span) {
        f.when = span[1] === ">" ? "older" : "within";
        f.span = span[2];
        f.spanUnit = SPAN_ALIAS[span[3]];
      } else if (v.includes("..")) {
        const [a, b] = v.split("..");
        const fa = a ? isoDate(a) : "";
        const fb = b ? isoDate(b) : "";
        if (fa == null || fb == null) ok = false;
        else Object.assign(f, { when: "range", from: fa, to: fb });
      } else if (isoDate(v)) Object.assign(f, { when: "range", from: isoDate(v), to: isoDate(v) });
      else ok = false;
    } else if (key === "size") {
      if (v.includes("..")) {
        const [a, b] = v.split("..").map(sizeParts);
        if (a && b) Object.assign(f, { size: "between", sizeA: a[0], unitA: a[1], sizeB: b[0], unitB: b[1] });
        else ok = false;
      } else {
        const lt = v.startsWith("<");
        const p = sizeParts(v.replace(/^[<>]=?/, ""));
        if (p) Object.assign(f, { size: lt ? "lt" : "gt", sizeA: p[0], unitA: p[1] });
        else ok = false;
      }
    } else if (key === "kind") {
      for (const x of v.split(/[,·]/).map((s) => s.trim()).filter(Boolean)) {
        const lx = x.toLowerCase();
        if (["폴더", "folder", "dir"].includes(lx)) f.target = "dir";
        else if (["파일", "file"].includes(lx)) f.target = "file";
        else {
          const k = kinds.find((k) => k.label === x || k.id === lx);
          if (k) !f.kinds.includes(k.label) && f.kinds.push(k.label);
          else ok = false;
        }
      }
    } else if (key === "ext") {
      f.exts = [f.exts, v.split(/[,·]/).map((s) => s.trim().replace(/^\*?\./, "")).filter(Boolean).join(", ")].filter(Boolean).join(", ");
    } else if (key === "color") {
      for (const x of v.split(/[,·]/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        if (["있음", "any", "yes"].includes(x)) f.color = "has";
        else if (COLOR_OF[x]) {
          f.color = "pick";
          !f.colors.includes(COLOR_OF[x]) && f.colors.push(COLOR_OF[x]);
        } else ok = false;
      }
    } else if (key === "memo") {
      if (["있음", "yes", "true", "o"].includes(lv)) f.memo = "yes";
      else if (["없음", "no", "false", "x"].includes(lv)) f.memo = "no";
      else ok = false;
    }
    if (!ok) f.rest.push(tok);
  }
  f.terms = terms.join(" ");
  f.nots = nots.join(" ");
  return f;
}

/** 빈칸이 든 값은 토큰째 따옴표로 감싼다 (query.rs tokens 가 따옴표를 벗긴다). */
const q = (tok: string) => (/\s/.test(tok) ? `"${tok}"` : tok);
const num = (s: string) => /^\d+(\.\d+)?$/.test(s.trim());

/** 폼 → 찾기 칸 글. 찾는 말 · 조건 · 뺄 말 순서. 값이 덜 채워진 조건은 빼고 만든다. */
function write(f: Form): string {
  const out: string[] = [];
  if (f.terms.trim()) out.push(f.terms.trim());
  if (f.when === "today") out.push("고친:오늘");
  else if (f.when === "yesterday") out.push("고친:어제");
  else if ((f.when === "within" || f.when === "older") && /^\d+$/.test(f.span.trim())) out.push(`고친:${f.when === "older" ? ">" : ""}${f.span.trim()}${f.spanUnit}`);
  else if (f.when === "range" && (f.from || f.to)) out.push(f.from && f.from === f.to ? `고친:${f.from}` : `고친:${f.from}..${f.to}`);
  if (f.size === "gt" && num(f.sizeA)) out.push(`크기:>${f.sizeA.trim()}${f.unitA}`);
  else if (f.size === "lt" && num(f.sizeA)) out.push(`크기:<${f.sizeA.trim()}${f.unitA}`);
  else if (f.size === "between" && num(f.sizeA) && num(f.sizeB)) out.push(`크기:${f.sizeA.trim()}${f.unitA}..${f.sizeB.trim()}${f.unitB}`);
  if (f.target !== "any") out.push(f.target === "dir" ? "종류:폴더" : "종류:파일");
  if (f.kinds.length) out.push(q(`종류:${f.kinds.join(",")}`));
  const exts = f.exts.split(/[,·\s]+/).map((s) => s.replace(/^\*?\./, "")).filter(Boolean);
  if (exts.length) out.push(`확장자:${exts.join(",")}`);
  if (f.color === "has") out.push("색:있음");
  else if (f.color === "pick" && f.colors.length) out.push(`색:${f.colors.map((c) => TAG_LABEL[c]).join(",")}`);
  if (f.memo !== "any") out.push(f.memo === "yes" ? "메모:있음" : "메모:없음");
  out.push(...f.rest);
  out.push(...f.nots.split(/\s+/).filter(Boolean).map((t) => q(`-${t}`)));
  return out.join(" ");
}

/** 조건 한 갈래 — 켠 것만 줄로 보인다. */
type Sec = "when" | "size" | "target" | "kinds" | "exts" | "color" | "memo";
const SECS: { id: Sec; label: string }[] = [
  { id: "when", label: "고친 날" },
  { id: "size", label: "크기" },
  { id: "kinds", label: "종류" },
  { id: "target", label: "파일 · 폴더" },
  { id: "exts", label: "확장자" },
  { id: "color", label: "색 표시" },
  { id: "memo", label: "메모" },
];
const isOn = (f: Form, s: Sec) =>
  s === "when" ? f.when !== "any" : s === "size" ? f.size !== "any" : s === "target" ? f.target !== "any" : s === "kinds" ? f.kinds.length > 0 : s === "exts" ? !!f.exts.trim() : s === "color" ? f.color !== "any" : f.memo !== "any";
/** 갈래를 더할 때 처음 값 — 가장 자주 쓰는 것. 더하자마자 목록이 걸러져 고른 값의 결과가 바로 보인다. */
const OPEN: Record<Sec, Partial<Form>> = {
  when: { when: "within", span: "7", spanUnit: "일" },
  size: { size: "gt", sizeA: "10", unitA: "MB" },
  target: { target: "file" },
  kinds: {},
  exts: {},
  color: { color: "has", colors: [] },
  memo: { memo: "yes" },
};
const CLEAR: Record<Sec, Partial<Form>> = {
  when: { when: "any" },
  size: { size: "any" },
  target: { target: "any" },
  kinds: { kinds: [] },
  exts: { exts: "" },
  color: { color: "any", colors: [] },
  memo: { memo: "any" },
};

export default function QueryBuilder(p: Props) {
  const [f, setF] = useState<Form>(() => read(p.initial, p.kinds));
  // 보이는 갈래 — 켠 조건 + 방금 더한 것(종류 · 확장자는 값을 고르기 전에도 줄이 서야 한다)
  const [shown, setShown] = useState<Sec[]>(() => SECS.map((s) => s.id).filter((s) => isOn(f, s)));
  const first = useRef<HTMLInputElement>(null);
  const focusSec = useRef<Sec | null>(null);
  const text = write(f);
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  // 고르는 대로 칸에 넣는다 — 처음 그릴 때는 넣지 않는다 (읽고 다시 쓴 글이 사용자가 친 글과 꼴만 달라 칸이 바뀌어 보인다)
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    p.onChange(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글이 바뀔 때만
  }, [text]);

  const cancel = () => {
    p.onChange(p.initial);
    p.onClose();
  };

  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.stopPropagation();
        p.onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 연 때 한 번
  }, []);

  // 더한 갈래의 첫 손잡이로 초점 — 키보드로 더하고 바로 값을 고르게
  const rowsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = focusSec.current;
    if (!s) return;
    focusSec.current = null;
    rowsRef.current?.querySelector<HTMLElement>(`[data-sec="${s}"] input, [data-sec="${s}"] button[aria-pressed]`)?.focus();
  }, [shown]);

  const add = (s: Sec) => {
    set(OPEN[s]);
    focusSec.current = s;
    setShown((cur) => SECS.map((x) => x.id).filter((x) => x === s || cur.includes(x)));
  };
  const drop = (s: Sec) => {
    set(CLEAR[s]);
    setShown((cur) => cur.filter((x) => x !== s));
  };
  const clearAll = () => {
    setF(blank());
    setShown([]);
  };

  /** 붙은 단추 줄 — 라디오 대신. 지금 값은 눌린 단추 하나. 「상관없음」은 두지 않는다 (줄의 × 가 그 일). */
  const seg = <K extends keyof Form>(name: K, opts: [Form[K], string][], label: string) => (
    <span className="cs-seg" role="group" aria-label={label}>
      {opts.map(([v, l]) => (
        <button key={String(v)} aria-pressed={f[name] === v} onClick={() => set({ [name]: v } as Partial<Form>)}>
          {l}
        </button>
      ))}
    </span>
  );
  const unitPick = <U extends string>(value: U, units: readonly U[], on: (u: U) => void, label: string) => (
    <select className="cs-unit" value={value} aria-label={label} onChange={(e) => on(e.target.value as U)}>
      {units.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );

  const control = (s: Sec) => {
    switch (s) {
      case "when":
        return (
          <>
            {seg(
              "when",
              [
                ["today", "오늘"],
                ["yesterday", "어제"],
                ["within", "최근"],
                ["older", "오래 안 고침"],
                ["range", "날짜로"],
              ],
              "고친 날",
            )}
            {(f.when === "within" || f.when === "older") && (
              <span className="cs-sub">
                <input className="cs-num" inputMode="numeric" value={f.span} aria-label="기간" onChange={(e) => set({ span: e.target.value })} />
                {unitPick(f.spanUnit, SPAN_UNITS, (u) => set({ spanUnit: u }), "기간 단위")}
                <span className="muted">{f.when === "within" ? "안에 고친 것" : "넘게 안 고친 것"}</span>
              </span>
            )}
            {f.when === "range" && (
              <span className="cs-sub">
                <input type="date" value={f.from} aria-label="이날부터" onChange={(e) => set({ from: e.target.value })} />
                <span className="muted">~</span>
                <input type="date" value={f.to} aria-label="이날까지" onChange={(e) => set({ to: e.target.value })} />
              </span>
            )}
          </>
        );
      case "size":
        return (
          <>
            {seg(
              "size",
              [
                ["gt", "이상"],
                ["lt", "미만"],
                ["between", "사이"],
              ],
              "크기",
            )}
            <span className="cs-sub">
              <input className="cs-num" inputMode="decimal" value={f.sizeA} aria-label="크기" onChange={(e) => set({ sizeA: e.target.value })} />
              {unitPick(f.unitA, SIZE_UNITS, (u) => set({ unitA: u }), "크기 단위")}
              {f.size === "between" && (
                <>
                  <span className="muted">~</span>
                  <input className="cs-num" inputMode="decimal" value={f.sizeB} aria-label="크기 끝" onChange={(e) => set({ sizeB: e.target.value })} />
                  {unitPick(f.unitB, SIZE_UNITS, (u) => set({ unitB: u }), "크기 끝 단위")}
                </>
              )}
              <span className="muted">폴더는 빠진다</span>
            </span>
          </>
        );
      case "target":
        return seg(
          "target",
          [
            ["file", "파일만"],
            ["dir", "폴더만"],
          ],
          "파일 · 폴더",
        );
      case "kinds":
        // 종류는 여럿을 함께 — 켜고 끄는 점 단추. 점 색은 목록의 종류 칩과 같다
        return (
          <span className="cs-chips" role="group" aria-label="종류">
            {p.kinds.map((k) => {
              const on = f.kinds.includes(k.label);
              return (
                <button key={k.id} aria-pressed={on} onClick={() => set({ kinds: on ? f.kinds.filter((x) => x !== k.label) : [...f.kinds, k.label] })}>
                  <span className="kind-dot" style={{ background: k.color }} aria-hidden="true" />
                  {k.label}
                </button>
              );
            })}
          </span>
        );
      case "exts":
        return <input className="cs-text" value={f.exts} spellCheck={false} placeholder="pdf, hwpx" aria-label="확장자" onChange={(e) => set({ exts: e.target.value })} />;
      case "color":
        return (
          <span className="cs-chips cs-colors" role="group" aria-label="색 표시">
            <button aria-pressed={f.color === "has"} onClick={() => set({ color: "has", colors: [] })}>
              아무 색
            </button>
            {TAG_COLORS.map((c) => {
              const on = f.color === "pick" && f.colors.includes(c);
              return (
                <button
                  key={c}
                  className="cs-swatch"
                  aria-pressed={on}
                  aria-label={TAG_LABEL[c]}
                  title={TAG_LABEL[c]}
                  onClick={() => {
                    const cur = f.color === "pick" ? f.colors : [];
                    const colors = on ? cur.filter((x) => x !== c) : [...cur, c];
                    set(colors.length ? { color: "pick", colors } : { color: "has", colors: [] });
                  }}
                >
                  <TagDot color={c} />
                </button>
              );
            })}
          </span>
        );
      case "memo":
        return seg(
          "memo",
          [
            ["yes", "있는 것"],
            ["no", "없는 것"],
          ],
          "메모",
        );
    }
  };

  const more = SECS.filter((s) => !shown.includes(s.id));

  return (
    <div className="set-backdrop sheet" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="smart-editor qb cs" role="dialog" aria-modal="true" aria-label="찾기 조건">
        <h3>찾기 조건</h3>

        {/* 찾는 말이 이 판의 주인공 — 가장 크게. 뺄 말은 그 아래 「−」 줄 */}
        <div className="cs-words">
          <input ref={first} className="cs-terms" value={f.terms} spellCheck={false} placeholder="찾는 말 — 이름 · 메모" aria-label="찾는 말" onChange={(e) => set({ terms: e.target.value })} />
          <label className="cs-nots">
            <span aria-hidden="true">−</span>
            <input value={f.nots} spellCheck={false} placeholder="뺄 말 (빈칸으로 여럿)" aria-label="뺄 말" onChange={(e) => set({ nots: e.target.value })} />
          </label>
        </div>

        <div className="cs-rows" ref={rowsRef}>
          {shown.map((s) => (
            <div key={s} className="cs-row" data-sec={s}>
              <span className="cs-label">{SECS.find((x) => x.id === s)!.label}</span>
              <div className="cs-ctl">{control(s)}</div>
              <button className="cs-x" aria-label={`${SECS.find((x) => x.id === s)!.label} 조건 빼기`} title="이 조건 빼기" onClick={() => drop(s)}>
                ×
              </button>
            </div>
          ))}
          {f.rest.length > 0 && (
            <div className="cs-row">
              <span className="cs-label">그 밖</span>
              <div className="cs-ctl cs-chips">
                {f.rest.map((r) => (
                  <span key={r} className="cond-chip" title="위 갈래로 담지 못한 조건 — 그대로 둔다">
                    {r}
                    <button className="kind-x" aria-label={`「${r}」 떼기`} onClick={() => set({ rest: f.rest.filter((x) => x !== r) })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {more.length > 0 && (
          <div className="cs-add" role="group" aria-label="조건 더하기">
            {more.map((s) => (
              <button key={s.id} onClick={() => add(s.id)}>
                ＋ {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="cs-out" title="찾기 칸에 바로 적어도 같다">
          <span className="cs-out-label">찾기 칸 글</span>
          {text ? <code>{text}</code> : <span className="muted">조건을 더하면 여기 보인다</span>}
        </div>

        <div className="set-acts smart-acts">
          <button className="act" onClick={clearAll} disabled={!text}>
            모두 지우기
          </button>
          <span className="grow" />
          <button className="act" onClick={cancel}>
            취소
          </button>
          <button className="act primary" onClick={p.onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
