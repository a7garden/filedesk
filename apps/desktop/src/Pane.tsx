// 탭 하나의 화면 — 자리 머리 · 종류 거르기 · 판 접힌 목록 · 알림 줄. 나눠 보기면 칸 하나.
//
// 목차
//   [1] 읽기 — 목록 + 문서 묶음을 함께 읽어 「판 접힌 줄」을 만든다 · 폴더 변경 알림
//       2026.11.11 : 목록을 먼저 그리고 문서 묶음은 뒤에 얹는다 (묶기가 0.12초 안에 끝나면 한 번에). 큰 폴더에서 첫 줄이 묶기를 기다렸다
//   [1-1] 찾기 — 「거르기」는 이 폴더(이름 · 메모 글), Shift+Enter 는 아래 폴더까지 (fd-core search). 종류 · 색으로도 거른다
//   [2] 줄 만들기 — 문서 하나 = 한 줄(최신판), 펼치면 그 자리에 판들 · 새 판 줄
//       판 규칙이 어긋난 문서는 접혀 있어도 바로 밑에 「문제 줄」(무엇이 어긋났나 + 고칠 동작). 머리의 「문제 N문서」가 그것만 거른다
//       2026.11.11 : 따로 있던 「점검」 보기를 지우고 목록에 겹쳤다 — 같은 폴더를 다른 표로 두 번 그렸고, 목록과 견줄 수 없었다
//   [3] 고르기 (클릭 · Ctrl · Shift · 키보드)
//   [4] 동작 (열기 · 이름 바꾸기 · 휴지통 · 복사/잘라내기/붙여넣기 · 새 폴더 · 오른쪽 메뉴 · 새 판 · 메모 · 색 표시 · 즐겨찾기)
//       색 표시는 Finder 꼬리표처럼 일곱 색 하나 — 이름 곁 점, 줄에 올리면 나오는 「색」 단추나 Alt+1~7 (Alt+0 지우기)
//       메모는 이름 바로 곁에 흐린 글로 — 누르면 그 자리에서 고친다 (Ctrl+M). 데이터는 filedesk 가 따로 둔다 (파일에 쓰지 않는다)
//       받은 것 · 보관 · 지난 판 자리는 지우기 · 이름 바꾸기 전에 알림 줄에서 한 번 묻는다
//   [5] 끌기 (앱 밖으로)
//   [6] 단축키 — 탐색기와 같게 (손에 익은 동작은 바꾸지 않는다)
//   [7] 그리기 — 목록(열 너비 · 보일 열은 열 머리에서) 또는 격자(GridView). 메모는 길면 올려 둘 때 카드로, 고칠 때는 떠 있는 칸에서
//       2026.11.11 : 격자 보기 · 크기(Ctrl+휠) · filedesk 아이콘 · 오른쪽 메뉴에 filedesk 항목(메모 · 색 · 즐겨찾기 · 옆 칸 · 새 판)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, iconUrl, TAG_COLORS, TAG_LABEL, today, type ColKey, type DocFile, type DocGroup, type EditionPlan, type Entry, type Found, type MenuItem, type Role, type TagColor, type ViewPrefs } from "./api";
import AddressBar, { type AddressHandle } from "./AddressBar";
import type { Tab } from "./App";
import EditionTicks, { editionCount, editionTime } from "./EditionTicks";
import { Chevron, FileGlyph, FolderGlyph } from "./glyphs";
import GridView, { TILE } from "./GridView";
import { SIZE_LABEL } from "./SettingsPanel";
import TagMenu, { TagDot } from "./TagMenu";
import {
  baseName,
  DEFAULT_COLS,
  errText,
  formatBytes,
  formatDate,
  formatSize,
  canThumb,
  kindLabel,
  kindOf,
  kindOrder,
  norm,
  parentOf,
  PROTECTED_ROLES,
  relDate,
  ROLE_LABEL,
  samePath,
  sortEntries,
  splitName,
  type Sort,
  type SortKey,
} from "./util";

type Props = {
  tab: Tab;
  /** 보이는가 — 왼쪽 · 오른쪽 칸에 놓인 탭. */
  visible: boolean;
  /** 나눠 보기에서 놓인 칸. 안 나눴으면 null. */
  side: 0 | 1 | null;
  /** 키보드를 받는 칸의 탭인가. */
  active: boolean;
  onFocusPane: () => void;
  showHidden: boolean;
  cols: number[];
  setCols: (cols: number[]) => void;
  onPin: (items: { path: string; isDir: boolean }[]) => void;
  view: ViewPrefs;
  setView: (f: (v: ViewPrefs) => ViewPrefs) => void;
  /** 나눠 보는 중인가 — 오른쪽 메뉴 글이 「옆 칸에서 열기」 / 「나눠서 옆에 열기」로 갈린다. */
  split: boolean;
  onOpenBeside: (path: string) => void;
  onToggleSplit: () => void;
  notice: { text: string; tone: "ok" | "warn" } | null;
  clearNotice: () => void;
  onGo: (path: string) => void;
  onBack: () => void;
  onFwd: () => void;
  onOpenTab: (path: string) => void;
};

/** 목록 한 줄. 판 줄(depth 1)은 펼친 문서 아래에 붙는다. 「새 판」 줄은 펼친 문서의 맨 아래. 「문제」 줄은 판 규칙이 어긋난 문서 바로 밑. */
type EntryRow = { kind: "entry"; e: Entry; depth: 0 | 1; group?: DocGroup; hiddenCount?: number; where?: string };
type EditionRow = { kind: "edition"; group: DocGroup; source: Entry };
type IssueRow = { kind: "issue"; group: DocGroup; stack: boolean };
type Row = EntryRow | EditionRow | IssueRow;

/** 줄 아래 계획 — 새 판 내기, 또는 지난 판을 이전판으로. 여러 파일을 옮기는 일이라 먼저 보여 주고 확인을 받는다. */
type Plan = { key: string; kind: "edition"; plan: EditionPlan } | { key: string; kind: "retire"; files: string[] };

type Msg = { text: string; tone?: "warn" | "ok"; actions?: { label: string; run: () => void; primary?: boolean }[] };

const ROW_H = 30;
const DRAG_PX = 5;

const joinPath = (dir: string, name: string) => (dir.endsWith("\\") ? dir + name : `${dir}\\${name}`);
const verLabel = (v: number[]) => (v.length ? `v${v.join(".")}` : "");
const edKey = (f: DocFile) => `${f.parsed.version.join(".")}|${f.parsed.date}|${f.parsed.time}`;

/** 최신판 자리에 남은 지난 판 수 — fd-core `stale_in_place` 와 같은 셈. 단추 글자용이고, 옮길 목록은 백엔드가 다시 센다. */
function staleCount(g: DocGroup): number {
  const latest = g.files[0];
  if (!latest || latest.inHistory) return 0;
  const dir = parentOf(latest.path) ?? "";
  return g.files.filter((f) => !f.inHistory && samePath(parentOf(f.path) ?? "", dir) && edKey(f) !== edKey(latest)).length;
}

export default function Pane(p: Props) {
  const path = p.tab.path;
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [groups, setGroups] = useState<DocGroup[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", asc: true });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** 경로(norm) → 메모 글. */
  const [memos, setMemos] = useState<Map<string, string>>(new Map());
  /** 메모를 고치는 중인 항목과 떠 있는 칸의 자리. */
  const [memoing, setMemoingState] = useState<string | null>(null);
  const [memoAt, setMemoAt] = useState<{ x: number; y: number; w: number } | null>(null);
  /** 긴 메모 카드 — 메모에 마우스를 올려 두면 뜬다. */
  const [memoCard, setMemoCard] = useState<{ text: string; x: number; y: number } | null>(null);
  const memoTimer = useRef(0);
  /** 열 머리 오른쪽 단추 메뉴. */
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  /** 격자 한 줄의 칸 수 — 위 · 아래 화살표가 이만큼 움직인다. */
  const gridCols = useRef(1);
  const isGrid = p.view.mode === "grid";
  const [msg, setMsg] = useState<Msg | null>(null);
  /** 판을 접어 보는가 (기본). 끄면 파일을 다 보인다 — Ctrl+Shift+D. */
  const [fold, setFold] = useState(true);
  /** 문제 있는 문서만 보기 (머리의 「문제 N문서」). */
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  /** 경로(norm) → 색 표시. */
  const [colors, setColors] = useState<Map<string, TagColor>>(new Map());
  /** 색 고르기 창 — 줄의 「색」 단추나 Alt 없이 연 경우. */
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number; paths: string[] } | null>(null);
  /** 종류 · 색 거르기. */
  const [kind, setKind] = useState<string | null>(null);
  const [colorOnly, setColorOnly] = useState<TagColor | null>(null);
  /** 아래 폴더까지 찾기. 켜져 있으면 목록 대신 찾은 것을 보인다. */
  const [deep, setDeep] = useState<{ q: string; items: Found[] | null; truncated: boolean; scanned: number } | null>(null);
  /** 방금 펼친 문서 — 그 판 줄만 나타나는 움직임을 준다 (스크롤로 다시 그려지는 줄은 움직이지 않게). */
  const [justOpened, setJustOpened] = useState<{ key: string; at: number } | null>(null);
  /** 읽기 차례 — 늦게 온 앞선 읽기가 새 폴더 목록을 덮지 않게. */
  const loadSeq = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<AddressHandle>(null);
  const pendingFocus = useRef<{ path: string; rename?: boolean } | null>(null);
  const prevPath = useRef<string | null>(null);

  const say = useCallback((text: string, tone?: Msg["tone"]) => setMsg({ text, tone }), []);

  /** 메모 칸을 연다 — 그 줄(격자면 칸)의 이름 자리 아래에 뜬다. 닫으려면 null. */
  const setMemoing = useCallback((fp: string | null) => {
    setMemoCard(null);
    if (fp == null) {
      setMemoingState(null);
      setMemoAt(null);
      return;
    }
    const el = sectionRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(fp)}"]`);
    const anchor = el?.querySelector<HTMLElement>(".cell.name, .tile-name") ?? el;
    const r = anchor?.getBoundingClientRect();
    setMemoAt(r ? { x: r.left, y: r.bottom + 2, w: Math.max(260, Math.min(420, r.width)) } : { x: 240, y: 160, w: 360 });
    setMemoingState(fp);
  }, []);

  /** 메모에 마우스를 올려 두면 — 잘렸거나 여러 줄이면 카드로 다 보인다. */
  const memoHover = (ev: React.MouseEvent<HTMLElement>, text: string) => {
    const el = ev.currentTarget;
    window.clearTimeout(memoTimer.current);
    memoTimer.current = window.setTimeout(() => {
      if (el.scrollWidth <= el.clientWidth + 1 && !text.includes("\n")) return;
      const r = el.getBoundingClientRect();
      setMemoCard({ text, x: Math.min(r.left, window.innerWidth - 380), y: r.bottom + 6 });
    }, 350);
  };
  const memoLeave = () => {
    window.clearTimeout(memoTimer.current);
    setMemoCard(null);
  };
  const report = useCallback((e: unknown) => setMsg({ text: errText(e), tone: "warn" }), []);

  // 알림은 할 일(단추)이 없으면 잠시 뒤 사라진다.
  useEffect(() => {
    if (!msg || msg.actions?.length) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);
  useEffect(() => {
    if (p.notice) {
      setMsg({ text: p.notice.text, tone: p.notice.tone });
      p.clearNotice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.notice]);

  // ───────── [1] 읽기 ─────────

  const applyNotes = useCallback((notes: { path: string; text: string; color?: TagColor }[]) => {
    setMemos(new Map(notes.filter((m) => m.text).map((m) => [norm(m.path), m.text])));
    setColors(new Map(notes.filter((m) => m.color).map((m) => [norm(m.path), m.color as TagColor])));
  }, []);

  const load = useCallback(
    async (keepSel: boolean) => {
      const seq = ++loadSeq.current;
      try {
        const listP = api.listDir(path, p.showHidden);
        const restP = Promise.all([api.docGroups(path).catch(() => [] as DocGroup[]), api.memosIn(path).catch(() => [])]);
        const list = await listP;
        if (seq !== loadSeq.current) return;
        // 묶음이 곧 오면 한 번에 그린다 — 따로 그리면 줄이 한 번 접히며 움직인다. 늦으면 목록부터 (큰 폴더).
        const quick = await Promise.race([restP, new Promise<null>((r) => window.setTimeout(() => r(null), 120))]);
        if (seq !== loadSeq.current) return;
        setEntries(list);
        if (quick) {
          setGroups(quick[0]);
          applyNotes(quick[1]);
        } else
          restP.then(([docs, notes]) => {
            if (seq !== loadSeq.current) return;
            setGroups(docs);
            applyNotes(notes);
          });
        setError("");
        const pf = pendingFocus.current;
        const hit = pf && list.find((e) => samePath(e.path, pf.path));
        if (hit) {
          pendingFocus.current = null;
          setSel(new Set([hit.path]));
          setFocus(hit.path);
          setAnchor(hit.path);
          if (pf.rename) setRenaming(hit.path);
        } else if (keepSel) {
          const have = new Set(list.map((e) => e.path));
          setSel((s) => new Set([...s].filter((x) => have.has(x))));
        }
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setEntries([]);
        setGroups([]);
        setError(errText(e));
      }
    },
    [path, p.showHidden, applyNotes],
  );

  useEffect(() => {
    const prev = prevPath.current;
    prevPath.current = path;
    const up = prev ? parentOf(prev) : null;
    if (prev && up && samePath(up, path)) pendingFocus.current = { path: prev };
    setSel(new Set());
    setFocus(null);
    setAnchor(null);
    setRenaming(null);
    setMemoing(null);
    setMsg(null);
    setFilter("");
    setDeep(null);
    setKind(null);
    setColorOnly(null);
    setOnlyIssues(false);
    setOpen(new Set());
    setPlan(null);
    setEntries(null);
    setRole(null);
    scrollRef.current?.scrollTo(0, 0);
    api.roleOf(path).then(setRole).catch(() => setRole(null));
    load(false);
  }, [path, load]);

  useEffect(() => {
    let timer = 0;
    const on = (e: Event) => {
      const changed = (e as CustomEvent<string>).detail;
      // 이 폴더 · 그 이전판이 바뀌면 다시 읽는다 (판 수가 바뀐다).
      if (!samePath(changed, path) && !samePath(parentOf(changed) ?? "", path)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(true), 150);
    };
    // 이름 규칙이 바뀌면 다시 묶는다 · 왼쪽 목록에서 색을 바꾸면 색만 다시 읽는다.
    const rules = () => load(true);
    const recolor = () => api.memosIn(path).then(applyNotes).catch(() => {});
    window.addEventListener("fd:changed", on);
    window.addEventListener("fd:rules", rules);
    window.addEventListener("fd:colors", recolor);
    return () => {
      window.removeEventListener("fd:changed", on);
      window.removeEventListener("fd:rules", rules);
      window.removeEventListener("fd:colors", recolor);
      window.clearTimeout(timer);
    };
  }, [path, load, applyNotes]);

  // ───────── [1-1] 찾기 ─────────

  /** 아래 폴더까지 찾기. 글자를 고치면 잠깐 기다렸다 다시 찾는다 (앞선 찾기는 Rust 쪽에서 멈춘다). */
  const deepQ = deep?.q;
  useEffect(() => {
    if (deepQ == null) return;
    const q = filter.trim();
    if (!q) return setDeep(null);
    const t = window.setTimeout(() => {
      setDeep((d) => (d ? { ...d, q, items: d.q === q ? d.items : null } : d));
      api
        .searchDir(path, q, p.showHidden)
        .then((r) => !r.cancelled && setDeep((d) => (d && d.q === q ? { q, items: r.items, truncated: r.truncated, scanned: r.scanned } : d)))
        .catch(report);
    }, deepQ === q ? 0 : 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepQ != null, filter, path, p.showHidden]);

  const startDeep = () => {
    const q = filter.trim();
    if (q) setDeep({ q, items: null, truncated: false, scanned: 0 });
  };

  /** 찾은 것의 메모 — 이 폴더 밖이라 목록 메모(memos)에 없다. */
  const deepMemos = useMemo(() => new Map((deep?.items ?? []).filter((f) => f.memo).map((f) => [norm(f.path), f.memo as string])), [deep]);
  const memoOf = (fp: string) => memos.get(norm(fp)) ?? deepMemos.get(norm(fp));

  // ───────── [2] 줄 만들기 ─────────

  /** 파일 경로 → 그 파일의 문서 묶음. */
  const groupOf = useMemo(() => {
    const m = new Map<string, DocGroup>();
    for (const g of groups) for (const f of g.files) m.set(norm(f.path), g);
    return m;
  }, [groups]);

  /** 문제 있는 문서마다 이 자리의 최신판 경로 — 문제 줄을 붙일 자리. 머리의 「문제 N문서」도 이것으로 센다. */
  const issueLead = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) {
      if (!g.issues.length) continue;
      const here = g.files.find((f) => !f.inHistory && samePath(parentOf(f.path) ?? "", path));
      if (here) s.add(norm(here.path));
    }
    return s;
  }, [groups, path]);

  /** 판 눈금의 공통 날짜 축 — 이 폴더 문서의 가장 이른 판부터 오늘까지. 문서끼리 언제 고쳤는지를 견줄 수 있게. */
  const span = useMemo(() => {
    const now = Date.now();
    let lo = now;
    for (const g of groups) if (g.files.length > 1) for (const f of g.files) lo = Math.min(lo, editionTime(f));
    return { lo, hi: now };
  }, [groups]);

  /** 종류 · 색 거르기에 쓸 개수 — 지금 보이는 바탕(폴더 목록이나 찾은 것) 기준. */
  const base: Entry[] = deep ? (deep.items ?? []) : (entries ?? []);
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of base) m.set(kindOf(e), (m.get(kindOf(e)) ?? 0) + 1);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 종류 설정이 바뀌면 kindOf 가 다른 답을 낸다
  }, [base, p.view.kinds]);
  const colorCounts = useMemo(() => {
    const m = new Map<TagColor, number>();
    for (const e of base) {
      const c = colors.get(norm(e.path));
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [base, colors]);
  const passes = useCallback(
    (e: Entry) => (!kind || kindOf(e) === kind) && (!colorOnly || colors.get(norm(e.path)) === colorOnly),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 종류 설정이 바뀌면 kindOf 가 다른 답을 낸다
    [kind, colorOnly, colors, p.view.kinds],
  );

  const rows = useMemo<Row[]>(() => {
    if (deep) {
      // 찾은 것 — 판으로 접지 않고, 어느 폴더에 있는지를 곁에 적는다.
      const rel = (fp: string) => {
        const dir = parentOf(fp) ?? "";
        return samePath(dir, path) ? "" : dir.slice(path.replace(/\\$/, "").length + 1);
      };
      return sortEntries((deep.items ?? []).filter(passes), sort).map((e): Row => ({ kind: "entry", e, depth: 0, where: rel(e.path) || undefined }));
    }
    const all = (entries ?? []).filter(passes);
    const q = filter.trim().toLowerCase();
    // 판이 둘 이상인 문서는 이 폴더에 있는 최신판 하나만 남기고 나머지(같은 판 pdf · 지난 판)는 접는다.
    const hidden = new Set<string>();
    const repOf = new Map<string, { group: DocGroup; count: number }>();
    if (fold) {
      for (const g of groups) {
        if (g.files.length < 2) continue;
        const here = g.files.filter((f) => !f.inHistory && samePath(parentOf(f.path) ?? "", path));
        if (here.length === 0) continue;
        repOf.set(norm(here[0].path), { group: g, count: here.length - 1 });
        for (const f of here.slice(1)) hidden.add(norm(f.path));
      }
    }
    const visible = all.filter((e) => !hidden.has(norm(e.path)));
    // 이름 · 문서 제목 · 메모 글 어디에든 있으면 맞다 — 메모로 찾는 일이 이름으로 찾는 일만큼 잦다.
    const terms = q.split(/\s+/).filter(Boolean);
    const has = (e: Entry) => {
      const hay = `${e.name} ${groupOf.get(norm(e.path))?.title ?? ""} ${memos.get(norm(e.path)) ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    };
    const byName = q ? visible.filter(has) : visible;
    const matched = onlyIssues ? byName.filter((e) => (groupOf.get(norm(e.path))?.issues.length ?? 0) > 0) : byName;
    const out: Row[] = [];
    for (const e of sortEntries(matched, sort)) {
      const rep = repOf.get(norm(e.path));
      const g = rep?.group ?? groupOf.get(norm(e.path));
      out.push({ kind: "entry", e, depth: 0, group: g, hiddenCount: rep?.count });
      // 문제 줄은 문서의 맨 앞 줄(이 자리의 최신판) 밑에 한 번만 — 판을 다 펼친 목록(Ctrl+Shift+D)에서도 같다.
      if (g && g.issues.length > 0 && issueLead.has(norm(e.path))) out.push({ kind: "issue", group: g, stack: !!rep });
      if (rep && open.has(rep.group.key)) {
        for (const f of rep.group.files) {
          if (samePath(f.path, e.path)) continue;
          out.push({
            kind: "entry",
            depth: 1,
            group: rep.group,
            where: f.inHistory ? "이전판" : "같은 자리",
            e: { name: f.name, path: f.path, isDir: false, size: f.size, modified: f.modified, attrs: 0, ext: f.parsed.ext, kind: "" },
          });
        }
        out.push({ kind: "edition", group: rep.group, source: e });
      }
    }
    return out;
  }, [entries, groups, groupOf, issueLead, fold, filter, onlyIssues, sort, open, path, deep, passes, memos]);

  /** 고르기 · 키보드가 다니는 줄 (새 판 줄은 건너뛴다). */
  const nav = useMemo(() => rows.filter((r): r is EntryRow => r.kind === "entry"), [rows]);
  const navIndex = useMemo(() => new Map(nav.map((r, i) => [r.e.path, i])), [nav]);
  const rowIndex = useMemo(
    () => new Map(rows.map((r, i) => [r.kind === "entry" ? r.e.path : `${r.kind === "issue" ? "!" : "#"}${r.group.key}`, i])),
    [rows],
  );

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
  });

  useEffect(() => {
    if (focus == null || isGrid) return;
    const i = rowIndex.get(focus);
    if (i != null) virt.scrollToIndex(i, { align: "auto" });
  }, [focus, rowIndex, virt, isGrid]);

  const toggleOpen = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else {
        n.add(key);
        setJustOpened({ key, at: Date.now() });
      }
      return n;
    });

  // ───────── [3] 고르기 ─────────

  const selectedEntries = useMemo(() => nav.filter((r) => sel.has(r.e.path)).map((r) => r.e), [nav, sel]);
  const selectedPaths = useCallback(() => selectedEntries.map((e) => e.path), [selectedEntries]);

  const selectOnly = (fp: string) => {
    setSel(new Set([fp]));
    setFocus(fp);
    setAnchor(fp);
  };

  const selectRange = (from: string, to: string, add: boolean) => {
    const a = navIndex.get(from) ?? 0;
    const b = navIndex.get(to) ?? 0;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const range = nav.slice(lo, hi + 1).map((r) => r.e.path);
    setSel((s) => new Set(add ? [...s, ...range] : range));
    setFocus(to);
  };

  const moveFocus = (delta: number, e: KeyboardEvent) => {
    if (nav.length === 0) return;
    const cur = focus != null ? (navIndex.get(focus) ?? -1) : -1;
    const n = Math.max(0, Math.min(nav.length - 1, cur + delta));
    const target = nav[n].e.path;
    if (e.shiftKey) selectRange(anchor ?? target, target, e.ctrlKey);
    else if (e.ctrlKey) setFocus(target);
    else selectOnly(target);
  };

  const typeBuf = useRef({ text: "", at: 0 });
  const typeSelect = (ch: string) => {
    const now = Date.now();
    const t = typeBuf.current;
    t.text = now - t.at > 800 ? ch : t.text + ch;
    t.at = now;
    const q = t.text.toLowerCase();
    const start = focus != null ? (navIndex.get(focus) ?? -1) : -1;
    const order = [...nav.slice(start + (t.text.length === 1 ? 1 : 0)), ...nav];
    const hit = order.find((r) => r.e.name.toLowerCase().startsWith(q));
    if (hit) selectOnly(hit.e.path);
  };

  // ───────── [4] 동작 ─────────

  const guarded = (what: string, run: () => void) => {
    if (!role || !PROTECTED_ROLES.has(role)) return run();
    setMsg({
      text: `${ROLE_LABEL[role]} 자리다. 이 자리 파일은 고치지 않는 것이 규칙이다. 그래도 ${what}?`,
      tone: "warn",
      actions: [
        {
          label: what,
          run: () => {
            setMsg(null);
            run();
          },
          primary: true,
        },
        { label: "그만두기", run: () => setMsg(null) },
      ],
    });
  };

  const openEntries = (list: Entry[]) => {
    if (list.length === 1 && list[0].isDir) return p.onGo(list[0].path);
    for (const e of list) {
      api
        .openItem(e.path)
        .then((navTo) => {
          if (!navTo) return;
          if (list.length === 1) p.onGo(navTo);
          else p.onOpenTab(navTo);
        })
        .catch(report);
    }
  };

  const recycle = (paths: string[]) => {
    if (paths.length === 0) return;
    const run = () => {
      const last = Math.max(...paths.map((x) => navIndex.get(x) ?? 0));
      const next =
        nav.slice(last + 1).find((r) => !paths.includes(r.e.path)) ??
        nav
          .slice(0, last)
          .reverse()
          .find((r) => !paths.includes(r.e.path));
      api
        .recycle(paths)
        .then((r) => {
          say(r === "done" ? `${paths.length}개를 휴지통으로 보냈다` : "지우기를 중간에 취소했다", r === "done" ? "ok" : "warn");
          if (next) pendingFocus.current = { path: next.e.path };
          load(true);
        })
        .catch(report);
    };
    guarded("휴지통으로 보내기", run);
  };

  const startRename = (fp: string) => guarded("이름 바꾸기", () => setRenaming(fp));

  const commitRename = async (e: Entry, value: string) => {
    setRenaming(null);
    const v = value.trim();
    if (!v || v === e.name) return;
    try {
      const r = await api.rename(e.path, v);
      if (r === "done") {
        pendingFocus.current = { path: joinPath(parentOf(e.path) ?? path, v) };
        load(true);
      }
    } catch (err) {
      report(err);
    }
  };

  const commitMemo = (fp: string, value: string) => {
    setMemoing(null);
    // 줄바꿈은 남기고 앞뒤 빈칸 · 빈 줄만 뗀다 — 긴 메모를 여러 줄로 쓰게.
    const v = value.replace(/\s+$/, "").replace(/^\s+/, "");
    if (v === (memoOf(fp) ?? "")) return;
    api
      .setMemo(fp, v)
      .then((m) =>
        setMemos((old) => {
          const n = new Map(old);
          if (m) n.set(norm(fp), m.text);
          else n.delete(norm(fp));
          return n;
        }),
      )
      .catch(report);
  };

  /** 색 표시 — 여러 항목에 한 번에. 같은 색을 다시 고르면 뗀다 (TagMenu). */
  const applyColor = (paths: string[], c: TagColor | null) => {
    setTagMenu(null);
    if (!paths.length) return;
    Promise.all(paths.map((fp) => api.setColor(fp, c)))
      .then(() => {
        setColors((old) => {
          const n = new Map(old);
          for (const fp of paths) {
            if (c) n.set(norm(fp), c);
            else n.delete(norm(fp));
          }
          return n;
        });
        window.dispatchEvent(new CustomEvent("fd:colors"));
      })
      .catch(report);
  };

  const newFolder = () =>
    api
      .newFolder(path)
      .then((np) => {
        pendingFocus.current = { path: np, rename: true };
        load(true);
      })
      .catch(report);

  const clip = (verb: "copy" | "cut") => {
    const paths = selectedPaths();
    if (paths.length === 0) return;
    api
      .shellVerb(paths, verb, path)
      .then(() => say(`${paths.length}개를 ${verb === "copy" ? "복사했다" : "잘라 냈다"}`, "ok"))
      .catch(report);
  };

  const paste = () => api.shellVerb([path], "paste", parentOf(path) ?? path).catch(report);

  /** 오른쪽 메뉴의 색 하위 메뉴. */
  const colorItems = (cur: TagColor | null | undefined): MenuItem[] => [
    ...TAG_COLORS.map((c, i) => ({ key: `color:${c}`, label: `${TAG_LABEL[c]}\tAlt+${i + 1}`, checked: cur === c })),
    {},
    { key: "color:none", label: "색 지우기\tAlt+0", disabled: !cur },
  ];

  /** 새 판을 낼 수 있는 파일인가 — 이름이 「문서명_v판_날짜」 꼴이고 이 폴더(이전판 밖)에 있다. */
  const editionSource = (e: Entry): DocGroup | null => {
    const g = groupOf.get(norm(e.path));
    const f = g?.files.find((x) => samePath(x.path, e.path));
    return g && f && !f.inHistory && f.parsed.version.length > 0 && f.parsed.date ? g : null;
  };

  /** 메뉴의 「새 판…」 — 펼친 줄이 없어도(격자 · 접힌 문서) 알림 줄에서 계획을 보이고 묻는다. */
  const menuEdition = (e: Entry) =>
    api
      .planEdition(e.path, today())
      .then((pl) =>
        setMsg({
          text: `새 판 ${pl.newName}${pl.retire.length ? ` · 이전판으로 옮김: ${pl.retire.map(baseName).join(" · ")}` : ""}`,
          actions: [
            { label: "새 판 내기", run: () => doEdition(e), primary: true },
            { label: "그만두기", run: () => setMsg(null) },
          ],
        }),
      )
      .catch(report);

  const copyPaths = (paths: string[]) =>
    navigator.clipboard
      .writeText(paths.join("\r\n"))
      .then(() => say(paths.length === 1 ? "경로를 복사했다" : `경로 ${paths.length}개를 복사했다`, "ok"))
      .catch(report);

  /** 오른쪽 메뉴에서 고른 filedesk 항목을 한다 (`app:<열쇠>`). */
  const runMenuPick = (r: string, paths: string[], list: Entry[], e?: Entry) => {
    if (r === "rename" && e) return startRename(e.path);
    if (!r.startsWith("app:")) return;
    const k = r.slice(4);
    if (k.startsWith("color:")) applyColor(paths, k === "color:none" ? null : (k.slice(6) as TagColor));
    else if (k.startsWith("size:")) p.setView((v) => ({ ...v, mode: "grid", size: Number(k.slice(5)) }));
    else if (k === "view:list" || k === "view:grid") p.setView((v) => ({ ...v, mode: k.slice(5) as "list" | "grid" }));
    else if (k === "memo" && e) setMemoing(e.path);
    else if (k === "pin") p.onPin(list.map((x) => ({ path: x.path, isDir: x.isDir })));
    else if (k === "pinhere") p.onPin([{ path, isDir: true }]);
    else if (k === "beside" && e) p.onOpenBeside(e.path);
    else if (k === "newtab" && e) p.onOpenTab(e.path);
    else if (k === "edition" && e) menuEdition(e);
    else if (k === "copypath") copyPaths(paths);
    else if (k === "split") p.onToggleSplit();
  };

  const itemMenu = (e: Entry) => {
    let list = selectedEntries;
    if (!sel.has(e.path)) {
      selectOnly(e.path);
      list = [e];
    }
    const paths = list.map((x) => x.path);
    const one = list.length === 1;
    const items: MenuItem[] = [];
    if (one && e.isDir) items.push({ key: "beside", label: p.split ? "옆 칸에서 열기" : "나눠서 옆에 열기" }, { key: "newtab", label: "새 탭에서 열기" });
    if (one) items.push({ key: "memo", label: memoOf(e.path) ? "메모 고치기…\tCtrl+M" : "메모 붙이기…\tCtrl+M" });
    items.push({ label: "색 표시", children: colorItems(one ? colors.get(norm(e.path)) : null) });
    items.push({ key: "pin", label: "즐겨찾기에 더하기\tCtrl+D" });
    if (one && editionSource(e)) items.push({ key: "edition", label: "새 판 내기…" });
    items.push({ key: "copypath", label: "경로 복사\tCtrl+Shift+C" });
    api
      .contextMenu(paths, parentOf(e.path) ?? path, items)
      .then((r) => runMenuPick(r, paths, list, e))
      .catch(report);
  };

  const backgroundMenu = () => {
    setSel(new Set());
    const items: MenuItem[] = [
      { key: "pinhere", label: "이 폴더를 즐겨찾기에\tCtrl+D" },
      {
        label: "보기",
        children: [
          { key: "view:list", label: "목록", checked: !isGrid },
          { key: "view:grid", label: "격자", checked: isGrid },
          {},
          ...SIZE_LABEL.map((l, i) => ({ key: `size:${i}`, label: `격자 ${l}`, checked: isGrid && p.view.size === i })),
        ],
      },
      { key: "split", label: p.split ? "나눠 보기 끄기\tCtrl+\\" : "나눠 보기\tCtrl+\\" },
      { key: "copypath", label: "이 폴더 경로 복사" },
    ];
    api
      .backgroundMenu(path, items)
      .then((r) => runMenuPick(r, [path], []))
      .catch(report);
  };

  const askEdition = (g: DocGroup, source: Entry) =>
    api
      .planEdition(source.path, today())
      .then((pl) => setPlan({ key: g.key, kind: "edition", plan: pl }))
      .catch(report);

  const doEdition = (source: Entry) => {
    setPlan(null);
    api
      .newEdition(source.path, today())
      .then((np) => {
        say(`새 판을 냈다: ${baseName(np)}`, "ok");
        pendingFocus.current = { path: np };
        load(true);
      })
      .catch(report);
  };

  const askRetire = (g: DocGroup) =>
    api
      .planRetire(path, g.key)
      .then((files) => setPlan({ key: g.key, kind: "retire", files }))
      .catch(report);

  const doRetire = (g: DocGroup) => {
    setPlan(null);
    api
      .retireEditions(path, g.key)
      .then((n) => {
        say(`지난 판 ${n}개를 이전판으로 옮겼다`, "ok");
        load(true);
      })
      .catch(report);
  };

  const go = async (input: string): Promise<string | null> => {
    try {
      p.onGo(await api.resolveInput(input, path));
      return null;
    } catch (e) {
      return errText(e);
    }
  };

  const up = () => {
    const parent = parentOf(path);
    if (parent) p.onGo(parent);
  };

  // ───────── [5] 끌기 ─────────

  const press = useRef<{ x: number; y: number; entry: Entry; wasSelected: boolean; mods: boolean } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const pr = press.current;
      if (!pr || !(e.buttons & 1)) return;
      if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < DRAG_PX) return;
      press.current = null;
      const paths = sel.has(pr.entry.path) ? selectedPaths() : [pr.entry.path];
      api.dragOut(paths).catch(report);
    };
    const upH = () => {
      const pr = press.current;
      press.current = null;
      if (pr && pr.wasSelected && !pr.mods) selectOnly(pr.entry.path);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", upH);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", upH);
    };
  });

  /** 목록을 누르면 입력 칸에서 손을 뗀 것이다. 줄 누르기는 preventDefault 로 초점을 옮기지 않으므로 직접 닫는다 —
   *  안 닫으면 이어지는 Delete · Enter 가 입력 칸에 들어간다 (11-11 앱 시험에서 잡힘). */
  const leaveInputs = () => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a.tagName === "INPUT") a.blur();
  };

  const onRowDown = (ev: React.MouseEvent, e: Entry) => {
    if (ev.button !== 0) return;
    if ((ev.target as HTMLElement).closest("button, input")) return;
    ev.preventDefault();
    leaveInputs();
    const wasSelected = sel.has(e.path);
    if (ev.shiftKey) selectRange(anchor ?? e.path, e.path, ev.ctrlKey);
    else if (ev.ctrlKey) {
      setSel((s) => {
        const n = new Set(s);
        if (n.has(e.path)) n.delete(e.path);
        else n.add(e.path);
        return n;
      });
      setFocus(e.path);
      setAnchor(e.path);
    } else if (!wasSelected) selectOnly(e.path);
    press.current = { x: ev.clientX, y: ev.clientY, entry: e, wasSelected, mods: ev.ctrlKey || ev.shiftKey };
  };

  // ───────── [6] 단축키 ─────────

  useEffect(() => {
    if (!p.active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea")) return;
      const k = e.key;
      const lk = k.toLowerCase();
      const ctrl = e.ctrlKey && !e.altKey;
      const focusRow = focus != null ? nav[navIndex.get(focus) ?? -1] : undefined;
      let handled = true;
      if (ctrl && (lk === "f" || lk === "e")) filterRef.current?.focus();
      else if (k === "Escape" && (deep || kind || colorOnly) && !msg) {
        setDeep(null);
        setKind(null);
        setColorOnly(null);
      }
      else if (ctrl && e.shiftKey && lk === "d") setFold((v) => !v);
      else if (ctrl && lk === "d")
        p.onPin(selectedEntries.length ? selectedEntries.map((x) => ({ path: x.path, isDir: x.isDir })) : [{ path, isDir: true }]);
      else if (e.altKey && !e.ctrlKey && /^Digit[0-7]$/.test(e.code) && selectedEntries.length) {
        const n = Number(e.code.slice(5));
        applyColor(selectedPaths(), n === 0 ? null : TAG_COLORS[n - 1]);
      }
      else if (k === "Backspace" || (e.altKey && k === "ArrowLeft")) p.onBack();
      else if (e.altKey && k === "ArrowRight") p.onFwd();
      else if (e.altKey && k === "ArrowUp") up();
      else if (k === "F5") load(true);
      else if (k === "F4" || (ctrl && lk === "l") || (e.altKey && lk === "d")) addrRef.current?.edit();
      else if (k === "Escape" && msg) setMsg(null);
      else if (isGrid && (k === "ArrowRight" || k === "ArrowLeft")) moveFocus(k === "ArrowRight" ? 1 : -1, e);
      else if (k === "ArrowDown") moveFocus(isGrid ? gridCols.current : 1, e);
      else if (k === "ArrowUp") moveFocus(isGrid ? -gridCols.current : -1, e);
      // 판 펼치기 · 접기 (나무 목록 관습)
      else if (k === "ArrowRight" && focusRow?.depth === 0 && focusRow.hiddenCount != null && focusRow.group) {
        const key = focusRow.group.key;
        if (!open.has(key)) setJustOpened({ key, at: Date.now() });
        setOpen((s) => new Set(s).add(key));
      } else if (k === "ArrowLeft" && focusRow?.group && open.has(focusRow.group.key)) {
        const key = focusRow.group.key;
        toggleOpen(key);
        const rep = nav.find((r) => r.depth === 0 && r.group?.key === key);
        if (rep) selectOnly(rep.e.path);
      } else if (k === "Home") moveFocus(-Infinity, e);
      else if (k === "End") moveFocus(Infinity, e);
      else if (k === "PageDown") moveFocus(isGrid ? gridCols.current * 3 : Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H), e);
      else if (k === "PageUp") moveFocus(isGrid ? -gridCols.current * 3 : -Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H), e);
      else if (k === "Enter" && e.altKey) api.shellVerb(selectedPaths(), "properties", path).catch(report);
      else if (k === "Enter") openEntries(selectedEntries);
      else if (k === "F2" && focus) startRename(focus);
      else if (ctrl && lk === "m" && focus) setMemoing(focus);
      else if (k === "Delete") recycle(selectedPaths());
      else if (ctrl && e.shiftKey && lk === "n") newFolder();
      else if (ctrl && e.shiftKey && lk === "c") copyPaths(selectedPaths().length ? selectedPaths() : [path]);
      else if (ctrl && lk === "a") setSel(new Set(nav.map((r) => r.e.path)));
      else if (ctrl && lk === "c") clip("copy");
      else if (ctrl && lk === "x") clip("cut");
      else if (ctrl && lk === "v") paste();
      else if ((k === "F10" && e.shiftKey) || k === "ContextMenu") {
        if (focusRow) itemMenu(focusRow.e);
        else backgroundMenu();
      } else if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && k !== " ") typeSelect(k);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Ctrl+휠 — 탐색기처럼 보기 크기를 바꾼다. 목록에서 올리면 격자 작게, 격자 작게에서 내리면 목록.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let last = 0;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const now = Date.now();
      if (now - last < 140) return; // 휠 한 칸에 이벤트가 여럿 온다 (정밀 터치패드)
      last = now;
      const up = ev.deltaY < 0;
      p.setView((v) => {
        if (v.mode === "list") return up ? { ...v, mode: "grid", size: 0 } : v;
        if (up) return { ...v, size: Math.min(3, v.size + 1) };
        return v.size === 0 ? { ...v, mode: "list" } : { ...v, size: v.size - 1 };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────── [7] 그리기 ─────────

  /** 열 너비 끌기 — 손잡이는 판 · 고친 날 · 크기 열의 <왼쪽> 경계에 있다.
   *  2026.11.11 : 오른쪽 경계에 두었더니, 이 열들은 창 오른쪽에 붙어 있어 넓히면 왼쪽 경계가 반대로 밀려 잡은 선이 마우스를 따라오지 않았다.
   *  이름 열은 남는 너비를 다 쓰므로 따로 끌 손잡이가 없다 — 그 오른쪽 경계가 곧 다음 열의 왼쪽 손잡이다. */
  const startResize = (ev: React.MouseEvent, i: number) => {
    ev.preventDefault();
    ev.stopPropagation();
    const x0 = ev.clientX;
    const base = [...p.cols];
    document.body.classList.add("col-resizing");
    const move = (m: MouseEvent) => {
      const next = [...base];
      next[i] = Math.max(56, Math.round(base[i] - (m.clientX - x0)));
      p.setCols(next);
    };
    const upH = () => {
      document.body.classList.remove("col-resizing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", upH);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", upH);
  };
  /** 보일 열 — 이름은 늘, 판 · 고친 날 · 크기는 설정(열 머리 오른쪽 단추)으로 숨긴다. */
  const colOn = (c: ColKey) => !p.view.hiddenCols.includes(c);
  const colTemplate = (narrow: boolean) =>
    [
      narrow ? "minmax(120px, 1fr)" : `minmax(${p.cols[0]}px, 1fr)`,
      colOn("ver") && !narrow ? `${p.cols[1]}px` : "",
      colOn("date") ? `${p.cols[2]}px` : "",
      colOn("size") ? `${p.cols[3]}px` : "",
    ]
      .filter(Boolean)
      .join(" ");
  const colsTemplate = colTemplate(false);
  /** 좁은 칸(나눠 보기 · 작은 창) — 판 열을 접고 이름 칸 최소 너비를 줄인다 (styles.css 「좁은 칸」). */
  const narrowCols = colTemplate(true);
  const toggleCol = (c: ColKey) =>
    p.setView((v) => ({ ...v, hiddenCols: v.hiddenCols.includes(c) ? v.hiddenCols.filter((x) => x !== c) : [...v.hiddenCols, c] }));

  const header = (key: SortKey | null, label: string, i: number, align = "", title?: string) => (
    <div
      className={"col " + align + ` col-${i}`}
      role="columnheader"
      title={title}
      aria-sort={key && sort.key === key ? (sort.asc ? "ascending" : "descending") : undefined}
    >
      {key ? (
        <button
          className={"col-btn" + (sort.key === key ? " sorted" : "")}
          onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
        >
          {label}
          {sort.key === key && <span className="sort-mark">{sort.asc ? "↑" : "↓"}</span>}
        </button>
      ) : (
        <span className="col-btn">{label}</span>
      )}
      {i > 0 && (
        <span
          className="resizer"
          title="끌어서 너비 바꾸기 · 두 번 누르면 처음대로"
          onMouseDown={(e) => startResize(e, i)}
          onDoubleClick={() => p.setCols(p.cols.map((w, j) => (j === i ? DEFAULT_COLS[i] : w)))}
          aria-hidden="true"
        />
      )}
    </div>
  );

  const right = (
    <>
      {(issueLead.size > 0 || onlyIssues) && (
        <button
          className="issue-chip"
          aria-pressed={onlyIssues}
          onClick={() => setOnlyIssues((v) => !v)}
          title={onlyIssues ? "모든 파일 보기" : "판 규칙이 어긋난 문서만 보기"}
        >
          문제 {issueLead.size}문서
        </button>
      )}
      <input
        ref={filterRef}
        className={"filter" + (deep ? " deep" : "")}
        value={filter}
        placeholder={deep ? "아래 폴더까지 찾기" : "거르기"}
        aria-label={deep ? "아래 폴더까지 찾기" : "이 폴더에서 거르기"}
        title={"Ctrl+F — 이름 · 메모 글에서 거른다\nShift+Enter — 아래 폴더까지 찾기"}
        spellCheck={false}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            setFilter("");
            setDeep(null);
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            startDeep();
          } else if (e.key === "Enter" || e.key === "ArrowDown") {
            (e.target as HTMLInputElement).blur();
            if (nav[0]) selectOnly(nav[0].e.path);
          }
        }}
      />
    </>
  );

  const selBytes = selectedEntries.reduce((n, e) => n + (e.isDir ? 0 : e.size), 0);
  const stacked = rows.filter((r) => r.kind === "entry" && r.depth === 0 && r.hiddenCount != null).length;

  const entryRow = (r: EntryRow, start: number) => {
    const e = r.e;
    const selected = sel.has(e.path);
    const g = r.group;
    const isStack = r.depth === 0 && r.hiddenCount != null && !!g;
    const isOpen = isStack && !!g && open.has(g.key);
    const [stem, ext] = splitName(e.name, e.isDir);
    const parsed = g?.files.find((f) => samePath(f.path, e.path))?.parsed;
    const parsedVer = parsed?.version ?? [];
    // 판이 쌓인 문서 줄은 문서 이름으로 부른다 — 판 · 날짜는 「판」 열에 있으니 파일 이름에서 되풀이하지 않는다. 온전한 이름은 title · 펼친 줄에.
    const shown = isStack && g ? g.title : stem;
    const docDate = parsed?.date ? `${parsed.date.slice(4, 6)}-${parsed.date.slice(6, 8)}` : "";
    const isHistDir = e.isDir && e.name === "이전판";
    const memo = memoOf(e.path);
    const color = colors.get(norm(e.path));
    const fresh = r.depth === 1 && !!g && justOpened?.key === g.key && Date.now() - justOpened.at < 400;
    return (
      <div
        key={e.path}
        role="row"
        aria-selected={selected}
        aria-level={r.depth + 1}
        aria-expanded={isStack ? isOpen : undefined}
        className={
          "row" +
          (selected ? " selected" : "") +
          (focus === e.path ? " focused" : "") +
          (r.depth ? " sub" : "") +
          (isOpen ? " open" : "") +
          (fresh ? " appear" : "")
        }
        style={{ transform: `translateY(${start}px)` }}
        data-path={e.path}
        data-drop={e.isDir ? e.path : undefined}
        onMouseDown={(ev) => onRowDown(ev, e)}
        onDoubleClick={(ev) => !(ev.target as HTMLElement).closest("button") && openEntries([e])}
        onContextMenu={(ev) => {
          ev.stopPropagation();
          itemMenu(e);
        }}
      >
        <span className="cell name" role="gridcell">
          {isStack && g ? (
            <button className="twisty" aria-label={isOpen ? "판 접기" : "판 펼치기"} onClick={() => toggleOpen(g.key)}>
              <Chevron open={isOpen} />
            </button>
          ) : (
            <span className="twisty-space" />
          )}
          {e.isDir ? (
            <FolderGlyph faint={isHistDir} />
          ) : p.view.icons === "filedesk" ? (
            <FileGlyph ext={e.ext} />
          ) : (
            <img src={iconUrl(e)} width={16} height={16} alt="" draggable={false} loading="lazy" />
          )}
          {renaming === e.path ? (
            <RenameInput entry={e} onCommit={(v) => commitRename(e, v)} onCancel={() => setRenaming(null)} />
          ) : (
            <span
              className={"label" + (e.isDir ? " dir" : "") + (isHistDir || e.attrs & 0x2 ? " faint" : "")}
              title={e.name}
            >
              {shown}
              {ext && <span className="ext">{ext}</span>}
            </span>
          )}
          <TagDot color={color} />
          {r.where && (
            <span className="where" title={parentOf(e.path) ?? ""}>
              {r.where}
            </span>
          )}
          {memo ? (
            <button
              className={"memo" + (memo.includes("\n") ? " more" : "")}
              aria-label={`메모: ${memo}`}
              onClick={() => setMemoing(e.path)}
              onMouseEnter={(ev) => memoHover(ev, memo)}
              onMouseLeave={memoLeave}
            >
              {memo.split("\n")[0]}
            </button>
          ) : (
            renaming !== e.path && (
              <button className="memo-add" title="메모 붙이기 (Ctrl+M)" aria-label={`${e.name} 메모 붙이기`} onClick={() => setMemoing(e.path)}>
                메모
              </button>
            )
          )}
          {renaming !== e.path && (
            <button
              className="tag-add"
              title="색 표시 (Alt+1~7 · Alt+0 지우기)"
              aria-label={`${e.name} 색 표시`}
              onClick={(ev) => {
                const paths = sel.has(e.path) ? selectedPaths() : [e.path];
                const b = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                setTagMenu({ x: b.left, y: b.bottom + 4, paths });
              }}
            >
              색
            </button>
          )}
        </span>
        {colOn("ver") && (
          <span className="cell ver" role="gridcell">
            {isStack && g && <EditionTicks files={g.files} lo={span.lo} hi={span.hi} />}
            <span className="ver-text">
              {verLabel(parsedVer)}
              {isStack && docDate && <span className="doc-date"> {docDate}</span>}
            </span>
          </span>
        )}
        {colOn("date") && (
          <span className="cell date" role="gridcell" title={formatDate(e.modified)}>
            {relDate(e.modified)}
          </span>
        )}
        {colOn("size") && (
          <span className="cell size" role="gridcell">
            {formatSize(e)}
          </span>
        )}
      </div>
    );
  };

  /** 격자 칸 그림 주소 — 큰 셸 아이콘(`i:`), 그림 · pdf · 영상은 미리보기(`t:`, 고친 때가 바뀌면 다시 받는다). */
  const bigIconUrl = (e: Entry, px: number, thumb: boolean) =>
    `http://fdicon.localhost/${encodeURIComponent(`${thumb ? "t" : "i"}:${px}:${e.path}`)}${thumb ? `?m=${e.modified}` : ""}`;

  /** 격자 칸 하나 — 목록 줄과 같은 고르기 · 끌기 · 메뉴 · 메모. 판이 쌓인 문서는 그림 위에 판 수, 판 규칙이 어긋나면 「!」. */
  const tile = (r: EntryRow, style: React.CSSProperties) => {
    const e = r.e;
    const selected = sel.has(e.path);
    const g = r.group;
    const isStack = r.depth === 0 && r.hiddenCount != null && !!g;
    const [stem, ext] = splitName(e.name, e.isDir);
    const parsed = g?.files.find((f) => samePath(f.path, e.path))?.parsed;
    const title = isStack && g ? g.title : stem;
    const memo = memoOf(e.path);
    const color = colors.get(norm(e.path));
    const iconPx = TILE[p.view.size].icon;
    const px = Math.round(iconPx * (window.devicePixelRatio || 1));
    const thumb = p.view.thumbs && !e.isDir && canThumb(e.ext);
    const hist = e.isDir && e.name === "이전판";
    const issue = !!g && g.issues.length > 0 && issueLead.has(norm(e.path));
    return (
      <div
        key={e.path}
        role="gridcell"
        aria-selected={selected}
        className={"tile" + (selected ? " selected" : "") + (focus === e.path ? " focused" : "")}
        style={style}
        data-path={e.path}
        data-drop={e.isDir ? e.path : undefined}
        title={e.name}
        onMouseDown={(ev) => onRowDown(ev, e)}
        onDoubleClick={(ev) => !(ev.target as HTMLElement).closest("button") && openEntries([e])}
        onContextMenu={(ev) => {
          ev.stopPropagation();
          itemMenu(e);
        }}
      >
        <div className="tile-pic" style={{ height: iconPx }}>
          {e.isDir && (p.view.icons === "filedesk" || hist) ? (
            <FolderGlyph size={iconPx} faint={hist} />
          ) : !e.isDir && p.view.icons === "filedesk" && !thumb ? (
            <FileGlyph ext={e.ext} size={iconPx} />
          ) : (
            <img
              src={bigIconUrl(e, px, thumb)}
              alt=""
              draggable={false}
              loading="lazy"
              className={thumb ? "thumb" : undefined}
              style={{ maxWidth: iconPx, maxHeight: iconPx }}
            />
          )}
          {isStack && g && (
            <span className="tile-stack" title={`판 ${editionCount(g.files)}개 — 목록 보기에서 펼친다`}>
              {editionCount(g.files)}판
            </span>
          )}
          {issue && g && (
            <span className="tile-issue" title={g.issues.join("\n")} aria-label="판 규칙이 어긋났다">
              !
            </span>
          )}
        </div>
        <div className="tile-name">
          {renaming === e.path ? (
            <RenameInput entry={e} onCommit={(v) => commitRename(e, v)} onCancel={() => setRenaming(null)} />
          ) : (
            <span className={"tile-label" + (e.isDir ? " dir" : "")}>
              <TagDot color={color} />
              {title}
              {ext && <span className="ext">{ext}</span>}
            </span>
          )}
        </div>
        <div className="tile-meta">
          {parsed && parsed.version.length > 0 && <span className="tile-ver">{verLabel(parsed.version)}</span>}
          {memo ? (
            <button className="tile-memo" onClick={() => setMemoing(e.path)} onMouseEnter={(ev) => memoHover(ev, memo)} onMouseLeave={memoLeave}>
              {memo.split("\n")[0]}
            </button>
          ) : (
            !e.isDir && <span className="muted">{formatSize(e)}</span>
          )}
        </div>
      </div>
    );
  };

  const editionRow = (r: EditionRow, start: number) => {
    const g = r.group;
    const pl = plan?.key === g.key && plan.kind === "edition" ? plan.plan : null;
    const latest = g.files.find((f) => samePath(f.path, r.source.path));
    const canEdition = !!latest && latest.parsed.version.length > 0 && latest.parsed.date !== "";
    return (
      <div key={`#${g.key}`} className="row sub edition" style={{ transform: `translateY(${start}px)` }}>
        <span className="edition-line">
          {pl ? (
            <>
              <span className="muted">→</span>
              <b>{pl.newName}</b>
              <span className="muted" title={pl.retire.join("\n")}>· 이전판으로 옮김: {pl.retire.map(baseName).join(" · ")}</span>
              <button className="act primary" onClick={() => doEdition(r.source)}>
                새 판 내기
              </button>
              <button className="act" onClick={() => setPlan(null)}>
                그만두기
              </button>
            </>
          ) : (
            <>
              {canEdition ? (
                <button
                  className="act"
                  onClick={() => askEdition(g, r.source)}
                  title="최신판을 다음 판 이름 · 오늘 날짜로 복사하고 지난 판은 이전판으로"
                >
                  새 판…
                </button>
              ) : (
                <span className="muted">이름이 「문서명_v판_날짜」 꼴이 아니라 새 판을 낼 수 없다</span>
              )}
            </>
          )}
        </span>
      </div>
    );
  };

  /** 문제 줄 — 무엇이 어긋났나, 그리고 곁에 고칠 동작. 앱이 고칠 수 있는 것(같은 자리에 남은 지난 판)만 동작을 주고, 나머지는 펼쳐 보게 한다. */
  const issueRow = (r: IssueRow, start: number) => {
    const g = r.group;
    const files = plan?.key === g.key && plan.kind === "retire" ? plan.files : null;
    const stale = staleCount(g);
    return (
      <div key={`!${g.key}`} className="row issue-line" style={{ transform: `translateY(${start}px)` }}>
        <span className="edition-line">
          {files ? (
            <>
              <span className="issue-text">이전판으로 옮김: {files.map(baseName).join(" · ")}</span>
              <button className="act primary" onClick={() => doRetire(g)}>
                옮기기
              </button>
              <button className="act" onClick={() => setPlan(null)}>
                그만두기
              </button>
            </>
          ) : (
            <>
              <span className="issue-text" title={g.issues.join("\n")}>
                {g.issues.join(" · ")}
              </span>
              {stale > 0 ? (
                <button className="act" onClick={() => askRetire(g)} title="옮길 파일을 먼저 보이고, 확인하면 이 폴더의 이전판으로 옮긴다">
                  지난 판 {stale}개 이전판으로 옮기기
                </button>
              ) : (
                r.stack &&
                !open.has(g.key) && (
                  <button className="act" onClick={() => toggleOpen(g.key)}>
                    펼쳐 보기
                  </button>
                )
              )}
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <section
      ref={sectionRef}
      className={"pane" + (p.side != null ? ` in-split${p.active ? " focused-pane" : ""}` : "") + (isGrid ? " grid-mode" : "")}
      hidden={!p.visible}
      aria-label={path}
      style={{ ["--cols" as string]: colsTemplate, ["--cols-narrow" as string]: narrowCols, gridColumn: p.side === 1 ? 3 : 1, gridRow: 1 }}
      onMouseDownCapture={p.onFocusPane}
    >
      <AddressBar
        ref={addrRef}
        path={path}
        role={role}
        canBack={p.tab.back.length > 0}
        canFwd={p.tab.fwd.length > 0}
        canUp={parentOf(path) != null}
        onBack={p.onBack}
        onFwd={p.onFwd}
        onUp={up}
        onSubmit={go}
        right={right}
      />
      {msg && (
        <div className={"msg" + (msg.tone ? ` ${msg.tone}` : "")} role={msg.actions ? "alertdialog" : "status"}>
          <span>{msg.text}</span>
          {msg.actions?.map((a) => (
            <button key={a.label} className={"act" + (a.primary ? " primary" : "")} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {(deep || kind || colorOnly || kindCounts.size > 1 || colorCounts.size > 0 || filter.trim()) && (
        <div className="kinds" role="toolbar" aria-label="종류 · 색으로 거르기">
          {deep && (
            <span className="deep-tag" title={path}>
              아래 폴더까지 「{deep.q}」
              <button className="kind-x" aria-label="찾기 끝내기" title="이 폴더로 돌아가기 (Esc)" onClick={() => setDeep(null)}>
                ×
              </button>
            </span>
          )}
          {kindOrder().filter((k) => kindCounts.has(k) || kind === k).map((k) => (
            <button key={k} className="kind" aria-pressed={kind === k} onClick={() => setKind((v) => (v === k ? null : k))}>
              {kindLabel(k)} <span className="kind-n">{kindCounts.get(k) ?? 0}</span>
            </button>
          ))}
          {TAG_COLORS.filter((c) => colorCounts.has(c) || colorOnly === c).map((c) => (
            <button
              key={c}
              className="kind kind-color"
              aria-pressed={colorOnly === c}
              title={`${TAG_LABEL[c]} 표시만`}
              onClick={() => setColorOnly((v) => (v === c ? null : c))}
            >
              <TagDot color={c} /> <span className="kind-n">{colorCounts.get(c) ?? 0}</span>
            </button>
          ))}
          {!deep && filter.trim() && (
            <button className="kind deep-btn" title="이 폴더 아래 전부에서 이름 · 메모 글로 찾는다 (Shift+Enter)" onClick={startDeep}>
              아래 폴더까지 찾기
            </button>
          )}
        </div>
      )}
      {!isGrid && (
        <div
          className="cols"
          role="row"
          onContextMenu={(e) => {
            e.preventDefault();
            setColMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {header("name", "이름", 0, "", "오른쪽 단추: 보일 열 고르기")}
          {colOn("ver") && header(null, "판", 1, "", "점 하나 = 판 하나 · 찬 점 = 같은 자리 · 빈 점 = 이전판 · 오른쪽 끝이 오늘\n규칙대로면 찬 점은 맨 오른쪽 하나")}
          {colOn("date") && header("modified", "고친 날", 2)}
          {colOn("size") && header("size", "크기", 3, "right")}
        </div>
      )}
      {isGrid && (
        <div className="grid-sort" role="toolbar" aria-label="정렬">
          {(["name", "modified", "size"] as SortKey[]).map((k) => (
            <button key={k} className={"col-btn" + (sort.key === k ? " sorted" : "")} onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }))}>
              {{ name: "이름", modified: "고친 날", size: "크기", kind: "종류" }[k]}
              {sort.key === k && <span className="sort-mark">{sort.asc ? "↑" : "↓"}</span>}
            </button>
          ))}
        </div>
      )}
      <div
        ref={scrollRef}
        className="list"
        role="grid"
        aria-label="파일 목록"
        data-drop={path}
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest("input")) leaveInputs();
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("list-inner")) {
            setSel(new Set());
            setFocus(null);
          }
        }}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest(".row")) backgroundMenu();
        }}
      >
        {error ? (
          <div className="empty error">{error}</div>
        ) : deep && deep.items == null ? (
          <div className="empty">아래 폴더에서 찾는 중…</div>
        ) : entries && rows.length === 0 ? (
          <div className="empty">
            {kind || colorOnly ? (
              <>
                {kind ? kindLabel(kind) : ""}
                {kind && colorOnly ? " · " : ""}
                {colorOnly ? `${TAG_LABEL[colorOnly]} 표시` : ""} 항목이 없다
                <button
                  className="act"
                  onClick={() => {
                    setKind(null);
                    setColorOnly(null);
                  }}
                >
                  모두 보기
                </button>
              </>
            ) : deep ? (
              <>아래 폴더에도 「{deep.q}」이 든 이름 · 메모가 없다</>
            ) : filter ? (
              <>
                「{filter}」이 든 이름 · 메모가 이 폴더에 없다
                <button className="act primary" onClick={startDeep}>
                  아래 폴더까지 찾기
                </button>
                <button className="act" onClick={() => setFilter("")}>
                  거르기 지우기
                </button>
              </>
            ) : onlyIssues ? (
              <>
                문제 있는 문서가 없다
                <button className="act" onClick={() => setOnlyIssues(false)}>
                  모두 보기
                </button>
              </>
            ) : (
              <>
                빈 폴더
                <button className="act" onClick={newFolder}>
                  새 폴더
                </button>
                <button className="act" onClick={paste}>
                  붙여넣기
                </button>
              </>
            )}
          </div>
        ) : null}
        {isGrid ? (
          <GridView
            key={deep ? `deep:${deep.q}` : path}
            items={nav}
            size={p.view.size}
            scrollEl={scrollRef}
            focusIndex={focus != null ? (navIndex.get(focus) ?? null) : null}
            onCols={(n) => (gridCols.current = n)}
            renderTile={(r, style) => tile(r, style)}
          />
        ) : (
          <div key={deep ? `deep:${deep.q}` : path} className="list-inner" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((v) => {
              const r = rows[v.index];
              return r.kind === "entry" ? entryRow(r, v.start) : r.kind === "issue" ? issueRow(r, v.start) : editionRow(r, v.start);
            })}
          </div>
        )}
      </div>
      <footer className="foot">
        <span>
          {deep
            ? deep.items == null
              ? "찾는 중"
              : `아래 폴더에서 ${deep.items.length.toLocaleString("ko-KR")}개${deep.truncated ? " (더 있다 — 말을 더 좁힌다)" : ""}`
            : entries
              ? `${entries.length.toLocaleString("ko-KR")}개`
              : "읽는 중"}
          {!deep && (filter || kind || colorOnly) && entries ? ` · 거른 결과 ${nav.length.toLocaleString("ko-KR")}` : ""}
        </span>
        {sel.size > 0 && (
          <span>
            {sel.size.toLocaleString("ko-KR")}개 고름{selBytes > 0 ? ` · ${formatBytes(selBytes)}` : ""}
          </span>
        )}
        <span className="view-switch" role="group" aria-label="보기">
          <button aria-pressed={!isGrid} title="목록 보기" onClick={() => p.setView((v) => ({ ...v, mode: "list" }))}>
            <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
              <path d="M1 2h12M1 6h12M1 10h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <button aria-pressed={isGrid} title="격자 보기 (Ctrl+휠로 크기)" onClick={() => p.setView((v) => ({ ...v, mode: "grid" }))}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1" y="1" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="7" y="1" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="1" y="7" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="7" y="7" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          {isGrid && (
            <input
              type="range"
              min={0}
              max={3}
              step={1}
              value={p.view.size}
              aria-label="격자 크기"
              title={`격자 크기 — ${SIZE_LABEL[p.view.size]} (Ctrl+휠)`}
              onChange={(e) => p.setView((v) => ({ ...v, size: Number(e.target.value) }))}
            />
          )}
        </span>
        <button className="foot-toggle" aria-pressed={fold} onClick={() => setFold((v) => !v)} title="Ctrl+Shift+D">
          {fold ? `판 접음${stacked > 0 ? ` ${stacked}` : ""}` : "판 펼침"}
        </button>
      </footer>
      {memoing && memoAt && (
        <MemoEditor
          at={memoAt}
          initial={memoOf(memoing) ?? ""}
          onCommit={(v) => commitMemo(memoing, v)}
          onCancel={() => setMemoing(null)}
        />
      )}
      {memoCard && (
        <div className="memo-card" role="tooltip" style={{ left: memoCard.x, top: memoCard.y }}>
          <div className="memo-card-text">{memoCard.text}</div>
          <div className="memo-card-foot muted">눌러서 고치기 · Ctrl+M</div>
        </div>
      )}
      {colMenu && (
        <ColumnMenu
          at={colMenu}
          shown={colOn}
          onToggle={toggleCol}
          onReset={() => p.setCols(DEFAULT_COLS)}
          onClose={() => setColMenu(null)}
        />
      )}
      {tagMenu && (
        <TagMenu
          x={tagMenu.x}
          y={tagMenu.y}
          current={tagMenu.paths.length === 1 ? colors.get(norm(tagMenu.paths[0])) : null}
          onPick={(c) => applyColor(tagMenu.paths, c)}
          onClose={() => setTagMenu(null)}
        />
      )}
    </section>
  );
}

/** 메모 칸 — 줄 아래에 떠서 여러 줄을 쓴다. Enter · 다른 곳 누르기는 저장, Shift+Enter 는 줄바꿈, Esc 는 그만두기. 비우고 저장하면 메모를 뗀다.
 *  2026.11.11 : 이름 곁 한 줄 칸이었다 — 긴 메모는 보이지도 고치지도 못했다. */
function MemoEditor({ at, initial, onCommit, onCancel }: { at: { x: number; y: number; w: number }; initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(220, el.scrollHeight + 2)}px`;
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    fit();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? initial);
    else onCancel();
  };
  const left = Math.min(at.x, window.innerWidth - at.w - 12);
  const top = Math.min(at.y, window.innerHeight - 160);
  return (
    <div className="memo-editor" style={{ left, top, width: at.w }} onMouseDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="memo-input"
        defaultValue={initial}
        placeholder="메모 — 비우면 뗀다"
        spellCheck={false}
        aria-label="메모"
        rows={1}
        onInput={fit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            finish(true);
          }
          if (e.key === "Escape") finish(false);
        }}
        onBlur={() => finish(true)}
      />
      <div className="memo-editor-foot muted">Enter 저장 · Shift+Enter 줄바꿈 · Esc 그만두기</div>
    </div>
  );
}

/** 열 머리 오른쪽 단추 — 보일 열 고르기 · 열 너비 처음대로. */
function ColumnMenu({ at, shown, onToggle, onReset, onClose }: { at: { x: number; y: number }; shown: (c: ColKey) => boolean; onToggle: (c: ColKey) => void; onReset: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector("button")?.focus();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);
  const label: Record<ColKey, string> = { ver: "판", date: "고친 날", size: "크기" };
  return (
    <div className="pop-menu" ref={box} role="menu" aria-label="보일 열" style={{ left: Math.min(at.x, window.innerWidth - 200), top: at.y }}>
      {(Object.keys(label) as ColKey[]).map((c) => (
        <button key={c} role="menuitemcheckbox" aria-checked={shown(c)} onClick={() => onToggle(c)}>
          <span className="pop-check">{shown(c) ? "✓" : ""}</span>
          {label[c]}
        </button>
      ))}
      <div className="pop-sep" />
      <button
        role="menuitem"
        onClick={() => {
          onReset();
          onClose();
        }}
      >
        <span className="pop-check" />열 너비 처음대로
      </button>
    </div>
  );
}

function RenameInput({ entry, onCommit, onCancel }: { entry: Entry; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  // 열릴 때 한 번만 고른다. 이름 칸이 열린 채 폴더를 다시 읽으면(감시 알림) entry 가 새 객체로 오는데,
  // 그때마다 다시 고르면 치던 글자가 덮인다 (11-11 앱 시험에서 잡힘).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.isDir ? -1 : entry.name.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? entry.name);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={entry.name}
      spellCheck={false}
      aria-label="새 이름"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
