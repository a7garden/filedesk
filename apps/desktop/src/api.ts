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
export type HubStatus = { index: IndexStatus; content: ContentStatus | null; bundled: boolean; appVersion: number; serviceBuild: string | null; appBuild: string; contentError: string | null; exclude: string[] };
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
export type Place = {
  name: string;
  path: string;
  file?: boolean;
  /** 「연결」에서 사용자가 붙인 보일 이름 — 없으면 경로에서 딴다. 2026.11.24 더했다 (사용자 요청 「NAS 이름 변경」). */
  label?: string;
  /** 「연결」 서버 줄에 보일 이름 — 같은 서버의 연결에 똑같이 적는다. IP(192.168.0.2)만으로는 어느 NAS 인지 몰랐다. 2026.11.24 */
  host?: string;
};
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
/** 폴더 용량 — partial 은 읽지 못한 하위 폴더가 있었다 (합이 작을 수 있다) · stopped 는 중간에 멈췄다. */
export type DirSize = { bytes: number; files: number; dirs: number; partial: boolean; stopped: boolean };
export type SearchResult = { root: string; query: string; items: Found[]; scanned: number; truncated: boolean; cancelled: boolean };

export type SkillAgent = { id: string; name: string; file: string; detected: boolean; installed: string | null };
export type SkillStatus = { agents: SkillAgent[]; current: string; hasCli: boolean };
export type DocGroup = { key: string; title: string; files: DocFile[]; issues: string[] };
export type EditionPlan = { newName: string; newPath: string; retire: string[]; history: string };

/** 설치된 앱. icon 은 셸이 그림을 뽑을 이름 (`appIconUrl`). */
export type AppInfo = { name: string; id: string; icon: string };
/** 왼쪽 열 「앱」에 고정한 앱. 2026.11.18 더했다. */
export type AppPin = { name: string; id: string; icon: string };
/** 앱 그림 — 격자 아이콘과 같은 `i:<크기>:` 길에 셸 이름을 넘긴다. */
export const appIconUrl = (icon: string, px: number) =>
  `http://fdicon.localhost/${encodeURIComponent(`i:${Math.round(px * (window.devicePixelRatio || 1))}:${icon}`)}`;

/** 저장하는 칸 배치 한 마디 — 칸이면 탭 수 · 보이는 탭(칸 안 순번) · 그 칸만의 보기 크기, 나눔이면 방향 · 앞쪽 몫 · 두 쪽 (`Settings.layout`). */
export type SavedNode = { tabs: number; cur: number; step?: number } | { dir: "row" | "col"; ratio: number; a: SavedNode; b: SavedNode };

/** 설정 파일 꼴. 빠진 칸은 기본값으로 채운다 (App.tsx `withDefaults`). */
export type Settings = {
  pinned: Place[];
  /** 왼쪽 열 「연결」 — NAS · 공유 폴더(\\서버\공유) 같은 자리. 즐겨찾기와 같은 꼴이고 자리만 다르다. 2026.11.11 더했다. */
  links: Place[];
  session: { tabs: string[]; active: number };
  cols: number[];
  /** 좁은 칸(680px 아래)의 열 너비 — 차례는 cols 와 같다. 없으면(지난 판 설정) 기본값. 2026.11.26 더했다. */
  colsNarrow: number[];
  showHidden: boolean;
  /** 화면 색. `system` 이면 Windows 설정(밝게 · 어둡게)을 따른다. */
  theme: Theme;
  /** 색 구성 — 강조색 · 바탕의 빛깔. 없으면(지난 판 설정) 쪽빛. */
  palette: Palette;
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
  /** 왼쪽 열 「앱」 — 팔레트에서 Shift+Enter · 「＋」로 고정한 앱. 2026.11.18 더했다. */
  apps?: AppPin[];
  /** 왼쪽 열 너비(px). 오른쪽 가장자리를 끌어 바꾼다 · 두 번 누르면 기본. 2026.11.18 더했다. */
  sideW?: number;
};

/** 보기 설정. 모든 탭이 같은 것을 쓴다 — 탭마다 다르면 「왜 여기만 격자지」가 된다.
 *  2026.11.18 : 다만 크기(mode · dense · size)는 나눈 칸마다 따로 둘 수 있다 (App `Leaf.step`) — 칸은 눈에 보이게 갈려 있어 헷갈리지 않는다. */
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
  /** 격자에서 이름이 잘린 칸에 마우스를 올리면 그 자리에서 이름 전체를 바로 펼친다.
   *  2026.11.17 : 사용자 요청. 끄면 브라우저 말풍선(title)으로 보여 1초쯤 기다려야 한다. */
  namePeek: boolean;
  /** 아이콘에 상태 표시(TortoiseSVN 고침 · 충돌, OneDrive 동기화)를 겹친다. 2026.11.17 더했다 — 표시 처리기가 느린 PC 면 끈다. */
  overlays: boolean;
  /** 목록에서 숨긴 열 (판 · 고친 날 · 크기). 이름 열은 숨기지 않는다. */
  hiddenCols: ColKey[];
  /** 파일 종류 묶음 — 이름 · 확장자 · 색. 「폴더」 · 「기타」는 고정이라 없다 (util.ts DEFAULT_KINDS). */
  kinds: KindDef[];
  /** 폴더로 들어가는 누르기 — 두 번(탐색기와 같게) · 한 번. 파일은 어느 쪽이든 두 번 눌러 연다. 2026.11.11 더했다. */
  folderClick: "double" | "single";
  /** 목록 정렬 — 앱 전체에 하나다. 열 머리 · 「정렬 기준」 메뉴로 고른 것도 여기에 남아 모든 탭 · 다시 켠 앱이 따라간다 (2026.11.25). */
  sort: Sort;
  /** 폴더를 파일 위에 모은다 (탐색기와 같게). 끄면 고친 날 정렬에서 폴더와 파일이 섞인다. */
  dirsFirst: boolean;
  /** 판 관리 — 문서의 판을 한 줄로 묶기 · 판 열 · 판 목록 · 새 판 · 문제 문서 처리함. 끄면 탐색기처럼 파일마다 한 줄이다.
   *  2026.11.16 : 사용자 요청. 판 관리 없이도 쓸 만한 탐색기라 기본은 끈다 — 이름 규칙을 모르는 사람에게 묶인 줄 · 문제 줄이 낯설다.
   *  지난 설정에 이 값이 없으면 끈 채로 읽는다 (App readSettings). */
  editions: boolean;
  /** 판을 접은 채 시작한다. Ctrl+Shift+D 로 바꾼 것은 그 탭에서만 간다. */
  foldStart: boolean;
  /** 왼쪽 열에 「스마트 폴더」를 보인다. 2026.11.11 「최근 파일」로 더했고, 2026.11.12 「최근 파일」이 스마트 폴더 하나가 되며 구획 전체를 켜고 끈다
   *  (이름은 지난 판 설정과 맞추려고 그대로 둔다). */
  recent: boolean;
  /** 왼쪽 열에 「연결」(NAS · 공유 폴더)을 보인다. 2026.11.12 더했다 — NAS 를 쓰지 않는 사람에게는 늘 빈 구획이었다.
   *  처음에는 끄고, 이미 연결을 둔 사람은 켠 채로 읽는다 (App readSettings). */
  links: boolean;
  /** 왼쪽 열에 「즐겨찾기」(자주 가는 폴더 · 파일)를 보인다. 아래 즐겨찾기 독과 같은 목록이다.
   *  2026.11.24 사용자 요청 — 독은 마우스를 대야 올라와 자주 가는 곳을 늘 보이게 두지 못했다. 처음에는 켠다. */
  sideFavs: boolean;
  /** 왼쪽 열 구획 차례. 2026.11.24 사용자 요청 — 둘 구획 · 차례를 사람이 고른다 (설정 › 보기 › 사이드바). */
  sideOrder: SideId[];
  /** 왼쪽 열에서 끈 구획 — 이 PC · 앱 · 색 표시. 즐겨찾기 · 연결 · 스마트 폴더는 제 설정(sideFavs · links · recent)으로 켜고 끈다
   *  (지난 판 설정과 맞추려고 그 셋은 그대로 둔다). */
  sideOff: SideId[];
  /** 「이 PC」 타일 — 이름 · 아이콘 · 경로를 사람이 고른다. null 이면 처음대로(이 PC 의 바탕화면 · 다운로드 · 문서).
   *  2026.11.26 : 사용자 요청. 늘 같은 셋이던 타일을 바꾸고 더할 수 있게 했다 — 사이드바 편집에서 고친다. */
  tiles: Tile[] | null;
  /** 크기 — `kb` 탐색기처럼 늘 KB / `auto` 알맞은 단위 (MB · GB). */
  sizeUnit: "kb" | "auto";
  /** 폴더 크기 칸에 그 안 모든 하위 폴더 파일까지 더한 용량을 보인다. 폴더마다 훑어 세므로 큰 폴더 · NAS 는 늦게 찬다.
   *  2026.11.25 : 사용자 요청. 기본은 끈다 — 켜면 폴더를 열 때마다 디스크를 훑는다. */
  folderSize: boolean;
  /** 찾기 결과에서 늘 빼는 확장자 (점 없이 소문자 · 예: lnk). 이 폴더 안 거르기 · 색 표시 · 새 파일 모아 보기에는 먹지 않는다.
   *  2026.11.20 : 사용자 요청. 모든 드라이브에서 찾으면 시작 메뉴 · 바탕화면의 바로가기가 원본과 나란히 섞였다.
   *  기본은 바로가기(lnk · url) · 임시 파일(tmp) · 받다 만 파일(crdownload). 다 지운 설정은 빈 채로 읽는다 (App readSettings). */
  findSkip: string[];
  /** 앱 안 보기 왼쪽에 그 폴더의 파일 목록을 둔다 — 보면서 다른 파일로 바로 옮긴다. 2026.11.25 사용자 요청 · 처음에는 켠다. */
  viewStrip: boolean;
};
export type ColKey = "ver" | "date" | "size" | "kind";
/** 왼쪽 열 위젯 — 이 PC(타일) · 드라이브 · 즐겨찾기 · 앱 · 연결 · 색 표시 · 스마트 폴더.
 *  2026.11.26 : 「이 PC」 하나에 들어 있던 타일과 드라이브 목록을 두 위젯으로 나눴다 — 사용자 요청. 따로 넣고 뺀다. */
export type SideId = "pc" | "drives" | "favs" | "apps" | "links" | "tags" | "smart";
export const SIDE_IDS: SideId[] = ["pc", "drives", "favs", "apps", "links", "tags", "smart"];
export const SIDE_LABEL: Record<SideId, string> = { pc: "이 PC (바로 가기)", drives: "드라이브", favs: "즐겨찾기", apps: "앱", links: "연결 (NAS · 공유 폴더)", tags: "색 표시", smart: "스마트 폴더" };
/** 사이드바 머리에 실제로 서는 이름 (괄호 풀이 없이). */
export const SIDE_NAME: Record<SideId, string> = { pc: "이 PC", drives: "드라이브", favs: "즐겨찾기", apps: "앱", links: "연결", tags: "색 표시", smart: "스마트 폴더" };
/** 위젯 이름 밑 한 줄 풀이 — 설정 › 사이드바 · 사이드바 편집의 「위젯 추가」. */
export const SIDE_HINT: Record<SideId, string> = {
  pc: "바탕화면 · 다운로드 · 문서 타일",
  drives: "드라이브와 남은 용량",
  favs: "자주 가는 폴더 · 파일",
  apps: "자주 여는 프로그램",
  links: "NAS · 공유 폴더",
  tags: "일곱 색 표시와 개수",
  smart: "조건으로 모아 보기",
};
/** sideOff 로 켜고 끄는 위젯. 즐겨찾기 · 연결 · 스마트 폴더는 제 설정(sideFavs · links · recent)으로 켜고 끈다. */
export const SIDE_OFFABLE: SideId[] = ["pc", "drives", "apps", "tags"];

/** 사이드바 위젯이 켜져 있나. */
export function sideOn(v: ViewPrefs, id: SideId): boolean {
  if (id === "favs") return v.sideFavs;
  if (id === "links") return v.links;
  if (id === "smart") return v.recent;
  return !v.sideOff.includes(id);
}
export function setSideOn(v: ViewPrefs, id: SideId, on: boolean): ViewPrefs {
  if (id === "favs") return { ...v, sideFavs: on };
  if (id === "links") return { ...v, links: on };
  if (id === "smart") return { ...v, recent: on };
  return { ...v, sideOff: on ? v.sideOff.filter((x) => x !== id) : [...v.sideOff, id] };
}

/** 타일 그림. glyphs.tsx PlaceGlyph 가 그린다 — 늘리면 거기에도 그린다. */
export type TileIcon = "desktop" | "download" | "docs" | "folder" | "home" | "star" | "heart" | "work" | "book" | "calendar" | "image" | "music" | "video" | "code" | "archive" | "cloud" | "net" | "user";
export const TILE_ICONS: TileIcon[] = ["folder", "desktop", "download", "docs", "home", "star", "heart", "work", "book", "calendar", "image", "music", "video", "code", "archive", "cloud", "net", "user"];
export type Tile = { path: string; name: string; icon: TileIcon };
/** 처음대로의 칸 — 이 PC 의 알려진 폴더를 이름 그대로. */
export function defaultTiles(known: Place[]): Tile[] {
  return known.map((k) => ({ path: k.path, name: k.name, icon: k.name === "바탕화면" ? "desktop" : k.name === "다운로드" ? "download" : k.name === "문서" ? "docs" : "folder" }));
}
export const DEFAULT_VIEW: ViewPrefs = { mode: "list", dense: false, size: 1, icons: "shell", iconPack: "", thumbs: true, namePeek: true, overlays: true, hiddenCols: ["kind"], kinds: DEFAULT_KINDS, folderClick: "double",
  sort: { key: "name", asc: true }, dirsFirst: true, editions: false, foldStart: true, sizeUnit: "kb", folderSize: false, recent: true, links: false, sideFavs: true, sideOrder: ["pc", "drives", "favs", "apps", "links", "tags", "smart"], sideOff: [], tiles: null, findSkip: ["lnk", "url", "tmp", "crdownload"], viewStrip: true };

export type Theme = "system" | "light" | "dark";
/** 색 구성 — 화면 색(밝게 · 어둡게)과 따로 고른다. 구성마다 밝게 · 어둡게 값을 다 가진다 (styles.css `[data-palette]`).
 *  2026.11.26 : 사용자 요청 「여러 테마색 구성을 지원」으로 더했다. 기본은 쪽빛(앱 아이콘 색). */
export type Palette = "blue" | "forest" | "plum" | "rose" | "ink";
export const PALETTES: { id: Palette; label: string }[] = [
  { id: "blue", label: "쪽빛" },
  { id: "forest", label: "숲" },
  { id: "plum", label: "자두" },
  { id: "rose", label: "진달래" },
  { id: "ink", label: "먹" },
];
export const isPalette = (v: unknown): v is Palette => PALETTES.some((p) => p.id === v);


/** 셸 작업 결과. `aborted` 는 사용자가 진행 창에서 취소했거나 일부를 건너뛴 것. */
export type Outcome = "done" | "aborted" | "skipped";

export const api = {
  listDir: (path: string, showHidden: boolean) => invoke<Entry[]>("list_dir", { path, showHidden }),
  /** 폴더 용량 (하위 폴더까지). `token` 은 칸이 폴더를 열 때마다 새로 — `dirSizeStop(token)` 이 그 세기를 멈춘다. */
  dirSize: (path: string, token: number) => invoke<DirSize>("dir_size", { path, token }),
  dirSizeStop: (token: number) => invoke<void>("dir_size_stop", { token }),
  /** 없어진 폴더에서 가장 가까운, 아직 있는 위 폴더 (없으면 null). */
  nearestDir: (path: string) => invoke<string | null>("nearest_dir", { path }),
  places: () => invoke<Places>("places"),
  resolveInput: (input: string, cwd: string) => invoke<string>("resolve_input", { input, cwd }),
  /** 폴더면 열지 않고 이동할 경로를 돌려준다. */
  openItem: (path: string) => invoke<string | null>("open_item", { path }),
  /** 셸 메뉴 (filedesk 메뉴의 「더 보기」). 돌려주는 값: `none` · `rename` · `invoked:<동사>`. */
  contextMenu: (paths: string[], dir: string) => invoke<string>("context_menu", { paths, dir }),
  backgroundMenu: (dir: string) => invoke<string>("background_menu", { dir }),
  shellVerb: (paths: string[], verb: "copy" | "cut" | "properties" | "openas", dir: string) =>
    invoke<void>("shell_verb", { paths, verb, dir }),
  /** 클립보드의 파일을 `dest` 로 복사 · 옮기기 (잘라낸 것이면 옮긴다). 실행 취소에 쌓인다. */
  pasteFiles: (dest: string) => invoke<Outcome>("paste_files", { dest }),
  /** 다음 Ctrl+Z 가 되돌릴 작업 이름 (「이름 바꾸기」). 없으면 null. */
  undoPeek: () => invoke<string | null>("undo_peek"),
  /** 마지막 파일 작업을 되돌린다. 돌려주는 값은 알릴 한 줄 · 되돌릴 것이 없으면 null. */
  undoLast: () => invoke<string | null>("undo_last"),
  /** 상태 표시(SVN · OneDrive) 그림 번호 — `names` 순서대로, 없으면 -1. 그림은 `overlayUrl`. */
  overlays: (dir: string, names: string[]) => invoke<number[]>("overlays", { dir, names }),
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
  /** 공용 설정만 고쳐 쓴다 — 떼어 낸 창. 열어 둔 탭(session · layout)은 주 창 것이라 건드리지 않는다. */
  savePrefs: (value: Partial<Settings>) => invoke<void>("save_prefs", { value }),
  /** 새 창을 `path` 하나로 연다 — 탭을 창 밖으로 끌어 놓았을 때. x · y 는 창 왼쪽 위 (화면 물리 픽셀). */
  openWindow: (path: string, x: number, y: number, width: number, height: number) => invoke<void>("open_window", { path, x, y, width, height }),
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
  /** 「연결」 칸에 적은 주소를 푼다 — 서버면 공유 목록, 공유 · 폴더면 열리는지 확인한 경로. 로그인이 필요하면 Windows 로그인 창이 뜬다. */
  netResolve: (input: string) => invoke<{ path: string; shares: string[] | null }>("net_resolve", { input }),
  /** 설치된 앱 — 시작 메뉴 「모든 앱」 (팔레트 · 왼쪽 열 「앱」). */
  appsList: () => invoke<AppInfo[]>("apps_list"),
  /** 앱을 연다 — AppsFolder 의 앱 이름이나 실행 파일 · 바로가기 경로. */
  launchApp: (id: string) => invoke<void>("launch_app", { id }),
  /** 이 PC 가 이미 쓰는 네트워크 위치 (네트워크 드라이브 · 탐색기 네트워크 위치 · 탐색기 주소 기록). */
  netKnown: () => invoke<{ path: string; source: string }[]>("net_known"),
  skillStatus: () => invoke<SkillStatus>("skill_status"),
  installSkill: (agent: string) => invoke<SkillStatus>("install_skill", { agent }),
  removeSkill: (agent: string) => invoke<SkillStatus>("remove_skill", { agent }),
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
/** 상태 표시 그림 — 투명 바탕에 귀퉁이 표시만 있는 아이콘 크기 그림이라 아이콘 위에 그대로 겹친다. */
export const overlayUrl = (index: number, px: number) =>
  `http://fdicon.localhost/${encodeURIComponent(`o:${Math.round(px * (window.devicePixelRatio || 1))}:${index}`)}`;
export const pathIconUrl = (path: string) => `http://fdicon.localhost/${encodeURIComponent(`f:${path}`)}`;

/** 셸 아이콘 주소. 키 꼴은 fd-shell icon_png 와 같다. */
export function iconUrl(e: Pick<Entry, "isDir" | "ext" | "path">): string {
  const key = e.isDir ? "d" : PER_FILE_EXTS.has(e.ext) ? `f:${e.path}` : `e:${e.ext}`;
  return `http://fdicon.localhost/${encodeURIComponent(key)}`;
}
