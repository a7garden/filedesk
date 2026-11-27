// 앱 안에서 바로 보는 파일 — 어떤 확장자를 셸에 넘기지 않고 filedesk 가 여는가 · 그 파일의 주소 풀기.
// 2026.11.11 : md · txt 는 앱 안 편집기, 그림은 앱 안 보기로 연다. 기본 앱은 오른쪽 메뉴 「열기」나 보기 머리의 단추로.
import { invoke } from "@tauri-apps/api/core";
import { parentOf } from "./util";

/** 글 파일 (fd-core textfile::EXTS 와 같아야 한다). */
/** 2026.11.12 : 설정 · 자료 글(ini · json · xml · yaml …)을 더했다. 실행되는 글(bat · ps1 · reg)은 넣지 않는다. */
export const TEXT_EXTS = new Set(
  "md markdown txt log ini cfg conf config properties json jsonc xml yaml yml toml env gitignore editorconfig nfo srt csv tsv".split(" "),
);
/** 표 — 글 파일이지만 표로 먼저 보인다 (머리의 「표 · 글」로 바꾼다). 2026.11.25 사용자 요청으로 더했다. */
export const TABLE_EXTS = new Set(["csv", "tsv"]);

/** 칸 나누는 글자. tsv 는 탭, csv 는 첫 줄에 가장 많은 것 (쉼표 · 세미콜론 · 탭) — 유럽식 엑셀은 세미콜론으로 낸다. */
export function tableSep(ext: string, text: string): string {
  if (ext.toLowerCase() === "tsv") return "\t";
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => first.split(c).length - 1;
  return [",", ";", "\t"].reduce((a, b) => (count(b) > count(a) ? b : a));
}

/** 표의 칸 — 글(`v`)과 원본 글에서의 자리(`s` ~ `e`, 따옴표 포함) · 따옴표로 싸여 있었는지. 칸을 고치면 이 자리만 바꿔 쓴다. */
export type TableCell = { v: string; s: number; e: number; q: boolean };
/** 표의 줄 — 칸들 · 줄 글의 자리(`s` ~ `e`, 줄끝 빼고) · 다음 줄이 시작하는 자리(`next`, 마지막 줄이면 글 끝). */
export type TableRow = { cells: TableCell[]; s: number; e: number; next: number };

/** csv · tsv 를 줄 · 칸으로 (RFC 4180) — 따옴표 안의 구분자 · 줄바꿈 · `""` 를 칸 글로 둔다.
 *  2026.11.25 : 칸마다 원본 자리를 함께 낸다. 표에서 칸 하나를 고치면 그 칸의 글만 바꿔 쓰고 나머지(따옴표 · 줄끝 · 빈 칸)는 원래 꼴대로 둔다. */
export function parseTable(text: string, sep: string): TableRow[] {
  const rows: TableRow[] = [];
  const n = text.length;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let cells: TableCell[] = [];
  let cell = "";
  let cs = start;
  let rs = start;
  let inQuote = false;
  let quoted = false;
  for (let i = start; i < n; i++) {
    const c = text[i];
    if (inQuote) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') (cell += '"'), i++;
      else inQuote = false;
    } else if (c === '"' && i === cs) inQuote = quoted = true;
    else if (c === sep) {
      cells.push({ v: cell, s: cs, e: i, q: quoted });
      (cell = ""), (cs = i + 1), (quoted = false);
    } else if (c === "\n" || c === "\r") {
      const e = i;
      if (c === "\r" && text[i + 1] === "\n") i++;
      cells.push({ v: cell, s: cs, e, q: quoted });
      rows.push({ cells, s: rs, e, next: i + 1 });
      (cells = []), (cell = ""), (cs = rs = i + 1), (quoted = false);
    } else cell += c;
  }
  if (cs < n || cells.length) {
    cells.push({ v: cell, s: cs, e: n, q: quoted });
    rows.push({ cells, s: rs, e: n, next: n });
  }
  return rows;
}

/** 칸 글을 파일에 쓸 꼴로 — 구분자 · 따옴표 · 줄바꿈이 들었거나 원래 따옴표로 싸여 있었으면 싼다. */
export function quoteCell(v: string, sep: string, wasQuoted = false): string {
  return wasQuoted || v.includes(sep) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
/** 마크다운 — 보기(렌더) · 편집 · 나란히. 나머지 글 파일은 편집기만. */
export const MD_EXTS = new Set(["md", "markdown"]);
/** 그림 (lib.rs image_mime 과 같아야 한다). WebView2 가 그대로 그리는 것만 — heic · tiff · psd 는 기본 앱으로. */
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "svg", "ico", "avif"]);

/** 엑셀 · 스프레드시트 — 시트를 표로 미리 본다 (lib.rs read_sheets · fd-core sheet). 고치기는 기본 앱으로. 2026.11.25 */
export const SHEET_EXTS = new Set(["xlsx", "xlsm", "xlsb", "xls", "ods"]);
/** 파워포인트 — 쪽을 HTML 로 미리 본다 (pptx.ts). 옛 꼴 ppt 는 zip 이 아니라 기본 앱으로. 2026.11.25 */
export const SLIDE_EXTS = new Set(["pptx", "pptm", "ppsx"]);
/** 한글 — 쪽을 SVG 로 미리 본다 (HwpView · rhwp). 옛 꼴 hwp 도 읽는다. 2026.11.25 */
export const HWP_EXTS = new Set(["hwp", "hwpx"]);

export type ViewKind = "text" | "image" | "sheet" | "slides" | "hwp";
export function viewKind(ext: string): ViewKind | null {
  const x = ext.toLowerCase();
  return TEXT_EXTS.has(x) ? "text" : IMAGE_EXTS.has(x) ? "image" : SHEET_EXTS.has(x) ? "sheet" : SLIDE_EXTS.has(x) ? "slides" : HWP_EXTS.has(x) ? "hwp" : null;
}

/** 엑셀 시트 하나 (fd-core sheet::Sheet). `loaded` 가 거짓이면 이름만 있다 — 탭을 누를 때 읽는다. */
export type Sheet = { name: string; rows: string[][]; row0: number; col0: number; totalRows: number; truncated: boolean; loaded: boolean };
/** 시트 목록과 `at` 번째 시트의 칸 (2026.11.27 · 고른 시트만 읽는다). */
export const readSheets = (path: string, at: number) => invoke<Sheet[]>("read_sheets", { path, at });

/** 보기 옆 파일 목록(Pane 의 .view-strip)이 키를 받는 중인가 — 목록에서 ↑↓ 로 넘길 때 새로 연 보기가 초점을 가져가지 않게.
 *  보기마다 열 때 제 몸에 초점을 주는데(바로 굴리기 · 치기), 이 때는 하지 않는다. 2026.11.25 */
export const stripHasFocus = () => !!document.activeElement?.closest(".view-strip");

/** 그림 원본 주소. `m` 은 수정 시각 — 고친 그림이 캐시로 옛 모습을 보이지 않게. */
export const rawUrl = (path: string, m?: number) => `http://fdicon.localhost/${encodeURIComponent(`raw:${path}`)}${m ? `?m=${m}` : ""}`;

export type TextEncoding = "utf8" | "utf8bom" | "utf16le" | "utf16be" | "cp949";
/** `mixed` — 줄끝이 섞인 파일. 고쳐 쓰면 줄끝이 한 가지로 바뀌어 읽기만 한다 (fd-core textfile).
 *  `skipped` — 앞에서 건너뛴 바이트. 8MB 넘는 글은 끝 2MB 만 읽어 읽기 전용으로 본다 (2026.11.27 · 0 이면 전체). */
export type TextFile = { text: string; encoding: TextEncoding; crlf: boolean; mixed: boolean; modified: number; skipped: number };
export const ENCODING_LABEL: Record<TextEncoding, string> = { utf8: "UTF-8", utf8bom: "UTF-8 BOM", utf16le: "UTF-16", utf16be: "UTF-16 BE", cp949: "CP949" };

export const textApi = {
  read: (path: string) => invoke<TextFile>("read_text", { path }),
  /** 밖에서 바뀌었으면 오류 `changed`. 돌려주는 값은 쓴 뒤의 수정 시각. */
  write: (path: string, f: Omit<TextFile, "modified" | "mixed" | "skipped">, modified: number) =>
    invoke<number>("write_text", { path, text: f.text, encoding: f.encoding, crlf: f.crlf, modified }),
  modifiedOf: (path: string) => invoke<number>("modified_of", { path }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
};

/** 네트워크 경로(`\host\share\…`)의 호스트 — 아니면 null. */
const uncHost = (p: string) => (p.startsWith("\\\\") ? (p.slice(2).split("\\")[0] ?? "").toLowerCase() : null);

/** 문서 속 주소가 그 문서와 다른 네트워크 호스트를 가리키는가.
 *  2026.11.11 리뷰 : 받은 md 의 `![](\\남의서버\x.png)` 를 열기만 해도 그 서버에 Windows 로그인 정보(NTLM)가 건너갔다.
 *  같은 NAS 안의 문서끼리는 그대로 둔다 — 그 서버는 이미 사용자가 연 곳이다. */
export function foreignShare(path: string, doc: string): boolean {
  const h = uncHost(path);
  return h != null && h !== uncHost(doc);
}

/** 문서 속 링크로 바로 열지 않는 꼴 — 실행되는 파일. 받은 md 의 링크 한 번에 프로그램이 돌면 안 된다 (2026.11.11 리뷰). */
const RUNNABLE = new Set(
  "exe com bat cmd ps1 psm1 psd1 vbs vbe js jse wsf wsh msi msp msix appx scr pif lnk url hta cpl reg jar appref-ms application settingcontent-ms library-ms scf inf chm msc gadget diagcab".split(" "),
);
export const runnable = (path: string) => RUNNABLE.has((path.split(".").pop() ?? "").toLowerCase());

/** 마크다운 속 주소(그림 · 링크)를 파일 경로로. 웹 주소 · 쪽 안 앵커면 null.
 *  `./그림.png` · `../a/b.md` · `그림%201.png` · `C:/…` · `file:///C:/…` 를 문서 폴더 기준으로 푼다. */
export function localPath(href: string, doc: string): string | null {
  let h = href.trim();
  if (!h || h.startsWith("#") || /^(https?|mailto|data|blob):/i.test(h)) return null;
  h = h.replace(/[?#].*$/, "");
  try {
    h = decodeURIComponent(h);
  } catch {
    // 잘못된 % 꼴은 그대로 둔다
  }
  h = h.replace(/^file:\/{2,3}/i, "").replace(/\//g, "\\");
  const abs = /^[A-Za-z]:\\/.test(h) || h.startsWith("\\\\");
  const parts = (abs ? h : `${parentOf(doc) ?? ""}\\${h}`).split("\\");
  const out: string[] = [];
  parts.forEach((s, i) => {
    if (s === "..") out.length > 1 && out.pop();
    else if (s !== "." && (s !== "" || i < 2)) out.push(s);
  });
  return out.join("\\");
}
