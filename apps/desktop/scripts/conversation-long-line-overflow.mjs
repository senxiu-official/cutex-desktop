// Browser geometry regression. Only an isolated mock renderer, never a daemon endpoint.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const module = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await (isAbsolute(module) ? import(pathToFileURL(module).href) : import(module));
const url = new URL(process.env.OVERFLOW_PREVIEW_URL || "http://127.0.0.1:5199");
assert(url.hostname === "127.0.0.1" && !["24270", "24260", "25370"].includes(url.port));
url.searchParams.set("guidesSkipped", "0.2.0");
const out = resolve(process.env.OVERFLOW_QA_OUTPUT || ".test-temp/conversation-overflow");
await mkdir(out, { recursive: true });
const name = process.env.OVERFLOW_RUN_NAME || "wide";
const baseline = process.env.OVERFLOW_BASELINE === "1";
const browser = await chromium.launch({ headless: true, ...(process.env.JITTER_CHROME ? { executablePath: process.env.JITTER_CHROME } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.OVERFLOW_WIDTH || 1280), height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem("cutex-desktop.locale", "zh-CN");
    localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false }));
    window.qaImport = async (path) => { const r = performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1); return import(r?.name || path); };
  });
  await page.goto(url.href);
  await page.waitForFunction(async () => { const { useApp } = await window.qaImport("/src/store.ts"); return useApp.getState().featuresKnown && useApp.getState().sidebar.active.length; });
  await page.evaluate(async () => {
    const { useApp, agentHost } = await window.qaImport("/src/store.ts");
    const { setUiPref } = await window.qaImport("/src/lib/prefs.ts");
    setUiPref("queuePanelFold", "open");
    await useApp.getState().select(useApp.getState().sidebar.active[0].cutexSessionId);
    window.qa = { useApp, host: agentHost(useApp.getState()), id: useApp.getState().selectedId, long: "aB0123456789".repeat(140), frames: [] };
  });
  await page.waitForTimeout(700);
  await page.locator("[data-composer-input]").fill("正在输入的草稿：工具行变化时，输入框应保持稳定。");
  await page.evaluate(async () => {
    const q = window.qa, key = `${q.host}\n${q.id}`, at = Date.now() / 1000;
    q.patch = (patch) => q.useApp.setState((s) => ({ sessions: { ...s.sessions, [key]: { ...s.sessions[key], ...patch, version: s.sessions[key].version + 1 } } }));
    const tl = q.useApp.getState().sessions[key].timeline;
    const user = { kind: "user", id: "qa-long-user", turnId: "qa-long-turn", clientId: "qa-long-user-cm", text: "USER_" + q.long };
    const agent = { kind: "agent", id: "qa-long-agent", turnId: "qa-long-turn", streaming: false, text: "MARKDOWN_" + q.long + "\n\nhttps://example.invalid/" + q.long + "\n\n`" + q.long + "`\n\n```text\nCODE_" + q.long + "\n```" };
    const received = { kind: "received", id: "qa-long-message", turnId: "qa-long-turn", message: { senderId: null, senderName: "qa-long-sender_" + q.long, sourceKind: "agent", deliveryMode: "turn", text: "BODY_" + q.long, schema: null, data: {}, eventType: "NOTE" } };
    const tool = (id, args) => ({ kind: "tool", id, turnId: "qa-long-turn", item: { type: "mcpToolCall", id, server: "cutex", tool: "agent_delegate", arguments: args, status: "failed", result: null, error: null } });
    const entries = [user, agent, received, tool("qa-long-tool", { target: "r253-coalesce", title: "独立复核capture.zip_" + q.long, text: q.long }), tool("qa-raw-tool", { target: JSON.stringify({ agent: "r253-coalesce", message: q.long }), text: q.long })];
    q.patch({ timeline: { ...tl, activeTurnId: null, entries: new Map(entries.map((e) => [e.id, e])), turns: [{ id: "qa-long-turn", status: "completed", startedAt: at - 300, completedAt: at, entryIds: entries.map((e) => e.id) }] }, queue: [], admission: { revision: 1, items: [], nextStep: [] } });
    const rect = () => { const r = document.querySelector('[data-gutter-anchor="composer"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    q.frame = () => { q.frames.push(rect()); q.raf = requestAnimationFrame(q.frame); }; q.frame();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const root = document.querySelector('[data-timeline-root]');
    [...root.querySelectorAll('button')].find((e) => e.textContent.includes("工具") && e.textContent.includes("2"))?.click();
    [...root.querySelectorAll('button')].find((e) => e.textContent.includes("qa-long-sender_"))?.click();
  });
  await page.waitForTimeout(400);
  const measure = () => page.evaluate(() => {
    const selectors = ['[data-timeline-root]', '[data-timeline-frame]', '[data-send-bubble]', '.message-body', '.markdown', '[data-task-tool-row] > button', '[data-testid="pending-message"]', '[data-testid="queue-delegation"]', '[data-queue-tray]', '[data-testid="delegation-detail"]'];
    const result = [];
    for (const selector of selectors) for (const e of document.querySelectorAll(selector)) { if (!e.clientWidth) continue; const r = e.getBoundingClientRect(); result.push({ selector, width: e.clientWidth, scroll: e.scrollWidth, left: r.left, right: r.right }); }
    const root = document.querySelector('[data-timeline-root]'); const scroller = root.parentElement;
    result.push({ selector: 'history-scroller', width: scroller.clientWidth, scroll: scroller.scrollWidth, overflowX: getComputedStyle(scroller).overflowX });
    const toolbar = document.querySelector('[data-testid="composer-notice-slot"]').previousElementSibling;
    result.push({ selector: 'composer-toolbar', width: toolbar.clientWidth, scroll: toolbar.scrollWidth });
    return result;
  });
  const conversation = await measure();
  const toolHeaders = await page.evaluate(() => [...document.querySelectorAll('[data-task-tool-row] > button')].map((e) => ({ height: e.getBoundingClientRect().height, fullTooltip: e.title.includes(window.qa.long), ellipsis: [...e.querySelectorAll('.truncate')].some((s) => s.scrollWidth > s.clientWidth && getComputedStyle(s).textOverflow === 'ellipsis') })));
  await page.evaluate(() => { const root = document.querySelector('[data-timeline-root]'); root.parentElement.scrollTop = root.parentElement.scrollHeight; });
  await page.screenshot({ path: `${out}/${name}-tools.png` });
  // Expand a failed delegation's full body too; the same prose rules must hold there.
  await page.evaluate(() => { const root = document.querySelector('[data-timeline-root]'); [...root.querySelectorAll('button')].find((e) => e.textContent.includes("r253-coalesce") && e.textContent.includes("委托"))?.click(); });
  await page.waitForTimeout(250);
  const expanded = await measure();
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.qa.raf); return window.qa.frames; });
  await page.evaluate(async () => {
    const q = window.qa, askId = "ask-long-overflow", at = new Date().toISOString();
    const d = { askId, title: "DETAIL_TITLE_" + q.long.slice(0, 160), requester: { kind: "agent", cutexSessionId: q.id, name: "Director" }, target: "qa-long-target", targetName: "TARGET_" + q.long, execution: "answered", attempts: 1, createdAt: at, updatedAt: at, revision: 1, closed: "completed", answerPreview: "ANSWER_" + q.long, answerId: null, attempt: { n: 1, status: "completed", progress: [{ text: "PROGRESS_" + q.long, at }], model: "MODEL_" + q.long } };
    const detail = { ...d, body: { text: "BRIEF_" + q.long }, questions: [], attempts: [], answer: null };
    const { useDelegations } = await window.qaImport('/src/lib/delegationStore.ts');
    const { hostKey } = await window.qaImport('/src/lib/hostKeys.ts'); const key = hostKey(q.host, askId);
    useDelegations.setState((s) => ({ byKey: { ...s.byKey, [key]: d }, details: { ...s.details, [key]: detail } }));
    const queueAskId = 'ask-long-queue-delegation';
    const queueAsk = { ...d, askId: queueAskId, requester: { kind: 'agent', cutexSessionId: 'qa-release-021', name: 'release-021' }, target: q.id, targetName: 'Director', title: 'QUEUE_TITLE_' + q.long, execution: 'admitted', closed: null, answerPreview: null, answerId: null, attempt: null };
    useDelegations.setState((s) => ({ byKey: { ...s.byKey, [hostKey(q.host, queueAskId)]: queueAsk } }));
    window.cutex.api.ask = async () => detail;
    const { services } = await window.qaImport('/src/modules/app.ts'); q.opened = services.side.open('delegations.detail', { askId });
    const { useAgentMessages } = await window.qaImport('/src/lib/agentMessageStore.ts');
    useAgentMessages.setState((s) => ({ byId: { ...s.byId, 'qa-long-pending': { messageId: 'qa-long-pending', from: 'qa-pending-sender', to: q.id, senderName: 'PENDING_' + q.long, recipientName: null, sourceKind: 'agent', timing: null, remote: null, kind: 'note', downgraded: false, body: q.long, state: 'pending', sentAt: Date.now() / 1000, deliveredAt: null, turnId: null, error: null, failedLive: false } } }));
    const item = { queueId: 'qa-long-queue', clientUserMessageId: 'qa-long-queue-cm', origin: { kind: 'other', clientId: 'qa' }, input: [{ type: 'text', text: q.long }], position: 0, revision: 1, state: 'queued', createdAt: at, updatedAt: at };
    q.patch({ queue: [item], admission: { revision: 2, items: [{ kind: 'owner', id: item.queueId, position: 1, state: 'waiting', enqueuedAt: at }, { kind: 'ask', id: queueAskId, position: 2, state: 'waiting', enqueuedAt: at }], nextStep: [{ id: 'qa-long-tell', deliveryKind: 'tell', label: q.long, from: 'TELL_' + q.long, preview: q.long, enqueuedAt: new Date(Date.now() - 20000).toISOString(), timing: 'afterTurn' }] } });
    q.gauges = [1, 2, 3].map((n) => ({ id: 'qa-quota-' + n, label: 'Window ' + n, kind: 'window', remainingPercent: 75, balance: null, resetAt: null, windowLabel: null, observedAt: Date.now() / 1000, stale: false }));
    window.cutex.api.profileQuota = async () => q.gauges;
    const { setUiPref } = await window.qaImport('/src/lib/prefs.ts'); setUiPref('composerProfileAvatar', true);
    q.useApp.setState((s) => ({ sidebar: { ...s.sidebar, active: s.sidebar.active.map((r) => r.cutexSessionId === q.id ? { ...r, profile: 'Alpha' } : r) }, quotas: { ...s.quotas, Alpha: q.gauges } }));
  });
  await page.getByTestId('delegation-detail').waitFor();
  await page.waitForTimeout(500);
  const detail = await measure();
  const toolbarFrames = await page.evaluate(async () => {
    const q = window.qa, { setUiPref } = await window.qaImport('/src/lib/prefs.ts');
    const rows = [];
    const rect = () => { const r = document.querySelector('[data-composer-input]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    for (const [avatar, count] of [[true, 3], [false, 0], [true, 1], [true, 3]]) {
      setUiPref('composerProfileAvatar', avatar); q.useApp.setState((s) => ({ quotas: { ...s.quotas, Alpha: q.gauges.slice(0, count) } }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const toolbar = document.querySelector('[data-testid="composer-notice-slot"]').previousElementSibling;
      rows.push({ avatar, count, input: rect(), toolbar: { width: toolbar.clientWidth, scroll: toolbar.scrollWidth } });
    }
    return rows;
  });
  await page.screenshot({ path: `${out}/${name}-detail.png` });
  const codeScroll = await page.evaluate(() => [...document.querySelectorAll('[data-streamdown="code-block-body"], pre')].filter((e) => e.clientWidth).map((e) => ({ width: e.clientWidth, scroll: e.scrollWidth, whiteSpace: getComputedStyle(e).whiteSpace })));
  const queueAvatars = await page.evaluate(() => [...document.querySelectorAll('[data-testid="queue-delegation"] [data-avatar]')].map((e) => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height, shrink: getComputedStyle(e).flexShrink })));
  const result = { conversation, expanded, detail, frames, toolbarFrames, codeScroll, toolHeaders, queueAvatars, draft: await page.locator('[data-composer-input]').inputValue() };
  await writeFile(`${out}/${name}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ conversation, expanded, detail }));
  if (!baseline) {
    for (const rows of [conversation, expanded, detail]) for (const row of rows) assert(row.scroll <= row.width + 1, `${row.selector} overflowed: ${row.scroll} > ${row.width}`);
    for (const frame of frames.slice(2)) assert.deepEqual(frame, frames[2], 'Input moved when long text/tool details changed');
    for (const frame of toolbarFrames) { assert.deepEqual(frame.input, toolbarFrames[0].input, 'Avatar/quota toolbar changed input geometry'); assert(frame.toolbar.scroll <= frame.toolbar.width + 1, 'Toolbar overflowed'); }
    assert(codeScroll.some((r) => r.scroll > r.width), 'Code must retain its own horizontal scrolling');
    assert(toolHeaders.length === 2 && toolHeaders.every((r) => r.height <= 24 && r.fullTooltip && r.ellipsis), 'Tool rows must remain single-line ellipses with full tooltips');
    assert(queueAvatars.length > 0 && queueAvatars.every((r) => r.width === 16 && r.height === 16 && r.shrink === '0'), 'Queue avatars must retain their fixed size');
    assert(result.draft.includes('正在输入的草稿'));
    assert(conversation.some((r) => r.selector === '[data-task-tool-row] > button'), 'Missing delegation tool rows');
    assert(detail.some((r) => r.selector === '[data-testid="delegation-detail"]'), 'Missing actual delegation detail');
  }
} finally { await browser.close(); }
