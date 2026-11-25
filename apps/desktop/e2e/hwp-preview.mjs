// 한글(hwp · hwpx) 미리보기를 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/hwp-preview.mjs [한글 파일 …]
//
// 시험 파일은 rhwp 로 만든다(두 쪽 · 둘째 쪽 앞에 쪽 나눔). 같은 문서를 hwpx 와 옛 꼴 hwp 로 함께 낸다.
// 보는 것: 쪽이 그려진다 · 쪽 수 · 찾기(빈칸 무시 · 쪽을 건너) · 확대 · 스크립트 오류 없음. 인자로 실제 파일을 주면 그 파일이 오류 없이 그려지는지도 본다.
// 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9396;
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");
const REAL = process.argv.slice(2);

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

const T = join(tmpdir(), `filedesk-hwp-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
const base = join(import.meta.dirname, "..", "node_modules", "@rhwp", "core");
const rh = await import(pathToFileURL(join(base, "rhwp.js")).href);
rh.initSync({ module: readFileSync(join(base, "rhwp_bg.wasm")) });
const d = rh.HwpDocument.createEmpty();
d.createBlankDocument();
d.insertText(0, 0, 0, "첫 쪽 산림인접 시험");
d.insertPageBreak(0, 0, 11);
d.insertText(0, 1, 0, "둘째 쪽 산림 인접 끝");
writeFileSync(join(T, "문서.hwpx"), d.exportHwpx());
writeFileSync(join(T, "옛문서.hwp"), d.exportHwp());
REAL.forEach((f, i) => copyFileSync(f, join(T, `실제${i}${f.slice(f.lastIndexOf("."))}`)));

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-hwp-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});
let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const pane = page.locator("section.pane:not([hidden])");
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  check("폴더를 연다", await until(() => pane.locator(".row").count().then((c) => c >= 2), 10000));
  const frames = page.locator(".viewer .slide-frame");
  const close = async () => {
    await page.keyboard.press("Escape");
    await until(() => page.locator(".viewer").count().then((c) => c === 0), 3000);
  };
  // 그려진 쪽에 글자(<text>)가 있는가
  const glyphs = (i) => page.locator(".viewer .slide-host").nth(i).evaluate((h) => h.shadowRoot?.querySelectorAll("text").length ?? 0);

  // ── hwpx
  const t0 = Date.now();
  await row("문서").dblclick();
  check("hwpx: 두 쪽이 그려진다", await until(() => frames.count().then((c) => c === 2), 20000), `${await frames.count()}쪽 · ${Date.now() - t0}ms`);
  check("hwpx: 쪽에 글자가 있다", (await glyphs(0)) > 5 && (await glyphs(1)) > 5, `${await glyphs(0)} · ${await glyphs(1)}`);
  check("머리에 쪽 수", await until(async () => /1 \/ 2쪽/.test(await page.locator(".viewer").textContent()), 3000));
  const fb = await frames.first().boundingBox();
  check("A4 세로 비율", fb && Math.abs(fb.height / fb.width - 297 / 210) < 0.02, fb ? `${Math.round(fb.width)}×${Math.round(fb.height)}` : "");
  // 찾기 — 「산림 인접」(빈칸)도 「산림인접」과 맞는다 · 두 쪽에서
  await page.keyboard.press("Control+f");
  await page.locator(".viewer .table-find-q").fill("산림인접");
  check("찾기: 두 쪽에서 두 곳", await until(async () => (await page.locator(".viewer .table-find-count").textContent()).includes("2곳 · 2쪽"), 3000), await page.locator(".viewer .table-find-count").textContent());
  await page.keyboard.press("Enter");
  check("찾기: Enter 로 첫 곳", await until(async () => (await page.locator(".viewer .table-find-count").textContent()).startsWith("1 / 2"), 2000));
  await page.keyboard.press("Escape");
  // 확대
  const w0 = (await frames.first().boundingBox()).width;
  await page.locator(".viewer .slides-scroll").focus();
  await page.keyboard.press("Control+=");
  const w1 = await until(async () => {
    const w = (await frames.first().boundingBox()).width;
    return w > w0 * 1.05 ? w : null;
  }, 2000);
  check("확대하면 쪽이 커진다", w1 && Math.abs(w1 / w0 - 1.1) < 0.03, `${Math.round(w0)} → ${Math.round(w1 ?? 0)}`);
  await page.keyboard.press("Control+0");
  await page.screenshot({ path: join(tmpdir(), "filedesk-hwp.png") });
  await close();

  // ── 옛 꼴 hwp
  await row("옛문서").dblclick();
  check("hwp(옛 꼴): 두 쪽이 그려진다", await until(() => frames.count().then((c) => c === 2), 20000), `${await frames.count()}쪽`);
  check("hwp(옛 꼴): 쪽에 글자가 있다", (await glyphs(0)) > 5);
  await close();

  // ── 실제 파일 (인자)
  for (let i = 0; i < REAL.length; i++) {
    const t = Date.now();
    await row(`실제${i}`).dblclick();
    const ok = await until(async () => {
      const txt = await page.locator(".viewer").textContent();
      const m = /(\d+) \/ (\d+)쪽/.exec(txt);
      return m && !txt.includes("그리는 중") && (await frames.count()) === Number(m[2]) ? m[2] : null;
    }, 120000, 300);
    const warn = page.locator(".viewer .viewer-bar.warn");
    const bar = (await warn.count()) ? await warn.textContent() : "";
    check(`실제 파일 ${basename(REAL[i])}`, ok && !bar, `${ok ?? "?"}쪽 · ${Date.now() - t}ms${bar ? ` · ${bar}` : ""}`);
    await page.screenshot({ path: join(tmpdir(), `filedesk-hwp-real${i}.png`) });
    await close();
  }
  check("스크립트 오류 없음", errors.length === 0, errors.join(" | ").slice(0, 400));
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
