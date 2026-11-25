// 앱 안 보기의 고치기 · 찾기 · 바꾸기를 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/viewer-edit.mjs [캡처 폴더]
//
// 글(txt) · 마크다운: Ctrl+F 찾기 판이 한국어로 · Ctrl+H 바꾸기 · 모두 바꾸기 저장 · 숨김 파일 보기가 함께 바뀌지 않는다.
// 표(csv): 칸 고치기 · 찾기 · 바꾸기 · 모두 바꾸기 · 줄 더하기 · 지우기 · 되돌리기 — 고친 칸 밖의 원래 꼴(따옴표 · 줄끝)이 그대로인지.
// 시험용 임시 폴더에서만 파일을 만들고 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9397;
const SHOTS = process.argv[2] ?? join(tmpdir(), "filedesk-shots");
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

const T = join(tmpdir(), `filedesk-ve-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
const CSV = '이름,주소,메모\r\n홍길동,"서울시 중구, 세종대로",사과\r\n김철수,부산,사과 두 개\r\n이영희,대구,배\r\n';
writeFileSync(join(T, "명단.csv"), CSV);
writeFileSync(join(T, "메모.txt"), "사과 하나\n바나나 둘\n사과 셋\n");
writeFileSync(join(T, "노트.md"), "# 제목\n\n사과는 빨갛다. 사과는 달다.\n");
// 숨김 파일 — Ctrl+H 가 앱의 「숨김 파일 보기」로 새면 목록에 나타난다
writeFileSync(join(T, ".숨김"), "x");
const read = (n) => readFileSync(join(T, n), "utf8");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-ve-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
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
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  check("폴더를 연다", await until(async () => (await rowNames()).length >= 3, 10000));
  const hiddenShown = async () => (await rowNames()).some((n) => n.includes("숨김"));
  const hiddenBefore = await hiddenShown();

  // ── 1. 글 파일: 찾기 · 바꾸기
  await row("메모").dblclick();
  await until(() => page.locator(".viewer .cm-content").count(), 5000);
  await page.locator(".viewer .cm-content").click();
  await page.keyboard.press("Control+f");
  const q = page.locator(".viewer .cm-search input[name=search]");
  check("글: Ctrl+F 로 찾기 판", await until(() => q.count(), 3000));
  check("글: 찾기 판 글자가 한국어", (await q.getAttribute("placeholder")) === "찾을 말", await q.getAttribute("placeholder"));
  await q.fill("사과");
  await page.keyboard.press("Control+h");
  const rep = page.locator(".viewer .cm-search input[name=replace]");
  check("글: Ctrl+H 는 바꿀 칸으로", await until(() => rep.evaluate((el) => el === document.activeElement), 2000));
  await rep.fill("포도");
  await page.locator(".viewer .cm-search button[name=replaceAll]").click();
  await page.keyboard.press("Control+s");
  check("글: 모두 바꾸기가 저장된다", await until(() => read("메모.txt") === "포도 하나\n바나나 둘\n포도 셋\n", 4000), JSON.stringify(read("메모.txt")));
  await page.screenshot({ path: join(SHOTS, "ve-text-find.png") });
  await page.keyboard.press("Escape"); // 판 닫기
  await page.keyboard.press("Escape"); // 보기 닫기
  await sleep(500);
  check("글: Ctrl+H 가 숨김 파일 보기를 바꾸지 않았다", (await hiddenShown()) === hiddenBefore);

  // ── 2. 마크다운: 편집기 밖에서 Ctrl+H
  await row("노트").dblclick();
  await until(() => page.locator(".viewer .md-live .cm-content").count(), 5000);
  await page.locator(".viewer-name").click(); // 편집기 밖에 초점
  await page.keyboard.press("Control+h");
  const mq = page.locator(".viewer .cm-search input[name=search]");
  check("마크다운: 편집기 밖에서 Ctrl+H 로 판이 열린다", await until(() => mq.count(), 3000));
  await mq.fill("사과");
  await page.locator(".viewer .cm-search input[name=replace]").fill("딸기");
  await page.locator(".viewer .cm-search button[name=replaceAll]").click();
  await page.keyboard.press("Control+s");
  check("마크다운: 모두 바꾸기가 저장된다", await until(() => read("노트.md").includes("딸기는 빨갛다. 딸기는 달다."), 4000), JSON.stringify(read("노트.md")));
  await page.screenshot({ path: join(SHOTS, "ve-md-find.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await sleep(500);
  check("마크다운: 숨김 파일 보기가 그대로", (await hiddenShown()) === hiddenBefore);

  // ── 3. 표
  await row("명단").dblclick();
  const table = page.locator(".viewer-table table");
  await until(() => table.count(), 5000);
  const cellAt = (r, c) => table.locator(`[data-r="${r}"][data-c="${c}"]`);
  const isSel = (r, c) => cellAt(r, c).evaluate((el) => el.classList.contains("sel"));
  // 칸 고치기 — 두 번 누르기
  await cellAt(2, 1).dblclick();
  const ed = table.locator("input.cell-edit");
  check("표: 두 번 누르면 칸 고치기", await until(() => ed.count(), 2000));
  await ed.fill("부산광역시");
  await ed.press("Enter");
  check("표: 고친 칸만 바뀌어 저장된다 (따옴표 · CRLF 그대로)", await until(() => read("명단.csv") === CSV.replace("김철수,부산,", "김철수,부산광역시,"), 4000), JSON.stringify(read("명단.csv")));
  check("표: Enter 뒤 아래 칸이 골라진다", await until(() => isSel(3, 1), 2000));
  // 고른 칸에서 바로 치기 · 쉼표가 든 글은 따옴표로 싼다.
  //   영문으로 친다 — playwright 는 한글을 키 누름 없이 글자로만 넣어(IME 흉내가 없다) 「바로 치기」가 시작되지 않는다. 한글 조합은 사람이 본다.
  await page.keyboard.type("Daegu, Suseong");
  await page.keyboard.press("Enter");
  check("표: 바로 치면 고치기 · 쉼표가 들면 따옴표로", await until(() => read("명단.csv").includes('이영희,"Daegu, Suseong",배'), 4000), JSON.stringify(read("명단.csv")));
  // 찾기 · 바꾸기
  await page.keyboard.press("Control+f");
  const tq = page.locator(".table-find input[aria-label='찾을 말']");
  check("표: Ctrl+F 찾기 줄", await until(() => tq.count(), 2000));
  await tq.fill("사과");
  const count = await page.locator(".table-find-count").textContent();
  check("표: 찾은 칸 수", count?.includes("2칸"), count);
  await tq.press("Enter");
  check("표: Enter 로 찾은 칸으로", await until(() => isSel(1, 2), 2000));
  await page.keyboard.press("Control+h");
  const tr = page.locator(".table-find input[aria-label='바꿀 말']");
  check("표: Ctrl+H 바꿀 칸", await until(() => tr.count(), 2000));
  await tr.fill("귤");
  await tr.press("Enter"); // 지금 칸 바꾸기
  check("표: 바꾸기는 지금 칸만", await until(() => read("명단.csv").includes('홍길동,"서울시 중구, 세종대로",귤\r\n') && read("명단.csv").includes("사과 두 개"), 4000), JSON.stringify(read("명단.csv")));
  await tr.press("Control+Enter"); // 남은 것 모두
  check("표: 모두 바꾸기", await until(() => read("명단.csv").includes("귤 두 개"), 4000), JSON.stringify(read("명단.csv")));
  await page.screenshot({ path: join(SHOTS, "ve-table-find.png") });
  await tr.press("Escape");
  // 되돌리기
  await page.locator(".viewer-table-scroll").focus();
  await page.keyboard.press("Control+z");
  check("표: Ctrl+Z 로 모두 바꾸기를 되돌린다", await until(() => read("명단.csv").includes("사과 두 개"), 4000), JSON.stringify(read("명단.csv")));
  // 줄 더하기 · 지우기
  await cellAt(1, 0).click();
  await page.keyboard.press("Control+=");
  check("표: Ctrl++ 로 아래에 빈 줄", await until(() => read("명단.csv").split("\r\n")[2] === ",,", 4000), JSON.stringify(read("명단.csv")));
  await page.keyboard.press("Control+-");
  check("표: Ctrl+- 로 그 줄을 지운다", await until(() => !read("명단.csv").includes("\r\n,,\r\n") && read("명단.csv").split("\r\n").length === 5, 4000), JSON.stringify(read("명단.csv")));
  // Esc 는 고른 칸을 풀고 보기는 닫지 않는다
  await page.keyboard.press("Escape");
  check("표: Esc 첫 번은 보기를 닫지 않는다", (await page.locator(".viewer").count()) === 1);
  await page.screenshot({ path: join(SHOTS, "ve-table-end.png") });

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
