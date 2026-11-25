// 엑셀 · 파워포인트 미리보기를 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/office-preview.mjs [캡처 폴더] [실제 pptx · xlsx …]
//
// 시험 파일은 python-pptx · openpyxl 로 만든다 (pip install python-pptx openpyxl).
// 엑셀: 두 번 누르면 표 · 시트 탭 · 열 글자(값이 B2 부터면 B · C …) · 날짜 칸 · 찾기 · 고치려 하면 읽기 전용 알림.
// 파워포인트: 쪽 수 · 쪽 글 · 표 · 발표자 메모 · PageDown 으로 넘기기 · 찾기.
// 뒤에 실제 파일을 주면 그 파일도 열어 캡처만 남긴다 (모양은 사람이 본다). 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9398;
const SHOTS = process.argv[2] || join(tmpdir(), "filedesk-shots");
const REAL = process.argv.slice(3);
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

const T = join(tmpdir(), `filedesk-office-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
const MAKE = join(T, "_make.py");
writeFileSync(
  MAKE,
  `
import datetime, sys
from pptx import Presentation
from pptx.util import Inches, Pt
from openpyxl import Workbook

d = sys.argv[1]
p = Presentation()
s = p.slides.add_slide(p.slide_layouts[0])
s.shapes.title.text = "산사태 정보 시스템"
s.placeholders[1].text = "2026년 사업 계획"
s.notes_slide.notes_text_frame.text = "첫 쪽 발표자 메모"
s = p.slides.add_slide(p.slide_layouts[1])
s.shapes.title.text = "추진 일정"
s.placeholders[1].text = "1단계 설계\\n2단계 구축\\n3단계 시험"
s = p.slides.add_slide(p.slide_layouts[5])
s.shapes.title.text = "예산 표"
t = s.shapes.add_table(3, 2, Inches(1), Inches(2), Inches(6), Inches(1.5)).table
for r, (a, b) in enumerate([("항목", "금액"), ("인건비", "1,200"), ("장비", "300")]):
    t.cell(r, 0).text = a
    t.cell(r, 1).text = b
p.save(d + "/계획.pptx")

w = Workbook()
a = w.active
a.title = "요약"
a["B2"] = "이름"; a["C2"] = "수량"; a["D2"] = "날짜"
a["B3"] = "사과"; a["C3"] = 3; a["D3"] = datetime.date(2026, 11, 25)
a["B4"] = "배"; a["C4"] = 2.5; a["D4"] = datetime.date(2026, 12, 1)
b = w.create_sheet("자료")
b["A1"] = "코드"; b["A2"] = "X-01"
w.save(d + "/목록.xlsx")
`,
);
execFileSync("python", ["-X", "utf8", MAKE, T]);
rmSync(MAKE);
for (const f of REAL) copyFileSync(f, join(T, `실제_${basename(f)}`));

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-office-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});

let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const pane = page.locator("section.pane:not([hidden])");
  const rowNames = () => pane.locator(".row .label").allTextContents();
  const row = (name) => pane.locator(".row", { has: page.locator(".label", { hasText: name }) }).first();
  check("폴더를 연다", await until(async () => (await rowNames()).length >= 2, 10000));

  // ── 엑셀
  await row("목록").dblclick();
  const table = page.locator(".viewer-table table");
  check("엑셀: 표로 연다", await until(() => table.count(), 8000));
  const heads = await table.locator("thead th.col").allTextContents();
  check("엑셀: 열 글자는 값이 있는 첫 열부터 (B · C · D)", heads.join("|") === "B|C|D", heads.join("|"));
  const nums = await table.locator("tbody td.n").allTextContents();
  check("엑셀: 줄 번호는 시트의 실제 줄 (2 · 3 · 4)", nums.join("|") === "2|3|4", nums.join("|"));
  const cells = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td:not(.n)")].map((td) => td.textContent)));
  check("엑셀: 정수는 소수점 없이 · 소수는 그대로", cells[1]?.[1] === "3" && cells[2]?.[1] === "2.5", JSON.stringify(cells));
  check("엑셀: 날짜 칸은 날짜로", cells[1]?.[2] === "2026-11-25", cells[1]?.[2]);
  check("엑셀: 시트 탭", (await page.locator(".sheet-tabs button").allTextContents()).join("|") === "요약|자료");
  check("엑셀: 머리에 읽기 전용", (await page.locator(".viewer-info").textContent())?.includes("읽기 전용"));
  await table.locator('[data-r="1"][data-c="0"]').dblclick();
  check("엑셀: 고치려 하면 읽기 전용 알림 (칸이 열리지 않는다)", (await table.locator("input.cell-edit").count()) === 0 && (await page.locator(".viewer-bar", { hasText: "읽기 전용" }).count()) > 0);
  await page.keyboard.press("Control+f");
  await page.locator(".table-find input[aria-label='찾을 말']").fill("배");
  check("엑셀: 찾기", (await page.locator(".table-find-count").textContent())?.includes("1칸"), await page.locator(".table-find-count").textContent());
  await page.keyboard.press("Escape");
  await page.locator(".sheet-tabs button", { hasText: "자료" }).click();
  check("엑셀: 다른 시트로", await until(async () => (await table.locator("tbody td:not(.n)").allTextContents()).includes("X-01"), 3000));
  await page.screenshot({ path: join(SHOTS, "office-xlsx.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await until(() => page.locator(".viewer").count().then((c) => c === 0), 3000);

  // ── 파워포인트
  await row("계획").dblclick();
  const cards = page.locator(".slide-card");
  check("파워포인트: 쪽 세 장", await until(() => cards.count().then((c) => c === 3), 10000), String(await cards.count()));
  const slideText = (i) => cards.nth(i).locator(".slide-host").evaluate((h) => h.shadowRoot?.textContent ?? "");
  check("파워포인트: 첫 쪽 글", (await slideText(0)).includes("산사태 정보 시스템"), (await slideText(0)).slice(0, 60));
  check("파워포인트: 글머리 문단", (await slideText(1)).includes("2단계 구축"));
  check("파워포인트: 표", (await slideText(2)).includes("인건비") && (await slideText(2)).includes("1,200"));
  check("파워포인트: 발표자 메모", (await cards.nth(0).locator(".slide-notes").textContent())?.includes("첫 쪽 발표자 메모"));
  check("파워포인트: 머리에 쪽 수", (await page.locator(".viewer-info").textContent())?.includes("/ 3쪽"), await page.locator(".viewer-info").textContent());
  const box = await cards.nth(0).locator(".slide-frame").boundingBox();
  check("파워포인트: 쪽이 원래 비율(python-pptx 기본 4:3)로 칸 너비에 맞춘다", box && Math.abs(box.width / box.height - 4 / 3) < 0.03 && box.width > 400, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "");
  await page.screenshot({ path: join(SHOTS, "office-pptx.png") });
  await page.keyboard.press("PageDown");
  check("파워포인트: PageDown 으로 다음 쪽", await until(async () => (await page.locator(".viewer-info").textContent())?.startsWith("2 /"), 3000), await page.locator(".viewer-info").textContent());
  await page.keyboard.press("Control+f");
  await page.locator(".viewer-slides .table-find input").fill("인건비");
  await page.keyboard.press("Enter");
  check("파워포인트: 찾기", await until(async () => (await page.locator(".table-find-count").textContent())?.includes("1 / 1곳"), 3000), await page.locator(".table-find-count").textContent());
  check("파워포인트: 찾은 쪽으로 간다", await until(async () => (await page.locator(".viewer-info").textContent())?.startsWith("3 /"), 3000), await page.locator(".viewer-info").textContent());
  await page.screenshot({ path: join(SHOTS, "office-pptx-find.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await until(() => page.locator(".viewer").count().then((c) => c === 0), 3000);

  // ── 실제 파일 — 열리는지와 캡처만
  for (const f of REAL) {
    const name = `실제_${basename(f)}`;
    await row(name.replace(/\.[^.]+$/, "")).dblclick();
    const ok = await until(async () => (await page.locator(".slide-card").count()) > 0 || (await page.locator(".viewer-table table").count()) > 0, 20000);
    await sleep(2500);
    check(`실제 파일 연다: ${basename(f)}`, ok, (await page.locator(".viewer-info").textContent()) ?? "");
    await page.screenshot({ path: join(SHOTS, `office-real-${results.length}.png`) });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await until(() => page.locator(".viewer").count().then((c) => c === 0), 3000);
  }

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
