// 왼쪽 — 이 PC(바탕화면 · 다운로드 · 문서 · 드라이브) · 연결(NAS · 공유 폴더) · 색 표시 · 최근 파일 · 설정.
// 탐색기의 「즐겨찾기 + 드라이브」 대신 일의 단위로 묶는다.
//
// 목차
//   [1] 상태 · 불러오기 — 색 개수 · 최근 파일 · 연결 더하기
//   [2] 이 PC · 연결 · 색 표시 · 최근 파일 · 설정
//
//   2026.11.11 : 늘 같은 셋(바탕화면 · 다운로드 · 문서)은 세 칸 그림으로 — 고정된 자리라 글 목록으로 읽을 까닭이 없고, 그림 자리를 손이 외운다.
//                「연결」을 더했다 — NAS · 공유 폴더(\\서버\공유)를 등록해 둔다. 즐겨찾기와 같은 꼴(Place)이고 자리만 다르다.
//                「새 파일」 → 「최근 파일」, 맨 아래로. 설정(보기 › 보일 것)에서 끈다.
//   2026.11.11 : 즐겨찾기를 아래 독(FavDock)으로 옮겼다 — 숨어 있다가 마우스를 대면 올라온다.
//   2026.11.11 : 「고정」 → 「즐겨찾기」. 파일도 더한다 (누르면 연다). 제목에 끌어다 놓으면 더하고, 항목을 끌어 순서를 바꾼다.
//   2026.11.11 : 「색」 — Finder 꼬리표처럼. 쓰인 색만 개수와 함께, 누르면 모든 폴더에서 그 색 표시를 단 것을 지금 칸에 모아 보인다.
//   2026.11.11 : 드라이브를 「C: D: E: F:」 한 줄에서 한 줄에 하나로 — 볼륨 이름과 남은 용량 띠. 드라이브가 늘거나 이름이 길어도 줄이 깨지지 않는다.
//                화면 색 단추는 설정(보기)으로 옮겼다 — 하루에 한 번도 바꾸지 않는 것이 늘 보이는 자리를 차지했다.
//   2026.11.11 : 「프로젝트」(문서 저장소의 연도별 프로젝트 · 산출물 · 자료 같은 자리)를 뺐다. 일반 파일 탐색기라 폴더에 업무 뜻을 매기지 않는다 —
//                자주 가는 곳은 즐겨찾기로 둔다.
//   2026.11.11 : 「들어온 곳」(다운로드 · 바탕화면 + 새 파일 수)을 걷었다. 숫자만으로는 무엇이 들어왔는지 몰라 폴더를 열어 봐야 했고,
//                「들어온 곳」이라는 묶음도 뜻을 짐작해야 했다. 폴더 셋은 탐색기처럼 「이 PC」 맨 위로, 새 파일은 「새 파일」에 이름 그대로 보인다.
// 항목마다 [data-drop] — 파일을 끌어다 놓으면 그 자리로 옮긴다.
import { useCallback, useEffect, useState } from "react";
import { api, iconUrl, TAG_COLORS, TAG_LABEL, type Drive, type Entry, type Place, type Places, type TagColor, type ViewPrefs } from "./api";
import { LINK_DROP } from "./App";
import { FileGlyph, PlaceGlyph } from "./glyphs";
import { TagDot } from "./TagMenu";
import { baseName, errText, formatBytes, formatDate, norm, packIconUrl, parentOf } from "./util";

type Props = {
  places: Places | null;
  links: Place[];
  onAddLinks: (paths: string[]) => void;
  onUnlink: (path: string) => void;
  view: ViewPrefs;
  current: string;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
  onOpenFile: (path: string) => void;
  settingsOpen: boolean;
  onSettings: () => void;
};

/** 「최근 파일」로 볼 최근 날 수. */
const RECENT_DAYS = 3;
/** 「최근 파일」에 늘 보이는 수. 넘으면 「N개 모두 보기」로 칸에 띄운다. */
const FRESH_SHOWN = 5;
/** 「이 PC」에 늘 보이는 드라이브 수. 넘으면 「N개 더」로 접는다. */
const DRIVES_SHOWN = 4;
/** 남은 용량이 이 비율 아래면 띠를 경고색으로. */
const LOW_SPACE = 0.1;

export default function Sidebar(props: Props) {
  const { places, links, onAddLinks, onUnlink, view, current, onGo, onGoNewTab, onOpenFile, settingsOpen, onSettings } = props;

  // ───────── [1] 상태 · 불러오기 ─────────

  const [fresh, setFresh] = useState<Entry[] | null>(null);
  /** 색마다 단 항목 수 — 「색」 구획. */
  const [tagCounts, setTagCounts] = useState<Map<TagColor, number>>(new Map());
  const [moreDrives, setMoreDrives] = useState(false);
  /** 받은 파일이 쌓이는 곳 — 다운로드 · 바탕화면. 문서 폴더는 사람이 정리해 두는 곳이라 「최근 파일」에 넣지 않는다. */
  const inbox = places ? places.known.filter((k) => k.name !== "문서") : [];

  // 색 개수 — 목록에서 색을 바꾸면(fd:colors) 다시 센다.
  const loadColors = useCallback(() => {
    api
      .tagged(null)
      .then((items) => {
        const m = new Map<TagColor, number>();
        // 모은 항목에는 색이 없어 색마다 한 번 더 묻지 않고, memosOf 결과로 센다
        return api.memosOf(items.map((e) => e.path)).then((ms) => {
          for (const x of ms) if (x.color) m.set(x.color as TagColor, (m.get(x.color as TagColor) ?? 0) + 1);
          setTagCounts(m);
        });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadColors();
    window.addEventListener("fd:colors", loadColors);
    return () => window.removeEventListener("fd:colors", loadColors);
  }, [loadColors]);

  // 최근 파일 — 열 때 · 1분마다. 꺼 두었으면 묻지 않는다.
  const inboxKey = inbox.map((p) => p.path).join("|");
  useEffect(() => {
    if (!inbox.length || !view.recent) return;
    const run = () => api.recentFiles(inbox.map((p) => p.path), RECENT_DAYS).then(setFresh).catch(() => {});
    run();
    const t = window.setInterval(run, 60000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxKey, view.recent]);

  // 연결 더하기 — 주소를 받아 열리는지 본 뒤 더한다. 꺼진 NAS 는 몇 초 걸릴 수 있어 「확인 중」을 보인다.
  const [adding, setAdding] = useState(false);
  const [addr, setAddr] = useState("");
  const [addState, setAddState] = useState<{ busy: boolean; err: string }>({ busy: false, err: "" });
  const submitLink = () => {
    const raw = addr.trim().replace(/^"(.*)"$/, "$1");
    const path = raw.length > 3 ? raw.replace(/\\+$/, "") : raw;
    if (!path) return;
    setAddState({ busy: true, err: "" });
    api
      .dirsOf([path])
      .then(([ok]) => {
        if (!ok) return setAddState({ busy: false, err: "열 수 없다 — 주소와 연결 상태를 확인한다" });
        onAddLinks([path]);
        setAddr("");
        setAdding(false);
        setAddState({ busy: false, err: "" });
      })
      .catch((e) => setAddState({ busy: false, err: errText(e) }));
  };

  // ───────── [2] 그리기 ─────────

  const drives = places?.drives ?? [];
  const shownDrives = moreDrives ? drives : drives.slice(0, DRIVES_SHOWN);
  const usedColors = TAG_COLORS.filter((c) => tagCounts.has(c));
  const here = norm(current);
  /** 자리로 가는 단추의 공통 — 놓을 자리 · 지금 자리 표시 · Ctrl / 가운데 단추는 새 탭. */
  const nav = (path: string) => ({
    "data-drop": path,
    "aria-current": norm(path) === here ? ("page" as const) : undefined,
    onClick: (e: React.MouseEvent) => (e.ctrlKey ? onGoNewTab(path) : onGo(path)),
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        onGoNewTab(path);
      }
    },
  });

  return (
    <nav className="side" aria-label="위치" data-tauri-drag-region>
      {places && (
        <section>
          <h2>이 PC</h2>
          {/* 늘 같은 셋 — 세 칸 그림. 자리가 고정이라 손이 외운다 */}
          <div className="known-grid">
            {places.known.map((k) => (
              <button key={k.path} className={"known-tile" + (norm(k.path) === here ? " current" : "")} title={k.path} {...nav(k.path)}>
                <PlaceGlyph kind={k.name === "바탕화면" ? "desktop" : k.name === "다운로드" ? "download" : "docs"} />
                <span>{k.name}</span>
              </button>
            ))}
          </div>
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

      <section>
        <h2 className="side-head" data-drop={LINK_DROP} title="NAS · 공유 폴더처럼 드라이브 문자 없이 가는 자리 — 폴더를 이 제목으로 끌어다 놓아도 더한다">
          <span>연결</span>
          <button className="head-add" aria-label="연결 더하기" aria-expanded={adding} title={"주소로 더하기 (\\\\서버\\공유)"} onClick={() => setAdding((v) => !v)}>
            +
          </button>
        </h2>
        {adding && (
          <form
            className="link-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitLink();
            }}
          >
            <input
              autoFocus
              value={addr}
              placeholder={"\\\\NAS\\공유"}
              aria-label="연결할 주소"
              spellCheck={false}
              disabled={addState.busy}
              onChange={(e) => setAddr(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setAdding(false);
                  setAddState({ busy: false, err: "" });
                }
              }}
            />
            <p className={"side-hint" + (addState.err ? " warn" : "")} role="status">
              {addState.busy ? "확인 중" : addState.err || "Enter 로 더한다 · Esc 로 닫는다"}
            </p>
          </form>
        )}
        {links.length === 0 && !adding && <p className="side-hint">NAS · 공유 폴더를 + 로 더하거나, 폴더를 제목에 끌어 놓는다</p>}
        {links.length > 0 && (
          <ul>
            {links.map((l) => (
              <li key={l.path} className="side-row">
                <button className={"nav-item" + (norm(l.path) === here ? " current" : "")} title={`${l.path}\n가운데 단추 · Ctrl: 새 탭`} {...nav(l.path)}>
                  <PlaceGlyph kind="net" size={16} />
                  <span>{l.name}</span>
                  <span className="count">{hostOf(l.path)}</span>
                </button>
                <button className="side-x" title="연결에서 빼기" aria-label={`${l.name} 연결에서 빼기`} onClick={() => onUnlink(l.path)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {usedColors.length > 0 && (
        <section>
          <h2 title="목록에서 Alt+1~7 · 오른쪽 단추로 단다">색 표시</h2>
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

      {view.recent && inbox.length > 0 && fresh && (
        <section>
          <h2 title={`${inbox.map((p) => p.name).join(" · ")}에 최근 ${RECENT_DAYS}일 안에 새로 생기거나 바뀐 파일 — 최근 것부터 · 설정 › 보기에서 끈다`}>최근 파일</h2>
          {fresh.length === 0 && <p className="side-hint">최근 {RECENT_DAYS}일 동안 없다</p>}
          <ul>
            {fresh.slice(0, FRESH_SHOWN).map((f) => (
              <li key={f.path}>
                <button className="nav-item" title={`${f.path}\n고친 날 ${formatDate(f.modified)} · 누르면 연다`} onClick={() => onOpenFile(f.path)}>
                  {fileIcon(f, view)}
                  <span>{f.name}</span>
                  <span className="count">{baseName(parentOf(f.path) ?? "")}</span>
                </button>
              </li>
            ))}
            {fresh.length > 0 && (
              <li>
                <button
                  className="side-empty"
                  title="지금 칸에 목록으로 띄운다 — 옮기기 · 지우기 · 이름 바꾸기를 거기서 한다"
                  onClick={() => window.dispatchEvent(new CustomEvent("fd:recent", { detail: { dirs: inbox.map((p) => p.path), days: RECENT_DAYS } }))}
                >
                  {fresh.length > FRESH_SHOWN ? `${fresh.length}개 모두 보기` : "목록으로 보기"}
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
      </div>
    </nav>
  );
}

/** 드라이브 한 줄 — 문자 · 볼륨 이름 · 남은 용량, 그 밑에 쓴 만큼 찬 띠. 용량을 모르면(네트워크 · CD) 띠 없이 종류만. */
function driveRow(d: Drive, current: string, onGo: (p: string) => void, onGoNewTab: (p: string) => void) {
  const here = norm(d.path) === norm(current);
  const used = d.total > 0 ? 1 - d.free / d.total : 0;
  const low = d.total > 0 && d.free / d.total < LOW_SPACE;
  const kindText = d.kind === "network" ? "네트워크" : d.kind === "cd" ? "CD" : d.kind === "removable" ? "이동식 디스크" : "";
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

/** 연결 줄 오른쪽의 흐린 글 — \\서버\공유 면 서버 이름, 그 밖에는 드라이브 문자. */
function hostOf(path: string): string {
  const unc = /^[\\/]{2}([^\\/]+)/.exec(path);
  return unc ? unc[1] : path.slice(0, 2);
}

/** 최근 파일 줄 그림 — 목록과 같은 아이콘 설정을 따른다. */
function fileIcon(f: Entry, view: ViewPrefs) {
  const pack = view.icons === "pack" ? packIconUrl(f) : null;
  if (pack) return <img src={pack} width={16} height={16} alt="" draggable={false} />;
  if (view.icons !== "shell") return <FileGlyph ext={f.ext} />;
  return <img src={iconUrl(f)} width={16} height={16} alt="" draggable={false} />;
}
