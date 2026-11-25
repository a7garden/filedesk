// 0.1.17 에서 고친 것을 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/features-0117.mjs
//
// 같은 폴더에서 Ctrl+C · Ctrl+V 하면 탐색기처럼 사본 이름으로 붙는다 (전에는 같은 이름이 있다며 거절했다) · Ctrl+Z 로 사본이 빠진다.
// 시험용 임시 폴더에서만 파일을 만들고 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9395;
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
const T = join(tmpdir(), `filedesk-f17-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
writeFileSync(join(T, "보고서.txt"), "x");
writeFileSync(join(T, "자료.txt"), "y");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-f17-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});

let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const pane = page.locator("section.pane:not([hidden])");
  const rowNames = () => pane.locator(".row .label").allTextContents();
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  check("폴더를 연다", await until(async () => (await rowNames()).length >= 2, 10000));
  const files = () => readdirSync(T).sort();

  // 1. 한 파일
  await row("보고서").click();
  await page.keyboard.press("Control+c");
  await sleep(300);
  await page.keyboard.press("Control+v");
  const one = await until(() => (files().length === 3 ? files() : null), 8000);
  check("같은 폴더 붙여넣기는 사본 이름으로 붙는다", one?.some((n) => n.startsWith("보고서 - ")), (one ?? files()).join(", "));
  check("사본이 목록에 나타난다", await until(async () => (await rowNames()).some((n) => n.startsWith("보고서 - ")), 5000));
  // 2. 한 번 더 붙이면 번호가 붙는다
  await page.keyboard.press("Control+v");
  const two = await until(() => (files().length === 4 ? files() : null), 8000);
  check("다시 붙이면 다른 사본 이름", two?.filter((n) => n.startsWith("보고서 - ")).length === 2, (two ?? files()).join(", "));
  // 3. 되돌리기
  await page.keyboard.press("Control+z");
  check("Ctrl+Z 로 마지막 사본이 빠진다", await until(() => files().length === 3, 8000), files().join(", "));

  check("스크립트 오류 없음", errors.length === 0, errors.join(" | "));
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
