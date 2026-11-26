// 열 너비 끌기를 실제 앱(배포판 exe)에서 본다 — 좁은 칸(나눠 보기)과 넓은 칸.
//
//   node e2e/col-resize.mjs
//
// 2026.11.26 : 사용자 지적 「칸을 나눠 열 내용이 생략되면 늘릴 수도 줄일 수도 없다」.
// 좁은 칸에도 손잡이가 서고, 끌면 좁은 칸 너비(colsNarrow)만 바뀌고 넓은 칸 너비(cols)는 그대로인지,
// 끌기가 화면에 보이는 너비에서 시작하는지(처음 끄는 만큼 헛돌지 않는지), 넓혀도 이름 열이 최소 너비 밑으로 밀리지 않는지 본다.
// 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9397;
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

const T = join(tmpdir(), `filedesk-cols-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
for (const n of ["사업계획서_v3_20261120_검토의견_반영본_최종.hwpx", "예산표.xlsx", "회의록.md"]) writeFileSync(join(T, n), "x");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T, T], active: 0 }, split: { right: 1, ratio: 0.5 }, view: { hiddenCols: ["kind"] } }));
const saved = () => JSON.parse(readFileSync(SETTINGS, "utf8"));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-cols-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});
let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  check("두 칸으로 나뉜다", await until(() => page.locator(".pane:visible").count().then((c) => c === 2), 10000));
  const pane = page.locator(".pane:visible").first();
  await until(() => pane.locator(".row").count().then((c) => c >= 3), 5000);
  const width = (i) => pane.locator(`.cols > .col-${i}`).evaluate((el) => Math.round(el.getBoundingClientRect().width));
  /** 손잡이를 dx 만큼 끈다 — 손잡이는 열의 왼쪽 경계라 오른쪽(+)으로 끌면 좁아진다. */
  const drag = async (i, dx) => {
    const b = await pane.locator(`.cols > .col-${i} > .resizer`).boundingBox();
    if (!b) return false;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
    await sleep(150);
    return true;
  };

  const paneW = await pane.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  check("칸이 좁은 칸 너비를 쓴다", paneW <= 680, `${paneW}px`);
  const d0 = await width(2);
  check("좁은 칸 수정일은 기본 96", d0 === 96, `${d0}px`);
  check("좁은 칸에도 손잡이가 선다", await drag(2, 30));
  const d1 = await width(2);
  check("오른쪽으로 끌면 바로 좁아진다", d1 === d0 - 30, `${d0} → ${d1}`);
  await drag(2, -60);
  const d2 = await width(2);
  check("왼쪽으로 끌면 넓어진다", d2 === d1 + 60, `${d1} → ${d2}`);
  const s1 = await until(() => {
    const s = saved();
    return s.colsNarrow?.[2] === d2 && s;
  }, 3000);
  check("좁은 칸 너비가 설정에 남는다", !!s1, JSON.stringify(saved().colsNarrow));
  check("넓은 칸 너비는 그대로", saved().cols?.[2] === 140, JSON.stringify(saved().cols));
  const s0 = await width(3);
  await drag(3, 20);
  check("크기 열도 끈다", (await width(3)) === s0 - 20, `${s0} → ${await width(3)}`);

  // 아주 넓혀도 이름 열은 120 아래로 밀리지 않는다 — 오른쪽 열이 칸 밖으로 잘리지 않게
  await drag(2, -1000);
  const n = await width(0);
  check("넓혀도 이름 열은 최소 너비를 지킨다", n >= 119, `이름 ${n}px · 수정일 ${await width(2)}px`);
  const over = await pane.locator(".cols").evaluate((el) => el.scrollWidth - el.clientWidth);
  check("머리가 칸 밖으로 넘치지 않는다", over <= 1, `${over}px`);

  // 두 번 누르면 좁은 칸 기본값
  await pane.locator(".cols > .col-2 > .resizer").dblclick();
  check("두 번 누르면 좁은 칸 처음대로", await until(async () => (await width(2)) === 96, 1000), `${await width(2)}px`);

  // 나눠 보기를 끄면 넓은 칸 — 넓은 칸 너비 그대로이고 거기서도 끈다
  await page.keyboard.press("Control+\\");
  check("한 칸으로 돌아온다", await until(() => page.locator(".pane:visible").count().then((c) => c === 1), 3000));
  check("넓은 칸 수정일은 설정 너비 140", await until(async () => (await width(2)) === 140, 2000), `${await width(2)}px`);
  await drag(2, -40);
  check("넓은 칸에서도 끈다", (await width(2)) === 180, `${await width(2)}px`);
  check("넓은 칸 너비만 바뀐다", await until(() => saved().cols?.[2] === 180 && saved().colsNarrow?.[2] === 96, 3000), JSON.stringify([saved().cols, saved().colsNarrow]));

  check("스크립트 오류 없음", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("시험이 끝까지 돈다", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  if (backup) writeFileSync(SETTINGS, backup);
  else rmSync(SETTINGS, { force: true });
  rmSync(T, { recursive: true, force: true });
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과`);
  process.exit(bad.length ? 1 : 0);
}
