// 탭으로 열어 둔 폴더를 다른 앱이 옮기거나 이름을 바꿀 수 있는지 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/watch-lock.mjs
//
// 2026.11.25 : 폴더 감시가 탭 폴더와 그 `이전판/` 마다 핸들을 열어, 이전판이 있는 탭 폴더 · 탭의 위 폴더 전부가
// 「사용 중」으로 이름을 못 바꿨다. 감시를 드라이브 뿌리 하나로 옮긴 뒤에도 앱 밖 변경을 따라오는지 함께 본다.
// 시험용 임시 폴더에서만 파일을 만들고 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9394;
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
/** 이름 바꾸기를 해 보고 되돌린다. 실패하면 오류 코드를 돌려준다. */
function tryRename(from, to) {
  try {
    renameSync(from, to);
    renameSync(to, from);
    return "";
  } catch (e) {
    return e.code ?? String(e);
  }
}

const T = join(tmpdir(), `filedesk-lock-${process.pid}`);
const TAB = join(T, "탭");
rmSync(T, { recursive: true, force: true });
mkdirSync(join(TAB, "이전판"), { recursive: true });
writeFileSync(join(TAB, "보고서_v2.txt"), "x");
writeFileSync(join(TAB, "이전판", "보고서_v1.txt"), "x");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [TAB], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-lock-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
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
  check("탭 폴더를 연다", await until(async () => (await rowNames()).some((n) => n.includes("보고서")), 10000));
  await sleep(1000); // 감시가 걸릴 때까지

  // 1. 앱 밖에서 파일을 만들면 따라온다
  writeFileSync(join(TAB, "새파일.txt"), "x");
  check("앱 밖에서 만든 파일이 목록에 나타난다", await until(async () => (await rowNames()).some((n) => n.includes("새파일")), 5000));

  // 2. 잠기지 않는다
  const parentErr = tryRename(T, `${T}-바꿈`);
  check("탭의 위 폴더 이름을 바꿀 수 있다", parentErr === "", parentErr);
  await sleep(500);
  const tabErr = tryRename(TAB, `${TAB}-바꿈`);
  check("이전판이 있는 탭 폴더 이름을 바꿀 수 있다", tabErr === "", tabErr);
  await sleep(500);

  // 3. 되돌린 뒤에도 계속 따라온다
  await until(async () => (await rowNames()).some((n) => n.includes("보고서")), 5000);
  await sleep(800);
  writeFileSync(join(TAB, "또새파일.txt"), "x");
  check("이름을 되돌린 뒤에도 앱 밖 변경을 따라온다", await until(async () => (await rowNames()).some((n) => n.includes("또새파일")), 5000));

  check("스크립트 오류 없음", errors.length === 0, errors.join(" | "));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(800);
  if (backup) writeFileSync(SETTINGS, backup);
  rmSync(T, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
