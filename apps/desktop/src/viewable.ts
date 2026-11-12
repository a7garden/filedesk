// 앱 안에서 바로 보는 파일 — 어떤 확장자를 셸에 넘기지 않고 filedesk 가 여는가 · 그 파일의 주소 풀기.
// 2026.11.11 : md · txt 는 앱 안 편집기, 그림은 앱 안 보기로 연다. 기본 앱은 오른쪽 메뉴 「열기」나 보기 머리의 단추로.
import { invoke } from "@tauri-apps/api/core";
import { parentOf } from "./util";

/** 글 파일 (fd-core textfile::EXTS 와 같아야 한다). */
/** 2026.11.12 : 설정 · 자료 글(ini · json · xml · yaml …)을 더했다. 실행되는 글(bat · ps1 · reg)과 csv(대개 엑셀로 연다)는 넣지 않는다. */
export const TEXT_EXTS = new Set(
  "md markdown txt log ini cfg conf config properties json jsonc xml yaml yml toml env gitignore editorconfig nfo srt".split(" "),
);
/** 마크다운 — 보기(렌더) · 편집 · 나란히. 나머지 글 파일은 편집기만. */
export const MD_EXTS = new Set(["md", "markdown"]);
/** 그림 (lib.rs image_mime 과 같아야 한다). WebView2 가 그대로 그리는 것만 — heic · tiff · psd 는 기본 앱으로. */
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "svg", "ico", "avif"]);

export type ViewKind = "text" | "image";
export function viewKind(ext: string): ViewKind | null {
  const x = ext.toLowerCase();
  return TEXT_EXTS.has(x) ? "text" : IMAGE_EXTS.has(x) ? "image" : null;
}

/** 그림 원본 주소. `m` 은 수정 시각 — 고친 그림이 캐시로 옛 모습을 보이지 않게. */
export const rawUrl = (path: string, m?: number) => `http://fdicon.localhost/${encodeURIComponent(`raw:${path}`)}${m ? `?m=${m}` : ""}`;

export type TextEncoding = "utf8" | "utf8bom" | "utf16le" | "utf16be" | "cp949";
/** `mixed` — 줄끝이 섞인 파일. 고쳐 쓰면 줄끝이 한 가지로 바뀌어 읽기만 한다 (fd-core textfile). */
export type TextFile = { text: string; encoding: TextEncoding; crlf: boolean; mixed: boolean; modified: number };
export const ENCODING_LABEL: Record<TextEncoding, string> = { utf8: "UTF-8", utf8bom: "UTF-8 BOM", utf16le: "UTF-16", utf16be: "UTF-16 BE", cp949: "CP949" };

export const textApi = {
  read: (path: string) => invoke<TextFile>("read_text", { path }),
  /** 밖에서 바뀌었으면 오류 `changed`. 돌려주는 값은 쓴 뒤의 수정 시각. */
  write: (path: string, f: Omit<TextFile, "modified" | "mixed">, modified: number) =>
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
