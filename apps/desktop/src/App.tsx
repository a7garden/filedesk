// 앱 틀 — 제목 줄(탭 · 창 단추 · 새 판 알림) · 왼쪽 위치 목록 · 나눠 보기 · 끌어다 놓기 받기 · 폴더 변경 알림 · 설정 저장.
//
// 목차
//   [1] 설정 읽기 · 저장 (즐겨찾기 · 탭 · 나눠 보기 · 열 너비 · 화면 색)
//   [2] 탭 · 나눠 보기 — 칸마다 탭 묶음(Group)을 하나씩 갖는다. 키보드는 「지금 칸」(focus) 이 받는다
//       2026.11.11 : 나눠 보기를 더했다. 두 폴더를 나란히 놓고 파일을 끌어 옮기는 일이 탭을 오가는 것보다 잦다
//       2026.11.11 : 칸마다 탭 하나 → 탭 묶음. 나눠 보면 제목 줄의 탭 줄도 칸 너비대로 갈라져 제 칸 위에 붙는다 —
//                    탭 줄 하나에 두 칸의 탭이 섞여 있으면 어느 탭이 어느 칸 것인지 표시를 읽어야 했다
//   [3] 탭 끌기 — 탭을 같은 줄 · 다른 칸 탭 줄의 탭 사이로 끌면 그 자리로, 칸 목록 위에 놓으면 그 칸 끝으로 옮긴다.
//       안 나눴을 때 목록 오른쪽 반에 놓으면 나눠서 오른쪽 칸으로. 칸의 마지막 탭이 빠지면 그 칸은 접힌다
//       Tauri 가 창으로 들어오는 파일 끌기를 받으려고 웹 끌기(HTML5 DnD)를 막아 두어, 마우스 움직임으로 직접 짠다
//   [4] 끌어다 놓기 받기 (앱 밖 · 다른 칸에서 끈 파일) · 즐겨찾기에 놓기
//   [5] 단축키 (Ctrl+T · W · Tab · 1~9 · H · \ · K 명령 팔레트)
//   [6] 명령 팔레트 — 자리 · 명령 목록을 세운다
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, DEFAULT_VIEW, type Place, type Places, type Settings, type Theme, type ViewPrefs } from "./api";
import Palette, { type PaletteItem } from "./Palette";
import Pane from "./Pane";
import { atStep, STEPS } from "./SizeLadder";
import SettingsPanel from "./SettingsPanel";
import Sidebar from "./Sidebar";
import TitleBar from "./TitleBar";
import { useAutoUpdate } from "./updater";
import { applyTheme, baseName, DEFAULT_COLS, DEFAULT_KINDS, errText, type KindDef, norm, setIconPack, setKinds } from "./util";

export type Tab = { id: number; path: string; back: string[]; fwd: string[] };

let nextId = 1;
const newTab = (path: string): Tab => ({ id: nextId++, path, back: [], fwd: [] });

const START = "C:\\";


/** 처음 쓸 때 즐겨찾기 — 비워 둔다. Ctrl+D 로 지금 폴더(또는 고른 항목)를 더하면 설정에 저장된다.
 *  2026.11.11 : 이 PC 의 과업 경로를 기본값으로 두던 것을 뺐다 (공개 저장소). */
const DEFAULT_PINNED: Place[] = [];

/** 즐겨찾기에 놓는 자리의 표시 — 파일을 옮기지 않고 즐겨찾기에 더한다. */
export const PIN_DROP = "fd:pin";

/** 나눠 보기에서 한 칸이 가질 수 있는 가장 좁은 비율. */
const MIN_RATIO = 0.2;

function withDefaults(s: Partial<Settings> | null): Settings {
  const split =
    s?.split && typeof s.split.right === "number"
      ? { right: s.split.right, ratio: clampRatio(s.split.ratio), ...(typeof s.split.from === "number" ? { from: s.split.from } : {}) }
      : null;
  return {
    pinned: s?.pinned ?? DEFAULT_PINNED,
    session: s?.session ?? { tabs: [], active: 0 },
    cols: s?.cols?.length === DEFAULT_COLS.length ? s.cols : DEFAULT_COLS,
    showHidden: s?.showHidden ?? false,
    theme: s?.theme === "light" || s?.theme === "dark" ? s.theme : "system",
    split,
    view: {
      ...DEFAULT_VIEW,
      ...(s?.view ?? {}),
      size: Math.min(3, Math.max(0, Number(s?.view?.size ?? DEFAULT_VIEW.size) || 0)),
      hiddenCols: Array.isArray(s?.view?.hiddenCols) ? s.view.hiddenCols : [],
      dense: s?.view?.dense === true,
      icons: s?.view?.icons === "filedesk" || s?.view?.icons === "pack" ? s.view.icons : "shell",
      iconPack: typeof s?.view?.iconPack === "string" ? s.view.iconPack : "",
      kinds: validKinds(s?.view?.kinds),
    },
  };
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

/** 칸 하나의 탭 묶음 — 탭 순서와 지금 보이는 탭. 비지 않는다 (마지막 탭이 빠지면 칸째 없앤다). */
type Group = { ids: number[]; cur: number };

/** 놓을 자리 — `g` 칸 탭 줄의 `at` 번째 앞. `g` 가 칸 수와 같으면 새 칸(오른쪽)을 연다.
 *  `pane` 은 탭 줄이 아니라 목록 위에 놓는다는 뜻 — 칸 덮개를 보인다. */
type Slot = { g: number; at: number; pane: boolean };

/** 탭 끌기 상태. */
type TabDrag = { id: number; x0: number; y0: number; on: boolean; x: number; y: number; to: Slot | null };

/** 묶음에서 탭 하나를 뺀다. 보이던 탭이면 그 왼쪽(맨 앞이면 오른쪽) 탭을 보인다. */
function leave(g: Group, id: number): Group {
  const i = g.ids.indexOf(id);
  const ids = g.ids.filter((x) => x !== id);
  return { ids, cur: g.cur !== id ? g.cur : (ids[Math.max(0, i - 1)] ?? -1) };
}

/** 탭을 `to` 자리로 옮긴다. 빈 칸은 접는다 — 왼쪽 칸이 비면 오른쪽 칸이 혼자 남아 왼쪽이 된다. */
function moveTab(gs: Group[], id: number, to: Slot): Group[] {
  const from = gs.findIndex((g) => g.ids.includes(id));
  if (from < 0) return gs;
  let at = to.at;
  if (from === to.g && gs[from].ids.indexOf(id) < at) at--; // 같은 줄에서 뒤로 옮기면 빠진 자리만큼 당긴다
  const out = gs.map((g, k) => (k === from ? leave(g, id) : g));
  if (to.g >= out.length) out.push({ ids: [id], cur: id });
  else {
    const ids = [...out[to.g].ids];
    ids.splice(Math.max(0, Math.min(at, ids.length)), 0, id);
    out[to.g] = { ids, cur: id };
  }
  return out.filter((g) => g.ids.length > 0);
}

/** 놓아도 바뀌는 것이 없는 자리인지 — 덮개 · 끼울 자리 표시를 내지 않는다. */
function noop(gs: Group[], id: number, to: Slot): boolean {
  const from = gs.findIndex((g) => g.ids.includes(id));
  if (to.g >= gs.length) return gs[from].ids.length === 1; // 하나뿐인 탭을 새 칸으로 — 원래 칸이 비어 그대로다
  if (from !== to.g) return false;
  if (to.pane) return true; // 제 칸 목록 위
  const i = gs[from].ids.indexOf(id);
  return to.at === i || to.at === i + 1;
}

export default function App() {
  const [places, setPlaces] = useState<Places | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(START)]);
  /** 칸마다 탭 묶음. [왼쪽] 이면 안 나눴고, [왼쪽, 오른쪽] 이면 나눴다. */
  const [groups, setGroups] = useState<Group[]>(() => [{ ids: [tabs[0].id], cur: tabs[0].id }]);
  /** 키보드를 받는 칸. 칸이 접혀 없어진 번호면 남은 칸으로 읽는다 (`fg`). */
  const [focus, setFocus] = useState<0 | 1>(0);
  const [ratio, setRatio] = useState(0.5);
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<Place[]>([]);
  const [cols, setCols] = useState<number[]>(DEFAULT_COLS);
  const [theme, setTheme] = useState<Theme>("system");
  const [loaded, setLoaded] = useState(false);
  /** 알림 한 줄 — 지금 칸 위에 뜬다. 해낸 일은 ok, 실패 · 취소는 warn. */
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [drag, setDrag] = useState<TabDrag | null>(null);
  const [view, setView] = useState<ViewPrefs>(DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  useAutoUpdate();

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

  const split = groups.length > 1;
  const fg = (split ? focus : 0) as 0 | 1;
  const activeId = groups[fg].cur;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const groupOf = (id: number) => Math.max(0, groups.findIndex((g) => g.ids.includes(id))) as 0 | 1;
  const pathOf = (id: number) => tabs.find((t) => t.id === id)?.path ?? active.path;

  // ───────── [1] 설정 ─────────

  // 지난번에 열어 둔 탭으로 연다. 처음이면 다운로드 — 들어온 파일을 정리하는 일이 가장 잦다.
  useEffect(() => {
    Promise.all([api.places(), api.loadSettings().catch(() => null)]).then(([p, raw]) => {
      setPlaces(p);
      const s = withDefaults(raw);
      setPinned(s.pinned);
      setCols(s.cols);
      setShowHidden(s.showHidden);
      setTheme(s.theme);
      setView(s.view);
      const dl = p.known.find((k) => k.name === "다운로드")?.path ?? START;
      const restored = s.session.tabs.length ? s.session.tabs.map(newTab) : [newTab(dl)];
      setTabs(restored);
      const ids = restored.map((t) => t.id);
      const left = ids[Math.min(s.session.active, ids.length - 1)];
      const right = s.split ? ids[s.split.right] : undefined;
      // 오른쪽 칸 탭 — `from` 부터 끝까지. 지난 판 설정(`from` 없음)은 `right` 탭 하나.
      const rightIds = right == null || right === left ? [] : s.split?.from != null ? ids.slice(s.split.from) : [right];
      const leftIds = ids.filter((x) => !rightIds.includes(x));
      const pick = (xs: number[], want: number | undefined) => (want != null && xs.includes(want) ? want : xs[0]);
      setGroups(
        leftIds.length && rightIds.length
          ? [
              { ids: leftIds, cur: pick(leftIds, left) },
              { ids: rightIds, cur: pick(rightIds, right) },
            ]
          : [{ ids, cur: left }],
      );
      if (s.split) setRatio(s.split.ratio);
      setLoaded(true);
    });
  }, []);

  // 설정 저장 — 바뀐 뒤 잠깐 기다렸다가 한 번에 (열 너비 · 칸 너비를 끄는 동안 수십 번 쓰지 않게).
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => {
      // 왼쪽 칸 탭 다음에 오른쪽 칸 탭을 잇는다 — 오른쪽은 `from` 번째부터.
      const order = groups.flatMap((g) => g.ids);
      const idx = (id: number) => Math.max(0, order.indexOf(id));
      api
        .saveSettings({
          pinned,
          cols,
          showHidden,
          theme,
          session: { tabs: order.map((id) => tabs.find((x) => x.id === id)?.path ?? START), active: idx(groups[0].cur) },
          split: groups[1] ? { right: idx(groups[1].cur), ratio, from: groups[0].ids.length } : null,
          view,
        })
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [loaded, tabs, groups, ratio, pinned, cols, showHidden, theme, view]);

  useEffect(() => {
    if (loaded) applyTheme(theme);
  }, [loaded, theme]);

  /** 즐겨찾기에 더한다. 이미 있으면 그대로. */
  const pinMany = useCallback((items: { path: string; isDir: boolean }[]) => {
    if (!items.length) return;
    setPinned((ps) => {
      const have = new Set(ps.map((x) => norm(x.path)));
      const add = items.filter((i) => !have.has(norm(i.path))).map((i) => ({ name: baseName(i.path), path: i.path, ...(i.isDir ? {} : { file: true }) }));
      return add.length ? [...ps, ...add] : ps;
    });
    setNotice({ text: items.length === 1 ? `「${baseName(items[0].path)}」을 즐겨찾기에 더했다` : `${items.length}개를 즐겨찾기에 더했다`, tone: "ok" });
  }, []);
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

  // ───────── [2] 탭 · 나눠 보기 ─────────

  /** 탭을 제 칸에 보이고, 그 칸으로 초점을 옮긴다. */
  const showTab = useCallback(
    (id: number) => {
      const g = groups.findIndex((x) => x.ids.includes(id));
      if (g < 0) return;
      setGroups((gs) => gs.map((x) => (x.ids.includes(id) ? { ...x, cur: id } : x)));
      setFocus(g as 0 | 1);
    },
    [groups],
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

  /** 새 탭을 `g` 칸 탭 줄 끝에 연다 (기본은 지금 칸). `show` 가 거짓이면 뒤에 열어 두기만 한다 (「새 탭에서 열기」). */
  const openTab = useCallback(
    (path: string, show = true, g: number = fg) => {
      const t = newTab(path);
      setTabs((ts) => [...ts, t]);
      setGroups((gs) => {
        const k = Math.min(g, gs.length - 1);
        return gs.map((x, i) => (i === k ? { ids: [...x.ids, t.id], cur: show ? t.id : x.cur } : x));
      });
      if (show) setFocus(Math.min(g, groups.length - 1) as 0 | 1);
    },
    [fg, groups.length],
  );

  /** 탭을 닫는다. 마지막 하나는 닫지 않는다. 칸의 마지막 탭이면 그 칸이 접힌다. */
  const closeTab = useCallback(
    (id: number) => {
      if (tabs.length === 1) return;
      setTabs((ts) => ts.filter((t) => t.id !== id));
      setGroups((gs) => gs.map((g) => (g.ids.includes(id) ? leave(g, id) : g)).filter((g) => g.ids.length > 0));
    },
    [tabs.length],
  );

  /** 나눠 보기 켜기 · 끄기 (Ctrl+\).
   *  켤 때: 지금 칸에 탭이 둘 이상이면 지금 탭 옆 탭을 오른쪽 칸으로 옮기고, 하나뿐이면 지금 폴더를 새 탭으로 연다
   *  (켜고 끌 때마다 탭이 늘지 않게). 끌 때: 오른쪽 칸 탭을 왼쪽 탭 줄 뒤에 붙이고, 지금 탭을 보인다. */
  const toggleSplit = useCallback(() => {
    if (groups.length > 1) {
      setGroups([{ ids: groups.flatMap((g) => g.ids), cur: activeId }]);
      setFocus(0);
      return;
    }
    const g = groups[0];
    const i = g.ids.indexOf(g.cur);
    const other = g.ids[i + 1] ?? g.ids[i - 1];
    if (other != null) setGroups((gs) => moveTab(gs, other, { g: 1, at: 0, pane: true }));
    else {
      const t = newTab(active.path);
      setTabs((ts) => [...ts, t]);
      setGroups((gs) => [gs[0], { ids: [t.id], cur: t.id }]);
    }
    setFocus(1);
  }, [groups, activeId, active.path]);

  /** 경로를 옆 칸에서 새 탭으로 연다 (오른쪽 메뉴 「옆 칸에서 열기」). 안 나눴으면 나눈다.
   *  2026.11.11 : 옆 칸의 지금 탭을 그 폴더로 옮기던 것을 새 탭으로 바꿨다 — 칸마다 탭 줄이 생겨 옆 칸 자리를 날릴 까닭이 없다. */
  const openBeside = useCallback(
    (path: string) => {
      const t = newTab(path);
      setTabs((ts) => [...ts, t]);
      if (groups.length > 1) {
        const other = (1 - fg) as 0 | 1;
        setGroups((gs) => gs.map((x, i) => (i === other ? { ids: [...x.ids, t.id], cur: t.id } : x)));
        setFocus(other);
      } else {
        setGroups((gs) => [gs[0], { ids: [t.id], cur: t.id }]);
        setFocus(1);
      }
    },
    [groups.length, fg],
  );

  /** 탭을 끌어 놓은 자리로 옮긴다. 옮긴 탭을 그 칸에 보이고 그 칸으로 초점을 옮긴다. */
  const placeTab = useCallback(
    (id: number, to: Slot) => {
      const out = moveTab(groups, id, to);
      setGroups(out);
      setFocus(Math.max(0, out.findIndex((g) => g.ids.includes(id))) as 0 | 1);
    },
    [groups],
  );

  const startDivider = (ev: React.MouseEvent) => {
    ev.preventDefault();
    const box = panesRef.current?.getBoundingClientRect();
    if (!box) return;
    document.body.classList.add("resizing");
    const move = (m: MouseEvent) => setRatio(clampRatio((m.clientX - box.left) / box.width));
    const up = () => {
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ───────── [3] 탭 끌기 ─────────

  // 놓을 때 읽을 끌기 상태 — 상태 갱신 함수 안에서 옮기면 StrictMode 가 두 번 불러 두 번 옮긴다.
  const dragRef = useRef<TabDrag | null>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const where = (id: number, x: number, y: number): Slot | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      let to: Slot | null = null;
      const tabEl = el?.closest<HTMLElement>("[data-tab-id]");
      const strip = el?.closest<HTMLElement>("[data-tab-strip]");
      const box = panesRef.current?.getBoundingClientRect();
      if (tabEl) {
        // 탭 왼쪽 반이면 그 앞, 오른쪽 반이면 그 뒤
        const r = tabEl.getBoundingClientRect();
        const i = Number(tabEl.dataset.tabIndex);
        to = { g: Number(tabEl.dataset.tabGroup), at: x < r.left + r.width / 2 ? i : i + 1, pane: false };
      } else if (strip) {
        to = { g: Number(strip.dataset.tabStrip), at: groups[Number(strip.dataset.tabStrip)]?.ids.length ?? 0, pane: false };
      } else if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
        const right = x >= box.left + box.width * (split ? ratio : 0.5);
        // 안 나눴을 때는 오른쪽 반만 받는다 (나눠서 오른쪽 칸으로). 왼쪽 반은 제 칸이라 바뀌는 것이 없다.
        to = split ? { g: right ? 1 : 0, at: groups[right ? 1 : 0].ids.length, pane: true } : right ? { g: 1, at: 0, pane: true } : null;
      }
      return to && !noop(groups, id, to) ? to : null;
    };
    const move = (m: MouseEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const on = d.on || Math.hypot(m.clientX - d.x0, m.clientY - d.y0) > 6;
        return { ...d, on, x: m.clientX, y: m.clientY, to: on ? where(d.id, m.clientX, m.clientY) : null };
      });
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.on && d.to) placeTab(d.id, d.to);
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // drag 가 생기고 없어질 때만 다시 건다 — 움직일 때마다 다시 걸면 끄는 동안 이벤트를 놓친다.
    // 끄는 동안 칸 · 탭 묶음은 바뀌지 않으므로 그때의 groups · ratio 로 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag != null, placeTab]);

  // 열린 탭들의 폴더를 감시한다.
  const watched = tabs.map((t) => t.path).join("|");
  useEffect(() => {
    api.watchDirs([...new Set(tabs.map((t) => t.path))]).catch(() => {});
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
  useEffect(() => {
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
    const un = getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (p.type === "over") setHover(at(p.position.x, p.position.y));
      else if (p.type === "leave") setHover(null);
      else if (p.type === "drop") {
        const el = at(p.position.x, p.position.y);
        setHover(null);
        const dest = el?.dataset.drop;
        if (!dest || p.paths.length === 0) return;
        if (dest === PIN_DROP) {
          api
            .dirsOf(p.paths)
            .then((dirs) => pinMany(p.paths.map((path, i) => ({ path, isDir: dirs[i] }))))
            .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
          return;
        }
        // 끌어 온 자리와 같은 폴더에 놓으면 아무것도 하지 않는다 — 셸이 「복사본」을 만들어 버린다.
        if (p.paths.every((x) => norm(x.slice(0, x.lastIndexOf("\\"))) === norm(dest))) return;
        api
          .dropFiles(p.paths, dest)
          .then((r) => r === "aborted" && setNotice({ text: "옮기기 · 복사를 중간에 취소했다", tone: "warn" }))
          .catch((e) => setNotice({ text: errText(e), tone: "warn" }));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [pinMany]);

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
        const ids = groups[fg].ids;
        const i = ids.indexOf(active.id);
        showTab(ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const ids = groups[fg].ids;
        const id = e.key === "9" ? ids[ids.length - 1] : ids[Number(e.key) - 1];
        if (id != null) showTab(id);
      } else if (k === "h") {
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
  }, [groups, fg, active, openTab, closeTab, navigate, showTab, toggleSplit]);

  // ───────── [6] 명령 팔레트 ─────────

  const paletteItems = (): PaletteItem[] => {
    const go = (path: string) => () => navigate(active.id, path);
    const placesItems: PaletteItem[] = [
      ...pinned.map((p) => ({
        id: `pin:${p.path}`,
        group: "자리" as const,
        label: p.name,
        hint: `즐겨찾기 · ${p.path}`,
        run: p.file ? () => api.openItem(p.path).catch(() => {}) : go(p.path),
      })),
      ...(places?.known ?? []).map((k) => ({ id: `k:${k.path}`, group: "자리" as const, label: k.name, hint: k.path, run: go(k.path) })),
      ...(places?.drives ?? []).map((d) => ({ id: `d:${d.path}`, group: "자리" as const, label: `${d.label} (${d.path.slice(0, 2)})`, hint: "드라이브", run: go(d.path) })),
    ];
    const cmd = (id: string, label: string, run: () => void, hint?: string): PaletteItem => ({ id: `c:${id}`, group: "명령", label, hint, run });
    return [
      ...placesItems,
      cmd("tab", "새 탭", () => openTab(active.path), "Ctrl+T"),
      cmd("split", split ? "나눠 보기 끄기" : "나눠 보기", toggleSplit, "Ctrl+\\"),
      cmd("hidden", showHidden ? "숨김 파일 감추기" : "숨김 파일 보이기", () => setShowHidden((v) => !v), "Ctrl+H"),
      cmd("settings", "설정", () => setSettingsOpen(true), "Ctrl+,"),
      ...STEPS.map((l, i) => cmd(`step:${i}`, `보기 — ${l}`, () => setView((v) => atStep(v, i)))),
      cmd("theme:system", "화면 색 — 시스템", () => setTheme("system")),
      cmd("theme:light", "화면 색 — 밝게", () => setTheme("light")),
      cmd("theme:dark", "화면 색 — 어둡게", () => setTheme("dark")),
    ];
  };
  const searchInPane = useCallback((q: string, scope: "below" | "content") => window.dispatchEvent(new CustomEvent("fd:search", { detail: { q, scope } })), []);

  const dropTo = drag?.on ? drag.to : null;
  const dragTip = split ? "\n끌어서 다른 칸의 탭 줄이나 목록에 놓으면 그 칸으로 옮긴다" : "\n끌어서 목록 오른쪽 반에 놓으면 나눠 본다";

  /** 칸 하나의 탭 줄. 나눠 보면 제목 줄에서 제 칸 너비만큼 차지해 제 칸 바로 위에 선다. */
  const strip = (g: 0 | 1) => {
    const grp = groups[g];
    const last = g === groups.length - 1;
    return (
      <div
        key={g}
        className={"tabs" + (split ? ` in-split strip-${g}` : "") + (split && g === fg ? " focused" : "") + (dropTo && !dropTo.pane && dropTo.g === g && dropTo.at === grp.ids.length ? " drop-end" : "")}
        role="tablist"
        aria-label={split ? (g === 0 ? "왼쪽 칸 탭" : "오른쪽 칸 탭") : "탭"}
        data-tab-strip={g}
        data-tauri-drag-region={split ? "" : undefined}
        style={split && g === 0 ? { flexBasis: `calc((100% - 5px) * ${ratio})` } : undefined}
      >
        {grp.ids.map((id, i) => {
          const t = tabs.find((x) => x.id === id);
          if (!t) return null;
          const cur = grp.cur === id;
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
                (dropTo && !dropTo.pane && dropTo.g === g && dropTo.at === i ? " drop-before" : "")
              }
              title={t.path + dragTip}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(id);
                } else if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
                  showTab(id);
                  setDrag({ id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, to: null });
                }
              }}
            >
              <span className="tab-name">{baseName(t.path)}</span>
              {tabs.length > 1 && (
                <button className="tab-close" aria-label="탭 닫기" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTab(id)}>
                  ×
                </button>
              )}
            </div>
          );
        })}
        <button className="tab-add" aria-label="새 탭" title="새 탭 (Ctrl+T)" onClick={() => openTab(pathOf(grp.cur), true, g)}>
          +
        </button>
        {last && (
          <button
            className={"split-btn" + (split ? " on" : "")}
            aria-pressed={split}
            aria-label="나눠 보기"
            title={split ? "나눠 보기 끄기 (Ctrl+\\)" : "나눠 보기 — 두 폴더를 나란히 (Ctrl+\\)"}
            onClick={toggleSplit}
          >
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
              <rect x=".6" y=".6" width="12.8" height="10.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 .6v10.8" stroke="currentColor" strokeWidth="1.2" />
              {split && <rect x="7" y=".6" width="6.4" height="10.8" rx="1" fill="currentColor" opacity=".35" />}
            </svg>
          </button>
        )}
      </div>
    );
  };

  /** 목록에 놓을 때의 덮개 — 받는 칸 전체 (안 나눴으면 오른쪽 반). */
  const r = split ? ratio : 0.5;
  const dropBox =
    dropTo?.pane &&
    (dropTo.g === 0 ? { left: 6, width: `calc(${r * 100}% - 9px)` } : { right: 6, width: `calc(${(1 - r) * 100}% - 9px)` });

  return (
    <div className={"app" + (drag?.on ? " tab-dragging" : "")}>
      <TitleBar>
        {strip(0)}
        {split && <div className="tabs-gap" aria-hidden="true" onMouseDown={startDivider} onDoubleClick={() => setRatio(0.5)} />}
        {split && strip(1)}
      </TitleBar>
      <div className="body">
        <Sidebar
          places={places}
          pinned={pinned}
          onUnpin={unpin}
          onMovePin={movePin}
          current={active.path}
          onGo={(p) => navigate(active.id, p)}
          onGoNewTab={(p) => openTab(p)}
          onOpenFile={(p) => api.openItem(p).then((to) => to && navigate(active.id, to)).catch((e) => setNotice({ text: errText(e), tone: "warn" }))}
          settingsOpen={settingsOpen}
          onSettings={() => setSettingsOpen((v) => !v)}
        />
        <div
          ref={panesRef}
          className={"panes" + (split ? " split" : "")}
          style={split ? { gridTemplateColumns: `minmax(0, ${ratio}fr) 5px minmax(0, ${1 - ratio}fr)` } : undefined}
        >
          {loaded &&
            tabs.map((t) => {
              const side = groupOf(t.id);
              return (
                <Pane
                  key={t.id}
                  tab={t}
                  visible={groups[side]?.cur === t.id}
                  side={split ? side : null}
                  active={t.id === active.id}
                  onFocusPane={() => side !== fg && setFocus(side)}
                  showHidden={showHidden}
                  cols={cols}
                  setCols={setCols}
                  view={view}
                  setView={setView}
                  split={split}
                  onOpenBeside={openBeside}
                  onToggleSplit={toggleSplit}
                  onPin={pinMany}
                  notice={t.id === active.id ? notice : null}
                  clearNotice={() => setNotice(null)}
                  onGo={(p) => navigate(t.id, p)}
                  onBack={() => navigate(t.id, "", "back")}
                  onFwd={() => navigate(t.id, "", "fwd")}
                  onOpenTab={(p) => openTab(p, false, side)}
                />
              );
            })}
          {split && <div className="divider" role="separator" aria-orientation="vertical" aria-label="칸 너비" onMouseDown={startDivider} onDoubleClick={() => setRatio(0.5)} />}
          {dropBox && <div className="split-drop" style={dropBox} aria-hidden="true" />}
        </div>
      </div>
      {paletteOpen && <Palette items={paletteItems()} onSearch={searchInPane} onClose={() => setPaletteOpen(false)} />}
      {settingsOpen && (
        <SettingsPanel
          current={active.path}
          view={view}
          setView={setView}
          showHidden={showHidden}
          setShowHidden={setShowHidden}
          theme={theme}
          setTheme={setTheme}
          resetCols={() => setCols(DEFAULT_COLS)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {drag?.on && (
        <div className="tab-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }} aria-hidden="true">
          {baseName(tabs.find((t) => t.id === drag.id)?.path ?? "")}
        </div>
      )}
    </div>
  );
}
