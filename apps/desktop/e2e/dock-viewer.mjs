// 앱 안 보기 위에서 즐겨찾기 독이 올라오지 않는지 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/dock-viewer.mjs
//
// 엑셀 보기는 시트 탭이 칸 바닥 줄(독이 여는 자리)에 놓인다. 그 위를 오가도 독이 열리지 않고, 보기를 닫으면 다시 열린다.
// 시험 파일은 openpyxl 로 만든다. 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { execFileSync, spawn } from "node:child_process";
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

const T = join(tmpdir(), `filedesk-dock-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
const MAKE = join(T, "_make.py");
writeFileSync(MAKE, `
import sys
from openpyxl import Workbook
w = Workbook()
w.active.title = "첫째"
w.active["A1"] = "값"
w.create_sheet("둘째")
w.save(sys.argv[1] + "/표.xlsx")
`);
execFileSync("python", ["-X", "utf8", MAKE, T]);
rmSync(MAKE);
writeFileSync(join(T, "메모.txt"), "글");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [{ name: "시험 폴더", path: T }] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-dock-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});
let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const rows = () => page.locator("section.pane:not([hidden]) .row .label").allTextContents();
  check("폴더를 연다", await until(async () => (await rows()).length >= 2, 10000));
  const dock = page.locator(".dock");
  const box = await dock.boundingBox();
  // 독 넓이 안 바닥 줄을 왼쪽에서 오른쪽으로 훑는다 — 단추 사이 빈 곳도 지나간다
  const sweep = async () => {
    let opened = false;
    for (let i = 1; i < 20; i++) {
      await page.mouse.move(box.x + (box.width * i) / 20, box.y + box.height / 2);
      await sleep(40);
      if (await dock.evaluate((d) => d.classList.contains("near"))) opened = true;
    }
    await page.mouse.move(box.x + box.width / 2, box.y - 200);
    return opened;
  };
  check("목록에서는 바닥 줄에서 독이 열린다", await sweep());
  await page.locator("section.pane:not([hidden]) .row", { has: page.locator(".label", { hasText: "표" }) }).first().dblclick();
  check("엑셀 보기가 열린다", await until(() => page.locator(".sheet-tabs button").count().then((c) => c === 2), 8000));
  const tabs = await page.locator(".sheet-tabs").boundingBox();
  check("시트 탭이 독 자리와 겹친다", tabs && tabs.y + tabs.height > box.y, tabs ? `탭 ${Math.round(tabs.y)}+${Math.round(tabs.height)} · 독 ${Math.round(box.y)}` : "");
  check("엑셀 보기 위에서는 독이 열리지 않는다", !(await sweep()));
  await page.locator(".sheet-tabs button", { hasText: "둘째" }).click();
  check("시트 탭을 누를 수 있다", await until(() => page.locator(".sheet-tabs button[aria-selected=true]", { hasText: "둘째" }).count(), 2000));
  await page.keyboard.press("Escape");
  await until(() => page.locator(".viewer").count().then((c) => c === 0), 3000);
  check("보기를 닫으면 다시 열린다", await sweep());
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
