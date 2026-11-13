// 스마트 폴더 고치기 — 이름 · 조건 · 볼 곳. 고치는 동안 조건 칩과 맞는 개수를 미리 보인다.
//
// 볼 곳: 모든 드라이브(색인) · 다운로드와 바탕화면(바로 아래만 — 「최근 파일」) · 고른 폴더(폴더마다 하위 폴더까지 켜고 끈다).
// NAS · 공유 폴더를 고르면 색인 밖이라 누를 때 그 자리에서 훑는다 (상한 8초 · 2000개).
// 2026.11.12 : 처음 씀.
// 2026.11.13 : 다시 지었다 (사용자 요청 · bespoke). 조건이 글자 칸 하나라 문법을 알아야 고쳤고, 볼 곳은 설명 달린 라디오 세 줄이 자리를 먹었다.
//   · 조건은 찾기 조건 판과 같은 조건 고르기(ConditionForm)로 — 같은 일을 두 곳에서 다른 꼴로 하지 않는다.
//   · 이름 바로 밑에 「맞는 것 N개」 — 고칠 때마다 결과가 먼저 눈에 든다.
//   · 볼 곳은 붙은 단추 줄 하나, 고른 쪽의 뜻은 그 밑 한 줄. 고른 폴더는 경로 줄마다 「하위까지」 단추 · ×.
// 2026.11.12 : 가운데 모달 → 오른쪽 옆판, 바탕을 어둡게 하지 않는다. 있던 스마트 폴더를 고치면 왼쪽 칸이 고친 조건 · 볼 곳으로 바로 다시 모은다 —
//              모달 아래로 결과가 가려 맞는 「개수」만 보였고 무엇이 걸렸는지는 저장한 뒤에야 알았다. 저장하지 않고 닫으면 원래 조건으로 되돌린다.
//              새 스마트 폴더는 칸이 이미 그 찾기를 보이고 있어 미리 바꾸지 않는다 (닫으면 찾던 화면이 그대로 남는다).
import { useEffect, useRef, useState } from "react";
import { api, type QueryResult, type QuerySpec, type Root, type SmartFolder, type SmartScope } from "./api";
import { kindTable, RECENT_ID, scopeOf, sourceLabel, tzOffset } from "./query";
import { ConditionForm } from "./QueryBuilder";
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
  /** 칸에 고친 조건을 미리 띄웠는가 — 저장하지 않고 닫으면 원래 것으로 되돌린다. */
  const previewed = useRef(false);

  const scope: SmartScope = kind === "roots" ? { kind, roots } : kind === "all" ? { kind: "all" } : { kind: "inbox" };

  /** 칸에 스마트 폴더를 띄운다 (App 의 openSmart 와 같은 사건). */
  const showInPane = (f: SmartFolder) => window.dispatchEvent(new CustomEvent("fd:smart", { detail: { folder: f, scope: scopeOf(f.scope, p.inbox) } }));
  const cancel = () => {
    if (previewed.current) showInPane(p.folder);
    p.onClose();
  };

  useEffect(() => {
    (p.isNew ? nameRef.current : null)?.focus();
  }, [p.isNew]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancel 은 p 만 본다
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
      // 있던 것을 고치는 중이면 칸도 같은 조건으로 다시 모은다 (원래와 같아지면 원래 것으로)
      if (!p.isNew && (text !== p.folder.q || scopeKey !== JSON.stringify(p.folder.scope) || previewed.current)) {
        previewed.current = true;
        showInPane({ ...p.folder, name: name.trim() || p.folder.name, q: text, scope });
      }
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

  const WHERE: [SmartScope["kind"], string, string][] = [
    ["all", "모든 드라이브", "고정 드라이브 전체를 색인에서 찾는다. NAS 는 빠진다"],
    ["inbox", "다운로드 · 바탕화면", "두 폴더 바로 아래만. 받은 파일이 쌓이는 곳"],
    ["roots", "고른 폴더", "NAS · 공유 폴더는 누를 때 그 자리에서 훑는다"],
  ];
  const count = busy
    ? "세는 중…"
    : preview
      ? `맞는 것 ${preview.items.length.toLocaleString("ko-KR")}개${preview.truncated ? " 넘게" : ""}`
      : q.trim()
        ? ""
        : "조건을 고르면 맞는 개수가 여기 보인다";

  return (
    <div className="set-backdrop sheet" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="smart-editor se" role="dialog" aria-modal="true" aria-label={p.isNew ? "새 스마트 폴더" : "스마트 폴더 고치기"}>
        {/* 이름이 머리 — 이 판의 제목이 곧 스마트 폴더 이름이다. 그 밑에 맞는 개수 */}
        <input
          ref={nameRef}
          className="se-name"
          value={name}
          placeholder={p.isNew ? "새 스마트 폴더 이름" : "이름"}
          aria-label="이름"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <p className="se-count" aria-live="polite">
          <span className={preview ? "se-count-n" : "muted"}>{count}</span>
          {preview && sourceLabel(preview) && <span className="muted"> · {sourceLabel(preview)}</span>}
          {err && <span className="warn-text"> {err}</span>}
        </p>

        <section className="se-part" aria-label="볼 곳">
          <h4>볼 곳</h4>
          <span className="cs-seg se-where" role="radiogroup" aria-label="볼 곳">
            {WHERE.map(([k, l]) => (
              <button key={k} role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {l}
              </button>
            ))}
          </span>
          <p className="se-note">{WHERE.find((w) => w[0] === kind)?.[2]}</p>
          {kind === "roots" && (
            <ul className="se-roots">
              {roots.map((r, i) => (
                <li key={r.path} className="se-root">
                  <span className="se-path" title={r.path}>
                    {r.path}
                  </span>
                  <button
                    className="se-deep"
                    aria-pressed={r.recursive}
                    title={r.recursive ? "하위 폴더까지 본다 (누르면 이 폴더 바로 아래만)" : "이 폴더 바로 아래만 본다 (누르면 하위 폴더까지)"}
                    onClick={() => setRoots((rs) => rs.map((x, j) => (j === i ? { ...x, recursive: !x.recursive } : x)))}
                  >
                    하위까지
                  </button>
                  <button className="cs-x" aria-label={`${r.path} 빼기`} title="빼기" onClick={() => setRoots((rs) => rs.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </li>
              ))}
              <li className="se-root add">
                <input value={adding} placeholder="폴더 경로 (D:\work · \\NAS\공유)" spellCheck={false} aria-label="더할 폴더 경로" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addRoot(adding)} />
                <button className="act" onClick={() => addRoot(adding)} disabled={!adding.trim()}>
                  더하기
                </button>
                <button className="act" onClick={() => addRoot(p.current)} title={p.current}>
                  지금 폴더
                </button>
              </li>
            </ul>
          )}
        </section>

        <section className="se-part se-cond" aria-label="조건">
          <h4>조건</h4>
          <ConditionForm initial={p.folder.q} kinds={p.kinds} onText={setQ} outLabel="조건 글" />
          {spec?.errors.length ? (
            <div className="smart-chips">
              {spec.errors.map((e) => (
                <span key={e} className="cond-chip warn">
                  {e}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <div className="set-acts smart-acts">
          {!p.isNew && (
            <button
              className="act danger"
              onClick={() => p.onDelete(p.folder.id)}
              title={p.folder.id === RECENT_ID ? "처음부터 있던 「최근 파일」도 뺄 수 있다. 다시 만들려면 조건 「고친:3일 종류:파일」 · 다운로드 · 바탕화면" : "왼쪽에서 뺀다 (파일은 그대로)"}
            >
              빼기
            </button>
          )}
          <span className="grow" />
          <button className="act" onClick={cancel}>
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
