// 경로 · 표시 도우미. Windows 경로만 다룬다 (드라이브 · UNC).

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Entry, Theme } from "./api";

export const samePath = (a: string, b: string) => norm(a) === norm(b);

export function norm(p: string): string {
  let s = p.replace(/\//g, "\\");
  if (s.length > 3) s = s.replace(/\\+$/, "");
  return s.toLowerCase();
}

/** 화면 색을 문서 뿌리 · 창 틀에 입힌다. `system` 은 data-theme 를 지워 CSS 의 prefers-color-scheme 에 맡긴다.
 *  localStorage 에도 둔다 — 설정 파일은 비동기로 읽혀서, 그것만 기다리면 켤 때 한 번 시스템 색으로 번쩍인다 (main.tsx). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch {}
  getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {});
}

/** UNC 의 뿌리(`\\서버\공유`)를 돌려준다. UNC 가 아니면 null. */
function uncRoot(p: string): string | null {
  const m = /^\\\\[^\\]+\\[^\\]+/.exec(p);
  return m ? m[0] : null;
}

export function parentOf(p: string): string | null {
  const s = p.replace(/\\+$/, "");
  const unc = uncRoot(s);
  if (unc && s.length <= unc.length) return null;
  if (/^[A-Za-z]:$/.test(s)) return null;
  const i = s.lastIndexOf("\\");
  if (i < 0) return null;
  const parent = s.slice(0, i);
  return /^[A-Za-z]:$/.test(parent) ? parent + "\\" : parent;
}

export function baseName(p: string): string {
  const s = p.replace(/\\+$/, "");
  if (/^[A-Za-z]:$/.test(s)) return s;
  const unc = uncRoot(s);
  if (unc && s.length <= unc.length) return s;
  return s.slice(s.lastIndexOf("\\") + 1);
}

/** 주소창 조각: `C:\Users\x` → [C:\, C:\Users, C:\Users\x] */
export function segments(p: string): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  let cur: string | null = p;
  while (cur) {
    out.unshift({ label: baseName(cur), path: cur });
    cur = parentOf(cur);
  }
  return out;
}

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export type SortKey = "name" | "modified" | "kind" | "size";
export type Sort = { key: SortKey; asc: boolean };

/** 탐색기처럼 폴더를 먼저(설정 「폴더를 위에」), 이름은 숫자를 숫자로 비교한다 (「v2」 < 「v10」). */
export function sortEntries(list: Entry[], sort: Sort, dirsFirst = true): Entry[] {
  const dir = sort.asc ? 1 : -1;
  return [...list].sort((a, b) => {
    if (dirsFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let c = 0;
    switch (sort.key) {
      case "modified":
        c = a.modified - b.modified;
        break;
      case "kind":
        c = collator.compare(a.kind, b.kind);
        break;
      case "size":
        c = a.size - b.size;
        break;
      default:
        c = 0;
    }
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * dir;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `kb` 는 탐색기 자세히 보기와 같은 꼴: KB 올림 · 천 단위 쉼표. `auto` 는 알맞은 단위 (설정 「크기」). */
export function formatSize(e: Entry, unit: "kb" | "auto" = "kb"): string {
  if (e.isDir) return "";
  if (unit === "auto") return formatBytes(e.size);
  return `${Math.ceil(e.size / 1024).toLocaleString("ko-KR")}KB`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}바이트`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)}${u[i]}`;
}

export function errText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/** 목록의 날짜 — 가까운 것은 말로, 먼 것은 짧게. 정확한 시각은 title 로. 설정 「고친 날」이 `absolute` 면 늘 날짜와 시각. */
export function relDate(ms: number, style: "relative" | "absolute" = "relative"): string {
  if (!ms) return "";
  if (style === "absolute") return formatDate(ms);
  const d = new Date(ms);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 0) return `오늘 ${hm}`;
  if (diff === 1) return `어제 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 이름을 줄기와 확장자로 (확장자는 흐리게 그린다). */
export function splitName(name: string, isDir: boolean): [string, string] {
  if (isDir) return [name, ""];
  const i = name.lastIndexOf(".");
  return i > 0 && name.length - i <= 9 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

/** 열 너비 기본값: 이름 · 판 · 고친 날 · 크기 (이름 칸은 남는 자리를 다 쓰므로 최소 너비).
 *  2026.11.11 : 「유형」 열(셸의 긴 종류 이름)을 빼고 「판」을 넣었다 — 확장자는 이름 끝에 흐리게 보인다. */
export const DEFAULT_COLS = [280, 170, 110, 84];

/** 파일 종류 — 목록 위 「종류」 거르기 · filedesk 아이콘의 띠 색. 셸의 긴 종류 이름 대신 일에서 쓰는 말로 묶는다.
 *  2026.11.11 : 고정 표였던 것을 설정(보기 › 종류)에서 고치게 했다 — 쓰는 사람마다 「발표」 · 「표」 같은 묶음이 맞지 않았다.
 *  「폴더」 · 「기타」(어느 종류에도 없는 확장자)는 고정이라 이 목록에 없다. 확장자가 두 종류에 있으면 앞 종류가 갖는다. */
export type KindDef = { id: string; label: string; exts: string[]; color: string };
export const FOLDER = "folder";
export const OTHER = "other";
const xs = (s: string) => s.split(" ");
export const DEFAULT_KINDS: KindDef[] = [
  { id: "doc", label: "문서", color: "#3f72d9", exts: xs("hwp hwpx doc docx odt rtf txt md") },
  { id: "sheet", label: "표", color: "#2f9e5a", exts: xs("xls xlsx xlsm csv ods cell") },
  { id: "slide", label: "발표", color: "#e0732c", exts: xs("ppt pptx odp show key") },
  { id: "pdf", label: "PDF", color: "#d64545", exts: xs("pdf") },
  { id: "image", label: "그림", color: "#8e4ec6", exts: xs("png jpg jpeg gif bmp webp svg tif tiff heic ico psd ai") },
  { id: "media", label: "영상 · 소리", color: "#c2417e", exts: xs("mp4 mov avi mkv wmv webm mp3 wav m4a flac") },
  { id: "archive", label: "압축", color: "#a07a3c", exts: xs("zip 7z rar alz egg tar gz tgz") },
  { id: "code", label: "코드", color: "#5b6470", exts: xs("js ts tsx jsx java jsp py rs go c cpp h cs sql xml json yml yaml html css sh ps1 bat") },
];
/** 새 종류에 돌려 가며 주는 색 — 기본 종류 색과 겹치지 않는 중간 밝기. */
export const KIND_PALETTE = ["#1f8a9e", "#b8862b", "#6a5acd", "#3d8b3d", "#c0504d", "#4a7ab5"];
const OTHER_COLOR = "#8b8f96";

/** 확장자 글을 목록으로 — 빈칸 · 쉼표로 나누고, 앞의 점은 떼고, 소문자로. */
export const parseExts = (s: string) => [...new Set(s.split(/[\s,·]+/).map((x) => x.replace(/^\*?\./, "").toLowerCase()).filter(Boolean))];

// 지금 쓰는 종류 — App 이 설정을 읽은 뒤 setKinds 로 넣는다. 아이콘(glyphs)처럼 설정을 받지 않는 곳도 같은 표를 본다.
let kinds: KindDef[] = DEFAULT_KINDS;
let extKind = new Map<string, KindDef>();
export function setKinds(list: KindDef[]) {
  if (list === kinds && extKind.size) return;
  kinds = list;
  extKind = new Map();
  for (const k of list) for (const x of k.exts) if (!extKind.has(x)) extKind.set(x, k);
}
setKinds(DEFAULT_KINDS);

/** 거르기 단추 순서 — 폴더 · 설정의 종류 순서 · 기타. */
export const kindOrder = () => [FOLDER, ...kinds.map((k) => k.id), OTHER];
export const kindLabel = (id: string) => (id === FOLDER ? "폴더" : id === OTHER ? "기타" : (kinds.find((k) => k.id === id)?.label ?? "기타"));
export const kindColor = (id: string) => kinds.find((k) => k.id === id)?.color ?? OTHER_COLOR;

// 아이콘 팩 — 설정 「아이콘 › 아이콘 팩」 폴더의 그림. App 이 읽어 setIconPack 으로 넣는다.
let pack: Record<string, string> = {};
export function setIconPack(map: Record<string, string>) {
  pack = map;
}
/** 팩에서 이 항목의 그림 주소 — 확장자 → 종류 → folder · file 차례. 없으면 null (filedesk 그림을 쓴다). */
export function packIconUrl(e: Pick<Entry, "isDir" | "ext">): string | null {
  const f = e.isDir ? pack.folder : (pack[e.ext.toLowerCase()] ?? pack[kindOf(e)] ?? pack.file);
  return f ? `http://fdicon.localhost/${encodeURIComponent(`pack:${f}`)}` : null;
}

/** 격자에서 내용을 미리 보일 수 있는 확장자 — 셸 미리보기가 그리는 것이라 종류 설정과 따로 둔다. */
const THUMB_EXTS = new Set(["image", "pdf", "media"].flatMap((id) => DEFAULT_KINDS.find((k) => k.id === id)!.exts));
export const canThumb = (ext: string) => THUMB_EXTS.has(ext.toLowerCase());

export function kindOf(e: Pick<Entry, "isDir" | "ext">): string {
  return e.isDir ? FOLDER : (extKind.get(e.ext.toLowerCase())?.id ?? OTHER);
}
