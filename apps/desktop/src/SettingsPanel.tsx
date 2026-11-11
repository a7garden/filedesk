// 설정 — 왼쪽 아래 「설정」 · Ctrl+, · 명령 팔레트로 연다.
//
// 목차 (한 장으로 이어진다 · 왼쪽 목차는 지금 읽는 자리를 따라간다)
//   보기       크기 사다리 · 보일 열 · 숨김 파일 · 격자 미리보기
//   목록       기본 정렬 · 폴더를 위에 · 판 접어 시작 · 고친 날 · 크기 꼴
//   열기       폴더 열기(두 번 · 한 번 누르기) · 시작 폴더
//   화면 색     시스템 · 밝게 · 어둡게 — 작은 창 그림으로 고른다
//   아이콘      Windows · filedesk · 아이콘 팩 — 같은 파일 몇 개가 셋에서 어떻게 보이는지 나란히
//   종류       목록 위 종류 · 아이콘 색의 묶음. 확장자 칩을 다른 종류로 끌어 옮긴다
//   Claude 스킬 앱 옆 fd.exe 를 부르는 안내서를 `~/.claude/skills/filedesk` 에 쓴다
//
//   2026.11.11 : 칸을 넘기는 대화 창(왼쪽 목차 · 오른쪽 입력 칸)을 한 장으로 바꿨다. 칸을 넘기면 다른 설정이 보이지 않아
//   「어디 있었지」를 찾아 목차를 눌러 봐야 했고, 입력 칸만으로는 바꾼 결과를 알 수 없었다. 이제 설정마다 그 결과를 그 자리에 그린다.
//   화면 색 단추를 왼쪽 아래에서 여기로 옮겼다.
//   설정은 바꾸는 즉시 목록에 쓰고 저장한다 — 「저장」 단추가 없다.
//   2026.11.11 : 「문서 저장소」(연도별 프로젝트) · 「이름 규칙」(판을 묶을 때 뗄 과업 이름 · 사람 이름 · 상태어)을 뺐다.
//                일반 파일 탐색기에 한 과업에만 맞는 설정이었다 — 상태어는 고정 목록, 작성자 꼬리는 이름 꼴로 추정한다 (fd-core docname).
import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, iconUrl, type ColKey, type Entry, type SkillStatus, type Theme, type ViewPrefs } from "./api";
import { FileGlyph, FolderGlyph } from "./glyphs";
import SizeLadder from "./SizeLadder";
import { checkUpdate } from "./updater";
import { DEFAULT_KINDS, errText, formatSize, KIND_PALETTE, type KindDef, parseExts, relDate, type SortKey } from "./util";

type Props = {
  current: string;
  view: ViewPrefs;
  setView: (f: (v: ViewPrefs) => ViewPrefs) => void;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  resetCols: () => void;
  /** 켤 때 열 폴더 — 비면 지난 탭. */
  start: string;
  setStart: (v: string) => void;
  onClose: () => void;
};

const SECTIONS = [
  { id: "view", label: "보기" },
  { id: "list", label: "목록" },
  { id: "open", label: "열기" },
  { id: "theme", label: "화면 색" },
  { id: "icons", label: "아이콘" },
  { id: "kinds", label: "종류" },
  { id: "skill", label: "Claude 스킬" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** 크기 꼴 견본 — 흔한 한글 문서 크기. */
const SIZE_SAMPLE = { isDir: false, size: 2_450_000 } as Entry;

/** 아이콘 견주기에 쓰는 표본 — 폴더 · 한글 · 표 · 발표 · PDF · 마크다운 · 그림. */
const SAMPLES: { name: string; ext: string; isDir: boolean }[] = [
  { name: "보고", ext: "", isDir: true },
  { name: "검토의견서.hwpx", ext: "hwpx", isDir: false },
  { name: "현황.xlsx", ext: "xlsx", isDir: false },
  { name: "중간보고.pptx", ext: "pptx", isDir: false },
  { name: "회신.pdf", ext: "pdf", isDir: false },
  { name: "README.md", ext: "md", isDir: false },
  { name: "현장.png", ext: "png", isDir: false },
];

export default function SettingsPanel(props: Props) {
  const { current, view, setView, showHidden, setShowHidden, theme, setTheme, resetCols, start, setStart, onClose } = props;
  const body = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<SectionId>("view");
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const [skillMsg, setSkillMsg] = useState("");
  const [version, setVersion] = useState("");
  /** 아이콘 팩 폴더에서 찾은 그림 — 이름 → 경로. */
  const [packMap, setPackMap] = useState<Record<string, string> | null>(null);
  const [packErr, setPackErr] = useState("");

  useEffect(() => {
    api.skillStatus().then(setSkill).catch(() => {});
    getVersion().then(setVersion).catch(() => {});
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

  // 목차가 지금 읽는 구획을 따라간다 — 본문 위 끝에서 96px 안으로 머리가 올라온 마지막 구획 (목차를 눌러 옮긴 구획과 같게).
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const on = () => {
      const top = el.getBoundingClientRect().top + 96;
      let cur: SectionId = "view";
      for (const s of SECTIONS) {
        const h = el.querySelector<HTMLElement>(`#set-${s.id}`);
        if (h && h.getBoundingClientRect().top <= top) cur = s.id;
      }
      // 끝까지 내리면 마지막 구획 — 마지막 구획이 짧으면 머리가 위쪽까지 올라오지 못한다
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) cur = SECTIONS[SECTIONS.length - 1].id;
      setAt(cur);
    };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, []);
  const jump = (id: SectionId) => body.current?.querySelector(`#set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    if (!view.iconPack) return setPackMap(null);
    api
      .iconPack(view.iconPack)
      .then((m) => {
        setPackMap(m);
        setPackErr("");
      })
      .catch((e) => {
        setPackMap(null);
        setPackErr(errText(e));
      });
  }, [view.iconPack]);

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

  const check = (label: string, on: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="set-check">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
      {hint && <span className="muted set-hint">{hint}</span>}
    </label>
  );

  /** 하나를 고르는 줄 — 선택지마다 그 결과(견본 · 동작)를 옆에 적어, 누르기 전에 견준다.
   *  options: [값, 이름, 결과]. 결과가 있으면 위아래 줄, 없으면 한 줄에 나란히.
   *  2026.11.11 : 열 머리 칩(col-chip)을 빌려 쓰던 것을 바꿨다. 그 칩은 「끈 열」을 취소선으로 그려
   *  고르지 않은 선택지가 지워진 것처럼 보였다. 네이티브 radio 라 방향키로 옮긴다. */
  const choice = <T extends string>(label: string, options: [T, string, string?][], on: T, set: (v: T) => void) => (
    <div className={"pick" + (options.some((o) => o[2]) ? " rows" : " inline")} role="radiogroup" aria-label={label}>
      {options.map(([v, l, note]) => (
        <label key={v} className="pick-opt">
          <input type="radio" name={`pick-${label}`} checked={on === v} onChange={() => set(v)} />
          <span className="pick-name">{l}</span>
          {note && <span className="pick-note">{note}</span>}
        </label>
      ))}
    </div>
  );
  const sample = Date.now() - 3 * 3600_000;

  const colOn = (c: ColKey) => !view.hiddenCols.includes(c);
  const toggleCol = (c: ColKey) => setView((v) => ({ ...v, hiddenCols: v.hiddenCols.includes(c) ? v.hiddenCols.filter((x) => x !== c) : [...v.hiddenCols, c] }));
  const skillOld = skill?.installed && skill.installed !== skill.current;

  /** 아이콘 방식 하나의 견본 — 표본을 그 방식으로. 팩에 없는 것은 filedesk 그림 (목록과 같은 규칙). */
  const iconSample = (mode: ViewPrefs["icons"]) =>
    SAMPLES.map((s) => {
      const e = { isDir: s.isDir, ext: s.ext, path: s.name };
      let pic: React.ReactNode;
      const packFile = mode === "pack" && packMap ? (s.isDir ? packMap.folder : (packMap[s.ext] ?? packMap[kindIdOf(s.ext) ?? ""] ?? packMap.file)) : undefined;
      if (packFile) pic = <img src={`http://fdicon.localhost/${encodeURIComponent(`pack:${packFile}`)}`} width={22} height={22} alt="" style={{ objectFit: "contain" }} />;
      else if (mode === "shell") pic = s.isDir ? <FolderGlyph size={22} /> : <img src={iconUrl(e)} width={22} height={22} alt="" />;
      else pic = s.isDir ? <FolderGlyph size={22} /> : <FileGlyph ext={s.ext} size={22} />;
      return (
        <span key={s.name} className="icon-sample" title={s.name}>
          {pic}
        </span>
      );
    });

  return (
    <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="설정">
        <nav className="set-nav" aria-label="설정 목차">
          <h2>설정</h2>
          {SECTIONS.map((s) => (
            <button key={s.id} aria-current={at === s.id ? "location" : undefined} onClick={() => jump(s.id)}>
              {s.label}
            </button>
          ))}
          <div className="set-ver">
            <span>filedesk {version && `v${version}`}</span>
            <button className="act" onClick={() => checkUpdate(true)}>
              업데이트 확인
            </button>
          </div>
        </nav>
        <div className="set-body" ref={body}>
          <button className="set-close" aria-label="설정 닫기" title="닫기 (Esc)" onClick={onClose}>
            ×
          </button>

          <section id="set-view" aria-labelledby="h-view">
            <h3 id="h-view">보기</h3>
            <div className="set-line">
              <span className="set-label">크기</span>
              <div>
                <SizeLadder view={view} setView={setView} />
                <p className="muted set-hint">목록 아래 줄에 같은 눈금이 있다 · Ctrl+휠 · Ctrl+= / −</p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">목록 열</span>
              <div>
                {/* 목록 머리 모양 그대로 — 열 이름을 눌러 켜고 끈다. 이름 열은 늘 있다 */}
                <div className="col-preview" role="group" aria-label="목록에 보일 열">
                  <span className="col-chip fixed">이름</span>
                  {(
                    [
                      ["ver", "판"],
                      ["date", "고친 날"],
                      ["size", "크기"],
                    ] as [ColKey, string][]
                  ).map(([c, l]) => (
                    <button key={c} className="col-chip" aria-pressed={colOn(c)} onClick={() => toggleCol(c)} title={colOn(c) ? `${l} 열 숨기기` : `${l} 열 보이기`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="muted set-hint">
                  눌러서 켜고 끈다 · 열 너비는 목록 머리의 경계선을 끌어 바꾼다 ·{" "}
                  <button className="link-btn" onClick={resetCols}>
                    너비 처음대로
                  </button>
                </p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">보일 것</span>
              <div>
                {check("숨김 · 시스템 파일", showHidden, setShowHidden, "Ctrl+H")}
                {check("격자에서 그림 · PDF · 영상의 내용 미리보기", view.thumbs, (thumbs) => setView((v) => ({ ...v, thumbs })))}
                {check("왼쪽 열의 최근 파일 (다운로드 · 바탕화면에 최근 생긴 것)", view.recent, (recent) => setView((v) => ({ ...v, recent })))}
              </div>
            </div>
          </section>

          <section id="set-list" aria-labelledby="h-list">
            <h3 id="h-list">목록</h3>
            <div className="set-line">
              <span className="set-label">정렬</span>
              <div>
                {choice<SortKey>(
                  "기본 정렬",
                  [
                    ["name", "이름"],
                    ["modified", "고친 날"],
                    ["kind", "종류"],
                    ["size", "크기"],
                  ],
                  view.sort.key,
                  (key) => setView((v) => ({ ...v, sort: { key, asc: key === "name" || key === "kind" } })),
                )}
                {choice<"asc" | "desc">(
                  "정렬 방향",
                  [
                    ["asc", view.sort.key === "modified" ? "옛것부터" : view.sort.key === "size" ? "작은 것부터" : "가나다순"],
                    ["desc", view.sort.key === "modified" ? "최근 것부터" : view.sort.key === "size" ? "큰 것부터" : "거꾸로"],
                  ],
                  view.sort.asc ? "asc" : "desc",
                  (d) => setView((v) => ({ ...v, sort: { ...v.sort, asc: d === "asc" } })),
                )}
                <p className="muted set-hint">새 탭 · 다시 켤 때 이 정렬로 시작한다 · 열 머리를 눌러 바꾼 정렬은 그 탭에서만</p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">늘어놓기</span>
              <div>
                {check("폴더를 파일 위에 모으기", view.dirsFirst, (dirsFirst) => setView((v) => ({ ...v, dirsFirst })), "끄면 고친 날 순서에 폴더가 섞인다")}
                {check("판을 접은 채 시작", view.foldStart, (foldStart) => setView((v) => ({ ...v, foldStart })), "Ctrl+Shift+D 는 그 탭에서만")}
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">고친 날</span>
              <div>
                {choice(
                  "고친 날 표시",
                  [
                    ["relative", "가깝게", relDate(sample, "relative")],
                    ["absolute", "정확히", relDate(sample, "absolute")],
                  ],
                  view.dateStyle,
                  (dateStyle) => setView((v) => ({ ...v, dateStyle })),
                )}
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">크기</span>
              <div>
                {choice(
                  "크기 표시",
                  [
                    ["kb", "탐색기처럼", formatSize(SIZE_SAMPLE, "kb")],
                    ["auto", "알맞은 단위", formatSize(SIZE_SAMPLE, "auto")],
                  ],
                  view.sizeUnit,
                  (sizeUnit) => setView((v) => ({ ...v, sizeUnit })),
                )}
              </div>
            </div>
          </section>

          <section id="set-open" aria-labelledby="h-open">
            <h3 id="h-open">열기</h3>
            <div className="set-line">
              <span className="set-label">폴더 열기</span>
              <div>
                {choice(
                  "폴더 열기",
                  [
                    ["double", "두 번 눌러 열기", "탐색기와 같다 · 한 번 누르면 고른다"],
                    ["single", "한 번 눌러 열기", "고르기는 Ctrl · Shift 누르기나 방향키 · 파일은 두 번 눌러 연다"],
                  ],
                  view.folderClick,
                  (folderClick) => setView((v) => ({ ...v, folderClick })),
                )}
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">시작 폴더</span>
              <div>
                {choice(
                  "켤 때",
                  [
                    ["last", "지난 탭 그대로", "지난번에 열어 둔 탭 · 나눠 보기 그대로 연다"],
                    ["folder", "정한 폴더", start || "고르면 지금 폴더로 정한다"],
                  ],
                  start ? "folder" : "last",
                  (m) => setStart(m === "folder" ? start || current : ""),
                )}
                {start && start !== current && (
                  <p className="set-hint pick-after">
                    <button className="link-btn" onClick={() => setStart(current)} title={current}>
                      지금 폴더로 바꾸기
                    </button>
                  </p>
                )}
              </div>
            </div>
          </section>

          <section id="set-theme" aria-labelledby="h-theme">
            <h3 id="h-theme">화면 색</h3>
            <div className="theme-pick" role="radiogroup" aria-label="화면 색">
              {(
                [
                  ["system", "시스템", "Windows 설정(밝게 · 어둡게)을 따른다"],
                  ["light", "밝게", "밝게"],
                  ["dark", "어둡게", "어둡게"],
                ] as [Theme, string, string][]
              ).map(([t, l, hint]) => (
                <button key={t} role="radio" aria-checked={theme === t} className={"theme-card" + (theme === t ? " on" : "")} onClick={() => setTheme(t)} title={hint}>
                  <MiniWindow theme={t} />
                  <span>{l}</span>
                </button>
              ))}
            </div>
          </section>

          <section id="set-icons" aria-labelledby="h-icons">
            <h3 id="h-icons">아이콘</h3>
            <div className="icon-pick" role="radiogroup" aria-label="아이콘">
              {(
                [
                  ["shell", "Windows", "탐색기와 같은 그림 — 깔린 프로그램을 따른다"],
                  ["filedesk", "filedesk", "형식마다 그린 그림 — 깔린 프로그램과 상관없이 같다"],
                  ["pack", "아이콘 팩", "고른 폴더의 그림 — 없는 것은 filedesk 그림"],
                ] as [ViewPrefs["icons"], string, string][]
              ).map(([m, l, hint]) => (
                <button key={m} role="radio" aria-checked={view.icons === m} className={"icon-row" + (view.icons === m ? " on" : "")} onClick={() => setView((v) => ({ ...v, icons: m }))}>
                  <span className="icon-row-name">{l}</span>
                  <span className="icon-row-samples">{iconSample(m)}</span>
                  <span className="muted icon-row-hint">{hint}</span>
                </button>
              ))}
            </div>
            {view.icons === "pack" && (
              <div className="pack-box">
                <p className="set-path" title={view.iconPack}>
                  {view.iconPack || <span className="muted">아이콘 팩 폴더를 정하지 않았다</span>}
                </p>
                <div className="set-acts">
                  <button className="act primary" onClick={() => setView((v) => ({ ...v, iconPack: current }))} title={current}>
                    지금 폴더로 정하기
                  </button>
                  {view.iconPack && (
                    <button className="act" onClick={() => setView((v) => ({ ...v, iconPack: "" }))}>
                      비우기
                    </button>
                  )}
                  {packErr && <span className="warn-text">{packErr}</span>}
                </div>
                <p className="muted set-note">
                  폴더에 그림(svg · png · ico · webp)을 두고 이름을 확장자(<code>pdf.svg</code>) · 종류(<code>doc.png</code>) · <code>folder</code> · <code>file</code> 로 짓는다.
                  확장자 → 종류 → file 차례로 찾는다.
                  {packMap && ` 찾은 그림 ${Object.keys(packMap).length}개${Object.keys(packMap).length ? ` — ${Object.keys(packMap).sort().slice(0, 12).join(" · ")}${Object.keys(packMap).length > 12 ? " …" : ""}` : ""}`}
                </p>
              </div>
            )}
          </section>

          <section id="set-kinds" aria-labelledby="h-kinds">
            <h3 id="h-kinds">종류</h3>
            <KindsEditor kinds={view.kinds} set={(kinds) => setView((v) => ({ ...v, kinds }))} />
          </section>

          <section id="set-skill" aria-labelledby="h-skill">
            <h3 id="h-skill">Claude 스킬</h3>
            <p className="muted set-note">
              Claude Code 가 filedesk 명령줄(fd)로 판 정리 · 새 판 · 메모 · 색 표시 · 찾기 · 휴지통을 다루게 한다. 파일을 바꾸기 전에는 늘 계획을 먼저 보인다.
            </p>
            <div className="set-acts">
              <span className="set-path">
                {skill == null
                  ? "확인 중…"
                  : skill.installed
                    ? skillOld
                      ? `설치됨 (${skill.installed}) — 앱은 ${skill.current}. 다시 설치하면 새 명령이 들어간다`
                      : `설치됨 (${skill.installed})`
                    : "설치 안 됨"}
              </span>
              <button
                className={"act" + (!skill?.installed || skillOld ? " primary" : "")}
                disabled={!skill?.hasCli}
                title={skill?.hasCli ? (skill.file ?? "") : "설치 파일(릴리스의 setup.exe)로 깔아야 fd.exe 가 함께 깔린다"}
                onClick={installSkill}
              >
                {skill?.installed ? "다시 설치" : "설치"}
              </button>
              {!skill?.hasCli && skill && <span className="muted">설치 파일로 깐 앱에서만 된다</span>}
            </div>
            {skillMsg && <p className="set-note">{skillMsg}</p>}
            {skill?.file && <p className="muted set-note">자리: {skill.file}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

/** 표본 확장자의 기본 종류 id — 아이콘 팩 견본이 「종류 이름 그림」을 찾을 때. */
const kindIdOf = (ext: string) => DEFAULT_KINDS.find((k) => k.exts.includes(ext))?.id;

/** 작은 창 그림 — 화면 색 고르기. 시스템은 왼쪽 밝게 · 오른쪽 어둡게 반반. */
function MiniWindow({ theme }: { theme: Theme }) {
  const L = { bg: "#f7f7f5", side: "#ecebe7", line: "#d9d8d3", ink: "#3a3a38" };
  const D = { bg: "#1f2023", side: "#2a2b2f", line: "#3b3c41", ink: "#d6d6d3" };
  const c = theme === "dark" ? D : L;
  return (
    <svg width="76" height="48" viewBox="0 0 76 48" aria-hidden="true" className="mini-window">
      <defs>
        <clipPath id={`mw-${theme}`}>
          <rect width="76" height="48" rx="5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#mw-${theme})`}>
        <rect width="76" height="48" fill={c.bg} />
        <rect width="18" height="48" fill={c.side} />
        {theme === "system" && <rect x="38" width="38" height="48" fill={D.bg} />}
        {[10, 18, 26, 34].map((y) => (
          <g key={y}>
            <rect x="22" y={y} width={theme === "system" ? 14 : 48} height="3" rx="1.5" fill={c.line} />
            {theme === "system" && <rect x="40" y={y} width="30" height="3" rx="1.5" fill={D.line} />}
          </g>
        ))}
        <rect x="22" y="4" width="24" height="3" rx="1.5" fill={c.ink} />
      </g>
    </svg>
  );
}

/** 종류 편집 — 한 줄에 종류 하나: 색 · 이름 · 확장자 칩 · 순서 · 빼기. 바꾸는 즉시 목록에 쓴다.
 *  확장자는 칩 하나가 하나 — 칩을 다른 종류 줄로 끌어 옮기고, × 로 빼고, 줄 끝 칸에 적어 더한다 (빈칸 · 쉼표로 여럿).
 *  2026.11.11 : 한 줄 글 칸이던 것을 칩으로. 글 칸에서는 「pptx 를 발표에서 문서로」가 두 칸을 고치는 일이었다.
 *  끌기는 마우스 움직임으로 짠다 — Tauri 가 창 밖 파일 끌기를 받으려고 웹 끌기(HTML5 DnD)를 막아 두었다. */
function KindsEditor({ kinds, set }: { kinds: KindDef[]; set: (k: KindDef[]) => void }) {
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ ext: string; from: string; x: number; y: number; on: boolean; over: string | null } | null>(null);
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
  const addKind = () => {
    const id = `k${Date.now().toString(36)}`;
    set([...kinds, { id, label: "새 종류", exts: [], color: KIND_PALETTE[kinds.length % KIND_PALETTE.length] }]);
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-kind-name="${id}"]`)?.select(), 0);
  };
  const addExts = (i: number, id: string) => {
    const xs = parseExts(adding[id] ?? "");
    if (!xs.length) return;
    // 다른 종류에 있던 확장자는 그쪽에서 빼고 여기로 — 「더하기」가 곧 「옮기기」
    set(kinds.map((k, j) => (j === i ? { ...k, exts: [...k.exts.filter((x) => !xs.includes(x)), ...xs] } : { ...k, exts: k.exts.filter((x) => !xs.includes(x)) })));
    setAdding((a) => ({ ...a, [id]: "" }));
  };
  const moveExt = (ext: string, from: string, to: string) => {
    if (from === to) return;
    set(kinds.map((k) => (k.id === from ? { ...k, exts: k.exts.filter((x) => x !== ext) } : k.id === to ? { ...k, exts: [...k.exts.filter((x) => x !== ext), ext] } : k)));
  };

  useEffect(() => {
    if (!drag) return;
    const mv = (m: MouseEvent) =>
      setDrag((d) => {
        if (!d) return d;
        const on = d.on || Math.hypot(m.clientX - d.x, m.clientY - d.y) > 4;
        const row = (document.elementFromPoint(m.clientX, m.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-kind-row]");
        return { ...d, on, x: on ? m.clientX : d.x, y: on ? m.clientY : d.y, over: row?.dataset.kindRow ?? null };
      });
    const up = () =>
      setDrag((d) => {
        if (d?.on && d.over) moveExt(d.ext, d.from, d.over);
        return null;
      });
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag != null, kinds]);

  return (
    <>
      <p className="muted set-note">목록 위 종류 거르기가 이 묶음을 쓴다. 확장자를 다른 종류로 끌어 옮긴다. 「폴더」와, 어디에도 없는 확장자가 가는 「기타」는 늘 있다.</p>
      <div className={"kind-edit" + (drag?.on ? " dragging" : "")} role="list">
        {kinds.map((k, i) => (
          <div className={"kind-edit-row" + (drag?.on && drag.over === k.id && drag.from !== k.id ? " drop" : "")} role="listitem" key={k.id} data-kind-row={k.id}>
            <input type="color" className="kind-swatch" value={k.color} aria-label={`${k.label} 색`} onChange={(e) => put(i, { color: e.target.value })} />
            <input
              className="kind-name"
              data-kind-name={k.id}
              value={k.label}
              aria-label="종류 이름"
              onChange={(e) => put(i, { label: e.target.value })}
              onBlur={(e) => !e.target.value.trim() && put(i, { label: "이름 없음" })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div className="ext-chips">
              {k.exts.map((x) => {
                const lost = owner.get(x) !== k.id;
                return (
                  <span
                    key={x}
                    className={"ext-chip" + (lost ? " lost" : "") + (drag?.on && drag.ext === x && drag.from === k.id ? " lifted" : "")}
                    style={{ ["--kc" as string]: k.color }}
                    title={lost ? `${x} — 위 종류에 이미 있어 여기서는 쓰이지 않는다` : `${x} — 끌어서 다른 종류로`}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !(e.target as HTMLElement).closest("button")) setDrag({ ext: x, from: k.id, x: e.clientX, y: e.clientY, on: false, over: null });
                    }}
                  >
                    {x}
                    <button aria-label={`${x} 빼기`} onClick={() => put(i, { exts: k.exts.filter((y) => y !== x) })}>
                      ×
                    </button>
                  </span>
                );
              })}
              <input
                className="ext-add"
                spellCheck={false}
                value={adding[k.id] ?? ""}
                placeholder="+ 확장자"
                aria-label={`${k.label}에 확장자 더하기`}
                onChange={(e) => setAdding((a) => ({ ...a, [k.id]: e.target.value }))}
                onBlur={() => addExts(i, k.id)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" || e.key === " " || e.key === ",") {
                    e.preventDefault();
                    addExts(i, k.id);
                  }
                }}
              />
            </div>
            <span className="kind-edit-acts">
              <button className="icon-btn" aria-label="위로" title="위로 — 확장자가 겹치면 위 종류가 갖는다" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" aria-label="아래로" title="아래로" disabled={i === kinds.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="icon-btn" aria-label={`${k.label} 빼기`} title="종류 빼기 — 이 확장자들은 「기타」가 된다" onClick={() => set(kinds.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          </div>
        ))}
      </div>
      {drag?.on && (
        <span className="ext-ghost" style={{ left: drag.x + 10, top: drag.y + 6 }} aria-hidden="true">
          {drag.ext}
        </span>
      )}
      <div className="set-acts">
        <button className="act primary" onClick={addKind}>
          종류 더하기
        </button>
        <button className="act" onClick={() => set(DEFAULT_KINDS)} title="문서 · 표 · 발표 · PDF · 그림 · 영상 · 소리 · 압축 · 코드">
          처음대로
        </button>
      </div>
    </>
  );
}
