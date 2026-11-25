// 목록 정렬이 앱 전체에 남는지 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/sort-sticky.mjs
//
// 열 머리로 고른 정렬이 다른 탭 · 새 탭 · 다시 켠 앱에 그대로 가는지, 「새 파일」 모아 보기가 잠깐 바꾼 정렬이 설정에 남지 않는지 본다.
// 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9398;
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "통과" : "실패"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return null;
    await sleep(step);
  }
}

const T = join(tmpdir(), `filedesk-sort-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
// 이름 순과 고친 날 순이 거꾸로 서게: 가가 가 가장 오래되었다
for (const [n, age] of [["가.txt", 3], ["나.txt", 2], ["다.txt", 1]]) {
  writeFileSync(join(T, n), n);
  const t = new Date(Date.now() - age * 86400000);
  utimesSync(join(T, n), t, t);
}

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T, T], active: 0 }, pinned: [] }));
const saved = () => JSON.parse(readFileSync(SETTINGS, "utf8")).view?.sort;

const launch = () =>
  spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-sort-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });
async function attach() {
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  return { browser, page };
}
const names = (page) => page.locator("section.pane:not([hidden]) .row .label").allTextContents();
const order = async (page) => (await until(async () => ((await names(page)).length >= 3 ? names(page) : null), 10000)).filter((n) => /^[가나다]/.test(n)).join(",");

let app = launch();
let browser;
try {
  let page;
  ({ browser, page } = await attach());
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  check("처음은 이름 순", (await order(page)) === "가.txt,나.txt,다.txt", await order(page));
  // 수정일 머리를 처음 누르면 최신순이다
  const dateHead = page.locator("section.pane:not([hidden]) .col-btn", { hasText: "수정" }).first();
  await dateHead.click();
  check("열 머리로 최신순", await until(async () => (await order(page)) === "다.txt,나.txt,가.txt", 3000), await order(page));
  check("설정에 남는다", await until(() => saved()?.key === "modified" && saved()?.asc === false, 3000), JSON.stringify(saved()));
  // 다른 탭으로
  await page.keyboard.press("Control+Tab");
  check("다른 탭도 따라간다", await until(async () => (await order(page)) === "다.txt,나.txt,가.txt", 3000), await order(page));
  check("스크립트 오류 없음", errors.length === 0, errors.join(" | "));
  await browser.close().catch(() => {});
  app.kill();
  await sleep(1500);

  // 다시 켠다
  app = launch();
  ({ browser, page } = await attach());
  check("다시 켜도 최신순", await until(async () => (await order(page)) === "다.txt,나.txt,가.txt", 10000), await order(page));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(800);
  if (backup) writeFileSync(SETTINGS, backup);
  rmSync(T, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`
${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
