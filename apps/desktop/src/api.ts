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
export type Memo = { path: string; text: string; id?: string; updated: number; color?: TagColor };

/** 색 표시 (fd-core memo::COLORS) — Finder 꼬리표와 같은 일곱 색. */
export const TAG_COLORS = ["red", "orange", "yellow", "green", "blue", "purple", "gray"] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_LABEL: Record<TagColor, string> = { red: "빨강", orange: "주황", yellow: "노랑", green: "초록", blue: "파랑", purple: "보라", gray: "회색" };

/** 하위 폴더까지 찾기 결과 (fd-core search). */
export type Found = Entry & { memo?: string };
export type SearchResult = { root: string; query: string; items: Found[]; scanned: number; truncated: boolean; cancelled: boolean };

/** 이름 규칙 (fd-core NameRules). */
export type NameRules = { projectNames: string[]; people: string[]; statusWords: string[] };
export type SkillStatus = { file: string | null; installed: string | null; current: string; hasCli: boolean };
export type DocGroup = { key: string; title: string; files: DocFile[]; issues: string[] };
export type EditionPlan = { newName: string; newPath: string; retire: string[]; history: string };

/** 설정 파일 꼴. 빠진 칸은 기본값으로 채운다 (App.tsx `withDefaults`). */
export type Settings = {
  pinned: Place[];
  session: { tabs: string[]; active: number };
  cols: number[];
  showHidden: boolean;
  /** 프로젝트 단위 문서 저장소. 안에 `사업\<연도>\<프로젝트명>` · `공통` (폴더 이름 `사업` 은 그대로). 빈 글자면 아직 정하지 않았다.
   *  2026.11.11 : 기본값 `D:\문서` 를 뺐다 — 이 PC 에만 맞는 경로라 다른 PC 에서는 「프로젝트」가 까닭 없이 비었다. */
  storeRoot: string;
  /** 화면 색. `system` 이면 Windows 설정(밝게 · 어둡게)을 따른다. */
  theme: Theme;
  /** 나눠 보기 — 오른쪽 칸에 둔 탭의 번호(session.tabs 안)와 왼쪽 칸 너비 비율. 안 나눴으면 null. */
  split: { right: number; ratio: number } | null;
  /** 보기 — 목록 · 격자, 격자 크기, 아이콘 모양, 숨긴 열. */
  view: ViewPrefs;
};

/** 보기 설정. 모든 탭이 같은 것을 쓴다 — 탭마다 다르면 「왜 여기만 격자지」가 된다. */
export type ViewPrefs = {
  mode: "list" | "grid";
  /** 격자 칸 크기 0(작게) ~ 3(아주 크게). Ctrl+휠로도 바꾼다. */
  size: number;
  /** 아이콘 — Windows 셸 아이콘, 또는 filedesk 가 그린 종류별 아이콘. */
  icons: "shell" | "filedesk";
  /** 격자에서 그림 · pdf · 영상은 내용을 미리 보인다. */
  thumbs: boolean;
  /** 목록에서 숨긴 열 (판 · 고친 날 · 크기). 이름 열은 숨기지 않는다. */
  hiddenCols: ColKey[];
  /** 파일 종류 묶음 — 이름 · 확장자 · 색. 「폴더」 · 「기타」는 고정이라 없다 (util.ts DEFAULT_KINDS). */
  kinds: KindDef[];
};
export type ColKey = "ver" | "date" | "size";
export const DEFAULT_VIEW: ViewPrefs = { mode: "list", size: 1, icons: "shell", thumbs: true, hiddenCols: [], kinds: DEFAULT_KINDS };

/** 오른쪽 메뉴에 얹는 filedesk 항목 (fd-shell menu::AppItem). key 와 label 이 비면 구분선. */
export type MenuItem = { key?: string; label?: string; checked?: boolean; disabled?: boolean; children?: MenuItem[] };

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
  pinnedInfo: (paths: string[]) => invoke<PinnedInfo[]>("pinned_info", { paths }),
  roleOf: (path: string) => invoke<Role | null>("role_of", { path }),
  recentCounts: (paths: string[], days: number) => invoke<number[]>("recent_counts", { paths, days }),
  storeProjects: (root: string) => invoke<StoreYear[]>("store_projects", { root }),
  createProject: (root: string, year: string, name: string) => invoke<string>("create_project", { root, year, name }),
  /** 색 표시. null 이면 뗀다. */
  setColor: (path: string, color: TagColor | null) => invoke<Memo | null>("set_color", { path, color }),
  /** 여러 경로의 메모 · 색 (왼쪽 목록 색 점). */
  memosOf: (paths: string[]) => invoke<Memo[]>("memos_of", { paths }),
  searchDir: (root: string, query: string, showHidden: boolean) => invoke<SearchResult>("search_dir", { root, query, showHidden }),
  /** 경로마다 폴더인가. */
  dirsOf: (paths: string[]) => invoke<boolean[]>("dirs_of", { paths }),
  nameRules: () => invoke<NameRules>("name_rules"),
  saveNameRules: (rules: NameRules) => invoke<void>("save_name_rules", { rules }),
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
