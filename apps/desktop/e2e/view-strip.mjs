// 앱 안 보기 옆 파일 목록을 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/view-strip.mjs
//
// 보기를 열면 왼쪽에 이 폴더의 파일(폴더 빼고)이 서고 보기는 그 오른쪽으로 비킨다. 누르기 · ↑↓ 로 다른 파일을 바로 본다(볼 수 없는 꼴은 건너뛴다).
// 고치던 글은 옮기기 전에 저장된다. × 로 닫으면 설정에 남고 머리의 「목록」으로 다시 연다. 좁은 칸에서는 숨는다. 보기 동안 독 입술은 숨는다.
// 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const T = join(tmpdir(), `filedesk-strip-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(join(T, "하위폴더"), { recursive: true });
writeFileSync(join(T, "가_메모.txt"), "처음 글\n");
writeFileSync(join(T, "나_명단.csv"), "이름,값\r\n사과,1\r\n");
writeFileSync(join(T, "다_묶음.zip"), "PK");
writeFileSync(join(T, "라_노트.md"), "# 노트\n\n본문\n");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [{ name: "시험", path: T }] }));
const saved = () => JSON.parse(readFileSync(SETTINGS, "utf8")).view?.viewStrip;

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-strip-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});
let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const pane = page.locator("section.pane:not([hidden])").first();
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  check("폴더를 연다", await until(() => pane.locator(".row").count().then((c) => c >= 5), 10000));
  const strip = page.locator(".view-strip");
  const items = page.locator(".view-strip-item");
  const cur = () => page.locator(".view-strip-item.cur .view-strip-name").textContent();
  const viewerName = () => page.locator(".viewer-name").textContent();

  await row("가_메모").dblclick();
  check("보기를 열면 왼쪽에 파일 목록", await until(() => strip.isVisible(), 4000));
  const names = await page.locator(".view-strip-name").allTextContents();
  check("폴더는 빼고 파일만 (차례는 큰 목록과 같다)", names.join(",") === "가_메모.txt,나_명단.csv,다_묶음.zip,라_노트.md", names.join(","));
  const sb = await strip.boundingBox();
  const vb = await page.locator(".viewer").boundingBox();
  check("보기는 목록 오른쪽으로 비킨다", sb && vb && Math.abs(sb.x + sb.width - vb.x) < 2, sb && vb ? `목록 ${Math.round(sb.x)}+${Math.round(sb.width)} · 보기 ${Math.round(vb.x)}` : "");
  check("지금 보는 파일이 밝다", (await cur()) === "가_메모.txt");
  check("볼 수 없는 꼴은 흐리다", await page.locator(".view-strip-item.off", { hasText: "다_묶음" }).count() === 1);
  check("보기 동안 독 입술은 숨는다", await page.locator(".dock").evaluate((d) => getComputedStyle(d).visibility === "hidden"));

  // 글을 고치고 목록에서 다른 파일로 — 고친 것은 저장된다
  await page.locator(".viewer .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("더한 줄");
  await items.filter({ hasText: "나_명단" }).click();
  check("누르면 그 파일을 본다", await until(async () => (await viewerName()) === "나_명단.csv" && (await page.locator(".viewer-table table").count()) === 1, 4000), await viewerName());
  check("옮기기 전에 고친 글을 저장한다", await until(() => readFileSync(join(T, "가_메모.txt"), "utf8").includes("더한 줄"), 3000), JSON.stringify(readFileSync(join(T, "가_메모.txt"), "utf8")));
  check("큰 목록의 고른 줄도 따라간다", (await pane.locator(".row.selected .label").allTextContents()).join() === "나_명단.csv");

  // ↑↓ — 목록에 키가 남고, 볼 수 없는 꼴은 건너뛴다
  await page.locator(".view-strip-list").focus();
  await page.keyboard.press("ArrowDown");
  check("↓ 는 볼 수 없는 꼴을 건너뛰고 다음 파일", await until(async () => (await viewerName()) === "라_노트.md", 4000), await viewerName());
  await sleep(600);
  check("↓ 뒤에도 키는 목록에 남는다", await page.evaluate(() => !!document.activeElement?.closest(".view-strip")));
  await page.keyboard.press("ArrowUp");
  check("↑ 로 앞 파일", await until(async () => (await viewerName()) === "나_명단.csv", 4000), await viewerName());
  await page.keyboard.press("ArrowUp");
  check("↑ 로 맨 앞 파일", await until(async () => (await viewerName()) === "가_메모.txt", 4000), await viewerName());

  // 닫기 · 다시 열기 · 설정에 남는다
  await page.locator(".view-strip-x").click();
  check("× 로 목록을 닫는다", await until(() => strip.count().then((c) => c === 0), 2000));
  const vb2 = await page.locator(".viewer").boundingBox();
  check("닫으면 보기가 목록 자리까지 넓어진다", vb2 && vb && vb2.width > vb.width + 200, vb2 ? `${Math.round(vb.width)} → ${Math.round(vb2.width)}` : "");
  check("닫은 것은 설정에 남는다", await until(() => saved() === false, 3000), String(saved()));
  await page.locator(".viewer-strip-btn").click();
  check("머리의 「목록」으로 다시 연다", await until(() => strip.isVisible(), 2000));
  check("연 것도 설정에 남는다", await until(() => saved() === true, 3000), String(saved()));

  // Esc 로 보기를 닫으면 목록도 닫힌다
  await page.locator(".viewer .cm-content").click();
  await page.keyboard.press("Escape");
  check("Esc 로 보기와 목록이 함께 닫힌다", await until(async () => (await page.locator(".viewer").count()) === 0 && (await strip.count()) === 0, 3000));

  // 좁은 칸에서는 숨는다
  await row("가_메모").click();
  await page.keyboard.press("Control+\\");
  await until(() => page.locator("section.pane:not([hidden])").count().then((c) => c === 2), 4000);
  await row("가_메모").dblclick();
  await until(() => page.locator(".viewer").count(), 4000);
  const pw = await pane.evaluate((el) => el.clientWidth);
  check("좁은 칸(720px 아래)에서는 목록을 숨긴다", pw >= 720 || !(await strip.isVisible()), `칸 ${pw}px`);
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
