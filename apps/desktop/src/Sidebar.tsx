// 왼쪽 — 이 PC(바탕화면 · 다운로드 · 문서 · 드라이브) · 연결(NAS · 공유 폴더) · 색 표시 · 스마트 폴더 · 설정.
// 탐색기의 「즐겨찾기 + 드라이브」 대신 일의 단위로 묶는다.
//
// 목차
//   [1] 상태 · 불러오기 — 색 개수 · 색인 상태 · 스마트 폴더 개수 · 연결 더하기
//   [2] 이 PC · 연결 · 색 표시 · 스마트 폴더 · 설정
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
//   2026.11.12 : 「색 표시」를 색 이름 목록 → 일곱 건반 한 줄로. 자리가 Alt+1~7 과 같고, 단 것은 찬 원 + 개수 · 안 단 것은 빈 고리.
//                목록은 쓴 색만 보여 「어떤 색이 있는지 · 몇 번인지」를 몰랐고, 점이 이름 오른쪽에 붙어 줄이 어긋나 보였다.
//                건반에 파일을 끌어 놓으면 그 색을 단다.
//   2026.11.12 : 「연결」을 서버별로 묶었다 — 서버 이름 한 줄 밑에 그 공유들. 열 수 없는 공유는 흐리게 「끊김」.
//                제목의 「+」를 눌러야 나오던 주소 칸을 늘 맨 아래에 둔다 — 비었을 때의 긴 안내 글도 그 칸의 자리 글 하나로 줄었다.
//   2026.11.12 : 「연결」은 설정(보기 › 보일 것)에서 켜야 보인다 — NAS 를 쓰지 않는 사람에게는 늘 빈 구획이었다. 이미 연결을 둔 사람은 켠 채로 읽는다.
//   2026.11.12 : 「최근 파일」 → 「스마트 폴더」. 최근 파일은 처음부터 있는 스마트 폴더 하나(다운로드 · 바탕화면 · 고친:3일)가 되어
//                날 수 · 볼 곳을 고칠 수 있다. 다른 스마트 폴더는 이름과 맞는 개수 한 줄씩, 누르면 지금 칸에 모아 보인다. 맨 아래에 색인 상태 한 줄.
//   2026.11.13 : 「연결」 주소 칸이 서버 주소를 알아듣는다 — `192.168.0.2` · `\nas` · `smb://nas/공유` 를 적으면 공유 목록을 보여 고르게 하고,
//                로그인이 필요하면 Windows 로그인 창을 띄운다. 전에는 경로 확인만 해서 서버만 적으면 늘 「열 수 없다」였다.
//                칸을 누르면 「이 PC 에서 쓰던 곳」(네트워크 드라이브 · 탐색기 네트워크 위치 · 탐색기 주소 기록)을 띄워 한 번 눌러 더한다.
//   2026.11.20 : 주소 칸 · 고르는 판을 왼쪽 열에서 가운데 「연결 추가」 창으로 옮겼다 — 좁은 열 안에서 단추가 넘쳤다. 왼쪽에는 「＋ 연결 추가」 한 줄.
//   2026.11.12 : 「최근 파일」 밑에 파일 다섯 개를 이름 그대로 늘어놓던 것을 걷었다 — 스마트 폴더로 바꾼 뒤에도 파일이 왼쪽 열에 바로 올라와
//                구획이 「폴더 목록」이 아니라 「파일 목록」으로 읽혔다. 이제 모든 스마트 폴더가 이름과 개수 한 줄이고, 파일은 누르면 칸에서 본다.
// 항목마다 [data-drop] — 파일을 끌어다 놓으면 그 자리로 옮긴다.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, appIconUrl, TAG_COLORS, TAG_LABEL, type AppPin, type Drive, type HubStatus, type Place, type Places, type SmartFolder, type TagColor, type ViewPrefs } from "./api";
import { APP_DROP, LINK_DROP, TAG_DROP } from "./App";
import { PlaceGlyph } from "./glyphs";
import { ago, kindTable, remoteOnly, scopeLabel, scopeOf, tzOffset } from "./query";
import { baseName, errText, formatBytes, norm } from "./util";

type Props = {
  places: Places | null;
  links: Place[];
  onAddLinks: (paths: string[]) => void;
  /** 「앱」에 고정한 앱 · 열기 · 빼기 · 더하기(팔레트를 앱 고정으로 연다). */
  apps: AppPin[];
  onLaunchApp: (id: string) => void;
  onUnpinApp: (id: string) => void;
  onAddApp: () => void;
  onUnlink: (path: string) => void;
  view: ViewPrefs;
  current: string;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
  settingsOpen: boolean;
  onSettings: () => void;
  smart: SmartFolder[];
  /** 다운로드 · 바탕화면. */
  inbox: string[];
  onOpenSmart: (f: SmartFolder) => void;
  onEditSmart: (f: SmartFolder) => void;
  onNewSmart: () => void;
};

/** 스마트 폴더 개수를 다시 세는 간격(ms). */
const SMART_COUNT = 60000;
/** 개수를 셀 때의 상한 — 넘으면 「2000+」. */
const COUNT_LIMIT = 2000;
/** 「이 PC」에 늘 보이는 드라이브 수. 넘으면 「N개 더」로 접는다. */
const DRIVES_SHOWN = 4;
/** 남은 용량이 이 비율 아래면 띠를 경고색으로. */
const LOW_SPACE = 0.1;
/** 연결이 열리는지 다시 보는 간격(ms). 꺼진 NAS 는 묻는 데 몇 초 걸려 자주 묻지 않는다. */
const LINK_CHECK = 60000;

export default function Sidebar(props: Props) {
  const { places, links, onAddLinks, onUnlink, view, current, onGo, onGoNewTab, settingsOpen, onSettings, smart, inbox, onOpenSmart, onEditSmart, onNewSmart, apps, onLaunchApp, onUnpinApp, onAddApp } = props;

  // ───────── [1] 상태 · 불러오기 ─────────

  /** 스마트 폴더마다 맞는 개수 (넘쳤으면 truncated). */
  const [counts, setCounts] = useState<Map<string, { n: number; more: boolean }>>(new Map());
  const [hub, setHub] = useState<HubStatus | null>(null);
  /** 색마다 단 항목 수 — 「색」 구획. */
  const [tagCounts, setTagCounts] = useState<Map<TagColor, number>>(new Map());
  const [moreDrives, setMoreDrives] = useState(false);

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

  // 색인 상태 — 30초마다. 스마트 폴더 개수를 셀지(「모든 드라이브」는 색인이 다 선 뒤에만) 여기서 정한다.
  useEffect(() => {
    if (!view.recent) return;
    const run = () => api.indexStatus().then(setHub).catch(() => {});
    run();
    const t = window.setInterval(run, 30000);
    return () => window.clearInterval(t);
  }, [view.recent]);
  const indexReady = !!hub && hub.index.volumes.length > 0 && hub.index.volumes.every((v) => v.state !== "building" && v.state !== "rebuild");

  // 스마트 폴더 개수 — 열 때 · 1분마다 뒤에서 센다 (칸의 찾기를 멈추지 않게 background). NAS 뿐인 것 · 색인이 서지 않은 「모든 드라이브」는 세지 않는다.
  const smartKey = JSON.stringify(smart) + inbox.join("|") + JSON.stringify(view.kinds);
  useEffect(() => {
    if (!view.recent || !smart.length) return;
    let alive = true;
    const run = async () => {
      for (const f of smart) {
        if (!alive) return;
        if (remoteOnly(f.scope) || (f.scope.kind === "all" && !indexReady) || (f.scope.kind === "inbox" && !inbox.length)) continue;
        try {
          const r = await api.queryFiles({ scope: scopeOf(f.scope, inbox), text: f.q, kinds: kindTable(view.kinds), tzOffsetMin: tzOffset(), limit: COUNT_LIMIT, background: true });
          if (!alive) return;
          setCounts((m) => new Map(m).set(f.id, { n: r.items.length, more: r.truncated }));
        } catch {
          /* 다음 차례에 */
        }
      }
    };
    void run();
    const t = window.setInterval(run, SMART_COUNT);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartKey, view.recent, indexReady]);

  // 연결 더하기 — 주소를 풀어(서버 주소 · smb:// · \서버\공유) 고르는 판을 연다. 서버면 공유 목록부터, 공유 · 폴더면 그 안부터.
  // 꺼진 NAS · 로그인 창은 몇 초 걸릴 수 있어 「확인 중」을 보인다.
  // 2026.11.18 : 사용자 요청. 공유 맨 위만 보이고 누르면 바로 더해져, 공유 안의 폴더를 연결로 둘 수 없었다.
  //   이제 두 번 누르거나 › 로 하위 폴더에 들어가고, 한 번 누르면 고르기만 하고, 「추가」 단추로 더한다.
  const [addr, setAddr] = useState("");
  const [addState, setAddState] = useState<{ busy: boolean; err: string }>({ busy: false, err: "" });
  /** 연결할 곳 고르는 판. */
  const [pick, setPick] = useState<Browse | null>(null);
  const browseSeq = useRef(0);
  /** 주소 칸을 누르면 보이는 「이 PC 에서 쓰던 곳」. 칸을 누를 때마다 다시 읽는다 (탐색기에서 방금 붙였을 수 있다). */
  const [known, setKnown] = useState<{ path: string; source: string }[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const linked = new Set(links.map((l) => norm(l.path)));
  const closeForm = () => {
    setAddr("");
    setPick(null);
    setFormOpen(false);
    setAddState({ busy: false, err: "" });
  };
  /** 판을 `at` 폴더로 연다 (null 이면 서버의 공유 목록). 폴더면 하위 폴더를 읽는다 — 늦게 온 답은 버린다. */
  const browseTo = (b: Omit<Browse, "dirs" | "sel" | "err">) => {
    const seq = ++browseSeq.current;
    const listed = b.at == null && b.shares ? b.shares.map((sh) => shareAt(b.server, sh)) : null;
    setPick({ ...b, dirs: listed, sel: null, err: "" });
    if (b.at == null) return;
    api
      .listDir(b.at, false)
      .then((es) => seq === browseSeq.current && setPick((x) => x && { ...x, dirs: es.filter((e) => e.isDir).map((e) => e.path) }))
      .catch((e) => seq === browseSeq.current && setPick((x) => x && { ...x, dirs: [], err: errText(e).replace(/^\[\w+\] /, "") }));
  };
  const resolveLink = (input: string) => {
    if (!input.trim()) return;
    setAddState({ busy: true, err: "" });
    setPick(null);
    api
      .netResolve(input)
      .then((t) => {
        setAddState({ busy: false, err: "" });
        if (t.shares) return browseTo({ server: t.path, shares: t.shares, at: null });
        // 공유 · 폴더 주소 — 그 안부터 보인다. 서버(\\nas)를 알면 위로 올라가 다른 공유도 고를 수 있다.
        browseTo({ server: serverOf(t.path) ?? t.path, shares: null, at: t.path });
      })
      .catch((e) => setAddState({ busy: false, err: errText(e) }));
  };
  /** 서버의 공유 목록으로 — 경로 줄 맨 앞 서버 마디. 공유 주소로 들어왔으면 그때 목록을 묻는다. */
  const goShares = () => {
    if (!pick?.at) return;
    if (pick.shares) return browseTo({ ...pick, at: null });
    setAddState({ busy: true, err: "" });
    api
      .netResolve(pick.server)
      .then((t) => {
        setAddState({ busy: false, err: "" });
        if (t.shares) browseTo({ server: t.path, shares: t.shares, at: null });
      })
      .catch((e) => setAddState({ busy: false, err: errText(e) }));
  };
  /** 고른 곳(없으면 지금 들어와 있는 폴더)을 연결에 더한다. 판은 남긴다 — 여러 곳을 잇달아 더하게. */
  const addPicked = () => {
    const target = pick?.sel ?? pick?.at;
    if (!target || linked.has(norm(target))) return;
    onAddLinks([target]);
  };
  const openForm = () => {
    if (formOpen) return;
    browseSeq.current++; // 닫은 뒤 늦게 온 답이 새 창에 지난 판을 띄우지 않게
    setPick(null);
    setFormOpen(true);
    api
      .netKnown()
      .then(setKnown)
      .catch(() => setKnown([]));
  };
  const suggestions = (known ?? []).filter((k) => !linked.has(norm(k.path)));

  // 연결이 열리는가 — 열 때 · 연결이 바뀔 때 · 1분마다. 모르는 동안(null)은 열린 것처럼 그린다
  const [offline, setOffline] = useState<Set<string> | null>(null);
  const linkKey = links.map((l) => l.path).join("|");
  useEffect(() => {
    if (!links.length) return setOffline(null);
    const run = () =>
      api
        .dirsOf(links.map((l) => l.path))
        .then((ok) => setOffline(new Set(links.filter((_, i) => !ok[i]).map((l) => norm(l.path)))))
        .catch(() => {});
    run();
    const t = window.setInterval(run, LINK_CHECK);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  // ───────── [2] 그리기 ─────────

  const drives = places?.drives ?? [];
  const shownDrives = moreDrives ? drives : drives.slice(0, DRIVES_SHOWN);
  /** 서버 이름 → 그 공유들. 등록한 순서를 지킨다. */
  const hosts = new Map<string, Place[]>();
  for (const l of links) hosts.set(hostOf(l.path), [...(hosts.get(hostOf(l.path)) ?? []), l]);
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
    <nav className="side" aria-label="위치">
      {/* 창 끌기는 제목 줄 옆 띠에서만. 2026.11.18 : 사용자 지적 — 왼쪽 열 전체가 끌기 자리여서 항목 사이 빈 곳 · 목록 아래를 누르고 끌어도 창이 움직였다 */}
      <div className="side-drag" data-tauri-drag-region aria-hidden="true" />
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

      {/* 앱 — 자주 여는 프로그램. 2026.11.18 : 사용자 요청. 파일을 찾다가 그 파일을 다룰 앱을 여는 일이 잦다 */}
      <section>
        <h2 className="side-head" data-drop={APP_DROP}>
          앱
          <button className="side-add" aria-label="앱 고정" title="앱 고정" onClick={onAddApp}>
            ＋
          </button>
        </h2>
        <ul>
          {apps.map((a) => (
            <li key={a.id} className="side-row">
              <button className="nav-item app-item" title={`${a.name} 열기`} onClick={() => onLaunchApp(a.id)}>
                <img src={appIconUrl(a.icon, 16)} width={16} height={16} alt="" draggable={false} />
                <span>{a.name}</span>
              </button>
              <button className="side-x" title="앱에서 빼기" aria-label={`${a.name} 앱에서 빼기`} onClick={() => onUnpinApp(a.id)}>
                ×
              </button>
            </li>
          ))}
          {apps.length === 0 && (
            <li>
              <button className="side-empty" onClick={onAddApp}>
                앱 고정
              </button>
            </li>
          )}
        </ul>
      </section>

      {view.links && (
        <section>
          <h2 className="side-head" data-drop={LINK_DROP}>
            연결
          </h2>
          {[...hosts].map(([host, ls]) => {
            const down = ls.every((l) => offline?.has(norm(l.path)));
            return (
              <div key={host} className="link-host">
                <div className={"link-server" + (down ? " off" : "")} title={down ? "연결할 수 없음" : undefined}>
                  <PlaceGlyph kind="net" size={14} />
                  <span>{host}</span>
                  {down && <em>끊김</em>}
                </div>
                <ul>
                  {ls.map((l) => {
                    const off = !!offline?.has(norm(l.path));
                    return (
                      <li key={l.path} className="side-row">
                        <button
                          className={"nav-item link-share" + (norm(l.path) === here ? " current" : "") + (off ? " off" : "")}
                          title={`${l.path}${off ? "\n연결할 수 없음" : ""}\n가운데 단추 · Ctrl: 새 탭`}
                          {...nav(l.path)}
                        >
                          <span>{shareOf(l.path) ?? l.name}</span>
                          {off && !down && <span className="count">끊김</span>}
                        </button>
                        <button className="side-x" title="연결에서 제거" aria-label={`${l.name} 연결에서 제거`} onClick={() => onUnlink(l.path)}>
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {/* 늘 맨 아래 「연결 추가」 — 누르면 연결 창이 뜬다. 폴더를 끌어 놓아도 더한다.
              2026.11.20 : 사용자 요청. 주소 칸 · 고르는 판 · 추가 단추가 좁은 왼쪽 열 안에 펼쳐져 단추가 넘쳤다 — 가운데 창으로 옮겼다. */}
          <button className="side-empty link-add" data-drop={LINK_DROP} onClick={openForm}>
            ＋ 연결 추가
          </button>
        </section>
      )}
      {formOpen &&
        createPortal(
          <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeForm()}>
            <div
              className="link-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="연결 추가"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") closeForm();
              }}
            >
              <header className="link-dialog-head">
                <h2>연결 추가</h2>
                <button type="button" className="link-dialog-x" aria-label="닫기" title="닫기 (Esc)" onClick={closeForm}>
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" />
                  </svg>
                </button>
              </header>
              {/* 서버 주소를 적고 Enter 면 공유를 고른다. 처음에는 이 PC 에서 쓰던 곳이 뜬다 */}
              <form
                className="link-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  resolveLink(addr);
                }}
              >
                <div className="link-addr">
                  <input
                    autoFocus
                    value={addr}
                    placeholder="NAS · 서버 주소 (예: 192.168.0.2 · \\nas\공유)"
                    aria-label="서버 주소"
                    spellCheck={false}
                    disabled={addState.busy}
                    onChange={(e) => {
                      setAddr(e.target.value);
                      setPick(null);
                      if (addState.err) setAddState({ busy: false, err: "" });
                    }}
                  />
                  <button type="submit" className="act" disabled={addState.busy || !addr.trim()}>
                    열기
                  </button>
                </div>
                {(addState.busy || addState.err) && (
                  <p className={"side-hint" + (addState.err ? " warn" : "")} role="status">
                    {addState.busy ? "확인 중…" : addState.err}
                  </p>
                )}
                {pick && (
                  <div className="link-pick" role="group" aria-label="연결할 곳 고르기">
                    {/* 경로 줄 — 마디마다 눌러 그 자리로. 2026.11.20 : 「‹ 위로 + 끝 두 마디」 → 마디 줄. 창이 넓어 경로 전체가 들어가고,
                        몇 단계 위로 갈 때 ‹ 를 여러 번 누르지 않는다. 맨 앞 서버 마디는 공유 목록, 마지막 마디는 지금 자리(누르지 않는다) */}
                    <nav className="link-crumbs" aria-label="지금 자리">
                      {crumbsOf(pick).map((c, i, all) =>
                        i === all.length - 1 ? (
                          <span key={c.label + i} aria-current="location" title={c.path ?? pick.server}>
                            {c.label}
                          </span>
                        ) : (
                          <span key={c.label + i} className="link-crumb-step">
                            <button
                              type="button"
                              title={c.path ?? `${pick.server} 의 공유 폴더`}
                              disabled={c.path == null && !serverOf(pick.server)}
                              onClick={() => (c.path == null ? goShares() : browseTo({ ...pick, at: c.path }))}
                            >
                              {c.label}
                            </button>
                            <span aria-hidden="true">›</span>
                          </span>
                        ),
                      )}
                    </nav>
                    <div className="link-pick-list" role="listbox" aria-label="폴더">
                      {pick.dirs == null && <p className="link-pick-head">읽는 중…</p>}
                      {pick.dirs?.length === 0 && <p className={"link-pick-head" + (pick.err ? " warn" : "")}>{pick.err || "하위 폴더 없음"}</p>}
                      {pick.dirs?.map((d) => {
                        const have = linked.has(norm(d));
                        return (
                          <div
                            key={d}
                            role="option"
                            tabIndex={0}
                            aria-selected={pick.sel === d}
                            className={"link-pick-row" + (pick.sel === d ? " sel" : "")}
                            onClick={() => setPick({ ...pick, sel: pick.sel === d ? null : d })}
                            onDoubleClick={() => browseTo({ ...pick, at: d })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") browseTo({ ...pick, at: d });
                              else if (e.key === " ") setPick({ ...pick, sel: d });
                              else return;
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <PlaceGlyph kind="net" size={14} />
                            <span>{baseName(d)}</span>
                            {have && <em>추가됨</em>}
                            <button
                              type="button"
                              className="link-in"
                              tabIndex={-1}
                              title="안으로 들어가기 (두 번 누르기 · Enter)"
                              aria-label={`${baseName(d)} 안으로`}
                              onClick={(e) => {
                                e.stopPropagation();
                                browseTo({ ...pick, at: d });
                              }}
                            >
                              ›
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {(() => {
                      const target = pick.sel ?? pick.at;
                      const have = !!target && linked.has(norm(target));
                      return (
                        <div className="link-pick-foot">
                          <button type="button" className="act primary" disabled={!target || have} onClick={addPicked} title={target ?? undefined}>
                            {!target ? "폴더 선택" : have ? "추가됨" : `「${baseName(target)}」 추가`}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                )}
                {formOpen && !pick && !addr && !addState.busy && !addState.err && (
                  <div className="link-pick" role="group" aria-label="이 PC 에서 쓰던 네트워크 위치">
                    {suggestions.length > 0 && <p className="link-pick-head">이 PC에서 쓰던 위치</p>}
                    {suggestions.map((k) => (
                      <button key={k.path} type="button" className="link-pick-row" title={k.path} onClick={() => resolveLink(k.path)}>
                        <PlaceGlyph kind="net" size={14} />
                        <span>{k.path.replace(/^[\\/]+/, "")}</span>
                        <em>{k.source}</em>
                      </button>
                    ))}
                    {known && !suggestions.length && <p className="link-pick-head">예: 192.168.0.2 · \\nas\공유</p>}
                  </div>
                )}
              </form>
            </div>
          </div>,
          document.body,
        )}

      <section>
        <h2>색 표시</h2>
        {/* 일곱 건반 — 자리가 Alt+1~7 과 같다. 단 것은 찬 원 밑에 개수, 안 단 것은 빈 고리 */}
        <div className="tag-keys" role="toolbar" aria-label="색 표시 모아 보기">
          {TAG_COLORS.map((c, i) => {
            const n = tagCounts.get(c) ?? 0;
            return (
              <button
                key={c}
                className={`tag-key tag-${c}` + (n ? " used" : "")}
                data-drop={TAG_DROP + c}
                aria-label={`${TAG_LABEL[c]} ${n}개`}
                title={n ? `${TAG_LABEL[c]} ${n}개 (Alt+${i + 1})` : `${TAG_LABEL[c]} 없음 (Alt+${i + 1})`}
                onClick={() => n && window.dispatchEvent(new CustomEvent("fd:tagged", { detail: c }))}
              >
                <span className="tag-key-dot" />
                <span className="tag-key-n">{n || ""}</span>
              </button>
            );
          })}
        </div>
      </section>

      {view.recent && (
        <section className="smart-section">
          <h2 className="side-head">
            스마트 폴더
            <button className="side-add" aria-label="새 스마트 폴더" title="새 스마트 폴더" onClick={onNewSmart}>
              ＋
            </button>
          </h2>
          <ul>
            {smart.map((f) => {
              const c = counts.get(f.id);
              return (
                <li key={f.id}>
                  <button
                    className="nav-item smart-item"
                    title={`${f.q}\n${scopeLabel(f.scope)}`}
                    onClick={() => onOpenSmart(f)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onEditSmart(f);
                    }}
                  >
                    <SmartGlyph />
                    <span>{f.name}</span>
                    {c && <span className="count">{c.more ? `${c.n.toLocaleString("ko-KR")}+` : c.n.toLocaleString("ko-KR")}</span>}
                  </button>
                </li>
              );
            })}
            {smart.length === 0 && (
              <li>
                <button className="side-empty" onClick={onNewSmart}>
                  새 스마트 폴더
                </button>
              </li>
            )}
          </ul>
          {hub && <p className="side-hint index-line" title={indexTitle(hub)}>{indexLine(hub)}</p>}
        </section>
      )}

      <div className="side-foot">
        <button className="settings-btn" aria-expanded={settingsOpen} title="설정 (Ctrl+,)" onClick={onSettings}>
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

/** `\\서버` 와 공유 이름을 이은 경로. */
/** 연결할 곳 고르는 판 — 서버(`\\nas`)에서 공유 · 하위 폴더로 내려간다.
 *  at: 지금 보는 폴더 (null 이면 공유 목록) · shares: 서버의 공유 이름 (공유 주소로 들어왔으면 위로 갈 때 묻는다) ·
 *  dirs: 보이는 폴더 경로 (null 이면 읽는 중) · sel: 한 번 눌러 고른 폴더. */
type Browse = { server: string; shares: string[] | null; at: string | null; dirs: string[] | null; sel: string | null; err: string };

/** `\\nas\공유\폴더` → `\\nas`. 네트워크 주소가 아니면(연결한 드라이브 Z:) null. */
const serverOf = (p: string) => /^\\\\[^\\]+/.exec(p)?.[0] ?? null;

/** 판 머리의 지금 자리 — 깊으면 앞을 줄이고 끝 두 마디만 (좁은 왼쪽 열에서 지금 폴더 이름이 보여야 한다). */
/** 고르는 판의 경로 줄 마디. path 가 null 인 마디는 서버(누르면 공유 목록).
 *  `\\nas\공유\자료` → nas · 공유 · 자료 / 공유 목록을 보는 중이면 nas 하나 / 연결한 드라이브 `Z:\자료` → Z: · 자료. */
function crumbsOf(b: Browse): { label: string; path: string | null }[] {
  const host = { label: b.server.replace(/^\\\\/, ""), path: null };
  if (!b.at) return [host];
  const unc = b.at.startsWith("\\\\");
  const parts = b.at.replace(/^\\\\/, "").split("\\").filter(Boolean);
  if (!unc) return parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join("\\") + (i === 0 ? "\\" : "") }));
  return [host, ...parts.slice(1).map((p, i) => ({ label: p, path: `\\\\${parts.slice(0, i + 2).join("\\")}` }))];
}

function shareAt(server: string, share: string): string {
  return `${server.replace(/[\\/]+$/, "")}\\${share}`;
}

/** 연결을 묶는 이름 — \\서버\공유 면 서버 이름, 그 밖에는 드라이브 문자. */
function hostOf(path: string): string {
  const unc = /^[\\/]{2}([^\\/]+)/.exec(path);
  return unc ? unc[1] : path.slice(0, 2);
}

/** 서버 밑 줄에 쓸 이름 — 서버 뒤의 경로 (\\NAS\공유\자료 → 공유\자료). 드라이브 경로면 null — 폴더 이름을 쓴다 (전체 경로는 길어 잘린다). */
function shareOf(path: string): string | null {
  const unc = /^[\\/]{2}[^\\/]+[\\/](.+)$/.exec(path);
  return unc ? unc[1] : null;
}

/** 색인 상태 한 줄 — 「색인 · 파일 128만 개 · 방금」 · 「색인을 만드는 중」. */
function indexLine(h: HubStatus): string {
  const vs = h.index.volumes;
  if (!vs.length) return "색인 없음";
  const files = vs.reduce((n, v) => n + v.files, 0);
  const building = vs.some((v) => v.state === "building" || v.state === "rebuild");
  const oldest = Math.min(...vs.map((v) => v.updated || Date.now()));
  const n = files >= 10000 ? `${Math.round(files / 10000).toLocaleString("ko-KR")}만` : files.toLocaleString("ko-KR");
  return building ? `색인 만드는 중 · 파일 ${n}개` : `색인 · 파일 ${n}개 · ${ago(oldest)}`;
}

function indexTitle(h: HubStatus): string {
  const lines = h.index.volumes.map((v) => `${v.root} ${v.method === "ntfs" ? "MFT" : "직접 읽기"} · ${v.files.toLocaleString("ko-KR")}개 · ${v.state === "ready" ? ago(v.updated) : "만드는 중"}${v.note ? ` · ${v.note}` : ""}`);
  lines.push(h.index.service ? "빠른 색인 서비스 사용" : "앱이 직접 색인");
  if (h.content) lines.push(`문서 본문 ${h.content.indexed.toLocaleString("ko-KR")}개${h.content.queued ? ` · 남은 것 ${h.content.queued.toLocaleString("ko-KR")}` : ""}`);
  return lines.join("\n");
}

/** 스마트 폴더 그림 — 폴더 안에 돋보기. */
function SmartGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="smart-glyph">
      <path d="M1.5 4.5v8a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1H8L6.5 3.5h-4a1 1 0 0 0-1 1z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8" cy="9" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9.6 10.6l1.8 1.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
