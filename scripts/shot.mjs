#!/usr/bin/env node
// One JPEG of the browser preview (mock bridge: no daemon, no credentials, no model calls) with headless
// google-chrome over the DevTools protocol — plain Node 22+ (global fetch / WebSocket), no puppeteer or
// playwright. Start the preview first (apps/desktop: `npm run preview:web -- --port 5241`), then e.g.
//
//   node scripts/shot.mjs --url 'http://127.0.0.1:5241/?desktop' --out /home/ema/cutex-dev/shots/0.2-x/desk.jpg
//   node scripts/shot.mjs --url 'http://127.0.0.1:5241/?desktop' --theme dark --locale en --size 1280x800 \
//     --wait-for '[data-desk-surface]' --eval 'document.querySelector("[data-running-agents]") !== null' --out a.jpg
//
// Flags (all optional but --url / --out):
//   --theme light|dark       prefers-color-scheme and the app's theme setting (default light)
//   --locale zh-CN|en|…      the app's language (default zh-CN)
//   --size WxH               viewport (default 1600x940)
//   --wait-for <selector>    wait until it exists (up to --timeout ms), then --settle ms more
//   --wait <ms>              fixed wait after load instead (default 6000 when no --wait-for)
//   --eval <js>              run in the page before the shot (repeatable; a promise is awaited; the value is printed)
//   --click <selector>       click it before the shot (repeatable, in order with --eval)
//   --settle <ms>            pause after each step and before the shot (default 800)
//   --timeout <ms>           for --wait-for (default 20000)
//   --keep-onboarding        do not pre-mark the introduction / 新功能 dialog as seen
//
// The introduction dialog is skipped by seeding its localStorage record before the page loads (a fresh
// Chrome profile per run, so nothing else carries over). Only loopback preview URLs are accepted, never a
// daemon or acceptance port.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = { theme: "light", locale: "zh-CN", size: "1600x940", settle: "800", timeout: "20000", steps: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => {
    if (i + 1 >= args.length) fail(`${a} needs a value`);
    return args[++i];
  };
  if (a === "--eval") opt.steps.push({ eval: next() });
  else if (a === "--click") opt.steps.push({ click: next() });
  else if (a === "--keep-onboarding") opt.keepOnboarding = true;
  else if (/^--(url|out|theme|locale|size|wait-for|wait|settle|timeout)$/.test(a)) opt[a.slice(2)] = next();
  else fail(`unknown flag ${a}`);
}
function fail(message) {
  console.error(`shot: ${message}`);
  process.exit(2);
}
if (!opt.url || !opt.out) fail("usage: node scripts/shot.mjs --url <preview url> --out <file.jpg> [flags]");
const url = new URL(opt.url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) fail("only a loopback preview URL");
if (["24260", "24270", "25260", "25270", "25360", "25370"].includes(url.port)) fail("that is a daemon port, not the preview");
const [w, h] = opt.size.split("x").map(Number);
if (!(w > 0 && h > 0)) fail("--size WxH");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "cutex-shot-"));
const chrome = spawn("google-chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--lang=${opt.locale}`, `--window-size=${w},${h}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const done = (code) => {
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(code);
};
chrome.on("error", (e) => {
  console.error(`shot: cannot start google-chrome (${e.message})`);
  done(1);
});

let ws;
for (let i = 0; i < 75 && !ws; i++) {
  await sleep(200);
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
if (!ws) {
  console.error("shot: Chrome's DevTools endpoint did not come up");
  done(1);
}
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result;

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opt.theme }] });
// Before any app code runs: language, theme and (unless kept) the introduction marked as seen (lib/onboarding).
const seen = { doneRevision: 999, whatsNew: false, lastWhatsNew: null, testEveryBuild: false, lastTestBuild: null };
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `try { localStorage.setItem("cutex-desktop.locale", ${JSON.stringify(opt.locale)}); localStorage.setItem("cutex-desktop.theme", ${JSON.stringify(opt.theme)});${opt.keepOnboarding ? "" : ` localStorage.setItem("cutex-desktop.onboarding", ${JSON.stringify(JSON.stringify(seen))});`} } catch {}`,
});
await send("Page.navigate", { url: url.href });

if (opt["wait-for"]) {
  const deadline = Date.now() + Number(opt.timeout);
  const sel = JSON.stringify(opt["wait-for"]);
  while (!(await evaluate(`!!document.querySelector(${sel})`))?.result?.value) {
    if (Date.now() > deadline) {
      console.error(`shot: ${opt["wait-for"]} did not appear in ${opt.timeout} ms`);
      done(1);
    }
    await sleep(250);
  }
} else await sleep(Number(opt.wait ?? 6000));
await sleep(Number(opt.settle));

for (const step of opt.steps) {
  const expression = step.click ? `(() => { const el = document.querySelector(${JSON.stringify(step.click)}); if (!el) throw new Error("no element " + ${JSON.stringify(step.click)}); el.click(); return true; })()` : step.eval;
  const r = await evaluate(expression);
  if (r?.exceptionDetails) {
    console.error(`shot: ${step.click ? `--click ${step.click}` : "--eval"} failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    done(1);
  }
  if (step.eval && r?.result?.value !== undefined) console.log("eval:", JSON.stringify(r.result.value).slice(0, 600));
  await sleep(Number(opt.settle));
}

const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
const out = resolve(opt.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("shot:", out);
done(0);
