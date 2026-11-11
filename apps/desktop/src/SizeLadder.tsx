// 크기 사다리 — 목록 · 격자 전환과 격자 크기를 한 축으로. 아래 줄 오른쪽.
//
//   [목록 촘촘] [목록] [격자 작게] [보통] [크게] [아주 크게]
//
// 2026.11.11 : 목록 · 격자 아이콘 둘 + 격자일 때만 나오는 크기 막대를 하나로 합쳤다. Ctrl+휠이 목록에서 갑자기 격자로 넘어가
//   「왜 바뀌었지」가 됐다 — 두 조작이 같은 축(한 화면에 몇 개를 얼마나 크게)인데 따로 있어서였다. 이제 휠 · Ctrl+= / − 는
//   눈금을 한 칸씩 옮기고, 눈금 모양(가로줄 → 점점 큰 네모)이 다음 칸이 무엇인지 미리 말한다.
import type { ViewPrefs } from "./api";

export const STEPS = ["목록 촘촘", "목록", "격자 작게", "격자 보통", "격자 크게", "격자 아주 크게"];
export const LAST_STEP = STEPS.length - 1;

/** 보기 설정 → 눈금 번호. */
export const stepOf = (v: ViewPrefs) => (v.mode === "list" ? (v.dense ? 0 : 1) : 2 + v.size);

/** 눈금 번호 → 보기 설정. */
export const atStep = (v: ViewPrefs, step: number): ViewPrefs => {
  const s = Math.max(0, Math.min(LAST_STEP, step));
  return s < 2 ? { ...v, mode: "list", dense: s === 0 } : { ...v, mode: "grid", size: s - 2 };
};

/** 눈금 모양 — 목록 칸은 가로줄(촘촘은 석 줄), 격자 칸은 커지는 네모. 무엇으로 바뀌는지를 글 없이 말한다. */
function Tick({ step }: { step: number }) {
  if (step < 2) {
    const ys = step === 0 ? [3, 6, 9] : [4, 8];
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        {ys.map((y) => (
          <path key={y} d={`M1.5 ${y}h9`} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        ))}
      </svg>
    );
  }
  const side = 4 + (step - 2) * 2.4;
  const o = (14 - side) / 2;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x={o} y={o} width={side} height={side} rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export default function SizeLadder({ view, setView }: { view: ViewPrefs; setView: (f: (v: ViewPrefs) => ViewPrefs) => void }) {
  const now = stepOf(view);
  const go = (s: number) => setView((v) => atStep(v, s));
  return (
    <div
      className="ladder"
      role="radiogroup"
      aria-label="보기 크기"
      title="보기 크기 — Ctrl+휠 · Ctrl+= / Ctrl+− · Ctrl+0 은 목록"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          go(now + (e.key === "ArrowRight" ? 1 : -1));
        }
      }}
    >
      <span className="ladder-label" aria-live="polite">
        {STEPS[now]}
      </span>
      {STEPS.map((label, i) => (
        <button
          key={label}
          role="radio"
          aria-checked={i === now}
          aria-label={label}
          tabIndex={i === now ? 0 : -1}
          className={"ladder-tick" + (i === now ? " on" : "") + (i === 2 ? " seam" : "")}
          onClick={() => go(i)}
        >
          <Tick step={i} />
        </button>
      ))}
    </div>
  );
}
