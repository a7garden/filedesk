// 업데이트 — GitHub 릴리즈의 latest.json 을 보고 새 판을 알린다 (docket 의 updater.ts 와 같은 틀).
//
//   켤 때 · 켜 둔 동안 한 시간마다 · 창으로 돌아왔을 때(마지막 확인이 10분 넘었으면) 조용히 본다. 실패하면 5분부터 늘려 다시 본다.
//   알리기만 하고 설치는 사용자가 고른다 — 설치기가 앱을 끄므로 열어 둔 탭 · 하던 일을 끊지 않게.
//   설치본(NSIS)이 아니면(`--no-bundle` exe) 바꿔 끼울 설치기가 없어 릴리즈 페이지를 연다.
//
// 상태는 모듈 하나에 두고 제목 줄 · 왼쪽 판 표시가 같은 것을 본다 — 따로 두면 한쪽에서 받는 중에 다른 쪽이 또 받는다.
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "error";

export type UpdateState = {
  phase: Phase;
  /** 새 판이 있을 때만. version · body(바뀐 내용) · date. */
  update: Update | null;
  /** 받은 바이트 / 전체. 서버가 크기를 안 주면 전체가 0. */
  progress: { done: number; total: number };
  error: string;
  checkedAt: number | null;
  installable: boolean;
  /** 손으로 누른 확인인가 — 「최신 판이다」 · 실패를 보일지 가른다. 자동 확인은 조용히. */
  manual: boolean;
  /** 손으로 누른 확인이 어디서 왔나 — 설정 카드에서 누른 것은 그 카드가 결과를 보이므로 제목 줄은 따라 띄우지 않는다. */
  from: "titlebar" | "settings";
  /** 「나중에」 — 새 판은 그대로 두고 제목 줄 알림만 접었다. 다음 자동 확인에서 다시 보인다. 설정 카드는 늘 보인다. */
  dismissed: boolean;
};

/** 릴리즈 페이지. 설치본이 아니면 여기서 받는다. */
export const RELEASES_URL = "https://github.com/a7garden/filedesk/releases/latest";

/** 2026.11.11 : 1시간 (docket 과 같다). 받는 것은 작은 latest.json 하나다. */
const CHECK_EVERY_MS = 60 * 60_000;
/** 때가 됐는지 보는 주기 — 절전에서 깨어난 뒤에도 늦어도 이만큼 안에 본다. */
const POLL_MS = 5 * 60_000;
/** 창으로 돌아왔을 때 마지막 확인이 이보다 오래됐으면 다시 본다. */
const FOCUS_CHECK_MS = 10 * 60_000;

let state: UpdateState = {
  phase: "idle",
  update: null,
  progress: { done: 0, total: 0 },
  error: "",
  checkedAt: null,
  installable: false,
  manual: false,
  from: "titlebar",
  dismissed: false,
};
let nextAt = 0;
let fails = 0;
const subs = new Set<() => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

/** 실패 뒤 다음 확인까지 — 연달아 n 번째면 5 · 10 · 20 · 40 · 60분. 켤 때 VPN 이 아직 안 붙은 경우가 있어 한 시간을 기다리지 않는다. */
const retryAfterMs = (n: number) => Math.min(5 * 2 ** (Math.max(n, 1) - 1), 60) * 60_000;

/** 새 판 확인. `manual` 이면 확인 중 · 최신 · 실패를 화면에 보이고, 아니면 실패해도 조용히 넘어간다. */
export async function checkUpdate(manual: boolean, from: UpdateState["from"] = "titlebar"): Promise<void> {
  if (state.phase === "checking" || state.phase === "downloading") return;
  // 자동 확인이 이미 받아 둔 새 판을 다시 묻느라 지우지 않는다 — 사용자가 보던 판과 다른 판이 깔리지 않게. 접어 둔 알림만 다시 편다.
  if (!manual && state.phase === "available") return set({ dismissed: false });
  if (manual) set({ phase: "checking", error: "", manual: true, from });
  try {
    const update = await check();
    fails = 0;
    nextAt = Date.now() + CHECK_EVERY_MS;
    set({ phase: update ? "available" : manual ? "latest" : "idle", update, error: "", checkedAt: Date.now(), manual, dismissed: false });
  } catch (e) {
    fails += 1;
    nextAt = Date.now() + retryAfterMs(fails);
    console.warn("업데이트 확인 실패", e);
    if (manual) set({ phase: "error", error: String(e), checkedAt: Date.now(), manual });
    else set({ checkedAt: Date.now() });
  }
}

/** 받아서 설치한다. Windows 는 설치기가 앱을 끄고 새 판을 다시 켠다. */
export async function installUpdate(): Promise<void> {
  const { update, phase } = state;
  if (!update || phase === "downloading") return;
  set({ phase: "downloading", progress: { done: 0, total: 0 }, error: "" });
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") set({ progress: { done: 0, total: ev.data.contentLength ?? 0 } });
      else if (ev.event === "Progress") set({ progress: { ...state.progress, done: state.progress.done + ev.data.chunkLength } });
    });
    await relaunch(); // Windows 에서는 여기까지 오지 않는다 (설치기가 먼저 끈다)
  } catch (e) {
    set({ phase: "error", error: String(e), manual: true });
  }
}

/** 제목 줄 알림을 접는다 (「나중에」). 새 판은 그대로 — 설정 「업데이트」에서 언제든 설치하고, 다음 자동 확인에서 알림이 다시 선다. */
export function dismissUpdate() {
  set({ dismissed: true, manual: false });
}

/** 손으로 확인한 결과(최신 · 실패)를 거둔다 — 제목 줄의 잠깐 알림이 사라질 때. */
export function clearCheckResult() {
  if (state.phase === "latest" || state.phase === "error") set({ phase: "idle", manual: false });
}

export function openReleases() {
  invoke("open_url", { url: RELEASES_URL }).catch(() => {});
}

/** 앱 틀에서 한 번 부른다 — 설치본인지 묻고, 배포판이면 자동 확인을 돌린다. */
export function useAutoUpdate() {
  useEffect(() => {
    invoke<boolean>("update_installable")
      .then((installable) => set({ installable }))
      .catch(() => {});
    // 개발 판은 버전이 늘 같아 묻는 것이 소음이다. 손으로 누르는 확인은 개발 판에서도 된다.
    if (import.meta.env.DEV) return;
    let lastTry = 0;
    const run = () => {
      lastTry = Date.now();
      void checkUpdate(false);
    };
    const tick = () => {
      if (Date.now() >= nextAt) run();
    };
    const onVisible = () => {
      const last = Math.max(lastTry, state.checkedAt ?? 0);
      if (document.visibilityState === "visible" && Date.now() - last > FOCUS_CHECK_MS) run();
    };
    tick();
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
