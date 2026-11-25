// 0.1.18 에서 더한 것을 실제 앱(배포판 exe)에서 본다.
//
//   node e2e/features-0118.mjs
//
// csv · tsv 를 앱 안에서 표로 연다 — CP949 한글 · 따옴표 안 쉼표 · 칸 안 줄바꿈 · 「표 · 글」 바꾸기 · 글로 고치면 표에도 보인다.
// 시험용 임시 폴더에서만 파일을 만들고 끝나면 지운다. 앱 설정은 떠 두었다가 되돌린다.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "../../..");
const EXE = join(ROOT, "target", "release", "filedesk.exe");
const PORT = 9396;
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
const T = join(tmpdir(), `filedesk-f18-${process.pid}`);
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });
// 엑셀이 「CSV (쉼표로 분리)」로 내는 꼴 — CP949 · CRLF
const CSV = '이름,주소,메모\r\n홍길동,"서울시 중구, 세종대로",첫 줄\r\n김철수,부산,"두 줄\r\n메모"\r\n이영희,대구,"따옴표 ""안"""\r\n';
writeFileSync(join(T, "명단.csv"), encodeCp949(CSV));
writeFileSync(join(T, "값.tsv"), "열1\t열2\n가\t1\n나\t2\n");

/** CP949 로 — node 에 인코더가 없어 PowerShell 로 바꾼다. */
function encodeCp949(text) {
  const tmp = join(T, "_utf8.txt");
  writeFileSync(tmp, text, "utf8");
  const out = join(T, "_cp949.bin");
  execFileSync("powershell", ["-NoProfile", "-Command", `[IO.File]::WriteAllText('${out}', [IO.File]::ReadAllText('${tmp}', [Text.Encoding]::UTF8), [Text.Encoding]::GetEncoding(949))`]);
  const b = readFileSync(out);
  rmSync(tmp);
  rmSync(out);
  return b;
}

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [] }));

const app = spawn(EXE, [], {
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(tmpdir(), "filedesk-f18-webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
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
  check("폴더를 연다", await until(async () => (await rowNames()).length >= 2, 10000));

  // 1. csv 를 두 번 누르면 앱 안 표로
  await row("명단").dblclick();
  const table = page.locator(".viewer-table table");
  check("csv 를 표로 연다", await until(() => table.count(), 5000));
  const heads = await table.locator("thead th:not(.n)").allTextContents();
  check("머리 줄 (CP949 한글)", heads.join("|") === "이름|주소|메모", heads.join("|"));
  const cells = await table.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td:not(.n)")].map((td) => td.textContent)));
  check("줄 수 (칸 안 줄바꿈은 한 줄)", cells.length === 3, String(cells.length));
  check("따옴표 안 쉼표는 한 칸", cells[0]?.[1] === "서울시 중구, 세종대로", cells[0]?.[1]);
  check("칸 안 줄바꿈", cells[1]?.[2]?.replace(/\r/g, "") === "두 줄\n메모", JSON.stringify(cells[1]?.[2]));
  check("두 겹 따옴표", cells[2]?.[2] === '따옴표 "안"', cells[2]?.[2]);
  check("인코딩 표시 CP949", await page.locator(".viewer-info", { hasText: "CP949" }).count());
  await page.screenshot({ path: join(SHOTS, "f18-csv.png") });

  // 2. 글로 바꿔 고치면 저장되고, 표로 돌아오면 보인다
  await page.locator(".viewer-info .cs-seg button", { hasText: "글" }).click();
  check("글로 바꾸면 편집기", await until(() => page.locator(".viewer .cm-content").count(), 3000));
  await page.locator(".viewer .cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("박영수,광주,새 줄");
  await page.keyboard.press("Control+s");
  await sleep(800);
  const saved = readFileSync(join(T, "명단.csv"));
  check("고친 글이 CP949 그대로 저장된다", saved.includes(encodeCp949("박영수,광주,새 줄")), `${saved.length}바이트`);
  await page.locator(".viewer-info .cs-seg button", { hasText: "표" }).click();
  check("표로 돌아오면 새 줄이 보인다", await until(() => table.locator("tbody td", { hasText: "박영수" }).count(), 3000));
  await page.keyboard.press("Escape");
  await sleep(400);

  // 3. tsv
  await row("값").dblclick();
  const th2 = await until(async () => {
    const h = await table.locator("thead th:not(.n)").allTextContents();
    return h.length ? h : null;
  }, 5000);
  check("tsv 는 탭으로 나눈다", th2?.join("|") === "열1|열2", th2?.join("|"));
  await page.screenshot({ path: join(SHOTS, "f18-tsv.png") });

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
