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
//   2026.11.12 : 「최근 파일」 밑에 파일 다섯 개를 이름 그대로 늘어놓던 것을 걷었다 — 스마트 폴더로 바꾼 뒤에도 파일이 왼쪽 열에 바로 올라와
//                구획이 「폴더 목록」이 아니라 「파일 목록」으로 읽혔다. 이제 모든 스마트 폴더가 이름과 개수 한 줄이고, 파일은 누르면 칸에서 본다.
// 항목마다 [data-drop] — 파일을 끌어다 놓으면 그 자리로 옮긴다.
import { useCallback, useEffect, useState } from "react";
import { api, TAG_COLORS, TAG_LABEL, type Drive, type HubStatus, type Place, type Places, type SmartFolder, type TagColor, type ViewPrefs } from "./api";
import { LINK_DROP, TAG_DROP } from "./App";
import { PlaceGlyph } from "./glyphs";
import { ago, kindTable, remoteOnly, scopeLabel, scopeOf, tzOffset } from "./query";
import { errText, formatBytes, norm } from "./util";

type Props = {
  places: Places | null;
  links: Place[];
  onAddLinks: (paths: string[]) => void;
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
  const { places, links, onAddLinks, onUnlink, view, current, onGo, onGoNewTab, settingsOpen, onSettings, smart, inbox, onOpenSmart, onEditSmart, onNewSmart } = props;

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

  // 연결 더하기 — 주소를 받아 열리는지 본 뒤 더한다. 꺼진 NAS 는 몇 초 걸릴 수 있어 「확인 중」을 보인다.
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
        if (!ok) return setAddState({ busy: false, err: "열 수 없다. 주소와 연결 상태를 확인한다" });
        onAddLinks([path]);
        setAddr("");
        setAddState({ busy: false, err: "" });
      })
      .catch((e) => setAddState({ busy: false, err: errText(e) }));
  };

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

      {view.links && (
        <section>
          <h2 className="side-head" data-drop={LINK_DROP} title="NAS · 공유 폴더처럼 드라이브 문자 없이 가는 자리: 폴더를 여기로 끌어다 놓아도 더한다">
            연결
          </h2>
          {[...hosts].map(([host, ls]) => {
            const down = ls.every((l) => offline?.has(norm(l.path)));
            return (
              <div key={host} className="link-host">
                <div className={"link-server" + (down ? " off" : "")} title={down ? "열 수 없다. 꺼졌거나 연결이 끊겼다" : undefined}>
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
                          title={`${l.path}${off ? "\n열 수 없다. 꺼졌거나 연결이 끊겼다" : ""}\n가운데 단추 · Ctrl: 새 탭`}
                          {...nav(l.path)}
                        >
                          <span>{shareOf(l.path) ?? l.name}</span>
                          {off && !down && <span className="count">끊김</span>}
                        </button>
                        <button className="side-x" title="연결에서 빼기" aria-label={`${l.name} 연결에서 빼기`} onClick={() => onUnlink(l.path)}>
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {/* 늘 맨 아래 주소 칸 — 적고 Enter. 폴더를 끌어 놓아도 더한다 */}
          <form
            className="link-form"
            data-drop={LINK_DROP}
            onSubmit={(e) => {
              e.preventDefault();
              submitLink();
            }}
          >
            <input
              value={addr}
              placeholder={links.length ? "\\\\서버\\공유 더하기" : "\\\\서버\\공유 적기 · 폴더 끌어 놓기"}
              aria-label="연결할 주소: Enter 로 더한다"
              spellCheck={false}
              disabled={addState.busy}
              onChange={(e) => {
                setAddr(e.target.value);
                if (addState.err) setAddState({ busy: false, err: "" });
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setAddr("");
                  setAddState({ busy: false, err: "" });
                  e.currentTarget.blur();
                }
              }}
            />
            {(addState.busy || addState.err || addr) && (
              <p className={"side-hint" + (addState.err ? " warn" : "")} role="status">
                {addState.busy ? "확인 중" : addState.err || "Enter 로 더한다 · Esc 로 지운다"}
              </p>
            )}
          </form>
        </section>
      )}

      <section>
        <h2 title="목록에서 Alt+1~7 · 오른쪽 단추로 단다 · 파일을 건반에 끌어 놓아도 단다">색 표시</h2>
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
                title={n ? `${TAG_LABEL[c]} ${n}개: 모든 폴더에서 모아 보기 (Alt+${i + 1} 로 단다)` : `${TAG_LABEL[c]}: 아직 단 것이 없다 (Alt+${i + 1} 로 단다)`}
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
          <h2 className="side-head" title="조건에 이름을 붙여 둔 것: 누르면 지금 칸에 모아 보인다 · 찾기 칸의 「스마트 폴더로 저장」으로 만든다 · 설정 › 보기에서 끈다">
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
                    title={`${f.q}\n${scopeLabel(f.scope)}\n누르면 지금 칸에 모아 보인다 · 오른쪽 단추로 고친다`}
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
                  찾기 칸의 조건을 저장해 둔다
                </button>
              </li>
            )}
          </ul>
          {hub && <p className="side-hint index-line" title={indexTitle(hub)}>{indexLine(hub)}</p>}
        </section>
      )}

      <div className="side-foot">
        <button className="settings-btn" aria-expanded={settingsOpen} title="설정: 보기 · 종류 · 화면 색 · Claude 스킬 (Ctrl+,)" onClick={onSettings}>
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
  if (!vs.length) return "색인 없음: 그 자리에서 훑는다";
  const files = vs.reduce((n, v) => n + v.files, 0);
  const building = vs.some((v) => v.state === "building" || v.state === "rebuild");
  const oldest = Math.min(...vs.map((v) => v.updated || Date.now()));
  const n = files >= 10000 ? `${Math.round(files / 10000).toLocaleString("ko-KR")}만` : files.toLocaleString("ko-KR");
  return building ? `색인을 만드는 중 · 파일 ${n}개` : `색인 · 파일 ${n}개 · ${ago(oldest)}`;
}

function indexTitle(h: HubStatus): string {
  const lines = h.index.volumes.map((v) => `${v.root} ${v.method === "ntfs" ? "MFT" : "훑기"} · ${v.files.toLocaleString("ko-KR")}개 · ${v.state === "ready" ? ago(v.updated) : "만드는 중"}${v.note ? ` · ${v.note}` : ""}`);
  lines.push(h.index.service ? "빠른 색인 서비스가 맡는다" : "앱이 색인한다. 설정 › 색인에서 빠른 색인 서비스를 깔 수 있다");
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
