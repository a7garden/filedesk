// 파워포인트 미리보기 — PPTX 를 쪽마다 같은 모양의 HTML(절대 위치)로 그린다. 읽기만 한다.
//
// 목차
//   readPptx        zip 을 풀고 쪽 순서 · 크기 · 테마(색 · 글꼴)를 읽는다
//   convertSlide    마스터 → 레이아웃 → 쪽 순서로 도형을 그린다. 자리 표시자(placeholder)는 위치 · 글자 서식을 위에서 물려받는다
//   shapeHtml       도형 · 글상자 · 그림 · 그룹 · 표 · 연결선
//   renderPptx      쪽마다 HTML · 제목 · 발표자 메모를 낸다 (그림은 blob 주소)
//
// 2026.11.25 : ClaudePPT 의 PPTX 가져오기(src/lib/importPptx.ts)를 옮겨 왔다 — 파일로 쓰던 그림을 메모리(blob)로, 덱 파일 쓰기를 쪽 목록 돌려주기로 바꿨다.
//   글꼴 지표로 줄 자리를 PowerPoint 와 맞추던 부분(faceResolver)은 뺐다 — 미리보기에는 웹뷰 기본 줄 자리로 충분하고, 깔린 글꼴을 훑는 데 시간이 든다.
//   변환을 고칠 때는 ClaudePPT 쪽과 함께 본다 (그쪽이 원본과 쪽 그림으로 견주는 시험을 갖고 있다).
// 못 옮기는 것(차트 · SmartArt · 수식 · EMF 그림)은 자리만 점선 상자로 남긴다. 좌표는 EMU → px 로, 가로를 1280px 에 맞춰 늘이거나 줄인다.

import JSZip from "jszip";

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 글꼴 이름 → 깔린 글꼴의 지표. 미리보기는 찾지 않는다 (늘 null) — ClaudePPT 의 fonts.ts 와 같은 꼴만 맞춘다 */
type FaceInfo = { regular: { weight: number; metrics: number[]; typo: boolean }; bold: boolean };

type El = Element;
const kids = (el: El | null | undefined, name?: string): El[] => (el ? [...el.children].filter((c) => !name || c.tagName === name) : []);
const kid = (el: El | null | undefined, name: string): El | null => kids(el, name)[0] || null;
const path = (el: El | null | undefined, ...names: string[]): El | null => {
	let e: El | null | undefined = el;
	for (const n of names) e = kid(e, n);
	return e || null;
};
/** 1pt = 12700 EMU */
const PT = 12700;
const num = (v: string | null | undefined, d = 0) => (v == null || v === "" ? d : +v);

interface Theme { colors: Record<string, string>; major: string; minor: string; majorEa: string; minorEa: string }
interface Ctx {
	zip: JSZip;
	k: number; // EMU → px
	theme: Theme;
	clrMap: Record<string, string>;
	media: Map<string, string>; // zip 경로 → blob 주소
	defaults: { title: TextDefaults; body: TextDefaults[]; other: TextDefaults };
	warnings: Set<string>;
	slideNo: number;
	/** 글꼴 이름 → 깔린 글꼴. 못 찾으면 null — 그 글의 줄 자리 · 굵게는 웹뷰 기본대로 둔다 */
	face: (name: string) => FaceInfo | null;
}
/** spc = 자간(1/100 pt). 한글 PPT 는 대부분 음수 자간을 준다 — 빼면 글이 넓어져 원본과 다른 자리에서 줄이 바뀐다 */
/** ln · bef · aft — 줄 간격 · 문단 앞뒤 간격. pct 는 100000 분율(줄 높이 배수), pts 는 1/100 pt */
type Spacing = { pct?: number; pts?: number };
interface TextDefaults { size?: number; color?: string; bold?: boolean; font?: string; align?: string; spc?: number; ln?: Spacing; bef?: Spacing; aft?: Spacing }

// 레이아웃 · 마스터 · 테마는 쪽마다 같은 것을 다시 읽는다 — 한 번 푼 것을 가져오기가 끝날 때까지 둔다.
// 쪽 XML 은 담지 않는다 (수백 쪽이면 메모리만 먹는다). 읽기만 하는 DOM 이라 나눠 써도 된다.
const shared = new WeakMap<JSZip, Map<string, Promise<Document | null>>>();
const SHARED = /\/(slideLayouts|slideMasters|theme)\//;
async function xml(zip: JSZip, p: string): Promise<Document | null> {
	const parse = async () => {
		const f = zip.file(p);
		return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
	};
	if (!SHARED.test(p)) return parse();
	let m = shared.get(zip);
	if (!m) shared.set(zip, (m = new Map()));
	if (!m.has(p)) m.set(p, parse());
	return m.get(p)!;
}

async function rels(zip: JSZip, part: string): Promise<Record<string, string>> {
	const dir = part.slice(0, part.lastIndexOf("/"));
	const name = part.slice(part.lastIndexOf("/") + 1);
	const doc = await xml(zip, `${dir}/_rels/${name}.rels`);
	const out: Record<string, string> = {};
	if (!doc) return out;
	for (const r of doc.getElementsByTagName("Relationship")) {
		const t = r.getAttribute("Target") || "";
		out[r.getAttribute("Id")!] = r.getAttribute("TargetMode") === "External" ? t : resolve(dir, t);
	}
	return out;
}
const resolve = (base: string, rel: string) => {
	if (rel.startsWith("/")) return rel.slice(1);
	const parts = base.split("/");
	for (const s of rel.split("/")) {
		if (s === "..") parts.pop();
		else if (s !== ".") parts.push(s);
	}
	return parts.join("/");
};

// ── 색 ──
function colorOf(el: El | null, ctx: Ctx, phClr?: string): string | null {
	if (!el) return null;
	const c = el.children[0];
	if (!c) return null;
	let hex: string | null = null;
	let alpha = 1;
	if (c.tagName === "a:srgbClr") hex = c.getAttribute("val");
	else if (c.tagName === "a:schemeClr") {
		const v = c.getAttribute("val")!;
		if (v === "phClr") hex = phClr || null;
		else hex = ctx.theme.colors[ctx.clrMap[v] || v] || null;
	} else if (c.tagName === "a:sysClr") hex = c.getAttribute("lastClr") || (c.getAttribute("val") === "window" ? "FFFFFF" : "000000");
	else if (c.tagName === "a:prstClr") hex = ({ black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "00FF00", gray: "808080" } as Record<string, string>)[c.getAttribute("val")!] || "000000";
	if (!hex) return null;
	let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16));
	for (const m of c.children) {
		const v = num(m.getAttribute("val")) / 100000;
		if (m.tagName === "a:lumMod" || m.tagName === "a:lumOff") {
			let [h, s, l] = rgbToHsl(r, g, b);
			l = m.tagName === "a:lumMod" ? l * v : l + v;
			[r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l)));
		} else if (m.tagName === "a:tint") [r, g, b] = [r, g, b].map((x) => x + (255 - x) * (1 - v));
		else if (m.tagName === "a:shade") [r, g, b] = [r, g, b].map((x) => x * v);
		else if (m.tagName === "a:alpha") alpha = v;
	}
	const h = [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
	return alpha < 1 ? `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha.toFixed(2)})` : "#" + h;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h = 0, s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h /= 6;
	}
	return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	if (s === 0) return [l * 255, l * 255, l * 255];
	const f = (p: number, q: number, t: number) => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
	return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

function fillOf(spPr: El | null, ctx: Ctx, style: El | null): string | null | "none" {
	if (spPr) {
		if (kid(spPr, "a:noFill")) return "none";
		const s = kid(spPr, "a:solidFill");
		if (s) return colorOf(s, ctx);
		const g = kid(spPr, "a:gradFill");
		if (g) {
			const stops = [...g.getElementsByTagName("a:gs")].map((gs) => ({ pos: num(gs.getAttribute("pos")) / 1000, c: colorOf(gs, ctx) })).filter((x) => x.c);
			if (stops.length) {
				const ang = num(path(g, "a:lin")?.getAttribute("ang")) / 60000;
				return `linear-gradient(${ang + 90}deg, ${stops.map((s) => `${s.c} ${s.pos}%`).join(", ")})`;
			}
		}
	}
	const ref = path(style, "a:fillRef");
	if (ref && num(ref.getAttribute("idx")) > 0) return colorOf(ref, ctx);
	return null;
}

function lineOf(spPr: El | null, ctx: Ctx, style: El | null): { w: number; c: string; dash: boolean } | null {
	const ln = kid(spPr, "a:ln");
	if (ln && kid(ln, "a:noFill")) return null;
	let c = ln ? colorOf(kid(ln, "a:solidFill"), ctx) : null;
	if (!c) {
		const ref = path(style, "a:lnRef");
		if (ref && num(ref.getAttribute("idx")) > 0) c = colorOf(ref, ctx);
	}
	if (!c) return null;
	const w = Math.max(0.75, num(ln?.getAttribute("w"), 9525) * ctx.k);
	const dash = !!ln && ["dash", "sysDash", "dot", "sysDot", "lgDash", "dashDot"].includes(path(ln, "a:prstDash")?.getAttribute("val") || "");
	return { w, c, dash };
}

// ── 그림자 ──
/** 바깥 그림자(a:effectLst/a:outerShdw) → CSS 길이 · 색. 2026.11.24 : 빼서 카드 · 손 모양 그림의 그림자가 모두 빠졌다 (원본 25쪽 276개).
 *  rotWithShape="0"(기본)이면 도형이 돌아도 그림자 방향은 그대로다 — CSS 는 요소와 함께 돌리므로 그만큼 거꾸로 돌려 둔다 */
function shadowOf(spPr: El | null, ctx: Ctx, rot: number): { x: number; y: number; blur: number; color: string } | null {
	const sh = path(spPr, "a:effectLst", "a:outerShdw");
	const color = sh ? colorOf(sh, ctx) : null;
	if (!sh || !color) return null;
	const dist = num(sh.getAttribute("dist")) * ctx.k, blur = num(sh.getAttribute("blurRad")) * ctx.k;
	let dir = num(sh.getAttribute("dir")) / 60000;
	if (sh.getAttribute("rotWithShape") !== "1") dir -= rot;
	const a = (dir * Math.PI) / 180;
	return { x: dist * Math.cos(a), y: dist * Math.sin(a), blur, color };
}
const shadowCss = (s: { x: number; y: number; blur: number; color: string }) => `${r1(s.x)}px ${r1(s.y)}px ${r1(s.blur)}px ${s.color}`;

// ── 위치 ──
interface Box { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean }
type Tx = (b: Box) => Box;
function xfrmOf(x: El | null, ctx: Ctx, tx: Tx): Box | null {
	if (!x) return null;
	const off = kid(x, "a:off"), ext = kid(x, "a:ext");
	if (!off || !ext) return null;
	return tx({
		x: num(off.getAttribute("x")) * ctx.k,
		y: num(off.getAttribute("y")) * ctx.k,
		w: num(ext.getAttribute("cx")) * ctx.k,
		h: num(ext.getAttribute("cy")) * ctx.k,
		rot: num(x.getAttribute("rot")) / 60000,
		flipH: x.getAttribute("flipH") === "1",
		flipV: x.getAttribute("flipV") === "1",
	});
}
const posCss = (b: Box) => `position:absolute;left:${r1(b.x)}px;top:${r1(b.y)}px;width:${r1(b.w)}px;height:${r1(b.h)}px` + (b.rot ? `;transform:rotate(${r1(b.rot)}deg)` : "");
const r1 = (v: number) => Math.round(v * 10) / 10;

// ── 글자 ──
interface PhInfo { box: Box | null; body: El | null; type: string }
function phKey(sp: El) {
	const ph = path(sp, "p:nvSpPr", "p:nvPr", "p:ph") || path(sp, "p:nvPicPr", "p:nvPr", "p:ph");
	if (!ph) return null;
	return { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") || "" };
}
function findPh(tree: El | null, key: { type: string; idx: string }): El | null {
	if (!tree) return null;
	const sps = [...tree.getElementsByTagName("p:sp")];
	const norm = (t: string) => (t === "ctrTitle" ? "title" : t === "subTitle" ? "body" : t);
	return (
		(key.idx && sps.find((s) => phKey(s)?.idx === key.idx)) ||
		sps.find((s) => { const k = phKey(s); return k && norm(k.type) === norm(key.type); }) ||
		null
	);
}

function textDefaultsOf(lvl: El | null, ctx: Ctx): TextDefaults {
	const d = kid(lvl, "a:defRPr");
	const out: TextDefaults = {};
	if (d?.getAttribute("sz")) out.size = num(d.getAttribute("sz")) / 100;
	if (d?.getAttribute("spc")) out.spc = num(d.getAttribute("spc"));
	if (d?.getAttribute("b")) out.bold = d.getAttribute("b") === "1";
	const c = colorOf(kid(d, "a:solidFill"), ctx);
	if (c) out.color = c;
	const f = path(d, "a:latin")?.getAttribute("typeface") || path(d, "a:ea")?.getAttribute("typeface");
	if (f) out.font = f;
	if (lvl?.getAttribute("algn")) out.align = lvl.getAttribute("algn")!;
	// 줄 간격 · 문단 간격도 목록 서식 · 마스터 서식에서 물려받는다. 2026.11.24 : 문단에 적힌 비율만 읽어, 「정확히 17.5pt」 줄 간격과 물려받은 간격이 빠져 줄이 원본보다 좁았다
	for (const [tag, key] of [["a:lnSpc", "ln"], ["a:spcBef", "bef"], ["a:spcAft", "aft"]] as const) {
		const e = kid(lvl, tag);
		const pct = kid(e, "a:spcPct")?.getAttribute("val"), pts = kid(e, "a:spcPts")?.getAttribute("val");
		if (pct != null) out[key] = { pct: num(pct) };
		else if (pts != null) out[key] = { pts: num(pts) };
	}
	return out;
}

/** 글꼴 이름은 원본 PPTX 에 적힌 그대로 둔다(한글 이름 포함). 웹뷰가 그 이름을 알아보게 하는 것은 fonts.ts 의 별칭(@font-face)이 맡는다 —
 *  이름을 바꿔 적으면 내보낸 PPTX 에도 바뀐 이름이 들어가 원본과 달라진다. */
function fontName(f: string | undefined | null, ctx: Ctx) {
	if (!f) return null;
	if (f === "+mj-lt") return ctx.theme.major;
	if (f === "+mn-lt") return ctx.theme.minor;
	if (f === "+mj-ea") return ctx.theme.majorEa || ctx.theme.major;
	if (f === "+mn-ea") return ctx.theme.minorEa || ctx.theme.minor;
	return f;
}

function textHtml(txBody: El, ctx: Ctx, inh: TextDefaults[]): { html: string; anchor: string; ins: number[] } {
	const bodyPr = kid(txBody, "a:bodyPr");
	const anchor = bodyPr?.getAttribute("anchor") || "t";
	const ins = ["lIns", "tIns", "rIns", "bIns"].map((a, i) => num(bodyPr?.getAttribute(a), i % 2 ? 45720 : 91440) * ctx.k);
	const scale = num(path(bodyPr, "a:normAutofit")?.getAttribute("fontScale"), 100000) / 100000;
	const lst = kid(txBody, "a:lstStyle");
	const ps: { pst: string[]; inner: string; g: LineGeo | null; bef: number; aft: number }[] = [];
	const autoNum: number[] = [];
	for (const p of kids(txBody, "a:p")) {
		const pPr = kid(p, "a:pPr");
		const lvl = num(pPr?.getAttribute("lvl"));
		const lstLvl = kid(lst, `a:lvl${lvl + 1}pPr`);
		const own = textDefaultsOf(lstLvl, ctx);
		// 문단 자체의 기본 글자 서식(a:pPr/a:defRPr)이 가장 가깝다 — 목록 서식 · 자리 표시자 서식보다 먼저
		const base = { ...(inh[lvl] || inh[0] || {}), ...strip(own), ...strip(textDefaultsOf(pPr, ctx)) };
		const algn = pPr?.getAttribute("algn") || base.align || "l";
		const align = ({ l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" } as Record<string, string>)[algn] || "left";
		const marL = num(pPr?.getAttribute("marL") ?? lstLvl?.getAttribute("marL")) * ctx.k;
		const indent = num(pPr?.getAttribute("indent") ?? lstLvl?.getAttribute("indent")) * ctx.k;
		let firstSize = base.size || 18;
		let firstFam: string[] = [];
		let firstName: string | null = null;
		const runs: string[] = [];
		/** 공백뿐인 조각의 글자 크기(px) — runs 와 같은 자리. 글이 있는 조각 · 줄 바꿈은 0 */
		const blank: number[] = [];
		for (const r of p.children) {
			if (r.tagName === "a:br") { runs.push("<br>"); continue; }
			if (r.tagName !== "a:r" && r.tagName !== "a:fld") continue;
			const rPr = kid(r, "a:rPr");
			const t = r.tagName === "a:fld" && r.getAttribute("type") === "slidenum" ? String(ctx.slideNo) : kid(r, "a:t")?.textContent ?? "";
			const size = (num(rPr?.getAttribute("sz")) / 100 || base.size || 18) * scale;
			if (!runs.length) firstSize = size;
			const bold = rPr?.getAttribute("b") ? rPr.getAttribute("b") === "1" : base.bold;
			const italic = rPr?.getAttribute("i") === "1";
			const u = rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none";
			const strike = rPr?.getAttribute("strike") && rPr.getAttribute("strike") !== "noStrike";
			const color = colorOf(kid(rPr, "a:solidFill"), ctx) || base.color;
			const latin = fontName(path(rPr, "a:latin")?.getAttribute("typeface"), ctx);
			const ea = fontName(path(rPr, "a:ea")?.getAttribute("typeface"), ctx);
			const fam = [latin, ea, fontName(base.font, ctx)].filter(Boolean).map((f) => `'${f}'`);
			const primary = latin || ea || fontName(base.font, ctx);
			if (!firstFam.length) { firstFam = fam; firstName = primary; }
			const px = size * PT * ctx.k;
			const st = [`font-size:${r1(px)}px`];
			let spcPx = ((rPr?.getAttribute("spc") != null ? num(rPr.getAttribute("spc")) : base.spc || 0) / 100) * PT * ctx.k;
			if (bold) {
				st.push("font-weight:700");
				// 굵은 판이 없는 글꼴의 「굵게」는 PowerPoint 도 웹뷰도 흉내 낸다. 그런데 PowerPoint 는 글자마다 폭을 조금(≈0.025em) 넓히고,
				// 큰 글자(≈31px 이상)는 획을 두껍게 하지 않는다. 웹뷰는 크기에 비례해 획을 불린다 — 그대로 두면 제목이 원본보다 뚱뚱하고 좁다.
				// 2026.11.18 : 에스코어 드림 4 · 5 를 10~36pt 로 PowerPoint 와 견주어 정했다 (17 · 18pt 는 PowerPoint 쪽이 더 굵어 덜 맞는다)
				const f = primary ? ctx.face(primary) : null;
				if (f && !f.bold && f.regular.weight > 0 && f.regular.weight < 600) {
					spcPx += 0.025 * px;
					if (px >= 31) st.push("font-synthesis-weight:none");
				}
			}
			if (italic) st.push("font-style:italic");
			if (spcPx) st.push(`letter-spacing:${r1(spcPx)}px`);
			if (u || strike) st.push(`text-decoration:${[u && "underline", strike && "line-through"].filter(Boolean).join(" ")}`);
			if (color) st.push(`color:${color}`);
			// 글자 강조 표시(형광펜) — 「STEP 1」 같은 이름표가 이것으로 초록 바탕을 깐다. 빼면 흰 글자가 흰 바탕에 묻힌다
			const mark = colorOf(kid(rPr, "a:highlight"), ctx);
			if (mark) st.push(`background-color:${mark}`);
			if (fam.length) st.push(`font-family:${fam.join(",")},var(--font)`);
			const sup = num(rPr?.getAttribute("baseline"));
			if (sup) st.push(`vertical-align:${sup > 0 ? "super" : "sub"};font-size:${r1(size * 0.65 * PT * ctx.k)}px`);
			runs.push(`<span style="${st.join(";")}">${escapeHtml(t)}</span>`);
			blank[runs.length - 1] = t.trim() ? 0 : px;
		}
		// 문단 끝의 줄 바꿈 — PowerPoint 는 빈 줄 하나로 그린다. HTML 은 블록 끝 <br> 을 줄로 치지 않아 하나 더 둔다.
		// 2026.11.24 : 목록 항목 사이를 이것으로 띄운 표에서 항목이 붙어 나왔다
		if (runs[runs.length - 1] === "<br>") runs.push("<br>");
		// 글머리
		let bullet = "";
		const bu = kid(pPr, "a:buChar") || kid(lstLvl, "a:buChar");
		const an = kid(pPr, "a:buAutoNum") || kid(lstLvl, "a:buAutoNum");
		const none = kid(pPr, "a:buNone");
		// 글머리의 색 · 글꼴 · 크기 — 문단 서식에 없으면 목록 서식. 빼면 회색 글머리가 글자색으로, Arial 글머리가 본문 글꼴로 그려진다
		const buClr = colorOf(kid(pPr, "a:buClr") || kid(lstLvl, "a:buClr"), ctx);
		let buFont = (kid(pPr, "a:buFont") || kid(lstLvl, "a:buFont"))?.getAttribute("typeface") || "";
		const buSz = num((kid(pPr, "a:buSzPct") || kid(lstLvl, "a:buSzPct"))?.getAttribute("val"), 100000) / 100000;
		if (!none && (bu || an) && runs.length) {
			if (an) { autoNum[lvl] = (autoNum[lvl] || num(an.getAttribute("startAt"), 1) - 1) + 1; bullet = `${autoNum[lvl]}.`; }
			else bullet = bu!.getAttribute("char") || "•";
			// Wingdings 글머리는 그 글꼴의 그림 글자다(「ü」= ✓). 웹뷰에서 Wingdings 로 그리면 글꼴이 없을 때 「ü」가 그대로 나오므로 같은 모양의 유니코드 글자로 바꾼다
			const wing = /wingdings/i.test(buFont) ? ({ "ü": "✓", "Ø": "➢", "§": "▪", "n": "■", "l": "●", "q": "❑", "v": "❖", "Ÿ": "•", "à": "→", "è": "➔", "ð": "➪", "o": "□" } as Record<string, string>)[bullet] : undefined;
			if (wing) { bullet = wing; buFont = ""; }
			else if (bullet === "Ø" || bullet === "§" || bullet === "ü") bullet = "•";
		}
		// 빈 문단의 높이는 문단 끝 서식(endParaRPr)의 크기다 — PowerPoint 가 빈 줄을 그 크기로 띄운다
		if (!runs.length) {
			const end = num(kid(p, "a:endParaRPr")?.getAttribute("sz")) / 100;
			if (end) firstSize = end * scale;
		}
		const pxSize = firstSize * PT * ctx.k;
		// 줄 간격 — 비율이면 그대로, 「정확히 n pt」면 이 문단 글자 크기에 대한 비율로 바꾼다 (줄 거리 = 1.2em × 비율)
		const exact = base.ln?.pts != null;
		const lnRatio = base.ln?.pct != null ? base.ln.pct / 100000 : exact ? (base.ln!.pts! / 100) * PT * ctx.k / (1.2 * pxSize) : null;
		// 문단 간격 — pt 는 그대로, 비율은 이 문단 줄 높이(1.2em)의 배수
		// 공백뿐인 줄 — PowerPoint 는 그 줄 높이를 그 공백의 글자 크기로 정한다(2pt 공백으로 줄 사이를 살짝 띄운다).
		// HTML 은 줄마다 문단 글자 크기만큼은 높이를 잡아 빈 줄 하나가 통째로 생긴다 — 그 줄을 공백 크기 높이의 블록으로 바꾼다.
		// 2026.11.24 : 「산림인접건축 / 산림재난위험 …」 사이가 원본보다 한 줄씩 벌어졌다
		blank.length = runs.length;
		for (let k = 0; k < runs.length; k++) {
			if (runs[k] !== "<br>") continue;
			let e = k + 1;
			while (e < runs.length && runs[e] !== "<br>" && (blank[e] ?? 0) > 0) e++;
			if (e === k + 1 || (e < runs.length && runs[e] !== "<br>")) continue;
			const h = exact ? (base.ln!.pts! / 100) * PT * ctx.k : 1.2 * (lnRatio ?? 1) * Math.max(...blank.slice(k + 1, e).map((v) => v ?? 0));
			// 뒤에 <br> 이 이어지면 그것이 이 블록 다음 줄을 연다 — 하나는 블록이 대신하므로 뺀다
			const drop = e < runs.length ? 1 : 0;
			runs.splice(k, e - k + drop, `<span style="display:block;height:${r1(h)}px"></span>`);
			blank.splice(k, e - k + drop, 0);
		}
		const gap = (g?: Spacing) => (g?.pts != null ? (g.pts / 100) * PT * ctx.k : g?.pct != null ? (g.pct / 100000) * 1.2 * pxSize : 0);
		// 문단 글자 크기를 첫 조각 크기로 준다. 안 주면 문단이 덱 기본 크기(24px)를 물려받아, 글이 작아도 줄마다 24px × 줄 간격 높이를 차지한다
		// (2026.11.18 16px 글이 줄마다 29px 씩 벌어져 칸을 넘쳤다)
		const pst = [`text-align:${align}`, `margin:0`, `padding-left:${r1(marL)}px`, `text-indent:${r1(indent)}px`, `font-size:${r1(pxSize)}px`];
		if (lnRatio != null) pst.push(`line-height:${r1(lnRatio * 1.2 * 1000) / 1000}`);
		// 문단의 바탕 글꼴을 첫 조각 글꼴로 — 안 주면 덱 기본 글꼴의 위아래 높이가 줄마다 섞여 줄 거리가 조금씩 벌어진다
		const pFam = firstFam.length ? firstFam : base.font ? [`'${fontName(base.font, ctx)}'`] : [];
		if (pFam.length) pst.push(`font-family:${pFam.join(",")},var(--font)`);
		const g = lineGeo(firstName || fontName(base.font, ctx), lnRatio ?? 1, pxSize, ctx, exact);
		const bef = gap(base.bef), aft = gap(base.aft);
		if (!runs.length) { pst.push("min-height:1em"); ps.push({ pst, inner: "", g, bef, aft }); continue; }
		// 줄 높이 0 — 글머리 글꼴(Arial 등)의 위아래 높이가 본문 글꼴과 달라 줄마다 1~2px 씩 벌어지는 것을 막는다. PowerPoint 는 글머리로 줄 높이를 바꾸지 않는다
		const buSt = [`display:inline-block`, `line-height:0`, `min-width:${r1(Math.max(0, -indent))}px`, `font-size:${r1(pxSize * buSz)}px`, `text-indent:0`];
		if (buClr) buSt.push(`color:${buClr}`);
		if (buFont && !buFont.startsWith("+")) buSt.push(`font-family:'${buFont}',var(--font)`);
		ps.push({ pst, inner: `${bullet ? `<span style="${buSt.join(";")}">${escapeHtml(bullet)}</span>` : ""}${runs.join("")}`, g, bef, aft });
	}
	// 줄 자리를 PowerPoint 에 맞춘다 (lineGeo) — 첫 문단 위 · 문단 사이 · 마지막 문단 아래 여백만 고친다. 한 문단 안의 줄 거리는 둘이 같다.
	// 여백(레이아웃)으로 고쳐야 글 덩어리 높이도 같아져, 가운데 · 아래 맞춤 글상자에서도 자리가 맞는다
	const html = ps.map((p, k) => {
		const prev = ps[k - 1];
		let top = p.bef, bottom = p.aft;
		if (p.g && k === 0) top += p.g.ppt - p.g.web;
		if (p.g && prev?.g) top += p.g.pitch - (prev.g.pitch - prev.g.web) - p.g.web;
		if (p.g && k === ps.length - 1) bottom += p.g.below - (p.g.pitch - p.g.web);
		if (Math.abs(top) >= 0.1) p.pst.push(`margin-top:${r1(top)}px`);
		if (Math.abs(bottom) >= 0.1) p.pst.push(`margin-bottom:${r1(bottom)}px`);
		return `<p style="${p.pst.join(";")}">${p.inner}</p>`;
	});
	return { html: html.join(""), anchor, ins };
}

/** 한 문단의 줄 자리(px). pitch = 줄 거리, web = 웹뷰가 줄 안에 두는 기준선, ppt = PowerPoint 가 글상자 첫 줄에 두는 기준선,
 *  below = PowerPoint 가 마지막 줄 기준선 아래에 두는 높이.
 *
 *  줄 거리는 둘 다 「줄 간격 × 1.2em」으로 같다. 다른 것은 기준선을 어디에 두느냐다.
 *  - 웹뷰: 남는 줄 높이를 글자 위아래로 반씩 나눈다. 글자 높이는 글꼴의 win(또는 typo) 위 · 아래 높이를 px 로 반올림한 값이다
 *  - PowerPoint (2026.11.18 에스코어 드림 4 · 5 · 맑은 고딕 · 페이퍼로지 를 줄 간격 70~200% · 위/가운데/아래 맞춤으로 그려 잰 값):
 *      첫 줄 기준선  100%  : 1.2em × win 위 / (win 위 + win 아래)    — 글꼴마다 다르다
 *                   > 100%: 0.907em × 줄 간격                        — 글꼴과 상관없다
 *                   < 100%: 100% 자리에서 1.14em × 줄인 몫만큼 올린다. 단 0.907em × 줄 간격 보다 위로는 안 간다
 *      다음 줄       앞 기준선 + 줄 거리
 *      마지막 줄 아래: 1.2em − 100% 의 첫 줄 기준선                  — 줄 간격과 상관없다
 *  글꼴을 못 찾았으면(지표가 없으면) null — 웹뷰 기본대로 둔다 */
interface LineGeo { pitch: number; web: number; ppt: number; below: number }
function lineGeo(name: string | null, pct: number, px: number, ctx: Ctx, exact = false): LineGeo | null {
	const f = name ? ctx.face(name)?.regular : null;
	if (!f || !(f.metrics[0] > 0)) return null;
	const [wa, wd, ta, td] = f.metrics;
	const b1 = (1.2 * wa) / (wa + wd);
	// 「정확히」 줄 간격은 첫 줄 기준선을 0.716 × 줄 높이 + 0.089 × 글자 크기에 둔다 (exportPptx 의 PPT_BASE_LH · PPT_BASE_SZ 와 같은 잰 값)
	const ppt = exact ? 0.716 * 1.2 * pct * px + 0.089 * px : (pct === 1 ? b1 : pct > 1 ? 0.907 * pct : Math.max(0.907 * pct, b1 - 1.14 * (1 - pct))) * px;
	const [ca, cd] = f.typo ? [ta, td] : [wa, wd];
	const a = Math.round(ca * px), d = Math.round(cd * px);
	const pitch = 1.2 * pct * px;
	return { pitch, web: (pitch - (a + d)) / 2 + a, ppt, below: (1.2 - b1) * px };
}

// ── 선 · 연결선 ──
const LINE_PRST = /^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5])$/;
/** 화살촉 크기는 선 두께의 배수 — 작게 2 · 보통 3 · 크게 5 (w 는 폭, len 은 길이). 2026.11.23 : 늘 5배로 그려 원본보다 컸다 */
const ARROW: Record<string, number> = { sm: 2, med: 3, lg: 5 };
/** 연결선 한 줄. 꺾인 연결선(bentConnector)은 PowerPoint 와 같이 가로 → 세로 → 가로로 꺾는다 (adj1 = 꺾는 자리, 기본 가운데).
 *  2026.11.23 : 꺾인 연결선을 대각선 직선으로 그렸다 */
function connectorSvg(box: Box, line: { w: number; c: string; dash: boolean }, spPr: El | null, prst = path(spPr, "a:prstGeom")?.getAttribute("prst") || "line"): string {
	const ln = path(spPr, "a:ln");
	const { w, h } = box;
	let pts: number[][];
	if (prst === "bentConnector2") pts = [[0, 0], [w, 0], [w, h]];
	else if (/^(bent|curved)Connector[3-5]$/.test(prst)) {
		const gd = path(spPr, "a:prstGeom", "a:avLst", "a:gd")?.getAttribute("fmla");
		const a = gd?.startsWith("val ") ? +gd.slice(4) : 50000;
		const mx = w * (Number.isFinite(a) ? a : 50000) / 100000;
		pts = [[0, 0], [mx, 0], [mx, h], [w, h]];
	} else pts = [[0, 0], [w, h]];
	// 뒤집기는 상자 안에서 좌우 · 위아래로 거울
	pts = pts.map(([x, y]) => [box.flipH ? w - x : x, box.flipV ? h - y : y]);
	const end = (name: string, at: "start" | "end") => {
		const e = path(ln, name), type = e?.getAttribute("type");
		if (!e || !type || type === "none") return { def: "", ref: "" };
		const id = "m" + Math.random().toString(36).slice(2, 7);
		const aw = ARROW[e.getAttribute("w") || "med"] ?? 3, al = ARROW[e.getAttribute("len") || "med"] ?? 3;
		return {
			def: `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${al}" markerHeight="${aw}" preserveAspectRatio="none" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${line.c}"/></marker>`,
			ref: ` marker-${at}="url(#${id})"`,
		};
	};
	const hd = end("a:headEnd", "start"), tl = end("a:tailEnd", "end");
	const defs = hd.def || tl.def ? `<defs>${hd.def}${tl.def}</defs>` : "";
	const stroke = `fill="none" stroke="${line.c}" stroke-width="${r1(line.w)}"${line.dash ? ' stroke-dasharray="6 4"' : ""}${tl.ref}${hd.ref}`;
	const body = pts.length === 2
		? `<line x1="${r1(pts[0][0])}" y1="${r1(pts[0][1])}" x2="${r1(pts[1][0])}" y2="${r1(pts[1][1])}" ${stroke}/>`
		: `<polyline points="${pts.map((p) => p.map(r1).join(",")).join(" ")}" stroke-linejoin="miter" ${stroke}/>`;
	return `<svg style="position:absolute;left:${r1(box.x)}px;top:${r1(box.y)}px;overflow:visible" width="${r1(Math.max(w, 1))}" height="${r1(Math.max(h, 1))}">${defs}${body}</svg>`;
}

// ── 도형 그림 (사각형 · 둥근 사각형 · 타원 밖의 프리셋) ──
/** adj — 원본 도형의 조절점(avLst 의 첫 gd, 100000 분율). 없으면 각 도형의 PowerPoint 기본값을 쓴다 */
function presetSvg(prst: string, w: number, h: number, fill: string, line: { w: number; c: string; dash: boolean } | null, adj?: number): string | null {
	const s = line ? `stroke="${line.c}" stroke-width="${r1(line.w)}"${line.dash ? ' stroke-dasharray="6 4"' : ""}` : "";
	const f = fill === "none" ? "none" : fill;
	const P = (pts: number[][]) => `<polygon points="${pts.map((p) => p.map(r1).join(",")).join(" ")}" fill="${f}" ${s}/>`;
	let body: string | null = null;
	const a = Math.min(w, h);
	switch (prst) {
		case "triangle": body = P([[w / 2, 0], [w, h], [0, h]]); break;
		case "rtTriangle": body = P([[0, 0], [w, h], [0, h]]); break;
		case "diamond": body = P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
		case "parallelogram": body = P([[a * 0.25, 0], [w, 0], [w - a * 0.25, h], [0, h]]); break;
		case "trapezoid": body = P([[a * 0.25, 0], [w - a * 0.25, 0], [w, h], [0, h]]); break;
		case "pentagon": case "homePlate": body = P([[0, 0], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [0, h]]); break;
		case "chevron": body = P([[0, 0], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [0, h], [h / 2, h / 2]]); break;
		case "hexagon": body = P([[a * 0.25, 0], [w - a * 0.25, 0], [w, h / 2], [w - a * 0.25, h], [a * 0.25, h], [0, h / 2]]); break;
		case "octagon": { const c = a * 0.29; body = P([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]); break; }
		case "rightArrow": body = P([[0, h * 0.25], [w - h / 2, h * 0.25], [w - h / 2, 0], [w, h / 2], [w - h / 2, h], [w - h / 2, h * 0.75], [0, h * 0.75]]); break;
		case "leftArrow": body = P([[w, h * 0.25], [h / 2, h * 0.25], [h / 2, 0], [0, h / 2], [h / 2, h], [h / 2, h * 0.75], [w, h * 0.75]]); break;
		case "upArrow": body = P([[w * 0.25, h], [w * 0.25, w / 2], [0, w / 2], [w / 2, 0], [w, w / 2], [w * 0.75, w / 2], [w * 0.75, h]]); break;
		case "downArrow": body = P([[w * 0.25, 0], [w * 0.75, 0], [w * 0.75, h - w / 2], [w, h - w / 2], [w / 2, h], [0, h - w / 2], [w * 0.25, h - w / 2]]); break;
		case "plus": case "mathPlus": { const t = a * 0.3; body = P([[(w - t) / 2, 0], [(w + t) / 2, 0], [(w + t) / 2, (h - t) / 2], [w, (h - t) / 2], [w, (h + t) / 2], [(w + t) / 2, (h + t) / 2], [(w + t) / 2, h], [(w - t) / 2, h], [(w - t) / 2, (h + t) / 2], [0, (h + t) / 2], [0, (h - t) / 2], [(w - t) / 2, (h - t) / 2]]); break; }
		case "star5": {
			const pts: number[][] = [];
			for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.38 : 0.5, an = -Math.PI / 2 + (i * Math.PI) / 5; pts.push([w / 2 + Math.cos(an) * w * r, h / 2 + Math.sin(an) * h * r]); }
			body = P(pts); break;
		}
		case "donut": {
			// 링 두께는 adj(기본 25000 = 짧은 변의 25%). 2026.11.23 : 기본값으로만 그려 얇은 링(adj 5759)이 꽉 찬 원이 되고, 같은 색 글자가 링에 묻혔다
			const t = a * Math.min(50000, Math.max(0, adj ?? 25000)) / 100000;
			body = `<circle cx="${w / 2}" cy="${h / 2}" r="${a / 2 - t / 2}" fill="none" stroke="${f}" stroke-width="${t}"/>`;
			break;
		}
		case "flowChartProcess": return null;
		case "flowChartDecision": body = P([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
		case "flowChartTerminator": return null;
	}
	if (!body) return null;
	return `<svg width="${r1(w)}" height="${r1(h)}" viewBox="0 0 ${r1(w)} ${r1(h)}" style="position:absolute;left:0;top:0;overflow:visible">${body}</svg>`;
}

/** 자유형 도형(a:custGeom) → SVG. 2026.11.24 : 테두리 상자로 그려 꼭짓점 여섯 개짜리 확대 쐐기가 반투명 사각형이 되어 뒤 화면을 덮었다.
 *  점 좌표가 수식(가이드 이름)이면 풀지 않고 null — 부르는 쪽이 예전처럼 상자로 그린다 */
function custGeomSvg(spPr: El | null, box: Box, ctx: Ctx, fill: string, line: { w: number; c: string; dash: boolean } | null): string | null {
	const list = path(spPr, "a:custGeom", "a:pathLst");
	if (!list) return null;
	const N = (v: string | null) => (v !== null && /^-?\d+(\.\d+)?$/.test(v) ? +v : NaN);
	const out: string[] = [];
	for (const p of kids(list, "a:path")) {
		// 경로 좌표계 — w · h 가 없으면 도형 크기(EMU) 그대로다
		const pw = N(p.getAttribute("w")) || box.w / ctx.k, ph = N(p.getAttribute("h")) || box.h / ctx.k;
		const sx = box.w / (pw || 1), sy = box.h / (ph || 1);
		const pts = (c: El) => kids(c, "a:pt").map((pt) => [N(pt.getAttribute("x")) * sx, N(pt.getAttribute("y")) * sy]);
		let d = "", cx = 0, cy = 0, bad = false;
		for (const c of p.children) {
			const q = pts(c);
			if (q.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) { bad = true; break; }
			switch (c.tagName) {
				case "a:moveTo": [cx, cy] = q[0]; d += `M${r1(cx)} ${r1(cy)}`; break;
				case "a:lnTo": [cx, cy] = q[0]; d += `L${r1(cx)} ${r1(cy)}`; break;
				case "a:cubicBezTo": d += "C" + q.map((v) => v.map(r1).join(" ")).join(" "); [cx, cy] = q[2]; break;
				case "a:quadBezTo": d += "Q" + q.map((v) => v.map(r1).join(" ")).join(" "); [cx, cy] = q[1]; break;
				case "a:arcTo": {
					// 각도는 60000 분의 1도 · 화면 각도 → 타원 매개 각도로 바꿔 중심과 끝점을 구한다
					const wr = N(c.getAttribute("wR")) * sx, hr = N(c.getAttribute("hR")) * sy;
					const st = (N(c.getAttribute("stAng")) / 60000) * Math.PI / 180, sw = (N(c.getAttribute("swAng")) / 60000) * Math.PI / 180;
					if (![wr, hr, st, sw].every(Number.isFinite)) { bad = true; break; }
					const par = (a: number) => Math.atan2(wr * Math.sin(a), hr * Math.cos(a));
					const t1 = par(st), t2 = par(st + sw);
					const ox = cx - wr * Math.cos(t1), oy = cy - hr * Math.sin(t1);
					cx = ox + wr * Math.cos(t2); cy = oy + hr * Math.sin(t2);
					d += `A${r1(wr)} ${r1(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${r1(cx)} ${r1(cy)}`;
					break;
				}
				case "a:close": d += "Z"; break;
			}
			if (bad) break;
		}
		if (bad) return null;
		if (!d) continue;
		const f = p.getAttribute("fill") === "none" || fill === "none" ? "none" : fill;
		const s = line && p.getAttribute("stroke") !== "0" ? `stroke="${line.c}" stroke-width="${r1(line.w)}"${line.dash ? ' stroke-dasharray="6 4"' : ""}` : "";
		out.push(`<path d="${d}" fill="${f}" ${s}/>`);
	}
	if (!out.length) return null;
	const flip = box.flipH || box.flipV ? ` transform="translate(${box.flipH ? r1(box.w) : 0} ${box.flipV ? r1(box.h) : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})"` : "";
	return `<svg width="${r1(box.w)}" height="${r1(box.h)}" viewBox="0 0 ${r1(box.w)} ${r1(box.h)}" style="position:absolute;left:0;top:0;overflow:visible"><g${flip}>${out.join("")}</g></svg>`;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff" };

/** 쪽이 쓰는 그림 — zip 안 파일을 blob 주소로. 같은 그림은 한 번만. 다 본 뒤 `revoke` 로 푼다 (renderPptx 의 돌려준 값). */
async function mediaPath(ctx: Ctx, zipPath: string): Promise<string | null> {
	if (ctx.media.has(zipPath)) return ctx.media.get(zipPath)!;
	const f = ctx.zip.file(zipPath);
	if (!f) return null;
	const ext = zipPath.split(".").pop()!.toLowerCase();
	// 웹뷰는 EMF · WMF 를 그리지 못한다 — 빈 상자로 남긴다 (ClaudePPT 는 PNG 로 바꿔 쓰지만 미리보기는 건너뛴다)
	if (ext === "emf" || ext === "wmf") {
		ctx.warnings.add("emf");
		return null;
	}
	const url = URL.createObjectURL(new Blob([(await f.async("uint8array")) as BlobPart], { type: MIME[ext] || "application/octet-stream" }));
	ctx.media.set(zipPath, url);
	return url;
}

/** 「투명한 색 설정」(a:clrChange) — 그 색의 점을 투명하게 한 그림을 따로 만든다. 빼면 흰 바탕 그림이 뒤의 도형 · 그림을 가린다.
 *  PowerPoint 도 딱 그 색만이 아니라 아주 가까운 색까지 지운다 — JPEG 의 흰 바탕은 255 가 아닌 점이 섞여 있다 */
async function keyedOut(ctx: Ctx, zipPath: string, _src: string, from: string | null): Promise<string | null> {
	if (!from || !/^#[0-9a-f]{6}$/i.test(from)) return null;
	const key = `${zipPath}#${from}`;
	if (ctx.media.has(key)) return ctx.media.get(key)!;
	try {
		const bytes = await ctx.zip.file(zipPath)!.async("uint8array");
		const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
		const c = new OffscreenCanvas(bmp.width, bmp.height);
		const g = c.getContext("2d")!;
		g.drawImage(bmp, 0, 0);
		const im = g.getImageData(0, 0, bmp.width, bmp.height), d = im.data;
		const [r, gg, b] = [1, 3, 5].map((i) => parseInt(from.slice(i, i + 2), 16));
		const TOL = 6;
		for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) <= TOL && Math.abs(d[i + 1] - gg) <= TOL && Math.abs(d[i + 2] - b) <= TOL) d[i + 3] = 0;
		g.putImageData(im, 0, 0);
		const url = URL.createObjectURL(await c.convertToBlob({ type: "image/png" }));
		ctx.media.set(key, url);
		return url;
	} catch {
		return null;
	}
}

// ── 도형 하나 → HTML ──
async function shapeHtml(el: El, ctx: Ctx, rel: Record<string, string>, tx: Tx, layer: { layoutTree: El | null; masterTree: El | null; inh: (key: { type: string; idx: string } | null) => { ph: PhInfo | null; defaults: TextDefaults[]; kind: "title" | "body" | "other" } }, isSlide: boolean): Promise<string> {
	const tag = el.tagName;
	if (tag === "p:grpSp") {
		const x = path(el, "p:grpSpPr", "a:xfrm");
		const off = kid(x, "a:off"), ext = kid(x, "a:ext"), chOff = kid(x, "a:chOff"), chExt = kid(x, "a:chExt");
		let inner: Tx = tx;
		if (off && ext && chOff && chExt) {
			const sx = num(ext.getAttribute("cx")) / (num(chExt.getAttribute("cx")) || 1), sy = num(ext.getAttribute("cy")) / (num(chExt.getAttribute("cy")) || 1);
			const ox = num(off.getAttribute("x")) * ctx.k, oy = num(off.getAttribute("y")) * ctx.k, cx = num(chOff.getAttribute("x")) * ctx.k, cy = num(chOff.getAttribute("y")) * ctx.k;
			inner = (b) => tx({ ...b, x: ox + (b.x - cx) * sx, y: oy + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy });
		}
		const parts: string[] = [];
		for (const c of el.children) parts.push(await shapeHtml(c, ctx, rel, inner, layer, isSlide));
		return parts.join("\n");
	}
	if (tag === "p:sp") {
		const key = phKey(el);
		// 마스터 · 레이아웃의 자리 표시자는 빈 틀이다 — 쪽에서 채운 것만 그린다
		if (key && !isSlide) return "";
		const info = layer.inh(key);
		const spPr = kid(el, "p:spPr");
		const style = kid(el, "p:style");
		let box = xfrmOf(kid(spPr, "a:xfrm"), ctx, tx) || info.ph?.box || null;
		if (!box) return "";
		const prst = path(spPr, "a:prstGeom")?.getAttribute("prst") || (kid(spPr, "a:custGeom") ? "custom" : "rect");
		// 선 · 연결선 모양의 도형 — 글이 없으면 연결선과 같이 그린다. 2026.11.23 : 상자 테두리로 그려 점선이 실선이 되고 화살촉이 빠졌다
		if (LINE_PRST.test(prst) && !(kid(el, "p:txBody")?.textContent || "").trim()) {
			const line = lineOf(spPr, ctx, style);
			return line ? connectorSvg(box, line, spPr, prst) : "";
		}
		const fill = fillOf(spPr, ctx, style) || (info.ph?.body ? fillOf(info.ph.body, ctx, null) : null);
		const line = lineOf(spPr, ctx, style);
		const st = [posCss(box)];
		let svg: string | null = null;
		const solid = fill && fill !== "none" ? fill : null;
		if (prst === "custom") svg = custGeomSvg(spPr, box, ctx, fill || "none", line);
		if (svg) {
			// 자유형 도형은 SVG 로 그렸다 — 상자 배경 · 테두리를 더하지 않는다
		} else if (prst === "rect" || prst === "roundRect" || prst === "ellipse" || prst === "flowChartProcess" || prst === "flowChartTerminator" || prst === "custom" || prst === "snip1Rect" || prst === "round1Rect" || prst === "round2SameRect") {
			if (solid) st.push(`background:${solid}`);
			if (line) st.push(`border:${r1(line.w)}px ${line.dash ? "dashed" : "solid"} ${line.c}`);
			if (prst === "ellipse") st.push("border-radius:50%");
			if (prst === "roundRect" || prst === "flowChartTerminator") {
				const adj = num(path(spPr, "a:prstGeom", "a:avLst", "a:gd")?.getAttribute("fmla")?.replace("val ", ""), prst === "flowChartTerminator" ? 50000 : 16667);
				// 바깥 모서리 반지름 = 선 가운데 반지름 + 선 두께 반 (아래 grow 로 상자를 넓힌다)
				st.push(`border-radius:${r1(Math.min(box.w, box.h) * adj / 100000 + (line ? line.w / 2 : 0))}px`);
			}
			if (prst === "custom") ctx.warnings.add("custGeom");
		} else {
			const gd = path(spPr, "a:prstGeom", "a:avLst", "a:gd")?.getAttribute("fmla");
			svg = presetSvg(prst, box.w, box.h, fill || "none", line, ((v) => (Number.isFinite(v) ? v : undefined))(gd?.startsWith("val ") ? +gd.slice(4) : NaN));
			if (!svg) { if (solid) st.push(`background:${solid}`); if (line) st.push(`border:${r1(line.w)}px solid ${line.c}`); }
		}
		// PowerPoint 는 선을 도형 테두리 가운데에 긋는다(반은 밖, 반은 안). CSS border 는 상자 안쪽에만 그리므로 상자를 선 두께 반만큼 넓혀
		// 같은 자리에 오게 한다. 2026.11.24 : 6pt 테두리 원이 원본보다 6px 작게 나왔다. 내보내기(exportPptx)는 거꾸로 반만큼 줄여 도형을 만든다
		const grow = !svg && line ? line.w / 2 : 0;
		if (grow) st[0] = posCss({ ...box, x: box.x - grow, y: box.y - grow, w: box.w + grow * 2, h: box.h + grow * 2 });
		const txBody = kid(el, "p:txBody");
		let text = "";
		if (txBody && txBody.textContent?.trim()) {
			const fontRef = path(style, "a:fontRef");
			const refColor = fontRef ? colorOf(fontRef, ctx) : null;
			// 도형 서식(p:style)의 글자색은 마스터 기본 글자 서식보다 가깝다 — 도형 자신의 목록 서식 · 문단 · 조각 서식만 그 위에 선다.
			// 2026.11.24 : 마스터 「기타」 서식의 검정이 이겨, 초록 머리띠 위 흰 글자(lt1)가 검정으로 나왔다
			const defs = info.defaults.map((d) => ({ ...d, color: refColor || d.color || undefined }));
			const t = textHtml(txBody, ctx, defs.length ? defs : [{ color: refColor || undefined }]);
			const phBody = info.ph?.body ? kid(info.ph.body, "a:bodyPr") : null;
			const anchor = kid(txBody, "a:bodyPr")?.getAttribute("anchor") || phBody?.getAttribute("anchor") || (info.kind === "title" ? "ctr" : t.anchor);
			const jc = ({ t: "flex-start", ctr: "center", b: "flex-end" } as Record<string, string>)[anchor] || "flex-start";
			// 글 자리는 원래 도형 상자 기준 — border 안쪽(넓힌 상자 − 선 두께)에서 선 두께 반만큼 다시 밖으로
			text = `<div style="position:absolute;inset:${grow ? r1(-grow) + "px" : "0"};display:flex;flex-direction:column;justify-content:${jc};padding:${t.ins.map((v) => r1(v) + "px").join(" ").replace(/^(\S+) (\S+) (\S+) (\S+)$/, "$2 $3 $4 $1")};line-height:1.2">${t.html}</div>`;
		}
		if (!svg && !text && !solid && !line) return "";
		// 그림자 — 상자는 box-shadow (내보낼 때 PowerPoint 도형 그림자가 된다), SVG 도형은 그 모양을 따르는 drop-shadow.
		// 채움 · 선 없는 글상자의 그림자는 PowerPoint 가 글자에 드리운다 — 상자 그림자로 그리면 안 된다
		const shadow = shadowOf(spPr, ctx, box.rot);
		if (shadow && svg) st.push(`filter:drop-shadow(${shadowCss(shadow)})`);
		else if (shadow && (solid || line)) st.push(`box-shadow:${shadowCss(shadow)}`);
		return `<div style="${st.join(";")}">${svg || ""}${text}</div>`;
	}
	if (tag === "p:pic") {
		const box = xfrmOf(path(el, "p:spPr", "a:xfrm"), ctx, tx);
		if (!box) return "";
		const blip = path(el, "p:blipFill", "a:blip");
		const svgBlip = blip?.getElementsByTagName("asvg:svgBlip")[0];
		const rid = svgBlip?.getAttribute("r:embed") || blip?.getAttribute("r:embed");
		let src = rid && rel[rid] ? await mediaPath(ctx, rel[rid]) : null;
		if (!src) return `<div style="${posCss(box)};border:1px dashed #b9b9b9"></div>`;
		const change = kid(blip, "a:clrChange");
		if (change && !svgBlip) src = (await keyedOut(ctx, rel[rid!], src, colorOf(kid(change, "a:clrFrom"), ctx))) || src;
		const crop = path(el, "p:blipFill", "a:srcRect");
		let img = `<img src="${src}" alt="" style="${posCss(box)};object-fit:fill">`;
		if (crop && ["l", "t", "r", "b"].some((a) => crop.getAttribute(a))) {
			const [l, t, r, b] = ["l", "t", "r", "b"].map((a) => num(crop.getAttribute(a)) / 100000);
			const fw = box.w / (1 - l - r), fh = box.h / (1 - t - b);
			img = `<div style="${posCss(box)};overflow:hidden"><img src="${src}" alt="" style="position:absolute;left:${r1(-l * fw)}px;top:${r1(-t * fh)}px;width:${r1(fw)}px;height:${r1(fh)}px"></div>`;
		}
		// 그림 그림자 — 투명 바탕 그림(손 모양 등)은 모양을 따라 드리운다
		const shadow = shadowOf(kid(el, "p:spPr"), ctx, box.rot);
		if (shadow) img = img.replace(/^(<(?:img|div) [^>]*style="[^"]*)"/, `$1;filter:drop-shadow(${shadowCss(shadow)})"`);
		return img;
	}
	if (tag === "p:cxnSp") {
		const box = xfrmOf(path(el, "p:spPr", "a:xfrm"), ctx, tx);
		if (!box) return "";
		const spPr = kid(el, "p:spPr");
		const line = lineOf(spPr, ctx, kid(el, "p:style")) || { w: 1, c: "#000", dash: false };
		return connectorSvg(box, line, spPr);
	}
	if (tag === "p:graphicFrame") {
		const box = xfrmOf(kid(el, "p:xfrm"), ctx, tx);
		if (!box) return "";
		const tbl = el.getElementsByTagName("a:tbl")[0];
		if (tbl) {
			const cols = [...(kid(tbl, "a:tblGrid")?.children || [])].map((g) => num(g.getAttribute("w")) * ctx.k);
			const rows = kids(tbl, "a:tr").map((tr) => {
				const h = num(tr.getAttribute("h")) * ctx.k;
				const cells = kids(tr, "a:tc").filter((tc) => tc.getAttribute("hMerge") !== "1" && tc.getAttribute("vMerge") !== "1").map((tc) => {
					const tcPr = kid(tc, "a:tcPr");
					const f = fillOf(tcPr, ctx, null);
					const tb = kid(tc, "a:txBody");
					const t = tb ? textHtml(tb, ctx, [{ size: 14, color: "#000000" }]).html : "";
					const span = [tc.getAttribute("gridSpan") ? ` colspan="${tc.getAttribute("gridSpan")}"` : "", tc.getAttribute("rowSpan") ? ` rowspan="${tc.getAttribute("rowSpan")}"` : ""].join("");
					// 칸 여백 · 세로 맞춤 · 테두리는 원본 칸 서식대로 — 여백을 어림값으로 두면 행 높이가 칸마다 1~2px 씩 어긋나 표 아래쪽이 크게 밀린다.
					// 여백 기본값은 OOXML 기본(좌우 0.1인치 · 위아래 0.05인치), 세로 맞춤 기본은 위. 칸에 선이 없으면 표 서식 대신 옅은 회색 선을 둔다
					const va = ({ ctr: "middle", b: "bottom" } as Record<string, string>)[tcPr?.getAttribute("anchor") || ""] || "top";
					const edge = (n: string): [string, number] => {
						const ln = kid(tcPr, n);
						if (!ln) return ["1px solid #c8c8c8", 1];
						if (kid(ln, "a:noFill")) return ["none", 0];
						const c = colorOf(kid(ln, "a:solidFill"), ctx), w = r1(num(ln.getAttribute("w"), 12700) * ctx.k);
						return c ? [`${w}px solid ${c}`, w] : ["1px solid #c8c8c8", 1];
					};
					const [eL, eR, eT, eB] = ["a:lnL", "a:lnR", "a:lnT", "a:lnB"].map(edge);
					const border = `border-left:${eL[0]};border-right:${eR[0]};border-top:${eT[0]};border-bottom:${eB[0]}`;
					// PowerPoint 는 칸 선을 경계 위에 그릴 뿐 행 높이에 넣지 않는다. 웹(border-collapse)은 선 두께 절반씩을 칸 크기에 넣으므로
					// 그만큼 여백에서 뺀다 — 안 빼면 행마다 선 두께만큼 길어져 표 아래쪽이 10px 넘게 밀린다 (2026.11.18 9쪽 표)
					const mar = (a: string, d: number, e: [string, number]) => r1(Math.max(0, num(tcPr?.getAttribute(a), d) * ctx.k - e[1] / 2));
					// 줄 간격 1.2 = PowerPoint 의 「한 줄」. 안 주면 덱 기본(.slide 1.45)을 물려받아 칸 글이 넘친다
					// 문단을 flex 세로 줄에 담는다 — 칸(블록) 안에서는 문단 사이 여백이 겹쳐(collapse) 줄 자리 고침(lineGeo)이 먹지 않는다
					return `<td${span} style="${border};padding:${mar("marT", 45720, eT)}px ${mar("marR", 91440, eR)}px ${mar("marB", 45720, eB)}px ${mar("marL", 91440, eL)}px;vertical-align:${va};line-height:1.2${f && f !== "none" ? `;background:${f}` : ""}"><div style="display:flex;flex-direction:column">${t}</div></td>`;
				});
				return `<tr style="height:${r1(h)}px">${cells.join("")}</tr>`;
			});
			return `<table style="${posCss(box)};height:auto;border-collapse:collapse;table-layout:fixed"><colgroup>${cols.map((w) => `<col style="width:${r1(w)}px">`).join("")}</colgroup>${rows.join("")}</table>`;
		}
		const isChart = !!el.getElementsByTagName("c:chart")[0];
		ctx.warnings.add(isChart ? "chart" : "object");
		return `<div data-import="${isChart ? "chart" : "object"}" style="${posCss(box)};border:1.5px dashed #b9b9b9;display:flex;align-items:center;justify-content:center;color:#8a8a8a;font-size:16px">${isChart ? "chart" : "object"}</div>`;
	}
	if (tag === "mc:AlternateContent") {
		const choice = kid(el, "mc:Fallback") || kid(el, "mc:Choice");
		const parts: string[] = [];
		for (const c of choice?.children || []) parts.push(await shapeHtml(c, ctx, rel, tx, layer, isSlide));
		return parts.join("\n");
	}
	return "";
}

function bgOf(cSld: El | null, ctx: Ctx): { css: string | null; blip: string | null } | null {
	const bg = kid(cSld, "p:bg");
	if (!bg) return null;
	const pr = kid(bg, "p:bgPr");
	if (pr) {
		const blip = path(pr, "a:blipFill", "a:blip")?.getAttribute("r:embed") || null;
		const f = fillOf(pr, ctx, null);
		return { css: f && f !== "none" ? f : null, blip };
	}
	const ref = kid(bg, "p:bgRef");
	if (ref) return { css: colorOf(ref, ctx), blip: null };
	return null;
}

async function readTheme(zip: JSZip, masterPath: string): Promise<Theme> {
	const r = await rels(zip, masterPath);
	const tp = Object.values(r).find((p) => p.includes("theme/"));
	const doc = tp ? await xml(zip, tp) : null;
	const colors: Record<string, string> = {};
	const cs = doc?.getElementsByTagName("a:clrScheme")[0];
	for (const c of cs?.children || []) {
		const v = c.children[0];
		colors[c.tagName.replace("a:", "")] = (v?.getAttribute("val") && v.tagName === "a:srgbClr" ? v.getAttribute("val") : v?.getAttribute("lastClr")) || "000000";
	}
	const font = (n: string, t: string) => doc?.getElementsByTagName(n)[0]?.getElementsByTagName(t)[0]?.getAttribute("typeface") || "";
	return { colors, major: font("a:majorFont", "a:latin"), minor: font("a:minorFont", "a:latin"), majorEa: font("a:majorFont", "a:ea"), minorEa: font("a:minorFont", "a:ea") };
}

/** 미리보기 한 쪽. `html` 은 <section class="slide"> 하나 — 쪽 크기 · 글꼴은 `slideCss` 가 준다. */
export interface SlidePreview { html: string; title: string; notes: string; text: string }
export interface PptxPreview {
	size: { w: number; h: number };
	slides: SlidePreview[];
	/** 못 옮긴 것 — emf · chart · object · custGeom … */
	warnings: string[];
	/** 테마 글꼴 (본문). 없으면 빈 글 */
	font: string;
	/** 다 본 뒤 그림 blob 을 푼다 */
	revoke: () => void;
}

/** 쪽마다 HTML 로. `onSlide` 는 한 쪽을 마칠 때마다 부른다 — 큰 덱도 앞쪽부터 보이게. `stop` 이 참이면 멈춘다(다른 파일로 갔다). */
export async function renderPptx(bytes: Uint8Array, onSlide: (i: number, n: number, s: SlidePreview) => void, stop: () => boolean = () => false): Promise<PptxPreview> {
	const zip = await JSZip.loadAsync(bytes);
	const pres = await xml(zip, "ppt/presentation.xml");
	if (!pres) throw new Error("presentation.xml 이 없다 — PPTX 가 아니다");
	const sz = pres.getElementsByTagName("p:sldSz")[0];
	const cx = num(sz?.getAttribute("cx"), 12192000), cy = num(sz?.getAttribute("cy"), 6858000);
	const W = 1280;
	const k = W / cx;
	const H = Math.round(cy * k);
	const presRels = await rels(zip, "ppt/presentation.xml");
	const order = [...pres.getElementsByTagName("p:sldId")].map((e) => presRels[e.getAttribute("r:id")!]).filter(Boolean);

	const slides: SlidePreview[] = [];
	const warnings = new Set<string>();
	const media = new Map<string, string>();
	let themeFont = "";
	const face = () => null;
	const revoke = () => media.forEach((u) => URL.revokeObjectURL(u));

	for (let i = 0; i < order.length; i++) {
		if (stop()) break;
		// 쪽마다 화면에 한 번 숨을 돌려준다 — 안 그러면 진행 표시가 멈춰 보이고 창이 「응답 없음」이 된다
		await new Promise((r) => setTimeout(r, 0));
		const sp = order[i];
		const slide = await xml(zip, sp);
		if (!slide) continue;
		const sRel = await rels(zip, sp);
		const layoutPath = Object.values(sRel).find((p) => p.includes("slideLayouts/"))!;
		const layout = layoutPath ? await xml(zip, layoutPath) : null;
		const lRel = layoutPath ? await rels(zip, layoutPath) : {};
		const masterPath = Object.values(lRel).find((p) => p.includes("slideMasters/"));
		const master = masterPath ? await xml(zip, masterPath) : null;
		const mRel = masterPath ? await rels(zip, masterPath) : {};
		const theme = masterPath ? await readTheme(zip, masterPath) : { colors: {}, major: "", minor: "", majorEa: "", minorEa: "" };
		themeFont ||= theme.minorEa || theme.minor;
		const cm = master?.getElementsByTagName("p:clrMap")[0];
		const clrMap: Record<string, string> = {};
		for (const a of cm?.attributes || []) clrMap[a.name] = a.value;
		const ovr = slide.getElementsByTagName("a:overrideClrMapping")[0];
		for (const a of ovr?.attributes || []) clrMap[a.name] = a.value;
		const ctx: Ctx = { zip, k, theme, clrMap, media, defaults: { title: {}, body: [], other: {} }, warnings, slideNo: i + 1, face };

		const txStyles = master?.getElementsByTagName("p:txStyles")[0];
		const lvls = (st: El | null) => Array.from({ length: 9 }, (_, n) => textDefaultsOf(kid(st, `a:lvl${n + 1}pPr`), ctx));
		const titleDefs = lvls(kid(txStyles, "p:titleStyle")), bodyDefs = lvls(kid(txStyles, "p:bodyStyle")), otherDefs = lvls(kid(txStyles, "p:otherStyle"));

		const tree = (d: Document | null) => d?.getElementsByTagName("p:spTree")[0] || null;
		const layoutTree = tree(layout), masterTree = tree(master);
		const inh = (key: { type: string; idx: string } | null) => {
			if (!key) return { ph: null, defaults: otherDefs, kind: "other" as const };
			const kind = key.type === "title" || key.type === "ctrTitle" ? "title" : key.type === "body" || key.type === "subTitle" || key.type === "obj" ? "body" : "other";
			const lp = findPh(layoutTree, key), mp = findPh(masterTree, key);
			const pick = (e: El | null) => (e ? xfrmOf(path(e, "p:spPr", "a:xfrm"), ctx, (b) => b) : null);
			const box = pick(lp) || pick(mp);
			const lst = (e: El | null) => path(e, "p:txBody", "a:lstStyle");
			const base = kind === "title" ? titleDefs : kind === "body" ? bodyDefs : otherDefs;
			const merged = base.map((d, n) => {
				const m = textDefaultsOf(kid(lst(mp), `a:lvl${n + 1}pPr`), ctx), l = textDefaultsOf(kid(lst(lp), `a:lvl${n + 1}pPr`), ctx);
				return { ...d, ...strip(m), ...strip(l) };
			});
			return { ph: { box, body: lp ? kid(lp, "p:spPr") : null, type: key.type } as PhInfo, defaults: merged, kind: kind as "title" | "body" | "other" };
		};
		const layer = { layoutTree, masterTree, inh };

		const parts: string[] = [];
		const cSld = kid(slide.documentElement, "p:cSld");
		const bg = bgOf(cSld, ctx) || bgOf(kid(layout?.documentElement, "p:cSld"), ctx) || bgOf(kid(master?.documentElement, "p:cSld"), ctx);
		let bgCss = bg?.css || "#ffffff";
		if (bg?.blip) {
			const rr = { ...mRel, ...lRel, ...sRel };
			const src = rr[bg.blip] ? await mediaPath(ctx, rr[bg.blip]) : null;
			if (src) bgCss = `url('${src}') center/cover no-repeat`;
		}
		// 쪽의 showMasterSp="0" 은 레이아웃 · 마스터 도형을 모두 숨기고, 레이아웃의 showMasterSp="0" 은 마스터 도형만 숨긴다.
		// 쪽 쪽 값을 마스터에만 걸면 숨겨 둔 레이아웃 그림이 웹에만 깔린다 (2026.11.18)
		const showLayout = slide.documentElement.getAttribute("showMasterSp") !== "0";
		const showMaster = showLayout && layout?.documentElement.getAttribute("showMasterSp") !== "0";
		if (showMaster && masterTree) for (const c of masterTree.children) parts.push(await shapeHtml(c, ctx, mRel, (b) => b, layer, false));
		if (showLayout && layoutTree) for (const c of layoutTree.children) parts.push(await shapeHtml(c, ctx, lRel, (b) => b, layer, false));
		const sTree = tree(slide);
		for (const c of sTree?.children || []) parts.push(await shapeHtml(c, ctx, sRel, (b) => b, layer, true));

		// 제목 — 제목 자리 표시자의 글자
		let stitle = "";
		for (const spEl of sTree?.getElementsByTagName("p:sp") || []) {
			const k2 = phKey(spEl);
			if (k2 && (k2.type === "title" || k2.type === "ctrTitle")) { stitle = (spEl.textContent || "").replace(/\s+/g, " ").trim(); break; }
		}
		// 제목 자리 표시자 없이 글상자로 제목을 단 덱이 많다 — 그때는 가장 큰 글자(같으면 위쪽)의 첫 문단을 제목으로 삼는다.
		// 제목이 비면 쪽 목록 · @쪽 고르기 창에 「제목 없음」만 늘어서 쪽을 가려 고를 수 없다
		if (!stitle) {
			let best = { sz: 0, y: Infinity, text: "" };
			for (const spEl of sTree?.getElementsByTagName("p:sp") || []) {
				const p = [...spEl.getElementsByTagName("a:p")].find((x) => (x.textContent || "").trim());
				if (!p) continue;
				const sz = Math.max(0, ...[...p.getElementsByTagName("a:rPr")].map((r) => num(r.getAttribute("sz"))));
				const y = num(path(spEl, "p:spPr", "a:xfrm", "a:off")?.getAttribute("y"), Infinity);
				if (sz > best.sz || (sz === best.sz && y < best.y)) best = { sz, y, text: (p.textContent || "").replace(/\s+/g, " ").trim() };
			}
			stitle = best.text.slice(0, 60);
		}
		// 발표자 메모
		const notesPath = Object.values(sRel).find((p) => p.includes("notesSlides/"));
		let notes = "";
		if (notesPath) {
			const nd = await xml(zip, notesPath);
			for (const spEl of nd?.getElementsByTagName("p:sp") || []) {
				if (phKey(spEl)?.type === "body") notes = [...spEl.getElementsByTagName("a:p")].map((p) => p.textContent).join("\n").trim();
			}
		}

		const html = `<section class="slide" style="background:${bgCss}">\n${parts.filter(Boolean).join("\n")}\n</section>`;
		// 찾기에 쓸 쪽 글 — 도형 글 · 메모를 한 줄로
		const text = [...(sTree?.getElementsByTagName("a:t") || [])].map((t) => t.textContent).join(" ");
		const one: SlidePreview = { html, title: stitle.slice(0, 60), notes, text };
		slides.push(one);
		onSlide(i, order.length, one);
	}
	return { size: { w: W, h: H }, slides, warnings: [...warnings], font: themeFont, revoke };
}

/** 쪽을 그릴 서식 — ClaudePPT 의 themeCss 에서 쪽 틀만 옮겼다. `font` 는 테마 본문 글꼴. */
export function slideCss(size: { w: number; h: number }, font: string) {
	const fam = `${font ? `"${font.replace(/"/g, "")}", ` : ""}"Malgun Gothic", sans-serif`;
	return `:host { --font: ${fam}; }
* { box-sizing: border-box; }
.slide {
	position: relative;
	width: ${size.w}px;
	height: ${size.h}px;
	overflow: hidden;
	background: #fff;
	color: #000;
	font-family: var(--font);
	font-size: 24px;
	line-height: 1.45;
	word-break: keep-all;
}
.slide h1, .slide h2, .slide h3, .slide p { margin: 0; }
/* 가져온 PPTX 의 글자 틀 — 칸보다 긴 한 낱말은 PowerPoint 처럼 글자 사이에서 꺾는다 */
.slide p { white-space: pre-wrap; overflow-wrap: anywhere; }
`;
}

const strip = (o: TextDefaults) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""));
