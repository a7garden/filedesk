// 아이콘 원본(SVG)을 1024px PNG 로 그린다 — 이 PC 의 Playwright Chromium 으로.
//   node e2e/render-icon.mjs   →  src-tauri/icons/source.png  →  bun tauri icon src-tauri/icons/source.png -o src-tauri/icons
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ICONS = resolve(import.meta.dirname, "../src-tauri/icons");
const svg = readFileSync(join(ICONS, "source.svg"), "utf8");
// 이 PC 에 깔린 Chromium 중 가장 새것을 쓴다 — playwright-core 가 기대하는 판이 없어도 그리기에는 충분하다.
const PW = join(process.env.LOCALAPPDATA, "ms-playwright");
const exe = readdirSync(PW)
  .filter((d) => /^chromium-\d+$/.test(d))
  .sort()
  .reverse()
  .flatMap((d) => ["chrome-win64", "chrome-win"].map((w) => join(PW, d, w, "chrome.exe")))
  .find(existsSync);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="1024" height="1024" ')}</body></html>`);
await page.locator("svg").screenshot({ path: join(ICONS, "source.png"), omitBackground: true });
await browser.close();
console.log("그림:", join(ICONS, "source.png"));
