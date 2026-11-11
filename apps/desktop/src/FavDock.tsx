// 즐겨찾기 독 — 칸 아래 가운데에 숨어 있다가 마우스를 대면 올라온다.
//
// 목차
//   [1] 상태 · 색 불러오기
//   [2] 끌기 — 좌우로 끌어 순서 바꾸기
//   [3] 그리기 — 입술(숨었을 때) · 선반(열렸을 때) · 색 메뉴
//
//   2026.11.11 : 왼쪽 열 맨 위 세로 목록 → 아래 독. 늘 보이는 자리를 차지하면서 「색 표시 · 이 PC」를 아래로 밀어냈고,
//                즐겨찾기를 쓰는 순간(갈 곳 고르기 · 끌어 온 파일 놓기)에만 필요한 것이었다.
//                숨었을 때도 「입술」의 눈금이 즐겨찾기 수 · 색 · 지금 연 폴더를 말해 주어, 열어 보지 않고도 거기 무엇이 있는지 안다.
//   2026.11.11 : 등록을 다듬었다 —
//                · 무엇으로 더하든(Ctrl+D · 「+」 · 끌어 놓기 · 목록 메뉴) 독이 잠깐 올라와 그 타일을 밝히고, 내려간 뒤에는 입술의 그 눈금이 잠깐 빛난다.
//                  알림 글만으로는 어디에 들어갔는지 독을 열어 봐야 알았다.
//                · 파일을 끌어 오면 타일 사이가 벌어져 끼울 자리가 생긴다 — 끝에만 붙어 다시 끌어 맞추던 일을 없앤다. 폴더 타일 위는 여전히 「그 폴더로 옮기기」다.
//                · 「+」는 Ctrl+D 와 같다 (고른 것, 없으면 지금 폴더).
//                · 창 안에서 파일을 끌기 시작하면 닫힌 입술이 「여기로 가져오면 즐겨찾기」라고 말한다 — 독이 있는 줄 모르는 사람의 단서.
//   파일을 끌고 오면(앱 밖 · 칸에서) CSS :hover 가 오지 않는다 — App 이 끌기 위치를 보고 drag 로 알려 준다.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { api, iconUrl, type Place, type TagColor, type ViewPrefs } from "./api";
import { PIN_DROP } from "./App";
import { FileGlyph, FolderGlyph } from "./glyphs";
import TagMenu, { TagDot } from "./TagMenu";
import { norm, packIconUrl } from "./util";

type Props = {
  pinned: Place[];
  current: string;
  /** 파일을 끄는 중 — far: 창 안 어딘가 · near: 독 가까이(열어 둔다). */
  drag: "far" | "near" | null;
  /** 아이콘 설정(셸 · filedesk · 팩)을 목록과 같게 따른다. */
  view: ViewPrefs;
  /** 방금 더한 것 — 잠깐 올라와 밝힌다. */
  flash: { paths: string[]; n: number } | null;
  onUnpin: (path: string) => void;
  onMovePin: (from: number, to: number) => void;
  onGo: (path: string) => void;
  onGoNewTab: (path: string) => void;
  onOpenFile: (path: string) => void;
};

/** 입술에 그리는 눈금 수 상한 — 넘으면 입술이 칸 너비를 넘보게 된다. */
const MAX_TICKS = 24;
/** 더한 뒤 독을 올려 두는 시간 · 내려간 뒤 입술 눈금을 밝혀 두는 시간(ms). 앞은 이름을 읽을 만큼, 뒤는 자리를 눈에 담을 만큼. */
const FLASH_OPEN = 1400;
const FLASH_GLOW = 1600;

export default function FavDock(props: Props) {
  const { pinned, current, drag: fileDrag, view, flash, onUnpin, onMovePin, onGo, onGoNewTab, onOpenFile } = props;

  // ───────── [1] 상태 · 색 ─────────

  /** 경로(norm) → 색. */
  const [colors, setColors] = useState<Map<string, TagColor>>(new Map());
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const colorKey = pinned.map((p) => p.path).join("|");
  const loadColors = useCallback(() => {
    const paths = pinned.map((p) => p.path);
    if (!paths.length) return setColors(new Map());
    api
      .memosOf(paths)
      .then((ms) => setColors(new Map(ms.filter((m) => m.color).map((m) => [norm(m.path), m.color as TagColor]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorKey]);
  useEffect(() => {
    loadColors();
    window.addEventListener("fd:colors", loadColors);
    return () => window.removeEventListener("fd:colors", loadColors);
  }, [loadColors]);

  const pickColor = (path: string, c: TagColor | null) => {
    setMenu(null);
    api
      .setColor(path, c)
      .then(() => window.dispatchEvent(new CustomEvent("fd:colors")))
      .catch(() => {});
  };

  // 방금 더한 것 — open: 독을 올려 둔다 · glow: 내려간 뒤 입술 눈금만 밝힌다.
  const [fresh, setFresh] = useState<{ keys: Set<string>; phase: "open" | "glow" } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const keys = new Set(flash.paths.map(norm));
    setFresh({ keys, phase: "open" });
    const t1 = window.setTimeout(() => setFresh({ keys, phase: "glow" }), FLASH_OPEN);
    const t2 = window.setTimeout(() => setFresh(null), FLASH_OPEN + FLASH_GLOW);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [flash]);

  // ───────── [2] 끌기 ─────────

  /** 누른 항목 · 놓을 자리(그 앞). 6px 넘게 움직여야 끌기다 — 그 전에는 누르기. */
  const [drag, setDrag] = useState<{ from: number; x0: number; on: boolean; over: number | null } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!drag) return;
    const move = (m: MouseEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const on = d.on || Math.abs(m.clientX - d.x0) > 6;
        const el = (document.elementFromPoint(m.clientX, m.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-pin-index]");
        let over: number | null = null;
        if (el) {
          const r = el.getBoundingClientRect();
          over = Number(el.dataset.pinIndex) + (m.clientX > r.left + r.width / 2 ? 1 : 0);
        }
        return { ...d, on, over: on ? over : null };
      });
    };
    const up = () => {
      setDrag((d) => {
        if (d?.on) {
          suppressClick.current = true;
          window.setTimeout(() => (suppressClick.current = false), 0);
          if (d.over != null) onMovePin(d.from, d.over);
        }
        return null;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag != null, onMovePin]);

  // 세로 휠을 가로로 — 즐겨찾기가 선반 너비를 넘을 때. 마우스에 가로 휠이 없는 사람이 대부분이다.
  // 넘친 쪽 끝을 흐리게 — 「더 있다」를 보인다. Windows 의 가는 스크롤 막대는 마우스를 대기 전엔 잘 안 보인다.
  const shelf = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = shelf.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", wheel);
    };
  }, [pinned.length]);

  // 밝힌 타일이 선반 밖(넘친 쪽)에 있으면 보이는 데까지 넘긴다
  useEffect(() => {
    if (fresh?.phase !== "open") return;
    shelf.current?.querySelector(".dock-tile.fresh")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [fresh]);

  // ───────── [3] 그리기 ─────────

  const here = norm(current);
  /** 열어 두는 까닭 — 끌기 중 · 색 메뉴 · 끌어 온 파일 · 방금 더함. 이때는 마우스가 잠깐 벗어나도 접지 않는다. */
  const held = fileDrag === "near" || !!menu || !!drag?.on || fresh?.phase === "open";
  const over = drag?.on ? drag.over : null;
  const isFresh = (p: Place) => !!fresh && fresh.keys.has(norm(p.path));

  return (
    <div className={"dock" + (held ? " open" : "") + (drag?.on ? " pin-dragging" : "") + (fileDrag ? " file-drag" : "")}>
      <div className="dock-shelf">
        <ul ref={shelf} className={(more.left ? "more-left " : "") + (more.right ? "more-right" : "") || undefined} role="toolbar" aria-label="즐겨찾기" aria-orientation="horizontal">
          {pinned.map((p, i) => {
            const ext = p.file && p.name.includes(".") ? p.name.slice(p.name.lastIndexOf(".") + 1).toLowerCase() : "";
            const isHere = !p.file && norm(p.path) === here;
            const line = over === i ? " drop-before" : over === pinned.length && i === pinned.length - 1 ? " drop-after" : "";
            return (
              <Fragment key={p.path}>
              {/* 끼울 자리 — 파일을 끄는 동안만. 타일 위는 「그 폴더로 옮기기」라 사이를 따로 둔다 */}
              {fileDrag && <li className="dock-gap" data-drop={`${PIN_DROP}@${i}`} aria-hidden="true" title="여기에 끼워 즐겨찾기에 더하기" />}
              <li
                data-pin-index={i}
                className={"dock-slot" + line + (drag?.on && drag.from === i ? " pin-lifted" : "")}
                onMouseDown={(e) => {
                  if (e.button === 0 && !(e.target as HTMLElement).closest(".dock-x")) setDrag({ from: i, x0: e.clientX, on: false, over: null });
                }}
                onClickCapture={(e) => {
                  if (suppressClick.current) {
                    e.stopPropagation();
                    e.preventDefault();
                  }
                }}
              >
                <button
                  className={"dock-tile" + (isHere ? " current" : "") + (isFresh(p) && fresh?.phase === "open" ? " fresh" : "")}
                  data-drop={p.file ? undefined : p.path}
                  title={`${p.path}\n${p.file ? "누르면 연다" : "가운데 단추 · Ctrl: 새 탭"} · 오른쪽 단추: 색 표시 · 끌어서 순서 바꾸기`}
                  aria-current={isHere ? "page" : undefined}
                  onClick={(e) => (p.file ? onOpenFile(p.path) : e.ctrlKey ? onGoNewTab(p.path) : onGo(p.path))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, path: p.path });
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1 && !p.file) {
                      e.preventDefault();
                      onGoNewTab(p.path);
                    }
                  }}
                >
                  <span className="dock-icon">
                    {placeIcon(p, ext, view)}
                    <TagDot color={colors.get(norm(p.path))} />
                  </span>
                  <span className="dock-name">{p.name}</span>
                </button>
                <button className="dock-x" title="즐겨찾기에서 빼기" aria-label={`${p.name} 즐겨찾기에서 빼기`} onClick={() => onUnpin(p.path)}>
                  ×
                </button>
              </li>
              </Fragment>
            );
          })}
          <li className="dock-slot">
            <button
              className="dock-tile dock-add"
              data-drop={PIN_DROP}
              title="고른 것을, 없으면 지금 폴더를 즐겨찾기에 더한다 (Ctrl+D) · 폴더 · 파일을 끌어 놓아도 된다"
              onClick={() => window.dispatchEvent(new CustomEvent("fd:pin-here"))}
            >
              <span className="dock-icon" aria-hidden="true">
                +
              </span>
              <span className="dock-name">{pinned.length ? "더하기" : "끌어 놓거나 Ctrl+D"}</span>
            </button>
          </li>
        </ul>
      </div>
      {/* 입술 — 숨었을 때 보이는 자리. 눈금 하나가 즐겨찾기 하나다. 읽는 값은 위 선반이 글자로 다 가지고 있어 낭독기에는 숨긴다 */}
      <div className="dock-lip" aria-hidden="true">
        {pinned.slice(0, MAX_TICKS).map((p) => {
          const c = colors.get(norm(p.path));
          const isHere = !p.file && norm(p.path) === here;
          return <span key={p.path} className={"dock-tick" + (c ? ` tag-${c}` : "") + (isHere ? " here" : "") + (isFresh(p) && fresh?.phase === "glow" ? " fresh" : "")} />;
        })}
        {pinned.length === 0 && <span className="dock-tick empty" />}
        <span className="dock-beckon">여기로 가져오면 즐겨찾기</span>
      </div>
      {menu && (
        <TagMenu
          x={menu.x}
          y={menu.y}
          current={colors.get(norm(menu.path))}
          onPick={(c) => pickColor(menu.path, c)}
          onClose={() => setMenu(null)}
          extra={
            <button
              className="tag-clear"
              role="menuitem"
              onClick={() => {
                onUnpin(menu.path);
                setMenu(null);
              }}
            >
              즐겨찾기에서 빼기
            </button>
          }
        />
      )}
    </div>
  );
}

/** 타일 그림 — 목록과 같은 아이콘 설정을 따른다.
 *  셸 아이콘은 16px 비트맵이라 제 크기로 둔다 — 20px 로 키우면 흐려져 촌스러워 보였다 (2026.11.11). */
function placeIcon(p: Place, ext: string, view: ViewPrefs) {
  const e = { isDir: !p.file, ext, path: p.path };
  const pack = view.icons === "pack" ? packIconUrl(e) : null;
  if (pack) return <img src={pack} width={20} height={20} alt="" draggable={false} />;
  if (!p.file) return <FolderGlyph size={20} />;
  if (view.icons !== "shell") return <FileGlyph ext={ext} size={22} />;
  return <img src={iconUrl(e)} width={16} height={16} alt="" draggable={false} />;
}
