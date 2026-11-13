// 바로가기(.lnk) 그림 — 바로가기 자체가 아니라 가리키는 것의 그림에 작은 화살표를 얹는다. 탐색기와 같다.
//
// 2026.11.12 : 사용자 요청. filedesk 그림 · 아이콘 팩 설정에서 바로가기가 모두 같은 「링크」 그림이라, 바탕화면의 바로가기 여럿이 무엇을 가리키는지 몰랐다.
// 2026.11.13 : 셸 아이콘 설정에도 화살표를 얹는다 (ShortcutMark). 셸이 주는 그림(SHGetFileInfo · 큰 그림)에는 탐색기의 화살표 덧그림이 빠져
//              바로가기가 진짜 파일과 똑같이 보였다 — 메일 첨부 · 보내기에 바로가기를 보낼 수 있다는 사용자 지적.
//
// 대상 풀기(link_targets)는 COM 이라 줄마다 부르지 않는다 — 한 번 그리는 동안 나온 바로가기를 모아 한 번에 묻고, 답은 앱이 켜 있는 동안 기억한다.
// 그동안은 지금처럼 「링크」 그림을 그린다.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { iconUrl, PER_FILE_EXTS } from "./api";
import { FileGlyph, FolderGlyph } from "./glyphs";

type Target = { path: string; isDir: boolean } | null;

const known = new Map<string, Target>();
const waiting = new Map<string, ((t: Target) => void)[]>();
let queued = false;

function ask(path: string, done: (t: Target) => void) {
  if (known.has(path)) return done(known.get(path)!);
  const ws = waiting.get(path);
  if (ws) return void ws.push(done);
  waiting.set(path, [done]);
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const paths = [...waiting.keys()];
    const finish = (ts: ([string, boolean] | null)[]) =>
      paths.forEach((p, i) => {
        const t = ts[i] ? { path: ts[i]![0], isDir: ts[i]![1] } : null;
        known.set(p, t);
        waiting.get(p)?.forEach((f) => f(t));
        waiting.delete(p);
      });
    invoke<([string, boolean] | null)[]>("link_targets", { paths })
      .then(finish)
      .catch(() => finish(paths.map(() => null)));
  });
}

const extOf = (p: string) => {
  const n = p.slice(p.lastIndexOf("\\") + 1);
  return n.includes(".") ? n.slice(n.lastIndexOf(".") + 1).toLowerCase() : "";
};

/** 파일 그림 — 바로가기면 대상의 그림 + 화살표, 아니면 FileGlyph 그대로. `path` 가 있어야 바로가기를 푼다. */
export function DocGlyph({ ext, path, size = 16 }: { ext: string; path?: string; size?: number }) {
  if (ext !== "lnk" || !path) return <FileGlyph ext={ext} size={size} />;
  return <ShortcutGlyph path={path} size={size} />;
}

function ShortcutGlyph({ path, size }: { path: string; size: number }) {
  const [t, setT] = useState<Target | undefined>(() => known.get(path));
  useEffect(() => {
    let live = true;
    ask(path, (x) => live && setT(x));
    return () => {
      live = false;
    };
  }, [path]);

  let pic;
  if (!t) pic = <FileGlyph ext="lnk" size={size} />;
  else if (t.isDir) pic = <FolderGlyph size={size} />;
  else {
    const x = extOf(t.path);
    // 프로그램 · 아이콘처럼 파일마다 그림이 다른 것은 그 파일의 셸 아이콘 — 앱의 얼굴은 형식 그림으로 대신할 수 없다
    // 셸 작은 아이콘은 16px 비트맵이라, 큰 칸에서는 큰 아이콘(`i:`)을 받는다 — 키우면 흐려진다
    const src =
      size <= 20
        ? iconUrl({ isDir: false, ext: x, path: t.path })
        : `http://fdicon.localhost/${encodeURIComponent(`i:${Math.round(size * (window.devicePixelRatio || 1))}:${t.path}`)}`;
    pic = PER_FILE_EXTS.has(x) ? (
      <img src={src} width={size <= 20 ? 16 : size} height={size <= 20 ? 16 : size} alt="" draggable={false} />
    ) : (
      <FileGlyph ext={x} size={size} />
    );
  }
  return (
    <span className="shortcut-glyph" style={{ width: size, height: size }} title={t ? `바로가기 → ${t.path}` : undefined}>
      {pic}
      {t && <ShortcutArrow />}
    </span>
  );
}

/** 바로가기 화살표 — 그림 왼쪽 아래에 얹는다. */
function ShortcutArrow() {
  return (
    <svg className="shortcut-arrow" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
      <path d="M3 7l3.6-3.6M4 3.2h2.8V6" />
    </svg>
  );
}

/** 바로가기인가 — 셸 바로가기(.lnk) · 인터넷 바로가기(.url). */
export const isShortcut = (ext: string) => ext === "lnk" || ext === "url";

/** 셸 아이콘 · 미리보기 위에 바로가기 화살표를 얹는다 (바로가기가 아니면 그대로). */
export function ShortcutMark({ ext, size, children }: { ext: string; size: number; children: React.ReactNode }) {
  if (!isShortcut(ext.toLowerCase())) return <>{children}</>;
  return (
    <span className="shortcut-glyph" style={{ width: size, height: size }} title="바로가기">
      {children}
      <ShortcutArrow />
    </span>
  );
}
