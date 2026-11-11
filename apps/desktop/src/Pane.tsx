// 탭 하나의 화면 — 자리 머리 · 판 접힌 목록 · 알림 줄.
//
// 목차
//   [1] 읽기 — 목록 + 문서 묶음을 함께 읽어 「판 접힌 줄」을 만든다 · 폴더 변경 알림
//   [2] 줄 만들기 — 문서 하나 = 한 줄(최신판), 펼치면 그 자리에 판들 · 새 판 줄
//       판 규칙이 어긋난 문서는 접혀 있어도 바로 밑에 「문제 줄」(무엇이 어긋났나 + 고칠 동작). 머리의 「문제 N문서」가 그것만 거른다
//       2026.11.11 : 따로 있던 「점검」 보기를 지우고 목록에 겹쳤다 — 같은 폴더를 다른 표로 두 번 그렸고, 목록과 견줄 수 없었다
//   [3] 고르기 (클릭 · Ctrl · Shift · 키보드)
//   [4] 동작 (열기 · 이름 바꾸기 · 휴지통 · 복사/잘라내기/붙여넣기 · 새 폴더 · 오른쪽 메뉴 · 새 판 · 메모)
//       메모는 이름 바로 곁에 흐린 글로 — 누르면 그 자리에서 고친다 (Ctrl+M). 데이터는 filedesk 가 따로 둔다 (파일에 쓰지 않는다)
//       받은 것 · 보관 · 지난 판 자리는 지우기 · 이름 바꾸기 전에 알림 줄에서 한 번 묻는다
//   [5] 끌기 (앱 밖으로)
//   [6] 단축키 — 탐색기와 같게 (손에 익은 동작은 바꾸지 않는다)
//   [7] 그리기
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, iconUrl, today, type DocFile, type DocGroup, type EditionPlan, type Entry, type Role } from "./api";
import AddressBar, { type AddressHandle } from "./AddressBar";
import type { Tab } from "./App";
import EditionTicks, { editionTime } from "./EditionTicks";
import { Chevron, FolderGlyph } from "./glyphs";
import {
  baseName,
  errText,
  formatBytes,
  formatDate,
  formatSize,
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
  active: boolean;
  showHidden: boolean;
  cols: number[];
  setCols: (cols: number[]) => void;
  onPin: (path: string) => void;
  notice: string;
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
  /** 메모를 고치는 중인 항목. */
  const [memoing, setMemoing] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  /** 판을 접어 보는가 (기본). 끄면 파일을 다 보인다 — Ctrl+Shift+D. */
  const [fold, setFold] = useState(true);
  /** 문제 있는 문서만 보기 (머리의 「문제 N문서」). */
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<AddressHandle>(null);
  const pendingFocus = useRef<{ path: string; rename?: boolean } | null>(null);
  const prevPath = useRef<string | null>(null);

  const say = useCallback((text: string, tone?: Msg["tone"]) => setMsg({ text, tone }), []);
  const report = useCallback((e: unknown) => setMsg({ text: errText(e), tone: "warn" }), []);

  // 알림은 할 일(단추)이 없으면 잠시 뒤 사라진다.
  useEffect(() => {
    if (!msg || msg.actions?.length) return;
    const t = window.setTimeout(() => setMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [msg]);
  useEffect(() => {
    if (p.notice) {
      setMsg({ text: p.notice, tone: "warn" });
      p.clearNotice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.notice]);

  // ───────── [1] 읽기 ─────────

  const load = useCallback(
    async (keepSel: boolean) => {
      try {
        const [list, docs, notes] = await Promise.all([
          api.listDir(path, p.showHidden),
          api.docGroups(path).catch(() => [] as DocGroup[]),
          api.memosIn(path).catch(() => []),
        ]);
        setEntries(list);
        setGroups(docs);
        setMemos(new Map(notes.map((m) => [norm(m.path), m.text])));
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
        setEntries([]);
        setGroups([]);
        setError(errText(e));
      }
    },
    [path, p.showHidden],
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
    window.addEventListener("fd:changed", on);
    return () => {
      window.removeEventListener("fd:changed", on);
      window.clearTimeout(timer);
    };
  }, [path, load]);

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

  const rows = useMemo<Row[]>(() => {
    const all = entries ?? [];
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
    const byName = q
      ? visible.filter((e) => e.name.toLowerCase().includes(q) || groupOf.get(norm(e.path))?.title.toLowerCase().includes(q))
      : visible;
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
  }, [entries, groups, groupOf, issueLead, fold, filter, onlyIssues, sort, open, path]);

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
    if (focus == null) return;
    const i = rowIndex.get(focus);
    if (i != null) virt.scrollToIndex(i, { align: "auto" });
  }, [focus, rowIndex, virt]);

  const toggleOpen = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
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
    const v = value.trim();
    if (v === (memos.get(norm(fp)) ?? "")) return;
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

  const itemMenu = (e: Entry) => {
    let paths = selectedPaths();
    if (!sel.has(e.path)) {
      selectOnly(e.path);
      paths = [e.path];
    }
    api
      .contextMenu(paths, parentOf(e.path) ?? path)
      .then((r) => {
        if (r === "rename") startRename(e.path);
      })
      .catch(report);
  };

  const backgroundMenu = () => {
    setSel(new Set());
    api.backgroundMenu(path).catch(report);
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
      else if (ctrl && e.shiftKey && lk === "d") setFold((v) => !v);
      else if (ctrl && lk === "d") p.onPin(path);
      else if (k === "Backspace" || (e.altKey && k === "ArrowLeft")) p.onBack();
      else if (e.altKey && k === "ArrowRight") p.onFwd();
      else if (e.altKey && k === "ArrowUp") up();
      else if (k === "F5") load(true);
      else if (k === "F4" || (ctrl && lk === "l") || (e.altKey && lk === "d")) addrRef.current?.edit();
      else if (k === "Escape" && msg) setMsg(null);
      else if (k === "ArrowDown") moveFocus(1, e);
      else if (k === "ArrowUp") moveFocus(-1, e);
      // 판 펼치기 · 접기 (나무 목록 관습)
      else if (k === "ArrowRight" && focusRow?.depth === 0 && focusRow.hiddenCount != null && focusRow.group) {
        const key = focusRow.group.key;
        setOpen((s) => new Set(s).add(key));
      } else if (k === "ArrowLeft" && focusRow?.group && open.has(focusRow.group.key)) {
        const key = focusRow.group.key;
        toggleOpen(key);
        const rep = nav.find((r) => r.depth === 0 && r.group?.key === key);
        if (rep) selectOnly(rep.e.path);
      } else if (k === "Home") moveFocus(-Infinity, e);
      else if (k === "End") moveFocus(Infinity, e);
      else if (k === "PageDown") moveFocus(Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H), e);
      else if (k === "PageUp") moveFocus(-Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H), e);
      else if (k === "Enter" && e.altKey) api.shellVerb(selectedPaths(), "properties", path).catch(report);
      else if (k === "Enter") openEntries(selectedEntries);
      else if (k === "F2" && focus) startRename(focus);
      else if (ctrl && lk === "m" && focus) setMemoing(focus);
      else if (k === "Delete") recycle(selectedPaths());
      else if (ctrl && e.shiftKey && lk === "n") newFolder();
      else if (ctrl && e.shiftKey && lk === "c")
        navigator.clipboard
          .writeText(selectedPaths().join("\r\n") || path)
          .then(() => say("경로를 복사했다", "ok"))
          .catch(report);
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

  // ───────── [7] 그리기 ─────────

  const startResize = (ev: React.MouseEvent, i: number) => {
    ev.preventDefault();
    ev.stopPropagation();
    const x0 = ev.clientX;
    const base = [...p.cols];
    const move = (m: MouseEvent) => {
      const next = [...base];
      next[i] = Math.max(i === 0 ? 160 : 56, Math.round(base[i] + m.clientX - x0));
      p.setCols(next);
    };
    const upH = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", upH);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", upH);
  };
  const gridCols = `minmax(${p.cols[0]}px, 1fr) ${p.cols[1]}px ${p.cols[2]}px ${p.cols[3]}px`;

  const header = (key: SortKey | null, label: string, i: number, align = "", title?: string) => (
    <div
      className={"col " + align}
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
      <span className="resizer" onMouseDown={(e) => startResize(e, i)} aria-hidden="true" />
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
        className="filter"
        value={filter}
        placeholder="거르기"
        aria-label="이 폴더에서 거르기"
        title="Ctrl+F"
        spellCheck={false}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            setFilter("");
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" || e.key === "ArrowDown") {
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
    const memo = memos.get(norm(e.path));
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
          (isOpen ? " open" : "")
        }
        style={{ transform: `translateY(${start}px)` }}
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
          {r.where && <span className="where">{r.where}</span>}
          {memoing === e.path ? (
            <MemoInput initial={memo ?? ""} onCommit={(v) => commitMemo(e.path, v)} onCancel={() => setMemoing(null)} />
          ) : memo ? (
            <button className="memo" title={`${memo}\n\n눌러서 고치기 (Ctrl+M)`} onClick={() => setMemoing(e.path)}>
              {memo}
            </button>
          ) : (
            renaming !== e.path && (
              <button className="memo-add" title="메모 붙이기 (Ctrl+M)" aria-label={`${e.name} 메모 붙이기`} onClick={() => setMemoing(e.path)}>
                메모
              </button>
            )
          )}
        </span>
        <span className="cell ver" role="gridcell">
          {isStack && g && <EditionTicks files={g.files} lo={span.lo} hi={span.hi} />}
          <span className="ver-text">
            {verLabel(parsedVer)}
            {isStack && docDate && <span className="doc-date"> {docDate}</span>}
          </span>
        </span>
        <span className="cell date" role="gridcell" title={formatDate(e.modified)}>
          {relDate(e.modified)}
        </span>
        <span className="cell size" role="gridcell">
          {formatSize(e)}
        </span>
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
                <button className="act" onClick={() => askRetire(g)}>
                  지난 판 {stale}개를 이전판으로…
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
    <section className="pane" hidden={!p.active} aria-label={path} style={{ ["--cols" as string]: gridCols }}>
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
      <div className="cols" role="row">
        {header("name", "이름", 0)}
        {header(null, "판", 1, "", "점 하나 = 판 하나 · 찬 점 = 같은 자리 · 빈 점 = 이전판 · 오른쪽 끝이 오늘\n규칙대로면 찬 점은 맨 오른쪽 하나")}
        {header("modified", "고친 날", 2)}
        {header("size", "크기", 3, "right")}
      </div>
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
        ) : entries && rows.length === 0 ? (
          <div className="empty">
            {filter ? (
              <>
                「{filter}」이 든 이름이 없다
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
        <div className="list-inner" style={{ height: virt.getTotalSize() }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index];
            return r.kind === "entry" ? entryRow(r, v.start) : r.kind === "issue" ? issueRow(r, v.start) : editionRow(r, v.start);
          })}
        </div>
      </div>
      <footer className="foot">
        <span>
          {entries ? `${entries.length.toLocaleString("ko-KR")}개` : "읽는 중"}
          {filter && entries ? ` · 거른 결과 ${nav.length.toLocaleString("ko-KR")}` : ""}
        </span>
        {sel.size > 0 && (
          <span>
            {sel.size.toLocaleString("ko-KR")}개 고름{selBytes > 0 ? ` · ${formatBytes(selBytes)}` : ""}
          </span>
        )}
        <button className="foot-toggle" aria-pressed={fold} onClick={() => setFold((v) => !v)} title="Ctrl+Shift+D">
          {fold ? `판 접음${stacked > 0 ? ` ${stacked}` : ""}` : "판 펼침"}
        </button>
      </footer>
    </section>
  );
}

/** 메모 칸 — 이름 칸과 같은 꼴. Enter · 다른 곳 누르기는 저장, Esc 는 그만두기. 비우고 저장하면 메모를 뗀다. */
function MemoInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(ref.current?.value ?? initial);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className="rename memo-input"
      defaultValue={initial}
      placeholder="메모 — 비우면 뗀다"
      spellCheck={false}
      aria-label="메모"
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
