// 왼쪽 — 프로젝트(문서 저장소의 연도별 프로젝트) · 즐겨찾기 · 들어온 곳 · 드라이브 · 화면 색 · 설정 · 판(누르면 새 판 확인).
// 탐색기의 「즐겨찾기 + 드라이브」 대신 일의 단위로 묶는다.
//   프로젝트: 올해는 펼쳐 두고 지난 해는 접는다. 지금 있는 프로젝트만 그 자리(산출물 · 자료 …)를 펼친다 — 다른 프로젝트의 자리까지 깔면 길어진다.
//   2026.11.11 : 화면 말 「사업」 → 「프로젝트」 (사업은 회사 일에만 맞는 말이라). 저장소 안 폴더 이름 `사업\` 은 그대로다.
//   2026.11.11 : 「고정」 → 「즐겨찾기」. 파일도 더한다 (누르면 연다). 제목에 끌어다 놓으면 더하고, 항목을 끌어 순서를 바꾼다.
//   2026.11.11 : 프로젝트 · 즐겨찾기에 오른쪽 단추 → 색 표시 (Finder 꼬리표처럼). 색은 메모와 같은 자리에 둔다 (fd-core memo).
//   자리 역할은 왼쪽 끝 표시 모양으로 말한다 (정본 실선 · 받은 것 점선 · 보관 흐림). 글자 이름도 title 에 둔다.
// 항목마다 [data-drop] — 파일을 끌어다 놓으면 그 자리로 옮긴다.
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, iconUrl, type Area, type PinnedInfo, type Place, type Places, type StoreYear, type TagColor, type Theme } from "./api";
import { PIN_DROP } from "./App";
import { Chevron, FolderGlyph, ThemeGlyph } from "./glyphs";
import TagMenu, { TagDot } from "./TagMenu";
import { checkUpdate } from "./updater";
import { baseName, errText, norm, ROLE_LABEL } from "./util";

type Props = {
  places: Places | null;
  /** 설정을 다 읽었는가 — 읽기 전에는 「저장소를 정하지 않았다」를 띄우지 않는다. */
  loaded: boolean;
  /** 프로젝트 단위 문서 저장소. 빈 글자면 아직 정하지 않았다. */
  storeRoot: string;
  onStoreRoot: (p: string) => void;
  pinned: Place[];
  onUnpin: (path: string) => void;
  onMovePin: (from: number, to: number) => void;
  current: string;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
  onOpenFile: (path: string) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
  settingsOpen: boolean;
  onSettings: () => void;
};

type ColorMenu = { x: number; y: number; path: string; pin?: boolean };

/** 화면 색 단추가 도는 차례와 이름. */
const THEMES: Theme[] = ["system", "light", "dark"];
const THEME_LABEL: Record<Theme, string> = { system: "시스템", light: "밝게", dark: "어둡게" };

/** 「들어온 곳」에 셀 최근 날 수. */
const RECENT_DAYS = 3;
const THIS_YEAR = String(new Date().getFullYear());

const within = (path: string, root: string) => {
  const p = norm(path);
  const r = norm(root);
  return p === r || p.startsWith(r.endsWith("\\") ? r : r + "\\");
};

export default function Sidebar(props: Props) {
  const { places, loaded, storeRoot, onStoreRoot, pinned, onUnpin, onMovePin, current, onGo, onGoNewTab, onOpenFile, theme, onTheme, settingsOpen, onSettings } = props;
  const [years, setYears] = useState<StoreYear[]>([]);
  const [openYears, setOpenYears] = useState<Set<string>>(new Set([THIS_YEAR]));
  const [recent, setRecent] = useState<number[]>([]);
  /** 즐겨찾기 중 과업 루트(산출물이 있는 폴더)와 그 자리 — 저장소 밖 과업 루트도 자리로 바로 가게. */
  const [pinInfo, setPinInfo] = useState<PinnedInfo[]>([]);
  useEffect(() => {
    api
      .pinnedInfo(pinned.filter((p) => !p.file).map((p) => p.path))
      .then(setPinInfo)
      .catch(() => setPinInfo([]));
  }, [pinned]);
  const pinAreas = (path: string): Area[] => pinInfo.find((i) => norm(i.path) === norm(path))?.areas ?? [];
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  /** 경로(norm) → 색. 프로젝트 · 즐겨찾기 것만. */
  const [colors, setColors] = useState<Map<string, TagColor>>(new Map());
  const [menu, setMenu] = useState<ColorMenu | null>(null);
  /** 즐겨찾기 끌어 순서 바꾸기 — 누른 항목 · 놓을 자리(그 앞). */
  const [pinDrag, setPinDrag] = useState<{ from: number; y0: number; on: boolean; over: number | null } | null>(null);
  const suppressClick = useRef(false);
  const inbox = places ? places.known.filter((k) => k.name !== "문서") : [];
  const docs = places?.known.find((k) => k.name === "문서");

  const loadStore = useCallback(() => {
    if (!storeRoot) return setYears([]);
    api.storeProjects(storeRoot).then(setYears).catch(() => setYears([]));
  }, [storeRoot]);
  useEffect(loadStore, [loadStore]);

  // 색 점 — 프로젝트 · 즐겨찾기 경로의 색을 한 번에 묻는다. 목록에서 색을 바꾸면(fd:colors) 다시 묻는다.
  const colorPaths = [...years.flatMap((y) => y.projects.map((p) => p.path)), ...pinned.map((p) => p.path)];
  const colorKey = colorPaths.join("|");
  const loadColors = useCallback(() => {
    if (!colorPaths.length) return setColors(new Map());
    api
      .memosOf(colorPaths)
      .then((ms) => setColors(new Map(ms.filter((m) => m.color).map((m) => [norm(m.path), m.color as TagColor]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorKey]);
  useEffect(() => {
    loadColors();
    window.addEventListener("fd:colors", loadColors);
    return () => window.removeEventListener("fd:colors", loadColors);
  }, [loadColors]);

  const pickColor = (path: string, c: TagColor | null) => {
    setMenu(null);
    api
      .setColor(path, c)
      .then(() => window.dispatchEvent(new CustomEvent("fd:colors")))
      .catch(() => {});
  };
  const openMenu = (e: React.MouseEvent, path: string, pin = false) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, path, pin });
  };

  // 즐겨찾기 끌기 — 6px 넘게 움직이면 끌기, 놓으면 그 자리 앞으로 옮긴다.
  useEffect(() => {
    if (!pinDrag) return;
    const move = (m: MouseEvent) => {
      setPinDrag((d) => {
        if (!d) return d;
        const on = d.on || Math.abs(m.clientY - d.y0) > 6;
        const el = (document.elementFromPoint(m.clientX, m.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-pin-index]");
        let over: number | null = null;
        if (el) {
          const r = el.getBoundingClientRect();
          over = Number(el.dataset.pinIndex) + (m.clientY > r.top + Math.min(r.height, 30) / 2 ? 1 : 0);
        }
        return { ...d, on, over: on ? over : null };
      });
    };
    const up = () => {
      setPinDrag((d) => {
        if (d?.on) {
          suppressClick.current = true;
          window.setTimeout(() => (suppressClick.current = false), 0);
          if (d.over != null) onMovePin(d.from, d.over);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinDrag != null, onMovePin]);

  // 지금 있는 프로젝트의 해는 펼친다 (지난 해 프로젝트로 들어갔을 때).
  useEffect(() => {
    for (const y of years) {
      if (y.projects.some((p) => within(current, p.path))) {
        setOpenYears((s) => (s.has(y.year) ? s : new Set(s).add(y.year)));
      }
    }
  }, [current, years]);

  // 들어온 곳의 새 파일 수 — 열 때 · 1분마다.
  const inboxKey = inbox.map((p) => p.path).join("|");
  useEffect(() => {
    if (!inbox.length) return;
    const run = () => api.recentCounts(inbox.map((p) => p.path), RECENT_DAYS).then(setRecent).catch(() => {});
    run();
    const t = window.setInterval(run, 60000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxKey]);

  const link = (path: string, label: React.ReactNode, cls = "", extra?: React.ReactNode, title?: string, colorable = false) => (
    <button
      className={"nav-item " + cls + (norm(path) === norm(current) ? " current" : "")}
      data-drop={path}
      title={title ?? path}
      aria-current={norm(path) === norm(current) ? "page" : undefined}
      onClick={(e) => (e.ctrlKey ? onGoNewTab(path) : onGo(path))}
      onContextMenu={colorable ? (e) => openMenu(e, path) : undefined}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onGoNewTab(path);
        }
      }}
    >
      {label}
      {colorable && <TagDot color={colors.get(norm(path))} />}
      {extra}
    </button>
  );

  const createProject = (name: string) => {
    api
      .createProject(storeRoot, THIS_YEAR, name)
      .then((p) => {
        setAdding(false);
        setAddErr("");
        loadStore();
        onGo(p);
      })
      .catch((e) => setAddErr(errText(e)));
  };

  const toggleYear = (y: string) =>
    setOpenYears((s) => {
      const n = new Set(s);
      if (n.has(y)) n.delete(y);
      else n.add(y);
      return n;
    });

  const inStoreProject = years.some((y) => y.projects.some((p) => within(current, p.path)));
  const hasThisYear = years.some((y) => y.year === THIS_YEAR);
  const shownYears: StoreYear[] = hasThisYear ? years : [{ year: THIS_YEAR, projects: [] }, ...years];

  const areaList = (areas: Area[]) => (
    <ul className="areas">
      {areas.map((a) => (
        <li key={a.path}>{link(a.path, <span>{a.name}</span>, `area role-${a.role}`, undefined, `${a.name} · ${ROLE_LABEL[a.role]}`)}</li>
      ))}
    </ul>
  );

  return (
    <nav className="side" aria-label="위치" data-tauri-drag-region>
      {loaded && !storeRoot && (
        <section>
          <div className="side-head">
            <h2>프로젝트</h2>
          </div>
          <p className="side-hint">
            문서 저장소를 정하면 연도별 프로젝트가 여기 보인다.
            <button className="act" onClick={() => onStoreRoot(current)} title={current}>
              지금 폴더로 정하기
            </button>
          </p>
        </section>
      )}
      {storeRoot && (
        <section>
          <div className="side-head">
            <h2 title={storeRoot}>프로젝트</h2>
            <button
              className="side-add"
              title={`${THIS_YEAR}년 새 프로젝트 — 산출물 · 자료 · 아카이브 자리를 만든다`}
              onClick={() => {
                setAdding(true);
                setAddErr("");
                requestAnimationFrame(() => addRef.current?.focus());
              }}
            >
              + 새 프로젝트
            </button>
          </div>
          {adding && (
            <div className="side-new">
              <input
                ref={addRef}
                placeholder={`${THIS_YEAR} 프로젝트 이름`}
                aria-label="새 프로젝트 이름"
                aria-invalid={!!addErr}
                spellCheck={false}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") createProject((e.target as HTMLInputElement).value);
                  if (e.key === "Escape") setAdding(false);
                }}
                onBlur={(e) => !e.target.value && setAdding(false)}
              />
              {addErr && <div className="side-err">{addErr}</div>}
            </div>
          )}
          {shownYears.map((y) => {
            const open = openYears.has(y.year);
            return (
              <div key={y.year} className="year">
                <button className="year-btn" aria-expanded={open} onClick={() => toggleYear(y.year)}>
                  <Chevron open={open} />
                  <span>{y.year}</span>
                  <span className="year-count">{y.projects.length}</span>
                </button>
                {open && (
                  <ul className="year-list">
                    {y.projects.map((p) => {
                      const here = within(current, p.path);
                      return (
                        <li key={p.path}>
                          {link(p.path, <span className="project-name">{p.name}</span>, "project", undefined, `${p.path}\n오른쪽 단추: 색 표시`, true)}
                          {here && p.areas.length > 0 && areaList(p.areas)}
                        </li>
                      );
                    })}
                    {y.projects.length === 0 && <li className="side-empty">아직 프로젝트가 없다</li>}
                  </ul>
                )}
              </div>
            );
          })}
          <ul>
            <li>{link(`${storeRoot}\\공통`, <span>공통</span>, "", undefined, "회사 공용 — 양식 · 솔루션 · 가이드")}</li>
          </ul>
        </section>
      )}

      <section>
        <h2 className="pin-head" data-drop={PIN_DROP} title="폴더 · 파일을 여기로 끌어다 놓거나 Ctrl+D 로 더한다">
          즐겨찾기
        </h2>
        {pinned.length === 0 && <p className="side-hint">폴더 · 파일을 이 제목 위로 끌어 놓거나 Ctrl+D</p>}
        <ul className={pinDrag?.on ? "pin-dragging" : undefined}>
          {pinned.map((p, i) => {
            const areas = p.file ? [] : pinAreas(p.path);
            const over = pinDrag?.on ? pinDrag.over : null;
            const line = over === i ? "drop-before" : over === pinned.length && i === pinned.length - 1 ? "drop-after" : undefined;
            const ext = p.file && p.name.includes(".") ? p.name.slice(p.name.lastIndexOf(".") + 1).toLowerCase() : "";
            const here = !p.file && norm(p.path) === norm(current);
            return (
              <li
                key={p.path}
                data-pin-index={i}
                className={(line ?? "") + (pinDrag?.on && pinDrag.from === i ? " pin-lifted" : "") || undefined}
                onMouseDown={(e) => {
                  if (e.button === 0 && !(e.target as HTMLElement).closest(".unpin")) setPinDrag({ from: i, y0: e.clientY, on: false, over: null });
                }}
                onClickCapture={(e) => {
                  if (suppressClick.current) {
                    e.stopPropagation();
                    e.preventDefault();
                  }
                }}
              >
                <div className="row-with-x">
                  <button
                    className={"nav-item" + (here ? " current" : "")}
                    data-drop={p.file ? undefined : p.path}
                    title={`${p.path}\n${p.file ? "누르면 연다 · " : ""}오른쪽 단추: 색 표시 · 끌어서 순서 바꾸기`}
                    aria-current={here ? "page" : undefined}
                    onClick={(e) => (p.file ? onOpenFile(p.path) : e.ctrlKey ? onGoNewTab(p.path) : onGo(p.path))}
                    onContextMenu={(e) => openMenu(e, p.path, true)}
                    onMouseDown={(e) => {
                      if (e.button === 1 && !p.file) {
                        e.preventDefault();
                        onGoNewTab(p.path);
                      }
                    }}
                  >
                    {p.file ? <img src={iconUrl({ isDir: false, ext, path: p.path })} width={16} height={16} alt="" draggable={false} /> : <FolderGlyph />}
                    <span>{p.name}</span>
                    <TagDot color={colors.get(norm(p.path))} />
                  </button>
                  <button className="unpin" title="즐겨찾기에서 빼기" aria-label={`${p.name} 즐겨찾기에서 빼기`} onClick={() => onUnpin(p.path)}>
                    ×
                  </button>
                </div>
                {/* 프로젝트와 같게: 지금 그 과업 안에 있을 때만 자리를 펼친다. 저장소 프로젝트 안이면 그쪽이 펼치므로 겹쳐 펼치지 않는다 */}
                {areas.length > 0 && within(current, p.path) && !inStoreProject && areaList(areas)}
              </li>
            );
          })}
        </ul>
      </section>

      {places && (
        <section>
          <h2 title={`최근 ${RECENT_DAYS}일 안에 들어온 파일 수`}>들어온 곳</h2>
          <ul>
            {inbox.map((p, i) => (
              <li key={p.path}>
                {link(
                  p.path,
                  <span>{p.name}</span>,
                  "",
                  recent[i] ? <span className="count" aria-label={`최근 ${RECENT_DAYS}일 ${recent[i]}개`}>{recent[i]}</span> : null,
                )}
              </li>
            ))}
            {docs && <li>{link(docs.path, <span>{docs.name}</span>)}</li>}
          </ul>
        </section>
      )}

      <section className="drives">
        {places?.drives.map((d) => (
          <span key={d.path}>{link(d.path, <span>{baseName(d.path)}</span>, "drive", undefined, d.name)}</span>
        ))}
        <button
          className="theme-btn"
          title="화면 색 — 누를 때마다 시스템 → 밝게 → 어둡게"
          aria-label={`화면 색: ${THEME_LABEL[theme]}`}
          onClick={() => onTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
        >
          <ThemeGlyph theme={theme} />
          {THEME_LABEL[theme]}
        </button>
        <button className="settings-btn" aria-expanded={settingsOpen} title="설정 — 보기 · 문서 저장소 · 이름 규칙 · Claude 스킬 (Ctrl+,)" onClick={onSettings}>
          설정
        </button>
        {version && (
          <button className="ver-btn" title="새 판 확인 — 결과는 제목 줄에" onClick={() => checkUpdate(true)}>
            v{version}
          </button>
        )}
      </section>
      {menu && (
        <TagMenu
          x={menu.x}
          y={menu.y}
          current={colors.get(norm(menu.path))}
          onPick={(c) => pickColor(menu.path, c)}
          onClose={() => setMenu(null)}
          extra={
            menu.pin ? (
              <button
                className="tag-clear"
                role="menuitem"
                onClick={() => {
                  onUnpin(menu.path);
                  setMenu(null);
                }}
              >
                즐겨찾기에서 빼기
              </button>
            ) : undefined
          }
        />
      )}
    </nav>
  );
}
