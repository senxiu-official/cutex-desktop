// Browser-only regression for explicit queue insertion and the notice's placement. No daemon.
// Same PLAYWRIGHT_MODULE / JITTER_CHROME / JITTER_PREVIEW_URL / JITTER_QA_OUTPUT knobs as the jitter probe.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const module = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await (isAbsolute(module) ? import(pathToFileURL(module).href) : import(module));
const url = new URL(process.env.JITTER_PREVIEW_URL || "http://127.0.0.1:5199");
assert(url.hostname === "127.0.0.1" && !["24270", "24260", "25370"].includes(url.port), "Only isolated preview ports allowed");
url.searchParams.set("guidesSkipped", "0.2.0");
const out = resolve(process.env.JITTER_QA_OUTPUT || ".test-temp/nextup-step1-feedback");
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.JITTER_CHROME ? { executablePath: process.env.JITTER_CHROME } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.JITTER_WIDTH || 1280), height: Number(process.env.JITTER_HEIGHT || 1000) } });
  await page.addInitScript(() => {
    localStorage.setItem("cutex-desktop.locale", "zh-CN");
    localStorage.setItem("cutex-desktop.theme", "light");
    localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false }));
    window.qaImport = async (path) => {
      const r = performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1);
      return import(r?.name || path);
    };
  });
  await page.goto(url.href);
  await page.waitForFunction(async () => {
    const { useApp } = await window.qaImport("/src/store.ts");
    return useApp.getState().featuresKnown && useApp.getState().sidebar.active.length;
  });
  await page.evaluate(async () => {
    const { useApp, agentHost } = await window.qaImport("/src/store.ts");
    const { setUiPref } = await window.qaImport("/src/lib/prefs.ts");
    setUiPref("queuePanelFold", "open");
    await useApp.getState().select(useApp.getState().sidebar.active[0].cutexSessionId);
    window.qa = { useApp, host: agentHost(useApp.getState()), id: useApp.getState().selectedId, calls: 0, rects: [], phase: "baseline" };
  });
  await page.waitForTimeout(700);
  await page.locator("[data-composer-input]").fill("写到一半的草稿，插话结果不应覆盖这里。");
  await page.evaluate(() => {
    const q = window.qa, key = `${q.host}\n${q.id}`;
    q.patch = (patch) => q.useApp.setState((s) => ({ sessions: { ...s.sessions, [key]: { ...s.sessions[key], ...patch, version: s.sessions[key].version + 1 } } }));
    q.view = () => q.useApp.getState().sessions[key];
    q.item = { queueId: "qa-insert", clientUserMessageId: "qa-insert-cm", origin: { kind: "other", clientId: "qa" }, input: [{ type: "text", text: "这条消息的插话请求" }], position: 0, revision: 1, state: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    q.patch({ queue: [q.item], admission: { revision: 1, items: [{ kind: "owner", id: q.item.queueId, position: 1, enqueuedAt: q.item.createdAt, state: "waiting" }], nextStep: [] } });
    window.cutex.api.queueList = async () => ({ items: q.view().queue, admission: q.view().admission });
    window.cutex.api.queuePromote = async () => { q.calls++; return new Promise((yes, no) => { q.resolve = yes; q.reject = no; }); };
    const rect = (selector) => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
    q.frame = () => { q.rects.push({ phase: q.phase, input: rect('[data-gutter-anchor="composer"]'), control: rect('[data-composer-input]') }); q.raf = requestAnimationFrame(q.frame); };
    q.frame();
  });
  await page.waitForTimeout(300);
  await page.getByTestId("queue-item").hover();
  await page.getByTestId("queue-send-now").click();
  await page.getByTestId("queue-insert-status").filter({ hasText: "正在请求插话" }).waitFor();
  await page.evaluate(() => { const q = window.qa; q.phase = "pending"; q.useApp.getState().queueSendNow(q.item, q.id, q.host); });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.qa.calls), 1, "Duplicate insert reached management");
  await page.evaluate(() => { window.qa.phase = "refused"; window.qa.reject(new Error("queue_steer_refused:sessionOffline")); });
  await page.getByTestId("queue-insert-status").filter({ hasText: "当前控制连接不可用" }).waitFor();
  assert.equal(await page.getByTestId("queue-item").getByTestId("queue-insert-status").count(), 1);
  assert.equal(await page.getByTestId("queue-delivery-note").count(), 0);
  const strayNotice = await page.getByTestId("composer-notice").allTextContents();
  assert(!strayNotice.some((text) => text.includes("控制连接") || text.includes("插话未受理")), `Row feedback duplicated into a composer notice: ${strayNotice.join(" / ")}`);
  await page.getByTestId("queue-item").hover();
  await page.getByTestId("queue-send-now").click();
  await page.getByTestId("queue-insert-status").filter({ hasText: "正在请求插话" }).waitFor();
  await page.evaluate(() => { const q = window.qa; q.phase = "inserted"; q.patch({ queue: [], admission: { revision: 2, items: [], nextStep: [] } }); q.resolve({ result: { disposition: "steered", turnId: "qa-turn" }, clientUserMessageId: q.item.clientUserMessageId, input: q.item.input }); });
  await page.getByTestId("queue-insert-status").filter({ hasText: "已插入当前回合" }).waitFor();
  assert.equal(await page.getByTestId("queue-insert-status").count(), 1);
  // Feed positive native-history evidence, as after the next tool boundary reads the insert.
  // Accepted alone is not delivery; only a matching recorded userMessage starts expiry.
  await page.evaluate(async () => {
    const q = window.qa;
    const { reconcileQueueInsert } = await window.qaImport('/src/lib/queueInsertFeedback.ts');
    const { hasClientId } = await window.qaImport('/src/lib/outbox.ts');
    const { settlePendingSteers } = await window.qaImport('/src/lib/pendingSteers.ts');
    const view = q.view(), timeline = { ...view.timeline, entries: new Map(view.timeline.entries), turns: [...view.timeline.turns] };
    const user = { kind: 'user', id: 'qa-native-delivery', clientId: q.item.clientUserMessageId, text: '这条消息的插话请求', turnId: 'qa-turn' };
    timeline.entries.set(user.id, user);
    timeline.turns.push({ id: 'qa-turn', status: 'completed', startedAt: Date.now() / 1000 - 1, completedAt: Date.now() / 1000, entryIds: [user.id] });
    q.phase = 'delivered'; q.deliveryAt = performance.now();
    q.deliveryObserver = new MutationObserver(() => {
      if (document.querySelector('[data-testid="queue-insert-status"][data-state="delivered"]')) q.sawDelivery = true;
      else if (q.sawDelivery) { q.deliveryGoneAt = performance.now(); q.deliveryObserver.disconnect(); }
    });
    q.deliveryObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    q.patch({ timeline });
    const key = `${q.host}\n${q.id}`;
    q.useApp.setState((s) => ({ pendingSteers: { ...s.pendingSteers, [key]: settlePendingSteers(s.pendingSteers[key] ?? [], timeline).pending } }));
    reconcileQueueInsert(q.host, q.id, (id) => hasClientId(timeline, id));
  });
  await page.locator('[data-testid="queue-insert-status"][data-state="delivered"]').waitFor();
  assert.equal(await page.locator('[data-testid="queue-insert-status"] button').count(), 0, 'Delivered needs no manual close');
  await page.screenshot({ path: `${out}/delivered.png` });
  await page.getByTestId('queue-insert-status').waitFor({ state: 'detached', timeout: 1500 });
  assert.equal(await page.getByTestId('queue-insert-receipt').count(), 0);
  await page.waitForTimeout(100);
  await page.evaluate(() => { const q = window.qa; q.phase = "notice"; q.useApp.getState().notify("操作失败：这里只是测试提示位置", "error", { hostId: q.host, sessionId: q.id }); });
  await page.getByTestId("composer-notice").waitFor();
  const placement = await page.getByTestId("composer-notice").evaluate((e) => ({ inside: !!e.closest('[data-gutter-anchor="composer"]'), top: e.getBoundingClientRect().top, cardBottom: document.querySelector('[data-customize-region="composer"]').getBoundingClientRect().bottom }));
  assert(!placement.inside && placement.top >= placement.cardBottom, "Notice overlaps the input/queue card");
  await page.waitForTimeout(300);
  const result = await page.evaluate(() => { cancelAnimationFrame(window.qa.raf); return { rects: window.qa.rects, calls: window.qa.calls, draft: document.querySelector('[data-composer-input]').value, deliveredVisibleMs: window.qa.deliveryGoneAt - window.qa.deliveryAt }; });
  const baseline = result.rects.find((r) => r.phase === "baseline");
  assert(baseline?.input && baseline?.control);
  for (const r of result.rects) { assert.deepEqual(r.input, baseline.input, `Input moved in ${r.phase}`); assert.deepEqual(r.control, baseline.control, `Editor moved in ${r.phase}`); }
  assert.equal(result.draft, "写到一半的草稿，插话结果不应覆盖这里。");
  assert(result.deliveredVisibleMs >= 900 && result.deliveredVisibleMs <= 1500, 'Delivery receipt must expire within 1.5 seconds');
  result.placement = placement;
  await page.screenshot({ path: `${out}/feedback.png` });
  await writeFile(`${out}/feedback.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ frames: result.rects.length, calls: result.calls, deliveredVisibleMs: result.deliveredVisibleMs, placement, geometry: "unchanged", draft: "preserved" }));
} finally { await browser.close(); }
