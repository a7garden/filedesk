// Rust 명령 창구. 인자 이름은 Tauri 규약대로 camelCase (Rust 쪽은 snake_case).
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_KINDS, type KindDef } from "./util";

export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  attrs: number;
  ext: string;
  kind: string;
};

/** 즐겨찾기 · 위치. `file` 이면 누를 때 그 파일을 연다 (폴더면 들어간다). */
export type Place = { name: string; path: string; file?: boolean };
/** 드라이브 — 용량은 바이트, 모르면 0 (네트워크 · CD). */
export type Drive = { path: string; label: string; kind: "fixed" | "removable" | "network" | "cd"; total: number; free: number };
export type Places = { known: Place[]; drives: Drive[] };

export type DocName = {
  key: string;
  title: string;
  version: number[];
  date: string;
  time: string;
  ext: string;
  issues: string[];
};
export type DocFile = { path: string; name: string; size: number; modified: number; inHistory: boolean; parsed: DocName };
/** 파일 · 폴더에 붙인 메모 (fd-core memo). */
export type Memo = { path: string; text: string; id?: string; updated: number; color?: TagColor };

/** 색 표시 (fd-core memo::COLORS) — Finder 꼬리표와 같은 일곱 색. */
export const TAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "gray"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_LABEL: Record<TagColor, string> = { red: "빨강", orange: "주황", yellow: "노랑", green: "초록", blue: "파랑", purple: "보라", gray: "회색" };

/** 하위 폴더까지 찾기 결과 (fd-core search). */
/** 찾은 항목. `snippet` 은 문서 안 글에서 맞은 곳 앞뒤. */
export type Found = Entry & { memo?: string; snippet?: string };
export type SearchResult = { root: string; query: string; items: Found[]; scanned: number; truncated: boolean; cancelled: boolean };

export type SkillStatus = { file: string | null; installed: string | null; current: string; hasCli: boolean };
export type DocGroup = { key: string; title: string; files: DocFile[]; issues: string[] };
export type EditionPlan = { newName: string; newPath: string; retire: string[]; history: string };

/** 설정 파일 꼴. 빠진 칸은 기본값으로 채운다 (App.tsx `withDefaults`). */
export type Settings = {
  pinned: Place[];
  session: { tabs: string[]; active: number };
  cols: number[];
  showHidden: boolean;
  /** 화면 색. `system` 이면 Windows 설정(밝게 · 어둡게)을 따른다. */
  theme: Theme;
  /** 나눠 보기 — 오른쪽 칸에 보이는 탭의 번호(session.tabs 안) · 왼쪽 칸 너비 비율 · 오른쪽 칸 탭이 시작하는 번호. 안 나눴으면 null.
   *  session.tabs 는 왼쪽 칸 탭 다음에 오른쪽 칸 탭이 이어진다. 2026.11.11 : 칸마다 탭 묶음을 두면서 `from` 을 더했다 —
   *  없으면(지난 판 설정) 오른쪽 칸은 `right` 탭 하나다. */
  split: { right: number; ratio: number; from?: number } | null;
  /** 보기 — 목록 · 격자, 격자 크기, 아이콘 모양, 숨긴 열. */
  view: ViewPrefs;
};

/** 보기 설정. 모든 탭이 같은 것을 쓴다 — 탭마다 다르면 「왜 여기만 격자지」가 된다. */
export type ViewPrefs = {
  mode: "list" | "grid";
  /** 촘촘한 목록 — 줄 높이를 줄여 한 화면에 더 많이. 크기 사다리의 첫 칸. */
  dense: boolean;
  /** 격자 칸 크기 0(작게) ~ 3(아주 크게). Ctrl+휠로도 바꾼다. */
  size: number;
  /** 아이콘 — Windows 셸 아이콘 · filedesk 가 그린 종류별 아이콘 · 아이콘 팩(폴더의 그림). */
  icons: "shell" | "filedesk" | "pack";
  /** 아이콘 팩 폴더. 그림 이름이 확장자(`pdf.svg`) · 종류(`doc.png`) · `folder` · `file` 이면 그것을 쓰고, 없는 것은 filedesk 그림. */
  iconPack: string;
  /** 격자에서 그림 · pdf · 영상은 내용을 미리 보인다. */
  thumbs: boolean;
  /** 목록에서 숨긴 열 (판 · 고친 날 · 크기). 이름 열은 숨기지 않는다. */
  hiddenCols: ColKey[];
  /** 파일 종류 묶음 — 이름 · 확장자 · 색. 「폴더」 · 「기타」는 고정이라 없다 (util.ts DEFAULT_KINDS). */
  kinds: KindDef[];
};
export type ColKey = "ver" | "date" | "size";
export const DEFAULT_VIEW: ViewPrefs = { mode: "list", dense: false, size: 1, icons: "shell", iconPack: "", thumbs: true, hiddenCols: [], kinds: DEFAULT_KINDS };

/** 오른쪽 메뉴에 얹는 filedesk 항목 (fd-shell menu::AppItem). key 와 label 이 비면 구분선. */
export type MenuItem = { key?: string; label?: string; checked?: boolean; disabled?: boolean; children?: MenuItem[] };

export type Theme = "system" | "light" | "dark";


/** 셸 작업 결과. `aborted` 는 사용자가 진행 창에서 취소했거나 일부를 건너뛴 것. */
export type Outcome = "done" | "aborted" | "skipped";

export const api = {
  listDir: (path: string, showHidden: boolean) => invoke<Entry[]>("list_dir", { path, showHidden }),
  places: () => invoke<Places>("places"),
  resolveInput: (input: string, cwd: string) => invoke<string>("resolve_input", { input, cwd }),
  /** 폴더면 열지 않고 이동할 경로를 돌려준다. */
  openItem: (path: string) => invoke<string | null>("open_item", { path }),
  /** `none` · `rename` · `invoked:<동사>` */
  /** 돌려주는 값: `none` · `rename` · `invoked:<동사>` · `app:<열쇠>` (items 로 얹은 filedesk 항목). */
  contextMenu: (paths: string[], dir: string, items: MenuItem[] = []) => invoke<string>("context_menu", { paths, dir, items }),
  backgroundMenu: (dir: string, items: MenuItem[] = []) => invoke<string>("background_menu", { dir, items }),
  shellVerb: (paths: string[], verb: "copy" | "cut" | "paste" | "properties", dir: string) =>
    invoke<void>("shell_verb", { paths, verb, dir }),
  rename: (path: string, newName: string) => invoke<Outcome>("rename", { path, newName }),
  recycle: (paths: string[]) => invoke<Outcome>("recycle", { paths }),
  newFolder: (dir: string) => invoke<string>("new_folder", { dir }),
  dropFiles: (paths: string[], dest: string) => invoke<Outcome>("drop_files", { paths, dest }),
  dragOut: (paths: string[]) => invoke<number>("drag_out", { paths }),
  watchDirs: (dirs: string[]) => invoke<void>("watch_dirs", { dirs }),
  docGroups: (path: string) => invoke<DocGroup[]>("doc_groups", { path }),
  /** 문서 `key` 의 지난 판 중 최신판 자리에 남은 것 (옮길 목록). */
  planRetire: (dir: string, key: string) => invoke<string[]>("plan_retire", { dir, key }),
  /** 그 지난 판들을 이전판으로. 돌려주는 값은 옮긴 수. */
  retireEditions: (dir: string, key: string) => invoke<number>("retire_editions", { dir, key }),
  /** 폴더 바로 아래(와 이전판) 항목의 메모. 앱 밖에서 옮겨 온 파일의 메모도 여기서 다시 붙는다. */
  memosIn: (dir: string) => invoke<Memo[]>("memos_in", { dir }),
  /** 메모를 붙인다. 빈 글이면 뗀다. */
  setMemo: (path: string, text: string) => invoke<Memo | null>("set_memo", { path, text }),
  planEdition: (path: string, today: string) => invoke<EditionPlan>("plan_edition", { path, today }),
  newEdition: (path: string, today: string) => invoke<string>("new_edition", { path, today }),
  loadSettings: () => invoke<Partial<Settings> | null>("load_settings"),
  saveSettings: (value: Settings) => invoke<void>("save_settings", { value }),
  recentCounts: (paths: string[], days: number) => invoke<number[]>("recent_counts", { paths, days }),
  /** 색 표시. null 이면 뗀다. */
  setColor: (path: string, color: TagColor | null) => invoke<Memo | null>("set_color", { path, color }),
  /** 여러 경로의 메모 · 색 (왼쪽 목록 색 점). */
  memosOf: (paths: string[]) => invoke<Memo[]>("memos_of", { paths }),
  /** 아래 폴더까지 찾기. `content` 면 문서 안 글까지 (hwpx · docx · pptx · xlsx · pdf · txt · md). */
  searchDir: (root: string, query: string, showHidden: boolean, content = false) => invoke<SearchResult>("search_dir", { root, query, showHidden, content }),
  /** 아이콘 팩 폴더의 그림 — 이름(확장자 · 종류 · folder · file) → 경로. */
  iconPack: (dir: string) => invoke<Record<string, string>>("icon_pack", { dir }),
  /** 색 표시를 단 항목 모두 (색을 주면 그 색만). */
  tagged: (color: TagColor | null) => invoke<Entry[]>("tagged", { color }),
  /** 경로마다 폴더인가. */
  dirsOf: (paths: string[]) => invoke<boolean[]>("dirs_of", { paths }),
  skillStatus: () => invoke<SkillStatus>("skill_status"),
  installSkill: () => invoke<SkillStatus>("install_skill"),
};

/** 오늘 `YYYYMMDD` (이 PC 시각). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const PER_FILE_EXTS = new Set(["exe", "lnk", "ico", "url", "msc", "cpl", "scr"]);

/** 경로 그대로의 셸 아이콘 — 드라이브 · 바탕화면처럼 자리마다 그림이 다른 것. */
export const pathIconUrl = (path: string) => `http://fdicon.localhost/${encodeURIComponent(`f:${path}`)}`;

/** 셸 아이콘 주소. 키 꼴은 fd-shell icon_png 와 같다. */
export function iconUrl(e: Pick<Entry, "isDir" | "ext" | "path">): string {
  const key = e.isDir ? "d" : PER_FILE_EXTS.has(e.ext) ? `f:${e.path}` : `e:${e.ext}`;
  return `http://fdicon.localhost/${encodeURIComponent(key)}`;
}
