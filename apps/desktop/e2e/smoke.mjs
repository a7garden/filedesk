// 실제 앱(배포판 exe)을 띄워 화면을 조작해 보는 시험.
//
//   node e2e/smoke.mjs [캡처 폴더]
//
// WebView2 의 원격 디버깅 포트로 Playwright 를 붙인다. 셸 메뉴 · 앱 밖 끌기는 창 밖 일이라 여기서 못 본다 (사람이 본다).
// 시험용 임시 폴더에서만 파일을 만들고 바꾼다. 휴지통 시험은 그 폴더의 빈 파일 하나를 휴지통으로 보낸다.
// 앱 설정(열어 둔 탭 · 고정 위치)은 시험 전에 떠 두었다가 끝나면 되돌린다 — 시험이 사용자 설정을 바꾸지 않게.
import { execFileSync, spawn } from "node:child_process";
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
  // 판 눈금 — 이름에 날짜 없는 판(세로 금), 1년 전 문서(축이 1년 넘게 이어진다). 둘 다 문제는 없다.
  "안내문_v2_20261101.docx": "g2",
  "이전판/안내문_v1.docx": "g1",
  "예전계획_v2_20251101.hwpx": "p2",
  "이전판/예전계획_v1_20251001.hwpx": "p1",
};
for (const [n, c] of Object.entries(files)) writeFileSync(join(T, n), c);

const backup = existsSync(SETTINGS) ? readFileSync(SETTINGS) : null;
// 메모도 떠 두었다가 되돌린다 — 시험 메모가 사용자 메모 파일에 남지 않게.
const memoBackup = existsSync(MEMOS) ? readFileSync(MEMOS) : null;
mkdirSync(join(SETTINGS, ".."), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ session: { tabs: [T], active: 0 }, pinned: [{ name: "시험 폴더", path: T }] }));

const app = spawn(EXE, [], {
  // WebView2 데이터 폴더를 따로 둔다 — 사용자가 켜 둔 filedesk 와 같은 폴더를 쓰면
  // 새 창이 그 브라우저 프로세스에 붙어 디버깅 포트가 열리지 않는다 (11-11: 설치본을 켜 둔 채 시험이 붙지 못함).
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
  // 2026.11.13 : 판 눈금(점)을 걷고 판 글자 「v3 … · 2판」. pptx · pdf 는 한 판으로 센다 — 보고서는 v3(pptx · pdf) · v2 두 판
  const verOf = (name) => row(name).locator(".ver-btn").textContent();
  check("판 글자 — 판 수", ((await verOf("보고서")) ?? "").includes("· 2판"), (await verOf("보고서")) ?? "");
  check("D09 판 겹침은 문제 줄로", (await pane.locator(".row.issue-line", { hasText: "v1.6 이 여러 날짜" }).count()) === 1);
  check("판 눈금은 없다", (await pane.locator("svg.ticks").count()) === 0);
  // 판 목록 — 판 글자를 누르면 이전판까지 한 줄씩 (새 판이 위로 · pptx · pdf 는 한 줄)
  await row("보고서").locator(".ver-btn").click();
  const edRows = await until(async () => {
    const t = await page.locator(".ed-list .ed-row").allInnerTexts();
    return t.length ? t.map((s) => s.replace(/\s+/g, " ")) : null;
  }, 3000);
  check(
    "판 눈금을 누르면 판 목록 — 이전판까지",
    edRows?.length === 2 && edRows[0].includes("v3") && edRows[0].includes("이 폴더") && edRows[0].includes("pdf") && edRows[1].includes("v2") && edRows[1].includes("이전판"),
    edRows?.join(" / "),
  );
  await sleep(300); // 나타나는 움직임이 끝난 뒤 찍는다
  await page.screenshot({ path: join(SHOTS, "edition-list.png") });
  await page.keyboard.press("Escape");
  check("Esc 로 판 목록이 닫힌다", await until(async () => (await page.locator(".ed-list").count()) === 0, 2000));
  // 열 경계선 — 머리 손잡이에 올리면 그 열의 선이 진해진다
  await pane.locator(".cols .col-2 > .resizer").hover();
  const guideW = await pane.locator(".col-guides .guide.col-2").evaluate((g) => getComputedStyle(g, "::before").width);
  check("손잡이에 올리면 열 경계선이 진해진다", guideW === "2px", guideW);
  await page.mouse.move(10, 10);
  check("셸 아이콘이 그려진다", await until(() => row("가나다").locator("img").evaluate((img) => img.complete && img.naturalWidth > 0), 5000));
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
  // 2026.11.13 : 이 폴더 문서의 「「폴더」 폴더에 판이 2개」는 「최신판 곁에 지난 판 1개」로 보인다 (util.issueText)
  const meet = pane.locator(".row.issue-line", { hasText: "최신판 곁에 지난 판 1개" });
  check("같은 자리 판 둘은 문제 줄", await until(() => meet.count().then((c) => c === 1)));
  await meet.locator("button", { hasText: "이전판」 폴더로" }).click();
  // 계획을 띄우면 문제 문장 자리에 옮길 목록이 선다 — 그 줄을 새로 찾는다
  const planRow = pane.locator(".row.issue-line", { hasText: "폴더로 옮김" });
  check("옮길 판을 먼저 보인다", await until(() => planRow.textContent().then((t) => t.includes("회의자료_v1_20261001.pptx") && !t.includes("v2"))));
  await page.screenshot({ path: join(SHOTS, "04_문제줄_옮김계획.png") });
  await planRow.locator("button.primary").click();
  check("지난 판만 이전판으로", await until(() => existsSync(join(T, "이전판", "회의자료_v1_20261001.pptx")), 6000) && existsSync(join(T, "회의자료_v2_20261005.pptx")));
  check("고치고 나면 문제 줄이 사라진다", await until(() => pane.locator(".row.issue-line", { hasText: "최신판 곁에 지난 판" }).count().then((c) => c === 0)));


  // 9-2. 메모 — Ctrl+M 으로 붙이고, 앱에서 이름을 바꾸면 따라가고, 앱 밖에서 옮겨도 파일 ID 로 다시 붙는다
  await page.keyboard.press("Backspace");
  await until(async () => (await rowNames()).length >= 7);
  await row("사아자").click();
  await page.keyboard.press("Control+m");
  check("Ctrl+M 메모 칸", await until(() => pane.locator(".memo-input").count().then((c) => c > 0)));
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

  // 10. 「문제 문서 N개」 — 처리함 창 (9-2 끝에서 시험 폴더로 돌아와 있다).
  //     2026.11.13 : 거르기 → 처리함. 지난 판이 최신판 곁에 남은 문서(계획)를 잠깐 만들어 옮기기까지 본다
  await until(async () => (await rowNames()).length >= 7);
  writeFileSync(join(T, "계획_v1_20261101.docx"), "v1");
  writeFileSync(join(T, "계획_v2_20261105.docx"), "v2");
  const chip = pane.locator(".issue-chip");
  check("문제 칩", await until(async () => (await chip.textContent()) === "문제 문서 2개"), (await chip.textContent()) ?? "");
  const rowsBefore = (await rowNames()).length;
  await chip.click();
  const inbox = page.locator(".ix");
  check("처리함이 뜬다 · 문서 둘", await until(() => inbox.locator(".ix-item").count().then((c) => c === 2)));
  check("목록은 거르지 않는다", (await rowNames()).length === rowsBefore);
  await inbox.locator(".ix-item", { hasText: "계획" }).click();
  check("옮길 판을 미리 보인다 — 처리 뒤 모습", await until(() => inbox.locator(".ix-ed.out", { hasText: "계획_v1_20261101.docx" }).count().then((c) => c === 1)));
  await page.screenshot({ path: join(SHOTS, "07_문제처리함.png") });
  await inbox.locator(".ix-acts .act.primary").click();
  check("옮기면 처리함에서 빠지고 다음 문서로", await until(() => inbox.locator(".ix-item").count().then((c) => c === 1)) && (await inbox.locator(".ix-doc").textContent())?.startsWith("LDM_D09"));
  check("지난 판은 「이전판」 폴더로", existsSync(join(T, "이전판", "계획_v1_20261101.docx")) && !existsSync(join(T, "계획_v1_20261101.docx")));
  await inbox.locator(".ix-acts .act", { hasText: "목록에서" }).click();
  check("「목록에서 보기」 — 창을 닫고 그 문서를 고른다", await until(async () => (await inbox.count()) === 0 && (await pane.locator(".row.selected", { hasText: "LDM_D09" }).count()) === 1));
  await chip.click();
  await inbox.locator(".ix-acts .act", { hasText: "건너뛰기" }).click();
  check("건너뛰면 빈 처리함", await until(() => inbox.locator(".ix-empty").count().then((c) => c === 1)));
  await page.keyboard.press("Escape");
  check("Esc 로 닫는다", await until(() => inbox.count().then((c) => c === 0)));
  rmSync(join(T, "계획_v2_20261105.docx"));
  rmSync(join(T, "이전판", "계획_v1_20261101.docx"));
  await until(async () => !(await rowNames()).some((n) => n.startsWith("계획")));

  // 10-2. 이전판 감시 — 이전판 안에만 파일이 생겨도 판 눈금이 따라온다 (감시는 한 단계라 이전판을 따로 본다)
  writeFileSync(join(T, "이전판", "보고서_v1_20260901.pptx"), "v1");
  check("이전판 안만 바뀌어도 판 수가 따라온다", await until(async () => ((await row("보고서").locator(".ver-btn").textContent()) ?? "").includes("· 3판"), 6000));

  // 10-3. 종류 거르기 — 이 폴더에 있는 종류만 칩으로. 「표」를 누르면 xlsx 만
  const kindBtn = (label) => pane.locator(".kinds .kind", { hasText: label }).first();
  check("종류 칩", await until(() => kindBtn("표").count().then((c) => c === 1)), (await pane.locator(".kinds").textContent()) ?? "");
  await kindBtn("표").click();
  check("표만 거른다", await until(async () => {
    const n = await rowNames();
    return n.length > 0 && n.every((x) => x.endsWith(".xlsx"));
  }), (await rowNames()).join(" · "));
  await kindBtn("표").click();
  await until(async () => (await rowNames()).length >= 7);

  // 10-4. 색 표시 — Alt+2(주황) → 이름 곁 점 · 메모 파일에 · 색 칩으로 거르기 · Alt+0 으로 뗀다 · 「색」 단추로 고르기
  await row("회의자료").click();
  await page.keyboard.press("Alt+2");
  check("Alt+2 로 색 표시", await until(() => row("회의자료").locator(".tag-dot.tag-orange").count().then((c) => c === 1)));
  check("색은 filedesk 메모 파일에", await until(() => existsSync(MEMOS) && readFileSync(MEMOS, "utf8").includes('"orange"')));
  await pane.locator(".kinds .kind-color").first().click();
  check("색으로 거르기", await until(async () => (await rowNames()).length === 1), (await rowNames()).join(" · "));
  await pane.locator(".kinds .kind-color").first().click();
  await until(async () => (await rowNames()).length >= 7);
  await row("회의자료").click();
  await page.keyboard.press("Alt+0");
  check("Alt+0 으로 뗀다", await until(() => row("회의자료").locator(".tag-dot").count().then((c) => c === 0)));
  await row("보고서").hover();
  await row("보고서").locator(".tag-add").click();
  check("색 고르기 창 — 일곱 색", await until(() => page.locator(".tag-menu .tag-swatch").count().then((c) => c === 7)));
  await page.locator(".tag-menu [data-color=blue]").click();
  check("고르기 창에서 파랑", await until(() => row("보고서").locator(".tag-dot.tag-blue").count().then((c) => c === 1)));
  await page.screenshot({ path: join(SHOTS, "10_색표시.png") });

  // 10-4b. 오른쪽 메뉴 — filedesk 가 그린다 (2026.11.13~). 셸 메뉴는 맨 아래 「더 보기」라 여기서는 열지 않는다 (사람이 본다)
  {
    const menu = page.locator(".ctx-menu");
    await row("회의자료").click({ button: "right" });
    check("오른쪽 메뉴가 뜬다", await until(() => menu.count().then((c) => c === 1)));
    check("단추 줄 넷 · 열기 · 더 보기", (await menu.locator(".ctx-quick button").count()) === 4 && (await menu.locator(".ctx-item", { hasText: "열기" }).count()) >= 1 && (await menu.locator(".ctx-item", { hasText: "더 보기" }).count()) === 1);
    await page.screenshot({ path: join(SHOTS, "10a_파일메뉴.png") });
    await menu.locator(".tag-swatch.tag-green").click();
    check("메뉴의 색 점으로 바로 색 표시", await until(() => row("회의자료").locator(".tag-dot.tag-green").count().then((c) => c === 1)));
    check("고르면 메뉴가 닫힌다", (await menu.count()) === 0);
    await row("회의자료").click();
    await page.keyboard.press("Alt+0");
    await until(() => row("회의자료").locator(".tag-dot").count().then((c) => c === 0));
    await page.keyboard.press("ContextMenu");
    check("메뉴 키로도 뜬다", await until(() => menu.count().then((c) => c === 1)));
    await page.keyboard.press("ArrowDown");
    check("↓ 로 첫 자리에 초점", await until(() => page.evaluate(() => !!document.activeElement?.closest(".ctx-menu") && document.activeElement?.tagName === "BUTTON")));
    await page.keyboard.press("Escape");
    check("Esc 로 닫힌다 · 목록은 그대로", await until(() => menu.count().then((c) => c === 0)) && (await rowNames()).length >= 7);
    const lb = await pane.locator(".list").boundingBox();
    await page.mouse.click(lb.x + lb.width - 30, lb.y + lb.height - 20, { button: "right" });
    check("빈 곳 메뉴 — 새 폴더 · 보기", await until(() => menu.locator(".ctx-item", { hasText: "새 폴더" }).count().then((c) => c === 1)));
    await menu.first().locator(".ctx-item", { hasText: "보기" }).first().hover();
    check("「보기」에 올리면 하위 메뉴", await until(() => menu.count().then((c) => c === 2)));
    await page.screenshot({ path: join(SHOTS, "10b_오른쪽메뉴.png") });
    await page.mouse.click(lb.x + lb.width - 30, lb.y + lb.height - 20);
    check("밖을 누르면 닫힌다", await until(() => menu.count().then((c) => c === 0)));
  }

  // 10-5. 아래 폴더까지 찾기 — 하위\차카타.txt 는 이 폴더 거르기에 없고, Shift+Enter 로 찾는다
  await page.keyboard.press("Control+f");
  await page.keyboard.type("차카타");
  // 3fcf556 부터 빈 결과는 글 대신 다음 동작(「하위 폴더까지 찾기」)을 보인다
  check("이 폴더 거르기에는 없다", await until(() => pane.locator(".empty button", { hasText: "하위 폴더까지 찾기" }).count().then((c) => c === 1)));
  await page.keyboard.press("Shift+Enter");
  check("아래 폴더까지 찾기", await until(async () => (await rowNames()).some((n) => n.startsWith("차카타"))), (await rowNames()).join(" · "));
  check("찾은 자리를 곁에 적는다", (await row("차카타").locator(".where").textContent()) === "하위");
  await page.screenshot({ path: join(SHOTS, "11_아래폴더찾기.png") });
  // 2026.11.13 : Tab · Shift+Tab 으로 범위를 돌린다 — 이 폴더 → 하위 폴더까지 → 모든 드라이브. 찾는 말이 있을 때만
  const pressed = (label) => pane.locator(".scope button", { hasText: label }).getAttribute("aria-pressed").then((v) => v === "true");
  await pane.locator("input.filter").press("Tab");
  check("Tab — 모든 드라이브로", await until(() => pressed("모든 드라이브")));
  await pane.locator("input.filter").press("Tab");
  check("Tab — 한 바퀴 돌아 이 폴더로", await until(() => pressed("이 폴더")));
  await pane.locator("input.filter").press("Shift+Tab");
  check("Shift+Tab — 거꾸로 모든 드라이브로", await until(() => pressed("모든 드라이브")));
  await pane.locator("input.filter").press("Shift+Tab");
  check("Shift+Tab — 하위 폴더까지로", await until(() => pressed("하위 폴더까지")));
  await pane.locator("input.filter").press("Control+Enter");
  check("Ctrl+Enter — 문서 본문까지 켠다", await until(() => pressed("문서 본문까지")));
  await pane.locator("input.filter").press("Control+Enter");
  check("Ctrl+Enter — 다시 누르면 끈다 · 범위는 그대로", await until(async () => !(await pressed("문서 본문까지")) && (await pressed("하위 폴더까지"))));
  await pane.locator("input.filter").press("Escape");
  await until(async () => (await rowNames()).length >= 7);

  // 10-6. 즐겨찾기 — 파일을 고르고 Ctrl+D → 아래 독에 파일로. 더한 순간 독이 잠깐 올라와 그 타일을 밝힌다
  await row("LDM_D09").click();
  await page.keyboard.press("Control+d");
  check("파일을 즐겨찾기에", await until(() => page.locator(".dock li[data-pin-index]", { hasText: "LDM_D09" }).count().then((c) => c === 1)));
  check("더하면 독이 올라와 밝힌다", await until(() => page.locator(".dock.open .dock-tile.fresh", { hasText: "LDM_D09" }).count().then((c) => c === 1), 1200));
  check("잠시 뒤 독이 내려간다", await until(() => page.locator(".dock.open").count().then((c) => c === 0), 3000));
  // 2026.11.12 : 바닥 줄 가운데 어디든 마우스가 지나면 올라온다 · 바닥 줄 단추 위에서는 올라오지 않는다
  {
    const box = await page.locator(".dock").boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 4 });
    check("바닥 줄에 마우스를 대면 독이 올라온다", await until(() => page.locator(".dock.near .dock-shelf").isVisible(), 1500));
    await page.screenshot({ path: join(SHOTS, "10_독_올라옴.png") });
    const shelf = await page.locator(".dock-shelf").boundingBox();
    await page.mouse.move(shelf.x + shelf.width / 2, shelf.y + shelf.height / 2, { steps: 4 });
    check("선반으로 올라가도 열려 있다", await page.locator(".dock-shelf").isVisible());
    const fold = await page.locator("section.pane:not([hidden]) .foot-toggle").first().boundingBox();
    await page.mouse.move(fold.x + fold.width / 2, fold.y + fold.height / 2, { steps: 4 });
    check("판 접기 단추 위에서는 내려간다", await until(() => page.locator(".dock-shelf").isHidden(), 1500));
  }

  // 10-6-1. 끌어서 고르기 (2026.11.12) — 줄의 이름 밖(고친 날 칸)에서 누르고 아래 줄까지 끌면 걸친 줄을 모두 고른다
  {
    const a = await row("산출물").locator(".cell.date").boundingBox();
    const b = await row("하위").locator(".cell.date").boundingBox();
    await page.mouse.move(a.x + 4, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x - 40, b.y + b.height / 2, { steps: 8 });
    check("끄는 동안 네모가 보인다", await pane.locator(".marquee").count() === 1);
    await page.mouse.up();
    const n = await pane.locator(".row.selected").count();
    check("끌어서 여러 줄을 고른다", n === 5, `${n}줄`);
    check("놓으면 네모가 사라진다", await pane.locator(".marquee").count() === 0);
    await page.keyboard.press("Escape");
  }

  // 10-6-2. 왼쪽 「색 표시」 건반 일곱 · 「연결」 주소 칸 (2026.11.12)
  check("색 표시 건반 일곱", await page.locator(".tag-keys .tag-key").count() === 7);
  check("쓴 색은 찬 건반", await page.locator(".tag-key.used").count() >= 1);
  // 연결은 설정에서 켜야 보인다 — NAS 를 안 쓰는 사람에게는 없는 구획이다
  check("연결은 처음에 없다", await page.locator(".link-form").count() === 0);
  await page.locator(".settings-btn").click();
  await page.locator(".settings label.set-check", { hasText: "왼쪽 열의 연결" }).click();
  await page.keyboard.press("Escape");
  check("설정에서 켜면 연결 주소 칸이 선다", await until(() => page.locator(".link-form input").count().then((c) => c === 1)));
  await page.locator(".link-form input").fill(join(T, "자료"));
  await page.locator(".link-form input").press("Enter");
  check("주소를 적고 Enter 로 연결을 더한다", await until(() => page.locator(".link-share", { hasText: "자료" }).count().then((c) => c === 1)));
  check("연결은 묶는 이름 밑에", (await page.locator(".link-server").first().textContent()).startsWith("C:"));
  await page.screenshot({ path: join(SHOTS, "10_왼쪽열.png"), clip: { x: 0, y: 0, width: 240, height: 800 } });

  // 10-7. 나눠 보기 — Ctrl+\ 로 두 칸 · 오른쪽 칸만 옮기기 · 칸 너비 끌기 · 탭을 끌어 칸 가운데에 놓기 · 다시 Ctrl+\
  //       · 탭을 칸 가장자리로 끌어 네 칸까지 나누기 · 칸 높이 끌기 · 다섯째는 나누지 않고 그 칸으로 옮긴다
  //       칸 사이 파일 끌기는 셸 끌기(OLE)라 여기서 못 본다 — 사람이 본다.
  const panes = page.locator("section.pane:not([hidden])");
  await page.keyboard.press("Control+\\");
  check("나눠 보기 — 두 칸", await until(() => panes.count().then((c) => c === 2)));
  const focused = page.locator("section.pane.focused-pane");
  check("오른쪽 칸이 키보드를 받는다", await until(() => focused.count().then((c) => c === 1)));
  // 2026.11.13 : 지금 칸은 탭 밑줄 하나로 — 칸 위 띠를 걷었다 · 다른 칸의 지금 탭은 회색(dim). 독은 지금 칸의 바닥 가운데에 선다
  check("다른 칸의 탭 줄은 흐리다", (await page.locator(".tabs.dim").count()) === 1 && (await page.locator(".tabs.focused").count()) === 1);
  {
    const fb = await focused.boundingBox();
    const db = await page.locator(".dock").boundingBox();
    const mid = db.x + db.width / 2;
    check("독은 지금 칸 바닥 가운데에", Math.abs(mid - (fb.x + fb.width / 2)) < 24 && db.width < fb.width, `독 ${Math.round(mid)} · 칸 ${Math.round(fb.x + fb.width / 2)}`);
    // 파일을 끌어 칸 바닥 줄로 가져오면 독이 열린다 — 셸 끌기는 흉내 낼 수 없어 Tauri 끌기 이벤트를 보낸다
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const foot = await panes.first().locator(".foot").boundingBox();
    const emit = (event, x, y) => page.evaluate(([event, x, y]) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event, payload: { paths: [], position: { x, y } } }), [event, x, y * 1]);
    await emit("tauri://drag-enter", (foot.x + 40) * dpr, (foot.y - 200) * dpr);
    await emit("tauri://drag-over", (foot.x + 40) * dpr, (foot.y + foot.height / 2) * dpr);
    check("끌어서 바닥 줄로 오면 독이 열린다", await until(() => page.locator(".dock.open").count().then((c) => c === 1), 2000));
    await emit("tauri://drag-leave", 0, 0);
    check("끌기를 거두면 닫힌다", await until(() => page.locator(".dock.open").count().then((c) => c === 0), 2000));
    // 앱 안에서 줄을 끄는 동안은 Rust 끌기 소스가 자리를 fd:drag-at 으로 보낸다 (Tauri 알림은 끌기가 끝날 때까지 묶인다 — 2026.11.13)
    const at = (d) => page.evaluate((d) => window.dispatchEvent(new CustomEvent("fd:drag-at", { detail: d })), d);
    await at({ x: Math.round((foot.x + 40) * dpr), y: Math.round((foot.y + foot.height / 2) * dpr) });
    check("앱 안 끌기 — 바닥 줄로 오면 독이 열린다", await until(() => page.locator(".dock.open").count().then((c) => c === 1), 2000));
    await at(null);
    // 끝난 뒤 묶여 있던 지난 알림(들어옴 · 화면 좌표)이 와도 독을 접지 않는다 — 놓기 · 떠남만 받는다
    await emit("tauri://drag-enter", 1, 1);
    await sleep(300);
    check("끝난 뒤 늦게 온 지난 알림은 무시한다", (await page.locator(".dock.open").count()) === 1);
    await emit("tauri://drag-leave", 0, 0);
    check("떠남이 오면 접는다", await until(() => page.locator(".dock.open").count().then((c) => c === 0), 2000));
  }
  await focused.locator(".row", { hasText: "하위" }).first().dblclick();
  check(
    "오른쪽 칸만 옮긴다",
    await until(async () => (await focused.locator(".crumb.here").textContent()) === "하위" && (await panes.first().locator(".crumb.here").textContent()) !== "하위"),
  );
  const div = await page.locator(".divider").boundingBox();
  await page.mouse.move(div.x + 2, div.y + 200);
  await page.mouse.down();
  await page.mouse.move(div.x - 160, div.y + 200, { steps: 6 });
  await page.mouse.up();
  const widths = await panes.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  check("칸 너비를 끌어 바꾼다", widths[0] < widths[1], widths.join(" · "));
  await page.screenshot({ path: join(SHOTS, "12_나눠보기.png") });
  await sleep(300); // 칸 사이 줄 끌기가 끝난 뒤에 탭을 끈다 — 곧바로 끌면 덮개가 가끔 안 떴다
  const tab0 = await page.locator(".tab").first().boundingBox();
  const area = await page.locator(".panes").boundingBox();
  await page.mouse.move(tab0.x + 20, tab0.y + 10);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.8, area.y + area.height / 2, { steps: 8 });
  check("탭을 칸 가운데로 끌면 그 칸 덮개가 보인다", await until(() => page.locator(".split-drop.whole").count().then((c) => c === 1), 2000));
  await page.mouse.up();
  // 2026.11.11 : 칸마다 탭 묶음이 된 뒤로 가운데에 놓으면 그 칸의 탭이 된다 — 탭 하나짜리 칸은 접혀 한 칸 · 탭 둘.
  //              (예전 시험은 두 칸 시절의 「맞바꾸기」를 보았다)
  check(
    "가운데에 놓으면 그 칸의 탭이 된다 (한 칸 · 탭 둘)",
    await until(async () => (await panes.count()) === 1 && (await page.locator(".tab").count()) === 2),
    `칸 ${await panes.count()} · 탭 ${await page.locator(".tab").count()}`,
  );

  // 끌어서 나누기 — 탭을 칸 가장자리에 놓으면 그쪽 반에 새 칸. 넷까지.
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+t");
  const dragTab = async (tab, x, y, cls) => {
    const b = await tab.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    const seen = await until(() => page.locator(`.split-drop.${cls}`).count().then((c) => c === 1), 2000);
    await page.mouse.up();
    return seen;
  };
  const A = await page.locator(".panes").boundingBox();
  check("오른쪽 가장자리 — 그쪽 반이 덮인다", await dragTab(page.locator(".tab").last(), A.x + A.width - 30, A.y + A.height / 2, "edge-right"));
  check("끌어서 두 칸", await until(() => panes.count().then((c) => c === 2)));
  check("오른쪽 칸 아래 가장자리", await dragTab(page.locator(".tab").first(), A.x + A.width * 0.75, A.y + A.height - 24, "edge-bottom"));
  check("끌어서 세 칸 (오른쪽이 위아래로)", await until(() => panes.count().then((c) => c === 3)));
  check("아래쪽 칸은 제 칸 위에 탭 줄", (await page.locator(".tabs.in-pane").count()) >= 1);
  check("왼쪽 칸 아래 가장자리", await dragTab(page.locator(".tab").first(), A.x + A.width * 0.25, A.y + A.height - 24, "edge-bottom"));
  check("끌어서 네 칸", await until(() => panes.count().then((c) => c === 4)));
  const across = page.locator(".divider.across").first();
  const ab = await across.boundingBox();
  await page.mouse.move(ab.x + 40, ab.y + 2);
  await page.mouse.down();
  await page.mouse.move(ab.x + 40, ab.y - 120, { steps: 6 });
  await page.mouse.up();
  const ab2 = await across.boundingBox();
  check("칸 높이를 끌어 바꾼다", ab2.y < ab.y - 60, `${Math.round(ab.y)} → ${Math.round(ab2.y)}`);
  await page.screenshot({ path: join(SHOTS, "12b_네칸.png") });
  // 탭 둘인 칸(왼쪽 위)의 탭을 다른 칸(오른쪽 아래) 가장자리로 — 나누면 다섯째가 되므로 그 칸으로 옮긴다.
  // 탭 하나짜리 칸의 탭이면 그 칸이 접혀 넷 그대로라 가장자리 나누기(자리 바꾸기)가 맞다 — 그래서 그 탭으로는 시험하지 않는다.
  check("다섯째는 나누지 않고 그 칸으로 옮긴다", await dragTab(page.locator(".tab").first(), A.x + A.width - 30, A.y + A.height - 60, "whole"));
  check("여전히 네 칸", (await panes.count()) === 4);
  await page.keyboard.press("Control+\\");
  check("한 칸으로 모은다", await until(() => panes.count().then((c) => c === 1)));
  // 모은 뒤 앞에 선 탭이 어느 폴더인지는 끌어 온 차례에 달렸다 — 다음 시험을 위해 시험 폴더로 돌아간다 (주소 줄)
  await page.keyboard.press("Control+l");
  await pane.locator("input.path-input").fill(T);
  await pane.locator("input.path-input").press("Enter");
  await until(async () => (await rowNames()).some((n) => n.startsWith("보고서")), 5000);

  // 10-8. 설정 창 — 보기 · Claude 스킬
  await page.locator(".settings-btn").click();
  check("설정 창", await until(() => page.locator(".settings").count().then((c) => c === 1)));
  check("설정은 보기부터", (await page.locator(".set-nav button[aria-current]").textContent()) === "보기");
  check("앱 판은 설정 안에만", /v\d+\.\d+\.\d+/.test((await page.locator(".set-ver").textContent()) ?? "") && (await page.locator(".side-foot").textContent())?.trim() === "설정");
  check("고르기는 라디오", (await page.locator('.settings .pick input[type="radio"]').count()) >= 6);
  // 2026.11.13 : 설정에서 확인부터 설치까지 — 판 표시를 누르면 「업데이트」 구획의 업데이트 카드
  await page.locator(".set-ver").click();
  check("판 표시를 누르면 업데이트 카드", await until(() => page.locator("#set-update .uc .uc-ver-n").textContent().then((t) => /v\d+\.\d+\.\d+/.test(t ?? ""))));
  check("카드에서 바로 확인한다", (await page.locator("#set-update .uc .act", { hasText: "업데이트 확인" }).count()) + (await page.locator("#set-update .uc-new").count()) >= 1);
  await page.locator(".set-nav button", { hasText: "Claude 스킬" }).click();
  check("Claude 스킬 상태", await until(async () => /설치/.test((await page.locator(".settings").textContent()) ?? "")));
  await page.screenshot({ path: join(SHOTS, "13_설정.png") });
  await page.keyboard.press("Escape");
  check("Esc 로 닫힌다", await until(() => page.locator(".settings").count().then((c) => c === 0)));

  // 10-9. 격자 보기 — 아래 단추로 격자 · Ctrl+휠로 크기 · 그림은 미리보기 · 다시 목록
  writeFileSync(
    join(T, "그림.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJElEQVR4nGP8z8Dwn4ECwESJ5lEDRg0YNWDUgFEDRg0YNQAAOwYCH0xD9z4AAAAASUVORK5CYII=", "base64"),
  );
  const edCount = (t) => /(\d+)판/.exec(t ?? "")?.[1];
  const ticksBefore = edCount(await row("보고서").locator(".ver-btn").textContent());
  // 3fcf556 부터 목록 · 격자 단추가 크기 사다리 눈금이다 — 0 목록 촘촘 · 1 목록 · 2 격자 작게 …
  await pane.locator(".ladder-tick").nth(2).click();
  check("격자 보기", await until(() => pane.locator(".tile").count().then((c) => c >= 7)));
  const tileW = () => pane.locator(".tile").first().evaluate((el) => el.getBoundingClientRect().width);
  const w0 = await tileW();
  const box = await pane.locator(".list").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  const w1 = await until(async () => ((await tileW()) > w0 ? tileW() : null), 3000);
  check("Ctrl+휠로 칸이 커진다", !!w1, `${Math.round(w0)} → ${Math.round(w1 ?? w0)}`);
  check(
    "그림은 미리보기로",
    await until(() => pane.locator(".tile", { hasText: "그림" }).locator("img.thumb").evaluate((img) => img.complete && img.naturalWidth > 0), 8000),
  );
  const tileTicks = edCount(await pane.locator(".tile", { hasText: "보고서" }).locator(".ver-btn").textContent());
  check("판이 쌓인 문서는 목록과 같은 판 수", !!tileTicks && tileTicks === ticksBefore, `${tileTicks} · ${ticksBefore}`);
  await pane.locator(".tile", { hasText: "LDM_D09" }).click();
  await page.keyboard.press("ArrowLeft");
  check("격자에서 화살표로 옮긴다", await until(() => pane.locator(".tile.selected").count().then((c) => c === 1)));
  await page.screenshot({ path: join(SHOTS, "14_격자.png") });
  // 2026.11.13 : 격자인 채 새 탭을 열면 칸이 한 줄에 하나씩 세로로만 섰다 (목록 칸과 격자가 함께 처음 그려질 때 너비를 못 쟀다)
  {
    await page.keyboard.press("Control+t");
    await until(() => pane.locator(".tile").count().then((c) => c >= 7));
    const tops = () => pane.locator(".tile").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    const rowsOk = await until(async () => {
      const t = await tops();
      return t.length >= 7 && new Set(t).size < t.length;
    }, 3000);
    const t = await tops();
    check("새 탭에서도 격자가 한 줄에 여러 칸", rowsOk, `칸 ${t.length} · 줄 ${new Set(t).size}`);
    await page.keyboard.press("Control+w");
    await until(() => page.locator(".tab").count().then((c) => c >= 1));
  }
  await pane.locator(".ladder-tick").nth(1).click();
  check("다시 목록", await until(() => pane.locator(".row").count().then((c) => c >= 7)));

  // 10-10. 보일 열 — 열 머리 오른쪽 단추로 「크기」를 숨겼다가 다시
  await pane.locator(".cols").click({ button: "right" });
  check("열 고르기 메뉴", await until(() => page.locator(".pop-menu").count().then((c) => c === 1)));
  await page.locator(".pop-menu button", { hasText: "크기" }).click();
  check("크기 열을 숨긴다", await until(() => pane.locator(".row .cell.size").count().then((c) => c === 0)));
  await page.locator(".pop-menu button", { hasText: "크기" }).click();
  check("다시 보인다", await until(() => pane.locator(".row .cell.size").count().then((c) => c > 0)));
  await page.keyboard.press("Escape");

  // 10-11. 긴 메모 — 여러 줄로 붙이면 줄에는 첫 줄, 올려 두면 카드로 다
  await row("LDM_D09").click();
  await page.keyboard.press("Control+m");
  await until(() => pane.locator(".memo-input").count().then((c) => c > 0));
  await page.keyboard.type("정의서 검토 요청");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("발주처 회신을 받은 뒤 v1.7 로 올린다. 컬럼 설명 열두 곳을 고친다.");
  await page.keyboard.press("Enter");
  const memoBtn = row("LDM_D09").locator(".memo");
  check("여러 줄 메모는 첫 줄만", await until(() => memoBtn.textContent().then((t) => t === "정의서 검토 요청")));
  await memoBtn.hover();
  check("올려 두면 메모 카드", await until(() => page.locator(".memo-card").textContent().then((t) => t?.includes("v1.7")), 3000));
  await page.screenshot({ path: join(SHOTS, "15_메모카드.png") });
  await page.mouse.move(5, 400);

  // 10-1. 직접 그린 제목 줄 — 창 단추 셋 · 최대화 ↔ 이전 크기
  check("창 단추 셋", (await page.locator(".winctl button").count()) === 3);
  const maxBtn = page.locator(".winctl button").nth(1);
  const before = await maxBtn.getAttribute("aria-label");
  await maxBtn.click();
  const after = await until(async () => ((await maxBtn.getAttribute("aria-label")) !== before ? maxBtn.getAttribute("aria-label") : null));
  check("최대화 단추가 창을 바꾼다", !!after, `${before} → ${after}`);
  await page.screenshot({ path: join(SHOTS, "09_제목줄.png") });
  await maxBtn.click();
  await until(async () => (await maxBtn.getAttribute("aria-label")) === before);

  // 11. 화면 색 — 설정 「화면 색」에서 시스템 → 밝게 → 어둡게. 바탕색이 실제로 바뀌는지 본다.
  //     3fcf556 부터 왼쪽 아래 단추가 아니라 설정 창의 그림 카드다.
  await page.locator(".settings-btn").click();
  await until(() => page.locator(".settings").count().then((c) => c === 1));
  const card = (name) => page.locator(".theme-pick .theme-card", { hasText: name });
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("화면 색 기본은 시스템", (await card("시스템").getAttribute("aria-checked")) === "true");
  await card("밝게").click();
  const light = await paper();
  await card("어둡게").click();
  const dark = await until(async () => ((await paper()) !== light ? paper() : null));
  check("어둡게로 바꾸면 바탕이 바뀐다", dark && (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", `${light} → ${dark}`);
  await page.screenshot({ path: join(SHOTS, "08_어둡게.png") });
  await card("시스템").click();
  check("다시 시스템으로", (await page.evaluate(() => document.documentElement.dataset.theme)) === undefined);
  await page.keyboard.press("Escape");

  // 10-10. 바로가기는 대상의 그림 · ini 는 앱 안에서 (2026.11.12)
  {
    const L = join(T, "바로가기");
    mkdirSync(L, { recursive: true });
    writeFileSync(join(L, "설정.ini"), "[app]\r\nname=filedesk\r\n");
    execFileSync("powershell", ["-NoProfile", "-Command", `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${join(L, "자료로.lnk")}'); $s.TargetPath='${join(T, "자료")}'; $s.Save()`]);
    await page.locator(".settings-btn").click();
    await page.locator(".set-nav button", { hasText: "아이콘" }).click();
    await page.locator(".icon-row", { hasText: "filedesk" }).first().click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+l");
    await pane.locator("input.path-input").fill(L);
    await pane.locator("input.path-input").press("Enter");
    check("폴더 바로가기는 폴더 그림 + 화살표", await until(() => row("자료로").locator(".shortcut-glyph .folder-glyph").count().then((c) => c === 1)));
    await page.screenshot({ path: join(SHOTS, "12_바로가기.png") });
    // 2026.11.13 : Windows 아이콘 설정에서도 바로가기에 화살표 — 셸 그림에는 탐색기의 화살표 덧그림이 없어 진짜 파일과 같아 보였다
    const iconMode = async (name) => {
      await page.locator(".settings-btn").click();
      await page.locator(".set-nav button", { hasText: "아이콘" }).click();
      await page.locator(".icon-row", { hasText: name }).first().click();
      await page.keyboard.press("Escape");
    };
    await iconMode("Windows");
    check("Windows 아이콘에서도 바로가기 화살표", await until(() => row("자료로").locator(".shortcut-glyph .shortcut-arrow").count().then((c) => c === 1)));
    check("바로가기가 아닌 파일에는 화살표가 없다", (await row("설정").locator(".shortcut-arrow").count()) === 0);
    await iconMode("filedesk");
    await row("설정").dblclick();
    check("ini 는 앱 안에서 연다", await until(() => page.locator(".viewer").textContent().then((t) => t.includes("name=filedesk"))));
    await page.keyboard.press("Escape");
  }

  // 12. 찾기 조건 · 스마트 폴더 (2026.11.12) — 시험 폴더의 파일은 모두 오늘 만들었다
  {
    await page.keyboard.press("Control+l");
    await pane.locator("input.path-input").fill(T);
    await pane.locator("input.path-input").press("Enter");
    // 바로 앞이 「바로가기」 폴더라 줄이 이미 있다 — 시험 폴더의 줄이 그려질 때까지 기다린다.
    // 옮겨 가기 전에 찾기 칸을 채우면 폴더를 옮기며 찾기 칸이 비워진다 (2026.11.12)
    await until(async () => (await rowNames()).includes("보고서.pptx"), 5000);
    const filter = pane.locator("input.filter");
    await filter.fill("고친:오늘");
    check("조건은 칩으로", await until(() => pane.locator(".cond-chip").first().textContent().then((t) => t?.includes("오늘"))));
    check("오늘 고친 것만 남는다", await until(async () => (await pane.locator(".row").count()) > 0));
    await page.screenshot({ path: join(SHOTS, "16_조건칩.png") });
    await filter.fill("고친:>1년");
    check("1년 넘은 것은 없다", await until(() => pane.locator(".row").count().then((c) => c === 0)));
    await filter.fill("고친:언젠가");
    check("틀린 조건은 경고 칩", await until(() => pane.locator(".cond-chip.warn").count().then((c) => c === 1)));
    // ＋ 조건 메뉴로 붙이기
    await filter.fill("");
    await pane.locator(".preset-wrap > button").click();
    await page.locator(".preset-menu button", { hasText: "3일 안" }).click();
    check("＋ 조건이 찾기 칸에 붙는다", (await filter.inputValue()) === "고친:3일");
    // ＋ 조건 메뉴 끝의 「찾기 조건 판…」 — 같은 글로 판이 열린다 (2026.11.13)
    await pane.locator(".preset-wrap > button").click();
    await page.locator(".preset-menu button", { hasText: "찾기 조건 판" }).click();
    check("＋ 조건 → 찾기 조건 판", await until(() => page.locator(".cs .cs-row").count().then((c) => c === 1)));
    await page.keyboard.press("Escape");
    await until(() => page.locator(".cs").count().then((c) => c === 0));
    // 찾기 조건 판 — 켠 조건만 줄로 · 「＋」 로 더하고 × 로 뺀다 · Esc 는 연 때 글로 되돌린다 (2026.11.13 다시 지음)
    await filter.fill("");
    await pane.locator(".qb-btn").click();
    const cs = page.locator(".cs");
    check("조건 판 — 켠 조건이 없으면 줄도 없다", await until(() => cs.count().then((c) => c === 1)) && (await cs.locator(".cs-row").count()) === 0);
    await cs.locator(".cs-add button", { hasText: "고친 날" }).click();
    check("「＋ 고친 날」 — 줄이 서고 찾기 칸에 7일", await until(async () => (await cs.locator(".cs-row").count()) === 1 && (await filter.inputValue()) === "고친:7일"));
    await cs.locator(".cs-seg button", { hasText: "오늘" }).click();
    check("붙은 단추로 값을 바꾼다", await until(async () => (await filter.inputValue()) === "고친:오늘"));
    await cs.locator(".cs-row .cs-x").click();
    check("× 로 빼면 줄도 글도 빠진다", await until(async () => (await cs.locator(".cs-row").count()) === 0 && (await filter.inputValue()) === ""));
    await cs.locator(".cs-add button", { hasText: "메모" }).click();
    await page.screenshot({ path: join(SHOTS, "16b_조건판.png") });
    await page.keyboard.press("Escape");
    check("Esc 는 연 때 글로", await until(async () => (await cs.count()) === 0 && (await filter.inputValue()) === ""));
    await filter.fill("고친:3일");
    // 하위 폴더까지 — 조건만으로도 찾는다
    await filter.press("Shift+Enter");
    check("조건만으로 하위 폴더까지", await until(async () => (await pane.locator(".foot").textContent())?.includes("하위 폴더에서"), 10000));
    // 스마트 폴더로 저장 → 왼쪽에 생기고 누르면 그 칸에 모아 보인다
    await pane.locator(".save-smart").click();
    check("스마트 폴더 고치기 창", await until(() => page.locator(".smart-editor").count().then((c) => c === 1)));
    await page.locator(".smart-editor input").first().fill("시험 스마트");
    await page.locator(".smart-editor .act.primary").click();
    check("왼쪽에 스마트 폴더", await until(() => page.locator(".smart-item", { hasText: "시험 스마트" }).count().then((c) => c === 1)));
    check("누르면 칸에 모아 보인다", await until(async () => (await pane.locator(".deep-tag").textContent())?.includes("스마트 폴더"), 10000));
    await page.screenshot({ path: join(SHOTS, "17_스마트폴더.png") });
    check("최근 파일도 스마트 폴더", (await page.locator(".smart-item", { hasText: "최근 파일" }).count()) === 1);
    // 설정 › 색인
    await page.locator(".settings-btn").click();
    await page.locator(".set-nav button", { hasText: "색인" }).click();
    check("설정에 색인", await until(async () => /빠른 색인/.test((await page.locator("#set-index").textContent()) ?? "")));
    await page.screenshot({ path: join(SHOTS, "18_설정_색인.png") });
    await page.keyboard.press("Escape");
    await pane.locator(".deep-tag .kind-x").click();
  }

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
  rmSync(T, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과 · 캡처 ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
