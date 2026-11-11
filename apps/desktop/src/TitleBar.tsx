// 제목 줄 — Windows 창 틀 대신 직접 그린다 (tauri.conf `decorations: false`).
//
//   [탭들] [빈 자리 = 창 끌기 · 두 번 누르면 최대화] [새 판 알림] [_ □ ×]
//   탭 줄이 곧 제목 줄이다 — 창 틀 한 줄 · 탭 한 줄로 두 번 쓰던 위 자리를 한 줄로 줄였다.
//   창 끌기는 `data-tauri-drag-region` 이 붙은 요소 자신을 누를 때만 된다 (자식 단추 · 탭은 제 일을 한다).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { checkUpdate, dismissUpdate, installUpdate, openReleases, useUpdateState } from "./updater";

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

/** 새 판 알림 — 평소엔 없고, 새 판이 있거나 · 받는 중이거나 · 손으로 확인한 결과가 있을 때만 제목 줄에 선다. 누르면 바뀐 내용과 설치. */
function UpdateChip() {
  const s = useUpdateState();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // 손으로 확인해 「최신 판」이면 잠깐 보이고 사라진다.
  useEffect(() => {
    if (s.phase !== "latest") return;
    const t = window.setTimeout(dismissUpdate, 4000);
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

  if (s.phase === "checking") return <span className="upd muted">업데이트 확인 중…</span>;
  if (s.phase === "latest") return <span className="upd muted">최신 버전이다</span>;
  if (s.phase === "error" && s.manual)
    return (
      <button className="upd warn" title={s.error} onClick={() => checkUpdate(true)}>
        업데이트 확인 실패 · 다시
      </button>
    );
  if (s.phase === "downloading") {
    const pct = s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : null;
    return <span className="upd">업데이트 받는 중{pct != null ? ` ${pct}%` : "…"}</span>;
  }
  if (s.phase !== "available" || !s.update) return null;
  const u = s.update;
  return (
    <div className="upd-wrap" ref={box}>
      <button className="upd new" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        새 버전 {u.version}
      </button>
      {open && (
        <div className="upd-panel" role="dialog" aria-label={`새 버전 ${u.version}`}>
          <b>
            {u.currentVersion} → {u.version}
          </b>
          {u.body && <div className="upd-notes">{u.body}</div>}
          <div className="upd-acts">
            {s.installable ? (
              <button className="act primary" onClick={() => installUpdate()} title="받아서 설치하면 앱이 꺼졌다 새 버전으로 다시 켜진다">
                설치하고 다시 켜기
              </button>
            ) : (
              <button className="act primary" onClick={openReleases} title="설치 파일(setup.exe)로 깐 앱이 아니라 스스로 업데이트하지 못한다 — 릴리스 페이지에서 받는다">
                릴리스 페이지 열기
              </button>
            )}
            <button
              className="act"
              onClick={() => {
                setOpen(false);
                dismissUpdate();
              }}
            >
              나중에
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
