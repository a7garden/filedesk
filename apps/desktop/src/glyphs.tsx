// 자체 그림. 폴더는 셸의 노란 아이콘 대신 이것을 쓴다 — 파일 아이콘은 설정에 따라 셸 것 · FileGlyph · 아이콘 팩.
import type { ReactNode } from "react";

/** 폴더 — 뒤판(귀 달린 판)과 앞판 두 겹을 채워 그린다. 색은 styles.css 의 --folder-back · --folder-front.
 *  2026.11.11 : 선 그림 → 채운 그림 (사용자 요청). 선으로는 목록에서 파일 그림보다 가벼워 폴더가 묻혔다. */
export function FolderGlyph({ faint = false, size = 16 }: { faint?: boolean; size?: number }) {
  return (
    <svg className={"glyph folder-glyph" + (faint ? " faint" : "")} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 3.6c0-.6.5-1.1 1.1-1.1h3.3c.32 0 .62.14.83.38L7.9 4.1h5.5c.6 0 1.1.5 1.1 1.1v7.2c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1z" fill="var(--folder-back)" />
      <path d="M1.5 6.4c0-.6.5-1.1 1.1-1.1h10.8c.6 0 1.1.5 1.1 1.1v6c0 .6-.5 1.1-1.1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1z" fill="var(--folder-front)" />
    </svg>
  );
}

// ───────── filedesk 파일 아이콘 ─────────
// 흰 종이에 형식 색을 엷게 깔고, 테두리 · 접힌 귀 · 상징을 형식 색으로. 상징은 형식을 누구나 알아보는 일반 기호다 (한글 「한」 · 마크다운 M↓ · 표의 칸 · 재생 단추 …).
// 상표 로고는 쓰지 않는다 — 공개 저장소이고, 로고는 작은 크기에서 뭉개진다.
// 2026.11.11 : 종류(문서 · 표 · 발표 …)마다 색 띠 하나만 칠하던 것을 형식마다 다른 그림으로. 색 띠로는 md · pdf · hwp 가
//   모두 「문서」 색이라 가려지지 않았다. 종류 설정(이름 · 확장자 묶음)은 거르기용이라 그림과 따로 간다.
// 2026.11.11 : 종이 전체를 형식 색으로 칠하고 흰 상징을 얹던 것을 흰 종이 + 색 상징으로 (사용자 요청 — 색 덩어리가 목록에서 너무 셌다).
//   pdf · 한글처럼 글자가 상징인 것만 색 딱지에 흰 글자로 둔다 — 색 글자로는 작은 크기에서 종이 바탕에 묻힌다.

type Sym = "lines" | "han" | "md" | "grid" | "csv" | "slide" | "pdf" | "image" | "play" | "note" | "zip" | "code" | "braces" | "hash" | "db" | "term" | "link" | "font" | "blank";
type Fmt = { color: string; sym: Sym };

const FMT: Record<string, Fmt> = {};
const def = (exts: string, color: string, sym: Sym) => exts.split(" ").forEach((x) => (FMT[x] = { color, sym }));
def("hwp hwpx hwt hml", "#2b7de9", "han");
def("doc docx dot dotx odt rtf", "#2f5fb8", "lines");
def("txt log ini cfg conf", "#6b7280", "lines");
def("md markdown mdx", "#3b4250", "md");
def("xls xlsx xlsm xlsb ods cell", "#1f8f4e", "grid");
def("csv tsv", "#3c8d5a", "csv");
def("ppt pptx pps ppsx odp key show", "#d9622b", "slide");
def("pdf", "#d33b3b", "pdf");
def("png jpg jpeg gif bmp webp tif tiff heic ico psd ai svg raw", "#8e4ec6", "image");
def("mp4 mov avi mkv wmv webm m4v camproj trec", "#c2417e", "play");
def("mp3 wav m4a flac ogg aac wma", "#a8448f", "note");
def("zip 7z rar alz egg tar gz tgz bz2 xz z01 z02 z03 z04", "#9a6b2f", "zip");
def("js mjs cjs ts tsx jsx java jsp py rs go c cpp h hpp cs kt swift rb php vue", "#4b5563", "code");
def("html htm", "#e4572e", "code");
def("json yml yaml xml toml", "#6d5bd0", "braces");
def("css scss less", "#2965f1", "hash");
def("sql db sqlite mdb accdb", "#64748b", "db");
def("exe msi bat cmd ps1 sh appx", "#475569", "term");
def("lnk url", "#0e7c86", "link");
def("ttf otf woff woff2", "#5b5f97", "font");

/** 딱지 — 글자 상징의 바탕. 종이 아래쪽에 형식 색으로 칠한다. */
const badge = (W: string) => <rect x="8" y="15" width="16" height="10" rx="2" fill={W} />;

/** 상징 — 32 칸 기준, 종이 몸통(가로 7~25 · 세로 9~28) 가운데에 놓는다. `W` 는 형식 색. */
function symbol(s: Sym, W: string): ReactNode {
  switch (s) {
    case "lines":
      return <path d="M11 14h10M11 18h10M11 22h7" stroke={W} strokeWidth="1.8" strokeLinecap="round" />;
    case "han":
      return (
        <>
          {badge(W)}
          <text x="16" y="23.4" textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--icon-paper)" fontFamily="Pretendard, 'Malgun Gothic', sans-serif">
            한
          </text>
        </>
      );
    case "md":
      return <path d="M9.5 23v-7.5l3 3.6 3-3.6V23M20.5 15.5V23M18 20.5l2.5 2.6 2.5-2.6" fill="none" stroke={W} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />;
    case "grid":
      return (
        <g fill="none" stroke={W} strokeWidth="1.5">
          <rect x="10" y="13" width="12" height="11" rx="1" />
          <path d="M10 16.7h12M10 20.3h12M14.5 13v11" />
        </g>
      );
    case "csv":
      return <path d="M10 14.5h12M10 18.5h12M10 22.5h12" stroke={W} strokeWidth="1.5" strokeDasharray="3 1.6" strokeLinecap="round" />;
    case "slide":
      return (
        <g fill="none" stroke={W} strokeWidth="1.5" strokeLinejoin="round">
          <rect x="9.5" y="13" width="13" height="9" rx="1" />
          <path d="M16 22v3M13 25h6" strokeLinecap="round" />
          <path d="M12.5 19.5v-2M15.5 19.5v-3.5M18.5 19.5v-1.5" strokeLinecap="round" />
        </g>
      );
    case "pdf":
      return (
        <>
          {badge(W)}
          <text x="16" y="22.6" textAnchor="middle" fontSize="7" fontWeight="800" letterSpacing="0.2" fill="var(--icon-paper)" fontFamily="Pretendard, system-ui, sans-serif">
            PDF
          </text>
        </>
      );
    case "image":
      return (
        <g fill={W}>
          <circle cx="19.5" cy="14.8" r="1.8" />
          <path d="M9.5 24l4.2-5.6 2.8 3.3 2-2.3 4 4.6z" />
        </g>
      );
    case "play":
      return <path d="M13.5 13.5v10l8-5z" fill={W} strokeLinejoin="round" />;
    case "note":
      return (
        <g fill={W} stroke={W} strokeWidth="1.4" strokeLinecap="round">
          <path d="M14 22.5v-9l7-1.6v8.6" fill="none" />
          <circle cx="12.5" cy="22.6" r="1.9" stroke="none" />
          <circle cx="19.5" cy="20.6" r="1.9" stroke="none" />
        </g>
      );
    case "zip":
      return (
        <g fill={W}>
          {[10, 13, 16, 19].map((y, i) => (
            <rect key={y} x={i % 2 ? 16 : 14} y={y} width="2" height="2" />
          ))}
          <rect x="13.6" y="21.5" width="4.8" height="4" rx="1" />
        </g>
      );
    case "code":
      return <path d="M13 14.5l-3.5 4 3.5 4M19 14.5l3.5 4-3.5 4M17.2 13.5l-2.4 10" fill="none" stroke={W} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;
    case "braces":
      return (
        <path
          d="M13.5 13c-1.6 0-2 .7-2 2v1.7c0 .9-.6 1.6-1.5 1.8.9.2 1.5.9 1.5 1.8V22c0 1.3.4 2 2 2M18.5 13c1.6 0 2 .7 2 2v1.7c0 .9.6 1.6 1.5 1.8-.9.2-1.5.9-1.5 1.8V22c0 1.3-.4 2-2 2"
          fill="none"
          stroke={W}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      );
    case "hash":
      return <path d="M14 13.5l-1.2 10M19.2 13.5l-1.2 10M11 16.5h11M10.4 20.5h11" stroke={W} strokeWidth="1.5" strokeLinecap="round" />;
    case "db":
      return (
        <g fill="none" stroke={W} strokeWidth="1.5">
          <ellipse cx="16" cy="14.5" rx="5.5" ry="2" />
          <path d="M10.5 14.5v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-8M10.5 18.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
        </g>
      );
    case "term":
      return <path d="M10.5 15l4 3.5-4 3.5M16.5 23h5" fill="none" stroke={W} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />;
    case "link":
      return (
        <g fill="none" stroke={W} strokeWidth="1.6" strokeLinecap="round">
          <path d="M14.8 19.8l-1.6 1.6a2.4 2.4 0 0 1-3.4-3.4l2.4-2.4a2.4 2.4 0 0 1 3.4 0" />
          <path d="M17.2 17.2l1.6-1.6a2.4 2.4 0 0 1 3.4 3.4l-2.4 2.4a2.4 2.4 0 0 1-3.4 0" />
        </g>
      );
    case "font":
      return (
        <text x="16" y="23.6" textAnchor="middle" fontSize="11" fontWeight="700" fill={W} fontFamily="Georgia, serif">
          Aa
        </text>
      );
    default:
      return null;
  }
}

/** 자리 그림 — 바탕화면 · 다운로드 · 문서 · 네트워크. 폴더 그림과 같은 굵기의 선으로, 왼쪽 열 「이 PC」 칸 · 「연결」 줄에 쓴다.
 *  2026.11.11 : 셸 아이콘(작은 16px 비트맵)을 키우면 흐려져 따로 그렸다. */
export function PlaceGlyph({ kind, size = 20 }: { kind: "desktop" | "download" | "docs" | "net"; size?: number }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {kind === "desktop" && (
        <>
          <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.25" {...p} />
          <path d="M6 13.5h4M8 11v2.5" {...p} />
        </>
      )}
      {kind === "download" && (
        <>
          <path d="M8 2v7.5M5 6.75 8 9.75l3-3" {...p} />
          <path d="M2.25 10.5v1.75c0 .69.56 1.25 1.25 1.25h9c.69 0 1.25-.56 1.25-1.25V10.5" {...p} />
        </>
      )}
      {kind === "docs" && (
        <>
          <path d="M4 1.75h5.25l2.75 2.75v9.25c0 .28-.22.5-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5c0-.28.22-.5.5-.5z" {...p} />
          <path d="M6 7.5h4M6 10h4" {...p} />
        </>
      )}
      {kind === "net" && (
        <>
          <rect x="2" y="2.25" width="12" height="4.5" rx="1" {...p} />
          <rect x="2" y="8.25" width="12" height="4.5" rx="1" {...p} />
          <path d="M4.5 4.5h.01M4.5 10.5h.01" {...p} strokeWidth={1.75} />
        </>
      )}
    </svg>
  );
}

/** filedesk 파일 아이콘. 모르는 형식은 흐린 빈 종이에, 크면(40px 넘게) 확장자를 쓴다. */
export function FileGlyph({ ext, size = 16 }: { ext: string; size?: number }) {
  const x = ext.toLowerCase();
  const f = FMT[x];
  // 어둡게에서는 형식 색을 흰색 쪽으로 한 단 밝힌다 — md · 코드 · 실행 파일의 짙은 회색이 어두운 바탕에 묻혔다.
  const tone = f ? `light-dark(${f.color}, color-mix(in srgb, ${f.color} 60%, #fff))` : "var(--muted)";
  const color = "currentColor";
  const label = size > 40 && !f ? x.slice(0, 5).toUpperCase() : "";
  const paper = "M7.5 2.75h11.25l6.5 6.5v18.75c0 .83-.67 1.5-1.5 1.5h-16.25c-.83 0-1.5-.67-1.5-1.5V4.25c0-.83.67-1.5 1.5-1.5z";
  return (
    <svg className="glyph file-glyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ color: tone }}>
      {/* 종이 — 흰 바탕에 형식 색을 엷게 한 겹, 테두리도 형식 색 */}
      <path d={paper} fill="var(--icon-paper)" />
      <path d={paper} fill={color} fillOpacity="0.1" stroke={color} strokeOpacity="0.55" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M18.75 2.75v5c0 .83.67 1.5 1.5 1.5h5z" fill={color} fillOpacity="0.45" />
      {f ? symbol(f.sym, color) : null}
      {label && (
        <text x="16" y="23" textAnchor="middle" fontSize="6" fontWeight="700" fill={color} fontFamily="Pretendard, system-ui, sans-serif">
          {label}
        </text>
      )}
    </svg>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={"chev" + (open ? " open" : "")} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
