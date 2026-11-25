// 앱 틀 — 제목 줄(탭 · 창 단추 · 새 판 알림) · 왼쪽 위치 목록 · 아래 즐겨찾기 독 · 나눠 보기 · 끌어다 놓기 받기 · 폴더 변경 알림 · 설정 저장.
//
// 목차
//   [1] 설정 읽기 · 저장 (즐겨찾기 · 탭 · 칸 배치 · 열 너비 · 화면 색 · 시작 폴더)
//   [2] 탭 · 나눠 보기 — 칸 배치는 「칸 / 두 쪽으로 나눔」 나무(Node)다. 칸마다 탭 묶음을 갖고, 키보드는 「지금 칸」(focus) 이 받는다
//       2026.11.11 : 나눠 보기를 더했다. 두 폴더를 나란히 놓고 파일을 끌어 옮기는 일이 탭을 오가는 것보다 잦다
//       2026.11.11 : 칸마다 탭 하나 → 탭 묶음. 위 가장자리에 닿은 칸의 탭 줄은 제목 줄에서 제 칸 너비만큼 갈라져 제 칸 위에 붙고,
//                    아래쪽 칸의 탭 줄은 제 칸 맨 위에 선다 — 탭 줄 하나에 여러 칸의 탭이 섞이면 어느 탭이 어느 칸 것인지 표시를 읽어야 했다
//       2026.11.11 : 좌우 두 칸 고정 → 끌어서 상하좌우로 네 칸까지. 나눠 보기 단추를 뺐다 — 나누는 일은 탭을 끌어 놓는 자리가 정한다
//   [3] 탭 끌기 — 탭 줄의 탭 사이에 놓으면 그 자리로 · 칸 가운데에 놓으면 그 칸 끝으로 · 칸 가장자리에 놓으면 그쪽으로 나눠 새 칸으로.
//       칸의 마지막 탭이 빠지면 그 칸은 접히고 옆 칸이 자리를 채운다 — 그래서 탭 하나짜리 칸을 끌어 놓는 것이 곧 칸 자리 바꾸기다
//       Tauri 가 창으로 들어오는 파일 끌기를 받으려고 웹 끌기(HTML5 DnD)를 막아 두어, 마우스 움직임으로 직접 짠다
//   [4] 끌어다 놓기 받기 (앱 밖 · 다른 칸에서 끈 파일) · 즐겨찾기에 놓기
//       끌고 아래 가장자리로 오면 즐겨찾기 독을 연다 — 끄는 동안은 웹 화면에 :hover 가 오지 않는다
//   [5] 단축키 (Ctrl+T · W · Tab · 1~9 · H · \ · K 명령 팔레트)
//   [6] 명령 팔레트 — 자리 · 명령 목록을 세운다
//   [7] 그리기 — 칸 자리 셈 · 탭 줄 · 칸 사이 줄 · 놓을 자리 덮개
//   2026.11.24 : 창을 여럿 둔다 — 탭을 창 밖으로 끌어 놓으면 그 폴더로 새 창이 뜬다 (사용자 요청). 열어 둔 탭은 주 창(`main`)만 저장하고,
//                떼어 낸 창(`w-<번호>`)은 즐겨찾기 · 보기 같은 공용 설정만 저장한다. 공용 설정은 저장할 때마다 다른 창에 알려(fd-prefs) 같이 맞춘다.
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, appIconUrl, DEFAULT_VIEW, SIDE_IDS, TAG_LABEL, type SideId, type AppInfo, type AppPin, type Drive, type Place, type Places, type SavedNode, type Settings, type SmartFolder, type SmartScope, type TagColor, type Theme, type ViewPrefs } from "./api";
import Palette, { type FindScope, type PaletteItem } from "./Palette";
import { newSmartId, scopeLabel, scopeOf, validSmart } from "./query";
import SmartEditor from "./SmartEditor";
import ContextMenu, { type CtxMenuState } from "./ContextMenu";
import FavDock from "./FavDock";
import Pane from "./Pane";
import { atStep, LAST_STEP, STEPS, stepOf } from "./SizeLadder";
import SettingsPanel from "./SettingsPanel";
import Sidebar from "./Sidebar";
import TitleBar from "./TitleBar";
import { useAutoUpdate, useUpdateState } from "./updater";
import { applyTheme, baseName, DEFAULT_COLS, DEFAULT_KINDS, errText, type KindDef, norm, parseExts, setIconPack, setKinds, type Sort, type SortKey } from "./util";

export type Tab = { id: number; path: string; back: string[]; fwd: string[] };

let nextId = 1;
const newTab = (path: string): Tab => ({ id: nextId++, path, back: [], fwd: [] });

const START = "C:\\";

/** 이 창 이름 — 주 창 `main` · 탭을 끌어 떼어 낸 창 `w-<번호>` (Rust open_window). */
const WIN = getCurrentWindow().label;
const IS_MAIN = WIN === "main";
/** 떼어 낸 창이 처음 열 폴더 (주소의 ?path=). */
const OPEN_PATH = new URLSearchParams(window.location.search).get("path");
/** 창끼리 공용 설정을 맞추는 이벤트 이름. */
const PREFS_EVENT = "fd-prefs";


/** 처음 쓸 때 즐겨찾기 — 비워 둔다. Ctrl+D 로 지금 폴더(또는 고른 항목)를 더하면 설정에 저장된다.
 *  2026.11.11 : 이 PC 의 과업 경로를 기본값으로 두던 것을 뺐다 (공개 저장소). */
const DEFAULT_PINNED: Place[] = [];

/** 즐겨찾기에 놓는 자리의 표시 — 파일을 옮기지 않고 즐겨찾기에 더한다. 「fd:pin@3」 이면 넷째 자리 앞에 끼운다 (없으면 끝). */
export const PIN_DROP = "fd:pin";

/** 왼쪽 열 「연결」 머리에 놓는 자리의 표시 — 옮기지 않고 연결에 더한다. */
export const LINK_DROP = "fd:link";
/** 왼쪽 열 「앱」 머리 — 실행 파일 · 바로가기를 놓으면 고정한다. */
export const APP_DROP = "fd:app";

/** 왼쪽 「색 표시」 건반에 놓는 자리의 표시 — 옮기지 않고 그 색을 단다. 「fd:tag@blue」. 2026.11.12 */
export const TAG_DROP = "fd:tag@";

/** 파일을 끌고 창 아래 가장자리에서 이만큼(px) 안쪽에 오면 즐겨찾기 독을 연다. */
const DOCK_REACH = 64;

/** 나눠 보기에서 한 칸이 가질 수 있는 가장 좁은 비율. */
const MIN_RATIO = 0.2;

/** 칸 수 상한. 2026.11.11 : 4 — 그 이상은 한 칸이 목록 몇 줄밖에 안 남아 탭을 오가는 편이 낫다. */
const MAX_PANES = 4;
/** 드라이브를 다시 읽는 간격 — USB 를 꽂고 기다리는 사람이 답답하지 않을 만큼. */
const DRIVE_CHECK = 4000;

/** 칸 가장자리에서 이 비율 안쪽에 놓으면 그쪽으로 나눈다. 그보다 안쪽은 칸 가운데(그 칸으로 옮기기). */
const EDGE = 0.25;

/** 칸 사이 줄 두께(px) · 칸 안 탭 줄 높이(px). styles.css 「나눠 보기」와 맞춘다. */
const GAP = 5;
const STRIP_H = 34;

/** 칸 하나의 가장 좁은 너비 · 낮은 높이(px, 탭 줄 빼고). 비율 하한(MIN_RATIO)만으로는 겹겹이 나눈 칸이 수십 px 로 줄어 목록이 사라진다. */
const MIN_PANE_PX = 140;

/** 제목 줄 오른쪽 끝의 창 끌기 자리(48) · 창 단추(46×3) 몫. 맨 오른쪽 위 칸의 탭 줄이 제목 줄에서 쓸 수 있는 너비를 셀 때 뺀다. */
const TITLE_CTRL_PX = 186;
/** 맨 오른쪽 위 칸의 탭 줄이 제목 줄에서 이보다 좁아지면 제 칸 안에 탭 줄을 둔다. */
const TITLE_STRIP_MIN_PX = 160;

function withDefaults(s: Partial<Settings> | null): Settings {
  const split =
    s?.split && typeof s.split.right === "number"
      ? { right: s.split.right, ratio: clampRatio(s.split.ratio), ...(typeof s.split.from === "number" ? { from: s.split.from } : {}) }
      : null;
  return {
    pinned: s?.pinned ?? DEFAULT_PINNED,
    links: Array.isArray(s?.links) ? s.links.filter((x) => x && typeof x.path === "string") : [],
    session: s?.session ?? { tabs: [], active: 0 },
    // 2026.11.17 : 종류 열 너비가 맨 뒤에 붙었다 — 너비 넷인 지난 설정은 그대로 두고 기본값만 잇는다
    cols: oldDateCol(s?.cols?.length === DEFAULT_COLS.length ? s.cols : s?.cols?.length === DEFAULT_COLS.length - 1 ? [...s.cols, DEFAULT_COLS[DEFAULT_COLS.length - 1]] : DEFAULT_COLS),
    showHidden: s?.showHidden ?? false,
    theme: s?.theme === "light" || s?.theme === "dark" ? s.theme : "system",
    split,
    layout: s?.layout && typeof s.layout === "object" ? s.layout : null,
    view: {
      ...DEFAULT_VIEW,
      ...(s?.view ?? {}),
      size: Math.min(3, Math.max(0, Number(s?.view?.size ?? DEFAULT_VIEW.size) || 0)),
      // 종류 열이 생기기 전(너비 넷) 설정은 그 열을 숨긴 채로 읽는다 — 업데이트로 목록 모양이 바뀌지 않게
      hiddenCols: Array.isArray(s?.view?.hiddenCols)
        ? s.cols?.length === DEFAULT_COLS.length - 1 && !s.view.hiddenCols.includes("kind")
          ? [...s.view.hiddenCols, "kind"]
          : s.view.hiddenCols
        : DEFAULT_VIEW.hiddenCols,
      dense: s?.view?.dense === true,
      icons: s?.view?.icons === "filedesk" || s?.view?.icons === "pack" ? s.view.icons : "shell",
      iconPack: typeof s?.view?.iconPack === "string" ? s.view.iconPack : "",
      folderClick: s?.view?.folderClick === "single" ? "single" : "double",
      sort: validSort(s?.view?.sort),
      dirsFirst: s?.view?.dirsFirst !== false,
      editions: s?.view?.editions === true,
      foldStart: s?.view?.foldStart !== false,
      recent: s?.view?.recent !== false,
      namePeek: s?.view?.namePeek !== false,
      viewStrip: s?.view?.viewStrip !== false,
      overlays: s?.view?.overlays !== false,
      links: typeof s?.view?.links === "boolean" ? s.view.links : Array.isArray(s?.links) && s.links.length > 0,
      sideFavs: s?.view?.sideFavs !== false,
      // 모르는 이름은 버리고, 빠진 구획(새 판에서 더한 것)은 끝에 잇는다
      sideOrder: [...new Set([...(Array.isArray(s?.view?.sideOrder) ? s.view.sideOrder : []).filter((x): x is SideId => SIDE_IDS.includes(x as SideId)), ...SIDE_IDS])],
      sideOff: Array.isArray(s?.view?.sideOff) ? s.view.sideOff.filter((x): x is SideId => x === "pc" || x === "apps" || x === "tags") : [],
      sizeUnit: s?.view?.sizeUnit === "auto" ? "auto" : "kb",
      folderSize: s?.view?.folderSize === true,
      kinds: validKinds(s?.view?.kinds),
      findSkip: Array.isArray(s?.view?.findSkip) ? parseExts(s.view.findSkip.filter((x) => typeof x === "string").join(" ")) : DEFAULT_VIEW.findSkip,
    },
    start: typeof s?.start === "string" ? s.start : "",
    smart: validSmart(s?.smart),
    apps: Array.isArray(s?.apps) ? s.apps.filter((a) => a && typeof a.id === "string" && typeof a.name === "string").map((a) => ({ ...a, icon: typeof a.icon === "string" ? a.icon : a.id })) : [],
    sideW: clampSide(s?.sideW),
  };
}

/** 옛 기본 수정일 너비(110)를 새 기본으로 — 손대지 않은 열만. 손으로 바꾼 너비는 그대로 둔다. 2026.11.18 */
const oldDateCol = (cols: number[]) => (cols[2] === 110 ? cols.map((w, i) => (i === 2 ? DEFAULT_COLS[2] : w)) : cols);

/** 왼쪽 열 너비 — 기본 · 끌 수 있는 범위 (px). 좁으면 드라이브 용량 · 스마트 폴더 개수가 잘리고, 넓으면 목록 자리를 먹는다. */
export const SIDE_W = 228;
const SIDE_MIN = 180;
const SIDE_MAX = 420;
const clampSide = (w: unknown) => (typeof w === "number" && isFinite(w) ? Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w))) : SIDE_W);

/** 설정 파일의 기본 정렬 — 손으로 고쳐 꼴이 어긋났으면 이름 오름차순. */
function validSort(v: unknown): Sort {
  const o = v as Partial<Sort> | null | undefined;
  const keys: SortKey[] = ["name", "modified", "kind", "size"];
  return o && keys.includes(o.key as SortKey) ? { key: o.key as SortKey, asc: o.asc !== false } : DEFAULT_VIEW.sort;
}

/** 설정 파일의 종류 목록 — 손으로 고쳐 꼴이 어긋난 것은 버리고, 하나도 없으면 기본값. */
function validKinds(v: unknown): KindDef[] {
  if (!Array.isArray(v)) return DEFAULT_KINDS;
  const ok = v.filter(
    (k): k is KindDef =>
      !!k && typeof k.id === "string" && typeof k.label === "string" && typeof k.color === "string" && Array.isArray(k.exts) && k.exts.every((x: unknown) => typeof x === "string"),
  );
  return ok.length ? ok : DEFAULT_KINDS;
}

const clampRatio = (r: unknown) => (typeof r === "number" && isFinite(r) ? Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r)) : 0.5);

// ───────── 칸 배치 ─────────

/** 칸 하나 — 탭 순서와 지금 보이는 탭. `key` 는 칸이 살아 있는 동안 바뀌지 않는다 (초점 · 그리기 열쇠).
 *  비지 않는다 (마지막 탭이 빠지면 칸째 없앤다).
 *  step: 이 칸만의 보기 크기 눈금 (SizeLadder). 없으면 설정의 크기를 따른다.
 *  2026.11.18 : 사용자 요청 — 나눠 보면 한쪽은 격자로 그림을, 한쪽은 목록으로 문서를 보게. 칸이 하나면 쓰지 않는다 (설정의 크기가 곧 그 칸). */
type Leaf = { key: number; ids: number[]; cur: number; step?: number };
/** 두 쪽으로 나눈 자리 — row 는 좌우, col 은 위아래. `a` 가 왼쪽 · 위, `ratio` 는 `a` 의 몫. */
type Split = { dir: "row" | "col"; ratio: number; a: LayoutNode; b: LayoutNode };
type LayoutNode = Leaf | Split;

const isLeaf = (n: LayoutNode): n is Leaf => "ids" in n;
let nextKey = 1;
const newLeaf = (ids: number[], cur = ids[0]): Leaf => ({ key: nextKey++, ids, cur });

/** 칸들 — 왼쪽 · 위부터. 설정의 탭 순서도 이 차례다. */
function leavesOf(n: LayoutNode): Leaf[] {
  return isLeaf(n) ? [n] : [...leavesOf(n.a), ...leavesOf(n.b)];
}

/** 칸마다 `fn` 을 돌린다 (칸을 나눔으로 바꿔도 된다). 빈 칸은 빼고, 한쪽이 빈 나눔은 남은 쪽으로 접는다. */
function mapLeaves(n: LayoutNode, fn: (l: Leaf) => LayoutNode | null): LayoutNode | null {
  if (isLeaf(n)) {
    const x = fn(n);
    return x && (!isLeaf(x) || x.ids.length > 0) ? x : null;
  }
  const a = mapLeaves(n.a, fn);
  const b = mapLeaves(n.b, fn);
  if (!a) return b;
  if (!b) return a;
  return a === n.a && b === n.b ? n : { ...n, a, b };
}

/** `path`(a · b 를 이은 글) 자리 나눔의 비율을 바꾼다. */
function setRatioAt(n: LayoutNode, path: string, r: number): LayoutNode {
  if (isLeaf(n)) return n;
  if (!path) return { ...n, ratio: r };
  return path[0] === "a" ? { ...n, a: setRatioAt(n.a, path.slice(1), r) } : { ...n, b: setRatioAt(n.b, path.slice(1), r) };
}

/** 묶음에서 탭 하나를 뺀다. 보이던 탭이면 그 왼쪽(맨 앞이면 오른쪽) 탭을 보인다. */
function leave(g: Leaf, id: number): Leaf {
  const i = g.ids.indexOf(id);
  const ids = g.ids.filter((x) => x !== id);
  return { ...g, ids, cur: g.cur !== id ? g.cur : (ids[Math.max(0, i - 1)] ?? -1) };
}

type Edge = "left" | "right" | "top" | "bottom";

/** 놓을 자리 — `g` 칸(열쇠)의 탭 줄 `at` 번째 앞 · 그 칸 가운데(끝에 붙이기) · 그 칸 가장자리(그쪽으로 나눠 새 칸). */
type Slot = { g: number; kind: "strip"; at: number } | { g: number; kind: "pane" } | { g: number; kind: "edge"; edge: Edge };

/** 탭 끌기 상태. sx · sy 는 화면 좌표(CSS px) · out 은 창 밖으로 나갔는가 (놓으면 새 창). */
type TabDrag = { id: number; x0: number; y0: number; on: boolean; x: number; y: number; to: Slot | null; sx: number; sy: number; out: boolean };

/** 탭을 `to` 자리로 옮긴다. 먼저 제 칸에서 빼고(비면 접는다) 그다음 넣는다 — 같은 열쇠가 두 칸에 잠깐이라도 있으면 빼기가 둘 다 지운다. */
function moveTab(root: LayoutNode, id: number, to: Slot): LayoutNode {
  const src = leavesOf(root).find((l) => l.ids.includes(id));
  if (!src) return root;
  let at = to.kind === "strip" ? to.at : 0;
  if (to.kind === "strip" && src.key === to.g && src.ids.indexOf(id) < at) at--; // 같은 줄에서 뒤로 옮기면 빠진 자리만큼 당긴다
  const out = mapLeaves(root, (l) => (l.key === src.key ? leave(l, id) : l)) ?? root;
  return (
    mapLeaves(out, (l) => {
      if (l.key !== to.g) return l;
      if (to.kind === "edge") {
        const n = newLeaf([id]);
        const first = to.edge === "left" || to.edge === "top";
        return { dir: to.edge === "left" || to.edge === "right" ? "row" : "col", ratio: 0.5, a: first ? n : l, b: first ? l : n };
      }
      const ids = [...l.ids];
      ids.splice(to.kind === "strip" ? Math.max(0, Math.min(at, ids.length)) : ids.length, 0, id);
      return { ...l, ids, cur: id };
    }) ?? out
  );
}

/** 칸 놓임새 — 나눔 방향과 칸마다 탭. 비율 · 열쇠는 뺀다. */
const shapeOf = (n: LayoutNode): string => (isLeaf(n) ? `[${n.ids.join(",")}]` : `${n.dir}(${shapeOf(n.a)} ${shapeOf(n.b)})`);

/** 칸 `key` 에 탭을 붙인다. 그 칸이 그사이 접혀 없으면 첫 칸에 — 어느 칸에도 없는 탭은 보이지도 저장되지도 않는다. */
function addTab(r: LayoutNode, key: number, id: number, show: boolean): LayoutNode {
  const k = leavesOf(r).some((l) => l.key === key) ? key : leavesOf(r)[0].key;
  return mapLeaves(r, (x) => (x.key === k ? { ...x, ids: [...x.ids, id], cur: show ? id : x.cur } : x)) ?? r;
}

/** 놓아도 바뀌는 것이 없거나 놓을 수 없는 자리인지 — 덮개 · 끼울 자리 표시를 내지 않는다. */
function noop(root: LayoutNode, id: number, to: Slot): boolean {
  const ls = leavesOf(root);
  const src = ls.find((l) => l.ids.includes(id));
  if (!src) return true;
  if (to.kind === "edge") {
    // 탭 하나짜리 칸에서 끌면 그 칸이 접혀 칸 수가 그대로다 — 제 칸 옆이면 바뀌는 것이 없고, 다른 칸 옆이면 자리 바꾸기다.
    // 다만 지금 놓임새 그대로 돌아오는 자리(왼쪽 칸 탭을 오른쪽 칸 왼쪽 가장자리로)는 끌어 둔 비율만 반반으로 날리므로 막는다.
    if (src.ids.length === 1) return src.key === to.g || shapeOf(moveTab(root, id, to)) === shapeOf(root);
    return ls.length >= MAX_PANES; // 칸이 하나 늘어나는데 이미 꽉 찼다
  }
  if (src.key !== to.g) return false;
  if (to.kind === "pane") return true; // 제 칸 가운데
  const i = src.ids.indexOf(id);
  return to.at === i || to.at === i + 1;
}

/** 저장해 둔 배치를 탭 번호에 다시 입힌다. 칸마다 탭 수만큼 앞에서부터 가져간다. 어긋나면 null (한 칸으로 연다). */
function restoreLayout(saved: unknown, ids: number[]): LayoutNode | null {
  let k = 0;
  const build = (s: unknown, depth: number): LayoutNode | null => {
    const o = s as Partial<Record<string, unknown>> | null;
    if (!o || typeof o !== "object" || depth > MAX_PANES) return null;
    if (typeof o.tabs === "number") {
      const n = Math.floor(o.tabs);
      if (n < 1 || k + n > ids.length) return null;
      const xs = ids.slice(k, (k += n));
      const c = typeof o.cur === "number" ? Math.min(Math.max(0, Math.floor(o.cur)), n - 1) : 0;
      const leaf = newLeaf(xs, xs[c]);
      if (typeof o.step === "number" && o.step >= 0 && o.step <= LAST_STEP) leaf.step = Math.floor(o.step);
      return leaf;
    }
    if (o.dir !== "row" && o.dir !== "col") return null;
    const a = build(o.a, depth + 1);
    const b = a && build(o.b, depth + 1);
    return a && b ? { dir: o.dir, ratio: clampRatio(o.ratio), a, b } : null;
  };
  const t = build(saved, 0);
  return t && k === ids.length && leavesOf(t).length <= MAX_PANES ? t : null;
}

function saveLayout(n: LayoutNode): SavedNode {
  if (!isLeaf(n)) return { dir: n.dir, ratio: n.ratio, a: saveLayout(n.a), b: saveLayout(n.b) };
  return n.step == null ? { tabs: n.ids.length, cur: Math.max(0, n.ids.indexOf(n.cur)) } : { tabs: n.ids.length, cur: Math.max(0, n.ids.indexOf(n.cur)), step: n.step };
}

// ───────── 칸 자리 셈 ─────────
// 칸 사이 줄이 픽셀 두께라 비율만으로는 칸 자리를 못 적는다. 길이를 「칸 영역의 f 배 + p 픽셀」로 들고 다니다 CSS calc() 로 낸다.
// 그래서 칸들을 겹친 DOM 이 아니라 칸 영역 안 절대 자리로 그린다 — 배치가 바뀌어도 칸(Pane)이 다시 만들어지지 않아 스크롤 · 고른 것이 남는다.

type Len = { f: number; p: number };
type Rect = { x0: Len; x1: Len; y0: Len; y1: Len };
const len = (f: number, p = 0): Len => ({ f, p });
const plus = (a: Len, b: Len) => len(a.f + b.f, a.p + b.p);
const minus = (a: Len, b: Len) => len(a.f - b.f, a.p - b.p);
const times = (a: Len, k: number) => len(a.f * k, a.p * k);
const same = (a: Len, b: Len) => Math.abs(a.f - b.f) < 1e-6 && Math.abs(a.p - b.p) < 0.01;
const calc = (a: Len) => `calc(${+(a.f * 100).toFixed(4)}% + ${+a.p.toFixed(2)}px)`;
const toPx = (a: Len, size: number) => a.f * size + a.p;
const FULL: Rect = { x0: len(0), x1: len(1), y0: len(0), y1: len(1) };
const ZERO = len(0);
const atTop = (r: Rect) => same(r.y0, ZERO);
const atBottom = (r: Rect) => same(r.y1, len(1));
const boxOf = (r: Rect): CSSProperties => ({ left: calc(r.x0), top: calc(r.y0), width: calc(minus(r.x1, r.x0)), height: calc(minus(r.y1, r.y0)) });

type Bar = { path: string; dir: "row" | "col"; r: Rect; node: Rect };
type Laid = { leaves: { leaf: Leaf; r: Rect }[]; bars: Bar[] };

/** 칸마다 자리, 나눔마다 칸 사이 줄 자리. */
function lay(n: LayoutNode, r: Rect = FULL, path = "", out: Laid = { leaves: [], bars: [] }): Laid {
  if (isLeaf(n)) {
    out.leaves.push({ leaf: n, r });
    return out;
  }
  const row = n.dir === "row";
  const [s, e] = row ? [r.x0, r.x1] : [r.y0, r.y1];
  const m = plus(s, times(minus(minus(e, s), len(0, GAP)), n.ratio));
  const m2 = plus(m, len(0, GAP));
  out.bars.push({ path, dir: n.dir, r: row ? { ...r, x0: m, x1: m2 } : { ...r, y0: m, y1: m2 }, node: r });
  lay(n.a, row ? { ...r, x1: m } : { ...r, y1: m }, path + "a", out);
  lay(n.b, row ? { ...r, x0: m2 } : { ...r, y0: m2 }, path + "b", out);
  return out;
}

/** 놓을 자리 덮개 — 안쪽으로 6px 띄운다. 자리는 놓은 뒤의 배치에서 그 탭이 앉을 칸이라, 덮개가 곧 결과다. */
const inset = (r: Rect): Rect => {
  const i = len(0, 6);
  return { x0: plus(r.x0, i), x1: minus(r.x1, i), y0: plus(r.y0, i), y1: minus(r.y1, i) };
};

/** `dir` 방향으로 늘어선 칸 수 — 그 방향 나눔은 더하고, 다른 방향은 큰 쪽. 칸 사이 줄을 끌 때 양쪽이 지켜야 할 최소 px 를 센다. */
function span(n: LayoutNode, dir: "row" | "col"): number {
  if (isLeaf(n)) return 1;
  return n.dir === dir ? span(n.a, dir) + span(n.b, dir) : Math.max(span(n.a, dir), span(n.b, dir));
}
function nodeAt(n: LayoutNode, path: string): LayoutNode {
  return !path || isLeaf(n) ? n : nodeAt(path[0] === "a" ? n.a : n.b, path.slice(1));
}

const EDGE_LABEL: Record<Edge, string> = { left: "왼쪽에 나눠 열기", right: "오른쪽에 나눠 열기", top: "위에 나눠 열기", bottom: "아래에 나눠 열기" };

export default function App() {
  const [places, setPlaces] = useState<Places | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(START)]);
  /** 칸 배치. 칸이 하나면 안 나눴다. */
  const [root, setRoot] = useState<LayoutNode>(() => newLeaf([tabs[0].id]));
  /** 키보드를 받는 칸의 열쇠. 칸이 접혀 없어진 열쇠면 첫 칸으로 읽는다 (`fg`). */
  const [focus, setFocus] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<Place[]>([]);
  const [links, setLinks] = useState<Place[]>([]);
  /** 왼쪽 열 「앱」에 고정한 앱 · 설치된 앱 전부(팔레트에서 찾는다 · 켤 때와 팔레트를 열 때 읽는다). */
  const [pinnedApps, setPinnedApps] = useState<AppPin[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [sideW, setSideW] = useState(SIDE_W);
  const [cols, setCols] = useState<number[]>(DEFAULT_COLS);
  const [theme, setTheme] = useState<Theme>("system");
  const [loaded, setLoaded] = useState(false);
  /** 알림 한 줄 — 지금 칸 위에 뜬다. 해낸 일은 ok, 실패 · 취소는 warn. */
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [drag, setDrag] = useState<TabDrag | null>(null);
  /** 탭 오른쪽 메뉴. 2026.11.24 — 탭에는 메뉴가 없어 닫기 · 새 창은 단추 · 끌기로만 했다. */
  const [tabMenu, setTabMenu] = useState<CtxMenuState | null>(null);
  /** 탭 이름 — 칸이 모아 보기(스마트 폴더 등)를 띄우면 그 이름. 없으면 폴더 이름. */
  const [tabTitles, setTabTitles] = useState<Map<number, string>>(new Map());
  const setTabTitle = useCallback((id: number, title: string | null) => {
    setTabTitles((m) => {
      if ((m.get(id) ?? null) === title) return m;
      const n = new Map(m);
      if (title) n.set(id, title);
      else n.delete(id);
      return n;
    });
  }, []);
  /** 끄는 중인 칸 사이 줄(나눔 path) — 제목 줄 틈을 잡아 끌어도 아래 줄이 함께 굵어지게. */
  const [pulling, setPulling] = useState<string | null>(null);
  /** 마우스가 올라간 칸 사이 줄 — 제목 줄 틈과 아래 줄이 한 줄로 함께 밝아지게.
   *  2026.11.24 : 둘이 따로 밝아져 위(탭 줄 틈)와 아래(칸 사이)에 선이 두 번 그려졌다 (사용자 지적). */
  const [hotBar, setHotBar] = useState<string | null>(null);
  const [view, setView] = useState<ViewPrefs>(DEFAULT_VIEW);
  const [start, setStart] = useState("");
  /** 스마트 폴더 — 왼쪽 열 · 명령 팔레트. 2026.11.12 더했다. */
  const [smart, setSmart] = useState<SmartFolder[]>([]);
  /** 고치는 중인 스마트 폴더 (새로 만드는 중이면 isNew). */
  const [smartEdit, setSmartEdit] = useState<{ folder: SmartFolder; isNew: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** 팔레트를 「앱 고정」으로 열었다 — 왼쪽 열 「앱」의 ＋. 앱만 보이고 Enter 가 고정이다. */
  const [paletteApps, setPaletteApps] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  useAutoUpdate();
  // 새 버전을 찾으면 판마다 한 번 알림 줄에 알린다 — 제목 줄 알약만으로는 지나치기 쉽다.
  // 2026.11.24 : 사용자 지적 「설정에 들어가지 않으면 업데이트가 있는 걸 알 방법이 없다」.
  const upd = useUpdateState();
  const announced = useRef("");
  useEffect(() => {
    const v = upd.phase === "available" && !upd.dismissed ? upd.update?.version : undefined;
    if (!v || announced.current === v) return;
    announced.current = v;
    setNotice({ text: `새 버전 ${v} 있음 · 제목 줄 「새 버전」에서 설치`, tone: "ok" });
  }, [upd.phase, upd.update, upd.dismissed]);

  // 종류 표는 아이콘처럼 설정을 받지 않는 곳도 보므로 그리기 전에 넣는다 (같은 목록이면 다시 세우지 않는다).
  setKinds(view.kinds);

  // 아이콘 팩 — 폴더를 고르거나 「아이콘 팩」으로 바꿀 때 읽는다. 읽은 표를 상태로 두어 목록이 다시 그려지게 한다.
  const [packMap, setPackMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (view.icons !== "pack" || !view.iconPack) return setPackMap({});
    api
      .iconPack(view.iconPack)
      .then(setPackMap)
      .catch((e) => {
        setPackMap({});
        setNotice({ text: errText(e), tone: "warn" });
      });
  }, [view.icons, view.iconPack]);
  setIconPack(packMap);

  // 배치가 바뀔 때만 다시 센다 — 끌기 중 마우스가 움직일 때마다 새 배열이 되면 이것을 쓰는 콜백 · 단축키 처리기가 매번 다시 걸린다.
  const leaves = useMemo(() => leavesOf(root), [root]);
  const laid = useMemo(() => lay(root), [root]);
  const split = leaves.length > 1;
  const fgLeaf = leaves.find((l) => l.key === focus) ?? leaves[0];
  const fg = fgLeaf.key;

  /** 칸 하나의 보기 크기를 바꾼다 (Ctrl+휠 · Ctrl+= / − · 아래 줄 눈금 · 오른쪽 메뉴 「보기」). 칸이 하나면 설정의 크기를 바꾼다. */
  const zoomPane = useCallback(
    (key: number, f: (step: number) => number) => {
      if (leaves.length < 2) return setView((v) => atStep(v, f(stepOf(v))));
      const base = stepOf(view);
      setRoot((r) => mapLeaves(r, (l) => (l.key === key ? { ...l, step: Math.max(0, Math.min(LAST_STEP, f(l.step ?? base))) } : l)) ?? r);
    },
    [leaves.length, view],
  );
  /** 설정 창의 크기 — 모든 칸에 한꺼번에. 칸마다 둔 크기는 지운다. */
  const zoomAll = useCallback((f: (v: ViewPrefs) => ViewPrefs) => {
    setView(f);
    setRoot((r) => mapLeaves(r, (l) => (l.step == null ? l : { ...l, step: undefined })) ?? r);
  }, []);
  // 칸이 하나로 줄면(한 칸으로 모으기 · 탭 닫기 · 끌어 옮기기) 남은 칸의 크기를 설정의 크기로 올린다 — 보던 크기가 그대로 남게.
  useEffect(() => {
    const only = leaves.length === 1 ? leaves[0] : null;
    if (only?.step == null) return;
    const s = only.step;
    setView((v) => atStep(v, s));
    setRoot((r) => (isLeaf(r) ? { ...r, step: undefined } : r));
  }, [leaves]);
  /** 독을 얹을 자리 — 나눠 보기면 바닥에 닿은 칸 중 지금 칸(지금 칸이 위쪽이면 그 아래 칸)의 바닥 가운데 절반.
   *  2026.11.13 : 독이 창 가운데 아래에 고정돼, 좌우로 나누면 왼쪽 칸 바닥 줄 오른쪽(보기 크기 단추)과 겹쳤다 (사용자 지적).
   *  칸 바닥 줄은 왼쪽에 개수, 오른쪽에 단추를 두므로 그 칸의 가운데가 비어 있다. 한 칸이면 독의 CSS 자리 그대로. */
  const dockZone = useMemo((): CSSProperties | undefined => {
    if (!split) return undefined;
    const bottoms = laid.leaves.filter((x) => atBottom(x.r));
    const f = laid.leaves.find((x) => x.leaf.key === fg);
    const mid = f ? (f.r.x0.f + f.r.x1.f) / 2 : 0.5;
    const pick = bottoms.find((x) => x.leaf.key === fg) ?? bottoms.find((x) => x.r.x0.f <= mid && mid <= x.r.x1.f) ?? bottoms[0];
    if (!pick) return undefined;
    const w = minus(pick.r.x1, pick.r.x0);
    return { marginLeft: calc(plus(pick.r.x0, times(w, 0.25))), width: calc(times(w, 0.5)) };
  }, [split, laid, fg]);
  const active = tabs.find((t) => t.id === fgLeaf.cur) ?? tabs[0];
  const pathOf = (id: number) => tabs.find((t) => t.id === id)?.path ?? active.path;

  // 칸 영역 너비 — 맨 오른쪽 위 칸의 탭 줄을 제목 줄에 둘 수 있는지 셀 때만 쓴다.
  const [paneW, setPaneW] = useState(0);
  useEffect(() => {
    const el = panesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPaneW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 탭 줄을 제 칸 안 맨 위에 두는 칸 — 위 가장자리에 닿지 않은 칸, 그리고 제목 줄에서 창 단추에 밀려 너무 좁아지는 맨 오른쪽 위 칸. */
  const inPane = useMemo(() => {
    const s = new Set<number>();
    if (laid.leaves.length < 2) return s;
    let right: (typeof laid.leaves)[number] | undefined;
    for (const x of laid.leaves) {
      if (!atTop(x.r)) s.add(x.leaf.key);
      else if (!right || x.r.x0.f > right.r.x0.f) right = x;
    }
    if (right && paneW && toPx(minus(right.r.x1, right.r.x0), paneW) - TITLE_CTRL_PX < TITLE_STRIP_MIN_PX) s.add(right.leaf.key);
    return s;
  }, [laid, paneW]);
  /** 칸 자리 — 제 칸 안에 탭 줄이 있으면 그 높이만큼 내려 앉는다. 그리기 · 놓을 자리 셈이 같은 자리를 쓴다. */
  const paneRect = (x: { leaf: Leaf; r: Rect }): Rect => (inPane.has(x.leaf.key) ? { ...x.r, y0: plus(x.r.y0, len(0, STRIP_H)) } : x.r);

  // ───────── [1] 설정 ─────────

  // 드라이브는 꽂고 빼면 바뀐다 — USB · 카드 · CD 를 넣으면 왼쪽 열에 나타나고 빼면 사라지게 몇 초마다 · 창으로 돌아올 때 다시 읽는다.
  // 2026.11.18 : 매체 없는 칸을 뺀 뒤로(fd-shell places) 처음 읽은 목록에 머물면 넣은 USB 가 끝내 안 보인다.
  //   드라이브가 그대로면 그리지 않는다 — 남은 용량은 늘 조금씩 바뀌어, 그것까지 보면 몇 초마다 창 전체를 다시 그린다.
  useEffect(() => {
    const sig = (ds: Drive[]) => ds.map((d) => `${d.path}|${d.label}|${d.kind}`).join(" ");
    // 앞의 읽기가 끝나지 않았으면 건너뛴다 — 끊긴 네트워크 드라이브 · 도는 CD 는 한 번에 몇 초씩 걸려, 겹쳐 부르면 대기가 쌓인다 (2026.11.18 리뷰 지적)
    let busy = false;
    const again = () => {
      if (busy) return;
      busy = true;
      api
        .places()
        .then((p) => setPlaces((old) => (!old || sig(old.drives) === sig(p.drives) ? old : { ...old, drives: p.drives })))
        .catch(() => {})
        .finally(() => (busy = false));
    };
    const t = window.setInterval(again, DRIVE_CHECK);
    window.addEventListener("focus", again);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", again);
    };
  }, []);

  // 지난번에 열어 둔 탭으로 연다. 처음이면 다운로드 — 들어온 파일을 정리하는 일이 가장 잦다.
  // 2026.11.18 : 드라이브 목록(약 0.1초)을 기다리지 않고 설정만 읽으면 탭을 연다 — 켤 때 목록이 그만큼 늦게 떴다.
  //   드라이브 목록이 필요한 것은 처음 켤 때(지난 탭 없음)의 다운로드 폴더뿐이다.
  useEffect(() => {
    const placesP = api.places().catch(() => null);
    placesP.then((p) => p && setPlaces(p));
    api.loadSettings().catch(() => null).then(async (raw) => {
      const s = withDefaults(raw);
      setPinned(s.pinned);
      setLinks(s.links);
      setCols(s.cols);
      setShowHidden(s.showHidden);
      setTheme(s.theme);
      setView(s.view);
      setStart(s.start);
      setSmart(s.smart ?? []);
      setPinnedApps(s.apps ?? []);
      setSideW(s.sideW ?? SIDE_W);
      const dl = !IS_MAIN || s.start || s.session.tabs.length ? START : ((await placesP)?.known.find((k) => k.name === "다운로드")?.path ?? START);
      // 시작 폴더를 정했으면 그 폴더 하나로 연다 — 지난 탭 · 나눠 보기는 버린다 (설정 「시작 폴더」)
      // 떼어 낸 창은 받은 폴더 하나로 연다 — 지난 탭은 주 창 것이다
      const restored = !IS_MAIN ? [newTab(OPEN_PATH || START)] : s.start ? [newTab(s.start)] : s.session.tabs.length ? s.session.tabs.map(newTab) : [newTab(dl)];
      setTabs(restored);
      const ids = restored.map((t) => t.id);
      const want = ids[Math.min(s.session.active, ids.length - 1)];
      let tree = IS_MAIN && !s.start && s.layout ? restoreLayout(s.layout, ids) : null;
      if (!tree && IS_MAIN && !s.start && s.split) {
        // 지난 판 설정 — 좌우 두 칸. 오른쪽 칸 탭은 `from` 부터 끝까지, `from` 이 없으면 `right` 탭 하나.
        const right = ids[s.split.right];
        const rightIds = right == null || right === want ? [] : s.split.from != null ? ids.slice(s.split.from) : [right];
        const leftIds = ids.filter((x) => !rightIds.includes(x));
        if (leftIds.length && rightIds.length)
          tree = {
            dir: "row",
            ratio: s.split.ratio,
            a: newLeaf(leftIds, leftIds.includes(want) ? want : leftIds[0]),
            b: newLeaf(rightIds, rightIds.includes(right) ? right : rightIds[0]),
          };
      }
      tree ??= newLeaf(ids, want);
      setRoot(tree);
      setFocus((leavesOf(tree).find((l) => l.cur === want) ?? leavesOf(tree)[0]).key);
      setLoaded(true);
    });
  }, []);

  // 설정 저장 — 바뀐 뒤 잠깐 기다렸다가 한 번에 (열 너비 · 칸 너비를 끄는 동안 수십 번 쓰지 않게).
  //   공용 설정이 바뀌었으면 저장한 뒤 다른 창에 알린다 — 받는 창은 제 것과 다를 때만 입힌다 (같으면 그치므로 서로 되알리기가 돌지 않는다).
  const prefsJson = useRef("");
  useEffect(() => {
    if (!loaded) return;
    const prefs = { pinned, links, cols, showHidden, theme, view, start, smart, apps: pinnedApps, sideW };
    const json = JSON.stringify(prefs);
    const changed = json !== prefsJson.current;
    prefsJson.current = json;
    const t = window.setTimeout(() => {
      const told = () => {
        if (changed) void emit(PREFS_EVENT, { from: WIN, prefs });
      };
      if (!IS_MAIN) return void api.savePrefs(prefs).then(told).catch(() => {});
      // 칸 차례(왼쪽 · 위부터)대로 탭을 잇는다 — 배치는 칸마다 탭 수만 적는다.
      const ls = leavesOf(root);
      const order = ls.flatMap((g) => g.ids);
      const idx = (id: number) => Math.max(0, order.indexOf(id));
      const cur = (ls.find((l) => l.key === focus) ?? ls[0]).cur;
      api
        .saveSettings({
          ...prefs,
          session: { tabs: order.map((id) => tabs.find((x) => x.id === id)?.path ?? START), active: idx(cur) },
          split: null,
          layout: ls.length > 1 ? saveLayout(root) : null,
        })
        .then(told)
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [loaded, tabs, root, focus, pinned, links, cols, showHidden, theme, view, start, smart, pinnedApps, sideW]);
  // 다른 창이 공용 설정을 바꿨다 — 같이 맞춘다.
  useEffect(() => {
    const un = listen<{ from: string; prefs: Settings }>(PREFS_EVENT, (ev) => {
      const { from, prefs } = ev.payload;
      if (from === WIN || JSON.stringify(prefs) === prefsJson.current) return;
      const s = withDefaults(prefs);
      setPinned(s.pinned);
      setLinks(s.links);
      setCols(s.cols);
      setShowHidden(s.showHidden);
      setTheme(s.theme);
      setView(s.view);
      setStart(s.start);
      setSmart(s.smart ?? []);
      setPinnedApps(s.apps ?? []);
      setSideW(s.sideW ?? SIDE_W);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // ───────── [1-1] 스마트 폴더 ─────────

  /** 다운로드 · 바탕화면 — 스마트 폴더 「최근 파일」이 보는 곳 (문서 폴더는 사람이 정리해 두는 곳이라 넣지 않는다). */
  const inbox = useMemo(() => (places ? places.known.filter((k) => k.name !== "문서").map((k) => k.path) : []), [places]);
  /** 스마트 폴더를 지금 칸에 띄운다. */
  const openSmart = useCallback((folder: SmartFolder) => window.dispatchEvent(new CustomEvent("fd:smart", { detail: { folder, scope: scopeOf(folder.scope, inbox) } })), [inbox]);
  const saveSmart = useCallback((f: SmartFolder) => {
    setSmart((xs) => (xs.some((x) => x.id === f.id) ? xs.map((x) => (x.id === f.id ? f : x)) : [...xs, f]));
    setSmartEdit(null);
    window.setTimeout(() => openSmart(f), 0);
  }, [openSmart]);
  /** 스마트 폴더 복제 — 바로 아래에 「이름 복사본」으로. */
  const dupSmart = useCallback((f: SmartFolder) => {
    setSmart((xs) => {
      const i = xs.findIndex((x) => x.id === f.id);
      const copy = { ...f, id: newSmartId(), name: `${f.name} 복사본` };
      return [...xs.slice(0, i + 1), copy, ...xs.slice(i + 1)];
    });
  }, []);
  const deleteSmart = useCallback((id: string) => {
    setSmart((xs) => xs.filter((x) => x.id !== id));
    setSmartEdit(null);
  }, []);
  // 칸의 「스마트 폴더로 저장」 · 스마트 폴더 머리의 「고치기」
  useEffect(() => {
    const made = (ev: Event) => {
      const { q, scope } = (ev as CustomEvent<{ q: string; scope: SmartScope }>).detail;
      setSmartEdit({ folder: { id: newSmartId(), name: "", q, scope }, isNew: true });
    };
    const edit = (ev: Event) => setSmartEdit({ folder: (ev as CustomEvent<SmartFolder>).detail, isNew: false });
    window.addEventListener("fd:smart-new", made);
    window.addEventListener("fd:smart-edit", edit);
    return () => {
      window.removeEventListener("fd:smart-new", made);
      window.removeEventListener("fd:smart-edit", edit);
    };
  }, []);

  useEffect(() => {
    if (loaded) applyTheme(theme);
  }, [loaded, theme]);

  /** 방금 더한(또는 이미 있던) 것 — 독이 잠깐 올라와 그 타일을 밝힌다. n 은 같은 것을 다시 더해도 다시 밝히려고. */
  const [pinFlash, setPinFlash] = useState<{ paths: string[]; n: number } | null>(null);
  /** 즐겨찾기에 더한다. 이미 있으면 그대로. at 을 주면 그 자리 앞에 끼운다 — 독의 타일 사이에 놓은 경우. */
  const pinMany = useCallback((items: { path: string; isDir: boolean }[], at?: number) => {
    if (!items.length) return;
    setPinned((ps) => {
      const have = new Set(ps.map((x) => norm(x.path)));
      const add = items.filter((i) => !have.has(norm(i.path))).map((i) => ({ name: baseName(i.path), path: i.path, ...(i.isDir ? {} : { file: true }) }));
      if (!add.length) return ps;
      const i = at == null ? ps.length : Math.max(0, Math.min(ps.length, at));
      return [...ps.slice(0, i), ...add, ...ps.slice(i)];
    });
    setPinFlash((f) => ({ paths: items.map((i) => i.path), n: (f?.n ?? 0) + 1 }));
    setNotice({ text: items.length === 1 ? `「${baseName(items[0].path)}」 즐겨찾기에 추가함` : `${items.length}개 즐겨찾기에 추가함`, tone: "ok" });
  }, []);
  /** 「연결」에 더한다 — 폴더만 (파일은 자리가 아니다). 이미 있으면 그대로. */
  const addLinks = useCallback((paths: string[]) => {
    setLinks((ls) => {
      const have = new Set(ls.map((x) => norm(x.path)));
      const add = paths.filter((p) => !have.has(norm(p))).map((p) => ({ name: baseName(p) || p, path: p }));
      return add.length ? [...ls, ...add] : ls;
    });
  }, []);
  const unlink = useCallback((path: string) => setLinks((ls) => ls.filter((x) => norm(x.path) !== norm(path))), []);
  /** 연결 이름 바꾸기 — 공유 줄(label) · 서버 줄(host, 그 서버의 연결 전부). 빈 이름이면 원래 이름(경로에서 딴 것)으로 돌린다. */
  const renameLinks = useCallback((paths: string[], key: "label" | "host", name: string) => {
    const want = new Set(paths.map(norm));
    const v = name.trim();
    setLinks((ls) =>
      ls.map((x) => {
        if (!want.has(norm(x.path))) return x;
        const { [key]: _, ...rest } = x;
        return v ? { ...rest, [key]: v } : rest;
      }),
    );
  }, []);
  const pinApps = useCallback((add: AppPin[]) => {
    setPinnedApps((xs) => {
      const have = new Set(xs.map((x) => x.id.toLowerCase()));
      const fresh = add.filter((a) => !have.has(a.id.toLowerCase()));
      return fresh.length ? [...xs, ...fresh] : xs;
    });
    if (add.length) setNotice({ text: `「앱」에 고정함: ${add.map((a) => a.name).join(" · ")}`, tone: "ok" });
  }, []);
  const unpinApp = useCallback((id: string) => setPinnedApps((xs) => xs.filter((x) => x.id !== id)), []);
  const launchApp = useCallback((id: string) => {
    api.launchApp(id).catch((e) => setNotice({ text: errText(e), tone: "warn" }));
  }, []);
  // 설치된 앱 — 켤 때 한 번, 팔레트를 열 때마다 뒤에서 다시 (그사이 깐 앱). 목록은 화면에 바로 쓰고 답이 오면 바꾼다.
  //   닫을 때는 읽지 않는다 — 앱 수백 개를 셸에서 다시 훑는 데 0.2 ~ 0.5초가 든다.
  const appsAsked = useRef(false);
  useEffect(() => {
    if (!paletteOpen && appsAsked.current) return;
    appsAsked.current = true;
    api.appsList().then(setApps).catch(() => {});
  }, [paletteOpen]);
  const unpin = useCallback((path: string) => setPinned((ps) => ps.filter((x) => norm(x.path) !== norm(path))), []);
  const movePin = useCallback((from: number, to: number) => {
    setPinned((ps) => {
      if (from === to || from < 0 || from >= ps.length) return ps;
      const n = [...ps];
      const [x] = n.splice(from, 1);
      n.splice(Math.max(0, Math.min(n.length, to > from ? to - 1 : to)), 0, x);
      return n;
    });
  }, []);

  // 칸에서 이름을 바꾸면 그 폴더(또는 그 안)를 가리키던 탭 · 뒤로 기록 · 즐겨찾기 · 연결을 새 이름으로 옮긴다.
  // 2026.11.24 : 폴더 이름을 바꾸면 그 폴더를 연 탭이 「찾을 수 없음」으로 바뀌고 즐겨찾기가 끊겼다 (사용자 지적 「이름을 바꿨는데 반영이 안 된다」).
  useEffect(() => {
    const on = (ev: Event) => {
      const { from, to } = (ev as CustomEvent<{ from: string; to: string }>).detail;
      const f = norm(from);
      const move = (p: string) => {
        const n = norm(p);
        return n === f ? to : n.startsWith(f + "\\") ? to + p.slice(from.length) : p;
      };
      setTabs((ts) => ts.map((t) => ({ ...t, path: move(t.path), back: t.back.map(move), fwd: t.fwd.map(move) })));
      const movePlaces = (ps: Place[]) => (ps.some((x) => move(x.path) !== x.path) ? ps.map((x) => (move(x.path) === x.path ? x : { ...x, path: move(x.path), name: norm(x.path) === f ? baseName(to) : x.name })) : ps);
      setPinned(movePlaces);
      setLinks(movePlaces);
    };
    window.addEventListener("fd:renamed", on);
    return () => window.removeEventListener("fd:renamed", on);
  }, []);

  // ───────── [2] 탭 · 나눠 보기 ─────────

  /** 탭을 제 칸에 보이고, 그 칸으로 초점을 옮긴다. */
  const showTab = useCallback(
    (id: number) => {
      const g = leavesOf(root).find((x) => x.ids.includes(id));
      if (!g) return;
      setRoot((t) => mapLeaves(t, (x) => (x.ids.includes(id) ? { ...x, cur: id } : x)) ?? t);
      setFocus(g.key);
    },
    [root],
  );

  const navigate = useCallback((id: number, path: string, how: "push" | "back" | "fwd" = "push") => {
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== id) return t;
        if (how === "back") {
          const prev = t.back[t.back.length - 1];
          if (!prev) return t;
          return { ...t, path: prev, back: t.back.slice(0, -1), fwd: [t.path, ...t.fwd] };
        }
        if (how === "fwd") {
          const next = t.fwd[0];
          if (!next) return t;
          return { ...t, path: next, back: [...t.back, t.path], fwd: t.fwd.slice(1) };
        }
        if (norm(path) === norm(t.path)) return t;
        return { ...t, path, back: [...t.back, t.path].slice(-100), fwd: [] };
      }),
    );
  }, []);

  /** 새 탭을 `g` 칸(열쇠) 탭 줄 끝에 연다 (기본은 지금 칸). `show` 가 거짓이면 뒤에 열어 두기만 한다 (「새 탭에서 열기」). */
  const openTab = useCallback(
    (path: string, show = true, g: number = fg) => {
      const t = newTab(path);
      setTabs((ts) => [...ts, t]);
      setRoot((r) => addTab(r, g, t.id, show)); // 칸은 갱신 때의 배치에서 고른다 (그사이 접혔으면 첫 칸)
      if (show) setFocus(g);
    },
    [fg],
  );

  /** 탭을 닫는다. 마지막 하나는 닫지 않는다. 칸의 마지막 탭이면 그 칸이 접힌다. */
  const closeTab = useCallback(
    (id: number) => {
      if (tabs.length === 1) return;
      setTabs((ts) => ts.filter((t) => t.id !== id));
      setRoot((r) => mapLeaves(r, (g) => (g.ids.includes(id) ? leave(g, id) : g)) ?? r);
    },
    [tabs.length],
  );

  /** 지금 칸을 오른쪽으로 나눈다 — 지금 칸에 탭이 둘 이상이면 지금 탭 옆 탭을 옮기고, 하나뿐이면 지금 폴더를 새 탭으로 연다
   *  (켜고 끌 때마다 탭이 늘지 않게). */
  const splitRight = useCallback(() => {
    const g = fgLeaf;
    const i = g.ids.indexOf(g.cur);
    const other = g.ids[i + 1] ?? g.ids[i - 1];
    if (other != null) {
      const out = moveTab(root, other, { g: g.key, kind: "edge", edge: "right" });
      setRoot(out);
      setFocus((leavesOf(out).find((l) => l.ids.includes(other)) ?? g).key);
      return;
    }
    const t = newTab(active.path);
    const n = newLeaf([t.id]);
    setTabs((ts) => [...ts, t]);
    setRoot((r) => mapLeaves(r, (x) => (x.key === g.key ? { dir: "row", ratio: 0.5, a: x, b: n } : x)) ?? r);
    setFocus(n.key);
  }, [fgLeaf, root, active.path]);

  /** 나눠 보기 켜기 · 끄기 (Ctrl+\). 나눠 있으면 모든 탭을 한 칸으로 모으고 지금 탭을 보인다. 아니면 오른쪽으로 나눈다. */
  const toggleSplit = useCallback(() => {
    if (!split) return splitRight();
    const one = newLeaf(leaves.flatMap((g) => g.ids), active.id);
    one.step = fgLeaf.step; // 지금 칸의 크기로 모은다 (위 효과가 설정으로 올린다)
    setRoot(one);
    setFocus(one.key);
  }, [split, splitRight, leaves, active.id, fgLeaf.step]);

  /** 경로를 옆 칸에서 새 탭으로 연다 (오른쪽 메뉴 「옆 칸에서 열기」). 안 나눴으면 오른쪽으로 나눈다.
   *  옆 칸은 칸 차례(왼쪽 · 위부터)로 지금 칸 다음 칸이다.
   *  2026.11.11 : 옆 칸의 지금 탭을 그 폴더로 옮기던 것을 새 탭으로 바꿨다 — 칸마다 탭 줄이 생겨 옆 칸 자리를 날릴 까닭이 없다. */
  const openBeside = useCallback(
    (path: string) => {
      const t = newTab(path);
      setTabs((ts) => [...ts, t]);
      if (split) {
        const other = leaves[(leaves.findIndex((l) => l.key === fg) + 1) % leaves.length].key;
        setRoot((r) => addTab(r, other, t.id, true));
        setFocus(other);
      } else {
        const n = newLeaf([t.id]);
        setRoot((r) => (isLeaf(r) ? { dir: "row", ratio: 0.5, a: r, b: n } : addTab(r, fg, t.id, true)));
        setFocus(n.key);
      }
    },
    [split, leaves, fg],
  );

  /** 탭을 끌어 놓은 자리로 옮긴다. 옮긴 탭을 그 칸에 보이고 그 칸으로 초점을 옮긴다. */
  const placeTab = useCallback(
    (id: number, to: Slot) => {
      const out = moveTab(root, id, to);
      setRoot(out);
      const g = leavesOf(out).find((l) => l.ids.includes(id));
      if (g) setFocus(g.key);
    },
    [root],
  );

  /** 칸 사이 줄 끌기 — 그 나눔의 비율을 바꾼다. 두 번 누르면 반반. */
  const startDivider = (bar: Bar) => (ev: React.MouseEvent) => {
    ev.preventDefault();
    const box = panesRef.current?.getBoundingClientRect();
    if (!box) return;
    const row = bar.dir === "row";
    const size = row ? box.width : box.height;
    const s = toPx(row ? bar.node.x0 : bar.node.y0, size);
    const e = toPx(row ? bar.node.x1 : bar.node.y1, size);
    // 양쪽이 그 방향으로 품은 칸 수만큼 최소 px 를 지킨다 (위아래면 칸마다 탭 줄 높이까지). 창이 작아 둘 다 못 지키면 비율 하한만 본다.
    const n = nodeAt(root, bar.path);
    const need = (x: LayoutNode) => span(x, bar.dir) * (MIN_PANE_PX + (row ? 0 : STRIP_H)) + (span(x, bar.dir) - 1) * GAP;
    const avail = e - s - GAP;
    const lo = isLeaf(n) ? 0 : need(n.a) / avail;
    const hi = isLeaf(n) ? 1 : 1 - need(n.b) / avail;
    setPulling(bar.path);
    document.body.classList.add("resizing", row ? "resizing-x" : "resizing-y");
    const move = (m: MouseEvent) => {
      const v = row ? m.clientX - box.left : m.clientY - box.top;
      const raw = (v - s - GAP / 2) / avail;
      const r = lo <= hi ? Math.min(Math.min(1 - MIN_RATIO, hi), Math.max(Math.max(MIN_RATIO, lo), raw)) : clampRatio(raw);
      setRoot((t) => setRatioAt(t, bar.path, r));
    };
    const up = () => {
      setPulling(null);
      document.body.classList.remove("resizing", "resizing-x", "resizing-y");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const evenDivider = (bar: Bar) => () => setRoot((t) => setRatioAt(t, bar.path, 0.5));

  // ───────── [3] 탭 끌기 ─────────

  // 놓을 때 읽을 끌기 상태 — 상태 갱신 함수 안에서 옮기면 StrictMode 가 두 번 불러 두 번 옮긴다.
  const dragRef = useRef<TabDrag | null>(null);
  dragRef.current = drag;

  /** 탭을 새 창으로 뗀다 — 창 밖에 놓은 자리(화면 좌표)에 그 폴더로 새 창을 열고 이 창에서는 닫는다.
   *  2026.11.24 : 사용자 요청. 이 창의 마지막 탭이면 뗄 것이 없다 — 창 자체를 옮기면 된다. */
  const detach = (id: number, sx: number, sy: number) => {
    const t = tabs.find((x) => x.id === id);
    if (!t) return;
    if (tabs.length < 2) return setNotice({ text: "마지막 탭은 새 창으로 뗄 수 없음", tone: "warn" });
    const r = window.devicePixelRatio || 1;
    // 새 창 크기는 그 탭이 있던 칸 크기(+ 왼쪽 열 · 제목 줄)를 따르되 너무 작지 않게. 잡은 탭이 새 창의 탭 자리 근처에 오게 왼쪽 위를 조금 비킨다
    const box = laid.leaves.find((x) => x.leaf.ids.includes(id));
    const pw = panesRef.current?.clientWidth ?? 960;
    const ph = panesRef.current?.clientHeight ?? 640;
    const w = box ? toPx(minus(box.r.x1, box.r.x0), pw) + sideW : 960;
    const h = box ? toPx(minus(box.r.y1, box.r.y0), ph) + 40 : 640;
    api
      .openWindow(t.path, Math.round((sx - sideW - 60) * r), Math.round((sy - 16) * r), Math.max(800, Math.round(w)), Math.max(500, Math.round(h)))
      .then(() => closeTab(id))
      .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
  };
  const detachRef = useRef(detach);
  detachRef.current = detach;

  useEffect(() => {
    if (!drag) return;
    const where = (id: number, x: number, y: number): Slot | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const tabEl = el?.closest<HTMLElement>("[data-tab-id]");
      const strip = el?.closest<HTMLElement>("[data-tab-strip]");
      const box = panesRef.current?.getBoundingClientRect();
      let to: Slot | null = null;
      if (tabEl) {
        // 탭 왼쪽 반이면 그 앞, 오른쪽 반이면 그 뒤
        const r = tabEl.getBoundingClientRect();
        const i = Number(tabEl.dataset.tabIndex);
        to = { g: Number(tabEl.dataset.tabGroup), kind: "strip", at: x < r.left + r.width / 2 ? i : i + 1 };
      } else if (strip) {
        const g = Number(strip.dataset.tabStrip);
        to = { g, kind: "strip", at: leavesOf(root).find((l) => l.key === g)?.ids.length ?? 0 };
      } else if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        // 칸 영역 — 어느 칸 위인지 · 그 칸 안에서 가장 가까운 가장자리가 어디인지
        const W = box.width;
        const H = box.height;
        const lx = x - box.left;
        const ly = y - box.top;
        // 칸 자리는 그릴 때와 같은 paneRect — 제 칸 안 탭 줄은 빼고 목록 영역만 잰다 (탭 줄 위는 위에서 탭 줄로 받았다)
        const hit = laid.leaves
          .map((x) => ({ leaf: x.leaf, r: paneRect(x) }))
          .find(({ r }) => toPx(r.x0, W) <= lx && lx <= toPx(r.x1, W) && toPx(r.y0, H) <= ly && ly <= toPx(r.y1, H));
        if (hit) {
          const u = (lx - toPx(hit.r.x0, W)) / Math.max(1, toPx(minus(hit.r.x1, hit.r.x0), W));
          const v = (ly - toPx(hit.r.y0, H)) / Math.max(1, toPx(minus(hit.r.y1, hit.r.y0), H));
          const d: Record<Edge, number> = { left: u, right: 1 - u, top: v, bottom: 1 - v };
          const edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
          const toEdge: Slot = { g: hit.leaf.key, kind: "edge", edge };
          // 가장자리여도 나눌 수 없으면(네 칸이 꽉 찼다) 그 칸으로 옮기기로 받는다
          to = d[edge] < EDGE && !noop(root, id, toEdge) ? toEdge : { g: hit.leaf.key, kind: "pane" };
        }
      }
      return to && !noop(root, id, to) ? to : null;
    };
    const move = (m: MouseEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const on = d.on || Math.hypot(m.clientX - d.x0, m.clientY - d.y0) > 6;
        // 단추를 누른 채 창 밖으로 나가도 웹 화면이 마우스를 붙잡고 있어 움직임이 계속 온다 — 창 밖이면 놓을 때 새 창으로 뗀다
        const out = on && (m.clientX < 0 || m.clientY < 0 || m.clientX > window.innerWidth || m.clientY > window.innerHeight);
        return { ...d, on, out, x: m.clientX, y: m.clientY, sx: m.screenX, sy: m.screenY, to: on && !out ? where(d.id, m.clientX, m.clientY) : null };
      });
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.on && d.out) detachRef.current(d.id, d.sx, d.sy);
      else if (d?.on && d.to) placeTab(d.id, d.to);
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // drag 가 생기고 없어질 때만 다시 건다 — 움직일 때마다 다시 걸면 끄는 동안 이벤트를 놓친다.
    // 끄는 동안 칸 배치는 바뀌지 않으므로 그때의 root · laid 로 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag != null, placeTab]);

  // 열린 탭들의 폴더를 감시한다.
  const watched = tabs.map((t) => t.path).join("|");
  //   칸이 폴더를 못 읽게 되거나 되살아나면(fd:rewatch) 다시 건다 — 없는 폴더는 Rust 가 그 위 폴더를 보므로, 있고 없음이 바뀌면 볼 자리도 바뀐다.
  useEffect(() => {
    const dirs = [...new Set(tabs.map((t) => t.path))];
    const go = () => api.watchDirs(dirs).catch(() => {});
    go();
    window.addEventListener("fd:rewatch", go);
    return () => window.removeEventListener("fd:rewatch", go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched]);

  useEffect(() => {
    const un = listen<string>("fs-changed", (e) => {
      window.dispatchEvent(new CustomEvent("fd:changed", { detail: e.payload }));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // ───────── [4] 끌어다 놓기 받기 ─────────
  // 놓은 자리의 [data-drop] 이 대상 폴더다 (폴더 줄 · 목록 빈 곳 · 왼쪽 위치 · 다른 칸의 목록).
  // 즐겨찾기 머리([data-drop="fd:pin"])에 놓으면 옮기지 않고 즐겨찾기에 더한다.
  const hoverEl = useRef<HTMLElement | null>(null);
  /** 파일을 끄는 중 — far: 창 안 어딘가(독 입술이 손짓한다) · near: 아래 가장자리나 독 위(독을 연다). */
  const [dockDrag, setDockDrag] = useState<"far" | "near" | null>(null);
  const dockDragRef = useRef<"far" | "near" | null>(null);
  useEffect(() => {
    const peek = (v: "far" | "near" | null) => {
      if (dockDragRef.current === v) return;
      dockDragRef.current = v;
      setDockDrag(v);
    };
    const at = (x: number, y: number) => {
      const r = window.devicePixelRatio || 1;
      return (document.elementFromPoint(x / r, y / r) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]") ?? null;
    };
    const setHover = (el: HTMLElement | null) => {
      if (hoverEl.current === el) return;
      hoverEl.current?.classList.remove("drop-hover");
      el?.classList.add("drop-hover");
      hoverEl.current = el;
    };
    /** 끄는 중인 자리(창 안 물리 픽셀) — 놓을 자리를 밝히고, 독 가까이면 독을 연다. */
    const over = (x: number, y: number) => {
      setHover(at(x, y));
      // 열린 독 위에 있는 동안은 가장자리에서 멀어져도 닫지 않는다 — 선반 위쪽 줄에 놓으러 가는 길이다
      // 2026.11.13 : 칸 바닥 줄(.foot) 위도 연다 — 아래 가장자리 64px 만으로는 독 쪽으로 끌고 와도 열리지 않는다는 지적이 있었다
      //   (나눠 보기에서 위쪽 칸의 바닥 줄은 창 아래 가장자리에서 멀다)
      const r = window.devicePixelRatio || 1;
      const raw = document.elementFromPoint(x / r, y / r);
      peek(window.innerHeight - y / r < DOCK_REACH || !!raw?.closest(".dock, .foot") ? "near" : "far");
    };
    // 앱 안에서 시작한 끌기는 Rust 끌기 소스가 커서 자리를 바로 보낸다 (fd-shell drag 머리말).
    // 2026.11.13 : 그 끌기가 주 스레드를 붙잡은 동안 아래 Tauri 끌기 알림은 대기열에 묶여 놓은 뒤에야 닿았다 — 독이 열리지 않던 까닭.
    //   끌기가 끝나면(null) 묶여 있던 Tauri 알림이 한꺼번에 몰려온다. 그중 들어옴 · 끄는 중은 지난 자리라 무시하고(들어옴은 화면 좌표라
    //   독을 잠깐 닫을 수도 있다 — 그 사이 놓기가 독 아래 폴더 줄로 떨어지면 파일이 옮겨진다), 독과 밝힌 자리를 그대로 둔 채 놓기 · 떠남만 받는다.
    //   놓기 · 떠남이 끝내 오지 않으면(받는 쪽이 없음) 잠시 뒤 거둔다.
    let appDrag: "on" | "ending" | null = null;
    let endTimer = 0;
    const fromApp = (ev: Event) => {
      const d = (ev as CustomEvent<{ x: number; y: number } | null>).detail;
      window.clearTimeout(endTimer);
      if (d) {
        appDrag = "on";
        const r = window.devicePixelRatio || 1;
        // 창 밖(메일 · 탐색기로 끌어 가는 길)이면 독 · 밝힌 자리를 거둔다 — 창 아래로 나간 자리가 「독 가까이」로 셈해지지 않게
        if (d.x < 0 || d.y < 0 || d.x / r > window.innerWidth || d.y / r > window.innerHeight) {
          setHover(null);
          peek(null);
        } else over(d.x, d.y);
      } else {
        appDrag = "ending";
        endTimer = window.setTimeout(() => {
          appDrag = null;
          setHover(null);
          peek(null);
        }, 1500);
      }
    };
    window.addEventListener("fd:drag-at", fromApp);
    const un = getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (p.type === "over" || p.type === "enter") {
        if (!appDrag) over(p.position.x, p.position.y);
      } else if (p.type === "leave") {
        appDrag = null;
        window.clearTimeout(endTimer);
        setHover(null);
        peek(null);
      } else if (p.type === "drop") {
        // 앱 안 끌기면 놓을 자리는 끄는 동안 밝혀 둔 그 자리다 — 지금 화면에서 다시 찾으면 독이 접힌 사이일 수 있다
        const el = appDrag && hoverEl.current ? hoverEl.current : at(p.position.x, p.position.y);
        appDrag = null;
        window.clearTimeout(endTimer);
        setHover(null);
        peek(null);
        const dest = el?.dataset.drop;
        if (!dest || p.paths.length === 0) return;
        if (dest === APP_DROP) {
          // 실행 파일 · 바로가기만 — 그 밖의 파일은 「앱」이 아니다 (문서는 즐겨찾기 독으로)
          const ok = p.paths.filter((x) => /\.(exe|lnk|appref-ms|bat|cmd)$/i.test(x));
          if (ok.length) pinApps(ok.map((x) => ({ name: baseName(x).replace(/\.[^.]+$/, ""), id: x, icon: x })));
          if (ok.length < p.paths.length) setNotice({ text: "「앱」에는 실행 파일 · 바로가기만 놓을 수 있음", tone: "warn" });
          return;
        }
        if (dest === LINK_DROP) {
          api
            .dirsOf(p.paths)
            .then((dirs) => {
              const ds = p.paths.filter((_, i) => dirs[i]);
              if (ds.length) addLinks(ds);
              if (ds.length < p.paths.length) setNotice({ text: "「연결」에는 폴더만 놓을 수 있음", tone: "warn" });
            })
            .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
          return;
        }
        if (dest.startsWith(TAG_DROP)) {
          const c = dest.slice(TAG_DROP.length) as TagColor;
          Promise.all(p.paths.map((x) => api.setColor(x, c)))
            .then(() => {
              window.dispatchEvent(new CustomEvent("fd:colors"));
              setNotice({ text: `${p.paths.length}개에 ${TAG_LABEL[c]} 표시함`, tone: "ok" });
            })
            .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
          return;
        }
        if (dest === PIN_DROP || dest.startsWith(PIN_DROP + "@")) {
          const pos = dest === PIN_DROP ? undefined : Number(dest.slice(PIN_DROP.length + 1));
          api
            .dirsOf(p.paths)
            .then((dirs) => pinMany(p.paths.map((path, i) => ({ path, isDir: dirs[i] })), pos))
            .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
          return;
        }
        // 끌어 온 자리와 같은 폴더에 놓으면 아무것도 하지 않는다 — 셸이 「복사본」을 만들어 버린다.
        if (p.paths.every((x) => norm(x.slice(0, x.lastIndexOf("\\"))) === norm(dest))) return;
        api
          .dropFiles(p.paths, dest)
          .then((r) => r === "aborted" && setNotice({ text: "옮기기 · 복사 취소됨", tone: "warn" }))
          .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
      }
    });
    return () => {
      window.removeEventListener("fd:drag-at", fromApp);
      window.clearTimeout(endTimer);
      un.then((f) => f());
    };
  }, [pinMany, addLinks]);

  // ───────── [5] 단축키 ─────────
  // 탭 · 전역 단축키 (Ctrl+T · Ctrl+W · Ctrl+Tab · Ctrl+1~9 · Ctrl+H 숨김 보기 · Ctrl+\ 나눠 보기) · 마우스 뒤로/앞으로 단추.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") {
        e.preventDefault();
        openTab(active.path);
      } else if (k === "w") {
        e.preventDefault();
        closeTab(active.id);
      } else if (e.key === "Tab") {
        // 지금 칸의 탭 줄 안에서 돈다
        e.preventDefault();
        const ids = fgLeaf.ids;
        const i = ids.indexOf(active.id);
        showTab(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const ids = fgLeaf.ids;
        const id = e.key === "9" ? ids[ids.length - 1] : ids[Number(e.key) - 1];
        if (id != null) showTab(id);
      } else if (k === "h") {
        // 앱 안 보기의 편집기가 Ctrl+H(바꾸기)로 받았으면 숨김 파일을 바꾸지 않는다 (editorFind.ts)
        if (e.defaultPrevented) return;
        e.preventDefault();
        setShowHidden((v) => !v);
      } else if (e.key === "\\") {
        e.preventDefault();
        toggleSplit();
      }
    };
    // 명령 팔레트 · 설정은 글 칸(찾기 · 주소)에 초점이 있어도 열린다 — 글 칸이 키를 붙잡아(stopPropagation) 위 처리기까지 오지 않으므로 잡는 단계에서 받는다
    const onKeyFirst = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        setSettingsOpen((v) => !v);
      } else if (k === "k" || (k === "p" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteApps(false);
        setPaletteOpen((v) => !v);
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) navigate(active.id, "", "back");
      if (e.button === 4) navigate(active.id, "", "fwd");
    };
    window.addEventListener("keydown", onKeyFirst, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKeyFirst, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [fgLeaf, active, openTab, closeTab, navigate, showTab, toggleSplit]);

  // ───────── [6] 명령 팔레트 ─────────

  /** 팔레트의 앱 줄 — Enter 로 열고 Shift+Enter 로 왼쪽 열에 고정한다. pinOnly(「＋」로 연 팔레트)면 Enter 가 고정이다. */
  const appItems = (pinOnly: boolean): PaletteItem[] => {
    const pinnedIds = new Set(pinnedApps.map((a) => a.id.toLowerCase()));
    return apps.map((a) => {
      const pin = () => pinApps([{ name: a.name, id: a.id, icon: a.icon }]);
      const pinned = pinnedIds.has(a.id.toLowerCase());
      return {
        id: `app:${a.id}`,
        group: "앱" as const,
        label: a.name,
        hint: pinned ? "고정됨" : undefined,
        icon: appIconUrl(a.icon, 16),
        run: pinOnly ? pin : () => launchApp(a.id),
        alt: pinOnly || pinned ? undefined : { label: "사이드바에 고정", run: pin },
      };
    });
  };

  const paletteItems = (): PaletteItem[] => {
    const go = (path: string) => () => navigate(active.id, path);
    const placesItems: PaletteItem[] = [
      ...pinned.map((p) => ({
        id: `pin:${p.path}`,
        group: "위치" as const,
        label: p.name,
        hint: `즐겨찾기 · ${p.path}`,
        run: p.file ? () => api.openItem(p.path).catch(() => {}) : go(p.path),
      })),
      ...(places?.known ?? []).map((k) => ({ id: `k:${k.path}`, group: "위치" as const, label: k.name, hint: k.path, run: go(k.path) })),
      ...(places?.drives ?? []).map((d) => ({ id: `d:${d.path}`, group: "위치" as const, label: `${d.label} (${d.path.slice(0, 2)})`, hint: "드라이브", run: go(d.path) })),
    ];
    const cmd = (id: string, label: string, run: () => void, hint?: string): PaletteItem => ({ id: `c:${id}`, group: "명령", label, hint, run });
    const smartItems: PaletteItem[] = smart.map((f) => ({ id: `smart:${f.id}`, group: "스마트 폴더", label: f.name, hint: `${f.q} · ${scopeLabel(f.scope)}`, run: () => openSmart(f) }));
    return [
      ...placesItems,
      ...smartItems,
      cmd("smart:new", "새 스마트 폴더", () => setSmartEdit({ folder: { id: newSmartId(), name: "", q: "", scope: { kind: "all" } }, isNew: true })),
      cmd("tab", "새 탭", () => openTab(active.path), "Ctrl+T"),
      cmd("split", split ? "나눠 보기 끄기" : "오른쪽으로 나눠 보기", toggleSplit, "Ctrl+\\"),
      cmd("hidden", showHidden ? "숨김 파일 감추기" : "숨김 파일 보이기", () => setShowHidden((v) => !v), "Ctrl+H"),
      cmd("settings", "설정", () => setSettingsOpen(true), "Ctrl+,"),
      ...STEPS.map((l, i) => cmd(`step:${i}`, `보기: ${l}`, () => zoomPane(fg, () => i))),
      cmd("theme:system", "화면 색: 시스템", () => setTheme("system")),
      cmd("theme:light", "화면 색: 밝게", () => setTheme("light")),
      cmd("theme:dark", "화면 색: 어둡게", () => setTheme("dark")),
    ];
  };
  const searchInPane = useCallback((q: string, scope: FindScope) => window.dispatchEvent(new CustomEvent("fd:search", { detail: { q, scope } })), []);

  // ───────── [7] 그리기 ─────────

  /** 즐겨찾기의 파일을 연다 (왼쪽 열 · 독). 폴더 바로가기면 그 폴더로 간다. */
  const openPinnedFile = (p: string) => api.openItem(p).then((to) => to && navigate(active.id, to)).catch((e) => setNotice({ text: errText(e), tone: "warn" }));

  const dropTo = drag?.on ? drag.to : null;
  const dragTip = `\n칸 가장자리로 끌어 나눠 보기 (최대 ${MAX_PANES}칸) · 창 밖으로 끌어 새 창`;

  /** 칸 하나의 탭 줄. 위 가장자리에 닿은 칸은 제목 줄에서 제 칸 너비만큼(`style`) 차지해 제 칸 바로 위에 서고,
   *  아래쪽 칸은 제 칸 맨 위에 선다(`inPane`). */
  const strip = (leaf: Leaf, style?: CSSProperties, inPane = false) => {
    const g = leaf.key;
    const endHere = dropTo?.kind === "strip" && dropTo.g === g && dropTo.at === leaf.ids.length;
    return (
      <div
        key={`strip-${g}`}
        className={"tabs" + (style && !inPane ? " fixed" : "") + (inPane ? " in-pane" : "") + (split ? (g === fg ? " focused" : " dim") : "") + (endHere ? " drop-end" : "")}
        role="tablist"
        aria-label={split ? "칸 탭" : "탭"}
        data-tab-strip={g}
        data-tauri-drag-region={split && !inPane ? "" : undefined}
        style={style}
        onMouseDown={inPane ? () => g !== fg && setFocus(g) : undefined}
      >
        {leaf.ids.map((id, i) => {
          const t = tabs.find((x) => x.id === id);
          if (!t) return null;
          const cur = leaf.cur === id;
          return (
            <div
              key={id}
              role="tab"
              data-tab-id={id}
              data-tab-group={g}
              data-tab-index={i}
              aria-selected={cur}
              className={
                "tab" +
                (cur ? (g === fg ? " active" : " cur") : "") +
                (drag?.on && drag.id === id ? " dragging" : "") +
                (dropTo?.kind === "strip" && dropTo.g === g && dropTo.at === i ? " drop-before" : "")
              }
              title={(tabTitles.get(id) ? `${tabTitles.get(id)}
` : "") + t.path + dragTip}
              onContextMenu={(e) => {
                e.preventDefault();
                const others = leaf.ids.filter((x) => x !== id);
                setTabMenu({
                  x: e.clientX,
                  y: e.clientY,
                  label: baseName(t.path),
                  items: [
                    { label: "새 탭", hint: "Ctrl+T", run: () => openTab(t.path, true, g) },
                    { label: "새 창으로 열기", disabled: tabs.length < 2, run: () => detachRef.current(id, e.screenX + 40, e.screenY + 40) },
                    { label: "경로 복사", run: () => void navigator.clipboard.writeText(t.path).then(() => setNotice({ text: "경로 복사함", tone: "ok" })) },
                    "sep",
                    { label: "탭 닫기", hint: "Ctrl+W", disabled: tabs.length < 2, run: () => closeTab(id) },
                    { label: "다른 탭 닫기", disabled: others.length === 0, run: () => others.forEach((x) => closeTab(x)) },
                  ],
                });
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(id);
                } else if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
                  showTab(id);
                  setDrag({ id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, to: null, sx: e.screenX, sy: e.screenY, out: false });
                }
              }}
            >
              <span className="tab-name">{tabTitles.get(id) ?? baseName(t.path)}</span>
              {tabs.length > 1 && (
                <button className="tab-close" aria-label="탭 닫기" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTab(id)}>
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button className="tab-add" aria-label="새 탭" title="새 탭 (Ctrl+T)" onClick={() => openTab(pathOf(leaf.cur), true, g)}>
          +
        </button>
      </div>
    );
  };

  // 제목 줄 — 위 가장자리에 닿은 칸들의 탭 줄을 왼쪽부터. 사이 5px 은 칸 사이 줄의 연장이라 끌면 그 줄을 끈다.
  // 맨 오른쪽 위 칸의 탭 줄만 남은 자리를 다 쓰고(뒤에 창 끌기 자리 · 창 단추), 나머지는 제 칸 너비로 고정한다.
  // 그 칸이 좁아 탭 줄을 제 칸 안으로 내렸으면(inPane) 제목 줄의 남은 자리는 창 끌기 자리가 된다.
  const topLeaves = laid.leaves.filter((x) => atTop(x.r)).sort((a, b) => a.r.x0.f - b.r.x0.f || a.r.x0.p - b.r.x0.p);
  const titleLeaves = topLeaves.filter((x) => !inPane.has(x.leaf.key));
  const titleStrips = titleLeaves.flatMap((x, i) => {
    const rightmost = x === topLeaves[topLeaves.length - 1];
    const out = [strip(x.leaf, rightmost ? undefined : { flexBasis: calc(minus(x.r.x1, x.r.x0)) })];
    if (i < titleLeaves.length - 1) {
      const bar = laid.bars.find((b) => b.dir === "row" && atTop(b.r) && same(b.r.x0, x.r.x1));
      out.push(
        <div
          key={`gap-${x.leaf.key}`}
          className={"tabs-gap" + (bar && pulling === bar.path ? " pulling" : "") + (bar && hotBar === bar.path ? " hot" : "")}
          aria-hidden="true"
          onMouseEnter={() => bar && setHotBar(bar.path)}
          onMouseLeave={() => setHotBar(null)}
          onMouseDown={bar && startDivider(bar)}
          onDoubleClick={bar && evenDivider(bar)}
        />,
      );
    }
    return out;
  });

  const leafOfTab = (id: number) => laid.leaves.find((x) => x.leaf.ids.includes(id));

  // 놓을 자리 덮개 — 끄는 동안 한 장을 계속 두고 자리만 바꾼다 (자리 사이를 미끄러져 옮겨 간다).
  // 가장자리면 놓은 뒤의 배치에서 그 탭이 앉을 칸 자리 — 탭 하나짜리 칸이 접혀 옆 칸이 커진 뒤 나뉘는 것까지 그대로 보인다.
  const dropBox = (() => {
    if (!drag || !dropTo || dropTo.kind === "strip") return null;
    if (dropTo.kind === "pane") {
      const x = laid.leaves.find((l) => l.leaf.key === dropTo.g);
      return x ? inset(paneRect(x)) : null;
    }
    const x = lay(moveTab(root, drag.id, dropTo)).leaves.find((l) => l.leaf.ids.includes(drag.id));
    return x ? inset(atTop(x.r) ? x.r : { ...x.r, y0: plus(x.r.y0, len(0, STRIP_H)) }) : null;
  })();
  const dropEdge = dropTo?.kind === "edge" ? dropTo.edge : undefined;
  const dropLabel = dropEdge ? EDGE_LABEL[dropEdge] : "이 칸으로 옮기기";

  return (
    <div className={"app" + (drag?.on ? " tab-dragging" : "")} style={{ "--side-w": `${sideW}px` } as CSSProperties}>
      <TitleBar
        onPalette={() => {
          setPaletteApps(false);
          setPaletteOpen(true);
        }}
      >
        {titleStrips}
      </TitleBar>
      <div className="body">
        <Sidebar
          places={places}
          links={links}
          onAddLinks={addLinks}
          onUnlink={unlink}
          onRenameLinks={renameLinks}
          view={view}
          current={active.path}
          onGo={(p) => navigate(active.id, p)}
          onGoNewTab={(p) => openTab(p)}
          settingsOpen={settingsOpen}
          onSettings={() => setSettingsOpen((v) => !v)}
          smart={smart}
          inbox={inbox}
          onOpenSmart={openSmart}
          onEditSmart={(f) => setSmartEdit({ folder: f, isNew: false })}
          onNewSmart={() => setSmartEdit({ folder: { id: newSmartId(), name: "", q: "", scope: { kind: "all" } }, isNew: true })}
          pinned={pinned}
          onPinHere={() => pinMany([{ path: active.path, isDir: true }])}
          onUnpin={unpin}
          onOpenFile={openPinnedFile}
          onMovePin={movePin}
          onDupSmart={dupSmart}
          onDeleteSmart={deleteSmart}
          onNotice={(text, tone) => setNotice({ text, tone })}
          apps={pinnedApps}
          onLaunchApp={launchApp}
          onUnpinApp={unpinApp}
          onAddApp={() => {
            setPaletteApps(true);
            setPaletteOpen(true);
          }}
        />
        <div
          className="side-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="사이드바 너비"
          title="너비 조절 · 두 번 눌러 처음대로"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const x0 = e.clientX;
            const w0 = sideW;
            document.body.classList.add("resizing-x");
            const move = (ev: MouseEvent) => setSideW(clampSide(w0 + ev.clientX - x0));
            const up = () => {
              document.body.classList.remove("resizing-x");
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
          onDoubleClick={() => setSideW(SIDE_W)}
        />
        <div ref={panesRef} className={"panes" + (split ? " split" : "")}>
          {loaded &&
            tabs.map((t) => {
              const at = leafOfTab(t.id);
              const key = at?.leaf.key ?? fg;
              return (
                <Pane
                  key={t.id}
                  tab={t}
                  visible={at?.leaf.cur === t.id}
                  box={split && at ? boxOf(paneRect(at)) : null}
                  active={t.id === active.id}
                  onFocusPane={() => key !== fg && setFocus(key)}
                  showHidden={showHidden}
                  cols={cols}
                  setCols={setCols}
                  view={at?.leaf.step == null ? view : atStep(view, at.leaf.step)}
                  setView={setView}
                  zoom={(f) => zoomPane(key, f)}
                  split={split}
                  onOpenBeside={openBeside}
                  onToggleSplit={toggleSplit}
                  onPin={pinMany}
                  notice={t.id === active.id ? notice : null}
                  clearNotice={() => setNotice(null)}
                  onGo={(p) => navigate(t.id, p)}
                  onBack={() => navigate(t.id, "", "back")}
                  onFwd={() => navigate(t.id, "", "fwd")}
                  onOpenTab={(p) => openTab(p, false, key)}
                  onTitle={(x) => setTabTitle(t.id, x)}
                />
              );
            })}
          {laid.leaves.filter((x) => inPane.has(x.leaf.key)).map((x) => strip(x.leaf, boxOf({ ...x.r, y1: plus(x.r.y0, len(0, STRIP_H)) }), true))}
          {laid.bars.map((b) => (
            <div
              key={`bar-${b.path}`}
              className={"divider" + (b.dir === "col" ? " across" : "") + (pulling === b.path ? " pulling" : "") + (hotBar === b.path ? " hot" : "")}
              role="separator"
              aria-orientation={b.dir === "row" ? "vertical" : "horizontal"}
              aria-label={b.dir === "row" ? "칸 너비" : "칸 높이"}
              style={boxOf(b.r)}
              onMouseDown={startDivider(b)}
              onDoubleClick={evenDivider(b)}
              onMouseEnter={() => setHotBar(b.path)}
              onMouseLeave={() => setHotBar(null)}
            />
          ))}
          {dropBox && (
            <div className={"split-drop" + (dropEdge ? ` edge-${dropEdge}` : " whole")} style={boxOf(dropBox)} aria-hidden="true">
              <span>{dropLabel}</span>
            </div>
          )}
        </div>
        <FavDock
          zone={dockZone}
          pinned={pinned}
          current={active.path}
          drag={dockDrag}
          view={view}
          flash={pinFlash}
          onUnpin={unpin}
          onMovePin={movePin}
          onGo={(p) => navigate(active.id, p)}
          onGoNewTab={(p) => openTab(p)}
          onOpenFile={openPinnedFile}
        />
      </div>
      {paletteOpen && <Palette items={paletteApps ? appItems(true) : [...paletteItems(), ...appItems(false)]} pinApps={paletteApps} onSearch={searchInPane} onClose={() => setPaletteOpen(false)} />}
      {smartEdit && (
        <SmartEditor
          key={smartEdit.folder.id}
          folder={smartEdit.folder}
          isNew={smartEdit.isNew}
          inbox={inbox}
          current={active.path}
          kinds={view.kinds}
          showHidden={showHidden}
          onSave={saveSmart}
          onDelete={deleteSmart}
          onClose={() => setSmartEdit(null)}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          current={active.path}
          view={view}
          setView={setView}
          zoomAll={zoomAll}
          showHidden={showHidden}
          setShowHidden={setShowHidden}
          theme={theme}
          setTheme={setTheme}
          resetCols={() => setCols(DEFAULT_COLS)}
          start={start}
          setStart={setStart}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {tabMenu && <ContextMenu menu={tabMenu} onClose={() => setTabMenu(null)} />}
      {drag?.on && (
        <div className={"tab-ghost" + (drag.out ? " out" : "")} style={{ left: Math.min(drag.x, window.innerWidth - 180) + 12, top: Math.min(drag.y, window.innerHeight - 40) + 8 }} aria-hidden="true">
          {baseName(tabs.find((t) => t.id === drag.id)?.path ?? "")}
          {drag.out && <em>{tabs.length > 1 ? "새 창으로 열기" : "마지막 탭"}</em>}
        </div>
      )}
    </div>
  );
}
