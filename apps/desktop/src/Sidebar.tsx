// 왼쪽 — 프로젝트(문서 저장소의 연도별 프로젝트) · 고정 위치 · 들어온 곳 · 드라이브 · 화면 색 · 판(누르면 새 판 확인).
// 탐색기의 「즐겨찾기 + 드라이브」 대신 일의 단위로 묶는다.
//   프로젝트: 올해는 펼쳐 두고 지난 해는 접는다. 지금 있는 프로젝트만 그 자리(산출물 · 자료 …)를 펼친다 — 다른 프로젝트의 자리까지 깔면 길어진다.
//   2026.11.11 : 화면 말 「사업」 → 「프로젝트」 (사업은 회사 일에만 맞는 말이라). 저장소 안 폴더 이름 `사업\` 은 그대로다.
//   자리 역할은 왼쪽 끝 표시 모양으로 말한다 (정본 실선 · 받은 것 점선 · 보관 흐림). 글자 이름도 title 에 둔다.
// 항목마다 [data-drop] — 파일을 끌어다 놓으면 그 자리로 옮긴다.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Area, type PinnedInfo, type Place, type Places, type StoreYear, type Theme } from "./api";
import { getVersion } from "@tauri-apps/api/app";
import { Chevron, FolderGlyph, ThemeGlyph } from "./glyphs";
import { checkUpdate } from "./updater";
import { baseName, errText, norm, ROLE_LABEL } from "./util";

type Props = {
  places: Places | null;
  /** 프로젝트 단위 문서 저장소. 빈 글자면 아직 설정을 읽지 않았다. */
  storeRoot: string;
  pinned: Place[];
  onUnpin: (path: string) => void;
  current: string;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
  theme: Theme;
  onTheme: (t: Theme) => void;
};

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

export default function Sidebar({ places, storeRoot, pinned, onUnpin, current, onGo, onGoNewTab, theme, onTheme }: Props) {
  const [years, setYears] = useState<StoreYear[]>([]);
  const [openYears, setOpenYears] = useState<Set<string>>(new Set([THIS_YEAR]));
  const [recent, setRecent] = useState<number[]>([]);
  /** 고정 위치 중 과업 루트(산출물이 있는 폴더)와 그 자리 — 저장소 밖 과업 루트도 자리로 바로 가게. */
  const [pinInfo, setPinInfo] = useState<PinnedInfo[]>([]);
  useEffect(() => {
    api.pinnedInfo(pinned.map((p) => p.path)).then(setPinInfo).catch(() => setPinInfo([]));
  }, [pinned]);
  const pinAreas = (path: string): Area[] => pinInfo.find((i) => norm(i.path) === norm(path))?.areas ?? [];
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const inbox = places ? places.known.filter((k) => k.name !== "문서") : [];
  const docs = places?.known.find((k) => k.name === "문서");

  const loadStore = useCallback(() => {
    if (!storeRoot) return;
    api.storeProjects(storeRoot).then(setYears).catch(() => setYears([]));
  }, [storeRoot]);
  useEffect(loadStore, [loadStore]);

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

  const link = (path: string, label: React.ReactNode, cls = "", extra?: React.ReactNode, title?: string) => (
    <button
      className={"nav-item " + cls + (norm(path) === norm(current) ? " current" : "")}
      data-drop={path}
      title={title ?? path}
      aria-current={norm(path) === norm(current) ? "page" : undefined}
      onClick={(e) => (e.ctrlKey ? onGoNewTab(path) : onGo(path))}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onGoNewTab(path);
        }
      }}
    >
      {label}
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

  return (
    <nav className="side" aria-label="위치" data-tauri-drag-region>
      {storeRoot && (
        <section>
          <div className="side-head">
            <h2 title={storeRoot}>프로젝트</h2>
            <button className="side-add" title={`${THIS_YEAR}년 새 프로젝트 — 산출물 · 자료 · 아카이브 자리를 만든다`} onClick={() => {
              setAdding(true);
              setAddErr("");
              requestAnimationFrame(() => addRef.current?.focus());
            }}>
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
                  <ul>
                    {y.projects.map((p) => {
                      const here = within(current, p.path);
                      return (
                        <li key={p.path}>
                          {link(p.path, <span className="project-name">{p.name}</span>, "project")}
                          {here && p.areas.length > 0 && (
                            <ul className="areas">
                              {p.areas.map((a) => (
                                <li key={a.path}>
                                  {link(a.path, <span>{a.name}</span>, `area role-${a.role}`, undefined, `${a.name} · ${ROLE_LABEL[a.role]}`)}
                                </li>
                              ))}
                            </ul>
                          )}
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

      {pinned.length > 0 && (
        <section>
          <h2 title="Ctrl+D 로 지금 폴더를 고정한다">고정</h2>
          <ul>
            {pinned.map((p) => {
              const areas = pinAreas(p.path);
              return (
                <li key={p.path}>
                  <div className="row-with-x">
                    {link(p.path, <><FolderGlyph /><span>{p.name}</span></>)}
                    <button className="unpin" title="고정 해제" aria-label={`${p.name} 고정 해제`} onClick={() => onUnpin(p.path)}>
                      ×
                    </button>
                  </div>
                  {/* 프로젝트와 같게: 지금 그 과업 안에 있을 때만 자리를 펼친다. 저장소 프로젝트 안이면 그쪽이 펼치므로 겹쳐 펼치지 않는다 */}
                  {areas.length > 0 && within(current, p.path) && !inStoreProject && (
                    <ul className="areas">
                      {areas.map((a) => (
                        <li key={a.path}>
                          {link(a.path, <span>{a.name}</span>, `area role-${a.role}`, undefined, `${a.name} · ${ROLE_LABEL[a.role]}`)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
        {version && (
          <button className="ver-btn" title="새 판 확인 — 결과는 제목 줄에" onClick={() => checkUpdate(true)}>
            v{version}
          </button>
        )}
      </section>
    </nav>
  );
}
