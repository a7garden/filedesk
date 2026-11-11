// 판 눈금 — 「판」 열에서 문서 하나의 판들을 날짜 축 위 점으로 보인다. 글자 「v3 · 3판」이 숨기던 것(언제 · 어디에)을 모양으로.
//
//   점 하나 = 판 하나 (pptx · pdf 처럼 꼴만 다른 것은 한 점) · 위치 = 판 날짜 (이 폴더 공통 축, 오른쪽 끝이 오늘)
//   찬 점 = 같은 자리 · 빈 점 = 이전판 → 규칙대로면 「찬 점은 맨 오른쪽 하나」
//   어긋남은 경고색 + 모양: 같은 판 번호가 두 날짜면 고리로 잇고, 판 번호가 거꾸로 가면 점이 아래로 처진다.
//
// 그림만으로 말하지 않는다 — 같은 내용을 aria-label · title 글로 준다 (화면 낭독기 · 마우스 올림).
import type { DocFile } from "./api";

const W = 64;
const H = 16;
const PAD = 4;
const MID = 8;

type Ed = { at: number; ver: number[]; here: boolean; label: string; back?: boolean; dup?: boolean };

/** 판 날짜(YYYYMMDD)를 밀리초로. 이름에 날짜가 없으면 파일 고친 시각. */
export function editionTime(f: DocFile): number {
  const d = f.parsed.date;
  return d.length === 8 ? Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) : f.modified;
}

const cmpVer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** 판 수 — 같은 판의 다른 꼴(pdf)은 하나로 센다. 격자 칸의 「N판」도 이것을 쓴다. */
export const editionCount = (files: DocFile[]) => editions(files).length;

function editions(files: DocFile[]): Ed[] {
  const by = new Map<string, Ed>();
  for (const f of files) {
    const k = `${f.parsed.version.join(".")}|${f.parsed.date}|${f.parsed.time}`;
    const e = by.get(k);
    if (e) e.here ||= !f.inHistory;
    else
      by.set(k, {
        at: editionTime(f),
        ver: f.parsed.version,
        here: !f.inHistory,
        label: [f.parsed.version.length ? `v${f.parsed.version.join(".")}` : "", f.parsed.date ? `${f.parsed.date.slice(4, 6)}-${f.parsed.date.slice(6, 8)}` : ""].filter(Boolean).join(" "),
      });
  }
  const eds = [...by.values()].sort((a, b) => a.at - b.at || cmpVer(a.ver, b.ver));
  let top: number[] = [];
  for (const e of eds) {
    if (!e.ver.length) continue;
    if (cmpVer(e.ver, top) < 0) e.back = true;
    else top = e.ver;
    if (eds.some((o) => o !== e && o.ver.length && cmpVer(o.ver, e.ver) === 0)) e.dup = true;
  }
  return eds;
}

/** 글로 읽는 요약 — 「v3 11-01 · 3판 · 같은 자리 1 · 이전판 2」. */
function summary(eds: Ed[]): string {
  const here = eds.filter((e) => e.here).length;
  const latest = eds.filter((e) => e.here).at(-1) ?? eds.at(-1);
  return [latest?.label, `${eds.length}판`, `같은 자리 ${here}`, `이전판 ${eds.length - here}`].filter(Boolean).join(" · ");
}

export default function EditionTicks({ files, lo, hi }: { files: DocFile[]; lo: number; hi: number }) {
  const eds = editions(files);
  const x = (t: number) => (hi > lo ? PAD + ((Math.min(Math.max(t, lo), hi) - lo) / (hi - lo)) * (W - 2 * PAD) : W - PAD);
  const crowded = eds.filter((e) => e.here).length > 1;
  const text = summary(eds);
  const dups = eds.filter((e) => e.dup);
  return (
    <svg className="ticks" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={text}>
      <title>{text + "\n" + eds.map((e) => `${e.here ? "●" : "○"} ${e.label}`).join("\n")}</title>
      <line x1={0} y1={MID} x2={W} y2={MID} className="tick-axis" />
      <line x1={W - 0.5} y1={3} x2={W - 0.5} y2={H - 3} className="tick-today" />
      {dups.slice(1).map((e, i) => {
        const a = x(dups[i].at);
        const b = x(e.at);
        return <path key={i} d={`M${a} ${MID} Q ${(a + b) / 2} ${MID - 9} ${b} ${MID}`} className="tick-arc" />;
      })}
      {eds.map((e, i) => {
        const bad = e.back || e.dup || (e.here && crowded);
        const cls = "tick" + (e.here ? " here" : "") + (bad ? " bad" : "");
        return <circle key={i} cx={x(e.at)} cy={e.back ? MID + 4 : MID} r={e.here ? 3.4 : 2.8} className={cls} />;
      })}
    </svg>
  );
}
