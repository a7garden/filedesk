// 앱 안 보기의 확대 · 축소와 크게 보기를 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/viewer-zoom.mjs [캡처 폴더]
//
// 칸을 둘로 나눈 채 한 칸에서 보기를 열고: F11 · 「크게 보기」로 그 보기만 왼쪽 열 오른쪽 전체를 덮는다 · Esc 는 먼저 크게 보기를 푼다.
// 확대: Ctrl+= · Ctrl+- · Ctrl+0 · Ctrl+휠이 글(글자 크기) · 표(칸) · 그림(크기) · 파워포인트(쪽 크기)에 듣는다.
// 시험 파일은 python-pptx 로 만든다. 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9399;
const SHOTS = process.argv[2] || join(tmpdir(), "filedesk-shots");
mkdirSync(SHOTS, { recursive: true });
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

const T = join(tmpdir(), `filedesk-zoom-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
writeFileSync(join(T, "메모.txt"), "확대 시험 글\n두 번째 줄\n");
writeFileSync(join(T, "명단.csv"), "이름,값\r\n사과,1\r\n배,2\r\n");
// 400×300 빨간 PNG — 맞춤에서 확대하면 커진다
const MAKE = join(T, "_make.py");
writeFileSync(
  MAKE,
  `
import sys, zlib, struct
from pptx import Presentation
d = sys.argv[1]
p = Presentation()
s = p.slides.add_slide(p.slide_layouts[0])
s.shapes.title.text = "확대 시험"
p.save(d + "/쪽.pptx")
w, h = 400, 300
raw = b"".join(b"\\x00" + b"\\xff\\x00\\x00" * w for _ in range(h))
def chunk(t, b): return struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xffffffff)
png = b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(d + "/그림.png", "wb").write(png)
`,
);
execFileSync("python", ["-X", "utf8", MAKE, T]);
rmSync(MAKE);

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-zoom-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});

let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const rowNames = () => page.locator("section.pane:not([hidden]) .row .label").allTextContents();
  check("폴더를 연다", await until(async () => (await rowNames()).length >= 3, 10000));
  // 칸을 둘로 나눈다
  await page.locator("section.pane:not([hidden]) .row").first().click();
  await page.keyboard.press("Control+\\");
  check("칸을 둘로 나눈다", await until(() => page.locator("section.pane:not([hidden])").count().then((c) => c === 2), 4000), String(await page.locator("section.pane:not([hidden])").count()));
  const pane = page.locator("section.pane:not([hidden])").first();
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  const viewer = page.locator(".viewer");
  const win = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));

  // ── 크게 보기 (글 파일)
  await row("메모").dblclick();
  await until(() => page.locator(".viewer .cm-content").count(), 5000);
  const inPane = await viewer.boundingBox();
  check("나눈 칸 안에서는 칸 너비", inPane && inPane.width < win.w * 0.6, inPane ? `${Math.round(inPane.width)} / ${win.w}` : "");
  await page.keyboard.press("F11");
  const big = await until(async () => {
    const b = await viewer.boundingBox();
    return b && b.width > win.w * 0.7 ? b : null;
  }, 3000);
  check("F11 로 그 보기만 크게 (왼쪽 열 오른쪽 전체)", big && Math.abs(big.x + big.width - win.w) < 2 && big.y >= 30, big ? `${Math.round(big.x)},${Math.round(big.y)} ${Math.round(big.width)}×${Math.round(big.height)}` : "");
  check("크게 보기 단추가 눌린 상태", (await page.locator(".viewer-act[aria-pressed=true]").count()) === 1);
  await page.screenshot({ path: join(SHOTS, "zoom-max.png") });
  await page.keyboard.press("Escape");
  check("Esc 첫 번은 크게 보기만 푼다", await until(async () => (await viewer.count()) === 1 && (await viewer.boundingBox()).width < win.w * 0.6, 3000));
  await page.locator(".viewer-act", { hasText: "크게 보기" }).click();
  check("「크게 보기」 단추로도", await until(async () => (await viewer.boundingBox()).width > win.w * 0.7, 3000));
  await page.locator(".viewer-act", { hasText: "칸으로" }).click();

  // ── 확대: 글
  const fontOf = (sel) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const f0 = await fontOf(".viewer .cm-scroller");
  await page.locator(".viewer .cm-content").click();
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  const f1 = await fontOf(".viewer .cm-scroller");
  check("글: Ctrl+= 두 번이면 글자가 커진다 (110% → 125%)", Math.abs(f1 / f0 - 1.25) < 0.02, `${f0} → ${f1}`);
  check("머리에 배율", (await page.locator(".viewer-zoom-pct").textContent()) === "125%", await page.locator(".viewer-zoom-pct").textContent());
  await page.keyboard.press("Control+0");
  check("글: Ctrl+0 은 원래 배율", Math.abs((await fontOf(".viewer .cm-scroller")) - f0) < 0.1);
  await page.locator(".viewer .cm-content").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  check("글: Ctrl+휠 아래로 축소", await until(async () => (await page.locator(".viewer-zoom-pct").textContent()) === "90%", 2000), await page.locator(".viewer-zoom-pct").textContent());
  check("글: Ctrl+= 가 글에 쓰이지 않았다", readFileSync(join(T, "메모.txt"), "utf8") === "확대 시험 글\n두 번째 줄\n");
  await page.keyboard.press("Control+0");
  await page.keyboard.press("Escape");
  await until(() => viewer.count().then((c) => c === 0), 3000);

  // ── 확대: 표 (Ctrl+= 는 확대 · 줄 더하기는 Ctrl+Shift+=)
  await row("명단").dblclick();
  await until(() => page.locator(".viewer-table table").count(), 5000);
  const t0 = await fontOf(".viewer-table table");
  await page.locator(".viewer-table [data-r='1'][data-c='0']").click();
  await page.keyboard.press("Control+=");
  const t1 = await fontOf(".viewer-table table");
  check("표: Ctrl+= 는 확대 (줄을 더하지 않는다)", t1 > t0 && readFileSync(join(T, "명단.csv"), "utf8") === "이름,값\r\n사과,1\r\n배,2\r\n", `${t0} → ${t1}`);
  await page.keyboard.press("Control+0");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await until(() => viewer.count().then((c) => c === 0), 3000);

  // ── 확대: 그림 (맞춤에서 키운다)
  await row("그림").dblclick();
  const img = page.locator(".image-stage img");
  await until(() => img.evaluate((i) => i.complete && i.naturalWidth > 0), 5000);
  const i0 = (await img.boundingBox()).width;
  await page.keyboard.press("Control+=");
  await page.keyboard.press("Control+=");
  const i1 = await until(async () => {
    const w = (await img.boundingBox()).width;
    return w > i0 * 1.2 ? w : null;
  }, 2000);
  check("그림: 맞춤 크기에서 키운다", i1 && Math.abs(i1 / i0 - 1.25) < 0.05, `${Math.round(i0)} → ${Math.round(i1 ?? 0)}`);
  await page.keyboard.press("Control+0");
  await page.keyboard.press("Escape");
  await until(() => viewer.count().then((c) => c === 0), 3000);

  // ── 확대: 파워포인트
  await row("쪽").dblclick();
  const frame = page.locator(".slide-frame").first();
  await until(() => frame.count(), 10000);
  const s0 = (await frame.boundingBox()).width;
  await page.keyboard.press("F11");
  await sleep(300);
  const s1 = (await frame.boundingBox()).width;
  check("파워포인트: 크게 보기면 쪽도 커진다", s1 > s0 * 1.3, `${Math.round(s0)} → ${Math.round(s1)}`);
  await page.keyboard.press("Control+-");
  const s2 = await until(async () => {
    const w = (await frame.boundingBox()).width;
    return w < s1 * 0.95 ? w : null;
  }, 2000);
  check("파워포인트: Ctrl+- 로 쪽이 작아진다", s2 && Math.abs(s2 / s1 - 0.9) < 0.03, `${Math.round(s1)} → ${Math.round(s2 ?? 0)}`);
  await page.screenshot({ path: join(SHOTS, "zoom-slides.png") });

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
