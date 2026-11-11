// 설정 창 — 왼쪽 아래 「설정」 · Ctrl+, 로 연다. 왼쪽 목차 · 오른쪽 내용.
//
//   보기       목록 · 격자 · 격자 크기 · 아이콘 모양 · 그림 미리보기 · 보일 열 · 숨김 파일 · 화면 색
//   종류       목록 위 거르기 · 아이콘 색의 묶음. 이름 · 확장자 · 색을 고치고 더한다
//   문서 저장소 연도별 프로젝트가 있는 자리
//   이름 규칙   판마다 붙었다 빠졌다 하는 말 (name-rules.json)
//   Claude 스킬 앱 옆 fd.exe 를 부르는 안내서를 `~/.claude/skills/filedesk` 에 쓴다
//
//   2026.11.11 : 이름 규칙은 설정 파일(`name-rules.json`)을 손으로 고쳐야 했다 — 규칙이 비면 「…_프로젝트명_v1」 같은 판이
//   한 문서로 묶이지 않는데, 쓰는 사람은 그 까닭을 알 길이 없었다. 여기서 한 줄에 하나씩 고친다.
//   보기 설정은 바꾸는 즉시 목록에 쓰고 저장한다 — 「저장」 단추는 글을 고치는 이름 규칙에만 둔다.
import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, type ColKey, type NameRules, type SkillStatus, type Theme, type ViewPrefs } from "./api";
import { checkUpdate } from "./updater";
import { DEFAULT_KINDS, errText, KIND_PALETTE, type KindDef, parseExts } from "./util";

type Props = {
  storeRoot: string;
  current: string;
  onStoreRoot: (p: string) => void;
  view: ViewPrefs;
  setView: (f: (v: ViewPrefs) => ViewPrefs) => void;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  resetCols: () => void;
  onClose: () => void;
};

type Section = "view" | "kinds" | "store" | "rules" | "skill";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "view", label: "보기" },
  { key: "kinds", label: "종류" },
  { key: "store", label: "문서 저장소" },
  { key: "rules", label: "이름 규칙" },
  { key: "skill", label: "Claude 스킬" },
];
export const SIZE_LABEL = ["작게", "보통", "크게", "아주 크게"];
const COL_LABEL: Record<ColKey, string> = { ver: "판", date: "고친 날", size: "크기" };

const lines = (v: string) => v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export default function SettingsPanel(props: Props) {
  const { storeRoot, current, onStoreRoot, view, setView, showHidden, setShowHidden, theme, setTheme, resetCols, onClose } = props;
  const box = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<Section>("view");
  const [rules, setRules] = useState<{ projectNames: string; people: string; statusWords: string } | null>(null);
  const [saved, setSaved] = useState<"" | "saved" | string>("");
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const [skillMsg, setSkillMsg] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
    api
      .nameRules()
      .then((r) => setRules({ projectNames: r.projectNames.join("\n"), people: r.people.join("\n"), statusWords: r.statusWords.join("\n") }))
      .catch((e) => setSaved(errText(e)));
    api.skillStatus().then(setSkill).catch(() => {});
    getVersion().then(setVersion).catch(() => {});
    box.current?.querySelector<HTMLButtonElement>(".set-nav button[aria-current]")?.focus();
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);

  const saveRules = () => {
    if (!rules) return;
    const r: NameRules = { projectNames: lines(rules.projectNames), people: lines(rules.people), statusWords: lines(rules.statusWords) };
    api
      .saveNameRules(r)
      .then(() => {
        setSaved("saved");
        // 열린 목록이 새 규칙으로 다시 묶이게 한다 (Pane [1] 이 지금 폴더를 다시 읽는다).
        window.dispatchEvent(new CustomEvent("fd:rules"));
      })
      .catch((e) => setSaved(errText(e)));
  };

  const installSkill = () => {
    setSkillMsg("");
    api
      .installSkill()
      .then((s) => {
        setSkill(s);
        setSkillMsg("설치했다 — Claude Code 를 새로 열면 「filedesk」 스킬이 보인다");
      })
      .catch((e) => setSkillMsg(errText(e)));
  };

  const field = (key: keyof NonNullable<typeof rules>, label: string, hint: string) => (
    <label className="set-field">
      <span className="set-label">
        {label} <span className="muted">{hint}</span>
      </span>
      <textarea
        rows={4}
        spellCheck={false}
        value={rules?.[key] ?? ""}
        disabled={!rules}
        onChange={(e) => {
          setSaved("");
          setRules((r) => (r ? { ...r, [key]: e.target.value } : r));
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );

  /** 둘 이상 중 하나 고르기 — 단추 묶음 (라디오와 같은 뜻). */
  const choice = <T extends string | number>(label: string, value: T, options: { v: T; label: string }[], set: (v: T) => void, hint?: string) => (
    <div className="set-row">
      <span className="set-label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} role="radio" aria-checked={value === o.v} className={value === o.v ? "on" : ""} onClick={() => set(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className="muted set-hint">{hint}</span>}
    </div>
  );

  const check = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="set-check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
      {hint && <span className="muted set-hint">{hint}</span>}
    </label>
  );

  const skillOld = skill?.installed && skill.installed !== skill.current;

  return (
    <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" ref={box} role="dialog" aria-modal="true" aria-label="설정">
        <nav className="set-nav" aria-label="설정 목차">
          <h2>설정</h2>
          {SECTIONS.map((s) => (
            <button key={s.key} aria-current={section === s.key ? "page" : undefined} onClick={() => setSection(s.key)}>
              {s.label}
            </button>
          ))}
          <div className="set-ver">
            <span>filedesk {version && `v${version}`}</span>
            <button className="act" onClick={() => checkUpdate(true)}>
              새 판 확인
            </button>
          </div>
        </nav>
        <div className="set-body">
          <button className="set-close" aria-label="설정 닫기" title="닫기 (Esc)" onClick={onClose}>
            ×
          </button>
          {section === "view" && (
            <section>
              <h3>보기</h3>
              {choice("파일 보기", view.mode, [{ v: "list", label: "목록" }, { v: "grid", label: "격자" }], (mode) => setView((v) => ({ ...v, mode })), "목록 아래 단추 · Ctrl+휠로도 바꾼다")}
              {choice(
                "격자 크기",
                view.size,
                SIZE_LABEL.map((label, i) => ({ v: i, label })),
                (size) => setView((v) => ({ ...v, size })),
              )}
              {choice(
                "아이콘",
                view.icons,
                [
                  { v: "shell", label: "Windows" },
                  { v: "filedesk", label: "filedesk" },
                ],
                (icons) => setView((v) => ({ ...v, icons })),
                "filedesk — 종류마다 색이 다른 단순한 그림",
              )}
              {check("그림 · PDF · 영상은 격자에서 내용을 미리 보인다", view.thumbs, (thumbs) => setView((v) => ({ ...v, thumbs })))}
              <div className="set-row">
                <span className="set-label">목록에 보일 열</span>
                <div className="set-cols">
                  {(Object.keys(COL_LABEL) as ColKey[]).map((c) => (
                    <label key={c} className="set-check inline">
                      <input
                        type="checkbox"
                        checked={!view.hiddenCols.includes(c)}
                        onChange={(e) =>
                          setView((v) => ({ ...v, hiddenCols: e.target.checked ? v.hiddenCols.filter((x) => x !== c) : [...v.hiddenCols, c] }))
                        }
                      />
                      <span>{COL_LABEL[c]}</span>
                    </label>
                  ))}
                  <button className="act" onClick={resetCols} title="열 머리 사이 줄을 끌어 바꾼 너비를 처음대로">
                    열 너비 처음대로
                  </button>
                </div>
                <span className="muted set-hint">열 머리 사이를 끌어 너비를 바꾼다 · 두 번 누르면 그 열만 처음대로 · 열 머리 오른쪽 단추로도 고른다</span>
              </div>
              {check("숨김 · 시스템 파일도 보인다", showHidden, setShowHidden, "Ctrl+H")}
              {choice(
                "화면 색",
                theme,
                [
                  { v: "system", label: "시스템" },
                  { v: "light", label: "밝게" },
                  { v: "dark", label: "어둡게" },
                ],
                setTheme,
              )}
            </section>
          )}

          {section === "kinds" && <KindsEditor kinds={view.kinds} set={(kinds) => setView((v) => ({ ...v, kinds }))} />}

          {section === "store" && (
            <section>
              <h3>문서 저장소</h3>
              <p className="muted set-note">연도별 프로젝트 폴더(`사업\연도\프로젝트`)가 있는 자리. 정하면 왼쪽에 프로젝트가 보인다.</p>
              <p className="set-path" title={storeRoot}>
                {storeRoot || <span className="muted">정하지 않았다</span>}
              </p>
              <div className="set-acts">
                <button className="act primary" onClick={() => onStoreRoot(current)} title={current}>
                  지금 폴더로 정하기
                </button>
                {storeRoot && (
                  <button className="act" onClick={() => onStoreRoot("")}>
                    비우기
                  </button>
                )}
              </div>
              <p className="muted set-note">지금 폴더: {current}</p>
            </section>
          )}

          {section === "rules" && (
            <section>
              <h3>이름 규칙</h3>
              <p className="muted set-note">판마다 붙었다 빠졌다 하는 말 — 문서 이름에서 떼고 한 문서로 묶는다. 한 줄에 하나.</p>
              {field("projectNames", "프로젝트 이름", "…_예시과업_v1.6")}
              {field("people", "사람 이름", "…_홍길동")}
              {field("statusWords", "상태어", "최종 · 수정본 — 판을 가리지 못해 알린다")}
              <div className="set-acts">
                <button className="act primary" disabled={!rules} onClick={saveRules}>
                  저장
                </button>
                {saved === "saved" ? <span className="muted">저장했다 · 목록에 바로 쓴다</span> : saved && <span className="warn-text">{saved}</span>}
              </div>
            </section>
          )}

          {section === "skill" && (
            <section>
              <h3>Claude 스킬</h3>
              <p className="muted set-note">
                Claude Code 가 filedesk 명령줄(fd)로 판 정리 · 새 판 · 메모 · 색 표시 · 찾기 · 휴지통을 다루게 한다. 파일을 바꾸기 전에는 늘 계획을 먼저 보인다.
              </p>
              <p className="set-path">
                {skill == null
                  ? "확인 중…"
                  : skill.installed
                    ? skillOld
                      ? `설치됨 (${skill.installed}) — 앱은 ${skill.current}. 다시 설치하면 새 명령이 들어간다`
                      : `설치됨 (${skill.installed})`
                    : "설치 안 됨"}
              </p>
              <div className="set-acts">
                <button
                  className={"act" + (!skill?.installed || skillOld ? " primary" : "")}
                  disabled={!skill?.hasCli}
                  title={skill?.hasCli ? (skill.file ?? "") : "설치본(릴리즈의 setup.exe)으로 깔아야 fd.exe 가 함께 들어온다"}
                  onClick={installSkill}
                >
                  {skill?.installed ? "다시 설치" : "설치"}
                </button>
                {!skill?.hasCli && skill && <span className="muted">설치본에서만 된다</span>}
              </div>
              {skillMsg && <p className="set-note">{skillMsg}</p>}
              {skill?.file && <p className="muted set-note">자리: {skill.file}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** 종류 편집 — 한 줄에 종류 하나: 색 · 이름 · 확장자 · 순서 · 빼기. 바꾸는 즉시 목록에 쓴다 (보기 설정과 같다).
 *  확장자 칸은 고치는 동안 글 그대로 두고, 칸을 떠날 때 목록으로 맞춘다 — 쓰는 도중에 빈칸 · 점이 지워지면 글을 쓸 수 없다. */
function KindsEditor({ kinds, set }: { kinds: KindDef[]; set: (k: KindDef[]) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const owner = new Map<string, string>();
  for (const k of kinds) for (const x of k.exts) if (!owner.has(x)) owner.set(x, k.id);
  const put = (i: number, patch: Partial<KindDef>) => set(kinds.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= kinds.length) return;
    const n = [...kinds];
    [n[i], n[j]] = [n[j], n[i]];
    set(n);
  };
  const add = () => {
    const id = `k${Date.now().toString(36)}`;
    set([...kinds, { id, label: "새 종류", exts: [], color: KIND_PALETTE[kinds.length % KIND_PALETTE.length] }]);
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-kind="${id}"]`)?.select(), 0);
  };
  const commit = (i: number, id: string) => {
    if (draft[id] == null) return;
    put(i, { exts: parseExts(draft[id]) });
    setDraft(({ [id]: _, ...rest }) => rest);
  };
  return (
    <section>
      <h3>종류</h3>
      <p className="muted set-note">목록 위 「종류」 거르기와 filedesk 아이콘의 색 띠가 이 묶음을 쓴다. 확장자는 빈칸으로 나눈다. 「폴더」와, 어디에도 없는 확장자가 가는 「기타」는 늘 있다.</p>
      <div className="kind-edit" role="list">
        {kinds.map((k, i) => {
          // 앞 종류가 이미 가진 확장자 — 이 종류에서는 효과가 없다
          const lost = k.exts.filter((x) => owner.get(x) !== k.id);
          return (
            <div className="kind-edit-row" role="listitem" key={k.id}>
              <input type="color" className="kind-swatch" value={k.color} aria-label={`${k.label} 색`} onChange={(e) => put(i, { color: e.target.value })} />
              <input
                className="kind-name"
                data-kind={k.id}
                value={k.label}
                aria-label="종류 이름"
                onChange={(e) => put(i, { label: e.target.value })}
                onBlur={(e) => !e.target.value.trim() && put(i, { label: "이름 없음" })}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <input
                className="kind-exts"
                spellCheck={false}
                value={draft[k.id] ?? k.exts.join(" ")}
                placeholder="확장자 — 예: hwp docx"
                aria-label={`${k.label} 확장자`}
                onChange={(e) => setDraft((d) => ({ ...d, [k.id]: e.target.value }))}
                onBlur={() => commit(i, k.id)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit(i, k.id);
                }}
              />
              <span className="kind-edit-acts">
                <button className="icon-btn" aria-label="위로" title="위로 — 확장자가 겹치면 위 종류가 갖는다" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="icon-btn" aria-label="아래로" title="아래로" disabled={i === kinds.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="icon-btn" aria-label={`${k.label} 빼기`} title="빼기 — 이 확장자들은 「기타」가 된다" onClick={() => set(kinds.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
              {lost.length > 0 && <span className="kind-edit-warn">{lost.join(" ")} — 위 종류에 이미 있어 여기서는 쓰이지 않는다</span>}
            </div>
          );
        })}
      </div>
      <div className="set-acts">
        <button className="act primary" onClick={add}>
          종류 더하기
        </button>
        <button className="act" onClick={() => set(DEFAULT_KINDS)} title="문서 · 표 · 발표 · PDF · 그림 · 영상 · 소리 · 압축 · 코드">
          처음대로
        </button>
      </div>
    </section>
  );
}
