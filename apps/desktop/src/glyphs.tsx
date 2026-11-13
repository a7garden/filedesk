// 자체 그림. 폴더는 셸의 노란 아이콘 대신 이것을 쓴다 — 파일 아이콘은 설정에 따라 셸 것 · FileGlyph · 아이콘 팩.
//
// 목차
//   FolderGlyph — 폴더 (채운 두 겹)
//   파일 아이콘 — 형식 표 FMT · 바탕 꼴(종이 · 딱지 문서 · 판) · 갈래별 그림 drawing · FileGlyph
//   PlaceGlyph  — 왼쪽 열 자리 그림 (바탕화면 · 다운로드 · 문서 · 네트워크)
//   Chevron     — 펼침 화살
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
// 형식 갈래마다 <윤곽>부터 다르게 그린다 — 문서는 종이 + 색 딱지 · 표는 칸 판 · 발표는 화면 · 그림은 액자 · 영상은 색 판 ·
// 소리는 음표 · 압축은 상자 · 코드는 창 · 실행 파일은 칠한 창 · 자료 묶음은 원통. 16px 목록에서 먼저 읽히는 것은 윤곽과 색 덩어리의
// 자리이고, 종이 안 작은 상징은 거의 보이지 않는다.
// 2026.11.13 : 같은 종이에 상징만 바꾸던 것을 갈래별 윤곽으로 (사용자 요청 — 작은 목록에서 형식이 가려지지 않았다).
//   색 덩어리는 문서의 딱지 · 영상 · 상자 · 실행 파일처럼 작은 물건에만 둔다. 종이 전체를 칠한 11.11 첫 판은 목록에서 너무 셌다.
// 상징은 형식을 누구나 알아보는 일반 기호다 (한글 「한」 · 마크다운 M↓ · 표의 칸 · 재생 단추 …). 상표 로고는 쓰지 않는다 —
//   공개 저장소이고, 로고는 작은 크기에서 뭉개진다. 종류 설정(이름 · 확장자 묶음)은 거르기용이라 그림과 따로 간다.

type Shape =
  | "text" | "han" | "word" | "md" | "pdf" | "font" // 종이
  | "sheet" | "csv" | "slide" | "image" | "video" | "audio" | "zip" // 저마다의 윤곽
  | "code" | "braces" | "hash" | "db" | "exe" | "link";
/** `dark` — 어둡게에서 쓸 색. 없으면 형식 색을 흰색과 60:40 으로 섞는다 (FileGlyph). */
type Fmt = { color: string; shape: Shape; dark?: string };

const FMT: Record<string, Fmt> = {};
const def = (exts: string, color: string, shape: Shape, dark?: string) => exts.split(" ").forEach((x) => (FMT[x] = { color, shape, dark }));
// 2026.11.13 : 한글 · 워드 · md · 코드 · db · 실행 파일만 어둡게 색을 따로 둔다.
//   한글 · 워드 — 둘 다 파란 딱지라 하늘빛 / 남빛으로 밝기 · 색조를 벌렸는데, 흰색과 섞으면 그 차이가 줄어 다시 같은 파랑이 된다.
//   회색 갈래 — 짙은 종이색으로 파낸 상징이 섞은 중간 회색 위에서 묻혀 회색 네모로만 보였다. 더 밝혀 대비를 세운다.
def("hwp hwpx hwt hml", "#1593d6", "han", "#5ccaf7");
def("doc docx dot dotx odt rtf", "#28479a", "word", "#7b8fe0");
def("txt log ini cfg conf", "#6b7280", "text");
def("md markdown mdx", "#3b4250", "md", "#c4c9d2");
def("xls xlsx xlsm xlsb ods cell", "#1f8f4e", "sheet");
def("csv tsv", "#3c8d5a", "csv");
def("ppt pptx pps ppsx odp key show", "#d9622b", "slide");
def("pdf", "#d33b3b", "pdf");
def("png jpg jpeg gif bmp webp tif tiff heic ico psd ai svg raw", "#8e4ec6", "image");
def("mp4 mov avi mkv wmv webm m4v camproj trec", "#c2417e", "video");
def("mp3 wav m4a flac ogg aac wma", "#a8448f", "audio");
def("zip 7z rar alz egg tar gz tgz bz2 xz z01 z02 z03 z04", "#9a6b2f", "zip");
def("js mjs cjs ts tsx jsx java jsp py rs go c cpp h hpp cs kt swift rb php vue", "#4b5563", "code", "#b9c0cb");
def("html htm", "#e4572e", "code");
def("json yml yaml xml toml", "#6d5bd0", "braces");
def("css scss less", "#2965f1", "hash");
def("sql db sqlite mdb accdb", "#64748b", "db", "#a7b6c9");
def("exe msi bat cmd ps1 sh appx", "#3f4754", "exe", "#c0c7d1");
def("lnk url", "#0e7c86", "link");
def("ttf otf woff woff2", "#5b5f97", "font");

// 32 칸 기준. `C` 는 형식 색(currentColor), `P` 는 종이 색 — 색 덩어리 위의 흰 상징은 P 로 파낸다 (어둡게에서는 짙은 회색).
const C = "currentColor";
const P = "var(--icon-paper)";
const KO = "Pretendard, 'Malgun Gothic', sans-serif";

/** 종이 — 가운데(텍스트 · 모르는 형식) 또는 왼쪽으로 비켜(딱지 문서, x 가 3 칸 당겨진다). 테두리는 형식 색을 엷게. */
function Paper({ left = false }: { left?: boolean }) {
  const d = left
    ? "M4.5 2.75h11.25l6.5 6.5v18.75c0 .83-.67 1.5-1.5 1.5H4.5c-.83 0-1.5-.67-1.5-1.5V4.25c0-.83.67-1.5 1.5-1.5z"
    : "M7.5 2.75h11.25l6.5 6.5v18.75c0 .83-.67 1.5-1.5 1.5h-16.25c-.83 0-1.5-.67-1.5-1.5V4.25c0-.83.67-1.5 1.5-1.5z";
  const fold = left ? "M15.75 2.75v5c0 .83.67 1.5 1.5 1.5h5z" : "M18.75 2.75v5c0 .83.67 1.5 1.5 1.5h5z";
  return (
    <>
      <path d={d} fill={P} />
      <path d={d} fill={C} fillOpacity="0.06" stroke={C} strokeOpacity="0.55" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={fold} fill={C} fillOpacity="0.4" />
    </>
  );
}

/** 딱지 문서 — 종이를 왼쪽으로 비키고, 오른쪽 아래에 형식 색 딱지를 겹쳐 그 안에 상징을 파낸다.
 *  16px 에서는 <흰 종이 + 오른쪽 색 네모>로 읽힌다 — 딱지 색만으로 한글 · 워드 · md · pdf 가 갈린다.
 *  2026.11.13 : 왼쪽 아래 → 오른쪽 아래. 바로가기 화살표(styles.css .shortcut-arrow)가 왼쪽 아래 40% 를 덮어
 *    문서를 가리키는 바로가기에서 딱지가 통째로 가려졌다. */
function Tagged({ mark }: { mark: ReactNode }) {
  return (
    <>
      <Paper left />
      <path d="M7 15.5h3M7 19.5h3M7 23.5h3" stroke={C} strokeOpacity="0.45" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="13" y="12" width="17" height="14" rx="2.5" fill={C} />
      {mark}
    </>
  );
}

// 판의 머리 — 윗줄(창 · 쉼표 값) · 윗줄 + 왼쪽 칸(표). Board 의 둥근 모서리(r 3)를 따라 깎는다.
const HEAD_ROW = "M3 8a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v2H3z";
const HEAD_ROW_TALL = "M3 8a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v3H3z";
const HEAD_CORNER = "M3 8a3 3 0 0 1 3-3h20a3 3 0 0 1 3 3v3H11v16H6a3 3 0 0 1-3-3z";

/** 판 — 창 · 표 · 쉼표 값 · 그림이 같이 쓰는 가로 넓은 흰 판. 종이색을 먼저 깔고(목록 바탕이 비치지 않게) 형식 색을 `tint` 만큼
 *  엷게 덮은 뒤, 머리(`head`)를 칠하고 테두리를 두른다. 크기 · 모서리를 바꿀 때는 여기와 HEAD_* 만 고친다. */
function Board({ tint = 0.06, head, children }: { tint?: number; head?: string; children: ReactNode }) {
  return (
    <>
      <rect x="3" y="5" width="26" height="22" rx="3" fill={P} />
      <rect x="3" y="5" width="26" height="22" rx="3" fill={C} fillOpacity={tint} />
      {head && <path d={head} fill={C} />}
      <rect x="3" y="5" width="26" height="22" rx="3" fill="none" stroke={C} strokeWidth="1.8" />
      {children}
    </>
  );
}

const line = (w: number, color = C) => ({ fill: "none", stroke: color, strokeWidth: w, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

function drawing(s: Shape): ReactNode {
  switch (s) {
    case "text":
      return (
        <>
          <Paper />
          <path d="M11 14h10M11 18h10M11 22h6.5" {...line(1.9)} strokeOpacity="0.8" />
        </>
      );
    case "han":
      return (
        <Tagged
          mark={
            <text x="21.5" y="22.6" textAnchor="middle" fontSize="10.5" fontWeight="800" fill={P} fontFamily={KO}>
              한
            </text>
          }
        />
      );
    case "word":
      return <Tagged mark={<path d="M17 16h9M17 19h9M17 22h6" {...line(1.7, P)} />} />;
    case "md":
      return <Tagged mark={<path d="M16 22.5v-7l2.75 3.3 2.75-3.3v7M25.5 15.5v7M23.7 20.7l1.8 1.8 1.8-1.8" {...line(1.6, P)} />} />;
    case "pdf":
      return (
        <Tagged
          mark={
            <text x="21.5" y="21.6" textAnchor="middle" fontSize="7" fontWeight="800" letterSpacing="0.1" fill={P} fontFamily={KO}>
              PDF
            </text>
          }
        />
      );
    case "font":
      return (
        <Tagged
          mark={
            <text x="21.5" y="22.8" textAnchor="middle" fontSize="10" fontWeight="700" fill={P} fontFamily="Georgia, serif">
              Aa
            </text>
          }
        />
      );
    case "sheet":
      // 표 — 머리 줄 · 머리 칸을 형식 색으로 채워 16px 에서도 <초록 ㄱ 자 + 흰 칸>으로 읽힌다.
      return (
        <Board tint={0} head={HEAD_CORNER}>
          <path d="M11 16.3h18M11 21.6h18M20 11v16" stroke={C} strokeWidth="1.4" strokeOpacity="0.7" />
        </Board>
      );
    case "csv":
      // 쉼표 값 — 표와 같은 판이되 머리 칸 없이 끊긴 줄만. 표보다 가벼워 둘이 갈린다.
      return (
        <Board tint={0} head={HEAD_ROW_TALL}>
          <path d="M7 15.5h4.5M15 15.5h4.5M23 15.5h2.5M7 19.5h4.5M15 19.5h4.5M23 19.5h2.5M7 23.5h4.5M15 23.5h4.5" {...line(1.8)} />
        </Board>
      );
    case "slide":
      // 발표 — 받침 달린 화면. 넓은 윤곽 + 아래 다리가 표 · 그림과 갈린다.
      return (
        <>
          <rect x="2.5" y="4" width="27" height="19" rx="2" fill={C} />
          <rect x="5.5" y="7" width="21" height="13" rx="0.8" fill={P} />
          <path d="M11 17v-3.5M16 17v-6M21 17v-4.5" {...line(2.4)} />
          <path d="M16 23v4.5M11.5 28h9" {...line(2)} />
        </>
      );
    case "image":
      // 그림 — 액자. 산과 해를 형식 색으로 채운다.
      return (
        <Board tint={0.12}>
          <circle cx="21.5" cy="11.5" r="2.6" fill={C} />
          <path d="M3.9 24.5 11.5 15l5.2 6.2 3.3-3.7 8.1 7v.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill={C} />
        </Board>
      );
    case "video":
      // 영상 — 넓은 색 판에 재생 단추를 파낸다. 양옆 필름 구멍으로 그림 · 발표와 갈린다.
      // 삼각형 모서리는 같은 색 선을 둘러 둥글린다 — 채우기만으로는 꼭짓점이 뾰족하다.
      return (
        <>
          <rect x="2" y="6" width="28" height="20" rx="3.5" fill={C} />
          <path d="M13.5 11.8v8.4l7-4.2z" fill={P} stroke={P} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M5.5 9.5v.01M5.5 16v.01M5.5 22.5v.01M26.5 9.5v.01M26.5 16v.01M26.5 22.5v.01" {...line(2.2, P)} />
        </>
      );
    case "audio":
      // 소리 — 종이 없이 음표 둘. 윤곽 자체가 다르다.
      return (
        <g fill={C}>
          <path d="M11 24.5V8.2l15-3.2v16.3" fill="none" stroke={C} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M11 8.2l15-3.2v4.5l-15 3.2z" />
          <ellipse cx="7.6" cy="24.6" rx="4.1" ry="3.3" />
          <ellipse cx="22.6" cy="21.4" rx="4.1" ry="3.3" />
        </g>
      );
    case "zip":
      // 압축 — 뚜껑 덮인 상자에 지퍼를 파낸다.
      return (
        <>
          <rect x="4" y="9" width="24" height="19" rx="2" fill={C} />
          <rect x="2.5" y="4" width="27" height="6.5" rx="1.8" fill={C} />
          <path d="M2.5 10.5h27" stroke={P} strokeWidth="1.2" strokeOpacity="0.6" />
          <path d="M16 4v2M16 8.5v2M16 13v2M16 17.5v2" stroke={P} strokeWidth="2.2" />
          <rect x="13.5" y="21" width="5" height="4.5" rx="1" fill={P} />
        </>
      );
    case "code":
      // 코드 · 설정 · 스타일 — 윗줄을 칠한 흰 창에 기호를 형식 색으로.
      return (
        <Board head={HEAD_ROW}>
          <path d="M12.5 14l-4 4.5 4 4.5M19.5 14l4 4.5-4 4.5M17.5 13l-3 11" {...line(2)} />
        </Board>
      );
    case "braces":
      return (
        <Board head={HEAD_ROW}>
          <path
            d="M13 13c-1.8 0-2.3.8-2.3 2.2v1.6c0 1-.6 1.6-1.7 1.8 1.1.2 1.7.8 1.7 1.8v1.6c0 1.4.5 2.2 2.3 2.2M19 13c1.8 0 2.3.8 2.3 2.2v1.6c0 1 .6 1.6 1.7 1.8-1.1.2-1.7.8-1.7 1.8v1.6c0 1.4-.5 2.2-2.3 2.2"
            {...line(1.9)}
          />
        </Board>
      );
    case "hash":
      return (
        <Board head={HEAD_ROW}>
          <path d="M14 13.5l-1.4 11M19.4 13.5l-1.4 11M10.5 16.8h12.5M9.8 21.2h12.5" {...line(1.9)} />
        </Board>
      );
    case "db":
      // 자료 묶음 — 원통. 칠한 원통에 고리 둘을 파낸다.
      return (
        <>
          <path d="M5 7.5c0-2.2 4.9-4 11-4s11 1.8 11 4v17c0 2.2-4.9 4-11 4s-11-1.8-11-4z" fill={C} />
          <path d="M5 13.5c0 2.2 4.9 4 11 4s11-1.8 11-4M5 19.5c0 2.2 4.9 4 11 4s11-1.8 11-4" {...line(1.5, P)} />
        </>
      );
    case "exe":
      // 실행 파일 — 칠한 짙은 창에 입력 표시를 파낸다. 코드의 흰 창과 갈린다.
      return (
        <>
          <rect x="3" y="5" width="26" height="22" rx="3" fill={C} />
          <path d="M9 13l4.5 4-4.5 4M15.5 22h7" {...line(2.2, P)} />
        </>
      );
    case "link":
      return (
        <g {...line(2.6)}>
          <path d="M14.2 20.2l-2.4 2.4a4 4 0 0 1-5.6-5.6l3.6-3.6a4 4 0 0 1 5.6 0" />
          <path d="M17.8 11.8l2.4-2.4a4 4 0 0 1 5.6 5.6l-3.6 3.6a4 4 0 0 1-5.6 0" />
        </g>
      );
    default:
      // 형식 표에 갈래를 더하고 그림을 빠뜨려도 빈 아이콘 대신 빈 종이가 나오게 둔다.
      return <Paper />;
  }
}

/** filedesk 파일 아이콘. 모르는 형식은 흐린 빈 종이에, 크면(40px 넘게) 확장자를 쓴다. */
export function FileGlyph({ ext, size = 16 }: { ext: string; size?: number }) {
  const x = ext.toLowerCase();
  const f = FMT[x];
  // 어둡게에서는 형식 색을 흰색 쪽으로 한 단 밝힌다 — 짙은 색이 어두운 바탕에 묻혔다. 따로 정한 색(`dark`)이 있으면 그것을 쓴다.
  const tone = f ? `light-dark(${f.color}, ${f.dark ?? `color-mix(in srgb, ${f.color} 60%, #fff)`})` : "var(--muted)";
  const label = size > 40 && !f ? x.slice(0, 5).toUpperCase() : "";
  return (
    <svg className="glyph file-glyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ color: tone }}>
      {f ? drawing(f.shape) : <Paper />}
      {label && (
        <text x="16" y="23" textAnchor="middle" fontSize="6" fontWeight="700" fill={C} fontFamily="Pretendard, system-ui, sans-serif">
          {label}
        </text>
      )}
    </svg>
  );
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

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={"chev" + (open ? " open" : "")} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2 6.5 5 3.5 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
