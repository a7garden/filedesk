// 스마트 폴더 고치기 — 이름 · 조건 · 볼 곳. 고치는 동안 조건 칩과 맞는 개수를 미리 보인다.
//
// 볼 곳: 모든 드라이브(색인) · 다운로드와 바탕화면(바로 아래만 — 「최근 파일」) · 고른 폴더(폴더마다 하위 폴더까지 켜고 끈다).
// NAS · 공유 폴더를 고르면 색인 밖이라 누를 때 그 자리에서 훑는다 (상한 8초 · 2000개).
// 2026.11.12 : 처음 씀.
import { useEffect, useRef, useState } from "react";
import { api, type QueryResult, type QuerySpec, type Root, type SmartFolder, type SmartScope } from "./api";
import { kindTable, RECENT_ID, scopeOf, sourceLabel, tzOffset } from "./query";
import { errText, type KindDef } from "./util";

type Props = {
  folder: SmartFolder;
  isNew: boolean;
  /** 다운로드 · 바탕화면. */
  inbox: string[];
  /** 지금 칸의 폴더 — 「지금 폴더 더하기」. */
  current: string;
  kinds: KindDef[];
  showHidden: boolean;
  onSave: (f: SmartFolder) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export default function SmartEditor(p: Props) {
  const [name, setName] = useState(p.folder.name);
  const [q, setQ] = useState(p.folder.q);
  const [kind, setKind] = useState<SmartScope["kind"]>(p.folder.scope.kind);
  const [roots, setRoots] = useState<Root[]>(p.folder.scope.kind === "roots" ? p.folder.scope.roots : [{ path: p.current, recursive: true }]);
  const [adding, setAdding] = useState("");
  const [spec, setSpec] = useState<QuerySpec | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seq = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);

  const scope: SmartScope = kind === "roots" ? { kind, roots } : kind === "all" ? { kind: "all" } : { kind: "inbox" };

  useEffect(() => {
    (p.isNew ? nameRef.current : null)?.focus();
  }, [p.isNew]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        p.onClose();
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [p]);

  // 조건 칩 · 맞는 개수 — 고치기를 멈추면 잠깐 뒤에 센다
  const scopeKey = JSON.stringify(scope);
  useEffect(() => {
    const n = ++seq.current;
    const text = q.trim();
    if (!text) {
      setSpec(null);
      setPreview(null);
      return;
    }
    const t = window.setTimeout(() => {
      const ks = kindTable(p.kinds);
      api
        .parseQuery(text, ks, tzOffset())
        .then((s) => n === seq.current && setSpec(s))
        .catch(() => {});
      if (kind === "roots" && !roots.length) return setPreview(null);
      setBusy(true);
      api
        .queryFiles({ scope: scopeOf(scope, p.inbox), text, kinds: ks, showHidden: p.showHidden, content: false, tzOffsetMin: tzOffset(), limit: 2000, background: true })
        .then((r) => n === seq.current && setPreview(r))
        .catch((e) => n === seq.current && setErr(errText(e)))
        .finally(() => n === seq.current && setBusy(false));
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, scopeKey]);

  const addRoot = (path: string) => {
    const v = path.trim().replace(/^"(.*)"$/, "$1");
    if (!v) return;
    setRoots((rs) => (rs.some((r) => r.path.toLowerCase() === v.toLowerCase()) ? rs : [...rs, { path: v, recursive: true }]));
    setAdding("");
  };

  const canSave = name.trim() && q.trim() && (kind !== "roots" || roots.length > 0);
  const save = () => canSave && p.onSave({ id: p.folder.id, name: name.trim(), q: q.trim(), scope });

  return (
    <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="smart-editor" role="dialog" aria-modal="true" aria-label="스마트 폴더 고치기">
        <h3>{p.isNew ? "새 스마트 폴더" : "스마트 폴더 고치기"}</h3>
        <label className="smart-line">
          <span className="set-label">이름</span>
          <input ref={nameRef} value={name} placeholder="이번 주 문서" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>
        <label className="smart-line">
          <span className="set-label">조건</span>
          <input
            value={q}
            spellCheck={false}
            placeholder="보고 고친:7일 종류:문서 -임시"
            title="찾는 말과 조건 — 고친:오늘 · 고친:3일 · 고친:>30일 · 크기:>10MB · 확장자:pdf · 종류:문서 · 색:빨강 · 메모:있음 · -뺄말"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </label>
        {(spec?.chips.length || spec?.errors.length) ? (
          <div className="smart-chips">
            {spec?.chips.map((c) => (
              <span key={c.raw} className="cond-chip" title={c.raw}>
                {c.label}
              </span>
            ))}
            {spec?.terms.map((t) => (
              <span key={`t:${t}`} className="cond-chip term">
                「{t}」
              </span>
            ))}
            {spec?.errors.map((e) => (
              <span key={e} className="cond-chip warn">
                {e}
              </span>
            ))}
          </div>
        ) : null}
        <div className="smart-line top">
          <span className="set-label">볼 곳</span>
          <div className="smart-scope" role="radiogroup" aria-label="볼 곳">
            <label className="pick-opt">
              <input type="radio" name="smart-scope" checked={kind === "all"} onChange={() => setKind("all")} />
              <span className="pick-name">모든 드라이브</span>
              <span className="pick-note">고정 드라이브 전체 — 색인에서 찾는다. NAS 는 빠진다</span>
            </label>
            <label className="pick-opt">
              <input type="radio" name="smart-scope" checked={kind === "inbox"} onChange={() => setKind("inbox")} />
              <span className="pick-name">다운로드 · 바탕화면</span>
              <span className="pick-note">두 폴더 바로 아래만 — 받은 파일이 쌓이는 곳</span>
            </label>
            <label className="pick-opt">
              <input type="radio" name="smart-scope" checked={kind === "roots"} onChange={() => setKind("roots")} />
              <span className="pick-name">고른 폴더</span>
            </label>
            {kind === "roots" && (
              <div className="smart-roots">
                {roots.map((r, i) => (
                  <div key={r.path} className="smart-root">
                    <span className="set-path" title={r.path}>
                      {r.path}
                    </span>
                    <label className="set-check">
                      <input type="checkbox" checked={r.recursive} onChange={(e) => setRoots((rs) => rs.map((x, j) => (j === i ? { ...x, recursive: e.target.checked } : x)))} />
                      <span>하위 폴더까지</span>
                    </label>
                    <button className="icon-btn" aria-label={`${r.path} 빼기`} onClick={() => setRoots((rs) => rs.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                ))}
                <div className="smart-root add">
                  <input value={adding} placeholder="폴더 경로 (D:\work · \\NAS\공유)" spellCheck={false} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRoot(adding)} />
                  <button className="act" onClick={() => addRoot(adding)} disabled={!adding.trim()}>
                    더하기
                  </button>
                  <button className="act" onClick={() => addRoot(p.current)} title={p.current}>
                    지금 폴더
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <p className="muted smart-preview" aria-live="polite">
          {busy
            ? "세는 중…"
            : preview
              ? `맞는 것 ${preview.items.length.toLocaleString("ko-KR")}개${preview.truncated ? " 넘게" : ""}${sourceLabel(preview) ? ` · ${sourceLabel(preview)}` : ""}`
              : q.trim()
                ? ""
                : "조건을 적으면 맞는 개수를 보인다"}
          {err && <span className="warn-text"> {err}</span>}
        </p>
        <div className="set-acts smart-acts">
          {!p.isNew && (
            <button
              className="act danger"
              onClick={() => p.onDelete(p.folder.id)}
              title={p.folder.id === RECENT_ID ? "처음부터 있던 「최근 파일」도 뺄 수 있다 — 다시 만들려면 조건 「고친:3일 종류:파일」 · 다운로드 · 바탕화면" : "왼쪽에서 뺀다 (파일은 그대로)"}
            >
              빼기
            </button>
          )}
          <span className="grow" />
          <button className="act" onClick={p.onClose}>
            취소
          </button>
          <button className="act primary" disabled={!canSave} onClick={save}>
            {p.isNew ? "만들기" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
