// 큰 폴더 성능 — 배포판 exe 로 파일 수만 개짜리 폴더를 열어 첫 줄이 그려지기까지 · 끝까지 내리기 · 정렬 시간을 잰다.
//
//   node e2e/perf.mjs [파일 수=20000]
//
// 시험용 임시 폴더에만 빈 파일을 만든다. 앱 설정은 smoke.mjs 처럼 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9334;
const N = Number(process.argv[2] ?? 20000);
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 판이 섞인 문서 이름 — 문서 묶기 · 판 눈금까지 다 일하게 한다.
const T = join(tmpdir(), `filedesk-perf-${N}`);
if (!existsSync(join(T, "이전판"))) {
  mkdirSync(join(T, "이전판"), { recursive: true });
  for (let i = 0; i < N; i++) writeFileSync(join(T, `보고서${i % (N / 10)}_v${Math.floor(i / (N / 10))}_2026${String((i % 12) + 1).padStart(2, "0")}01.hwpx`), "");
  for (let i = 0; i < N / 10; i++) writeFileSync(join(T, "이전판", `보고서${i}_v0_20260101.hwpx`), "");
}
const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const launched = Date.now();
// WebView2 데이터 폴더를 따로 둔다 — 켜 둔 filedesk 와 겹치면 디버깅 포트가 열리지 않는다 (smoke.mjs 와 같다).
const app = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-e2e-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 150 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await sleep(200);
    }
  }
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => document.querySelectorAll(".row").length > 10 && document.body.innerText.includes("보고서"), null, { timeout: 60000 });
  const first = Date.now() - launched; // 앱 켜기부터 — 창 · WebView 준비가 함께 든다
  await sleep(1500); // 문서 묶기 · 메모가 뒤따라 들어온다
  const s0 = Date.now();
  await page.locator(".list").click({ position: { x: 300, y: 200 } });
  await page.keyboard.press("End");
  await sleep(50);
  const endMs = Date.now() - s0;
  const frames = await page.evaluate(async () => {
    const sc = document.querySelector(".list");
    if (!sc) return null;
    let n = 0, worst = 0, last = performance.now();
    sc.scrollTop = 0;
    await new Promise((done) => {
      const step = () => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
        sc.scrollTop += 400;
        if (++n < 120) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return { n, worst: Math.round(worst) };
  });
  const mem = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  console.log(JSON.stringify({ files: N, firstRowsMs: first, endKeyMs: endMs, scroll120Frames: frames, jsHeapMB: mem, rowsInDom: await page.locator(".row").count() }));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  if (backup) writeFileSync(SETTINGS, backup);
  else rmSync(SETTINGS, { force: true });
}
