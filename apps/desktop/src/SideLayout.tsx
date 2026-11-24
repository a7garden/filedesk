// 설정 › 보기 › 사이드바 — 사이드바를 줄여 그린 판 위에서 구획을 끌어 차례를 바꾸고, 스위치로 켜고 끈다.
//
//   2026.11.24 : 사용자 요청. 이름 · 체크 칸 · ↑ ↓ 단추를 한 줄씩 늘어놓던 목록을 바꿨다.
//   목록으로는 「사이드바가 어떻게 보이게 되는지」를 머릿속으로 맞춰 봐야 했다 — 이제 판이 곧 사이드바다.
//   켠 구획은 그 안에 든 것의 윤곽(이 PC 의 세 칸 · 드라이브 줄 · 색 표시 일곱 점 …)을 흐린 선으로 그리고,
//   끈 구획은 이름 한 줄로 접힌다. 켜고 끈 차이가 색이 아니라 높이로 보인다.
import { SIDE_LABEL, type SideId, type ViewPrefs } from "./api";
import { moveTo, useDragSort } from "./dragSort";
import { GripGlyph } from "./glyphs";

/** 사이드바 머리에 실제로 서는 이름 — SIDE_LABEL 의 괄호 풀이는 줄 아래 작은 글로. */
const HEAD: Record<SideId, [string, string?]> = {
  pc: ["이 PC", "바탕화면 · 다운로드 · 문서 · 드라이브"],
  favs: ["즐겨찾기", "Ctrl+D 로 추가"],
  apps: ["앱", "자주 여는 프로그램"],
  links: ["연결", "NAS · 공유 폴더"],
  tags: ["색 표시"],
  smart: ["스마트 폴더"],
};

export default function SideLayout({ view, setView }: { view: ViewPrefs; setView: (f: (v: ViewPrefs) => ViewPrefs) => void }) {
  const order = view.sideOrder;
  const { list, handle, item, dragging } = useDragSort<HTMLOListElement>(order.length, (from, to) =>
    setView((v) => ({ ...v, sideOrder: moveTo(v.sideOrder, from, to) })),
  );
  return (
    <ol className={"side-mock" + (dragging ? " sorting" : "")} ref={list} aria-label="사이드바 구획">
      {order.map((id, i) => {
        const on = sideOn(view, id);
        const [name, sub] = HEAD[id];
        return (
          <li key={id} className={"side-mock-sec" + (on ? "" : " off")} {...item(i)}>
            <button className="grip" {...handle(i, SIDE_LABEL[id])}>
              <GripGlyph />
            </button>
            <div className="side-mock-body">
              <span className="side-mock-name">
                {name}
                {!on && <span className="side-mock-off">숨김</span>}
              </span>
              {on && sub && <span className="side-mock-sub">{sub}</span>}
              {on && <Sketch id={id} />}
            </div>
            <input type="checkbox" role="switch" className="switch" checked={on} aria-label={`${SIDE_LABEL[id]} 보이기`} onChange={(e) => setView((v) => setSideOn(v, id, e.target.checked))} />
          </li>
        );
      })}
    </ol>
  );
}

/** 구획 안에 든 것의 윤곽 — 사이드바에서 그 구획이 차지하는 꼴을 흐린 선으로. 읽을 글은 없다 (aria-hidden). */
function Sketch({ id }: { id: SideId }) {
  const line = (w: number, lead = true) => (
    <span className="sk-row">
      {lead && <span className="sk-lead" />}
      <span className="sk-bar" style={{ width: `${w}%` }} />
    </span>
  );
  return (
    <span className="side-sketch" aria-hidden="true">
      {id === "pc" && (
        <>
          <span className="sk-tiles">
            <span />
            <span />
            <span />
          </span>
          {line(58)}
          {line(44)}
        </>
      )}
      {id === "favs" && (
        <>
          {line(62)}
          {line(48)}
        </>
      )}
      {id === "apps" && (
        <>
          {line(40)}
          {line(54)}
        </>
      )}
      {id === "links" && line(50)}
      {id === "tags" && (
        <span className="sk-dots">
          {Array.from({ length: 7 }, (_, k) => (
            <span key={k} />
          ))}
        </span>
      )}
      {id === "smart" && (
        <>
          {line(46)}
          {line(36)}
        </>
      )}
    </span>
  );
}

/** 사이드바 구획이 켜져 있나 — 즐겨찾기 · 연결 · 스마트 폴더는 제 설정, 나머지는 sideOff. */
function sideOn(v: ViewPrefs, id: SideId): boolean {
  if (id === "favs") return v.sideFavs;
  if (id === "links") return v.links;
  if (id === "smart") return v.recent;
  return !v.sideOff.includes(id);
}
function setSideOn(v: ViewPrefs, id: SideId, on: boolean): ViewPrefs {
  if (id === "favs") return { ...v, sideFavs: on };
  if (id === "links") return { ...v, links: on };
  if (id === "smart") return { ...v, recent: on };
  return { ...v, sideOff: on ? v.sideOff.filter((x) => x !== id) : [...v.sideOff, id] };
}
