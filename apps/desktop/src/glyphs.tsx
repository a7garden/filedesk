// 자체 선 그림. 폴더는 셸의 노란 아이콘 대신 이것을 쓴다 — 파일 아이콘(앱 구분)만 셸 것을 쓴다.

export function FolderGlyph({ faint = false }: { faint?: boolean }) {
  return (
    <svg className={"glyph" + (faint ? " faint" : "")} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
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
