// 자체 그림. 폴더는 셸의 노란 아이콘 대신 이것을 쓴다 — 파일 아이콘은 설정에 따라 셸 것 · FileGlyph · 아이콘 팩.
import type { ReactNode } from "react";

export function FolderGlyph({ faint = false, size = 16 }: { faint?: boolean; size?: number }) {
  return (
    <svg className={"glyph" + (faint ? " faint" : "")} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h3.1l1.4 1.5H13c.69 0 1.25.56 1.25 1.25v6.5c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ───────── filedesk 파일 아이콘 ─────────
// 형식 색으로 칠한 종이 + 흰 상징. 상징은 형식을 누구나 알아보는 일반 기호다 (한글 「한」 · 마크다운 M↓ · 표의 칸 · 재생 단추 …).
// 상표 로고는 쓰지 않는다 — 공개 저장소이고, 로고는 작은 크기에서 뭉개진다.
// 2026.11.11 : 종류(문서 · 표 · 발표 …)마다 색 띠 하나만 칠하던 것을 형식마다 다른 그림으로. 색 띠로는 md · pdf · hwp 가
//   모두 「문서」 색이라 가려지지 않았다. 종류 설정(이름 · 확장자 묶음)은 거르기용이라 그림과 따로 간다.

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

const W = "#fff";
/** 상징 — 32 칸 기준, 종이 몸통(가로 7~25 · 세로 9~28) 가운데에 놓는다. */
function symbol(s: Sym): ReactNode {
  switch (s) {
    case "lines":
      return <path d="M11 14h10M11 18h10M11 22h7" stroke={W} strokeWidth="1.8" strokeLinecap="round" />;
    case "han":
      return (
        <text x="16" y="23.4" textAnchor="middle" fontSize="11.5" fontWeight="800" fill={W} fontFamily="Pretendard, 'Malgun Gothic', sans-serif">
          한
        </text>
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
        <text x="16" y="22.4" textAnchor="middle" fontSize="7.6" fontWeight="800" letterSpacing="0.2" fill={W} fontFamily="Pretendard, system-ui, sans-serif">
          PDF
        </text>
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

/** filedesk 파일 아이콘. 모르는 형식은 흐린 빈 종이에, 크면(40px 넘게) 확장자를 쓴다. */
export function FileGlyph({ ext, size = 16 }: { ext: string; size?: number }) {
  const x = ext.toLowerCase();
  const f = FMT[x];
  const color = f?.color ?? "var(--faint)";
  const label = size > 40 ? x.slice(0, 5).toUpperCase() : "";
  return (
    <svg className="glyph file-glyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {/* 종이 — 접힌 귀퉁이는 같은 색을 조금 어둡게 */}
      <path d="M7.5 2.5h11.5l6 6v19.5c0 .8-.7 1.5-1.5 1.5h-16c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5z" fill={color} />
      <path d="M19 2.5v4.5c0 .8.7 1.5 1.5 1.5H25z" fill="#000" opacity="0.22" />
      {f ? symbol(f.sym) : null}
      {label && !f && (
        <text x="16" y="21" textAnchor="middle" fontSize="6" fontWeight="700" fill={W} fontFamily="Pretendard, system-ui, sans-serif">
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
