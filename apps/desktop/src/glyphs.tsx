// 자체 선 그림. 폴더는 셸의 노란 아이콘 대신 이것을 쓴다 — 파일 아이콘(앱 구분)은 설정에 따라 셸 것이나 FileGlyph.
import { kindColor, kindOf } from "./util";

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

/** filedesk 파일 아이콘 — 접힌 귀퉁이 종이 + 종류 색 띠. 크면(28px 넘게) 띠에 확장자를 쓴다.
 *  2026.11.11 : 설정 「아이콘 — filedesk」. 셸 아이콘은 프로그램마다 모양 · 색이 제각각이라 종류를 한눈에 가리기 어렵다. */
export function FileGlyph({ ext, size = 16 }: { ext: string; size?: number }) {
  const color = kindColor(kindOf({ isDir: false, ext }));
  if (size < 28)
    return (
      <svg className="glyph file-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 1.75h5.75l3.25 3.25v9.25h-9z" fill="var(--raise)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M9.25 1.75V5h3.25" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
        <rect x="5" y="9" width="6" height="3.2" rx="0.9" fill={color} />
      </svg>
    );
  const label = ext.slice(0, 4).toUpperCase();
  return (
    <svg className="glyph file-glyph" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M11 4.5h18l9.5 9.5v29.5H11z" fill="var(--raise)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.9" />
      <path d="M29 4.5V14h9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" opacity="0.9" />
      <rect x="7" y="26" width="26" height="12" rx="2.5" fill={color} />
      {label && (
        <text x="20" y="34.6" textAnchor="middle" fontSize={label.length > 3 ? 7.4 : 8.6} fontWeight="700" fill="#fff" fontFamily="Pretendard, system-ui, sans-serif">
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

/** 화면 색: 시스템은 반쪽 원 · 밝게는 빈 원 · 어둡게는 찬 원. */
export function ThemeGlyph({ theme }: { theme: "system" | "light" | "dark" }) {
  return (
    <svg className="glyph" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.6" fill={theme === "dark" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" />
      {theme === "system" && <path d="M6 1.4a4.6 4.6 0 0 1 0 9.2z" fill="currentColor" />}
    </svg>
  );
}
