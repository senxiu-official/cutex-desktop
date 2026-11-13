// 接下来 row hover probe on the isolated mock preview (headless Chrome, real layout and real CDP mouse input).
// node apps/desktop/scripts/probe-nextup-hover.mjs --url http://127.0.0.1:5387/ --query "inputLedger&ledgerScene=turn"
//   --agent <id> --out <dir>
// Queues an owner message on a running agent, then measures the queued row in its plain and hover states (row,
// card and composer geometry), holds the pointer still on it for 3 s (hover toggles, geometry changes, the row
// element replaced under the pointer), and sweeps the pointer across every pixel row of it (each position held
// 250 ms) at the text and at the actions end. A flicker shows as toggles while the pointer does not move, or as a
// geometry difference between the two states.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const out = resolve(opt("out", "D:/Work/scratch/night-perf-fixes/hover"));
const base = new URL(opt("url", "http://127.0.0.1:5387/"));
if (!["127.0.0.1", "localhost"].includes(base.hostname) || !/^53\d\d$/.test(base.port)) throw Error("Use only a 53xx loopback mock preview");
const query = opt("query", ""), agent = opt("agent", "kai"), text = opt("text", "你自己创建agent哈");
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9750 + Math.floor(Math.random() * 90);
const chrome = spawn(opt("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(out, "chrome")}`, "--window-size=1440,960", "--force-device-scale-factor=1", "--no-first-run", "about:blank"], { stdio: "ignore" });
writeFileSync(join(out, "chrome.pid"), String(chrome.pid));
let ws, next = 0; const pending = new Map();
try {
  for (let i = 0; i < 200 && !ws; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = new WebSocket(t.find(x => x.type === "page").webSocketDebuggerUrl); } catch { await sleep(100); } }
  if (!ws) throw Error("Chrome startup failed");
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++next; pending.set(id, m => m.error ? rej(Error(`${method}: ${m.error.message}`)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const frames = n => ev(`new Promise(r=>{let k=${n};const f=()=>--k<=0?r():requestAnimationFrame(f);requestAnimationFrame(f)})`);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${base.origin}/?perf=quiet&publishAt=99999${query ? `&${query}` : ""}` });
  for (let i = 0; i < 1200 && !(await ev("!!window.__cutexPerfApp")); i++) await sleep(50);
  await sleep(800);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部跳过')?.click()`);
  await ev(`window.__cutexPerfApp.store.useApp.getState().openAgent(${JSON.stringify(agent)},'local')`);
  await sleep(1500);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部跳过')?.click()`);
  await ev(`(()=>{const e=[...document.querySelectorAll('[data-composer-input]')].find(e=>e.checkVisibility());e.focus()})()`);
  await send("Input.insertText", { text });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(2000);
  // The probe's view of the row: the last queued owner row (ledger or legacy), its card and the composer.
  await ev(`window.__probe={
    row(){return [...document.querySelectorAll('[data-testid=ledger-queue-row],[data-testid=queue-item]')].filter(e=>e.checkVisibility()).at(-1)??null},
    card(r){let e=r;while(e&&!(e.textContent.includes('接下来')&&e.querySelector('[data-composer-input]')))e=e.parentElement;return e},
    geo(){const r=this.row();if(!r)return null;const g=e=>{const b=e.getBoundingClientRect();return {top:+b.top.toFixed(2),h:+b.height.toFixed(2)}};const c=this.card(r);const inp=[...document.querySelectorAll('[data-composer-input]')].find(e=>e.checkVisibility());
      const actions=r.querySelector('[data-testid=queue-item-actions]')??[...r.querySelectorAll('span')].find(s=>s.className.includes('group-hover/row:opacity-100'));
      return {row:g(r),card:c?g(c):null,composer:inp?g(inp):null,hover:r.matches(':hover'),actionsShown:actions?getComputedStyle(actions).opacity:null,text:r.innerText.replace(/\\s+/g,' ').trim(),testid:r.dataset.testid}}
  };true`);
  const plain = await ev("window.__probe.geo()");
  if (!plain) throw Error("no queued owner row: " + await ev("document.body.innerText.slice(0,400)"));
  await move(5, 5); await frames(4);
  const plainAway = await ev("window.__probe.geo()");
  const r = plainAway.row;
  const cx = await ev("(()=>{const b=window.__probe.row().getBoundingClientRect();return {left:b.left,right:b.right}})()");
  const shot = async name => { const s = await send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, cx.left - 40), y: Math.max(0, plainAway.card ? plainAway.card.top - 50 : r.top - 80), width: cx.right - cx.left + 80, height: (plainAway.card?.h ?? 200) + 110, scale: 1 } }); writeFileSync(join(out, `${name}.png`), Buffer.from(s.data, "base64")); };
  await shot("plain");
  const mid = { x: Math.round(cx.left + (cx.right - cx.left) * 0.4), y: Math.round(r.top + r.h / 2) };
  await move(mid.x, mid.y); await frames(4);
  const hover = await ev("window.__probe.geo()");
  await shot("hover");
  // Hold still for 3 s: hover toggles, geometry changes, row element replaced.
  const hold = await ev(`new Promise(res=>{const p=window.__probe;const shape=g=>JSON.stringify({row:g.row,card:g.card,composer:g.composer});let row=p.row(),last=shape(p.geo()),toggles=0,geoChanges=0,replaced=0,frames=0,lastHover=row.matches(':hover');const t0=performance.now();
    const f=()=>{frames++;const now=p.row();if(now!==row){replaced++;row=now}if(row){const h=row.matches(':hover');if(h!==lastHover){toggles++;lastHover=h}const k=shape(p.geo());if(k!==last){geoChanges++;last=k}}
      if(performance.now()-t0<3000)requestAnimationFrame(f);else res({frames,toggles,geoChanges,replaced})};requestAnimationFrame(f)})`);
  // Sweep every pixel row across the row's top and bottom edges, at the text and at the actions end.
  const sweep = [];
  for (const x of [mid.x, Math.round(cx.right - 12)]) {
    for (let y = Math.floor(r.top) - 3; y <= Math.ceil(r.top + r.h) + 3; y++) {
      await move(x, y); await frames(2);
      const a = await ev("window.__probe.geo()");
      const held = await ev(`new Promise(res=>{const p=window.__probe;let row=p.row(),lastHover=row?.matches(':hover'),toggles=0,geo=new Set();const t0=performance.now();const f=()=>{const now=p.row();if(now){const h=now.matches(':hover');if(h!==lastHover){toggles++;lastHover=h}const g=p.geo();geo.add(JSON.stringify([g.row.top,g.row.h,g.card?.top,g.card?.h,g.composer?.top]))}if(performance.now()-t0<250)requestAnimationFrame(f);else res({toggles,geometries:geo.size})};requestAnimationFrame(f)})`);
      sweep.push({ x, y, hover: a.hover, rowH: a.row.h, cardH: a.card?.h ?? null, composerTop: a.composer?.top ?? null, toggles: held.toggles, geometries: held.geometries });
    }
  }
  const result = { query, agent, plain: plainAway, hover, sameHeight: { row: plainAway.row.h === hover.row.h, card: plainAway.card?.h === hover.card?.h, composerTop: plainAway.composer?.top === hover.composer?.top }, hold,
    sweep: { positions: sweep.length, withToggles: sweep.filter(s => s.toggles).length, withGeometryChange: sweep.filter(s => s.geometries > 1).length, cardHeights: [...new Set(sweep.map(s => s.cardH))], composerTops: [...new Set(sweep.map(s => s.composerTop))], rowHeights: [...new Set(sweep.map(s => s.rowH))] }, sweepDetail: sweep };
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
  const { sweepDetail, ...summary } = result;
  console.log(JSON.stringify(summary, null, 1));
  await Promise.race([send("Browser.close"), sleep(500)]);
} finally { ws?.close(); chrome.kill(); }
