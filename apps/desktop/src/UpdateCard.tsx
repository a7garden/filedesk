// 업데이트 카드 — 지금 판 · 확인 · 새 판의 바뀐 내용 · 설치를 한 자리에서. 설정 「업데이트」 구획과 제목 줄 알림의 펼침 창이 같이 쓴다.
//
// 2026.11.13 : 사용자 요청. 설정에는 「업데이트 확인」 단추만 있어 새 판을 찾아도 설치는 제목 줄 알림에서만 됐고,
//   바뀐 내용(CHANGELOG 의 「- 」 목록)은 줄바꿈만 살린 날 글로 보였다. 두 자리가 같은 카드를 쓰게 하고, 바뀐 내용은 항목 목록으로 그린다.
//   상태는 updater.ts 한 곳에 있으므로 어느 자리에서 받기 시작해도 다른 자리에 진행이 같이 보인다.
import { checkUpdate, dismissUpdate, installUpdate, openReleases, useUpdateState } from "./updater";

/** 바뀐 내용 글 → 항목. 「- 」 줄 하나가 한 항목이고, 다음 「- 」 전까지의 줄은 그 항목에 잇는다.
 *  항목 머리: 「**머리** 설명」(2026.11.13 부터 CHANGELOG 꼴) · 지난 판들의 「머리 — 설명」. 머리가 없으면 설명만. */
export function parseNotes(body: string): { head: string; rest: string }[] {
  const items: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (/^[-*] /.test(l)) items.push(l.slice(2).trim());
    else if (items.length) items[items.length - 1] += ` ${l}`;
    else items.push(l);
  }
  return items.map((t) => {
    const b = /^\*\*(.+?)\*\*\s*(.*)$/.exec(t);
    if (b) return { head: b[1], rest: b[2] };
    const i = t.indexOf(" — ");
    return i > 0 ? { head: t.slice(0, i), rest: t.slice(i + 3) } : { head: "", rest: t };
  });
}

const ago = (t: number | null) => {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "방금 확인" : m < 60 ? `${m}분 전 확인` : `${Math.round(m / 60)}시간 전 확인`;
};

/** `compact` — 제목 줄 펼침 창. 지금 판 줄 · 확인 단추를 빼고 새 판만 보인다. */
export default function UpdateCard({ version, compact = false, onDone }: { version?: string; compact?: boolean; onDone?: () => void }) {
  const s = useUpdateState();
  const u = s.phase === "available" || s.phase === "downloading" ? s.update : null;
  const pct = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : null;

  return (
    <div className={"uc" + (compact ? " compact" : "")}>
      {!compact && (
        <div className="uc-now">
          <div className="uc-ver">
            <span className="uc-ver-n">filedesk {version ? `v${version}` : ""}</span>
            <span className={"uc-state" + (s.phase === "error" ? " warn" : "")} aria-live="polite">
              {s.phase === "checking"
                ? "확인 중…"
                : s.phase === "error"
                  ? `확인하지 못했다. ${s.error.slice(0, 120)}`
                  : u
                    ? ago(s.checkedAt)
                    : s.checkedAt
                      ? `최신 버전이다 · ${ago(s.checkedAt)}`
                      : "아직 확인하지 않았다"}
            </span>
          </div>
          {!u && (
            <button className="act" disabled={s.phase === "checking"} onClick={() => checkUpdate(true, "settings")}>
              {s.phase === "error" ? "다시 확인" : "업데이트 확인"}
            </button>
          )}
        </div>
      )}

      {u && (
        <div className="uc-new">
          <div className="uc-new-head">
            <span className="uc-new-ver">새 버전 {u.version}</span>
            <span className="uc-from">
              지금 {u.currentVersion}
              {u.date ? ` · ${u.date.slice(0, 10)} 나옴` : ""}
            </span>
          </div>
          {u.body && (
            <ul className="uc-notes" aria-label="바뀐 내용">
              {parseNotes(u.body).map((n, i) => (
                <li key={i}>
                  {n.head && <span className="uc-note-head">{n.head}</span>}
                  {n.rest && <span className="uc-note-rest">{n.rest}</span>}
                </li>
              ))}
            </ul>
          )}
          {s.phase === "downloading" ? (
            <div className="uc-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="받는 중">
              <span className="uc-bar" style={{ width: pct != null ? `${pct}%` : "30%" }} data-indeterminate={pct == null || undefined} />
              <span className="uc-pct">{pct != null ? `받는 중 ${pct}%` : "받는 중…"} · 다 받으면 앱이 꺼졌다 새 버전으로 켜진다</span>
            </div>
          ) : (
            <div className="uc-acts">
              {s.installable ? (
                <button className="act primary" onClick={() => installUpdate()} title="받아서 설치하면 앱이 꺼졌다 새 버전으로 다시 켜진다. 열어 둔 탭은 다시 열린다">
                  설치하고 다시 켜기
                </button>
              ) : (
                <button className="act primary" onClick={openReleases} title="설치 파일(setup.exe)로 깐 앱이 아니라 스스로 바꿔 끼우지 못한다">
                  릴리스 페이지에서 받기
                </button>
              )}
              {/* 「나중에」는 제목 줄 알림을 접는 일이라 그 펼침 창에만 — 설정 카드는 언제 열어도 새 판을 보인다 */}
              {compact && (
                <button
                  className="act"
                  onClick={() => {
                    dismissUpdate();
                    onDone?.();
                  }}
                >
                  나중에
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
