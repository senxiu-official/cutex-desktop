// Real-renderer regression: next-up changes must not move or resize the input box while typing.
// Start preview:web, then PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/composer-nextup-jitter.mjs
// Optional: JITTER_PREVIEW_URL, JITTER_QA_OUTPUT, JITTER_RUN_NAME, JITTER_WIDTH/HEIGHT, JITTER_CHROME.
// Reports per-frame rectangles, ResizeObserver entries, layout shifts and a screenshot. No daemon calls.
import assert from "node:assert/strict";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await (isAbsolute(playwrightModule) ? import(pathToFileURL(playwrightModule).href) : import(playwrightModule));
import { mkdir, writeFile } from "node:fs/promises";
const out = resolve(process.env.JITTER_QA_OUTPUT || ".test-temp/composer-nextup-jitter");
await mkdir(out, { recursive: true });
const url = new URL(process.env.JITTER_PREVIEW_URL || "http://127.0.0.1:5199/");
assert(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Use a local mock preview");
assert(!["24260", "24270", "25370"].includes(url.port), "Control ports are not previews");
url.searchParams.set("guidesSkipped", "0.2.0");
const browser = await chromium.launch({ headless: true, ...process.env.JITTER_CHROME ? { executablePath: process.env.JITTER_CHROME } : {} });
const page = await browser.newPage({ viewport: { width: Number(process.env.JITTER_WIDTH || 1280), height: Number(process.env.JITTER_HEIGHT || 1e3) } });
await page.addInitScript(() => {
  localStorage.setItem("cutex-desktop.locale", "zh-CN");
  localStorage.setItem("cutex-desktop.theme", "light");
  localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false }));
  window.qaImport = async (path) => {
    const r = performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1);
    return import(r?.name || path);
  };
});
try {
  await page.goto(url.href);
  await page.waitForFunction(async () => {
    const { useApp } = await window.qaImport("/src/store.ts");
    return useApp.getState().featuresKnown && useApp.getState().sidebar.active.length;
  });
  await page.evaluate(async () => {
    const { useApp } = await window.qaImport("/src/store.ts");
    await useApp.getState().select(useApp.getState().sidebar.active[0].cutexSessionId);
  });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const { useApp, agentHost } = await window.qaImport("/src/store.ts");
    const { setUiPref } = await window.qaImport("/src/lib/prefs.ts");
    setUiPref("queuePanelFold", "open");
    const s = useApp.getState();
    const id = s.selectedId;
    const host = agentHost(s);
    const k = `${host}
${id}`;
    if (!s.sessions[k]) throw Error("session key missing:" + k);
    window.updateQA = (patch) => {
      const s2 = useApp.getState();
      const old = s2.sessions[k];
      useApp.setState({ sessions: { ...s2.sessions, [k]: { ...old, ...patch, version: old.version + 1 } } });
    };
    window.qaView = () => useApp.getState().sessions[k];
    window.rowsQA = [];
    window.shiftsQA = [];
    window.eventsQA = [];
    window.phaseQA = "initial";
    window.updateQA({ queue: [], admission: { revision: 1, items: [], nextStep: [], currentTurn: null } });
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const frame = () => {
      const panel = document.querySelector("[data-queue-tray]");
      if (window.roQA && panel && !window.observedQA.has(panel)) {
        window.observedQA.add(panel);
        window.roQA.observe(panel);
      }
      window.rowsQA.push({ phase: window.phaseQA, at: performance.now(), input: rect('[data-gutter-anchor="composer"]'), control: rect("[data-composer-input]"), composer: rect("[data-composer-block]"), timeline: rect("[data-timeline-frame]"), panel: rect("[data-queue-tray]") });
      window.rafQA = requestAnimationFrame(frame);
    };
    frame();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) window.eventsQA.push({ phase: window.phaseQA, target: e.target.getAttribute("data-gutter-anchor") || [...e.target.attributes].find((a) => a.name.startsWith("data-"))?.name, height: e.contentRect.height, width: e.contentRect.width, at: performance.now() });
    });
    window.observedQA = /* @__PURE__ */ new WeakSet();
    for (const sel of ['[data-gutter-anchor="composer"]', "[data-timeline-frame]", "[data-composer-block]"]) {
      const e = document.querySelector(sel);
      if (e) {
        ro.observe(e);
        window.observedQA.add(e);
      }
    }
    window.roQA = ro;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.shiftsQA.push({ phase: window.phaseQA, value: e.value, recent: e.hadRecentInput, sources: e.sources.map((s2) => ({ node: s2.node?.getAttribute?.("data-gutter-anchor") || s2.node?.nodeName, previous: s2.previousRect, current: s2.currentRect })) });
    }).observe({ type: "layout-shift", buffered: true });
  });
  // Pick text at a real wrap boundary. With the old conditional inset, its editor grows by a line
  // when the panel appears; a short draft would expose only the 4px position / 8px width jump.
  const draftProbe = await page.evaluate(() => {
    const control = document.querySelector("[data-composer-input]");
    const style = getComputedStyle(control);
    const wrapper = document.querySelector('[data-customize-region="composer"]');
    const inset = parseFloat(getComputedStyle(wrapper).paddingLeft) || 0;
    const narrow = control.getBoundingClientRect().width - (inset ? 0 : 8);
    const probe = document.createElement("textarea");
    for (const name of ["font", "letterSpacing", "lineHeight", "padding", "boxSizing", "whiteSpace", "wordBreak", "overflowWrap"]) probe.style[name] = style[name];
    Object.assign(probe.style, { position: "fixed", visibility: "hidden", height: "0", minHeight: "0", maxHeight: "none", border: "0", overflow: "hidden" });
    document.body.append(probe);
    const min = 2 * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    try {
      for (let n = 80; n < 1000; n++) {
        probe.value = "x".repeat(n);
        probe.style.width = `${narrow + 8}px`; const wideHeight = probe.scrollHeight;
        probe.style.width = `${narrow}px`; const narrowHeight = probe.scrollHeight;
        if (wideHeight >= min && narrowHeight > wideHeight) return { text: probe.value, narrow, wideHeight, narrowHeight };
      }
      return null;
    } finally { probe.remove(); }
  });
  assert(draftProbe, "Could not construct a wrap-boundary draft");
  await page.locator("[data-composer-input]").fill(draftProbe.text);
  await page.waitForTimeout(250);
  const phase = async (name, patch) => {
    await page.evaluate(({ name: name2, patch: patch2 }) => {
      window.phaseQA = name2;
      if (name2 === "owner-history" || name2 === "note-history-read") {
        const view = window.qaView();
        const timeline = { ...view.timeline, entries: new Map(view.timeline.entries), turns: [...view.timeline.turns] };
        const turnId = "qa-history-" + name2;
        const id = name2 === "owner-history" ? "qa-owner-history" : "qa-note";
        const now = Date.now() / 1e3;
        const entry = name2 === "owner-history" ? { kind: "user", id, text: "排队消息已进入历史", turnId, clientId: "qa-owner-cm" } : { kind: "received", id, turnId, message: { senderId: "qa-sender", senderName: "QA", deliveryMode: "turn", text: "委托结果已经进入历史", schema: null, data: {}, eventType: "ANSWER", sourceKind: "agent" } };
        timeline.entries.set(id, entry);
        timeline.turns.push({ id: turnId, status: "completed", startedAt: now - 1, completedAt: now, entryIds: [id] });
        patch2 = { ...patch2, timeline };
      }
      window.updateQA(patch2);
    }, { name, patch });
    await page.waitForTimeout(260);
  };
  const at = new Date(Date.now() - 1e4).toISOString();
  const item = { queueId: "qa-owner", clientUserMessageId: "qa-owner-cm", origin: { kind: "other", clientId: "qa" }, input: [{ type: "text", text: "排队消息" }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at };
  const owner = { kind: "owner", id: item.queueId, position: 0, enqueuedAt: at, state: "waiting" };
  const note = { id: "qa-note", deliveryKind: "tell", label: "QA留言", from: "QA", preview: "打字时收到的留言", enqueuedAt: at, timing: "afterTurn" };
  await phase("empty", { queue: [], admission: { revision: 2, items: [], nextStep: [], currentTurn: null } });
  await phase("owner-added", { queue: [item], admission: { revision: 3, items: [owner], nextStep: [], currentTurn: null } });
  await phase("result-added", { queue: [item], admission: { revision: 4, items: [owner], nextStep: [note], currentTurn: null } });
  await phase("result-updated", { admission: { revision: 5, items: [owner], nextStep: [{ ...note, preview: "委托结果更新：".repeat(30), deliveryKind: "answer" }], currentTurn: null } });
  await phase("owner-history", { queue: [], admission: { revision: 6, items: [], nextStep: [note], currentTurn: null } });
  await phase("note-history-read", { queue: [], admission: { revision: 7, items: [], nextStep: [note], currentTurn: null } });
  await phase("all-history", { queue: [], admission: { revision: 8, items: [], nextStep: [], currentTurn: null } });
  await phase("result-while-typing", { admission: { revision: 9, items: [], nextStep: [{ ...note, id: "qa-new-result", enqueuedAt: new Date(Date.now() - 3e5).toISOString(), deliveryKind: "answer" }], currentTurn: null } });
  await page.locator("[data-composer-input]").press("End");
  await page.keyboard.type("继续输入");
  await page.waitForTimeout(250);
  const historyText = await page.locator("[data-timeline-root]").textContent();
  assert(historyText.includes("排队消息已进入历史") && historyText.includes("委托结果已经进入历史"), "Queue/result history transition did not render");
  const runName = process.env.JITTER_RUN_NAME || "stable";
  await page.screenshot({ path: `${out}/${runName}.png` });
  const result = await page.evaluate(() => {
    cancelAnimationFrame(window.rafQA);
    window.roQA.disconnect();
    return { rows: window.rowsQA, events: window.eventsQA, shifts: window.shiftsQA, labels: [...document.querySelectorAll('[data-testid="queue-next-step"]')].map((e) => ({ text: e.textContent, title: e.querySelector('[role="img"][title]')?.getAttribute("title") })) };
  });
  result.draftProbe = draftProbe;
  await writeFile(`${out}/${runName}.json`, JSON.stringify(result, null, 2));
  const measured = result.rows.filter((r) => r.phase !== "initial");
  const baseline = measured.find((r) => r.phase === "empty");
  assert(baseline?.input && baseline?.control, "Input baseline missing");
  for (const row of measured) {
    assert.deepEqual(row.input, baseline.input, `Input moved/resized in ${row.phase}`);
    assert.deepEqual(row.control, baseline.control, `Editor moved/resized in ${row.phase}`);
  }
  assert(result.events.some((e) => e.target === "data-queue-tray"), "Panel ResizeObserver did not run");
  const panelHeight = (phase2) => Math.max(...measured.filter((r) => r.phase === phase2).map((r) => r.panel?.h || 0));
  assert(panelHeight("result-added") > panelHeight("owner-added"), "The added result did not grow the visible panel");
  assert.equal(panelHeight("result-updated"), panelHeight("result-added"), "Updating a row changed its height");
  assert(result.labels.length > 0, "Final coalescible result row missing");
  assert(result.labels.every((row) => row.text.includes("等待处理")), "Idle coalescible results need the unified waiting label");
  const phases = Object.groupBy(result.rows, (r) => r.phase);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(phases).map(([phase2, rows]) => [phase2, { input: rows.filter((r) => r.input).map((r) => r.input).filter((r, i, a) => !i || JSON.stringify(r) !== JSON.stringify(a[i - 1])), controls: rows.filter((r) => r.control).map((r) => r.control).filter((r, i, a) => !i || JSON.stringify(r) !== JSON.stringify(a[i - 1])) }]))));
  console.log(JSON.stringify(result.labels));
} finally {
  await browser.close();
}
