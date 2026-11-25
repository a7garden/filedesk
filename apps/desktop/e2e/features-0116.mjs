// 0.1.16 에서 더하고 고친 것을 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/features-0116.mjs [캡처 폴더]
//
// 폴더 용량(설정 › 목록 › 폴더 용량 표시) · 크기 정렬 · 찾은 결과의 색 표시(하위 폴더까지 · 색 표시 모아 보기) ·
// 모아 보기를 열 때 앞 폴더의 거르기 풀기 · 스마트 폴더 안 Shift+Enter · 모아 보기 안 「＋ 조건」 · 연결 이름 바꾸기.
// 시험용 임시 폴더에서만 파일을 만들고 색을 단다 (끝나면 색을 떼고 폴더를 지운다). 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9393;
const SHOTS = process.argv[2] ?? join(tmpdir(), "filedesk-shots");
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");
mkdirSync(SHOTS, { recursive: true });

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

const T = join(tmpdir(), `filedesk-f16-${process.pid}`);
rmSync(T, { recursive: true, force: true });
// 큰 폴더: 4096 × 3 = 12288 바이트 (하위 두 단계) · 작은 폴더: 100 바이트
mkdirSync(join(T, "큰", "안", "더안"), { recursive: true });
mkdirSync(join(T, "작은"), { recursive: true });
writeFileSync(join(T, "큰", "a.bin"), Buffer.alloc(4096));
writeFileSync(join(T, "큰", "안", "b.bin"), Buffer.alloc(4096));
writeFileSync(join(T, "큰", "안", "더안", "깊은빨강.txt"), Buffer.alloc(4096));
writeFileSync(join(T, "작은", "c.bin"), Buffer.alloc(100));
writeFileSync(join(T, "파랑.txt"), "x");
const RED = join(T, "큰", "안", "더안", "깊은빨강.txt");
const BLUE = join(T, "파랑.txt");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(
  SETTINGS,
  JSON.stringify({
    session: { tabs: [T], active: 0 },
    pinned: [],
    links: [{ name: "공유", path: "\\\\127.0.0.1\\공유" }],
    view: { folderSize: true, sizeUnit: "kb", links: true },
    smart: [{ id: "t1", name: "시험 스마트", q: "확장자:txt", scope: { kind: "roots", roots: [{ path: T, recursive: true }] } }],
  }),
);

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-f16-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});

let browser;
let page;
const invoke = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const pane = page.locator("section.pane:not([hidden])");
  const rowNames = () => pane.locator(".row .label").allTextContents();
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  await until(async () => (await rowNames()).length >= 3, 10000);
  // 켠 직후에는 IPC 가 「Origin header」 오류를 내는 일이 있어 될 때까지 다시 부른다
  check("시험 파일에 색 달기", await until(() => invoke("set_color", { path: RED, color: "red" }).then(() => true), 8000, 300));
  await invoke("set_color", { path: BLUE, color: "blue" });
  // 왼쪽 「색 표시」 개수는 앱 안에서 색을 바꿀 때 다시 센다 — 앱 밖에서 단 색은 알려 준다 (0개인 건반은 눌러도 열리지 않는다)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fd:colors")));

  // 1. 폴더 용량
  const bigSize = await until(async () => {
    const t = (await row("큰").locator(".cell.size").textContent())?.trim();
    return t && t !== "…" ? t : null;
  }, 10000);
  check("폴더 용량 — 하위 폴더까지 더한다 (12288바이트 → 12KB)", bigSize === "12KB", bigSize ?? "없음");
  const smallSize = (await row("작은").locator(".cell.size").textContent())?.trim();
  check("작은 폴더 용량 (100바이트 → 1KB)", smallSize === "1KB", smallSize);
  const tip = await row("큰").locator(".cell.size").getAttribute("title");
  check("용량 칸 말풍선에 파일 · 폴더 수", tip?.includes("파일 3개") && tip.includes("폴더 2개"), tip);
  // 크기 정렬 — 처음 누르면 큰 순. 폴더끼리도 용량대로
  await pane.locator("[role=columnheader].col-3 button").first().click();
  await sleep(300);
  const sortedDirs = (await rowNames()).filter((n) => n === "큰" || n === "작은");
  check("크기 정렬에 폴더 용량을 쓴다 (큰 순)", sortedDirs.join(",") === "큰,작은", sortedDirs.join(","));
  await page.screenshot({ path: join(SHOTS, "f16-size.png") });

  // 2. 찾은 결과의 색 — 하위 폴더까지 찾기
  const filter = pane.locator("input.filter");
  await filter.fill("깊은빨강");
  await filter.press("Shift+Enter");
  await until(async () => (await rowNames()).some((n) => n.includes("깊은빨강")), 8000);
  check("하위 폴더 결과에 색 점이 보인다", await until(() => row("깊은빨강").locator(".tag-dot.tag-red").count(), 3000));
  check("하위 폴더 결과에 색 거르기 칩이 선다", await until(() => pane.locator(".kind.kind-color").count(), 3000));
  await filter.fill("");
  await filter.press("Escape");
  await sleep(300);

  // 3. 이 폴더에서 「파랑」 거르기를 걸어 둔 채 빨강 모아 보기 — 거르기가 풀려 빨강 항목이 보인다
  await until(async () => (await rowNames()).includes("파랑.txt"), 5000);
  await pane.locator(".kind.kind-color").first().click();
  check("이 폴더에서 파랑만 거른다", (await rowNames()).join(",") === "파랑.txt", (await rowNames()).join(","));
  await page.locator(".tag-key.tag-red").click();
  const tagRows = await until(async () => {
    const ns = await rowNames();
    return ns.some((n) => n.includes("깊은빨강")) ? ns : null;
  }, 5000);
  check("빨강 모아 보기를 열면 앞 폴더의 파랑 거르기가 풀린다", !!tagRows, (tagRows ?? (await rowNames())).join(","));
  check("빨강 모아 보기 줄에 색 점", (await row("깊은빨강").locator(".tag-dot.tag-red").count()) > 0);
  check("모아 보기 안에 「＋ 조건」", (await pane.locator(".preset-wrap").count()) > 0);
  // 색을 떼면 모아 보기에서 빠진다
  await row("깊은빨강").click();
  await page.keyboard.press("Alt+0");
  check("빨강 모아 보기에서 색을 떼면 그 줄이 빠진다", await until(async () => !(await rowNames()).some((n) => n.includes("깊은빨강")), 3000));
  await page.keyboard.press("Escape");
  await sleep(300);

  // 4. 스마트 폴더 안에서 Shift+Enter 는 모아 보기를 닫지 않는다
  await page.locator(".side .smart-item", { hasText: "시험 스마트" }).click();
  await until(async () => (await rowNames()).length > 0, 8000);
  await filter.fill("파랑");
  await filter.press("Shift+Enter");
  await sleep(500);
  const chip = await pane.locator(".deep-tag").textContent().catch(() => "");
  check("스마트 폴더 안 Shift+Enter — 모아 보기가 그대로", chip?.includes("스마트 폴더"), chip);
  check("스마트 폴더 안 찾기 칸으로 결과를 추린다", (await rowNames()).join(",") === "파랑.txt", (await rowNames()).join(","));
  await filter.fill("");
  await page.keyboard.press("Escape");
  await sleep(300);

  // 5. 연결 이름 바꾸기 — 서버 줄을 두 번 눌러
  const server = page.locator(".side .link-server").first();
  await server.dblclick();
  const input = server.locator("input.rename");
  await input.fill("시험 NAS");
  await input.press("Enter");
  check("연결 서버 줄 이름 바꾸기", (await server.textContent())?.includes("시험 NAS"), await server.textContent());
  await page.locator(".side .link-share").first().focus();
  await page.keyboard.press("F2");
  const shareInput = page.locator(".side .link-rename input.rename");
  await shareInput.fill("공유 별명");
  await shareInput.press("Enter");
  check("연결 공유 줄 이름 바꾸기 (F2)", (await page.locator(".side .link-share").first().textContent())?.includes("공유 별명"));

  // 6. 설정에서 끄면 폴더 용량이 빈다
  await page.keyboard.press("Control+,");
  const box = page.locator(".settings label", { hasText: "폴더 용량 표시" }).locator("input");
  await box.waitFor({ timeout: 5000 });
  await box.uncheck();
  await page.keyboard.press("Escape");
  await sleep(300);
  if (await page.locator(".settings").count()) await page.keyboard.press("Control+,");
  const off = (await row("큰").locator(".cell.size").textContent())?.trim();
  check("설정에서 끄면 폴더 용량을 보이지 않는다", off === "", off);
  await page.screenshot({ path: join(SHOTS, "f16-end.png") });

  check("스크립트 오류 없음", errors.length === 0, errors.join(" | "));
} finally {
  try {
    if (page) {
      await invoke("set_color", { path: RED, color: null });
      await invoke("set_color", { path: BLUE, color: null });
    }
  } catch {}
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(800);
  if (backup) writeFileSync(SETTINGS, backup);
  rmSync(T, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
