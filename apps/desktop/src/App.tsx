// 앱 틀 — 제목 줄(탭 · 창 단추 · 새 판 알림) · 왼쪽 위치 목록 · 나눠 보기 · 끌어다 놓기 받기 · 폴더 변경 알림 · 설정 저장.
//
// 목차
//   [1] 설정 읽기 · 저장 (즐겨찾기 · 탭 · 나눠 보기 · 열 너비 · 화면 색 · 문서 저장소)
//   [2] 탭 · 나눠 보기 — 왼쪽 칸 · 오른쪽 칸에 탭 하나씩. 키보드는 「지금 칸」(focus) 이 받는다
//       2026.11.11 : 나눠 보기를 더했다. 두 폴더를 나란히 놓고 파일을 끌어 옮기는 일이 탭을 오가는 것보다 잦다
//   [3] 탭 끌기 — 탭을 다른 탭 자리로 끌면 순서를 바꾸고, 목록 왼쪽 · 오른쪽 반으로 끌면 그 칸에 연다
//       Tauri 가 창으로 들어오는 파일 끌기를 받으려고 웹 끌기(HTML5 DnD)를 막아 두어, 마우스 움직임으로 직접 짠다
//   [4] 끌어다 놓기 받기 (앱 밖 · 다른 칸에서 끈 파일) · 즐겨찾기에 놓기
//   [5] 단축키 (Ctrl+T · W · Tab · 1~9 · H · \)
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, DEFAULT_VIEW, type Place, type Places, type Settings, type Theme, type ViewPrefs } from "./api";
import Pane from "./Pane";
import SettingsPanel from "./SettingsPanel";
import Sidebar from "./Sidebar";
import TitleBar from "./TitleBar";
import { useAutoUpdate } from "./updater";
import { applyTheme, baseName, DEFAULT_COLS, DEFAULT_KINDS, errText, type KindDef, norm, setKinds } from "./util";

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
  const split = s?.split && typeof s.split.right === "number" ? { right: s.split.right, ratio: clampRatio(s.split.ratio) } : null;
  return {
    pinned: s?.pinned ?? DEFAULT_PINNED,
    session: s?.session ?? { tabs: [], active: 0 },
    cols: s?.cols?.length === DEFAULT_COLS.length ? s.cols : DEFAULT_COLS,
    showHidden: s?.showHidden ?? false,
    storeRoot: s?.storeRoot ?? "",
    theme: s?.theme === "light" || s?.theme === "dark" ? s.theme : "system",
    split,
    view: {
      ...DEFAULT_VIEW,
      ...(s?.view ?? {}),
      size: Math.min(3, Math.max(0, Number(s?.view?.size ?? DEFAULT_VIEW.size) || 0)),
      hiddenCols: Array.isArray(s?.view?.hiddenCols) ? s.view.hiddenCols : [],
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

/** 탭 끌기 상태. `to` 는 놓을 자리 — 탭 순서(그 탭 앞) 또는 칸. */
type TabDrag = { id: number; x0: number; y0: number; on: boolean; x: number; y: number; to: { tab: number } | { side: 0 | 1 } | null };

export default function App() {
  const [places, setPlaces] = useState<Places | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(START)]);
  /** 칸마다 보이는 탭. [왼쪽, 오른쪽(없으면 안 나눔)]. */
  const [sides, setSides] = useState<[number, number | null]>([tabs[0].id, null]);
  /** 키보드를 받는 칸. */
  const [focus, setFocus] = useState<0 | 1>(0);
  const [ratio, setRatio] = useState(0.5);
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<Place[]>([]);
  const [cols, setCols] = useState<number[]>(DEFAULT_COLS);
  const [storeRoot, setStoreRoot] = useState("");
  const [theme, setTheme] = useState<Theme>("system");
  const [loaded, setLoaded] = useState(false);
  /** 알림 한 줄 — 지금 칸 위에 뜬다. 해낸 일은 ok, 실패 · 취소는 warn. */
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [drag, setDrag] = useState<TabDrag | null>(null);
  const [view, setView] = useState<ViewPrefs>(DEFAULT_VIEW);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panesRef = useRef<HTMLDivElement>(null);
  useAutoUpdate();

  // 종류 표는 아이콘처럼 설정을 받지 않는 곳도 보므로 그리기 전에 넣는다 (같은 목록이면 다시 세우지 않는다).
  setKinds(view.kinds);

  const split = sides[1] != null;
  const activeId = sides[split ? focus : 0] as number;
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // ───────── [1] 설정 ─────────

  // 지난번에 열어 둔 탭으로 연다. 처음이면 다운로드 — 들어온 파일을 정리하는 일이 가장 잦다.
  useEffect(() => {
    Promise.all([api.places(), api.loadSettings().catch(() => null)]).then(([p, raw]) => {
      setPlaces(p);
      const s = withDefaults(raw);
      setPinned(s.pinned);
      setCols(s.cols);
      setShowHidden(s.showHidden);
      setStoreRoot(s.storeRoot);
      setTheme(s.theme);
      setView(s.view);
      const dl = p.known.find((k) => k.name === "다운로드")?.path ?? START;
      const restored = s.session.tabs.length ? s.session.tabs.map(newTab) : [newTab(dl)];
      setTabs(restored);
      const left = restored[Math.min(s.session.active, restored.length - 1)].id;
      const right = s.split && restored[s.split.right] && restored[s.split.right].id !== left ? restored[s.split.right].id : null;
      setSides([left, right]);
      if (s.split) setRatio(s.split.ratio);
      setLoaded(true);
    });
  }, []);

  // 설정 저장 — 바뀐 뒤 잠깐 기다렸다가 한 번에 (열 너비 · 칸 너비를 끄는 동안 수십 번 쓰지 않게).
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => {
      const idx = (id: number | null) => Math.max(0, tabs.findIndex((x) => x.id === id));
      api
        .saveSettings({
          pinned,
          cols,
          showHidden,
          storeRoot,
          theme,
          session: { tabs: tabs.map((x) => x.path), active: idx(sides[0]) },
          split: sides[1] != null ? { right: idx(sides[1]), ratio } : null,
          view,
        })
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [loaded, tabs, sides, ratio, pinned, cols, showHidden, storeRoot, theme, view]);

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

  /** 탭을 지금 칸에 보인다. 다른 칸에 이미 보이는 탭이면 그 칸으로 초점만 옮긴다. */
  const showTab = useCallback(
    (id: number) => {
      if (sides[1] != null) {
        const other = (1 - focus) as 0 | 1;
        if (sides[other] === id) return setFocus(other);
        setSides((s) => (focus === 0 ? [id, s[1]] : [s[0], id]));
      } else setSides([id, null]);
    },
    [sides, focus],
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

  const openTab = useCallback(
    (path: string, show = true) => {
      const t = newTab(path);
      setTabs((ts) => [...ts, t]);
      if (show) showTab(t.id);
    },
    [showTab],
  );

  const closeTab = useCallback(
    (id: number) => {
      if (tabs.length === 1) return;
      const i = tabs.findIndex((t) => t.id === id);
      const rest = tabs.filter((t) => t.id !== id);
      const neighbour = (avoid: number | null) => {
        const cands = [...rest.slice(0, Math.max(0, i)).reverse(), ...rest.slice(i)];
        return cands.find((t) => t.id !== avoid)?.id ?? null;
      };
      setTabs(rest);
      setSides(([l, r]) => {
        if (r === id) return [l, null]; // 오른쪽 칸의 탭을 닫으면 나눠 보기를 접는다
        if (l === id) {
          if (r != null) return [r, null];
          return [neighbour(null) ?? rest[0].id, null];
        }
        return [l, r];
      });
      if (sides[1] === id || sides[0] === id) setFocus(0);
    },
    [tabs, sides],
  );

  /** 나눠 보기 켜기 · 끄기 (Ctrl+\). 켤 때 오른쪽 칸에는 다른 탭이 있으면 그것을, 없으면 지금 폴더를 새 탭으로. */
  const toggleSplit = useCallback(() => {
    if (sides[1] != null) {
      setSides([activeId, null]);
      setFocus(0);
      return;
    }
    const other = tabs.find((t) => t.id !== sides[0]);
    if (other) setSides([sides[0], other.id]);
    else {
      const t = newTab(active.path);
      setTabs((ts) => [...ts, t]);
      setSides([sides[0], t.id]);
    }
    setFocus(1);
  }, [sides, tabs, active.path, activeId]);

  /** 경로를 옆 칸에서 연다 (오른쪽 메뉴 「옆 칸에서 열기」). 안 나눴으면 나누고 새 탭으로 연다. */
  const openBeside = useCallback(
    (path: string) => {
      const other = (1 - focus) as 0 | 1;
      const id = sides[1] != null ? sides[other] : null;
      if (id != null) {
        navigate(id, path);
        setFocus(other);
        return;
      }
      const t = newTab(path);
      setTabs((ts) => [...ts, t]);
      setSides([sides[0], t.id]);
      setFocus(1);
    },
    [focus, sides, navigate],
  );

  /** 탭을 칸에 놓는다 (탭 끌기). 다른 칸에 있던 탭이면 두 칸을 맞바꾼다. */
  const placeTab = useCallback(
    (id: number, side: 0 | 1) => {
      setSides(([l, r]) => {
        if (side === 0) {
          if (r === id) return [id, l];
          return [id, r];
        }
        if (l === id) {
          if (r != null) return [r, id];
          const other = tabs.find((t) => t.id !== id);
          if (!other) return [l, r];
          return [other.id, id];
        }
        return [l, id];
      });
      setFocus(side);
    },
    [tabs],
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

  useEffect(() => {
    if (!drag) return;
    const where = (x: number, y: number): TabDrag["to"] => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const tabEl = el?.closest<HTMLElement>("[data-tab-index]");
      if (tabEl) return { tab: Number(tabEl.dataset.tabIndex) };
      const box = panesRef.current?.getBoundingClientRect();
      if (box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return { side: x < box.left + box.width / 2 ? 0 : 1 };
      return null;
    };
    const move = (m: MouseEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const on = d.on || Math.hypot(m.clientX - d.x0, m.clientY - d.y0) > 6;
        return { ...d, on, x: m.clientX, y: m.clientY, to: on ? where(m.clientX, m.clientY) : null };
      });
    };
    const up = () => {
      setDrag((d) => {
        if (d?.on && d.to) {
          const to = d.to;
          if ("side" in to) placeTab(d.id, to.side);
          else
            setTabs((ts) => {
              const from = ts.findIndex((t) => t.id === d.id);
              if (from < 0 || from === to.tab) return ts;
              const n = [...ts];
              const [x] = n.splice(from, 1);
              n.splice(to.tab > from ? to.tab - 1 : to.tab, 0, x);
              return n;
            });
        }
        return null;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // drag 가 생기고 없어질 때만 다시 건다 — 움직일 때마다 다시 걸면 끄는 동안 이벤트를 놓친다.
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
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === active.id);
        const n = (i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
        showTab(tabs[n].id);
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const t = e.key === "9" ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1];
        if (t) showTab(t.id);
      } else if (k === "h") {
        e.preventDefault();
        setShowHidden((v) => !v);
      } else if (e.key === "\\") {
        e.preventDefault();
        toggleSplit();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) navigate(active.id, "", "back");
      if (e.button === 4) navigate(active.id, "", "fwd");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [tabs, active, openTab, closeTab, navigate, showTab, toggleSplit]);

  const sideOf = (id: number): 0 | 1 | null => (sides[0] === id ? 0 : sides[1] === id ? 1 : null);
  const dropTo = drag?.on ? drag.to : null;

  return (
    <div className={"app" + (drag?.on ? " tab-dragging" : "")}>
      <TitleBar>
        <div className="tabs" role="tablist">
          {tabs.map((t, i) => {
            const side = sideOf(t.id);
            return (
              <div
                key={t.id}
                role="tab"
                data-tab-index={i}
                aria-selected={t.id === active.id}
                className={
                  "tab" +
                  (t.id === active.id ? " active" : "") +
                  (split && side != null ? ` on-side side-${side}` : "") +
                  (drag?.on && drag.id === t.id ? " dragging" : "") +
                  (dropTo && "tab" in dropTo && dropTo.tab === i && drag?.id !== t.id ? " drop-before" : "")
                }
                title={`${t.path}${split ? "\n끌어서 목록 왼쪽 · 오른쪽 반에 놓으면 그 칸에 연다" : "\n끌어서 목록 오른쪽 반에 놓으면 나눠 본다"}`}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(t.id);
                  } else if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
                    showTab(t.id);
                    setDrag({ id: t.id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false, to: null });
                  }
                }}
              >
                {split && side != null && <span className="tab-side" aria-label={side === 0 ? "왼쪽 칸" : "오른쪽 칸"} />}
                <span className="tab-name">{baseName(t.path)}</span>
                {tabs.length > 1 && (
                  <button className="tab-close" aria-label="탭 닫기" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTab(t.id)}>
                    ×
                  </button>
                )}
              </div>
            );
          })}
          <button className="tab-add" aria-label="새 탭" title="새 탭 (Ctrl+T)" onClick={() => openTab(active.path)}>
            +
          </button>
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
        </div>
      </TitleBar>
      <div className="body">
        <Sidebar
          places={places}
          loaded={loaded}
          storeRoot={storeRoot}
          onStoreRoot={setStoreRoot}
          pinned={pinned}
          onUnpin={unpin}
          onMovePin={movePin}
          current={active.path}
          onGo={(p) => navigate(active.id, p)}
          onGoNewTab={(p) => openTab(p)}
          onOpenFile={(p) => api.openItem(p).then((to) => to && navigate(active.id, to)).catch((e) => setNotice({ text: errText(e), tone: "warn" }))}
          theme={theme}
          onTheme={setTheme}
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
              const side = sideOf(t.id);
              return (
                <Pane
                  key={t.id}
                  tab={t}
                  visible={side != null}
                  side={split ? side : null}
                  active={t.id === active.id}
                  onFocusPane={() => side != null && side !== focus && setFocus(side)}
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
                  onOpenTab={(p) => openTab(p, false)}
                />
              );
            })}
          {split && <div className="divider" role="separator" aria-orientation="vertical" aria-label="칸 너비" onMouseDown={startDivider} onDoubleClick={() => setRatio(0.5)} />}
          {dropTo && "side" in dropTo && <div className={`split-drop side-${dropTo.side}`} aria-hidden="true" />}
        </div>
      </div>
      {settingsOpen && (
        <SettingsPanel
          storeRoot={storeRoot}
          current={active.path}
          onStoreRoot={setStoreRoot}
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
