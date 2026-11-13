// 제목 줄 — Windows 창 틀 대신 직접 그린다 (tauri.conf `decorations: false`).
//
//   [탭들] [빈 자리 = 창 끌기 · 두 번 누르면 최대화] [새 판 알림] [_ □ ×]
//   탭 줄이 곧 제목 줄이다 — 창 틀 한 줄 · 탭 한 줄로 두 번 쓰던 위 자리를 한 줄로 줄였다.
//   창 끌기는 `data-tauri-drag-region` 이 붙은 요소 자신을 누를 때만 된다 (자식 단추 · 탭은 제 일을 한다).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkUpdate, clearCheckResult, useUpdateState } from "./updater";
import UpdateCard from "./UpdateCard";

const win = getCurrentWindow();

export default function TitleBar({ children }: { children: ReactNode }) {
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    const sync = () => win.isMaximized().then(setMaxed).catch(() => {});
    sync();
    const off = win.onResized(sync);
    return () => {
      off.then((f) => f());
    };
  }, []);
  return (
    <header className="titlebar" data-tauri-drag-region>
      {children}
      <div className="drag" data-tauri-drag-region />
      <UpdateChip />
      <div className="winctl">
        <button aria-label="최소화" title="최소화" onClick={() => win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5.5h10" stroke="currentColor" />
          </svg>
        </button>
        <button aria-label={maxed ? "이전 크기로" : "최대화"} title={maxed ? "이전 크기로" : "최대화"} onClick={() => win.toggleMaximize()}>
          {maxed ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" fill="none" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M.5.5h9v9h-9z" fill="none" stroke="currentColor" />
            </svg>
          )}
        </button>
        <button className="close" aria-label="닫기" title="닫기" onClick={() => win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/** 새 판 알림 — 평소엔 없고, 새 판이 있거나 · 받는 중이거나 · 제목 줄에서 손으로 확인한 결과가 있을 때만 선다. 누르면 업데이트 카드.
 *  2026.11.13 : 펼침 창을 설정과 같은 업데이트 카드(UpdateCard)로. 설정에서 누른 확인의 결과는 설정 카드가 보이므로 여기 띄우지 않는다.
 *  「나중에」는 알림만 접는다 — 새 판은 설정 「업데이트」에 남는다. */
function UpdateChip() {
  const s = useUpdateState();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mine = s.manual && s.from === "titlebar";

  // 손으로 확인해 「최신 판」이면 잠깐 보이고 사라진다.
  useEffect(() => {
    if (s.phase !== "latest") return;
    const t = window.setTimeout(clearCheckResult, 4000);
    return () => window.clearTimeout(t);
  }, [s.phase]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  if (s.phase === "checking" && mine) return <span className="upd muted">업데이트 확인 중…</span>;
  if (s.phase === "latest" && mine) return <span className="upd muted">최신 버전이다</span>;
  if (s.phase === "error" && mine)
    return (
      <button className="upd warn" title={s.error} onClick={() => checkUpdate(true)}>
        업데이트 확인 실패 · 다시
      </button>
    );
  const busy = s.phase === "downloading";
  if (!busy && (s.phase !== "available" || !s.update || s.dismissed)) return null;
  const pct = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : null;
  return (
    <div className="upd-wrap" ref={box}>
      <button className="upd new" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        {busy ? `업데이트 받는 중${pct != null ? ` ${pct}%` : "…"}` : `새 버전 ${s.update?.version}`}
      </button>
      {open && (
        <div className="upd-panel" role="dialog" aria-label="업데이트">
          <UpdateCard compact onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
