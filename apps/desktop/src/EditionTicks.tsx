// 판 눈금 — 「판」 열에서 문서 하나의 판들을 날짜 축 위 점으로 보인다. 글자 「v3 · 3판」이 숨기던 것(언제 · 어디에)을 모양으로.
//
//   점 하나 = 판 하나 (pptx · pdf 처럼 꼴만 다른 것은 한 점) · 위치 = 판 날짜 (이 폴더 공통 축, 오른쪽 끝이 오늘)
//   축은 오늘에 가까울수록 넓은 로그 눈금 — 1년 넘게 이어진 폴더에서도 한 주 안에 낸 판들이 갈라져 보인다. 그래도 겹치면 순서를 지켜 민다.
//   찬 점 = 이 폴더에 있는 판 · 빈 점 = 이전판 · 세로 금 = 이름에 날짜가 없어 고친 시각으로 찍은 판
//   경고색으로 채운 점 = 옮길 판(이 폴더에 있지만 최신판이 아님) · 경고색 테두리 = 판 번호가 겹치거나 순서가 어긋난 판
//
// 2026.11.12 : 판단을 fd-core(`docs::mark`)로 옮겼다 — 화면과 문제 문장이 따로 판단해 어긋났다. 여기서는 그 표시만 칠한다.
//              고리(같은 번호 잇기) · 처짐(순서 어긋남)을 뺐다. 무엇이 문제인지는 문서 아래 문제 문장이 말한다.
//
// 그림만으로 말하지 않는다 — 같은 내용을 aria-label · title 글로 준다 (화면 낭독기 · 마우스 올림).
import type { DocFile } from "./api";

const W = 64;
const H = 16;
const PAD = 4;
const MID = 8;
/** 점 사이 최소 간격 — 판이 많아 칸에 다 안 들어가면 이보다 좁힌다. */
const GAP = 6;
const DAY = 86_400_000;

type Ed = { at: number; ver: number[]; here: boolean; label: string; undated: boolean; retire: boolean; flag: boolean };

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

const mmdd = (t: number) => {
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function editions(files: DocFile[]): Ed[] {
  const by = new Map<string, Ed>();
  for (const f of files) {
    const k = `${f.parsed.version.join(".")}|${f.parsed.date}|${f.parsed.time}`;
    const e = by.get(k);
    if (e) {
      e.here ||= !f.inHistory;
      e.retire ||= f.retire;
      e.flag ||= f.dupVer || f.backOrder;
    } else {
      const undated = f.parsed.date.length !== 8;
      const at = editionTime(f);
      by.set(k, {
        at,
        ver: f.parsed.version,
        here: !f.inHistory,
        undated,
        retire: f.retire,
        flag: f.dupVer || f.backOrder,
        label: [f.parsed.version.length ? `v${f.parsed.version.join(".")}` : "", undated ? `날짜 없음 · 고친 시각 ${mmdd(at)}` : `${f.parsed.date.slice(4, 6)}-${f.parsed.date.slice(6, 8)}`]
          .filter(Boolean)
          .join(" "),
      });
    }
  }
  return [...by.values()].sort((a, b) => a.at - b.at || cmpVer(a.ver, b.ver));
}

/** 로그 축 자리 — 오른쪽 끝이 오늘(hi), 왼쪽 끝이 폴더에서 가장 이른 판(lo). 오늘에 가까울수록 넓다. */
function logX(t: number, lo: number, hi: number): number {
  const span = (hi - lo) / DAY;
  if (span <= 0) return W - PAD;
  const d = Math.min(Math.max((hi - t) / DAY, 0), span);
  return PAD + (W - 2 * PAD) * (1 - Math.log1p(d) / Math.log1p(span));
}

/** 겹치는 점을 민다 — 날짜 순서(eds 순서)를 지키며 오른쪽(오늘)부터 왼쪽으로, 왼쪽 끝을 넘으면 다시 오른쪽으로. */
function spread(xs: number[]): number[] {
  const n = xs.length;
  if (n < 2) return xs;
  const gap = Math.min(GAP, (W - 2 * PAD) / (n - 1));
  const out = [...xs];
  for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  if (out[0] < PAD) {
    out[0] = PAD;
    for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  }
  return out;
}

/** 글로 읽는 요약 — 「v3 11-01 · 3판 · 이 폴더 1 · 「이전판」 폴더 2」. */
function summary(eds: Ed[]): string {
  const here = eds.filter((e) => e.here).length;
  const latest = eds.filter((e) => e.here && !e.retire).at(-1) ?? eds.filter((e) => e.here).at(-1) ?? eds.at(-1);
  return [latest?.label, `${eds.length}판`, `이 폴더 ${here}`, `「이전판」 폴더 ${eds.length - here}`].filter(Boolean).join(" · ");
}

function line(e: Ed): string {
  const notes = [e.retire ? "옮길 판" : "", e.flag ? "판 번호 · 순서 확인" : ""].filter(Boolean);
  return `${e.here ? "●" : "○"} ${e.label}${notes.length ? ` — ${notes.join(" · ")}` : ""}`;
}

export default function EditionTicks({ files, lo, hi }: { files: DocFile[]; lo: number; hi: number }) {
  const eds = editions(files);
  const xs = spread(eds.map((e) => logX(e.at, lo, hi)));
  const text = summary(eds);
  return (
    <svg className="ticks" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={text}>
      <title>{text + "\n" + eds.map(line).join("\n")}</title>
      <line x1={0} y1={MID} x2={W} y2={MID} className="tick-axis" />
      <line x1={W - 0.5} y1={3} x2={W - 0.5} y2={H - 3} className="tick-today" />
      {eds.map((e, i) => {
        const cls = "tick" + (e.here ? " here" : "") + (e.retire ? " retire" : "") + (e.flag ? " flag" : "");
        return e.undated ? (
          <line key={i} x1={xs[i]} y1={MID - 4} x2={xs[i]} y2={MID + 4} className={cls + " tick-undated"} />
        ) : (
          <circle key={i} cx={xs[i]} cy={MID} r={e.here ? 3.4 : 2.8} className={cls} />
        );
      })}
    </svg>
  );
}
