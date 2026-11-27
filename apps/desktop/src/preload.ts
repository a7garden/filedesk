// 미리 데우기 — 열 것 같은 보기의 코드를 사용자가 열기 전에 받아 둔다. 받아 둔 묶음은 열 때 다시 받지 않는다(같은 import 약속).
//
// 2026.11.26 : 사용자 요청 「반응 속도 · 항상 쾌적하게」. 보기 묶음을 나눠(Viewer · TextEditors · SlidesView · HwpView) 첫 화면은 가벼워졌지만,
//   나눈 만큼 처음 열 때 받는 틈이 생긴다. 그 틈을 사용자가 보기 전에 메운다.
//   - 앱이 켜진 뒤 한가할 때: 보기 틀 · 글 편집기 (가장 자주 연다)
//   - 목록에서 그 파일에 잠시 머물 때: 한글 엔진(28MB) · 파워포인트 그리기 — 크거나 드물어 켤 때 데우지 않는다
// 2026.11.27 : 미뤄 부르는 보기 부품(lazyNow)을 여기 모았다. 미리 받아 두기만으로는 모자랐다 — 아래 lazyNow 풀이.
import { createElement, lazy, useState, type ComponentProps, type ComponentType } from "react";
import type * as Editors from "./TextEditors";

/** 미뤄 부르는 부품 — 코드를 이미 받았으면 기다리지 않고 바로 그린다.
 *  2026.11.27 : React 의 lazy 는 코드가 이미 받아져 있어도 처음 그릴 때 한 번은 기다린다(Suspense). 그리고 React 19 는 기다린 내용을
 *    보일 때 앞서 모양 자리를 보인 때부터 300ms 를 채운 뒤에 보인다. 처음 여는 md 는 보기 틀 · 편집기 두 겹이라 미리 받아 두었는데도
 *    0.7초가 걸렸다 (다시 열면 0.03초). 받은 부품을 쥐고 있다가 그것을 바로 그려 이 기다림을 없앤다.
 *  어느 쪽으로 그릴지는 처음 설 때 정해 두고 바꾸지 않는다 — 도중에 바꾸면 부품이 새로 서며 고치던 글 · 굴린 자리를 잃는다. */
function lazyNow<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  type Mod = { default: ComponentType<P> };
  let ready: ComponentType<P> | null = null;
  let job: Promise<Mod> | null = null;
  /** 받는다 — 한 번만. 실패는 쥐지 않는다 (다음에 열 때 다시 받는다). */
  const preload = (): Promise<Mod> =>
    (job ??= load().then(
      (m: Mod) => ((ready = m.default), m),
      (e: unknown) => {
        job = null;
        throw e;
      },
    ));
  const Waiting = lazy(preload);
  function Now(props: P) {
    const [direct] = useState(() => ready);
    return direct ? createElement(direct, props) : createElement(Waiting, props);
  }
  return Object.assign(Now, { preload });
}

// 보기 부품 — Pane · Viewer 가 이것을 쓴다. Viewer.tsx 에 두지 않은 까닭: Pane 이 Viewer.tsx 를 가져오면 미뤄 부르던 보기 묶음이 첫 화면 묶음에 딸려 들어온다.
export const Viewer = lazyNow(() => import("./Viewer"));
export const MdEditor = lazyNow<ComponentProps<typeof Editors.MdEditor>>(() => import("./TextEditors").then((m) => ({ default: m.MdEditor })));
export const PlainEditor = lazyNow<ComponentProps<typeof Editors.PlainEditor>>(() => import("./TextEditors").then((m) => ({ default: m.PlainEditor })));
// 2026.11.26 : 파워포인트(jszip · pptx 그리기) · 한글 보기도 그 파일을 열 때만 불러온다 — 그림 · 글을 열 때 함께 읽을 까닭이 없다
export const SlidesView = lazyNow(() => import("./SlidesView"));
export const HwpView = lazyNow(() => import("./HwpView"));

/** 한가할 때 부른다 — 켜는 중인 화면 그리기 · 첫 폴더 읽기와 다투지 않게 조금 미룬 뒤 브라우저가 쉴 때. */
function whenIdle(run: () => void, delay: number) {
  window.setTimeout(() => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
    else run();
  }, delay);
}

let warmed = false;
/** 보기 틀과 글 편집기를 미리 받는다 — 앱이 켜진 뒤 한 번. */
export function warmViewers() {
  if (warmed) return;
  warmed = true;
  whenIdle(() => {
    void Viewer.preload()
      .then(() => whenIdle(() => void Promise.all([MdEditor.preload(), PlainEditor.preload()]).catch(() => {}), 0))
      .catch(() => {});
  }, 1500);
}

const fileWarm = new Set<string>();
/** 목록에서 머문 파일의 보기를 미리 데운다. 확장자마다 한 번. */
export function warmFor(ext: string) {
  const e = ext.toLowerCase();
  const k = e === "hwp" || e === "hwpx" ? "hwp" : e === "pptx" ? "pptx" : null;
  if (!k || fileWarm.has(k)) return;
  fileWarm.add(k);
  const job = k === "hwp" ? Promise.all([HwpView.preload(), import("./hwpEngine").then((m) => m.loadEngine())]) : SlidesView.preload();
  // 실패하면 다음에 다시 데울 수 있게 표시를 푼다 — 열 때는 보기가 스스로 다시 부른다
  job.catch(() => fileWarm.delete(k));
}
