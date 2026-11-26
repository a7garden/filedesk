// 미리 데우기 — 열 것 같은 보기의 코드를 사용자가 열기 전에 받아 둔다. 받아 둔 묶음은 열 때 다시 받지 않는다(같은 import 약속).
//
// 2026.11.26 : 사용자 요청 「반응 속도 · 항상 쾌적하게」. 보기 묶음을 나눠(Viewer · TextEditors · SlidesView · HwpView) 첫 화면은 가벼워졌지만,
//   나눈 만큼 처음 열 때 받는 틈이 생긴다. 그 틈을 사용자가 보기 전에 메운다.
//   - 앱이 켜진 뒤 한가할 때: 보기 틀 · 글 편집기 (가장 자주 연다)
//   - 목록에서 그 파일에 잠시 머물 때: 한글 엔진(28MB) · 파워포인트 그리기 — 크거나 드물어 켤 때 데우지 않는다

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
    void import("./Viewer")
      .then(() => whenIdle(() => void import("./TextEditors").catch(() => {}), 0))
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
  const job =
    k === "hwp"
      ? Promise.all([import("./HwpView"), import("./hwpEngine").then((m) => m.loadEngine())])
      : import("./SlidesView");
  // 실패하면 다음에 다시 데울 수 있게 표시를 푼다 — 열 때는 보기가 스스로 다시 부른다
  job.catch(() => fileWarm.delete(k));
}
