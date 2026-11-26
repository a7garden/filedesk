// 사이드바 편집을 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/side-edit.mjs [캡처 폴더]
//
// 오른쪽 메뉴 › 「사이드바 편집」이면 위젯이 카드가 되고, − 로 빼면 아래 「위젯 추가」로 내려가고, ＋ 로 다시 넣으면 맨 아래에 선다.
// 타일은 눌러 이름 · 그림을 바꾸고, 「지금 폴더」로 더하고, − 로 뺀다. 완료 · Esc 로 마치면 평소 모습에 그대로 남고 설정에 적힌다.
// 지난 설정(「드라이브」가 없던 sideOrder)은 「이 PC」 바로 뒤에 드라이브를 끼워 읽는다.
// 시험 폴더는 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9395;
const SETTINGS = join(process.env.APPDATA, "kr.seesun.filedesk", "settings.json");
const SHOTS = process.argv[2] ?? null;

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

const T = join(tmpdir(), `filedesk-side-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(join(T, "업무자료"), { recursive: true });

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
// 지난 판 설정 — 「드라이브」 위젯이 없던 차례
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [join(T, "업무자료")], active: 0 }, view: { sideOrder: ["pc", "favs", "apps", "links", "tags", "smart"], sideOff: [] } }));
const view = () => JSON.parse(readFileSync(SETTINGS, "utf8")).view ?? {};

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-side-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});
let browser;
try {
  browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${PORT}`), 20000, 300);
  if (!browser) throw new Error("앱에 붙지 못했다");
  const page = await until(() => browser.contexts()[0]?.pages()[0], 10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const side = page.locator("nav.side");
  const shot = async (name) => SHOTS && (mkdirSync(SHOTS, { recursive: true }), await side.screenshot({ path: join(SHOTS, `${name}.png`) }));

  check("타일 셋", await until(() => side.locator(".known-grid .known-tile").count().then((c) => c === 3), 10000));
  check("지난 설정은 드라이브를 「이 PC」 바로 뒤에 붙여 읽는다", await side.locator("section.side-tail .drive-list").count() === 1);
  await shot("1-평소");

  // 들어가기 — 타일의 오른쪽 메뉴
  await side.locator(".known-tile").first().click({ button: "right" });
  const menuItem = page.locator(".ctx-menu [role=menuitem]", { hasText: "사이드바 편집" });
  check("오른쪽 메뉴에 「사이드바 편집」", await until(() => menuItem.isVisible(), 2000));
  await menuItem.click();
  check("편집으로 들어간다", await until(() => page.locator("nav.side.editing").isVisible(), 2000));
  const names = () => page.locator(".widget .widget-handle").allTextContents();
  check("위젯마다 카드 한 장", (await names()).join(",") === "이 PC,드라이브,즐겨찾기,앱,색 표시,스마트 폴더", (await names()).join(","));
  check("숨은 연결은 「위젯 추가」에", (await page.locator(".widget-add b").allTextContents()).includes("연결"));
  await shot("2-편집");

  // 빼기 · 다시 넣기
  await page.locator(".widget-x[aria-label='앱 위젯 빼기']").click();
  check("− 로 빼면 카드가 사라진다", !(await names()).includes("앱"));
  check("뺀 위젯은 「위젯 추가」로", (await page.locator(".widget-add b").allTextContents()).includes("앱"));
  check("뺀 것은 설정에 적힌다", await until(() => view().sideOff?.includes("apps"), 3000));
  await page.locator(".widget-add", { hasText: "연결" }).click();
  check("＋ 로 넣으면 맨 아래에 선다", (await names()).at(-1) === "연결", (await names()).join(","));
  check("넣은 것은 설정에 적힌다", await until(() => view().links === true, 3000));

  // 끌어 차례 바꾸기 — 색 표시 머리 줄을 맨 위로
  const grip = page.locator(".widget-handle", { hasText: "색 표시" });
  const g = await grip.boundingBox();
  const top = await page.locator(".widget").first().boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(g.x + g.width / 2, g.y + ((top.y + 4 - g.y) * k) / 12);
  await page.mouse.up();
  check("끌어 차례를 바꾼다", await until(async () => (await names())[0] === "색 표시", 2000), (await names()).join(","));

  // 타일 — 지금 폴더 더하기 · 이름 · 그림
  await page.locator(".tile-add").click();
  check("「지금 폴더」로 타일을 더한다", await until(() => page.locator(".tile-edit .tile-wrap").count().then((c) => c === 4), 2000));
  const nameInput = page.locator(".tile-form-name");
  check("더한 타일이 바로 고르는 판에", (await nameInput.inputValue()) === "업무자료", await nameInput.inputValue());
  await nameInput.fill("업무");
  await nameInput.press("Enter");
  await page.locator(".tile-icons button[aria-label='가방']").click();
  check("이름 · 그림이 설정에 적힌다", await until(() => view().tiles?.some((t) => t.name === "업무" && t.icon === "work"), 3000), JSON.stringify(view().tiles));
  await shot("3-타일-편집");
  // 타일 끌기 — 「업무」를 맨 앞 자리로
  const tileAt = (n) => page.locator(".tile-edit .tile-wrap > .known-tile").nth(n);
  const from = await page.locator(".tile-edit .known-tile", { hasText: "업무" }).boundingBox();
  const first = await tileAt(0).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(from.x + from.width / 2 + ((first.x - from.x) * k) / 12, from.y + from.height / 2 + ((first.y - from.y) * k) / 12);
  await shot("3b-타일-끌기");
  await page.mouse.up();
  const order = () => page.locator(".tile-edit .known-tile span").allTextContents();
  check("타일을 끌어 자리를 옮긴다", await until(async () => (await order())[0] === "업무", 2000), (await order()).join(","));
  check("끈 것은 고르기로 치지 않는다", (await page.locator(".tile-form-name").inputValue()) === "업무");
  await tileAt(0).focus();
  await page.keyboard.press("Control+ArrowRight");
  check("Ctrl+→ 로 한 자리 뒤로", await until(async () => (await order())[1] === "업무", 2000), (await order()).join(","));
  await page.locator(".tile-wrap", { hasText: "다운로드" }).hover();
  await page.locator(".tile-x[aria-label='다운로드 타일에서 제거']").click();
  check("− 로 타일을 뺀다", (await page.locator(".tile-edit .tile-wrap").count()) === 3);

  // 마치기 — Esc 한 번은 고른 타일을 닫고, 두 번째에 편집을 마친다
  await page.locator(".edit-bar span").click();
  await page.keyboard.press("Escape");
  check("Esc 는 고른 타일부터 닫는다", await until(() => page.locator(".tile-form").count().then((c) => c === 0), 1000));
  await page.keyboard.press("Escape");
  check("Esc 로 편집을 마친다", await until(() => page.locator("nav.side.editing").count().then((c) => c === 0), 1000));
  const tiles = await side.locator(".known-grid .known-tile span").allTextContents();
  check("평소 모습에 고친 타일", tiles.join(",") === "바탕화면,업무,문서", tiles.join(","));
  check("앱은 사이드바에 없다", (await side.locator("h2", { hasText: /^앱/ }).count()) === 0);
  await shot("4-마친-뒤");

  // 고친 타일로 간다
  await side.locator(".known-tile", { hasText: "업무" }).click();
  check("고친 타일을 누르면 그 폴더로", await until(() => side.locator(".known-tile.current", { hasText: "업무" }).count().then((c) => c === 1), 3000));

  // 처음대로
  await side.locator(".known-tile").first().click({ button: "right" });
  await page.locator(".ctx-menu [role=menuitem]", { hasText: "이름 · 그림 편집" }).click();
  check("「이름 · 그림 편집」은 그 타일을 고른 채 편집으로", await until(async () => (await nameInput.inputValue()) === "바탕화면", 2000));
  await page.locator("button", { hasText: "타일 처음대로" }).click();
  check("「타일 처음대로」는 세 칸으로", await until(() => view().tiles === null, 3000), JSON.stringify(view().tiles));
  await page.locator(".edit-bar .act.primary").click();
  check("완료로 마친다", await until(() => page.locator("nav.side.editing").count().then((c) => c === 0), 1000));

  check("스크립트 오류 없음", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("시험이 끝까지 돈다", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  app.kill();
  await sleep(500);
  if (backup) writeFileSync(SETTINGS, backup);
  else rmSync(SETTINGS, { force: true });
  rmSync(T, { recursive: true, force: true });
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 통과`);
  process.exit(bad.length ? 1 : 0);
}
