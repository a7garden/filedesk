// 앱 틀 — 제목 줄(탭 · 창 단추 · 새 판 알림) · 왼쪽 위치 목록 · 끌어다 놓기 받기 · 폴더 변경 알림 · 설정(고정 위치 · 탭 · 열 너비 · 화면 색) 저장.
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, type Place, type Places, type Settings, type Theme } from "./api";
import Pane from "./Pane";
import Sidebar from "./Sidebar";
import TitleBar from "./TitleBar";
import { useAutoUpdate } from "./updater";
import { applyTheme, baseName, errText, norm } from "./util";

export type Tab = { id: number; path: string; back: string[]; fwd: string[] };

let nextId = 1;
const newTab = (path: string): Tab => ({ id: nextId++, path, back: [], fwd: [] });

const START = "C:\\";

/** 열 너비 기본값: 이름 · 판 · 고친 날 · 크기 (이름 칸은 남는 자리를 다 쓰므로 최소 너비).
 *  2026.11.11 : 「유형」 열(셸의 긴 종류 이름)을 빼고 「판」을 넣었다 — 확장자는 이름 끝에 흐리게 보인다. */
export const DEFAULT_COLS = [280, 170, 110, 84];

/** 처음 쓸 때 고정 위치 — 비워 둔다. Ctrl+D 로 지금 폴더를 고정하면 설정에 저장된다.
 *  2026.11.11 : 이 PC 의 과업 경로를 기본값으로 두던 것을 뺐다 (공개 저장소). */
const DEFAULT_PINNED: Place[] = [];

/** 2026.11.11 : 프로젝트 단위 문서 저장소. 연도 · 프로젝트 폴더가 여기 아래에 쌓인다. */
const DEFAULT_STORE = "D:\\문서";

function withDefaults(s: Partial<Settings> | null): Settings {
  return {
    pinned: s?.pinned ?? DEFAULT_PINNED,
    session: s?.session ?? { tabs: [], active: 0 },
    cols: s?.cols?.length === DEFAULT_COLS.length ? s.cols : DEFAULT_COLS,
    showHidden: s?.showHidden ?? false,
    storeRoot: s?.storeRoot ?? DEFAULT_STORE,
    theme: s?.theme === "light" || s?.theme === "dark" ? s.theme : "system",
  };
}

export default function App() {
  const [places, setPlaces] = useState<Places | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(START)]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<Place[]>([]);
  const [cols, setCols] = useState<number[]>(DEFAULT_COLS);
  const [storeRoot, setStoreRoot] = useState(DEFAULT_STORE);
  const [theme, setTheme] = useState<Theme>("system");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  useAutoUpdate();

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
      const dl = p.known.find((k) => k.name === "다운로드")?.path ?? START;
      const restored = s.session.tabs.length ? s.session.tabs.map(newTab) : [newTab(dl)];
      setTabs(restored);
      setActiveId(restored[Math.min(s.session.active, restored.length - 1)].id);
      setLoaded(true);
    });
  }, []);

  // 설정 저장 — 바뀐 뒤 잠깐 기다렸다가 한 번에 (열 너비를 끄는 동안 수십 번 쓰지 않게).
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => {
      const active = Math.max(0, tabs.findIndex((x) => x.id === activeId));
      api.saveSettings({ pinned, cols, showHidden, storeRoot, theme, session: { tabs: tabs.map((x) => x.path), active } }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [loaded, tabs, activeId, pinned, cols, showHidden, storeRoot, theme]);

  useEffect(() => {
    if (loaded) applyTheme(theme);
  }, [loaded, theme]);

  const pin = useCallback((path: string, name: string) => {
    setPinned((ps) => (ps.some((x) => norm(x.path) === norm(path)) ? ps : [...ps, { name, path }]));
    setNotice(`「${name}」을 즐겨찾기에 고정했다`);
  }, []);
  const unpin = useCallback((path: string) => setPinned((ps) => ps.filter((x) => norm(x.path) !== norm(path))), []);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

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

  const openTab = useCallback((path: string, focus = true) => {
    const t = newTab(path);
    setTabs((ts) => [...ts, t]);
    if (focus) setActiveId(t.id);
  }, []);

  const closeTab = useCallback(
    (id: number) => {
      setTabs((ts) => {
        if (ts.length === 1) return ts;
        const i = ts.findIndex((t) => t.id === id);
        const rest = ts.filter((t) => t.id !== id);
        if (id === activeId) setActiveId(rest[Math.max(0, i - 1)].id);
        return rest;
      });
    },
    [activeId],
  );

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

  // 끌어다 놓기 받기. 놓은 자리의 [data-drop] 이 대상 폴더다 (폴더 줄 · 목록 빈 곳 · 왼쪽 위치).
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
        api
          .dropFiles(p.paths, dest)
          .then((r) => r === "aborted" && setNotice("옮기기 · 복사를 중간에 취소했다"))
          .catch((e) => setNotice(errText(e)));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // 탭 · 전역 단축키 (Ctrl+T · Ctrl+W · Ctrl+Tab · Ctrl+1~9 · Ctrl+H 숨김 보기) · 마우스 뒤로/앞으로 단추.
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
        setActiveId(tabs[n].id);
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const t = e.key === "9" ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1];
        if (t) setActiveId(t.id);
      } else if (k === "h") {
        e.preventDefault();
        setShowHidden((v) => !v);
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
  }, [tabs, active, openTab, closeTab, navigate]);

  return (
    <div className="app">
      <TitleBar>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active.id}
              className={"tab" + (t.id === active.id ? " active" : "")}
              title={t.path}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(t.id);
                } else if (e.button === 0) setActiveId(t.id);
              }}
            >
              <span className="tab-name">{baseName(t.path)}</span>
              {tabs.length > 1 && (
                <button
                  className="tab-close"
                  aria-label="탭 닫기"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => closeTab(t.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button className="tab-add" aria-label="새 탭" title="새 탭 (Ctrl+T)" onClick={() => openTab(active.path)}>
            +
          </button>
        </div>
      </TitleBar>
      <div className="body">
        <Sidebar
          places={places}
          storeRoot={loaded ? storeRoot : ""}
          pinned={pinned}
          onUnpin={unpin}
          current={active.path}
          onGo={(p) => navigate(active.id, p)}
          onGoNewTab={(p) => openTab(p)}
          theme={theme}
          onTheme={setTheme}
        />
        <div className="panes">
          {loaded && tabs.map((t) => (
            <Pane
              key={t.id}
              tab={t}
              active={t.id === active.id}
              showHidden={showHidden}
              cols={cols}
              setCols={setCols}
              onPin={(p) => pin(p, baseName(p))}
              notice={t.id === active.id ? notice : ""}
              clearNotice={() => setNotice("")}
              onGo={(p) => navigate(t.id, p)}
              onBack={() => navigate(t.id, "", "back")}
              onFwd={() => navigate(t.id, "", "fwd")}
              onOpenTab={(p) => openTab(p, false)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
