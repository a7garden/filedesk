// 한글 읽기 엔진(rhwp · WASM 28MB) 불러오기 — HwpView 가 쓰고, 목록이 미리 데운다.
//
// 2026.11.26 : HwpView.tsx [1] 에서 떼어 왔다. 처음 한글 파일을 열 때 엔진 내려받기 · 해석에 1초 남짓 빈 화면이었다.
//   목록에서 한글 파일에 잠시 머물면(Pane) 여기를 불러 엔진을 미리 데운다 — 보기 부품(HwpView)까지 읽지 않으려고 따로 둔다.
//   앱을 켤 때 데우지는 않는다: 한글 파일을 열지 않는 날에도 28MB 를 메모리에 올리게 된다.

export type Rhwp = typeof import("@rhwp/core");

let engine: Promise<Rhwp> | null = null;
let ready = false;

/** 엔진을 불러온다 — 한 번만. 실패는 붙잡아 두지 않는다 (다음에 열 때 다시 시도한다). */
export function loadEngine(): Promise<Rhwp> {
  engine ??= Promise.all([import("@rhwp/core"), import("@rhwp/core/rhwp_bg.wasm?url")])
    .then(async ([m, url]) => {
      await m.default({ module_or_path: url.default });
      ready = true;
      return m;
    })
    .catch((e) => {
      engine = null;
      throw e;
    });
  return engine;
}

/** 엔진이 이미 올라왔는가 — 처음 여는 것이면 「엔진을 불러오는 중」을 함께 알린다. */
export const engineReady = () => ready;
