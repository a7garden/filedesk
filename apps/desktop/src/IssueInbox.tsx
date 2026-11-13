// 문제 문서 처리함 — 이 폴더에서 이름 · 판에 문제가 있는 문서를 한 창에 모아 하나씩(또는 한 번에) 처리한다.
//
// 2026.11.13 : 사용자 요청. 「문제 문서 N개」가 목록을 그것만 남기는 켜고 끄는 거르기였다. 문제 문서는 「볼 것」이 아니라 「치울 일」이라
//   거르기로 두면 켜 둔 채 잊고, 다른 파일이 안 보이는 까닭을 몰랐다. 받은편지함처럼 왼쪽에 쌓인 일 · 오른쪽에 고른 일, 처리하면 빠진다.
// 2026.11.13 : 다시 지었다 (bespoke).
//   · 왼쪽 목록을 「지난 판 정리」(최신판 곁에 남은 지난 판 — 앱이 옮긴다)와 「직접 볼 것」(이름 · 판 번호 — 사람이 고친다)으로 가른다.
//     처리할 수 있는 일과 볼 일이 섞이면 어느 것부터 누를지 매번 읽어야 했다. 한 번에 옮기기는 앞 묶음 머리에 붙인다.
//   · 오른쪽은 표 대신 「처리하면 이렇게 된다」 — 판마다 남김 / → 이전판 을 보인다. 단추가 하는 일을 누르기 전에 판 위에서 본다.
//   · 문장의 폴더 이름(「filedesk」 폴더에 판이 2개)은 이 창에서는 늘 이 폴더라 「최신판 곁에 지난 판 N개」로 바꿔 보인다.
//
// 키보드: ↑ ↓ 문서 고르기 · Esc 닫기. 파일을 옮기는 동작은 키 하나로 하지 않는다 (단추를 누른다).
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DocFile, type DocGroup } from "./api";
import { baseName, issueText, staleCount as stale } from "./util";

type Props = {
  /** 이 폴더의 문제 문서 (Pane 이 센 그대로 — 처리하면 다시 읽혀 빠진다). */
  docs: DocGroup[];
  dir: string;
  /** 문서 하나의 지난 판을 「이전판」 폴더로. 옮긴 수. */
  onRetire: (g: DocGroup) => Promise<number>;
  /** 여러 문서를 한 번에. 옮긴 수. */
  onRetireAll: (gs: DocGroup[]) => Promise<number>;
  /** 창을 닫고 목록에서 그 문서를 펼쳐 고른다. */
  onShow: (g: DocGroup) => void;
  onClose: () => void;
};

const ymd = (d: string) => (d.length === 8 ? `${d.slice(4, 6)}-${d.slice(6)}` : "날짜 없음");
const ver = (f: DocFile) => (f.parsed.version.length ? `v${f.parsed.version.join(".")}` : "");

export default function IssueInbox({ docs, dir, onRetire, onRetireAll, onShow, onClose }: Props) {
  const folder = baseName(dir);
  // 건너뛴 문서 — 이 창을 연 동안만. 다음에 열면 다시 보인다 (고치지 않았으니까).
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const queue = useMemo(() => {
    const live = docs.filter((g) => !skipped.has(g.key));
    // 고칠 수 있는 것 먼저 — 목록 차례가 곧 처리 차례다
    return [...live.filter((g) => stale(g) > 0), ...live.filter((g) => stale(g) === 0)];
  }, [docs, skipped]);
  const fixable = queue.filter((g) => stale(g) > 0);
  const manual = queue.filter((g) => stale(g) === 0);
  const fixableFiles = fixable.reduce((n, g) => n + stale(g), 0);

  const [cur, setCur] = useState<string | null>(queue[0]?.key ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [moving, setMoving] = useState<{ key: string; files: string[] } | null>(null);
  const [done, setDone] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // 고른 문서가 빠지면(처리 · 건너뛰기) 그 자리의 다음 문서로 — 손이 같은 자리에서 다음 일을 받는다
  const lastIndex = useRef(0);
  const at = queue.findIndex((g) => g.key === cur);
  if (at >= 0) lastIndex.current = at;
  const sel = at >= 0 ? queue[at] : (queue[Math.min(lastIndex.current, queue.length - 1)] ?? null);
  useEffect(() => {
    if (sel && sel.key !== cur) setCur(sel.key);
  }, [sel, cur]);

  // 옮길 파일은 백엔드가 센 것으로 표시한다 — 화면의 셈(retire 표시)과 실제로 옮길 목록이 어긋나지 않게
  const selStale = sel ? stale(sel) : 0;
  useEffect(() => {
    if (!sel || selStale === 0) return;
    let live = true;
    api
      .planRetire(dir, sel.key)
      .then((files) => live && setMoving({ key: sel.key, files }))
      .catch(() => live && setMoving(null));
    return () => {
      live = false;
    };
  }, [sel?.key, selStale, dir]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => box.current?.focus(), []);
  // 처리한 문서가 빠지면 누르던 단추도 사라져 초점이 바탕으로 떨어진다 — 그때 Esc · ↑ ↓ 가 창에 오지 않았다 (11-13 앱 시험). 창으로 되돌린다.
  useEffect(() => {
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
  });

  const run = async (job: () => Promise<number>) => {
    setBusy(true);
    try {
      const n = await job();
      setDone((d) => d + n);
    } finally {
      setBusy(false);
      setConfirmAll(false);
    }
  };

  const move = (d: 1 | -1) => {
    if (!queue.length) return;
    setCur(queue[(Math.max(0, at) + d + queue.length) % queue.length].key);
  };

  const willMove = (f: DocFile) => (moving && moving.key === sel?.key ? moving.files.some((m) => m.toLowerCase() === f.path.toLowerCase()) : f.retire);

  const item = (g: DocGroup) => {
    const n = stale(g);
    return (
      <li key={g.key}>
        <button role="option" aria-selected={g.key === sel?.key} className={"ix-item" + (g.key === sel?.key ? " on" : "")} onClick={() => setCur(g.key)}>
          <span className="ix-title">{g.title}</span>
          <span className="ix-why">{n > 0 ? `지난 판 ${n}개` : issueText(g, folder)[0]}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className="ix"
        role="dialog"
        aria-modal="true"
        aria-label="문제 문서"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            move(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <aside className="ix-side">
          <header className="ix-head">
            <h2>문제 문서</h2>
            <span className="ix-count" aria-label={`남은 문서 ${queue.length}개`}>
              {queue.length}
            </span>
          </header>

          {fixable.length > 0 && (
            <section className="ix-group" aria-label="지난 판 정리">
              <div className={"ix-group-head" + (confirmAll ? " confirm" : "")}>
                {confirmAll ? (
                  <>
                    <span>파일 {fixableFiles}개를 「이전판」 폴더로. 지우지 않는다.</span>
                    <span className="ix-group-acts">
                      <button className="act primary" disabled={busy} onClick={() => run(() => onRetireAll(fixable))}>
                        옮기기
                      </button>
                      <button className="act" disabled={busy} onClick={() => setConfirmAll(false)}>
                        취소
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ix-group-name">지난 판 정리</span>
                    {fixable.length > 1 && (
                      <button className="ix-link" disabled={busy} onClick={() => setConfirmAll(true)}>
                        모두 옮기기 · {fixableFiles}
                      </button>
                    )}
                  </>
                )}
              </div>
              <ul role="listbox" aria-label="지난 판 정리">
                {fixable.map(item)}
              </ul>
            </section>
          )}
          {manual.length > 0 && (
            <section className="ix-group" aria-label="직접 볼 것">
              <div className="ix-group-head">
                <span className="ix-group-name">직접 볼 것</span>
              </div>
              <ul role="listbox" aria-label="직접 볼 것">
                {manual.map(item)}
              </ul>
            </section>
          )}
          {skipped.size > 0 && (
            <button className="ix-link ix-skipped" onClick={() => setSkipped(new Set())}>
              건너뛴 {skipped.size}개 다시 보기
            </button>
          )}
        </aside>

        <section className="ix-main" aria-live="polite">
          <button className="ix-x" aria-label="닫기 (Esc)" title="닫기 (Esc)" onClick={onClose}>
            ×
          </button>
          {!sel ? (
            <div className="ix-empty">
              <p className="ix-empty-big">{done > 0 || skipped.size > 0 ? "다 처리했다" : "문제 문서가 없다"}</p>
              {done > 0 && <p className="muted">지난 판 {done}개를 「이전판」 폴더로 옮겼다</p>}
              <button className="act primary" onClick={onClose}>
                닫기
              </button>
            </div>
          ) : (
            <>
              <h3 className="ix-doc">{sel.title}</h3>
              <ul className="ix-issues">
                {issueText(sel, folder).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>

              {/* 판마다 처리 뒤 모습 — 남김 / → 이전판. 이미 이전판에 든 것은 흐리게 */}
              <ol className="ix-eds" aria-label="판">
                {sel.files.map((f, i) => {
                  const out = selStale > 0 && !f.inHistory && willMove(f);
                  const fate = f.inHistory ? "이전판" : out ? "→ 이전판" : i === 0 ? "최신판" : "남김";
                  return (
                    <li key={f.path} className={"ix-ed" + (f.inHistory ? " past" : out ? " out" : i === 0 ? " latest" : "")} title={f.path}>
                      <span className="ix-ver">{ver(f) || ""}</span>
                      <span className="ix-date">{ymd(f.parsed.date)}</span>
                      <span className="ix-name">{f.name}</span>
                      <span className="ix-fate">{fate}</span>
                    </li>
                  );
                })}
              </ol>

              <div className="ix-acts">
                {selStale > 0 ? (
                  <button className="act primary" disabled={busy} onClick={() => run(() => onRetire(sel))}>
                    이대로 옮기기
                  </button>
                ) : (
                  <button className="act primary" onClick={() => onShow(sel)}>
                    목록에서 고치기
                  </button>
                )}
                {selStale > 0 && (
                  <button className="act" onClick={() => onShow(sel)}>
                    목록에서 보기
                  </button>
                )}
                <button className="act" disabled={busy} onClick={() => setSkipped((s) => new Set(s).add(sel.key))}>
                  건너뛰기
                </button>
                {done > 0 && <span className="ix-done">지난 판 {done}개 옮김</span>}
              </div>
              {selStale === 0 && <p className="ix-hint">이름 · 판 번호는 앱이 대신 고치지 않는다. 목록에서 F2 로 이름을 바꾼다.</p>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
