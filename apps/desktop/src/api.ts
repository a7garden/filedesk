// Rust 명령 창구. 인자 이름은 Tauri 규약대로 camelCase (Rust 쪽은 snake_case).
import { invoke } from "@tauri-apps/api/core";

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

export type Place = { name: string; path: string };
export type Places = { known: Place[]; drives: Place[] };

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
export type Memo = { path: string; text: string; id?: string; updated: number };
export type DocGroup = { key: string; title: string; files: DocFile[]; issues: string[] };
export type EditionPlan = { newName: string; newPath: string; retire: string[]; history: string };

/** 설정 파일 꼴. 빠진 칸은 기본값으로 채운다 (App.tsx `withDefaults`). */
export type Settings = {
  pinned: Place[];
  session: { tabs: string[]; active: number };
  cols: number[];
  showHidden: boolean;
  /** 프로젝트 단위 문서 저장소 (2026-11-11 부터 D:\문서). 안에 `사업\<연도>\<프로젝트명>` · `공통` (폴더 이름 `사업` 은 그대로). */
  storeRoot: string;
  /** 화면 색. `system` 이면 Windows 설정(밝게 · 어둡게)을 따른다. */
  theme: Theme;
};

export type Theme = "system" | "light" | "dark";

/** 자리 역할 (fd-core project::Role). */
export type Role = "canon" | "received" | "archive" | "work" | "history" | "notes" | "code";
export type Area = { name: string; path: string; role: Role };
export type PinnedInfo = { path: string; isProject: boolean; areas: Area[] };
export type StoreProject = { name: string; path: string; areas: Area[] };
export type StoreYear = { year: string; projects: StoreProject[] };

/** 셸 작업 결과. `aborted` 는 사용자가 진행 창에서 취소했거나 일부를 건너뛴 것. */
export type Outcome = "done" | "aborted" | "skipped";

export const api = {
  listDir: (path: string, showHidden: boolean) => invoke<Entry[]>("list_dir", { path, showHidden }),
  places: () => invoke<Places>("places"),
  resolveInput: (input: string, cwd: string) => invoke<string>("resolve_input", { input, cwd }),
  /** 폴더면 열지 않고 이동할 경로를 돌려준다. */
  openItem: (path: string) => invoke<string | null>("open_item", { path }),
  /** `none` · `rename` · `invoked:<동사>` */
  contextMenu: (paths: string[], dir: string) => invoke<string>("context_menu", { paths, dir }),
  backgroundMenu: (dir: string) => invoke<string>("background_menu", { dir }),
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
  pinnedInfo: (paths: string[]) => invoke<PinnedInfo[]>("pinned_info", { paths }),
  roleOf: (path: string) => invoke<Role | null>("role_of", { path }),
  recentCounts: (paths: string[], days: number) => invoke<number[]>("recent_counts", { paths, days }),
  storeProjects: (root: string) => invoke<StoreYear[]>("store_projects", { root }),
  createProject: (root: string, year: string, name: string) => invoke<string>("create_project", { root, year, name }),
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
