// Edge-drag fuzz (delegation d17283, docs/design/031-edge-push.md): random layouts in the mock preview, random real
// pointer drags on the vertical width separators. Every drag must change the width of at most the two panels beside
// its edge (collapsed rails between them only slide), the sidebar's left edge never moves, and the release must keep
// every edge where the last step had it. Panels sliding along (推挤) are listed as MOVE, not failures.
//   Needs the renderer mock preview (vite --config vite.preview.config.ts) and a Chrome with --remote-debugging-port;
//   restart vite after editing lib/ files (page-side imports must hit the app's own module instances).
//   node scripts/edge-drag-fuzz.mjs [layouts=20] [drags=6] [seed=1] [fixed | <layout json>]
//   env: PREVIEW_URL (http://127.0.0.1:5341/), CDP_PORT (9341); SEP=a,b / DX=n,m pick each drag's separator / distance;
//        PROBE=<file with a page expression> logs it before / on press / at release (PROBESTEPS=1: every step);
//        SHOT=<png> saves the 4th step. Writes fuzz-report.json (the failing drags).
// After each layout's random drags: where the next card sits right against the sidebar (only the 8 px gap between),
// a press in the middle of that gap dragged right, then left, must resize the sidebar (owner 2026-10-28: it resized
// the conversation column and opened desktop between them). GAP=0 skips it.
import fs, { writeFileSync } from "node:fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PREVIEW = process.env.PREVIEW_URL ?? "http://127.0.0.1:5341/";
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
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error("page: " + (r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails)).slice(0, 400));
  return r.result?.result?.value;
};
const mouse = (type, x, y, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });

const [nLayouts = "20", nDrags = "6", seedArg = "1", only] = process.argv.slice(2);
let seed = Number(seedArg);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

// Page helpers: the panels (every card of the window's row) and the width separators.
const HELPERS = `(()=>{
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 120 && !e.closest('[hidden]'); };
  const PANELS = 'aside[data-sidebar-mode], [data-conv-card], section[data-conv-pane], [data-shelf-card], [data-settings-shelf]';
  window.__fz = {
    panels() {
      const els = [...document.querySelectorAll(PANELS)].filter(vis);
      // Outermost only (a conversation card inside its column, a Shelf box inside another).
      const top = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
      return top.map((e) => { const r = e.getBoundingClientRect(); const tag = e.matches('aside') ? 'side' : e.matches('[data-conv-card], section[data-conv-pane]') ? 'conv' : e.matches('[data-settings-shelf]') ? 'settings' : e.hasAttribute('data-shelf-collapsed') ? 'rail' : 'shelf'; return { tag, l: +r.left.toFixed(1), r: +r.right.toFixed(1) }; });
    },
    seps() {
      return [...document.querySelectorAll('[role=separator]')].filter((e) => {
        const r = e.getBoundingClientRect();
        if (!(r.height > 200 && r.width > 0 && r.width < 20)) return false;
        if (e.closest('[data-tray-frame] .pane-tray-dock, [role=dialog], [role=menu]')) return false;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return hit === e || e.contains(hit);
      }).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, kind: [...e.attributes].map((a) => a.name).filter((n) => n.startsWith('data-') && n !== 'data-dragging').join('+') || (e.getAttribute('aria-label') ?? e.className.slice(0, 24)) }; });
    },
  };
  return 1;
})()`;

// The onboarding (全部跳过) and the tour (跳过引导): a dialog over the page hides every separator from the hit test.
const SKIP = `([...document.querySelectorAll('button')].filter(b=>['全部跳过','跳过引导'].includes(b.textContent.trim())).forEach(b=>b.click()),1)`;

async function setup(L) {
  await send("Emulation.setDeviceMetricsOverride", { width: L.w, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.enable");
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Storage.clearDataForOrigin", { origin: new URL(PREVIEW).origin, storageTypes: "local_storage,session_storage,indexeddb" });
  await send("Page.navigate", { url: PREVIEW });
  await sleep(6500);
  await ev(SKIP);
  await sleep(400);
  await ev(`(async()=>{const a=await import('/src/lib/appearance.ts');a.setAppearance({workspaceWidth:${JSON.stringify(L.mode)}, wsRailPlacement:${JSON.stringify(L.place)}});return 1})()`);
  await ev(`(document.querySelector('[data-tray-item][aria-label^="Mika"]').click(),1)`);
  await sleep(1200);
  if (L.shelf !== "none") {
    for (const kind of L.shelf === "both" ? ["闹钟", "文件"] : ["闹钟"]) {
      const viaMenu = await ev(`(()=>{const b=[...document.querySelectorAll('[data-conv-header] button')].find(b=>(b.getAttribute('aria-label')||'').includes('打开Shelf'));b?.click();return !!b})()`);
      await sleep(500);
      if (viaMenu) await ev(`([...document.querySelectorAll('[role=menu] [role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(kind)}).click(),1)`);
      // A Shelf is open already (the header button is its toggle now): open the page through the layout, as the tests do.
      else await ev(`(async()=>{const s=await import('/src/lib/sideLayoutStore.ts');const sl=await import('/src/lib/sideLayout.ts');const input={kind:'workspace.changes',binding:{kind:'follow',hostId:'local'},key:sl.SINGLETON_KEY,state:null,v:1,pinned:false};s.updateLayout((l)=>{const d=sl.place(l,{...input,transient:false,activePage:l.activePage,columnOpen:l.open},sl.placeSpec({home:'workspace'}));return sl.applyOpen(l,d,input,Date.now(),{reveal:true,home:'workspace'}).layout});return 1})()`);
      await sleep(900);
    }
    if (L.shelf === "both" || L.shelf === "left") {
      // The last pane to a new Shelf on the left.
      await ev(`(async()=>{const s=await import('/src/lib/sideLayoutStore.ts');const sl=await import('/src/lib/sideLayout.ts');s.updateLayout((x)=>({...x,singleShelf:false}));const l=s.useSide.getState().layout;const page=l.pages[l.pages.length-1];const card=page.cards[page.cards.length-1];s.updateLayout((x)=>sl.moveToNewShelf(x,{card:card.id},'left',Date.now()));return 1})()`);
      await sleep(800);
    }
    if (L.collapse) {
      await ev(`(async()=>{const s=await import('/src/lib/sideLayoutStore.ts');const sl=await import('/src/lib/sideLayout.ts');const sh=sl.shelvesOf(s.useSide.getState().layout);const t=sh.find(x=>x.side===${JSON.stringify(L.collapse)});if(t)s.updateLayout((x)=>sl.collapseShelf(x,t.id));return 1})()`);
      await sleep(800);
    }
  }
  if (L.two) {
    // A second workspace beside (Ctrl+click in the tray).
    await ev(`(document.querySelector('[data-tray-item][aria-label^="Rei"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})),1)`);
    await sleep(1500);
  }
  if (L.maxed === "shelf") {
    // The Shelf pane's 最大化 (the owner's 2026-10-23 repro: the Shelf grown to the window's edge).
    await ev(`(()=>{const box=document.querySelector('[data-side-box]');const b=box&&[...box.querySelectorAll('button')].find(b=>/最大化/.test(b.getAttribute('aria-label')||b.title||''));b?.click();return 1})()`);
    await sleep(1200);
  } else if (L.maxed) {
    await ev(`(()=>{const b=[...document.querySelectorAll('[data-conv-header] button')].find(b=>(b.getAttribute('aria-label')||'').startsWith('最大化'));b?.click();return 1})()`);
    await sleep(1200);
  }
  await ev(SKIP);
  await sleep(300);
  await ev(HELPERS);
}

const edgesOf = (panels) => panels.flatMap((p, i) => [{ k: `${i}:${p.tag}.L`, x: p.l }, { k: `${i}:${p.tag}.R`, x: p.r }]);

async function drag(L, sep, dx) {
  const p0 = await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse);
  const e0 = edgesOf(p0);
  // Beside the separator: the edges within 14 px of it (the two panels it sits between, or the one it sizes).
  void e0;
  const bad = [];
  const moves = [];
  const W = (p) => p.r - p.l;
  const check = (phase, panels) => {
    if (panels.length !== p0.length) return bad.push(`${phase}: panel count ${p0.length} -> ${panels.length}`);
    const changed = panels.map((p, i) => i).filter((i) => Math.abs(W(panels[i]) - W(p0[i])) > 0.5);
    // Beside each other: nothing but collapsed rails (fixed, riding with their column) between them.
    const touch = (a, b) => {
      const [x, y] = panels[a].l <= panels[b].l ? [panels[a], panels[b]] : [panels[b], panels[a]];
      const mid = panels.filter((p) => p.l >= x.r - 1 && p.r <= y.l + 1).sort((p, q) => p.l - q.l);
      if (mid.some((p) => p.tag !== "rail")) return false;
      let at = x.r;
      for (const p of [...mid, y]) { if (Math.abs(p.l - at) > 10) return false; at = p.r; }
      return true;
    };
    if (changed.length > 2 || (changed.length === 2 && !touch(changed[0], changed[1])))
      bad.push(`${phase}: widths ${changed.map((i) => `${i}:${p0[i].tag} ${Math.round(W(p0[i]))}->${Math.round(W(panels[i]))}`).join(", ")}`);
    panels.forEach((p, i) => {
      if (changed.includes(i)) return;
      if (Math.abs(p.l - p0[i].l) > 0.5) moves.push(`${phase}: ${i}:${p.tag} moved ${Math.round(p0[i].l)}->${Math.round(p.l)}`);
    });
    const sideL = panels.findIndex((p) => p.tag === "side");
    if (sideL >= 0 && Math.abs(panels[sideL].l - p0[sideL].l) > 0.5) bad.push(`${phase}: the sidebar's left edge moved`);
  };
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sep.x, y: sep.y, buttons: 0 });
  await sleep(60);
  if (process.env.PROBE) console.log("    probe before", await ev(fs.readFileSync(process.env.PROBE, "utf8")));
  await mouse("mousePressed", sep.x, sep.y);
  await sleep(60);
  if (process.env.PROBE) console.log("    probe pressed", await ev(fs.readFileSync(process.env.PROBE, "utf8")));
  check("press", await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse));
  const steps = 8;
  let lastStep = null;
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sep.x + (dx * i) / steps, sep.y);
    await sleep(40);
    lastStep = await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse);
    check(`step${i}`, lastStep);
    if (process.env.PROBE && process.env.PROBESTEPS) console.log("    probe step" + i, await ev(fs.readFileSync(process.env.PROBE, "utf8")));
    if (process.env.SHOT && i === 4) { const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: L.w, height: 950, scale: 0.5 } }); writeFileSync(process.env.SHOT, Buffer.from(r.result.data, "base64")); }
  }
  await mouse("mouseReleased", sep.x + dx, sep.y, 0);
  await sleep(80);
  check("release", await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse));
  if (process.env.PROBE) console.log("    probe release", await ev(fs.readFileSync(process.env.PROBE, "utf8")));
  await sleep(700);
  const end = await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse);
  check("settled", end);
  // The release keeps what the drag showed: every edge where the last step had it.
  if (lastStep && lastStep.length === end.length) end.forEach((p, i) => { for (const k of ["l", "r"]) if (Math.abs(p[k] - lastStep[i][k]) > 0.5) bad.push(`release jump: ${i}:${p.tag}.${k} ${Math.round(lastStep[i][k])}->${Math.round(p[k])}`); });
  // Close any menu a click opened (a separator's click can open one) — only when one is open (Esc is also 还原).
  if (await ev(`!!document.querySelector("[role=menu]")`)) await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  if (await ev(`!!document.querySelector("[role=menu]")`)) await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  return { bad: [...new Set(bad)], moves: [...new Set(moves)], p0, end };
}

// A press in the middle of the gap between the sidebar and the card right of it (none when desktop shows between).
async function gapDrag(L, dx) {
  const p0 = await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse);
  const si = p0.findIndex((p) => p.tag === "side");
  if (si < 0 || (await ev(`document.querySelector('aside[data-sidebar-mode]')?.dataset.sidebarMode`)) === "rail") return null;
  const side = p0[si];
  const next = p0.filter((p) => p.l >= side.r - 1).sort((a, b) => a.l - b.l)[0];
  if (!next || next.l - side.r > 10) return null;
  const x = (side.r + next.l) / 2;
  const y = await ev(`(()=>{const r=document.querySelector('aside[data-sidebar-mode]').getBoundingClientRect();return r.top+r.height/2})()`);
  const hit = await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return {own:!!e?.closest('aside[data-sidebar-mode]'),what:e?[...e.attributes].map(a=>a.name+'='+a.value).join(' ').slice(0,120):'none'}})()`);
  const r = await drag(L, { x, y, kind: "gap" }, dx);
  const w0 = side.r - side.l;
  const w1 = r.end[si] ? r.end[si].r - r.end[si].l : w0;
  // The gap is the sidebar's edge: it moves with the pointer, or stays when its range / the panel beside it can give
  // no more (宽度规则 3) — then nothing else changes either.
  const others = r.end.length === p0.length && r.end.some((p, i) => i !== si && Math.abs(p.r - p.l - (p0[i].r - p0[i].l)) > 0.5);
  if (!hit.own) r.bad.push(`gap press: not the sidebar's edge under the pointer (${hit.what})`);
  else if (Math.abs(w1 - w0) > 0.5 ? Math.sign(w1 - w0) !== Math.sign(dx) : others) r.bad.push(`gap press: the sidebar ${Math.round(w0)}->${Math.round(w1)} for dx=${dx}${others ? ", another panel resized" : ""}`);
  return { ...r, x, next };
}

// Fixed cases: the owner's repro (3820 px, sidebar | conversation | Shelf at the window's edge, 最大化, the seam dragged).
const FIXED = [
  { w: 3820, mode: "smart", place: "right", two: false, shelf: "right", collapse: null, maxed: "shelf" },
  { w: 3820, mode: "smart", place: "right", two: false, shelf: "right", collapse: null, maxed: true },
  { w: 3820, mode: "smart", place: "right", two: false, shelf: "right", collapse: null, maxed: false },
  { w: 1600, mode: "smart", place: "right", two: true, shelf: "right", collapse: null, maxed: false },
  { w: 1600, mode: "fill", place: "right", two: false, shelf: "left", collapse: null, maxed: false },
  { w: 1600, mode: "smart", place: "right", two: false, shelf: "both", collapse: null, maxed: false },
  // The 2026-10-28 gap repro: by content, 最大化 (the column against the sidebar), with and without Shelves / a second workspace.
  { w: 1440, mode: "content", place: "right", two: false, shelf: "none", collapse: null, maxed: true },
  { w: 1440, mode: "content", place: "right", two: false, shelf: "right", collapse: null, maxed: true },
  { w: 1600, mode: "fill", place: "right", two: true, shelf: "none", collapse: null, maxed: false },
  { w: 1600, mode: "fill", place: "outer", two: false, shelf: "left", collapse: "left", maxed: false },
];
const layouts = only === "fixed"
  ? FIXED
  : only
  ? [JSON.parse(only)]
  : Array.from({ length: Number(nLayouts) }, () => ({
      w: pick([1280, 1600, 1600, 2200, 3800]),
      mode: pick(["smart", "smart", "content", "fill"]),
      place: pick(["outer", "right"]),
      two: rnd() < 0.45,
      shelf: pick(["none", "right", "right", "both", "left"]),
      collapse: pick([null, null, null, "right", "left"]),
      maxed: rnd() < 0.2,
    }));
const report = [];
for (const L of layouts) {
  try {
    await setup(L);
  } catch (e) {
    console.log("SETUP FAIL", JSON.stringify(L), String(e).slice(0, 200));
    continue;
  }
  const panels = await ev(`JSON.stringify(__fz.panels())`).then(JSON.parse);
  console.log("\nLAYOUT", JSON.stringify(L), panels.map((p) => `${p.tag}[${Math.round(p.l)}-${Math.round(p.r)}]`).join(" "));
  for (let d = 0; d < Number(nDrags); d++) {
    const seps = await ev(`JSON.stringify(__fz.seps())`).then(JSON.parse);
    if (!seps.length) break;
    const want = process.env.SEP?.split(",")[d];
    const sep = want ? (seps.find((x) => x.kind.includes(want)) ?? pick(seps)) : pick(seps);
    const fixed = process.env.DX?.split(",")[d];
    const dx = fixed ? Number(fixed) : Math.round((rnd() * 2 - 1) * 400);
    const r = await drag(L, sep, dx);
    const line = `  drag ${sep.kind}@${Math.round(sep.x)} dx=${dx}: ${r.bad.length ? "FAIL " + r.bad.slice(0, 4).join("; ") : "ok"}${r.moves.length ? "  MOVE " + r.moves.slice(-2).join("; ") : ""}`;
    console.log(line);
    if (r.bad.length) report.push({ L, sep, dx, bad: r.bad, before: r.p0, after: r.end });
    await ev(HELPERS);
  }
  if (process.env.GAP !== "0") {
    for (const dx of [80, -60]) {
      const r = await gapDrag(L, dx);
      if (!r) {
        console.log("  gap: no gap press (desktop between the sidebar and the next card, or the sidebar is its rail)");
        break;
      }
      console.log(`  gap press @${Math.round(r.x)} (sidebar|${r.next.tag}) dx=${dx}: ${r.bad.length ? "FAIL " + r.bad.slice(0, 4).join("; ") : "ok"}${r.moves.length ? "  MOVE " + r.moves.slice(-2).join("; ") : ""}`);
      if (r.bad.length) report.push({ L, sep: { kind: "gap", x: r.x }, dx, bad: r.bad, before: r.p0, after: r.end });
      await ev(HELPERS);
    }
  }
}
writeFileSync("fuzz-report.json", JSON.stringify(report, null, 1));
console.log(`\n${report.length} failing drags`);
await send("Emulation.clearDeviceMetricsOverride");
ws.close();
process.exit(0);
