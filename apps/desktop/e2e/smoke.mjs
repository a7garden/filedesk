// 실제 앱(배포판 exe)을 띄워 화면을 조작해 보는 시험.
//
//   node e2e/smoke.mjs [캡처 폴더]
//
// WebView2 의 원격 디버깅 포트로 Playwright 를 붙인다. 셸 메뉴 · 앱 밖 끌기는 창 밖 일이라 여기서 못 본다 (사람이 본다).
// 시험용 임시 폴더에서만 파일을 만들고 바꾼다. 휴지통 시험은 그 폴더의 빈 파일 하나를 휴지통으로 보낸다.
// 앱 설정(열어 둔 탭 · 고정 위치)은 시험 전에 떠 두었다가 끝나면 되돌린다 — 시험이 사용자 설정을 바꾸지 않게.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9333;
const SHOTS = process.argv[2] ?? join(tmpdir(), "filedesk-shots");
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");
const MEMOS = join(process.env.APPDATA, "kr.seesun.filedesk", "memos.json");
const RULES = join(process.env.APPDATA, "kr.seesun.filedesk", "name-rules.json");
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

// ── 시험 과업: 산출물(정본) · 자료(받은 것) 이 있는 과업 루트 흉내
const T = join(tmpdir(), `filedesk-e2e-${process.pid}`);
rmSync(T, { recursive: true, force: true });
for (const d of ["이전판", "하위", "산출물", "자료"]) mkdirSync(join(T, d), { recursive: true });
const files = {
  "보고서_v3_20261101.pptx": "v3",
  "보고서_v3_20261101.pdf": "v3pdf",
  "이전판/보고서_v2_20261020.pptx": "v2",
  "LDM_D09_테이블정의서_예시과업_v1.6_20261015.xlsx": "d9",
  "이전판/LDM_D09_테이블정의서_예시과업_v1.6_20261007.xlsx": "d9old",
  "가나다.txt": "a",
  "지울것.txt": "",
  // 같은 자리에 판이 둘 — 문제 줄의 「지난 판을 이전판으로」 시험
  "회의자료_v1_20261001.pptx": "m1",
  "회의자료_v2_20261005.pptx": "m2",
};
for (const [n, c] of Object.entries(files)) writeFileSync(join(T, n), c);
// 프로젝트 단위 문서 저장소 흉내: <저장소>\사업\<올해>\시험사업\{산출물, 자료}
const YEAR = String(new Date().getFullYear());
const STORE = join(T, "저장소");
const PROJ = join(STORE, "사업", YEAR, "시험사업");
for (const d of ["산출물", "자료"]) mkdirSync(join(PROJ, d), { recursive: true });
writeFileSync(join(PROJ, "자료", "받은공문_20261101.hwpx"), "r");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
// 메모도 떠 두었다가 되돌린다 — 시험 메모가 사용자 메모 파일에 남지 않게.
const memoBackup = existsSync(MEMOS) ? readFileSync(MEMOS) : null;
// 이름 규칙도 — 시험 파일 이름(「…_예시과업_v1.6」)이 사용자 규칙과 상관없이 같은 문서로 묶이게 시험 규칙을 쓴다.
const rulesBackup = existsSync(RULES) ? readFileSync(RULES) : null;
writeFileSync(RULES, JSON.stringify({ projectNames: ["예시과업"], people: [] }));
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [{ name: "시험 폴더", path: T }], storeRoot: STORE }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
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
  const rowNames = () => pane.locator(".row .label").allTextContents();
  const row = (text) => pane.locator(".row", { hasText: text }).first();

  // 1. 첫 화면 — 판 접힘: 보고서는 pptx 한 줄(pdf · 지난 판 접힘), 폴더가 먼저
  const names = await until(async () => {
    const n = await rowNames();
    return n.length >= 7 && n.some((x) => x.startsWith("보고서")) ? n : null;
  }, 10000);
  check("시험 폴더 목록", names, names?.join(" · "));
  check("폴더가 먼저", ["이전판", "하위", "산출물", "자료"].includes(names?.[0] ?? ""), names?.slice(0, 4).join(" · "));
  check("보고서는 한 줄로 접힌다 (문서 이름으로)", names?.filter((n) => n.startsWith("보고서")).length === 1 && names?.includes("보고서.pptx"), names?.find((n) => n.startsWith("보고서")));
  const ticks = await row("보고서").locator("svg.ticks").getAttribute("aria-label");
  // pptx · pdf 는 한 판으로 센다 — 보고서는 v3(pptx · pdf) · v2 두 판
  check("판 눈금 — 글로도 읽힌다", ticks?.includes("2판") && ticks.includes("이전판 1"), ticks ?? "");
  check("D09 판 겹침은 문제 줄로", (await pane.locator(".row.issue-line", { hasText: "v1.6 이 여러 날짜" }).count()) === 1);
  check("판 겹침 점은 경고 모양", (await row("LDM_D09").locator(".tick-arc").count()) === 1);
  check("셸 아이콘이 그려진다", await until(() => row("가나다").locator("img").evaluate((img) => img.complete && img.naturalWidth > 0), 5000));
  check("왼쪽 프로젝트에 올해 프로젝트", (await page.locator(".side .project-name").allTextContents()).includes("시험사업"));
  await page.screenshot({ path: join(SHOTS, "01_목록.png") });

  // 2. 거르기
  await page.keyboard.press("Control+f");
  await page.keyboard.type("보고서");
  check("거르기", await until(async () => (await rowNames()).length === 1), (await rowNames()).join(" · "));
  await page.keyboard.press("Escape");
  await until(async () => (await rowNames()).length >= 7);

  // 3. 새 폴더 → 바로 이름 바꾸기 → Enter
  await pane.locator(".list").click({ position: { x: 600, y: 420 } });
  await page.keyboard.press("Control+Shift+N");
  check("새 폴더 뒤 이름 칸", await until(() => pane.locator("input.rename").count().then((c) => c > 0)));
  await page.keyboard.press("Control+a");
  await page.keyboard.type("자료정리");
  await page.keyboard.press("Enter");
  check("새 폴더 이름 바꾸기 (셸)", await until(() => existsSync(join(T, "자료정리"))));

  // 4. F2 — 확장자 앞까지만 골라져 있어야 한다
  await row("가나다").click();
  await page.keyboard.press("F2");
  await until(() => pane.locator("input.rename").count().then((c) => c > 0));
  const selText = await pane.locator("input.rename").evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
  check("F2 는 확장자 앞까지 고른다", selText === "가나다", selText);
  await page.keyboard.type("라마바");
  await page.keyboard.press("Enter");
  check("F2 이름 바꾸기 (셸)", await until(() => existsSync(join(T, "라마바.txt"))));

  // 5. 이름 바꾸는 중 다른 줄을 누르면 닫히며 확정
  await row("라마바").click();
  await page.keyboard.press("F2");
  await until(() => pane.locator("input.rename").count().then((c) => c > 0));
  await page.keyboard.type("사아자");
  await row("지울것").click();
  check("다른 줄을 누르면 이름 칸이 닫힌다", await until(() => pane.locator("input.rename").count().then((c) => c === 0), 3000));
  check("닫히면서 확정", await until(() => existsSync(join(T, "사아자.txt")), 3000));

  // 6. 휴지통 (작업 자리라 묻지 않는다)
  await row("지울것").click();
  await page.keyboard.press("Delete");
  check("Delete 휴지통 (셸)", await until(() => !existsSync(join(T, "지울것.txt")), 5000));

  // 7. 폴더 감시
  writeFileSync(join(T, "밖에서만듦.txt"), "x");
  check("폴더 감시로 새 파일이 보인다", await until(async () => (await rowNames()).some((n) => n.startsWith("밖에서만듦")), 5000));

  // 8. 판 펼치기 → 새 판 계획 → 내기
  await row("보고서").locator("button.twisty").click();
  const subs = await until(async () => ((await pane.locator(".row.sub .label").count()) >= 2 ? pane.locator(".row.sub .label").allTextContents() : null));
  check("판 펼치기", subs, subs?.join(" · "));
  await pane.locator(".row.edition button", { hasText: "새 판" }).click();
  const planText = await until(() => pane.locator(".row.edition b").textContent());
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  check("새 판 계획은 원본(pptx)에서", planText === `보고서_v4_${ymd}.pptx`, planText ?? "");
  await page.screenshot({ path: join(SHOTS, "02_판펼침_새판계획.png") });
  await pane.locator(".row.edition button.primary").click();
  check("새 판 파일", await until(() => existsSync(join(T, `보고서_v4_${ymd}.pptx`)), 6000));
  check(
    "지난 판과 pdf 는 이전판으로",
    existsSync(join(T, "이전판", "보고서_v3_20261101.pptx")) && existsSync(join(T, "이전판", "보고서_v3_20261101.pdf")),
  );

  // 8-1. 문제 줄 — 같은 자리에 남은 지난 판을 이전판으로 (계획을 보이고 확인 뒤)
  const meet = pane.locator(".row.issue-line", { hasText: "판이 2개" });
  check("같은 자리 판 둘은 문제 줄", await until(() => meet.count().then((c) => c === 1)));
  await meet.locator("button", { hasText: "이전판으로" }).click();
  // 계획을 띄우면 문제 문장 자리에 옮길 목록이 선다 — 그 줄을 새로 찾는다
  const planRow = pane.locator(".row.issue-line", { hasText: "이전판으로 옮김" });
  check("옮길 판을 먼저 보인다", await until(() => planRow.textContent().then((t) => t.includes("회의자료_v1_20261001.pptx") && !t.includes("v2"))));
  await page.screenshot({ path: join(SHOTS, "04_문제줄_옮김계획.png") });
  await planRow.locator("button.primary").click();
  check("지난 판만 이전판으로", await until(() => existsSync(join(T, "이전판", "회의자료_v1_20261001.pptx")), 6000) && existsSync(join(T, "회의자료_v2_20261005.pptx")));
  check("고치고 나면 문제 줄이 사라진다", await until(() => pane.locator(".row.issue-line", { hasText: "판이 2개" }).count().then((c) => c === 0)));

  // 9. 프로젝트로 가면 그 프로젝트의 자리가 펼쳐진다 → 받은 것 자리는 지우기 전에 묻는다
  await page.locator(".side .nav-item.project", { hasText: "시험사업" }).click();
  const areas = await until(async () => {
    const a = await page.locator(".side .area").allTextContents();
    return a.length ? a : null;
  });
  check("지금 프로젝트의 자리가 펼쳐진다", areas?.join(",") === "산출물,자료", areas?.join(","));
  await page.locator(".side .area", { hasText: "자료" }).click();
  check("자리 머리에 역할", await until(async () => (await pane.locator(".role-tag").textContent()) === "받은 것"));
  await until(async () => (await rowNames()).length === 1);
  await row("받은공문").click();
  await page.keyboard.press("Delete");
  check("받은 것 자리는 묻는다", await until(() => pane.locator(".msg[role=alertdialog]").count().then((c) => c > 0)));
  await page.screenshot({ path: join(SHOTS, "03_받은것_확인.png") });
  await pane.locator(".msg button", { hasText: "그만두기" }).click();
  await sleep(500);
  check("그만두면 그대로", existsSync(join(PROJ, "자료", "받은공문_20261101.hwpx")));

  // 9-1. 새 프로젝트 — 올해 폴더에 기본 자리와 함께 만들어지고 그리로 간다
  await page.locator(".side-add").click();
  await page.locator(".side-new input").fill("새시험");
  await page.locator(".side-new input").press("Enter");
  check("새 프로젝트 만들기", await until(() => existsSync(join(STORE, "사업", YEAR, "새시험", "산출물"))));
  check("새 프로젝트로 이동", await until(async () => (await pane.locator(".crumb.here").textContent()) === "새시험"));
  await page.screenshot({ path: join(SHOTS, "05_새프로젝트.png") });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");

  // 9-2. 메모 — Ctrl+M 으로 붙이고, 앱에서 이름을 바꾸면 따라가고, 앱 밖에서 옮겨도 파일 ID 로 다시 붙는다
  await page.keyboard.press("Backspace");
  await until(async () => (await rowNames()).length >= 7);
  await row("사아자").click();
  await page.keyboard.press("Control+m");
  check("Ctrl+M 메모 칸", await until(() => pane.locator("input.memo-input").count().then((c) => c > 0)));
  await page.keyboard.type("발주처 검토 끝");
  await page.keyboard.press("Enter");
  check("메모가 이름 곁에", await until(() => row("사아자").locator(".memo").textContent().then((t) => t === "발주처 검토 끝")));
  check("메모는 filedesk 파일에", existsSync(MEMOS) && readFileSync(MEMOS, "utf8").includes("발주처 검토 끝"));
  check("파일에는 쓰지 않는다", readFileSync(join(T, "사아자.txt"), "utf8") === "a");
  await page.screenshot({ path: join(SHOTS, "06_메모.png") });
  await row("사아자").click();
  await page.keyboard.press("F2");
  await until(() => pane.locator("input.rename").count().then((c) => c > 0));
  await page.keyboard.type("차카타");
  await page.keyboard.press("Enter");
  check("이름을 바꿔도 메모가 따라간다", await until(() => row("차카타").locator(".memo").count().then((c) => c === 1)));
  renameSync(join(T, "차카타.txt"), join(T, "하위", "차카타.txt")); // 앱 밖에서 옮기기
  await row("하위").dblclick();
  check("앱 밖에서 옮겨도 메모가 다시 붙는다", await until(() => row("차카타").locator(".memo").count().then((c) => c === 1)));
  await row("차카타").locator(".memo").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Enter");
  check("비우면 메모를 뗀다", await until(() => row("차카타").locator(".memo").count().then((c) => c === 0)));
  await page.keyboard.press("Backspace");

  // 10. 「문제 N문서」 — 문제 있는 문서만 거른다 (9-2 끝에서 시험 폴더로 돌아와 있다)
  await until(async () => (await rowNames()).length >= 7);
  const chip = pane.locator(".issue-chip");
  check("문제 칩", (await chip.textContent()) === "문제 1문서", (await chip.textContent()) ?? "");
  await chip.click();
  check("문제 있는 문서만", await until(async () => (await rowNames()).join() === "LDM_D09_테이블정의서.xlsx"), (await rowNames()).join(" · "));
  await page.screenshot({ path: join(SHOTS, "07_문제만.png") });
  await chip.click();
  check("다시 모두", await until(async () => (await rowNames()).length >= 7));

  // 10-1. 직접 그린 제목 줄 — 창 단추 셋 · 최대화 ↔ 이전 크기 · 왼쪽 판 표시
  check("창 단추 셋", (await page.locator(".winctl button").count()) === 3);
  const maxBtn = page.locator(".winctl button").nth(1);
  const before = await maxBtn.getAttribute("aria-label");
  await maxBtn.click();
  const after = await until(async () => ((await maxBtn.getAttribute("aria-label")) !== before ? maxBtn.getAttribute("aria-label") : null));
  check("최대화 단추가 창을 바꾼다", !!after, `${before} → ${after}`);
  await page.screenshot({ path: join(SHOTS, "09_제목줄.png") });
  await maxBtn.click();
  await until(async () => (await maxBtn.getAttribute("aria-label")) === before);
  check("왼쪽 아래 판 표시", /^v\d+\.\d+\.\d+$/.test((await page.locator(".ver-btn").textContent()) ?? ""));

  // 11. 화면 색 — 시스템 → 밝게 → 어둡게. 바탕색이 실제로 바뀌는지 본다.
  const themeBtn = page.locator(".theme-btn");
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("화면 색 기본은 시스템", (await themeBtn.textContent())?.includes("시스템"));
  await themeBtn.click();
  const light = await paper();
  await themeBtn.click();
  const dark = await until(async () => ((await paper()) !== light ? paper() : null));
  check("어둡게로 바꾸면 바탕이 바뀐다", dark && (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", `${light} → ${dark}`);
  await page.screenshot({ path: join(SHOTS, "08_어둡게.png") });
  await themeBtn.click();
  check("다시 시스템으로", (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined);

  check("화면 스크립트 오류 · 404 없음", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("시험 진행", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  if (backup) writeFileSync(SETTINGS, backup);
  else rmSync(SETTINGS, { force: true });
  if (memoBackup) writeFileSync(MEMOS, memoBackup);
  else rmSync(MEMOS, { force: true });
  if (rulesBackup) writeFileSync(RULES, rulesBackup);
  else rmSync(RULES, { force: true });
  rmSync(T, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과 · 캡처 ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
