#!/usr/bin/env node
// Real-layout check of the roster spacing rule (design 060 §5.6, styles.css 「Roster spacing」): renders the browser
// preview (mock bridge, no daemon) in headless Chrome over the DevTools protocol, measures the vertical gap between
// every pair of neighbouring rows, and fails when one differs from the table. Also checks that every text in a
// system row on the 灰底条 band is at least 4.5:1 against the row's background (resting, hover, selected).
//
//   node apps/desktop/scripts/roster-gaps.mjs --url http://127.0.0.1:5363 [--chrome <path>] [--theme light|dark]
//
// Chrome: --chrome, else $CHROME, else `google-chrome`. Only loopback preview URLs are accepted.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = { theme: "light", palette: "", chrome: process.env.CHROME || "google-chrome", url: "" };
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, "")] = args[i + 1];
const base = new URL(opt.url || "http://127.0.0.1:5199");
if (!["127.0.0.1", "localhost"].includes(base.hostname) || ["24260", "24270", "25370"].includes(base.port)) throw new Error("a loopback preview URL only");

/** The rule (keep in step with styles.css and design 060 §5.6), per 项目颜色 mode. */
const GAPS = {
  none: { section: 12, project: 6, row: 0, child: 2 },
  header: { section: 12, project: 4, row: 0, child: 2 },
  iconLine: { section: 12, project: 6, row: 0, child: 2 },
  tint: { section: 12, project: 8, row: 2, child: 2 },
  rail: { section: 12, project: 8, row: 2, child: 2 },
};
const SCENES = [
  { systemRows: "line", separation: "none" },
  { systemRows: "band", separation: "none" },
  { systemRows: "band", separation: "tint" },
  { systemRows: "line", separation: "header" },
];

const L = (id) => JSON.stringify(["local", id]);
const W = (id) => JSON.stringify(["ssh-7a3f01c2", id]);
const prefs = (scene) => ({
  systemRows: scene.systemRows,
  projectSeparation: scene.separation,
  projectSeparationRev: 2,
  olderProjectsAfter: 3,
  sidebarSections: [
    { id: "s-sides", name: "SIDES", collapsed: false, members: [L("desktop"), L("waveline"), W("waveline")], look: { color: "#0D9488", icon: "layers" } },
    { id: "s-res", name: "研究", collapsed: false, members: [L("ifm-ema"), L("demo"), L("vcc-2026")], look: { color: "#8B5CF6", icon: "flask" } },
    { id: "s-misc", name: "杂事", collapsed: true, members: [L("chores"), L("kks")] },
  ],
  foldedProjects: [L("desktop"), W("waveline"), L("demo"), W("kks"), L("demo-cs")],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), "cutex-gaps-"));
const chrome = spawn(opt.chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1200,1400", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
const finish = (code) => { chrome.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); };
let ws;
for (let i = 0; i < 75 && !ws; i++) {
  await sleep(200);
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
if (!ws) { console.error("roster-gaps: no DevTools endpoint"); finish(1); }
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const r = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1400, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opt.theme }] });

/** In the page: every neighbouring pair of roster rows with its gap and what the rule expects. */
const MEASURE = String.raw`(() => {
  const g = JSON.parse(document.querySelector("[data-sidebar-roster]").dataset.gaps);
  const kind = (el) => el.dataset.rosterKind + (el.hasAttribute("data-folded") ? "·1行" : "");
  const out = [];
  const add = (pair, a, b, want) => out.push({ pair, gap: Math.round((b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) * 10) / 10, want });
  const visible = (el) => el.getBoundingClientRect().height > 0;
  for (const el of document.querySelectorAll("[data-sidebar-roster] [data-roster-kind]")) {
    const next = el.nextElementSibling;
    if (next?.matches("[data-roster-kind]") && visible(el) && visible(next)) {
      const section = [el, next].some((x) => x.dataset.rosterKind === "folder" || x.dataset.rosterKind === "system");
      add(kind(el) + " → " + kind(next), el, next, section ? g.section : el.hasAttribute("data-folded") ? g.row : g.project);
    }
  }
  for (const body of document.querySelectorAll("[data-sidebar-roster] [data-roster-body]")) {
    const head = body.previousElementSibling;
    if (head && visible(body)) add(kind(body.parentElement) + " 标题 → 第一个项目", head, body, g.child);
  }
  // Inside an open project / system row: header → rows → 「在线空闲 / 离线 +N」 lines, no gaps.
  for (const block of document.querySelectorAll("[data-sidebar-roster] section[data-roster-kind][data-group-key]:not([data-folded])")) {
    const parts = [...block.children].filter((c) => visible(c) && getComputedStyle(c).position !== "absolute");
    for (let i = 0; i + 1 < parts.length; i++) add(kind(block) + " 内：标题/行 → 下一行", parts[i], parts[i + 1], 0);
    const body = parts.at(-1);
    const rows = body ? [...body.children].filter(visible) : [];
    for (let i = 0; i + 1 < rows.length; i++) add(kind(block) + " 内：" + (rows[i + 1].querySelector("[aria-expanded]") && rows[i + 1].textContent.includes("+") ? "行 → 折叠行" : "行 → 行"), rows[i], rows[i + 1], 0);
  }
  return out;
})()`;

/** Text contrast inside system rows on the band, resting / hover / selected. */
const CONTRAST = String.raw`(() => {
  // Any CSS colour (oklab / color-mix included) as sRGB bytes + alpha, through a 1×1 canvas.
  const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true });
  const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => top[3] >= 1 ? top : [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(rgb(getComputedStyle(e).backgroundColor)); let c = [255, 255, 255, 1]; const page = rgb(getComputedStyle(document.body).backgroundColor); c = page[3] ? over(page, c) : c; for (const x of chain.reverse()) if (x[3] > 0) c = over(x, c); return c; };
  const worst = [];
  for (const row of document.querySelectorAll(window.__qaOnlyHover ? "[data-system-rows=band] [data-system-row]:hover" : "[data-system-rows=band] [data-system-row]")) {
    const bg = bgOf(row);
    for (const t of row.querySelectorAll("span, svg")) {
      if (!t.getBoundingClientRect().width || (t.tagName === "SPAN" && ![...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
      const fg = over(rgb(getComputedStyle(t).color), bg);
      const a = lum(fg), b = lum(bg);
      worst.push({ text: (t.textContent || t.tagName).trim().slice(0, 16), ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 });
    }
  }
  return worst.sort((x, y) => x.ratio - y.ratio).slice(0, 3);
})()`;

let failed = 0;
for (const scene of SCENES) {
  const g = GAPS[scene.separation];
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.clear(); localStorage.setItem("cutex-desktop.locale", "zh-CN"); localStorage.setItem("cutex-desktop.onboarding", ${JSON.stringify(JSON.stringify({ doneRevision: 999, whatsNew: false }))}); localStorage.setItem("cutex-desktop.ui", ${JSON.stringify(JSON.stringify(prefs(scene)))}); } catch {}` });
  const url = new URL(base); url.searchParams.set("oldservices", "");
  await send("Page.navigate", { url: url.href });
  const deadline = Date.now() + 90_000;
  while (!(await evaluate(`document.querySelectorAll("[data-sidebar-roster] [data-roster-kind]").length > 8 && !!document.querySelector("[data-older-projects]")`).catch(() => false))) {
    if (Date.now() > deadline) { console.error("roster-gaps: the roster did not render"); finish(1); }
    await sleep(500);
  }
  // Open every 更早的项目 (header → first project is a pair too); hand the rule's values to the page.
  if (opt.palette) await evaluate(`document.documentElement.dataset[${JSON.stringify(opt.theme === "dark" ? "darkPalette" : "lightPalette")}] = ${JSON.stringify(opt.palette)}`);
  await evaluate(`(() => { document.querySelectorAll("[data-older-projects] [data-folder-header][aria-expanded=false]").forEach((b) => b.click()); document.querySelector("[data-sidebar-roster]").dataset.gaps = ${JSON.stringify(JSON.stringify(g))}; })()`);
  await sleep(800);
  const pairs = await evaluate(MEASURE);
  const byPair = new Map();
  for (const p of pairs) {
    const e = byPair.get(p.pair) ?? { want: p.want, seen: new Set(), n: 0 };
    e.seen.add(p.gap); e.n++; byPair.set(p.pair, e);
  }
  console.log(`\n${scene.systemRows} · 项目颜色 ${scene.separation} · ${opt.theme}`);
  for (const [pair, e] of byPair) {
    const bad = [...e.seen].filter((v) => Math.abs(v - e.want) > 0.5);
    if (bad.length) failed++;
    console.log(`  ${bad.length ? "✗" : "✓"} ${pair.padEnd(28)} ${String(e.want).padStart(3)} px  measured ${[...e.seen].join(", ")} (${e.n})`);
  }
  if (scene.systemRows === "band") {
    for (const state of ["resting", "hover", "selected"]) {
      if (state === "hover") {
        // A real pointer over the first band row; only that row is measured then.
        const r = await evaluate(`(() => { const el = document.querySelector("[data-system-rows=band] [data-system-row]"); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
        await sleep(300);
      }
      if (state === "selected") await evaluate(`document.querySelectorAll("[data-system-rows=band] [data-system-row]").forEach((r) => r.setAttribute("data-highlight", ""))`);
      await evaluate(`window.__qaOnlyHover = ${state === "hover"}`);
      const worst = await evaluate(CONTRAST);
      const low = worst.filter((w) => w.ratio < 4.5);
      if (low.length) failed++;
      console.log(`  ${low.length ? "✗" : "✓"} 灰底条 ${state}: lowest text contrast ${worst.map((w) => `${w.ratio} (${w.text})`).join(", ")}`);
      if (state === "hover") await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1190, y: 10 });
    }
  }
}
console.log(failed ? `\nroster-gaps: ${failed} failing pair(s)` : "\nroster-gaps: all pairs follow the rule");
finish(failed ? 1 : 0);
