// 설정 — 왼쪽 아래 「설정」 · Ctrl+, · 명령 팔레트로 연다.
//
// 목차 (한 장으로 이어진다 · 왼쪽 목차는 지금 읽는 자리를 따라간다)
//   보기       크기 사다리 · 보일 열 · 표시(숨김 파일 · 상태 아이콘) · 격자 보기(미리보기 · 잘린 이름) · 사이드바 구획(SideLayout · 2026.11.24)
//   목록       기본 정렬 + 폴더를 위에 · 판 관리(2026.11.16 · 기본 끔) + 판 접어 시작 · 찾기 제외 확장자(2026.11.20) · 크기 꼴
//   열기       폴더 열기(두 번 · 한 번 누르기) · 시작 폴더
//   화면 색     시스템 · 밝게 · 어둡게 — 작은 창 그림으로 고른다
//   아이콘      Windows · filedesk · 아이콘 팩 — 같은 파일 몇 개가 셋에서 어떻게 보이는지 나란히
//   종류       목록 위 종류 · 아이콘 색의 묶음. 확장자 칩을 다른 종류로 끌어 옮긴다
//   색인       빠른 색인 서비스 설치 · 드라이브마다 상태 · 문서 본문 색인 진행 · 빼는 폴더 (IndexSettings) — 2026.11.12
//   에이전트 스킬 앱 옆 fd.exe 를 부르는 안내서를 감지한 에이전트(Claude Code · Codex …)마다 골라 쓴다 — 2026.11.13
//
//   2026.11.11 : 칸을 넘기는 대화 창(왼쪽 목차 · 오른쪽 입력 칸)을 한 장으로 바꿨다. 칸을 넘기면 다른 설정이 보이지 않아
//   「어디 있었지」를 찾아 목차를 눌러 봐야 했고, 입력 칸만으로는 바꾼 결과를 알 수 없었다. 이제 설정마다 그 결과를 그 자리에 그린다.
//   화면 색 단추를 왼쪽 아래에서 여기로 옮겼다.
//   설정은 바꾸는 즉시 목록에 쓰고 저장한다 — 「저장」 단추가 없다.
//   2026.11.12 : 가운데 모달 → 오른쪽 옆판 (styles.css 「.set-backdrop.sheet」). 바탕을 어둡게 하지 않아 바꾼 결과가 왼쪽 목록에 바로 보인다.
//   2026.11.11 : 「문서 저장소」(연도별 프로젝트) · 「이름 규칙」(판을 묶을 때 뗄 과업 이름 · 사람 이름 · 상태어)을 뺐다.
//                일반 파일 탐색기에 한 과업에만 맞는 설정이었다 — 상태어는 고정 목록, 작성자 꼬리는 이름 꼴로 추정한다 (fd-core docname).
import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, DEFAULT_VIEW, iconUrl, PALETTES, type ColKey, type Entry, type Palette, type SkillAgent, type SkillStatus, type Theme, type ViewPrefs } from "./api";
import { FileGlyph, FolderGlyph, GripGlyph } from "./glyphs";
import { moveTo, useDragSort } from "./dragSort";
import IndexSettings from "./IndexSettings";
import SideLayout from "./SideLayout";
import SizeLadder from "./SizeLadder";
import UpdateCard from "./UpdateCard";
import { useUpdateState } from "./updater";
import { DEFAULT_KINDS, errText, formatSize, KIND_PALETTE, type KindDef, parseExts, type SortKey } from "./util";

type Props = {
  current: string;
  view: ViewPrefs;
  setView: (f: (v: ViewPrefs) => ViewPrefs) => void;
  /** 크기 — 모든 칸에 한꺼번에 (나눈 칸마다 둔 크기를 지운다). */
  zoomAll: (f: (v: ViewPrefs) => ViewPrefs) => void;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
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
  { id: "index", label: "색인" },
  { id: "skill", label: "에이전트 스킬" },
  { id: "update", label: "업데이트" },
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
  const { current, view, setView, zoomAll, showHidden, setShowHidden, theme, setTheme, palette, setPalette, resetCols, start, setStart, onClose } = props;
  const body = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<SectionId>("view");
  /** 색 구성 풀이 줄이 말할 구성 — 견본에 마우스 · 초점이 올라간 것. 없으면 고른 구성. */
  const [palPeek, setPalPeek] = useState<Palette | null>(null);
  const [skill, setSkill] = useState<SkillStatus | null>(null);
  const [skillMsg, setSkillMsg] = useState("");
  const [version, setVersion] = useState("");
  const upd = useUpdateState();
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

  // 마지막 구획 밑 여백 — 끝 구획이 짧아도 그 머리가 본문 맨 위까지 올라오게.
  // 2026.11.24 : 「업데이트」가 짧아 바로 위 「에이전트 스킬」 머리가 위로 올라오기 전에 바닥에 닿았고, 바닥이면 마지막 구획을 고르는 규칙 때문에
  //   목차가 「에이전트 스킬」을 한 번도 가리키지 않았다 (사용자 지적). 목차를 눌러도 그 구획이 맨 위에 서지 못했다.
  const [tail, setTail] = useState(0);
  useEffect(() => {
    const el = body.current;
    const last = el?.querySelector<HTMLElement>(`#set-${SECTIONS[SECTIONS.length - 1].id}`);
    if (!el || !last) return;
    const ro = new ResizeObserver(() => setTail(Math.max(0, el.clientHeight - last.offsetHeight - 48)));
    ro.observe(el);
    ro.observe(last);
    return () => ro.disconnect();
  }, []);

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
  // 목차를 누르면 그 구획 머리를 맨 위에. 2026.11.24 : 구획은 보일 때 그려(content-visibility) 그 전에는 어림 높이(420px)라,
  //   부드럽게 한 번 옮기면 지나는 구획이 실제 높이로 바뀌며 엉뚱한 자리에 멈췄다 — 그린 뒤 몇 번 다시 맞춘다.
  const jump = (id: SectionId) => {
    const t = body.current?.querySelector<HTMLElement>(`#set-${id}`);
    if (!t) return;
    let n = 0;
    const step = () => {
      t.scrollIntoView({ block: "start" });
      if (++n < 5) requestAnimationFrame(step);
    };
    step();
  };

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

  const skillAct = (a: SkillAgent, remove: boolean) => {
    setSkillMsg("");
    (remove ? api.removeSkill(a.id) : api.installSkill(a.id))
      .then((s) => {
        setSkill(s);
        setSkillMsg(remove ? `${a.name}에서 제거함` : `${a.name}에 설치함 · ${a.name}을(를) 다시 시작하면 적용`);
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

  const colOn = (c: ColKey) => !view.hiddenCols.includes(c);
  const toggleCol = (c: ColKey) => setView((v) => ({ ...v, hiddenCols: v.hiddenCols.includes(c) ? v.hiddenCols.filter((x) => x !== c) : [...v.hiddenCols, c] }));
  /** 보일 에이전트 — 감지했거나 이미 깐 것. 나머지는 이름만 한 줄로. */
  const skillShown = skill?.agents.filter((a) => a.detected || a.installed) ?? [];
  const skillMissing = skill?.agents.filter((a) => !a.detected && !a.installed) ?? [];

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
    <div className="set-backdrop sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="설정">
        <nav className="set-nav" aria-label="설정 목차">
          <h2>설정</h2>
          {SECTIONS.map((s) => (
            <button key={s.id} aria-current={at === s.id ? "location" : undefined} onClick={() => jump(s.id)}>
              {s.label}
            </button>
          ))}
          {/* 판 표시 — 누르면 「업데이트」 구획. 새 판이 있으면 점과 새 판 번호 */}
          <button className={"set-ver" + (upd.update && (upd.phase === "available" || upd.phase === "downloading") ? " has-new" : "")} onClick={() => jump("update")}>
            <span>filedesk {version && `v${version}`}</span>
            {upd.update && (upd.phase === "available" || upd.phase === "downloading") && <span className="set-ver-new">새 버전 {upd.update.version}</span>}
          </button>
        </nav>
        {/* 2026.11.18 : 본문 안 → 본문 밖. 본문과 함께 흘러 첫 구획 머리에 겹쳤고 작았다 (UI 평가) */}
        <button className="set-close" aria-label="설정 닫기" title="닫기 (Esc)" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" />
          </svg>
        </button>
        <div className="set-body" ref={body}>

          <section id="set-view" aria-labelledby="h-view">
            <h3 id="h-view">보기</h3>
            <div className="set-line">
              <span className="set-label">크기</span>
              <div>
                <SizeLadder view={view} setView={zoomAll} />
                <p className="muted set-hint">모든 칸에 적용</p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">목록 열</span>
              <div>
                {/* 목록 머리 모양 그대로 — 열 이름을 눌러 켜고 끈다. 이름 열은 늘 있다 */}
                <div className="col-preview" role="group" aria-label="목록에 표시할 열">
                  <span className="col-chip fixed">이름</span>
                  {(
                    [
                      ["ver", "판"],
                      ["date", "수정일"],
                      ["kind", "종류"],
                      ["size", "크기"],
                    ] as [ColKey, string][]
                  )
                    // 판 열은 판 관리를 켰을 때만 있다
                    .filter(([c]) => c !== "ver" || view.editions)
                    .map(([c, l]) => (
                    <button key={c} className="col-chip" aria-pressed={colOn(c)} onClick={() => toggleCol(c)} title={colOn(c) ? `${l} 열 숨기기` : `${l} 열 보이기`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="muted set-hint">
                  눌러서 켜고 끄기 · 너비는 목록 머리의 경계선을 끌어 조절 ·{" "}
                  <button className="link-btn" onClick={resetCols}>
                    너비 처음대로
                  </button>
                </p>
              </div>
            </div>
            {/* 2026.11.25 : 「표시할 항목」 한 줄에 목록 전체 · 격자 전용이 섞여 있던 것을 둘로 나눴다 (UI 평가) */}
            <div className="set-line">
              <span className="set-label">표시</span>
              <div>
                {check("숨김 · 시스템 파일", showHidden, setShowHidden, "Ctrl+H")}
                {check("아이콘에 SVN · OneDrive 상태", view.overlays, (overlays) => setView((v) => ({ ...v, overlays })))}
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">격자 보기</span>
              <div>
                {check("그림 · PDF · 영상은 내용으로 미리보기", view.thumbs, (thumbs) => setView((v) => ({ ...v, thumbs })))}
                {check("잘린 이름은 올려 두면 펼쳐 보기", view.namePeek, (namePeek) => setView((v) => ({ ...v, namePeek })))}
              </div>
            </div>
            {/* 사이드바 구획 — 줄여 그린 사이드바 위에서 끌어 차례 · 스위치로 켜고 끄기. 2026.11.24 사용자 요청 */}
            <div className="set-line">
              <span className="set-label">사이드바</span>
              <div>
                <SideLayout view={view} setView={setView} />
                <p className="muted set-hint">손잡이를 끌어 순서 바꾸기 · 끈 위젯은 사이드바에서 숨김 · 사이드바에서 오른쪽 단추 › 사이드바 편집으로도 바꾼다</p>
              </div>
            </div>
          </section>

          <section id="set-list" aria-labelledby="h-list">
            <h3 id="h-list">목록</h3>
            <div className="set-line">
              <span className="set-label">정렬</span>
              <div>
                {choice<SortKey>(
                  "정렬 기준",
                  [
                    ["name", "이름"],
                    ["modified", "수정일"],
                    ["kind", "종류"],
                    ["size", "크기"],
                  ],
                  view.sort.key,
                  (key) => setView((v) => ({ ...v, sort: { key, asc: key === "name" || key === "kind" } })),
                )}
                {choice<"asc" | "desc">(
                  "정렬 방향",
                  [
                    ["asc", view.sort.key === "modified" ? "오래된 순" : view.sort.key === "size" ? "작은 순" : "가나다순"],
                    ["desc", view.sort.key === "modified" ? "최신순" : view.sort.key === "size" ? "큰 순" : "가나다 역순"],
                  ],
                  view.sort.asc ? "asc" : "desc",
                  (d) => setView((v) => ({ ...v, sort: { ...v.sort, asc: d === "asc" } })),
                )}
                {/* 2026.11.25 : 「늘어놓기」 줄을 걷었다. 뜻이 흐렸고, 폴더 먼저는 정렬의 일 · 판 접기는 판 관리의 일이다 (UI 평가) */}
                {check("폴더를 파일 위에 모으기", view.dirsFirst, (dirsFirst) => setView((v) => ({ ...v, dirsFirst })))}
                <p className="muted set-hint">모든 탭에 적용 · 목록의 열 머리나 「정렬 기준」 메뉴로 바꿔도 여기에 반영</p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">판 관리</span>
              <div>
                {check("문서의 판을 한 줄로 묶기", view.editions, (editions) => setView((v) => ({ ...v, editions })))}
                {view.editions && check("판을 접은 채 시작", view.foldStart, (foldStart) => setView((v) => ({ ...v, foldStart })), "Ctrl+Shift+D: 그 탭만 바꾸기")}
                <p className="muted set-hint">「보고서_v2_20261125.hwpx」 같은 파일을 판으로 묶음 · 켜면 판 열 · 판 목록 · 새 판 내기 · 문제 문서 처리함이 생김</p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">찾기 제외</span>
              <div>
                <SkipExts exts={view.findSkip} set={(findSkip) => setView((v) => ({ ...v, findSkip }))} />
                <p className="muted set-hint">
                  하위 폴더 · 모든 드라이브 · 스마트 폴더 결과에서 제외
                  {view.findSkip.join(" ") !== DEFAULT_VIEW.findSkip.join(" ") && " · "}
                  {view.findSkip.join(" ") !== DEFAULT_VIEW.findSkip.join(" ") && (
                    <button className="link-btn" onClick={() => setView((v) => ({ ...v, findSkip: DEFAULT_VIEW.findSkip }))}>
                      처음대로
                    </button>
                  )}
                </p>
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">크기 표기</span>
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
                {check("폴더 용량 표시", view.folderSize, (folderSize) => setView((v) => ({ ...v, folderSize })))}
                <p className="muted set-hint">하위 폴더까지 더한 용량 · 큰 폴더와 NAS 는 늦게 나옴</p>
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
                    ["double", "두 번 눌러 열기", "탐색기와 같음"],
                    ["single", "한 번 눌러 열기", "폴더는 한 번 · 파일은 두 번"],
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
                  "시작할 때",
                  [
                    ["last", "지난 탭 그대로", "지난번 탭과 나눠 보기를 다시 엶"],
                    ["folder", "정한 폴더", start || "지금 폴더"],
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
            {/* 2026.11.26 : 밝기와 색 구성을 두 줄로 나눴다 — 한 구획에 견본 줄이 둘 서면 무엇을 고르는 줄인지 갈리지 않았다 */}
            <div className="set-line">
              <span className="set-label">밝기</span>
              <div className="theme-pick" role="radiogroup" aria-label="밝기">
                {(
                  [
                    ["system", "시스템", "Windows 설정 따름"],
                    ["light", "밝게", ""],
                    ["dark", "어둡게", ""],
                  ] as [Theme, string, string][]
                ).map(([t, l, hint]) => (
                  // 2026.11.25 : 「밝게」 위에 같은 말 「밝게」가 뜨던 풍선을 걷었다. 풀이가 필요한 「시스템」만 둔다
                  <button key={t} role="radio" aria-checked={theme === t} className={"theme-card" + (theme === t ? " on" : "")} onClick={() => setTheme(t)} title={hint || undefined}>
                    <MiniWindow theme={t} />
                    <span>{l}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="set-line">
              <span className="set-label">색 구성</span>
              {/* 2026.11.26 : 색 구성. 견본마다 data-palette 를 달아 그 구성의 값으로 그린다 — 지금 고른 밝게 · 어둡게를 따라 견본도 바뀐다 */}
              {/* 2026.11.26 : 열한 개가 한 줄에 서면 무엇이 다른지 갈리지 않아 두 묶음으로 나눴다. 아래 풀이 줄은 올린(없으면 고른) 구성을 말한다 */}
              <div className="palette-pick" role="radiogroup" aria-label="색 구성" onMouseLeave={() => setPalPeek(null)}>
                {(
                  [
                    ["accent", "강조색"],
                    ["base", "바탕까지"],
                  ] as const
                ).map(([g, gl]) => (
                  <div key={g} className="palette-group">
                    <span className="palette-group-label">{gl}</span>
                    <div className="palette-row">
                      {PALETTES.filter((p) => p.group === g).map((p) => (
                        <button key={p.id} role="radio" aria-checked={palette === p.id} aria-description={p.hint} className={"palette-card" + (palette === p.id ? " on" : "")} onClick={() => setPalette(p.id)} onMouseEnter={() => setPalPeek(p.id)} onFocus={() => setPalPeek(p.id)} onBlur={() => setPalPeek(null)}>
                          <span className="palette-swatch" data-palette={p.id} aria-hidden="true">
                            <i className="ps-side" />
                            <i className="ps-paper">
                              <i className="ps-row" />
                              <i className="ps-row sel" />
                              <i className="ps-row" />
                              <i className="ps-dot" />
                            </i>
                          </span>
                          <span>{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="set-hint muted">
                  {(() => {
                    const p = PALETTES.find((x) => x.id === (palPeek ?? palette));
                    return p ? `${p.label} : ${p.hint}` : "";
                  })()}
                </p>
              </div>
            </div>
          </section>

          <section id="set-icons" aria-labelledby="h-icons">
            <h3 id="h-icons">아이콘</h3>
            <div className="icon-pick" role="radiogroup" aria-label="아이콘">
              {(
                [
                  ["shell", "Windows", "탐색기와 같음"],
                  ["filedesk", "filedesk", "형식별 고정 그림"],
                  ["pack", "아이콘 팩", "고른 폴더의 그림 (없으면 filedesk)"],
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
                  {view.iconPack || <span className="muted">아직 폴더를 정하지 않음</span>}
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
                  폴더에 그림(svg · png · ico · webp)을 두고 이름을 확장자(<code>pdf.svg</code>) · 종류(<code>doc.png</code>) · <code>folder</code> · <code>file</code> 로 짓기.
                  찾는 순서: 확장자 → 종류 → file.
                  {packMap && ` 찾은 그림 ${Object.keys(packMap).length}개${Object.keys(packMap).length ? `: ${Object.keys(packMap).sort().slice(0, 12).join(" · ")}${Object.keys(packMap).length > 12 ? " …" : ""}` : ""}`}
                </p>
              </div>
            )}
          </section>

          <section id="set-kinds" aria-labelledby="h-kinds">
            <h3 id="h-kinds">종류</h3>
            {/* 2026.11.25 : 구획이 조작 안내로 바로 시작해 「종류」가 무엇을 정하는지 없었다 (UI 평가) */}
            <p className="set-note">목록의 「종류」 열과 아이콘 색을 정하는 확장자 묶음.</p>
            <KindsEditor kinds={view.kinds} set={(kinds) => setView((v) => ({ ...v, kinds }))} />
          </section>

          <section id="set-index" aria-labelledby="h-index">
            <h3 id="h-index">색인</h3>
            <IndexSettings current={current} />
          </section>

          <section id="set-skill" aria-labelledby="h-skill">
            <h3 id="h-skill">에이전트 스킬</h3>
            <p className="set-note">
              Claude Code · Codex 같은 코딩 에이전트가 filedesk 명령줄(fd.exe)로 파일을 찾고 정리하게 하는 안내서.
            </p>
            <p className="muted set-note">
              설치하면 에이전트가 드라이브를 훑지 않고 색인으로 파일과 문서 본문을 찾음. 판 정리 · 메모 · 색 표시는 앱과 같은 규칙을 따르고, 파일을 바꾸기 전에 계획을 먼저 보이며, 지우기는 휴지통으로만.
            </p>
            {skill == null ? (
              <p className="set-path">확인 중…</p>
            ) : skillShown.length > 0 ? (
              <table className="index-table">
                <thead>
                  <tr>
                    <th>에이전트</th>
                    <th>상태</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {skillShown.map((a) => {
                    const old = a.installed && a.installed !== skill.current;
                    return (
                      <tr key={a.id} title={a.file}>
                        <td>{a.name}</td>
                        <td>
                          {a.installed ? (old ? `이전 버전 ${a.installed} · 다시 설치 필요` : `설치됨 · ${a.installed}`) : "설치 안 됨"}
                          {!a.detected && <span className="muted"> · 이 PC 에 없음</span>}
                        </td>
                        <td>
                          <span className="set-acts">
                            <button className={"act" + (a.installed && old ? " primary" : "")} disabled={!skill.hasCli} onClick={() => skillAct(a, false)}>
                              {a.installed ? "다시 설치" : "설치"}
                            </button>
                            {a.installed && (
                              <button className="act" onClick={() => skillAct(a, true)}>
                                제거
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="set-path">감지한 에이전트 없음</p>
            )}
            {skill && !skill.hasCli && <p className="muted set-note">설치 파일로 설치한 앱에서만 설치 가능 (fd.exe 가 앱 옆에 있어야 함)</p>}
            {skillMsg && <p className="set-note">{skillMsg}</p>}
            {skillMissing.length > 0 && <p className="muted set-note">이 PC 에 없는 에이전트: {skillMissing.map((a) => a.name).join(" · ")}</p>}
            <p className="muted set-note">설치한 스킬은 앱을 켤 때마다 이 버전에 맞춰 자동으로 갱신.</p>
            <p className="muted set-note">
              목록에 없는 에이전트: 명령줄 <code>fd skill install --dir &lt;스킬 폴더&gt;</code> 로 설치하거나, <code>fd skill show</code> 본문을 그 에이전트의 지침 파일에 붙여 넣기.
            </p>
          </section>

          {/* 2026.11.13 : 확인만 하던 설정에서 바로 설치까지 — 제목 줄 알림과 같은 업데이트 카드 */}
          <section id="set-update" aria-labelledby="h-update">
            <h3 id="h-update">업데이트</h3>
            <UpdateCard version={version} />
          </section>
          <div aria-hidden="true" style={{ height: tail }} />
        </div>
      </div>
    </div>
  );
}

/** 표본 확장자의 기본 종류 id — 아이콘 팩 견본이 「종류 이름 그림」을 찾을 때. */
const kindIdOf = (ext: string) => DEFAULT_KINDS.find((k) => k.exts.includes(ext))?.id;

/** 작은 창 그림 — 화면 색 고르기. 시스템은 왼쪽 밝게 · 오른쪽 어둡게 반반.
 *  2026.11.26 : 고정 색(옛 아이보리 계열)을 걷고 styles.css 토큰으로 그린다. 그림마다 color-scheme 을 걸어 light-dark() 를
 *  그 밝기 쪽 값으로 풀게 한다 — 그래서 고른 색 구성(바탕 빛깔 · 강조색)이 견본에도 그대로 보인다. */
function MiniWindow({ theme }: { theme: Theme }) {
  const fill = (v: string) => ({ fill: `var(--${v})` });
  const win = (scheme: "light" | "dark") => (
    <g style={{ colorScheme: scheme }}>
      <rect width="76" height="48" style={fill("paper")} />
      <rect width="18" height="48" style={fill("side")} />
      <rect x="22" y="4" width="24" height="3" rx="1.5" style={fill("ink")} />
      {[12, 19, 26, 33].map((y) => (
        <rect key={y} x="22" y={y} width="48" height="4" rx="1.5" style={fill(y === 19 ? "sel" : "hover")} />
      ))}
      <circle cx="68" cy="42" r="3" style={fill("accent")} />
    </g>
  );
  return (
    <svg width="76" height="48" viewBox="0 0 76 48" aria-hidden="true" className="mini-window">
      <defs>
        <clipPath id={`mw-${theme}`}>
          <rect width="76" height="48" rx="5" />
        </clipPath>
        <clipPath id="mw-right">
          <rect x="38" width="38" height="48" />
        </clipPath>
      </defs>
      <g clipPath={`url(#mw-${theme})`}>
        {win(theme === "dark" ? "dark" : "light")}
        {theme === "system" && <g clipPath="url(#mw-right)">{win("dark")}</g>}
      </g>
    </svg>
  );
}

/** 찾기에서 제외할 확장자 — 종류 편집과 같은 칩. 칸에 적고 Enter · 빈칸 · 쉼표로 더한다 (.lnk · *.lnk 도 받는다). 2026.11.20 더했다. */
function SkipExts({ exts, set }: { exts: string[]; set: (x: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const more = parseExts(text);
    if (more.length) set(parseExts([...exts, ...more].join(" ")));
    setText("");
  };
  return (
    <div className="ext-chips" role="list" aria-label="찾기에서 제외할 확장자">
      {exts.map((x) => (
        <span key={x} className="ext-chip plain" role="listitem">
          {x}
          <button aria-label={`${x} 제거`} onClick={() => set(exts.filter((y) => y !== x))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="ext-add"
        spellCheck={false}
        value={text}
        placeholder="+ 확장자"
        aria-label="찾기에서 제외할 확장자 추가"
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === " " || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}

/** 종류 편집 — 한 줄에 종류 하나: 손잡이 · 색 · 이름 · 확장자 칩 · 빼기. 바꾸는 즉시 목록에 쓴다.
 *  확장자는 칩 하나가 하나 — 칩을 다른 종류 줄로 끌어 옮기고, × 로 빼고, 줄 끝 칸에 적어 더한다 (빈칸 · 쉼표로 여럿).
 *  2026.11.11 : 한 줄 글 칸이던 것을 칩으로. 글 칸에서는 「pptx 를 발표에서 문서로」가 두 칸을 고치는 일이었다.
 *  끌기는 마우스 움직임으로 짠다 — Tauri 가 창 밖 파일 끌기를 받으려고 웹 끌기(HTML5 DnD)를 막아 두었다. */
function KindsEditor({ kinds, set }: { kinds: KindDef[]; set: (k: KindDef[]) => void }) {
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ ext: string; from: string; x: number; y: number; on: boolean; over: string | null } | null>(null);
  const owner = new Map<string, string>();
  for (const k of kinds) for (const x of k.exts) if (!owner.has(x)) owner.set(x, k.id);
  const put = (i: number, patch: Partial<KindDef>) => set(kinds.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  // 줄 차례 — 손잡이를 끌어 옮긴다 (겹치는 확장자는 위 종류가 가진다). 2026.11.24 : ↑ ↓ 단추를 걷었다
  const sort = useDragSort<HTMLDivElement>(kinds.length, (from, to) => set(moveTo(kinds, from, to)));
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
      <p className="muted set-note">손잡이를 끌어 순서 바꾸기 (확장자가 겹치면 위 종류 우선) · 확장자 칩을 끌어 다른 종류로 옮기기</p>
      <div className={"kind-edit" + (drag?.on || sort.dragging ? " sorting" : "")} role="list" ref={sort.list}>
        {kinds.map((k, i) => (
          <div className={"kind-edit-row" + (drag?.on && drag.over === k.id && drag.from !== k.id ? " drop" : "")} role="listitem" key={k.id} data-kind-row={k.id} {...sort.item(i)}>
            <button className="grip" {...sort.handle(i, k.label)}>
              <GripGlyph />
            </button>
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
                    title={lost ? `${x}: 위 종류와 겹쳐 쓰이지 않음` : x}
                    onMouseDown={(e) => {
                      if (e.button === 0 && !(e.target as HTMLElement).closest("button")) setDrag({ ext: x, from: k.id, x: e.clientX, y: e.clientY, on: false, over: null });
                    }}
                  >
                    {x}
                    <button aria-label={`${x} 제거`} onClick={() => put(i, { exts: k.exts.filter((y) => y !== x) })}>
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
                aria-label={`${k.label}에 확장자 추가`}
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
              <button className="icon-btn" aria-label={`${k.label} 삭제`} title="종류 삭제 (확장자는 「기타」로)" onClick={() => set(kinds.filter((_, j) => j !== i))}>
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
          종류 추가
        </button>
        <button className="act" onClick={() => set(DEFAULT_KINDS)} title="문서 · 표 · 발표 · PDF · 그림 · 영상 · 소리 · 압축 · 코드">
          처음대로
        </button>
      </div>
    </>
  );
}
