// 찾기 조건 · 스마트 폴더 도우미 — 조건 문법은 Rust(fd-core query)가 풀고, 여기서는 이 폴더 목록을 그 자리에서 거르고 칩 · 범위를 다룬다.
//
// 이 폴더 목록은 글자를 칠 때마다 바로 걸러야 해서 맞춰 보기를 TS 로도 둔다 — 조건 꼴(QuerySpec)은 Rust 가 푼 것을 그대로 쓴다.
// 2026.11.12 : 처음 씀.
import type { Entry, QuerySpec, Root, SmartFolder, SmartScope, TagColor } from "./api";
import type { KindDef } from "./util";

/** 종류 표를 Rust 에 넘기는 꼴 — (id, 이름, 확장자들). */
export const kindTable = (kinds: KindDef[]): [string, string, string[]][] => kinds.map((k) => [k.id, k.label, k.exts]);

/** 이 PC 시간대가 UTC 보다 몇 분 앞서는가 (한국 +540). */
export const tzOffset = () => -new Date().getTimezoneOffset();

/** 찾기 칸 글에 조건(`열쇠:값` · `-뺄말`)이 있어 Rust 에 풀어 달라고 할 만한가. */
export const looksLikeQuery = (text: string) => /(^|\s)(-\S|[^\s:]{1,8}:\S)/.test(text);

/** 찾는 말 밖의 조건이 있는가. */
export function hasFilters(s: QuerySpec | null | undefined): boolean {
  if (!s) return false;
  return (
    s.after != null ||
    s.before != null ||
    s.minSize != null ||
    s.maxSize != null ||
    s.exts.length > 0 ||
    s.kinds.length > 0 ||
    s.dirs != null ||
    s.colors.length > 0 ||
    s.anyColor ||
    s.memo != null ||
    s.notTerms.length > 0
  );
}

/** 이 폴더 목록 한 줄을 조건으로 본다. `hay` 는 이름 · 문서 제목 · 메모를 이은 소문자 글 (찾는 말 · 뺄 말을 여기서 본다). */
export function matches(s: QuerySpec, e: Entry, hay: string, memo: string | undefined, color: TagColor | undefined): boolean {
  if (s.dirs != null && s.dirs !== e.isDir) return false;
  const ext = e.ext.toLowerCase();
  if (s.exts.length && (e.isDir || !s.exts.includes(ext))) return false;
  if (s.kinds.length && (e.isDir || !s.kindExts.includes(ext))) return false;
  if (s.minSize != null || s.maxSize != null) {
    if (e.isDir) return false;
    if (s.minSize != null && e.size < s.minSize) return false;
    if (s.maxSize != null && e.size >= s.maxSize) return false;
  }
  if (s.after != null || s.before != null) {
    const t = Math.max(e.modified, e.created ?? 0);
    if (t <= 0 || (s.after != null && t < s.after) || (s.before != null && t >= s.before)) return false;
  }
  if (s.memo != null && s.memo !== !!memo) return false;
  if (s.anyColor && !color) return false;
  if (s.colors.length && !(color && s.colors.includes(color))) return false;
  if (s.notTerms.some((t) => hay.includes(t))) return false;
  return s.terms.every((t) => hay.includes(t));
}

/** 찾기 칸 글에서 칩 하나(`raw`)를 뗀다. */
export function removeToken(text: string, raw: string): string {
  const parts = text.split(/(\s+)/);
  const i = parts.findIndex((p) => p === raw || p === `"${raw}"`);
  if (i < 0) return text;
  parts.splice(i, 1);
  return parts.join("").replace(/\s{2,}/g, " ").trim();
}

/** 「＋ 조건」 메뉴 — 누르면 찾기 칸 끝에 붙는다. */
export const PRESETS: { group: string; label: string; token: string }[] = [
  { group: "고친 날", label: "오늘", token: "고친:오늘" },
  { group: "고친 날", label: "3일 안", token: "고친:3일" },
  { group: "고친 날", label: "7일 안", token: "고친:7일" },
  { group: "고친 날", label: "30일 안", token: "고친:30일" },
  { group: "고친 날", label: "1년 넘게 안 고침", token: "고친:>1년" },
  { group: "크기", label: "10MB 이상", token: "크기:>10MB" },
  { group: "크기", label: "100MB 이상", token: "크기:>100MB" },
  { group: "크기", label: "1KB 미만", token: "크기:<1KB" },
  { group: "종류", label: "파일만", token: "종류:파일" },
  { group: "종류", label: "폴더만", token: "종류:폴더" },
  { group: "표시", label: "색 표시 있음", token: "색:있음" },
  { group: "표시", label: "메모 있음", token: "메모:있음" },
];

/** 스마트 폴더가 볼 곳 → 찾기에 넘길 범위. `inbox` 는 다운로드 · 바탕화면. */
export function scopeOf(scope: SmartScope, inbox: string[]): { all: boolean; roots: Root[] } {
  if (scope.kind === "all") return { all: true, roots: [] };
  if (scope.kind === "inbox") return { all: false, roots: inbox.map((path) => ({ path, recursive: false })) };
  return { all: false, roots: scope.roots };
}

/** 볼 곳을 한 줄로. */
export function scopeLabel(scope: SmartScope): string {
  if (scope.kind === "all") return "모든 드라이브";
  if (scope.kind === "inbox") return "다운로드 · 바탕화면";
  if (!scope.roots.length) return "폴더를 고르지 않았다";
  const first = scope.roots[0];
  const more = scope.roots.length > 1 ? ` 외 ${scope.roots.length - 1}곳` : "";
  return `${first.path}${first.recursive ? " (하위 폴더까지)" : ""}${more}`;
}

/** 볼 곳이 NAS · 공유 폴더뿐인가 — 왼쪽 개수를 1분마다 세지 않는다 (꺼진 NAS 는 몇 초씩 멈춘다). */
export const remoteOnly = (scope: SmartScope) => scope.kind === "roots" && scope.roots.length > 0 && scope.roots.every((r) => r.path.startsWith("\\\\"));

export const RECENT_ID = "recent";

/** 처음부터 있는 스마트 폴더 — 지난 판의 왼쪽 「최근 파일」(다운로드 · 바탕화면 · 최근 3일 · 바로 아래 파일만)과 같은 뜻. */
export const defaultSmart = (): SmartFolder => ({ id: RECENT_ID, name: "최근 파일", q: "고친:3일 종류:파일", scope: { kind: "inbox" } });

export const newSmartId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 설정 파일의 스마트 폴더 — 손으로 고쳐 꼴이 어긋난 것은 버린다. 없으면(지난 판 설정) 「최근 파일」 하나. */
export function validSmart(v: unknown): SmartFolder[] {
  if (!Array.isArray(v)) return [defaultSmart()];
  return v.filter((x): x is SmartFolder => {
    if (!x || typeof x.id !== "string" || typeof x.name !== "string" || typeof x.q !== "string" || !x.scope) return false;
    const k = x.scope.kind;
    if (k === "all" || k === "inbox") return true;
    return k === "roots" && Array.isArray(x.scope.roots) && x.scope.roots.every((r: Root) => r && typeof r.path === "string");
  });
}

/** 「방금」 · 「5분 전」 · 「3시간 전」. */
export function ago(ms: number): string {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 2) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/** 찾은 길을 사람이 읽는 말로 — 결과 머리 · 바닥 줄. */
export function sourceLabel(r: { sources: string[]; indexedAt: number; partial: boolean } | null | undefined): string {
  if (!r) return "";
  const s = r.sources;
  const parts: string[] = [];
  if (s.includes("service") || s.includes("local")) parts.push(`색인${r.indexedAt ? ` · ${ago(r.indexedAt)} 맞춤` : ""}`);
  if (s.includes("live")) parts.push("그 자리에서 훑음");
  if (s.includes("content")) parts.push("본문 색인");
  if (s.includes("notes")) parts.push("메모 · 색 표시");
  if (r.partial) parts.push("일부: 색인을 만드는 중");
  return parts.join(" · ");
}
