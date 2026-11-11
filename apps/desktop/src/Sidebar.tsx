// 왼쪽 — 즐겨찾기 · 색 · 들어온 곳 · 이 PC(드라이브) · 설정.
// 탐색기의 「즐겨찾기 + 드라이브」 대신 일의 단위로 묶는다.
//
// 목차
//   [1] 상태 · 불러오기 — 색 점 · 색 개수 · 들어온 파일 수
//   [2] 끌기 — 즐겨찾기 순서 바꾸기
//   [3] 즐겨찾기 · 색 · 들어온 곳 · 이 PC · 설정
//
//   2026.11.11 : 「고정」 → 「즐겨찾기」. 파일도 더한다 (누르면 연다). 제목에 끌어다 놓으면 더하고, 항목을 끌어 순서를 바꾼다.
//   2026.11.11 : 「색」 — Finder 꼬리표처럼. 쓰인 색만 개수와 함께, 누르면 모든 폴더에서 그 색 표시를 단 것을 지금 칸에 모아 보인다.
//   2026.11.11 : 드라이브를 「C: D: E: F:」 한 줄에서 한 줄에 하나로 — 볼륨 이름과 남은 용량 띠. 드라이브가 늘거나 이름이 길어도 줄이 깨지지 않는다.
//                화면 색 단추는 설정(보기)으로 옮겼다 — 하루에 한 번도 바꾸지 않는 것이 늘 보이는 자리를 차지했다.
//   2026.11.11 : 「프로젝트」(문서 저장소의 연도별 프로젝트 · 산출물 · 자료 같은 자리)를 뺐다. 일반 파일 탐색기라 폴더에 업무 뜻을 매기지 않는다 —
//                자주 가는 곳은 즐겨찾기로 둔다.
// 항목마다 [data-drop] — 파일을 끌어다 놓으면 그 자리로 옮긴다.
import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, iconUrl, TAG_COLORS, TAG_LABEL, type Drive, type Place, type Places, type TagColor } from "./api";
import { PIN_DROP } from "./App";
import { FolderGlyph } from "./glyphs";
import TagMenu, { TagDot } from "./TagMenu";
import { checkUpdate } from "./updater";
import { formatBytes, norm } from "./util";

type Props = {
  places: Places | null;
  pinned: Place[];
  onUnpin: (path: string) => void;
  onMovePin: (from: number, to: number) => void;
  current: string;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
  onOpenFile: (path: string) => void;
  settingsOpen: boolean;
  onSettings: () => void;
};

type ColorMenu = { x: number; y: number; path: string; pin?: boolean };

/** 「들어온 곳」에 셀 최근 날 수. */
const RECENT_DAYS = 3;
/** 「이 PC」에 늘 보이는 드라이브 수. 넘으면 「N개 더」로 접는다. */
const DRIVES_SHOWN = 4;
/** 남은 용량이 이 비율 아래면 띠를 경고색으로. */
const LOW_SPACE = 0.1;

export default function Sidebar(props: Props) {
  const { places, pinned, onUnpin, onMovePin, current, onGo, onGoNewTab, onOpenFile, settingsOpen, onSettings } = props;

  // ───────── [1] 상태 · 불러오기 ─────────

  const [recent, setRecent] = useState<number[]>([]);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  /** 경로(norm) → 색. 즐겨찾기 것만. */
  const [colors, setColors] = useState<Map<string, TagColor>>(new Map());
  /** 색마다 단 항목 수 — 「색」 구획. */
  const [tagCounts, setTagCounts] = useState<Map<TagColor, number>>(new Map());
  const [menu, setMenu] = useState<ColorMenu | null>(null);
  const [moreDrives, setMoreDrives] = useState(false);
  const inbox = places ? places.known.filter((k) => k.name !== "문서") : [];
  const docs = places?.known.find((k) => k.name === "문서");

  // 색 점 — 즐겨찾기 경로의 색을 한 번에 묻는다. 목록에서 색을 바꾸면(fd:colors) 다시 묻는다.
  const colorPaths = pinned.map((p) => p.path);
  const colorKey = colorPaths.join("|");
  const loadColors = useCallback(() => {
    api
      .tagged(null)
      .then((items) => {
        const m = new Map<TagColor, number>();
        // 모은 항목에는 색이 없어 색마다 한 번 더 묻지 않고, 아래 memosOf 결과와 합쳐 센다
        return api.memosOf(items.map((e) => e.path)).then((ms) => {
          for (const x of ms) if (x.color) m.set(x.color as TagColor, (m.get(x.color as TagColor) ?? 0) + 1);
          setTagCounts(m);
        });
      })
      .catch(() => {});
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

  // ───────── [2] 끌기 ─────────

  /** 즐겨찾기 끌어 순서 바꾸기 — 누른 항목 · 놓을 자리(그 앞). */
  const [pinDrag, setPinDrag] = useState<{ from: number; y0: number; on: boolean; over: number | null } | null>(null);
  const suppressClick = useRef(false);
  const swallowClick = () => {
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 0);
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
          swallowClick();
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

  // ───────── [3] 그리기 ─────────

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

  const drives = places?.drives ?? [];
  const shownDrives = moreDrives ? drives : drives.slice(0, DRIVES_SHOWN);
  const usedColors = TAG_COLORS.filter((c) => tagCounts.has(c));

  return (
    <nav className="side" aria-label="위치" data-tauri-drag-region>
      <section>
        <h2 className="pin-head" data-drop={PIN_DROP} title="폴더 · 파일을 여기로 끌어다 놓거나 Ctrl+D 로 더한다">
          즐겨찾기
        </h2>
        {pinned.length === 0 && <p className="side-hint">폴더 · 파일을 이 제목 위로 끌어 놓거나 Ctrl+D</p>}
        <ul className={pinDrag?.on ? "pin-dragging" : undefined}>
          {pinned.map((p, i) => {
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
              </li>
            );
          })}
        </ul>
      </section>

      {usedColors.length > 0 && (
        <section>
          <h2 title="목록에서 Alt+1~7 · 오른쪽 단추로 단다">색</h2>
          <ul className="tag-list">
            {usedColors.map((c) => (
              <li key={c}>
                <button
                  className="nav-item"
                  title={`${TAG_LABEL[c]} 표시를 단 것 — 모든 폴더에서 모아 보기`}
                  onClick={() => window.dispatchEvent(new CustomEvent("fd:tagged", { detail: c }))}
                >
                  <TagDot color={c} />
                  <span>{TAG_LABEL[c]}</span>
                  <span className="count">{tagCounts.get(c)}</span>
                </button>
              </li>
            ))}
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

      {drives.length > 0 && (
        <section>
          <h2>이 PC</h2>
          <ul className="drive-list">
            {shownDrives.map((d) => (
              <li key={d.path}>{driveRow(d, current, onGo, onGoNewTab)}</li>
            ))}
            {drives.length > DRIVES_SHOWN && (
              <li>
                <button className="side-empty" aria-expanded={moreDrives} onClick={() => setMoreDrives((v) => !v)}>
                  {moreDrives ? "접기" : `드라이브 ${drives.length - DRIVES_SHOWN}개 더`}
                </button>
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="side-foot">
        <button className="settings-btn" aria-expanded={settingsOpen} title="설정 — 보기 · 종류 · 화면 색 · Claude 스킬 (Ctrl+,)" onClick={onSettings}>
          설정
        </button>
        {version && (
          <button className="ver-btn" title="새 판 확인 — 결과는 제목 줄에" onClick={() => checkUpdate(true)}>
            v{version}
          </button>
        )}
      </div>
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

/** 드라이브 한 줄 — 문자 · 볼륨 이름 · 남은 용량, 그 밑에 쓴 만큼 찬 띠. 용량을 모르면(네트워크 · CD) 띠 없이 종류만. */
function driveRow(d: Drive, current: string, onGo: (p: string) => void, onGoNewTab: (p: string) => void) {
  const here = norm(d.path) === norm(current);
  const used = d.total > 0 ? 1 - d.free / d.total : 0;
  const low = d.total > 0 && d.free / d.total < LOW_SPACE;
  const kindText = d.kind === "network" ? "네트워크" : d.kind === "cd" ? "CD" : d.kind === "removable" ? "이동식" : "";
  const sizeText = d.total > 0 ? `${formatBytes(d.free)} 남음 / ${formatBytes(d.total)}` : kindText;
  return (
    <button
      className={"nav-item drive" + (here ? " current" : "")}
      data-drop={d.path}
      title={`${d.label} (${d.path.slice(0, 2)})\n${sizeText}`}
      aria-current={here ? "page" : undefined}
      onClick={(e) => (e.ctrlKey ? onGoNewTab(d.path) : onGo(d.path))}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onGoNewTab(d.path);
        }
      }}
    >
      <span className="drive-letter">{d.path.slice(0, 2)}</span>
      <span className="drive-label">{d.label}</span>
      <span className={"drive-free" + (low ? " low" : "")}>{d.total > 0 ? `${formatBytes(d.free)}` : kindText}</span>
      {d.total > 0 && (
        <span className={"drive-bar" + (low ? " low" : "")} aria-hidden="true">
          <span style={{ width: `${Math.round(used * 100)}%` }} />
        </span>
      )}
    </button>
  );
}
