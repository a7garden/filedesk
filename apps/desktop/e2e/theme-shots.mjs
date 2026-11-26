// 디자인 점검용 캡처 — 주요 화면을 밝게 · 어둡게로 한 장씩 찍는다. 판정은 사람이 본다.
//
//   node e2e/theme-shots.mjs [캡처 폴더]
//
// 찍는 화면: 목록 · 격자 · 오른쪽 메뉴 · 팔레트 · 설정 · 사이드바 편집 (타일 편집 판 포함) · 글 보기.
// 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9396;
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");
const SHOTS = process.argv[2] ?? join(tmpdir(), "filedesk-theme-shots");
mkdirSync(SHOTS, { recursive: true });

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

const T = join(tmpdir(), `filedesk-theme-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(join(T, "보고서 모음"), { recursive: true });
mkdirSync(join(T, "사진"), { recursive: true });
for (const [n, body] of [
  ["사업계획서_v3_20261120.hwpx", "x"],
  ["예산표_최종.xlsx", "x"],
  ["회의록 2026-11-24.md", "# 회의록\n\n- 위젯 편집\n- **타일** 이름 바꾸기\n\n> 다음 주에 다시 본다\n"],
  ["발표자료.pptx", "x"],
  ["설치 안내.txt", "설치 파일을 누른다.\n"],
  ["로고.png", "x"],
]) writeFileSync(join(T, n), body);

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });

async function run(theme) {
  writeFileSync(SETTINGS, JSON.stringify({ theme, session: { tabs: [T], active: 0 }, pinned: [{ name: "보고서 모음", path: join(T, "보고서 모음") }], view: { links: true } }));
  const app = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-theme-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });
  let browser;
  try {
    browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
    const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
    const pane = page.locator("section.pane:not([hidden])").first();
    await until(() => pane.locator(".row").count().then((c) => c >= 8), 10000);
    await sleep(800);
    const shot = (name) => page.screenshot({ path: join(SHOTS, `${theme}-${name}.png`) });
    await pane.locator(".row").nth(2).click();
    await shot("1-목록");
    await pane.locator(".row").nth(3).click({ button: "right" });
    await until(() => page.locator(".ctx-menu").isVisible(), 2000);
    await shot("2-메뉴");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await sleep(500);
    await shot("3-팔레트");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,");
    await sleep(600);
    await shot("4-설정");
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.locator("nav.side .known-tile").first().click({ button: "right" });
    await page.locator(".ctx-menu [role=menuitem]", { hasText: "이름 · 그림 편집" }).click();
    await sleep(400);
    await shot("5-사이드바-편집");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await pane.locator(".row", { hasText: "회의록" }).dblclick();
    await sleep(1200);
    await shot("6-글-보기");
  } finally {
    await browser?.close().catch(() => {});
    app.kill();
    await sleep(800);
  }
}

try {
  await run("light");
  await run("dark");
  console.log(`캡처: ${SHOTS}`);
} finally {
  if (backup) writeFileSync(SETTINGS, backup);
  else rmSync(SETTINGS, { force: true });
  rmSync(T, { recursive: true, force: true });
}
