// 0.1.14 에서 더하고 고친 것을 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/features-0114.mjs [캡처 폴더]
//
// 왼쪽 열 즐겨찾기 · 설정에서 끄기 · 수정일 정렬(열 머리 · 오른쪽 메뉴) · 스마트 폴더 머리 경로 · 찾은 결과에서 이름 바꾸기 ·
// 탭을 창 밖으로 끌어 새 창. 시험용 임시 폴더에서만 파일을 만들고 바꾼다. 앱 설정은 떠 두었다가 되돌린다.
// 창 밖 끌기는 CDP 로 창 밖 좌표의 마우스 움직임을 보내 흉내 낸다 — 실제 마우스가 창 밖에서도 움직임을 보내는지는 사람이 본다 (manual-check.md).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9391;
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

const T = join(tmpdir(), `filedesk-f14-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(join(T, "하위"), { recursive: true });
// 수정일이 이름 차례와 엇갈리게 — 이름순 가 · 나 · 다, 수정일 최신순 나 · 다 · 가
const day = 86400;
const now = Date.now() / 1000;
for (const [n, ago] of [["가.txt", 30], ["나.txt", 1], ["다.txt", 10]]) {
  writeFileSync(join(T, n), n);
  utimesSync(join(T, n), now - ago * day, now - ago * day);
}
writeFileSync(join(T, "바꿀문서.txt"), "x");

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(
  SETTINGS,
  JSON.stringify({
    session: { tabs: [T, join(T, "하위")], active: 0 },
    pinned: [{ name: "시험 폴더", path: T }],
    smart: [{ id: "t1", name: "시험 스마트", q: "바꿀", scope: { kind: "roots", roots: [{ path: T, recursive: true }] } }],
  }),
);

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-f14-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
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
  await until(async () => (await rowNames()).length >= 4, 10000);

  // 1. 왼쪽 열 즐겨찾기
  const favs = page.locator(".side .fav-item");
  check("왼쪽 열에 즐겨찾기가 보인다", (await favs.count()) === 1 && (await favs.first().textContent())?.includes("시험 폴더"));
  await page.locator(".side-head", { hasText: "즐겨찾기" }).locator(".side-add").click();
  check("「＋」로 지금 폴더 추가 — 이미 있으면 그대로", (await favs.count()) === 1);

  // 설정에서 끄기
  await page.keyboard.press("Control+,");
  const box = page.locator(".side-mock li", { hasText: /^즐겨찾기/ }).locator("input[role=switch]");
  await box.waitFor({ timeout: 5000 });
  await box.uncheck();
  check("설정에서 끄면 왼쪽 열에서 사라진다", await until(async () => (await favs.count()) === 0, 2000));
  await box.check();
  await page.keyboard.press("Escape");
  await sleep(300);
  if (await page.locator(".settings").count()) await page.keyboard.press("Control+,");

  // 1-1. 「색 표시」 머리글이 없다 · 왼쪽 열 구획 끄기 · 차례
  check("「색 표시」 머리글 없음", (await page.locator(".side h2", { hasText: "색 표시" }).count()) === 0);
  await page.keyboard.press("Control+,");
  const appsBox = page.locator(".side-mock li", { hasText: /^앱/ }).locator("input[role=switch]");
  await appsBox.uncheck();
  check("설정에서 「앱」 구획을 끄면 사라진다", await until(async () => (await page.locator(".side h2", { hasText: /^앱/ }).count()) === 0, 2000));
  await appsBox.check();
  // 스마트 폴더를 맨 위로 — 손잡이를 맨 위 구획 위로 끌어 놓는다
  const smartGrip = page.locator(".side-mock li", { hasText: "스마트 폴더" }).locator("[data-sort-handle]");
  const topBox = await page.locator(".side-mock li").first().boundingBox();
  const gripBox = await smartGrip.boundingBox();
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2, topBox.y + 2, { steps: 12 });
  await page.mouse.up();
  const firstHead = await page.locator(".side h2").first().textContent();
  check("구획을 끌어 옮기면 사이드바도 그 차례", firstHead?.startsWith("스마트 폴더"), firstHead);
  // 되돌리기는 키보드로 — 손잡이에서 ↓ 다섯 번
  for (let i = 0; i < 5; i++) await page.locator(".side-mock li", { hasText: "스마트 폴더" }).locator("[data-sort-handle]").press("ArrowDown");
  check("손잡이 ↓ 로 맨 아래로 돌아간다", (await page.locator(".side-mock li").last().textContent())?.startsWith("스마트 폴더"));
  // 목차 「에이전트 스킬」을 누르면 목차가 그 구획을 가리킨다
  await page.locator(".settings nav button", { hasText: "에이전트 스킬" }).click();
  const tocAt = await until(async () => {
    const t = await page.locator(".settings nav button[aria-current=location]").textContent();
    return t?.includes("에이전트 스킬") ? t : null;
  }, 3000);
  check("설정 목차가 「에이전트 스킬」에 머문다", tocAt, await page.locator(".settings nav button[aria-current=location]").textContent());
  await page.screenshot({ path: join(SHOTS, "f14-settings.png") });
  await page.keyboard.press("Control+,");
  await sleep(300);

  // 2. 수정일 정렬 — 처음 누르면 최신순
  await pane.locator(".cols .col-btn", { hasText: "수정일" }).click();
  const files = async () => (await rowNames()).filter((n) => /^[가나다]\.txt$/.test(n));
  check("수정일 머리를 처음 누르면 최신순", (await files()).join(",") === "나.txt,다.txt,가.txt", (await files()).join(","));
  await pane.locator(".cols .col-btn", { hasText: "이름" }).click();
  check("이름 머리로 돌아가면 가나다순", (await files()).join(",") === "가.txt,나.txt,다.txt", (await files()).join(","));
  // 오른쪽 메뉴 「정렬 기준 › 수정일」
  const list = pane.locator(".list");
  const lb = await list.boundingBox();
  await page.mouse.click(lb.x + lb.width - 30, lb.y + lb.height - 20, { button: "right" });
  await page.locator(".ctx-menu [role=menuitem]", { hasText: "정렬 기준" }).first().hover();
  await page.locator(".ctx-menu [role=menuitemcheckbox]", { hasText: "수정일" }).first().click();
  // 메뉴는 닫은 뒤 다음 그림에서 일을 한다 — 기다려 본다
  const byMenu = await until(async () => (await files()).join(",") === "나.txt,다.txt,가.txt", 2000);
  check("오른쪽 메뉴 「정렬 기준 › 수정일」 — 최신순", byMenu, (await files()).join(","));

  // 3. 스마트 폴더 — 머리 경로가 스마트 폴더 이름으로
  await page.locator(".side .smart-item", { hasText: "시험 스마트" }).click();
  const crumbs = () => pane.locator(".crumbs .crumb").allTextContents();
  const c = await until(async () => {
    const x = await crumbs();
    return x.join("/") === "스마트 폴더/시험 스마트" ? x : null;
  }, 5000);
  check("스마트 폴더를 열면 머리가 「스마트 폴더 / 이름」", c, (await crumbs()).join(" / "));
  check("탭 이름도 스마트 폴더 이름", await until(async () => (await page.locator(".tab.active .tab-name").textContent()) === "시험 스마트", 3000), await page.locator(".tab.active .tab-name").textContent());
  await until(async () => (await rowNames()).includes("바꿀문서.txt"), 8000);
  await page.screenshot({ path: join(SHOTS, "f14-smart.png") });

  // 4. 찾은 결과에서 이름 바꾸기 — 그 자리에서 새 이름
  await pane.locator(".row", { hasText: "바꿀문서.txt" }).first().click();
  await page.keyboard.press("F2");
  const input = pane.locator("input.rename");
  await input.waitFor({ timeout: 3000 });
  await input.fill("바꾼문서.txt");
  await page.keyboard.press("Enter");
  check("찾은 결과에서 바꾼 이름이 바로 보인다", await until(async () => (await rowNames()).includes("바꾼문서.txt"), 4000), (await rowNames()).join(","));
  check("파일 이름이 실제로 바뀌었다", existsSync(join(T, "바꾼문서.txt")));

  // 뒤로 → 모아 보기 끝, 원래 폴더 경로
  await pane.locator(".nav-btns button[aria-label=뒤로]").click();
  const back = await until(async () => {
    const x = await crumbs();
    return x[x.length - 1]?.startsWith("filedesk-f14") ? x : null;
  }, 3000);
  check("뒤로 누르면 모아 보기를 끝내고 폴더로", back, (await crumbs()).join(" / "));

  // 4-1. 오른쪽 메뉴 — 스마트 폴더 복제 · 탭 메뉴
  await page.locator(".side .smart-item", { hasText: "시험 스마트" }).click({ button: "right" });
  check("스마트 폴더 오른쪽 메뉴에 편집 · 복제 · 삭제", (await page.locator(".ctx-menu").textContent())?.match(/편집.*복제.*삭제/s), await page.locator(".ctx-menu").textContent());
  await page.locator(".ctx-menu [role=menuitem]", { hasText: "복제" }).click();
  check("복제하면 「복사본」이 생긴다", await until(async () => (await page.locator(".side .smart-item", { hasText: "시험 스마트 복사본" }).count()) === 1, 2000));
  await page.locator(".tab", { hasText: "하위" }).first().click({ button: "right" });
  check("탭 오른쪽 메뉴에 새 창 · 닫기", (await page.locator(".ctx-menu").textContent())?.match(/새 창으로 열기.*탭 닫기/s));
  await page.keyboard.press("Escape");
  await page.mouse.click(600, 400);
  await sleep(200);

  // 5. 탭을 창 밖으로 끌면 새 창
  const tabsBefore = await page.locator(".tab").count();
  const tab = page.locator(".tab", { hasText: "하위" }).first();
  const tb = await tab.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 40, tb.y + 40, { steps: 4 });
  const vw = await page.evaluate(() => window.innerWidth);
  await page.mouse.move(vw + 120, tb.y + 200, { steps: 6 });
  const ghostOut = await page.locator(".tab-ghost.out").count();
  check("창 밖으로 끌면 「새 창으로 열기」", ghostOut === 1);
  await page.mouse.up();
  const newPage = await until(() => browser.contexts().flatMap((x) => x.pages()).find((pg) => pg !== page && pg.url().includes("path=")), 8000);
  check("새 창이 뜬다", newPage, newPage?.url());
  check("이 창에서는 그 탭이 빠진다", await until(async () => (await page.locator(".tab").count()) === tabsBefore - 1, 3000));
  if (newPage) {
    await newPage.waitForSelector("section.pane:not([hidden]) .crumbs", { timeout: 8000 });
    const last = await newPage.locator("section.pane:not([hidden]) .crumb.here").textContent();
    check("새 창은 그 폴더를 연다", last === "하위", last);
    check("새 창에도 왼쪽 열 즐겨찾기", (await newPage.locator(".side .fav-item").count()) === 1);
    await newPage.screenshot({ path: join(SHOTS, "f14-newwin.png") });
    // 새 창에서 더한 즐겨찾기가 주 창에도
    await newPage.locator(".side-head", { hasText: "즐겨찾기" }).locator(".side-add").click();
    check("새 창에서 더한 즐겨찾기가 주 창에도 보인다", await until(async () => (await page.locator(".side .fav-item").count()) === 2, 4000));
    await sleep(1200);
    const saved = JSON.parse(readFileSync(SETTINGS, "utf8"));
    check("새 창은 주 창의 열어 둔 탭을 덮지 않는다", saved.session?.tabs?.length === 1 && saved.session.tabs[0] === T, JSON.stringify(saved.session));
  }
  check("화면 오류 없음", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("시험 진행", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  // 떼어 낸 창도 같은 프로세스라 함께 닫힌다
  app.kill();
  await sleep(1000);
  if (backup) writeFileSync(SETTINGS, backup);
  else rmSync(SETTINGS, { force: true });
  rmSync(T, { recursive: true, force: true });
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} 통과 · 캡처 ${SHOTS}`);
process.exit(ok === results.length ? 0 : 1);
