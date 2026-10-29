// Real-renderer regression: the conversation's history only moves up — 「接下来」 getting shorter included.
// Replays a recorded turn rhythm (scripts/conv-jump-schedule.json: event kinds, sizes and timing of two real
// sessions, no text; a synthesized closing turn where the owner queues, deletes, re-queues, folds and clears
// 「接下来」) into the mock preview and records, after every painted frame, where the last two history rows
// are, the scroller and the heights around it. Every frame where one of those rows moved down is attributed:
//   nextUp     「接下来」 got shorter (a queued message deleted or taken) — must be 0
//   toggle     「接下来」 folded by the owner's click (fold): a manual collapse opts out of the only-up rule (lib/stickToBottom
//              keepRowsUp userToggle, history-slack-user-toggle e00a81f9) and re-anchors at the normal bottom — counted
//              apart, but no room may be kept under the rows after it
//   needsYou   the 需要你 strip above the composer went away / got shorter — must be 0
//   composer   the input box got shorter (a long draft sent) — must be 0
//   other      anything else (the live line leaving at a turn's end, a row shrinking, a remount, …) — must be 0
// Moves under 1 px are reported apart (subpx): the scroller snaps to whole pixels, row heights are fractional.
// The window is resized twice (shrunk to 55 % of its height, grown back 3 s later: mid-turn and after the schedule):
// a resize by the owner is not jitter — the rows stay at the bottom, so frames where the pane itself changed height are
// counted apart (`resize`, not a failure), and after every growth the room under the rows must have shrunk by the
// growth (never below 0; ≤ 4 px more) — growing used to leave the growth as blank under the rows (440 px at 1440x960).
// ⤢ 最大化 (lib/panelGrow) twice (mid-turn and after the schedule: maximise, 还原, maximise, Esc): the pane only gets wider
// or narrower and its rows re-wrap — frames where the pane's width changed are counted apart (`widen`, not a failure),
// and the room under the rows must not grow from it (≤ 4 px in the next 600 ms). The row's slide used to collapse a
// filling column to its border (the timeline re-wrapped at 0 px): up to 1206 px of blank room under the rows after it.
// Start preview:web (mock preview), then
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/conv-jump-replay.mjs
// Optional: CONV_JUMP_PREVIEW_URL (default http://127.0.0.1:5199/), CONV_JUMP_SIZES ("1440x960,900x520"),
// CONV_JUMP_OUTPUT (frames + report; default .test-temp/conv-jump), CONV_JUMP_CHROME (browser executable),
// CONV_JUMP_LIMIT_MS (replay only the first N ms of the schedule), CONV_JUMP_FROM_MS (skip the ops before N ms,
// e.g. the 「接下来」 segment alone: the last mark), CONV_JUMP_THEME (light | dark), CONV_JUMP_RESIZE (off: no resizes),
// CONV_JUMP_MAXIMIZE (off: no 最大化 segments).
// Exit code 1 when any downward move is found. No daemon calls.
import assert from "node:assert/strict";
import { isAbsolute, resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await (isAbsolute(playwrightModule) ? import(pathToFileURL(playwrightModule).href) : import(playwrightModule));
const here = dirname(fileURLToPath(import.meta.url));
const schedule = JSON.parse(await readFile(join(here, "conv-jump-schedule.json"), "utf8"));
const out = resolve(process.env.CONV_JUMP_OUTPUT || ".test-temp/conv-jump");
await mkdir(out, { recursive: true });
const url = new URL(process.env.CONV_JUMP_PREVIEW_URL || "http://127.0.0.1:5199/");
assert(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Use a local mock preview");
assert(!["24260", "24270", "25370"].includes(url.port), "Control ports are not previews");
// A quiet mock (no background demo), ui-widgets (idle, nothing pending) with 12 older turns so the history scrolls.
for (const [k, v] of [["perf", "quiet"], ["perfturns", "12"], ["perfagent", "widgets"], ["guidesSkipped", "0.2.0"], ["platform", "win32"]]) url.searchParams.set(k, v);
const sizes = (process.env.CONV_JUMP_SIZES || "1440x960,900x520").split(",").map((s) => s.split("x").map(Number));
const limit = Number(process.env.CONV_JUMP_LIMIT_MS) || Infinity;
const from = Number(process.env.CONV_JUMP_FROM_MS) || 0;
const theme = process.env.CONV_JUMP_THEME || "light";
const AGENT = "widgets";
// The resize segments: [ms, "viewport", height fraction] (1 = the size's own height).
const RESIZE_AT = process.env.CONV_JUMP_RESIZE === "off" ? [] : [150_000, (schedule.ops.at(-1)?.[0] ?? 0) + 1000];
const resizeOps = RESIZE_AT.flatMap((t) => [[t, "viewport", 0.55], [t + 3000, "viewport", 1]]);
// The 最大化 segments: ⤢ (maximise), ⤢ again (还原), ⤢, Esc — 2.5 s apart; a no-op where the row has no room.
const MAXIMIZE_AT = process.env.CONV_JUMP_MAXIMIZE === "off" ? [] : [160_000, (schedule.ops.at(-1)?.[0] ?? 0) + 6000];
const maximizeOps = MAXIMIZE_AT.flatMap((t) => [[t, "maximize"], [t + 2500, "maximize"], [t + 5000, "maximize"], [t + 7500, "esc"]]);
const ops = [...schedule.ops, ...resizeOps, ...maximizeOps].sort((a, b) => a[0] - b[0]);
let usage = 0;

// Filler text of a recorded size (characters): the schedule has no text.
const WORDS = "队列 flush 先读 revision 再比较 expectedRevision 不一致 就返回 conflict 测试 通过 timeline 的 行 高度 不变 composer 接下来 panel".split(" ");
const filler = (n, seed = 1) => {
  let s = "", i = seed;
  while (s.length < n) {
    s += WORDS[i++ % WORDS.length] + (i % 11 === 0 ? "。\n\n" : i % 5 === 0 ? "，" : " ");
  }
  return s.slice(0, Math.max(1, n));
};
const lines = (n, seed = 1) => {
  let s = "", i = seed;
  while (s.length < n) s += `src/renderer/src/components/Row${i++ % 37}.tsx:${(i * 13) % 400}: const row = useRow(id);\n`;
  return s.slice(0, Math.max(0, n));
};
const itemOf = (type, id, size, done) => {
  const status = done ? "completed" : "inProgress";
  switch (type) {
    case "reasoning": return { type, id, summary: done && size ? [filler(size, size)] : [], content: [] };
    case "commandExecution": return { type, id, command: `rg -n "useRow" src --glob '*.tsx' # ${id}`, status, aggregatedOutput: done ? lines(size, size) : "", ...(done ? { exitCode: 0, durationMs: 400 } : {}) };
    case "dynamicToolCall": return { type, id, namespace: "claude", tool: "Read", arguments: { file_path: `src/renderer/src/components/Row${size % 37}.tsx` }, status, contentItems: done ? [{ type: "inputText", text: lines(size, size) }] : [], ...(done ? { success: true, durationMs: 300 } : {}) };
    case "mcpToolCall": return { type, id, server: "cutex", tool: "agent_tell", arguments: { target: "ui-lead", text: filler(Math.min(size, 200) || 40) }, status, ...(done ? { result: { content: [{ type: "text", text: "{\"ok\":true}" }], structuredContent: null } } : {}) };
    case "fileChange": return { type, id, status, changes: [{ path: `src/renderer/src/components/Row${size % 37}.tsx`, kind: { type: "update", move_path: null }, diff: `@@ -10,3 +10,4 @@\n   const row = useRow(id);\n-  return <div>{row.label}</div>;\n+  return <div className="min-h-5">{row.label}</div>;\n+  // ${id}` }] };
    case "agentMessage": return { type, id, text: done ? filler(size, size) : "" };
    default: return { type, id, status };
  }
};

const browser = await chromium.launch({ headless: true, ...(process.env.CONV_JUMP_CHROME ? { executablePath: process.env.CONV_JUMP_CHROME } : {}) });
const reports = [];
let failed = false;
try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.__size = { width, height };
    await page.addInitScript((theme) => {
      localStorage.setItem("cutex-desktop.locale", "zh-CN");
      localStorage.setItem("cutex-desktop.theme", theme);
      localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false }));
      window.qaImport = async (path) => {
        const r = performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1);
        return import(r?.name || path);
      };
    }, theme);
    await page.goto(url.href);
    await page.waitForFunction(async () => {
      const { useApp } = await window.qaImport("/src/store.ts");
      return useApp.getState().featuresKnown && useApp.getState().sidebar?.active.length && !!window.__cutexMockPerf;
    });
    await page.evaluate(async (agent) => {
      const { useApp } = await window.qaImport("/src/store.ts");
      await useApp.getState().select(agent);
    }, AGENT);
    await page.waitForSelector("[data-composer-input]");
    await page.waitForTimeout(1500);
    // The mock's other agents always want the owner: the 需要你 strip comes and goes with the schedule's ops (its setting).
    await page.evaluate(async () => {
      const { setUiPref } = await window.qaImport("/src/lib/prefs.ts");
      setUiPref("needsYouStrip", false);
    });
    await page.waitForTimeout(500);
    await page.evaluate(installRecorder);
    usage = 0;
    const t0 = Date.now();
    for (const op of ops) {
      if (op[0] > limit) break;
      if (op[0] < from) continue;
      const wait = t0 + op[0] - from - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      await runOp(page, op);
    }
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => window.__cj.stop());
    const report = analyse(data, `${width}x${height}`);
    reports.push(report);
    if (report.grow.some((g) => !g.ok) || report.widen.some((g) => !g.ok) || report.toggle.roomAfter > 0) failed = true;
    await writeFile(join(out, `frames-${width}x${height}.json`), JSON.stringify(data));
    await page.screenshot({ path: join(out, `end-${width}x${height}.png`) });
    if (report.down.count > 0) failed = true;
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(join(out, "report.json"), JSON.stringify(reports, null, 1));
for (const r of reports) {
  console.log(`${r.size}: ${r.frames} frames, ${r.ops} ops — downward moves of the last two rows: ${r.down.count} (max ${r.down.max} px); room kept under the rows: max ${r.room.max} px, ${r.room.framesWithRoom} frames, ${r.room.end} px at the end`);
  console.log(`  history ${r.history.min} px min, ${r.history.median} px median; under max(120 px, 30 % of the pane) in ${r.history.underMin} frames`);
  console.log(`  接下来 changed height in ${r.tray.changes} frames; the last rows moved with it in ${r.tray.moved} (max ${r.tray.maxUp} px up, ${r.tray.maxDown} px down)`);
  console.log(`  subpx     ${String(r.subpx.count).padStart(4)}  max ${r.subpx.max} px  (under 1 px: whole-pixel scroll snapping, not counted)`);
  console.log(`  resize    ${String(r.resize.count).padStart(4)}  max ${r.resize.max} px  (the pane itself changed height: not counted)`);
  console.log(`  toggle    ${String(r.toggle.count).padStart(4)}  max ${r.toggle.max} px  room after ${r.toggle.roomAfter} px  (接下来 folded by the owner: back to the normal bottom, not counted; room must be 0)`);
  console.log(`  widen     ${String(r.widenMoves.count).padStart(4)}  max ${r.widenMoves.max} px  (the pane changed width, 最大化: rows re-wrap, not counted)`);
  for (const g of r.widen) console.log(`  pane width ${g.from} → ${g.to} px +${g.t} ms: room ${g.before} → ${g.after} px (max in the next 600 ms) ${g.ok ? "ok" : "BLANK"}`);
  for (const g of r.grow) console.log(`  pane grew +${g.t} ms by ${g.by} px: room ${g.before} → ${g.after} px (max in the next 600 ms; allowed ${g.allowed}) ${g.ok ? "ok" : "BLANK"}`);
  for (const k of ["nextUp", "needsYou", "composer", "other"]) console.log(`  ${k.padEnd(9)} ${String(r[k].count).padStart(4)}  max ${r[k].max} px  total ${r[k].total} px`);
  for (const m of [...r.nextUp.samples, ...r.needsYou.samples, ...r.composer.samples, ...r.other.samples]) console.log(`    ${m.cause}: +${m.t} ms ${m.row} ${m.dy > 0 ? "+" : ""}${m.dy} px  ops [${m.ops.join(", ")}]  ${m.why}`);
}
process.exit(failed ? 1 : 0);

async function runOp(page, op) {
  const [, kind, ...a] = op;
  if (kind === "viewport") {
    const { width, height } = page.__size;
    await page.evaluate((s) => window.__cj.op(s), `viewport ${a[0]}`);
    await page.setViewportSize({ width, height: Math.round(height * a[0]) });
    return;
  }
  if (kind === "maximize" || kind === "esc") {
    // ⤢ on the conversation pane (Ctrl+Shift+M's action), or Esc (还原) — only while maximised: where ⤢ had no room,
    // Esc would reach the composer and stop the running turn.
    const grown = await page.evaluate(async (k) => {
      window.__cj.op(k);
      if (k === "maximize") (await window.qaImport("/src/lib/paneActions.ts")).toggleMaximize();
      return (await window.qaImport("/src/lib/panelGrow.ts")).growOn();
    }, kind);
    if (kind === "esc" && grown) await page.keyboard.press("Escape");
    return;
  }
  if (kind === "send") {
    // The owner types and presses Enter in the composer (busy: it queues in 接下来).
    const text = filler(Math.min(a[0], 160), a[0]);
    await page.click("[data-composer-input]");
    await page.keyboard.insertText(text);
    await page.evaluate((s) => window.__cj.op(s), `send ${a[0]}${a[1] ? " " + a[1] : ""}`);
    await page.keyboard.press("Enter");
    return;
  }
  if (kind === "needs") {
    await page.evaluate(async (on) => {
      const { setUiPref } = await window.qaImport("/src/lib/prefs.ts");
      setUiPref("needsYouStrip", on);
      window.__cj.op(on ? "needs on" : "needs off");
    }, a[0]);
    return;
  }
  if (kind === "unqueue" || kind === "fold") {
    // The owner deletes the last queued message (or all of them, one by one) / folds or unfolds 「接下来」.
    // (The row actions show on hover: clicked from the page.)
    await page.evaluate((s) => window.__cj.op(s), `${kind} ${a[0] ?? ""}`.trim());
    const sel = kind === "fold" ? "[data-testid=queue-collapse]" : "[data-testid=queue-delete]";
    do {
      const clicked = await page.evaluate((sel) => {
        const button = [...document.querySelectorAll(sel)].at(-1);
        button?.click();
        return !!button;
      }, sel);
      if (!clicked) break;
      if (a[0] === "all") await page.waitForTimeout(400);
    } while (a[0] === "all");
    return;
  }
  if (kind === "mark") return;
  const msgs = [];
  if (kind === "usage") {
    // The context ring and usage under the input: a token report per model call, growing.
    usage += 1800 + (usage % 7) * 300;
    msgs.push(["native", "thread/tokenUsage/updated", { turnId: a[0], tokenUsage: { last: { inputTokens: 40_000 + usage, totalTokens: 41_000 + usage }, total: { inputTokens: 900_000 + usage * 20, totalTokens: 920_000 + usage * 20 }, modelContextWindow: 1_000_000 } }]);
  } else if (kind === "limits") msgs.push(["native", "account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 20 + (usage % 50), windowDurationMins: 300, resetsAt: Math.round(Date.now() / 1000) + 7200 }, secondary: { usedPercent: 41, windowDurationMins: 10080, resetsAt: Math.round(Date.now() / 1000) + 86400 * 3 }, credits: null } }]);
  else if (kind === "hold") msgs.push(["hold", a[0]]);
  else if (kind === "start") {
    msgs.push(["start", a[0]]);
    if (a[1] === "take") msgs.push(["take", a[0]]);
  } else if (kind === "end") msgs.push(["end", a[0]]);
  else if (kind === "user") {
    const [turn, id, size, take] = a;
    msgs.push(["user", turn, id, filler(size, size), !!take]);
  } else if (kind === "input") {
    const [turn, id, size] = a;
    const text = filler(Math.min(size, 600), size);
    const item = { type: "functionCallOutput", id, name: "external_event", namespace: "external", output: JSON.stringify({ source: { kind: "agent", id: "ui-lead" }, type: "message", text: `Message Type: MESSAGE\nPayload:\n${text}` }), externalInputView: { schema: "cutex.agent-message.v1", data: { senderId: "ui-lead", senderName: "ui-lead", deliveryMode: "after_turn" } } };
    msgs.push(["native", "item/started", { turnId: turn, item }], ["native", "item/completed", { turnId: turn, item }]);
  } else if (kind === "item+" || kind === "item=") {
    const [turn, id, type, size, stream] = a;
    if (kind === "item=" && stream === "stream") {
      // Codex-style: the reply streams as deltas (4 characters, 30 per second) before it completes.
      const text = itemOf(type, id, size, true).text;
      for (const chunk of text.match(/.{1,4}/gsu) ?? []) msgs.push(["native", "item/agentMessage/delta", { turnId: turn, itemId: id, delta: chunk }], ["sleep", 33]);
    }
    msgs.push(["native", kind === "item+" ? "item/started" : "item/completed", { turnId: turn, item: itemOf(type, id, size, kind === "item=") }]);
  }
  await page.evaluate(async ({ msgs, label, agent }) => {
    const r = window.__cutexMockPerf.replay;
    window.__cj.op(label);
    for (const m of msgs) {
      if (m[0] === "sleep") await new Promise((res) => setTimeout(res, m[1]));
      else if (m[0] === "native") r.native(agent, m[1], m[2]);
      else if (m[0] === "hold") r.hold(agent, m[1]);
      else if (m[0] === "start") r.start(agent, m[1]);
      else if (m[0] === "end") r.end(agent, m[1]);
      else if (m[0] === "take") r.take(agent, m[1]);
      else if (m[0] === "user") {
        const taken = m[4] ? r.take(agent, m[1]) : null;
        const item = { type: "userMessage", id: m[2], ...(taken ? { clientId: taken.clientId } : {}), content: [{ type: "text", text: taken?.text ?? m[3] }] };
        r.native(agent, "item/started", { turnId: m[1], item });
        r.native(agent, "item/completed", { turnId: m[1], item });
      }
    }
  }, { msgs, label: `${kind} ${a.filter((x) => typeof x !== "object").join(" ")}`.slice(0, 80), agent: AGENT });
}

/** Page side: after every painted frame, the last rows' positions and the heights around the history. */
function installRecorder() {
  const frames = [], ops = [];
  const ids = new WeakMap();
  let nextId = 0, stopped = false;
  const idOf = (el) => { if (!ids.has(el)) ids.set(el, ++nextId); return ids.get(el); };
  const h = (el) => (el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : 0);
  const kindOf = (row) => row.querySelector("[data-send-bubble]") ? "user" : row.querySelector("[data-tool-row], [data-work-group]") ? "tools" : row.querySelector(".message-body, p, [data-foldable]") ? "agent" : "row";
  const sample = () => {
    const root = document.querySelector("[data-timeline-root]");
    const sc = root?.parentElement;
    const frame = document.querySelector("[data-timeline-frame]");
    if (!root || !sc || !frame) return;
    const rows = [...root.querySelectorAll(":scope > [data-tl-row]")].filter((r) => r.getBoundingClientRect().height > 0).slice(-6);
    // Above the composer block: the 需要你 strip, the dock and whatever else sits between the history and the input.
    let strip = 0;
    for (let el = frame.nextElementSibling; el && !el.matches("[data-composer-block]"); el = el.nextElementSibling) strip += h(el);
    const tail = root.lastElementChild && !root.lastElementChild.matches("[data-tl-row]") ? h(root.lastElementChild) : 0;
    frames.push({
      t: Math.round(performance.now()),
      rows: rows.map((r) => { const b = r.getBoundingClientRect(); return [idOf(r), Math.round(b.top * 10) / 10, Math.round(b.height * 10) / 10, kindOf(r)]; }),
      st: Math.round(sc.scrollTop * 10) / 10, sh: sc.scrollHeight, ch: sc.clientHeight,
      tray: h(document.querySelector("[data-queue-tray]")), strip, composer: h(document.querySelector("[data-composer-block]")),
      pad: parseFloat(root.style.paddingBottom) || 0, tail, rootH: h(root), room: h(document.querySelector("[data-timeline-slack]")),
      pane: h(frame.closest("main")), paneW: Math.round((frame.closest("main")?.getBoundingClientRect().width ?? 0) * 10) / 10,
    });
  };
  // The painted state: a ResizeObserver created after the app's runs after theirs in every frame (after layout,
  // after their stick-to-bottom corrections, before paint). A 1 px probe whose width flips in each animation frame
  // keeps it firing every frame; a sample from a later task could see a commit the next frame corrects.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;height:1px;width:1px;pointer-events:none;visibility:hidden";
  document.body.append(probe);
  const ro = new ResizeObserver(() => { if (!stopped) sample(); });
  ro.observe(probe);
  let flip = false;
  const tick = () => { if (stopped) return; flip = !flip; probe.style.width = flip ? "2px" : "1px"; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__cj = {
    op: (label) => ops.push([Math.round(performance.now()), label]),
    stop: () => { stopped = true; ro.disconnect(); probe.remove(); return { frames, ops }; },
  };
}

/** Node side: downward moves of the last two rows, each attributed to what changed in that frame. */
function analyse({ frames, ops }, size) {
  const moves = [];
  // Every frame where 「接下来」 changed height: how far the last two rows moved with it (either way).
  const tray = { changes: 0, moved: 0, maxUp: 0, maxDown: 0 };
  const grow = [];
  const widen = [];
  const subpx = [];
  let o = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (Math.abs(b.tray - a.tray) > 0.5) {
      const was = new Map(a.rows.map((r) => [r[0], r[1]]));
      const dys = b.rows.slice(-2).filter((r) => was.has(r[0])).map((r) => r[1] - was.get(r[0]));
      tray.changes++;
      if (dys.some((d) => Math.abs(d) > 0.5)) tray.moved++;
      for (const d of dys) { tray.maxUp = Math.max(tray.maxUp, Math.round(-d)); tray.maxDown = Math.max(tray.maxDown, Math.round(d)); }
    }
    const recent = [];
    while (o < ops.length && ops[o][0] <= b.t) o++;
    for (let k = o - 1; k >= 0 && ops[k][0] > a.t - 120; k--) recent.unshift(ops[k][1]);
    const prev = new Map(a.rows.map((r) => [r[0], r]));
    const lastTwo = b.rows.slice(-2);
    const dPane = b.pane - a.pane;
    if (dPane > 0.5) {
      // The pane grew (the window got taller): the room under the rows shrinks by the growth, never below 0.
      const allowed = Math.max(0, (a.room ?? 0) - dPane) + 4;
      let after = 0;
      for (let k = i; k < frames.length && frames[k].t - b.t <= 600; k++) after = Math.max(after, frames[k].room ?? 0);
      grow.push({ t: b.t - frames[0].t, by: Math.round(dPane), before: a.room ?? 0, after, allowed: Math.round(allowed), ok: after <= allowed });
    }
    const dPaneW = (b.paneW ?? 0) - (a.paneW ?? 0);
    if (Math.abs(dPaneW) > 0.5 && !widen.some((g) => b.t - frames[0].t - g.t < 600)) {
      // The pane got wider / narrower (最大化 / 还原): the rows re-wrap, the room under them must not grow from it.
      let after = 0;
      for (let k = i; k < frames.length && frames[k].t - b.t <= 600; k++) after = Math.max(after, frames[k].room ?? 0);
      widen.push({ t: b.t - frames[0].t, from: Math.round(a.paneW), to: Math.round(b.paneW), before: a.room ?? 0, after, ok: after <= (a.room ?? 0) + 4 });
    }
    for (const [n, r] of lastTwo.entries()) {
      const p = prev.get(r[0]);
      if (!p) continue;
      const dy = Math.round((r[1] - p[1]) * 10) / 10;
      if (dy <= 0.5) continue;
      // Under 1 px: the scroller snaps to whole pixels (DPR 1) while row heights are fractional — a turn dropping the
      // oldest rows can leave the rest up to 1 px lower, which no scrollTop can undo. Reported (subpx), not counted.
      if (dy < 1) {
        subpx.push({ t: b.t - frames[0].t, row: n === lastTwo.length - 1 ? `last(${r[3]})` : `second(${r[3]})`, dy });
        continue;
      }
      const dTray = Math.round((b.tray - a.tray) * 10) / 10, dStrip = Math.round((b.strip - a.strip) * 10) / 10, dCh = b.ch - a.ch, dSh = b.sh - a.sh;
      let cause = "other";
      if (Math.abs(dPane) > 0.5) cause = "resize";
      else if (Math.abs(dPaneW) > 0.5) cause = "widen";
      else if (dTray < -0.5 && dCh > 0) cause = recent.includes("fold") ? "toggle" : "nextUp";
      else if (dStrip < -0.5 && dCh > 0) cause = "needsYou";
      // The input box itself (the composer block minus 「接下来」, which sits in it) got shorter: a draft sent.
      else if ((b.composer - b.tray) - (a.composer - a.tray) < -0.5) cause = "composer";
      const gapA = a.sh - a.ch - a.st, gapB = b.sh - b.ch - b.st;
      const resized = b.rows.filter((x) => prev.has(x[0]) && Math.abs(prev.get(x[0])[2] - x[2]) > 0.5).map((x) => `${x[3]}#${x[0]} h${prev.get(x[0])[2]}→${x[2]}`);
      const why = `dCh ${dCh} dSh ${dSh} dTray ${dTray} dStrip ${dStrip} dComposer ${Math.round((b.composer - a.composer) * 10) / 10} gap ${Math.round(gapA)}→${Math.round(gapB)} tail ${a.tail}→${b.tail} pad ${a.pad}→${b.pad}${resized.length ? " resized " + resized.join(" ") : ""}`;
      moves.push({ t: b.t - frames[0].t, frame: i, row: n === lastTwo.length - 1 ? `last(${r[3]})` : `second(${r[3]})`, dy, cause, ops: recent, why });
    }
  }
  const sum = (list) => ({ count: list.length, max: list.length ? Math.max(...list.map((m) => m.dy)) : 0, total: Math.round(list.reduce((s, m) => s + m.dy, 0)), samples: list.slice(0, 40) });
  const rooms = frames.map((f) => f.room ?? 0);
  // The history's height (the scroller) against the short-pane minimum, max(120 px, 30 % of the pane) (lib/shortPane).
  const hs = frames.map((f) => f.ch).sort((x, y) => x - y);
  const history = { min: hs[0] ?? 0, median: hs[Math.floor(hs.length / 2)] ?? 0, underMin: frames.filter((f) => f.ch < Math.max(120, Math.round(f.pane * 0.3))).length };
  const inPane = moves.filter((m) => m.cause !== "resize" && m.cause !== "widen" && m.cause !== "toggle");
  // A fold by the owner lands at the normal bottom: no room under the rows in the frame it moved them.
  const toggles = moves.filter((m) => m.cause === "toggle").map((m) => ({ ...m, room: frames[m.frame].room ?? 0 }));
  return { size, frames: frames.length, ops: ops.length, tray, history, grow, widen, widenMoves: sum(moves.filter((m) => m.cause === "widen")), toggle: { ...sum(toggles), roomAfter: Math.max(0, ...toggles.map((m) => m.room)) }, resize: sum(moves.filter((m) => m.cause === "resize")), room: { max: Math.max(...rooms), end: rooms.at(-1), framesWithRoom: rooms.filter((r) => r > 0).length }, down: sum(inPane), subpx: { count: subpx.length, max: subpx.length ? Math.max(...subpx.map((m) => m.dy)) : 0 }, nextUp: sum(moves.filter((m) => m.cause === "nextUp")), needsYou: sum(moves.filter((m) => m.cause === "needsYou")), composer: sum(moves.filter((m) => m.cause === "composer")), other: sum(moves.filter((m) => m.cause === "other")) };
}
