// Run against the isolated mock preview; never a daemon or the owner's browser.
// node apps/desktop/scripts/measure-image-heavy.mjs --out ./benchmark/image-heavy/before
// --cases 0:mixed,300:mixed,300:refs --repeat 3 [--profile] [--memory] [--resume]
// --transport direct|clone|json (copy simulations, not an Electron IPC measurement)
// --window-turns 60 loads all fixture turns; use 30 to test the product default.
// Fixture preparation and conversation-module warmup precede timing. GC runs only after timed scrolling with --memory.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const opt = (key, fallback) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const out = resolve(opt("out", "./benchmark/image-heavy/run"));
const base = new URL(opt("url", "http://127.0.0.1:5383/"));
if (!["127.0.0.1", "localhost"].includes(base.hostname) || !/^53\d\d$/.test(base.port)) throw Error("Use only a 53xx loopback mock preview");
const cases = opt("cases", "0:mixed,300:mixed,300:refs").split(",").map(value => { const [count, mode] = value.split(":"); return { count: Number(count), mode }; });
const repeats = Number(opt("repeat", "3")), windowTurns = Number(opt("window-turns", "60"));
const profiling = args.includes("--profile"), transport = opt("transport", "direct");
mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const all = args.includes("--resume") && existsSync(join(out,"results.json")) ? JSON.parse(readFileSync(join(out,"results.json"),"utf8")) : [];

const init = `(() => {
 const p=window.__heavyProbe={long:[],frames:[],loads:[],commits:0,renders:{},hookMs:0,active:false};
 new PerformanceObserver(list=>{for(const x of list.getEntries())p.long.push({start:x.startTime,duration:x.duration})}).observe({type:'longtask',buffered:true});
 document.addEventListener('load',e=>{if(p.active&&e.target instanceof HTMLImageElement&&e.target.closest('[data-timeline-root]'))p.loads.push({at:performance.now(),far:!!e.target.closest('[data-tl-far]'),width:e.target.naturalWidth,height:e.target.naturalHeight})},true);
 const tick=t=>{if(p.active)p.frames.push(t);requestAnimationFrame(tick)};requestAnimationFrame(tick);
 window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(r){const id=this.renderers.size+1;this.renderers.set(id,r);return id},onScheduleFiberRoot(){},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},checkDCE(){},onCommitFiberRoot(id,root){if(!p.active)return;const start=performance.now();p.commits++;const count=f=>{if([0,1,11,14,15].includes(f.tag)){const t=f.type;const name=t?.displayName||t?.name||t?.render?.name||t?.type?.name||'anonymous';p.renders[name]=(p.renders[name]||0)+1}};const mount=f=>{count(f);for(let c=f.child;c;c=c.sibling)mount(c)};const update=(next,prev)=>{if(next.flags&1)count(next);if(next.child===prev.child)return;for(let c=next.child;c;c=c.sibling)c.alternate?update(c,c.alternate):mount(c)};const cur=root.current;cur.alternate?update(cur,cur.alternate):mount(cur);p.hookMs+=performance.now()-start}};
})()`;

for (let repeat = 0; repeat < repeats; repeat++) for (const scenario of cases) {
  const tag = `${scenario.count}-${scenario.mode}-${transport}-${repeat + 1}`;
  if(args.includes("--resume") && existsSync(join(out,`${tag}.json`))) continue;
  const profile = join(out, `chrome-${tag}`), port = 9700 + Math.floor(Math.random() * 150);
  const chrome = spawn(opt("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,960", "--force-device-scale-factor=1", "--enable-precise-memory-info", "--no-first-run", "about:blank"], { stdio: "ignore" });
  writeFileSync(join(out, `${tag}-chrome.pid`), String(chrome.pid));
  let ws, next = 0, sink = [], traceFinish;
  const pending = new Map(), errors = [];
  try {
    for (let i = 0; i < 100; i++) {
      try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl); break; } catch { await sleep(100); }
    }
    if (!ws) throw Error("Chrome startup failed");
    await new Promise(resolve => ws.onopen = resolve);
    ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else if (m.method === "Tracing.dataCollected") sink.push(...m.params.value); else if (m.method === "Tracing.tracingComplete") traceFinish?.(); else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails); };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, m => m.error ? reject(Error(`${method}: ${m.error.message}`)) : resolve(m.result)); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; };
    const wait = async (expression, timeout = 120000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await ev(expression)) return; await sleep(30); } throw Error(`Timeout: ${expression}`); };
    await send("Page.enable"); await send("Runtime.enable"); await send("Performance.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: init });
    const url = new URL(base); url.search = new URLSearchParams({ perf: "quiet", imageheavy: String(scenario.count), heavyMode: scenario.mode, heavyTransport: transport, heavyTurns: "60", publishAt: "99999" }).toString();
    await send("Page.navigate", { url: url.href });
    await wait("!!window.__cutexPerfApp && !!window.__imageHeavy");
    await ev(`(async()=>{const m=await import('/src/lib/prefs.ts');m.setUiPref('timelineTurns',${windowTurns});m.setUiPref('messageImages','thumbnail');m.setUiPref('perfMode','smooth');localStorage.setItem('cutex-desktop.theme','light');await window.__imageHeavy.prepare();})()`);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部跳过')?.click()`);
    // Warm the conversation modules before timing: the React Suspense 300ms reveal throttle is not an image cost.
    await ev("window.__cutexPerfApp.store.useApp.getState().openAgent('kai','local')");
    await sleep(1000);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='全部跳过')?.click()`);
    const heapBefore = await send("Runtime.getHeapUsage");
    const perfBefore = await send("Performance.getMetrics");
    if (profiling) {
      await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 1000 }); await send("Profiler.start");
      await send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink,blink.user_timing,v8,disabled-by-default-memory-infra", transferMode: "ReportEvents" });
    }
    await ev("window.__imageHeavy.resetCalls();Object.assign(window.__heavyProbe,{long:[],frames:[],loads:[],commits:0,renders:{},hookMs:0,active:true,t0:performance.now()});performance.mark('image-heavy-open')");
    const resolved = await ev(`(async()=>{const p=window.__heavyProbe;await window.__cutexPerfApp.store.useApp.getState().openAgent('demo-done','local');return performance.now()-p.t0})()`);
    await wait("!!document.querySelector('[data-turn-id^=heavy-turn]') && [...document.querySelectorAll('[data-composer-input]')].some(e=>e.checkVisibility()&&!e.disabled)");
    // Paint + all currently visible images (not a lazy placeholder, components/ImageThumbs) + eight consecutive responsive animation frames.
    const painted = await ev(`new Promise(resolve=>{let previous=performance.now(),good=0;const tick=t=>{const imgs=[...document.querySelectorAll('[data-timeline-root] img')].filter(e=>!e.closest('[data-tl-far]')).filter(e=>{const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0});good=t-previous<80&&imgs.every(e=>e.complete&&e.naturalWidth&&!e.hasAttribute('data-image-pending'))?good+1:0;previous=t;if(good>=8)resolve(performance.now()-window.__heavyProbe.t0);else requestAnimationFrame(tick)};requestAnimationFrame(tick)})`);
    await ev(`(()=>{const p=window.__heavyProbe;const e=[...document.querySelectorAll('[data-composer-input]')].find(e=>e.checkVisibility());e.focus();p.inputStart=performance.now();e.addEventListener('input',()=>p.inputEcho=performance.now()-p.inputStart,{once:true})})()`);
    await send("Input.insertText", { text: "benchmark input" });
    const interactive = await ev("(performance.mark('image-heavy-ready'),{elapsed:performance.now()-window.__heavyProbe.t0,inputEcho:window.__heavyProbe.inputEcho})");
    await sleep(150);
    const snapshot = async () => ev(`(()=>{const p=window.__heavyProbe;const root=[...document.querySelectorAll('[data-timeline-root]')].find(e=>e.querySelector('[data-turn-id^=heavy-turn]'));const imgs=[...root.querySelectorAll('img')].filter(e=>e.closest('[data-testid=image-thumb]'));const loaded=imgs.filter(e=>e.complete&&e.naturalWidth&&!e.hasAttribute('data-image-pending'));return {heap:performance.memory?.usedJSHeapSize,imagesMounted:imgs.length,imagesPending:imgs.filter(e=>e.hasAttribute('data-image-pending')).length,imagesLoaded:loaded.length,imagesFar:imgs.filter(e=>e.closest('[data-tl-far]')).length,farLoaded:loaded.filter(e=>e.closest('[data-tl-far]')).length,rgbaUpperBound:loaded.reduce((n,e)=>n+e.naturalWidth*e.naturalHeight*4,0),rows:root.querySelectorAll('[data-tl-row]').length,farRows:root.querySelectorAll('[data-tl-far]').length,nodes:root.querySelectorAll('*').length,long:p.long,commits:p.commits,hookMs:p.hookMs,renders:p.renders,loads:p.loads,fixture:window.__imageHeavy.metrics}})()`);
    const opened = await snapshot(), heapOpen = await send("Runtime.getHeapUsage"), perfOpen = await send("Performance.getMetrics");
    if (profiling) writeFileSync(join(out, `${tag}.cpuprofile`), JSON.stringify((await send("Profiler.stop")).profile));
    const screenshot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(out, `${tag}-open.png`), Buffer.from(screenshot.data, "base64"));
    let memoryDump = null;
    if (profiling) {
      memoryDump = await send("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" }).catch(error => ({ error: String(error) }));
      const done = new Promise(resolve => traceFinish = resolve); await send("Tracing.end"); await done;
      writeFileSync(join(out, `${tag}-trace.json`), JSON.stringify({ traceEvents: sink })); sink = [];
    }
    await ev("window.__heavyProbe.scrollStart=performance.now();window.__heavyProbe.frames=[]");
    const scroll = await ev(`new Promise(resolve=>{const root=[...document.querySelectorAll('[data-timeline-root]')].find(e=>e.querySelector('[data-turn-id^=heavy-turn]'));const scroller=root.parentElement;const start=performance.now();const tick=t=>{const phase=(t-start)/4000;scroller.scrollTop=phase<1?(1-phase)*(scroller.scrollHeight-scroller.clientHeight):(phase-1)*(scroller.scrollHeight-scroller.clientHeight);if(phase<2)requestAnimationFrame(tick);else{scroller.scrollTop=scroller.scrollHeight;window.__heavyProbe.scrollEnd=performance.now();resolve({duration:performance.now()-start,height:scroller.scrollHeight,viewport:scroller.clientHeight})}};requestAnimationFrame(tick)})`);
    await sleep(500);
    const afterScroll = await snapshot(), heapScroll = await send("Runtime.getHeapUsage");
    const gaps = await ev("(()=>{const p=window.__heavyProbe;const f=p.frames.filter(t=>t>=p.scrollStart&&t<=p.scrollEnd);return f.slice(1).map((t,i)=>t-f[i])})()");
    let imageMemory = null, heapRetained = null;
    if (args.includes("--memory")) {
      await send("HeapProfiler.collectGarbage"); heapRetained = await send("Runtime.getHeapUsage");
      await send("Tracing.start", { categories: "disabled-by-default-memory-infra", transferMode: "ReportEvents" });
      const dump = await send("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" });
      const done = new Promise(resolve => traceFinish = resolve); await send("Tracing.end"); await done;
      writeFileSync(join(out, `${tag}-memory-trace.json`), JSON.stringify({ traceEvents: sink }));
      const candidates = sink.filter(event=>event.args?.dumps?.allocators?.["web_cache/Image_resources"]).map(event=>{
        const alloc=event.args.dumps.allocators;const bytes=key=>parseInt(alloc[key]?.attrs?.size?.value||"0",16);
        return {pid:event.pid,imageResourcesBytes:bytes("web_cache/Image_resources"),webCacheBytes:bytes("web_cache"),parkableBytes:parseInt(alloc.parkable_images?.attrs?.total_size?.value||"0",16)};
      }).sort((a,b)=>b.imageResourcesBytes-a.imageResourcesBytes);
      imageMemory={dump,renderer:candidates[0]??null};sink=[];
    }
    gaps.sort((a,b)=>a-b);
    const longOpen = opened.long.filter(x => x.start >= 0), record = { tag, scenario, repeat: repeat + 1, profiling, windowTurns, resolvedMs: resolved, paintedMs: painted, interactiveMs: interactive.elapsed, inputEchoMs: interactive.inputEcho, maxLongOpenMs: Math.max(0, ...longOpen.map(x => x.duration)), heapBefore, heapOpen, heapScroll, perfBefore, perfOpen, opened, afterScroll, scroll: { ...scroll, frames: gaps.length + 1, fps: gaps.length * 1000 / gaps.reduce((a,b)=>a+b,0), p95GapMs: gaps[Math.floor(gaps.length*.95)], maxGapMs: gaps.at(-1), gapsOver50: gaps.filter(x=>x>50).length }, memoryDump, imageMemory, heapRetained, errors };
    all.push(record); writeFileSync(join(out, `${tag}.json`), JSON.stringify(record, null, 2)); writeFileSync(join(out, "results.json"), JSON.stringify(all, null, 2));
    console.log(JSON.stringify({ tag, interactiveMs: record.interactiveMs, maxLongOpenMs: record.maxLongOpenMs, heapMB: heapOpen.usedSize / 1048576, mounted: opened.imagesMounted, loaded: opened.imagesLoaded, farLoaded: opened.farLoaded, scrollFPS: record.scroll.fps, scrollMaxGapMs: record.scroll.maxGapMs, fixtureMB: opened.fixture.encodedBytes / 1048576, errors: errors.length }));
    await Promise.race([send("Browser.close"), sleep(500)]);
  } catch (error) { writeFileSync(join(out, `${tag}-error.json`), JSON.stringify({ error: String(error), errors }, null, 2)); throw error; }
  finally { ws?.close(); chrome.kill(); }
}
console.log("Results:", join(out, "results.json"));
