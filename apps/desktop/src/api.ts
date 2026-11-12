// Rust 명령 창구. 인자 이름은 Tauri 규약대로 camelCase (Rust 쪽은 snake_case).
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_KINDS, type KindDef, type Sort } from "./util";

export type Entry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  /** 만든 때 (유닉스 밀리초). 2026.11.12 더했다 — 찾기 조건 「고친:3일」이 받은 파일도 잡게. 없으면 0. */
  created?: number;
  attrs: number;
  ext: string;
  kind: string;
};

/** 찾는 뿌리 — `recursive` 가 거짓이면 그 폴더 바로 아래만 (fd-core search::Root). */
export type Root = { path: string; recursive: boolean };
/** 조건 칩 — `raw` 는 찾기 칸에 적힌 그대로, `label` 은 읽는 말. */
export type Chip = { raw: string; label: string };
/** 풀어 낸 찾기 조건 (fd-core query::QuerySpec). */
export type QuerySpec = {
  terms: string[];
  notTerms: string[];
  after?: number | null;
  before?: number | null;
  minSize?: number | null;
  maxSize?: number | null;
  exts: string[];
  kinds: string[];
  kindExts: string[];
  dirs?: boolean | null;
  colors: string[];
  anyColor: boolean;
  memo?: boolean | null;
  chips: Chip[];
  errors: string[];
};
/** 스마트 폴더가 볼 곳 — 모든 고정 드라이브 · 고른 폴더들 · 다운로드와 바탕화면(바로 아래만). */
export type SmartScope = { kind: "all" } | { kind: "roots"; roots: Root[] } | { kind: "inbox" };
/** 조건에 이름을 붙여 저장한 것 — 누르면 지금 칸에 그 조건으로 모아 보인다. 2026.11.12 더했다. */
export type SmartFolder = { id: string; name: string; q: string; scope: SmartScope };
export type ContentStatus = { indexed: number; queued: number; pdfLeft: number; failed: number; paused: boolean };
export type VolStatus = { root: string; method: string; files: number; updated: number; state: string; usn: boolean; note: string };
export type IndexStatus = { service: boolean; serviceVersion: number; volumes: VolStatus[]; exclude: string[] };
export type HubStatus = { index: IndexStatus; content: ContentStatus | null; bundled: boolean; appVersion: number; exclude: string[] };
export type QueryResult = {
  items: Found[];
  spec: QuerySpec;
  truncated: boolean;
  cancelled: boolean;
  scanned: number;
  /** 어느 길로 찾았나 — service · local(앱 안 색인) · live(그 자리 훑기) · content(본문 색인) · notes(메모 · 색 표시) */
  sources: string[];
  indexedAt: number;
  partial: boolean;
  contentStatus: ContentStatus | null;
};
export type QueryArgs = {
  scope: { all: boolean; roots: Root[] };
  text: string;
  kinds?: [string, string, string[]][];
  showHidden?: boolean;
  content?: boolean;
  tzOffsetMin?: number;
  limit?: number;
  /** 왼쪽 개수처럼 뒤에서 세는 찾기 — 칸의 찾기를 멈추지 않는다. */
  background?: boolean;
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
/** 판 판단은 fd-core `docs::mark` 한 곳에서 한다 — `retire` 옮길 판(이전판 밖인데 그 폴더 최신판이 아님) ·
 *  `dupVer` 같은 판 번호가 여러 날짜 · `backOrder` 앞선 날짜보다 판 번호가 작음. 판 눈금과 문제 문장이 이 표시를 같이 쓴다. */
export type DocFile = {
  path: string;
  name: string;
  size: number;
  modified: number;
  inHistory: boolean;
  parsed: DocName;
  retire: boolean;
  dupVer: boolean;
  backOrder: boolean;
};
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

/** 저장하는 칸 배치 한 마디 — 칸이면 탭 수 · 보이는 탭(칸 안 순번), 나눔이면 방향 · 앞쪽 몫 · 두 쪽 (`Settings.layout`). */
export type SavedNode = { tabs: number; cur: number } | { dir: "row" | "col"; ratio: number; a: SavedNode; b: SavedNode };

/** 설정 파일 꼴. 빠진 칸은 기본값으로 채운다 (App.tsx `withDefaults`). */
export type Settings = {
  pinned: Place[];
  /** 왼쪽 열 「연결」 — NAS · 공유 폴더(\\서버\공유) 같은 자리. 즐겨찾기와 같은 꼴이고 자리만 다르다. 2026.11.11 더했다. */
  links: Place[];
  session: { tabs: string[]; active: number };
  cols: number[];
  showHidden: boolean;
  /** 화면 색. `system` 이면 Windows 설정(밝게 · 어둡게)을 따른다. */
  theme: Theme;
  /** 나눠 보기 — 오른쪽 칸에 보이는 탭의 번호(session.tabs 안) · 왼쪽 칸 너비 비율 · 오른쪽 칸 탭이 시작하는 번호. 안 나눴으면 null.
   *  session.tabs 는 왼쪽 칸 탭 다음에 오른쪽 칸 탭이 이어진다. 2026.11.11 : 칸마다 탭 묶음을 두면서 `from` 을 더했다 —
   *  없으면(지난 판 설정) 오른쪽 칸은 `right` 탭 하나다. */
  split: { right: number; ratio: number; from?: number } | null;
  /** 칸 배치 — 칸이면 탭 수 · 보이는 탭(칸 안 순번), 나눔이면 방향(row 좌우 · col 위아래) · 앞쪽 몫 · 두 쪽.
   *  칸은 왼쪽 · 위부터 session.tabs 를 탭 수만큼 앞에서 가져간다. 한 칸이면 null.
   *  2026.11.11 : 끌어서 상하좌우로 네 칸까지 나누면서 더했다. 이것을 쓰면 `split` 은 null 로 적는다 (지난 판 설정을 읽을 때만 본다). */
  layout?: SavedNode | null;
  /** 보기 — 목록 · 격자, 격자 크기, 아이콘 모양, 숨긴 열. */
  view: ViewPrefs;
  /** 켤 때 열 폴더. 비면 지난번에 열어 둔 탭(나눠 보기까지) 그대로. 2026.11.11 더했다. */
  start: string;
  /** 스마트 폴더 — 왼쪽 열 「스마트 폴더」. 없으면(지난 판 설정) 「최근 파일」 하나로 시작한다. 2026.11.12 더했다. */
  smart?: SmartFolder[];
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
  /** 폴더로 들어가는 누르기 — 두 번(탐색기와 같게) · 한 번. 파일은 어느 쪽이든 두 번 눌러 연다. 2026.11.11 더했다. */
  folderClick: "double" | "single";
  /** 새 탭 · 다시 켤 때의 정렬. 열 머리를 눌러 바꾼 정렬은 그 탭에서만 간다. */
  sort: Sort;
  /** 폴더를 파일 위에 모은다 (탐색기와 같게). 끄면 고친 날 정렬에서 폴더와 파일이 섞인다. */
  dirsFirst: boolean;
  /** 판을 접은 채 시작한다. Ctrl+Shift+D 로 바꾼 것은 그 탭에서만 간다. */
  foldStart: boolean;
  /** 왼쪽 열에 「스마트 폴더」를 보인다. 2026.11.11 「최근 파일」로 더했고, 2026.11.12 「최근 파일」이 스마트 폴더 하나가 되며 구획 전체를 켜고 끈다
   *  (이름은 지난 판 설정과 맞추려고 그대로 둔다). */
  recent: boolean;
  /** 왼쪽 열에 「연결」(NAS · 공유 폴더)을 보인다. 2026.11.12 더했다 — NAS 를 쓰지 않는 사람에게는 늘 빈 구획이었다.
   *  처음에는 끄고, 이미 연결을 둔 사람은 켠 채로 읽는다 (App readSettings). */
  links: boolean;
  /** 고친 날 — `relative` 오늘 · 어제 · 날짜만 / `absolute` 늘 날짜와 시각. */
  dateStyle: "relative" | "absolute";
  /** 크기 — `kb` 탐색기처럼 늘 KB / `auto` 알맞은 단위 (MB · GB). */
  sizeUnit: "kb" | "auto";
};
export type ColKey = "ver" | "date" | "size";
export const DEFAULT_VIEW: ViewPrefs = { mode: "list", dense: false, size: 1, icons: "shell", iconPack: "", thumbs: true, hiddenCols: [], kinds: DEFAULT_KINDS, folderClick: "double",
  sort: { key: "name", asc: true }, dirsFirst: true, foldStart: true, dateStyle: "relative", sizeUnit: "kb", recent: true, links: false };

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
  recentFiles: (paths: string[], days: number) => invoke<Entry[]>("recent_files", { paths, days }),
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
  /** 찾기 칸 글을 조건으로 푼다 (칩 · 틀린 곳). */
  parseQuery: (text: string, kinds: [string, string, string[]][], tzOffsetMin: number) => invoke<QuerySpec>("parse_query", { text, kinds, tzOffsetMin }),
  /** 조건으로 찾는다 — 색인(서비스 · 앱 안) · 그 자리 훑기 · 본문 색인 중 맞는 길로. */
  queryFiles: (args: QueryArgs) => invoke<QueryResult>("query_files", { args }),
  indexStatus: () => invoke<HubStatus>("index_status"),
  indexRebuild: () => invoke<HubStatus>("index_rebuild"),
  indexExclude: (paths: string[]) => invoke<HubStatus>("index_exclude", { paths }),
  contentPause: (paused: boolean) => invoke<void>("content_pause", { paused }),
  /** 색인 서비스 설치 · 업데이트 · 지우기 — UAC 창이 뜬다. */
  serviceSetup: (action: "install" | "update" | "uninstall") => invoke<HubStatus>("service_setup", { action }),
};

/** 오늘 `YYYYMMDD` (이 PC 시각). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** 파일마다 그림이 다른 형식 — 셸 아이콘을 확장자가 아니라 경로로 묻는다 (fd-shell icon::PER_FILE_EXTS 와 같아야 한다). */
export const PER_FILE_EXTS = new Set(["exe", "lnk", "ico", "url", "msc", "cpl", "scr"]);

/** 경로 그대로의 셸 아이콘 — 드라이브 · 바탕화면처럼 자리마다 그림이 다른 것. */
export const pathIconUrl = (path: string) => `http://fdicon.localhost/${encodeURIComponent(`f:${path}`)}`;

/** 셸 아이콘 주소. 키 꼴은 fd-shell icon_png 와 같다. */
export function iconUrl(e: Pick<Entry, "isDir" | "ext" | "path">): string {
  const key = e.isDir ? "d" : PER_FILE_EXTS.has(e.ext) ? `f:${e.path}` : `e:${e.ext}`;
  return `http://fdicon.localhost/${encodeURIComponent(key)}`;
}
