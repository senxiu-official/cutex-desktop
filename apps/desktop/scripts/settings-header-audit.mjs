// Settings card headers (owner 2026-10-25: the title never truncates): every Settings page in the mock preview at
// several window widths. Each card title must show whole (scrollWidth <= clientWidth), its header must not overflow,
// and the title, its card-level markers and the controls must not overlap. Exits 1 on a problem.
//   Needs the renderer mock preview (vite --config vite.preview.config.ts) and a Chrome with --remote-debugging-port.
//   node scripts/settings-header-audit.mjs [widths=1440,1280,1024]
//   env: PREVIEW_URL (http://127.0.0.1:5341/), CDP_PORT (9341); SHOTS=<dir>: 通知 → 事件分级 at each width.
import { mkdirSync, writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ?perf=quiet: the app hook (window.__cutexPerfApp) the script drives Settings with.
const PREVIEW = new URL("?perf=quiet", process.env.PREVIEW_URL ?? "http://127.0.0.1:5341/").href;
const WIDTHS = (process.argv[2] ?? "1440,1280,1024").split(",").map(Number);
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? 9341}/json`)).json();
const page = list.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, (m) => (m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
};
const ready = async () => {
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    if (await evalJs("!!window.__cutexPerfApp").catch(() => false)) return;
  }
  throw new Error("the preview did not start");
};

// Every card header on the shown page.
const CHECK = `(() => {
  const bad = [];
  let n = 0;
  for (const h3 of document.querySelectorAll("section h3")) {
    const head = h3.closest("[data-settings-card-head]") ?? h3.parentElement;
    if (!head) continue;
    n++;
    const name = h3.textContent.trim().slice(0, 40);
    if (h3.scrollWidth > h3.clientWidth + 1) bad.push({ name, why: "title truncated", scroll: h3.scrollWidth, client: h3.clientWidth });
    if (head.scrollWidth > head.clientWidth + 1) bad.push({ name, why: "header overflows", scroll: head.scrollWidth, client: head.clientWidth });
    const parts = [h3, head.querySelector("[data-effect-card-summary]"), head.querySelector("[data-settings-card-controls]")].filter(Boolean);
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i].getBoundingClientRect(), b = parts[j].getBoundingClientRect();
        if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push({ name, why: "overlap", parts: [i, j] });
      }
  }
  return { n, bad };
})()`;

await send("Page.enable");
await send("Page.navigate", { url: PREVIEW });
await ready();
await evalJs(`localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 99, whatsNew: false, lastWhatsNew: "9.9.9" })); localStorage.setItem("cutex-desktop.guides", JSON.stringify({ asked: true, skipped: "9.9.9" })); true`);
let problems = 0;
for (const w of WIDTHS) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "about:blank" });
  await send("Page.navigate", { url: PREVIEW });
  await ready();
  await sleep(1200);
  await evalJs(`window.__cutexPerfApp.store.useApp.getState().openSettings("notifications"); true`);
  await sleep(1500);
  const pages = await evalJs(`document.querySelectorAll("nav[data-settings-rail] button:not([data-settings-search-button])").length`);
  let cards = 0;
  const bad = [];
  for (let i = 0; i < pages; i++) {
    const name = await evalJs(`(() => { const b = [...document.querySelectorAll("nav[data-settings-rail] button:not([data-settings-search-button])")][${i}]; if (!b) return null; b.click(); return (b.getAttribute("aria-label") || b.textContent || "").trim(); })()`);
    await sleep(900);
    const r = await evalJs(CHECK);
    cards += r.n;
    for (const b of r.bad) bad.push({ page: name, ...b });
  }
  problems += bad.length;
  console.log(`${w}px: ${pages} pages, ${cards} cards, ${bad.length} problems`);
  for (const b of bad) console.log("  ", JSON.stringify(b));
  if (process.env.SHOTS) {
    mkdirSync(process.env.SHOTS, { recursive: true });
    await evalJs(`window.__cutexPerfApp.store.useApp.getState().openSettings("notifications"); true`);
    await sleep(1200);
    await evalJs(`(() => { const h = [...document.querySelectorAll("section h3")].find((x) => x.textContent.trim() === "事件分级"); h?.closest("section").scrollIntoView({ block: "start" }); return !!h; })()`);
    await sleep(700);
    writeFileSync(`${process.env.SHOTS}/events-${w}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  }
}
ws.close();
process.exit(problems ? 1 : 0);
