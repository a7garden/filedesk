// 자리 머리 — 경로 조각이 곧 화면 제목이다. 마지막 조각을 크게.
// 2026.11.11 : 조각 뒤의 자리 역할 꼬리표(정본 · 받은 것 · 보관 …)를 뺐다 — 과업 폴더 이름(산출물 · 자료)에 매던 뜻이라 일반 탐색기에 맞지 않는다.
// 조각을 누르면 그리로, 빈 곳을 누르거나 Ctrl+L · Alt+D · F4 면 글로 고친다.
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { segments } from "./util";

export type AddressHandle = { edit: () => void };

type Props = {
  path: string;
  canBack: boolean;
  canFwd: boolean;
  canUp: boolean;
  onBack: () => void;
  onFwd: () => void;
  onUp: () => void;
  /** 입력한 글로 이동. 실패하면 오류 문장을 돌려준다. */
  onSubmit: (input: string) => Promise<string | null>;
  /** 머리 오른쪽 (거르기 · 보기 바꾸기). */
  right?: React.ReactNode;
};

const AddressBar = forwardRef<AddressHandle, Props>(function AddressBar(p, ref) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const edit = () => {
    setText(p.path);
    setError("");
    setEditing(true);
    requestAnimationFrame(() => input.current?.select());
  };
  useImperativeHandle(ref, () => ({ edit }));
  const finish = () => {
    setEditing(false);
    setError("");
  };

  // 조각이 많으면 첫 조각(드라이브)과 끝 네 조각만 두고 가운데는 「…」 로 접는다 — 조각이 눌려 서로 겹치지 않게.
  // 「…」 를 누르면 글로 고치는 칸이 열려 온 경로가 보인다.
  const all = segments(p.path);
  const segs =
    all.length > 6 ? [all[0], { label: "…", path: "" }, ...all.slice(-4)] : all;
  return (
    <header className="head">
      <div className="nav-btns">
        <button onClick={p.onBack} disabled={!p.canBack} title="뒤로 (Alt+←)" aria-label="뒤로">
          ←
        </button>
        <button onClick={p.onFwd} disabled={!p.canFwd} title="앞으로 (Alt+→)" aria-label="앞으로">
          →
        </button>
        <button onClick={p.onUp} disabled={!p.canUp} title="위로 (Alt+↑)" aria-label="위로">
          ↑
        </button>
      </div>
      {editing ? (
        <input
          ref={input}
          className={"path-input" + (error ? " invalid" : "")}
          value={text}
          spellCheck={false}
          aria-label="주소"
          aria-invalid={!!error}
          onChange={(e) => setText(e.target.value)}
          onBlur={finish}
          onKeyDown={async (e) => {
            e.stopPropagation();
            if (e.key === "Escape") finish();
            if (e.key === "Enter") {
              const err = await p.onSubmit(text);
              if (err) setError(err);
              else finish();
            }
          }}
        />
      ) : (
        <div className="crumbs" onClick={(e) => e.target === e.currentTarget && edit()} title="눌러서 경로 입력 (Ctrl+L)">
          {segs.map((s, i) => (
            <span key={s.path || "more"} className="crumb-wrap">
              <button
                className={"crumb" + (i === segs.length - 1 ? " here" : "")}
                title={s.path || p.path}
                onClick={() => (s.path ? p.onSubmit(s.path) : edit())}
              >
                {s.label}
              </button>
              {i < segs.length - 1 && <span className="crumb-sep">/</span>}
            </span>
          ))}
        </div>
      )}
      <div className="head-right">{p.right}</div>
      {error && (
        <div className="path-error" role="alert">
          {error}
        </div>
      )}
    </header>
  );
});

export default AddressBar;
