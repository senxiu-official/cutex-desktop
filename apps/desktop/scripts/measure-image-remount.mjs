// What a conversation with many images costs when it mounts again (switch away and back), on the isolated mock
// preview; never a daemon or the owner's browser.
// node apps/desktop/scripts/measure-image-remount.mjs --url http://127.0.0.1:5387/ --out <dir> [--count 120]
//   [--mode refs|mixed|paths] [--turns 60] [--latency 15] [--remounts 3] [--repeat 2]
// Per open: host reads by kind (dev/devImageHeavy calls), image load events (each one a decode), animation frames
// in which an on-screen image box showed the loading placeholder, time until every on-screen image is painted, and
// long tasks. Open 1 is the cold mount; opens 2+ are remounts after visiting another agent.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const out = resolve(opt("out", "D:/Work/scratch/night-perf-fixes/remount"));
const base = new URL(opt("url", "http://127.0.0.1:5387/"));
if (!["127.0.0.1", "localhost"].includes(base.hostname) || !/^53\d\d$/.test(base.port)) throw Error("Use only a 53xx loopback mock preview");
const count = Number(opt("count", "120")), mode = opt("mode", "refs"), latency = Number(opt("latency", "15"));
const remounts = Number(opt("remounts", "3")), repeats = Number(opt("repeat", "2"));
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const init = `(() => {
 const p=window.__remount={long:[],loads:0,active:false,placeholderFrames:0,maxPlaceholders:0,frames:0};
 new PerformanceObserver(list=>{for(const x of list.getEntries())if(p.active)p.long.push(x.duration)}).observe({type:'longtask',buffered:false});
 document.addEventListener('load',e=>{if(p.active&&e.target instanceof HTMLImageElement&&e.target.closest('[data-timeline-root]'))p.loads++},true);
 window.__vis=e=>{const root=e.closest('[data-timeline-root]');const s=root?.parentElement?.getBoundingClientRect();const r=e.getBoundingClientRect();return !!s&&r.width>0&&r.bottom>s.top&&r.top<s.bottom};const visible=window.__vis;
 const tick=()=>{if(p.active){p.frames++;const boxes=[...document.querySelectorAll('[data-timeline-root] span[role=status][data-image-box], [data-timeline-root] span[role=status].bg-surface-2')].filter(visible).filter(e=>!e.closest('[data-tl-far]'));if(boxes.length){p.placeholderFrames++;p.maxPlaceholders=Math.max(p.maxPlaceholders,boxes.length)}}requestAnimationFrame(tick)};requestAnimationFrame(tick);
})()`;

const all = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  const profile = join(out, `chrome-${repeat}`), port = 9850 + Math.floor(Math.random() * 100);
  const chrome = spawn(opt("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,960", "--force-device-scale-factor=1", "--no-first-run", "about:blank"], { stdio: "ignore" });
  writeFileSync(join(out, `chrome-${repeat}.pid`), String(chrome.pid));
  let ws, next = 0;
  const pending = new Map();
  try {
    for (let i = 0; i < 200 && !ws; i++) {
      try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl); } catch { await sleep(100); }
    }
    if (!ws) throw Error("Chrome startup failed");
    await new Promise(r => ws.onopen = r);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } };
    const send = (method, params = {}) => new Promise((res, rej) => { const id = ++next; pending.set(id, m => m.error ? rej(Error(`${method}: ${m.error.message}`)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
    const wait = async (expression, timeout = 120000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await ev(expression)) return; await sleep(30); } throw Error(`Timeout: ${expression}`); };
    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: init });
    const url = new URL(base); url.search = new URLSearchParams({ perf: "quiet", imageheavy: String(count), heavyMode: mode, heavyTurns: opt("turns", "60"), heavyLatency: String(latency), publishAt: "99999" }).toString();
    await send("Page.navigate", { url: url.href });
    await wait("!!window.__cutexPerfApp && !!window.__imageHeavy");
    await ev(`(async()=>{const m=await import('/src/lib/prefs.ts');m.setUiPref('timelineTurns',60);m.setUiPref('messageImages','thumbnail');m.setUiPref('perfMode','smooth');await window.__imageHeavy.prepare();})()`);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部跳过')?.click()`);
    await ev("window.__cutexPerfApp.store.useApp.getState().openAgent('kai','local')");
    await sleep(1000);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部跳过')?.click()`);
    for (let open = 1; open <= remounts + 1; open++) {
      if (open > 1) { await ev("window.__cutexPerfApp.store.useApp.getState().openAgent('kai','local')"); await sleep(800); }
      await ev("window.__imageHeavy.resetCalls();Object.assign(window.__remount,{long:[],loads:0,placeholderFrames:0,maxPlaceholders:0,frames:0,active:true,t0:performance.now()})");
      await ev("window.__cutexPerfApp.store.useApp.getState().openAgent('demo-done','local')");
      await wait("!!document.querySelector('[data-turn-id^=heavy-turn]')");
      const painted = await ev(`new Promise(resolve=>{let good=0;const tick=()=>{const imgs=[...document.querySelectorAll('[data-timeline-root] img')].filter(e=>!e.closest('[data-tl-far]')).filter(e=>{return window.__vis(e)});const boxes=[...document.querySelectorAll('[data-timeline-root] span[role=status].bg-surface-2')].filter(e=>{return window.__vis(e)});good=imgs.length&&!boxes.length&&imgs.every(e=>e.complete&&e.naturalWidth&&!e.hasAttribute('data-image-pending'))?good+1:0;if(good>=4)resolve(performance.now()-window.__remount.t0);else if(performance.now()-window.__remount.t0>15000)resolve(-1);else requestAnimationFrame(tick)};requestAnimationFrame(tick)})`);
      await sleep(1500); // late reads (IntersectionObserver margin, background revalidation)
      const r = await ev(`(()=>{const p=window.__remount;p.active=false;const calls=window.__imageHeavy.metrics.calls.filter(c=>c.kind!=='bootstrap'&&c.kind!=='history');const by={};for(const c of calls){by[c.kind]??={n:0,bytes:0};by[c.kind].n++;by[c.kind].bytes+=c.bytes}return {reads:by,readBytes:calls.reduce((n,c)=>n+c.bytes,0),imageLoads:p.loads,placeholderFrames:p.placeholderFrames,maxPlaceholders:p.maxPlaceholders,frames:p.frames,longTasks:p.long.length,longMs:p.long.reduce((a,b)=>a+b,0),failed:document.querySelectorAll('[data-timeline-root] [data-image-failed]').length,visibleImgs:[...document.querySelectorAll('[data-timeline-root] img')].filter(e=>!e.closest('[data-tl-far]')).filter(e=>{return window.__vis(e)}).length}})()`);
      const rec = { repeat: repeat + 1, open, kind: open === 1 ? "cold" : "remount", paintedMs: Math.round(painted), ...r, longMs: Math.round(r.longMs) };
      all.push(rec); console.log(JSON.stringify(rec));
    }
    await Promise.race([send("Browser.close"), sleep(500)]);
  } finally { ws?.close(); chrome.kill(); }
}
writeFileSync(join(out, "results.json"), JSON.stringify({ count, mode, latency, runs: all }, null, 2));
console.log("Results:", join(out, "results.json"));
