// 앱 안 보기 시험 — 배포판 exe 를 띄워 md · txt · 그림을 앱 안에서 열고 고쳐 본다.
//
//   node e2e/viewer.mjs [캡처 폴더]
//
// smoke.mjs 와 같은 틀(WebView2 디버깅 포트 · 시험용 임시 폴더 · 설정은 떠 두었다 되돌린다).
// 보는 것: 마크다운을 렌더된 채로 고치기(제목 · 표 · 그림) · 멈춘 뒤 저장 · CP949 + CRLF 파일을 그 꼴 그대로 저장 ·
// 링크로 다른 글 열기 · 그림 ←/→ · 밖에서 고친 것 따라가기 · 고친 사이 밖에서 바뀌면 묻기 · Esc 로 목록.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const fs_list = (d) => readdirSync(d);
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9334;
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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
// 「가나」 CRLF 「메모」 CRLF — CP949
const CP949 = Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0x0d, 0x0a, 0xb8, 0xde, 0xb8, 0xf0, 0x0d, 0x0a]);
const NOTE = "# 시험 노트\n\n- 하나\n- 둘\n\n| 열 | 값 |\n| - | - |\n| a | 1 |\n\n![그림](./그림.png)\n\n[메모 열기](메모.txt)\n\n[없는 파일](없는파일.docx)\n";

const T = join(tmpdir(), `filedesk-viewer-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
writeFileSync(join(T, "노트.md"), NOTE);
writeFileSync(join(T, "메모.txt"), CP949);
writeFileSync(join(T, "그림.png"), PNG);
writeFileSync(join(T, "둘째.png"), PNG);
// 줄끝이 섞인 글 — 읽기만 해야 한다
const MIXED = Buffer.from("첫 줄\r\n둘째 줄\n");
writeFileSync(join(T, "섞임.txt"), MIXED);

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 } }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-e2e-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});

let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다 (WebView2 디버깅 포트)");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${decodeURIComponent(r.url())}`));

  const pane = page.locator("section.pane:not([hidden])");
  const row = (text) => pane.locator(".row", { hasText: text }).first();
  const viewer = pane.locator(".viewer");
  const editor = viewer.locator(".cm-content");
  check("시험 폴더 목록", await until(() => row("노트").count(), 10000));

  // 1. 마크다운 — 두 번 누르면 앱 안에서, 렌더된 채로 (보기 · 편집이 따로 없다)
  await row("노트").dblclick();
  check("md 는 앱 안에서 연다", await until(() => viewer.locator(".cm-line.cm-atomic-h1").textContent().then((t) => t.includes("시험 노트")), 8000));
  check("보기 · 편집 갈래가 없다", (await viewer.locator(".viewer-modes").count()) === 0);
  check("표를 그린다", await until(() => viewer.locator(".cm-atomic-table").count()));
  check(
    "문서 옆 그림을 그린다",
    await until(() => viewer.locator(".cm-atomic-image img").evaluate((i) => i.complete && i.naturalWidth > 0), 5000),
  );
  await page.screenshot({ path: join(SHOTS, "v1_마크다운.png") });

  // 2. 그 자리에서 고친다 — 멈추면 저장, 줄끝 LF 그대로
  await viewer.locator(".cm-line.cm-atomic-h1").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("added line");
  check("멈추면 저장한다", await until(() => readFileSync(join(T, "노트.md"), "utf8").endsWith("added line"), 5000));
  check("LF 파일은 LF 로", !readFileSync(join(T, "노트.md"), "utf8").includes("\r"));
  check("저장됨 표시", await until(() => viewer.locator(".viewer-status.saved").count()));
  check("제목은 여전히 렌더", (await viewer.locator(".cm-line.cm-atomic-h1").count()) === 1);
  await page.screenshot({ path: join(SHOTS, "v2_마크다운_고침.png") });

  // 2-0. 표 칸 메뉴의 Esc 는 메뉴만 닫는다 (보기까지 닫지 않는다)
  await viewer.locator(".cm-atomic-table td, .cm-atomic-table th").first().click({ button: "right" });
  const tableMenu = page.locator(".cm-atomic-table-menu");
  if (await until(() => tableMenu.count(), 2000)) {
    await page.keyboard.press("Escape");
    await sleep(300);
    check("표 메뉴의 Esc 는 메뉴만 닫는다", (await tableMenu.count()) === 0 && (await viewer.count()) === 1);
  } else check("표 메뉴가 열린다", false);

  // 2-1. 열기 실패는 보기 안에 알린다 (칸의 알림 줄은 보기 밑에 깔린다) · Esc 는 알림만 닫는다
  await viewer.locator(".cm-atomic-link", { hasText: "없는 파일" }).click({ modifiers: ["Control"] });
  const alert = viewer.locator(".viewer-bar[role=alert]");
  check("열기 실패를 보기 안에 알린다", await until(() => alert.isVisible(), 5000));
  await page.keyboard.press("Escape");
  check("Esc 는 알림만 닫는다", await until(async () => (await alert.count()) === 0 && (await viewer.count()) === 1));

  // 3. 링크로 CP949 + CRLF 글 열기 → 고쳐도 그 꼴 그대로
  await viewer.locator(".cm-atomic-link", { hasText: "메모 열기" }).click({ modifiers: ["Control"] });
  check("링크로 다른 글을 연다", await until(() => viewer.locator(".viewer-name").textContent().then((t) => t === "메모.txt")));
  const info = await until(() => viewer.locator(".viewer-info").textContent().then((t) => t.includes("CP949") && t));
  check("인코딩 · 줄끝을 보인다", info?.includes("CP949 · CRLF"), info ?? "");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("ok");
  await page.keyboard.press("Control+s");
  const want = Buffer.concat([CP949, Buffer.from("ok")]);
  check("CP949 · CRLF 그대로 저장", await until(() => readFileSync(join(T, "메모.txt")).equals(want), 5000), readFileSync(join(T, "메모.txt")).toString("hex"));

  // 3-1. 저장 실패 뒤 「다시 저장」은 강제로 쓰지 않는다 — 실패한 사이 밖에서 고쳤으면 묻는다
  chmodSync(join(T, "메모.txt"), 0o444);
  await page.keyboard.type("!");
  check("못 쓰면 알린다", await until(() => viewer.locator(".viewer-bar[role=alert]", { hasText: "저장하지 못했다" }).count(), 5000));
  chmodSync(join(T, "메모.txt"), 0o666);
  const outside = Buffer.from("outside\r\n");
  writeFileSync(join(T, "메모.txt"), outside);
  await viewer.locator(".viewer-bar .act", { hasText: "다시 저장" }).click();
  check("다시 저장은 밖에서 고친 것을 덮지 않고 묻는다", await until(() => viewer.locator(".viewer-bar[role=alertdialog]").count(), 5000));
  check("묻는 동안 파일은 그대로", readFileSync(join(T, "메모.txt")).equals(outside));
  await viewer.locator(".viewer-bar[role=alertdialog] .act", { hasText: "다시 읽기" }).click();
  check("다시 읽으면 밖의 글로", await until(() => editor.textContent().then((t) => t.includes("outside"))));

  // 4. Esc — 목록으로, 그 파일에 고른 표시
  await page.keyboard.press("Escape");
  check("Esc 로 목록", await until(() => viewer.count().then((c) => c === 0)));
  const cls = await until(() => row("메모.txt").getAttribute("class").then((c) => c.includes("selected") && c), 3000);
  check("닫으면 본 파일이 골라져 있다", cls, cls || (await pane.locator(".row.selected").allTextContents()).join(" · "));

  // 4-1. 줄끝이 섞인 글은 읽기만 한다
  await row("섞임").dblclick();
  check("줄끝이 섞였으면 읽기만 한다고 알린다", await until(() => viewer.locator(".viewer-bar[role=note]").count(), 5000));
  await editor.click();
  await page.keyboard.type("x");
  await sleep(1200);
  check("섞인 글은 고쳐지지 않는다", readFileSync(join(T, "섞임.txt")).equals(MIXED));
  await page.keyboard.press("Escape");
  await until(() => viewer.count().then((c) => c === 0));

  // 5. 그림 — 앱 안 보기 · ←/→
  await row("그림").dblclick();
  const img = viewer.locator(".image-stage img");
  check("그림을 앱 안에서", await until(() => img.evaluate((i) => i.complete && i.naturalWidth > 0), 8000));
  const first = await viewer.locator(".viewer-name").textContent();
  await page.keyboard.press("ArrowRight");
  check("→ 다음 그림", await until(() => viewer.locator(".viewer-name").textContent().then((t) => t !== first)), first ?? "");
  check("크기 · 차례를 보인다", (await viewer.locator(".viewer-info").textContent())?.includes("/ 2"));
  await page.screenshot({ path: join(SHOTS, "v3_그림.png") });
  await page.keyboard.press("Escape");
  await until(() => viewer.count().then((c) => c === 0));

  // 6. 밖에서 고치면 — 고친 것이 없으면 따라가고, 있으면 묻는다
  await row("노트").dblclick();
  await until(() => viewer.locator(".cm-line.cm-atomic-h1").count());
  await sleep(300);
  writeFileSync(join(T, "노트.md"), "# 밖에서 고침\n");
  check("밖에서 고치면 따라간다", await until(() => viewer.locator(".cm-line.cm-atomic-h1").textContent().then((t) => t.includes("밖에서 고침")), 8000));
  await viewer.locator(".cm-line.cm-atomic-h1").click();
  await page.keyboard.press("Control+End");
  await sleep(300);
  // 고친 뒤 저장(멈추고 0.8초)되기 전에 밖에서 쓴다
  await page.keyboard.type("mine");
  writeFileSync(join(T, "노트.md"), "# 또 밖에서\n");
  const ask = viewer.locator(".viewer-bar[role=alertdialog]");
  check("고친 사이 밖에서 바뀌면 묻는다", await until(() => ask.count(), 6000));
  check("묻는 동안 덮어쓰지 않는다", readFileSync(join(T, "노트.md"), "utf8") === "# 또 밖에서\n");
  // 묻는 중에 닫으면 여기서 고친 글이 버려진다 — 닫지 않고 먼저 고르라고 한다
  await page.keyboard.press("Escape");
  await sleep(300);
  check("묻는 중에는 Esc 로 닫히지 않는다", (await viewer.count()) === 1 && (await viewer.locator(".viewer-bar[role=alert]", { hasText: "겹친다" }).count()) === 1);
  await page.screenshot({ path: join(SHOTS, "v4_충돌.png") });
  await ask.locator(".act.primary").click();
  check("덮어쓰기를 고르면 쓴다", await until(() => readFileSync(join(T, "노트.md"), "utf8").includes("mine"), 5000));

  check("저장 임시 파일이 남지 않는다", !fs_list(T).some((n) => n.endsWith(".filedesk-saving")), fs_list(T).join(" · "));
  check("화면 오류 없음", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("시험 진행", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  if (backup) writeFileSync(SETTINGS, backup);
  rmSync(T, { recursive: true, force: true });
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과 · 캡처 ${SHOTS}`);
  process.exit(bad.length ? 1 : 0);
}
