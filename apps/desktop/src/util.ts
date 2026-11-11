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

/** 탐색기처럼 폴더를 먼저, 이름은 숫자를 숫자로 비교한다 (「v2」 < 「v10」). */
export function sortEntries(list: Entry[], sort: Sort): Entry[] {
  const dir = sort.asc ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
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

/** 탐색기 자세히 보기와 같은 꼴: KB 올림 · 천 단위 쉼표. */
export function formatSize(e: Entry): string {
  if (e.isDir) return "";
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

/** 목록의 날짜 — 가까운 것은 말로, 먼 것은 짧게. 정확한 시각은 title 로. */
export function relDate(ms: number): string {
  if (!ms) return "";
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

/** 자리 역할의 사람 말. */
export const ROLE_LABEL: Record<string, string> = {
  canon: "정본",
  received: "받은 것",
  archive: "보관",
  work: "작업",
  history: "지난 판",
  notes: "글",
  code: "코드",
};

/** 고치지 않는 자리 — 지우기 · 이름 바꾸기 전에 묻는다. */
export const PROTECTED_ROLES = new Set(["received", "archive", "history"]);
