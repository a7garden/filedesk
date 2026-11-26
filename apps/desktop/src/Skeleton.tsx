// 불러오는 동안의 자리 — 곧 올 화면의 모양(줄 · 칸 · 쪽 · 그림)을 흐린 막대로 먼저 그린다.
//
// 2026.11.26 : 처음 만들었다 — 사용자 요청 「로딩 경험 · 반응 속도 · 스켈레톤」. 예전에는 폴더 · 글 · 엑셀 · 한글 · 파워포인트를
//   읽는 동안 빈 칸이라, 느린 폴더(NAS)나 큰 문서에서 멈춘 것인지 읽는 중인지 알 수 없었다.
// 바로 끝나는 읽기(대부분의 로컬 폴더)에서는 보이지 않게 잠깐 늦게 나타난다 (styles.css `.sk` animation-delay) —
//   수십 ms 만에 스켈레톤이 번쩍이고 사라지면 오히려 느려 보인다. 늦추기는 CSS 만으로 해 JS 타이머가 없다.
import type { CSSProperties, ReactNode } from "react";
import { MD_EXTS, TABLE_EXTS, viewKind } from "./viewable";

export type SkeletonKind = "list" | "grid" | "text" | "md" | "table" | "pages" | "image";

/** 이 확장자의 파일을 여는 동안 그릴 스켈레톤 — 곧 올 보기의 모양. Pane(보기 묶음을 받는 동안) · Viewer(보기 부품을 받는 동안)가 함께 쓴다.
 *  Viewer.tsx 에 두지 않은 까닭: Pane 이 그것을 가져오면 미뤄 불러오던 보기 묶음이 첫 화면 묶음에 딸려 들어온다. */
export function viewSkeleton(ext: string): ReactNode {
  const e = ext.toLowerCase();
  const k = viewKind(e);
  return <Skeleton kind={k === "image" ? "image" : k === "slides" || k === "hwp" ? "pages" : k === "sheet" || TABLE_EXTS.has(e) ? "table" : MD_EXTS.has(e) ? "md" : "text"} />;
}

/** 줄 길이 — 고르게 같으면 기계처럼 보여 정해진 차례로 들쭉날쭉하게 둔다 (무작위면 그릴 때마다 흔들린다). */
const WIDTHS = [72, 54, 86, 63, 45, 78, 58, 90, 67, 50, 82, 61];
const w = (i: number) => `${WIDTHS[i % WIDTHS.length]}%`;

export default function Skeleton({ kind, note, className }: { kind: SkeletonKind; /** 막대 아래 한 줄 — 무엇을 기다리는지 (예: 한글 엔진). */ note?: string; className?: string }) {
  return (
    <div className={`sk sk--${kind}${className ? ` ${className}` : ""}`} role="status" aria-live="polite" aria-label={note ?? "불러오는 중"}>
      {/* 풀이는 위에 — 막대 위에 겹치면 글이 막대와 섞여 읽기 어려웠다 */}
      {note && <p className="sk-note">{note}</p>}
      {body(kind)}
    </div>
  );
}

function body(kind: SkeletonKind) {
  switch (kind) {
    case "list":
      return Array.from({ length: 14 }, (_, i) => (
        <div key={i} className="sk-row">
          <i className="sk-bar sk-icon" />
          <i className="sk-bar" style={{ width: `${Math.round(WIDTHS[i % WIDTHS.length] * 0.45)}%` }} />
          <i className="sk-bar sk-meta" />
          <i className="sk-bar sk-meta short" />
        </div>
      ));
    case "grid":
      return (
        <div className="sk-tiles">
          {Array.from({ length: 18 }, (_, i) => (
            <div key={i} className="sk-tile">
              <i className="sk-bar sk-thumb" />
              <i className="sk-bar" style={{ width: w(i) }} />
            </div>
          ))}
        </div>
      );
    case "text":
    case "md":
      return (
        <div className="sk-doc">
          {kind === "md" && <i className="sk-bar sk-title" />}
          {Array.from({ length: 16 }, (_, i) =>
            // 마크다운은 문단 사이를 띄운다 — 글 파일은 줄이 이어진다
            kind === "md" && i % 5 === 4 ? <i key={i} className="sk-gap" /> : <i key={i} className="sk-bar" style={{ width: w(i) }} />,
          )}
        </div>
      );
    case "table":
      return (
        <div className="sk-table">
          {Array.from({ length: 16 }, (_, r) => (
            <div key={r} className={"sk-tr" + (r === 0 ? " head" : "")}>
              {Array.from({ length: 6 }, (_, c) => (
                <i key={c} className="sk-bar" style={{ "--fill": w(r + c * 3) } as CSSProperties} />
              ))}
            </div>
          ))}
        </div>
      );
    case "pages":
      return (
        <div className="sk-pages">
          {[0, 1].map((i) => (
            <div key={i} className="sk-page">
              <i className="sk-bar sk-title" />
              {Array.from({ length: 9 }, (_, k) => (
                <i key={k} className="sk-bar" style={{ width: w(k + i * 4) }} />
              ))}
            </div>
          ))}
        </div>
      );
    case "image":
      return <i className="sk-bar sk-picture" />;
  }
}
