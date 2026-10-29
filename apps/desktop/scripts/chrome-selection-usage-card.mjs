// Actual mock renderer: native selection scope and first-paint usage bounds, including delayed shape changes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
const mod = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await (isAbsolute(mod) ? import(pathToFileURL(mod).href) : import(mod));
const url = new URL(process.env.CHROME_QA_URL || "http://127.0.0.1:5199");
assert(url.protocol === "http:" && url.hostname === "127.0.0.1" && !["24270", "24260", "25370"].includes(url.port));
url.searchParams.set("guidesSkipped", "0.2.0");
const out = resolve(process.env.CHROME_QA_OUTPUT || ".test-temp/chrome-selection-usage-card");
const name = process.env.CHROME_QA_NAME || "wide", baseline = process.env.CHROME_QA_BASELINE === "1";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.JITTER_CHROME ? { executablePath: process.env.JITTER_CHROME } : {}) });
const result = { name, baseline, selection: [], usage: [] };
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.CHROME_QA_WIDTH || 1280), height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem("cutex-desktop.locale", "zh-CN");
    localStorage.setItem("cutex-desktop.theme", "light");
    localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false }));
    window.qaImport = async path => { const r = performance.getEntriesByType("resource").filter(e => new URL(e.name).pathname === path).at(-1); return import(r?.name || path); };
  });
  await page.goto(url.href);
  await page.waitForFunction(async () => { const { useApp } = await window.qaImport("/src/store.ts"); return useApp.getState().featuresKnown && useApp.getState().sidebar.active.length; });
  await page.evaluate(async () => {
    const { useApp, agentHost } = await window.qaImport("/src/store.ts");
    await useApp.getState().select(useApp.getState().sidebar.active[0].cutexSessionId);
    window.qa = { useApp, host: agentHost(useApp.getState()), id: useApp.getState().selectedId };
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const q = window.qa, key = `${q.host}\n${q.id}`, old = q.useApp.getState().sessions[key], at = Date.now() / 1000;
    const entries = [
      { kind: "user", id: "qa-copy-user", turnId: "qa-copy-turn", text: "COPY_USER /copy/path a3892dad", clientId: "qa-copy-client" },
      { kind: "agent", id: "qa-copy-agent", turnId: "qa-copy-turn", streaming: false, text: "COPY_PROSE\n\n```typescript\nconst COPY_CODE = 42;\n```" },
    ];
    q.useApp.setState(s => ({ sessions: { ...s.sessions, [key]: { ...old, version: old.version + 1, queue: [], timeline: { ...old.timeline, activeTurnId: null, entries: new Map(entries.map(e => [e.id, e])), turns: [{ id: "qa-copy-turn", status: "completed", startedAt: at - 60, completedAt: at, entryIds: entries.map(e => e.id) }] } } } }));
  });
  await page.getByText("COPY_PROSE", { exact: true }).waitFor();
  const select = async (label, locator, expected) => {
    await locator.click(); await page.keyboard.press("Control+a");
    const text = await page.evaluate(() => getSelection().toString());
    result.selection.push({ label, text });
    if (!baseline) { if (expected) { assert(text.includes(expected), `${label}: missing body: ${text}`); assert(!/Shelf|已工作|typescript|设置|用量/.test(text), `${label}: chrome selected: ${text}`); } else assert.equal(text, "", `${label}: whole-window selection`); }
  };
  await select("user-body", page.locator("[data-send-bubble]"), "COPY_USER");
  await select("markdown-body", page.getByText("COPY_PROSE", { exact: true }), "COPY_PROSE");
  await select("code", page.locator("pre code").first(), "COPY_CODE");
  await page.screenshot({ path: `${out}/${name}-selection.png` });
  await select("account-chrome", page.locator('button[aria-haspopup="menu"][aria-label*="个人菜单"]').first());
  await page.keyboard.press("Escape");
  const input = page.locator("[data-composer-input]");
  await input.fill("INPUT_NATIVE_SELECT_ALL"); await input.press("Control+a");
  const editor = await input.evaluate(e => ({ start: e.selectionStart, end: e.selectionEnd, length: e.value.length }));
  assert.equal(editor.start, 0); assert.equal(editor.end, editor.length); result.selection.push({ label: "textarea-native", ...editor });
  await page.evaluate(async () => {
    const { insertComposerDraft } = await window.qaImport("/src/lib/composerDrafts.ts");
    const { agentMentionMarkdown } = await window.qaImport("/src/lib/agentMentions.ts");
    insertComposerDraft(window.qa.host, window.qa.id, "RICH_NATIVE " + agentMentionMarkdown("QA", "cutex.ag-copy-qa") + " END");
  });
  const rich = page.locator('[data-composer-input][contenteditable="true"]');
  await rich.click(); await rich.press("Control+a");
  const richSelection = await rich.evaluate(e => ({ text: getSelection().toString(), scoped: e.contains(getSelection().getRangeAt(0).commonAncestorContainer) }));
  assert(richSelection.scoped && richSelection.text.includes("RICH_NATIVE") && richSelection.text.includes("END"));
  result.selection.push({ label: "rich-editor-native", ...richSelection });
  for (const settings of ["general", "usage"]) {
    await page.evaluate(section => window.qa.useApp.getState().openSettings(section), settings);
    await page.waitForTimeout(350);
    await select(`${settings}-page-chrome`, page.locator('button[aria-haspopup="menu"][aria-label*="个人菜单"]').first());
    await page.keyboard.press("Escape");
  }
  // The narrow shell intentionally hides secondary panes; expose the actual detail for this check.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.evaluate(async () => {
    const q = window.qa, askId = "ask-selection-qa", at = new Date().toISOString();
    const d = { askId, title: "DETAIL_CHROME_TITLE", requester: { kind: "agent", cutexSessionId: q.id, name: "Director" }, target: "qa-target", targetName: "TARGET_CHROME", execution: "answered", attempts: 1, createdAt: at, updatedAt: at, revision: 1, closed: "completed", answerPreview: "COPY_ANSWER", answerId: null, attempt: { n: 1, status: "completed", progress: [{ text: "COPY_PROGRESS", at }], model: "QA_MODEL" } };
    const detail = { ...d, body: { text: "COPY_DELEGATION_BRIEF" }, questions: [], attempts: [], answer: null };
    const { useDelegations } = await window.qaImport("/src/lib/delegationStore.ts");
    const { hostKey } = await window.qaImport("/src/lib/hostKeys.ts");
    useDelegations.setState(s => ({ byKey: { ...s.byKey, [hostKey(q.host, askId)]: d }, details: { ...s.details, [hostKey(q.host, askId)]: detail } }));
    window.cutex.api.ask = async () => detail;
    const { services } = await window.qaImport("/src/modules/app.ts"); services.side.open("delegations.detail", { askId });
  });
  await page.getByTestId("delegation-detail").waitFor();
  await select("delegation-title-chrome", page.getByText("DETAIL_CHROME_TITLE", { exact: true }).last());
  await select("delegation-body", page.getByText("COPY_DELEGATION_BRIEF", { exact: true }).last(), "COPY_DELEGATION_BRIEF");
  await page.evaluate(async () => { const { services } = await window.qaImport("/src/modules/app.ts"); services.ui.openPage("services.page"); });
  await page.waitForTimeout(400);
  await select("services-page-chrome", page.locator('button[aria-haspopup="menu"][aria-label*="个人菜单"]').first());
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: Number(process.env.CHROME_QA_WIDTH || 1280), height: 1000 });
  // Seed a genuine cached two-profile / two-gauge opening, then change both row and gauge counts asynchronously.
  await page.evaluate(async () => {
    const q = window.qa, { rememberProfileList, cachedProfileList } = await window.qaImport("/src/lib/profileSnapshot.ts");
    const { rememberUsage } = await window.qaImport("/src/lib/usageFlyout.ts");
    const original = cachedProfileList(q.host) || await window.cutex.api.listProfiles();
    const template = original.profiles[0];
    const initial = ["QA_Alpha", "QA_Ceobe"].map(name => ({ ...template, name, authKind: "chatgpt", quotaEnabled: true }));
    const final = [...initial, { ...template, name: "QA_Gamma", authKind: "chatgpt", quotaEnabled: true }];
    const gauge = n => ({ id: `qa-${n}`, label: `QA_Window_${n}`, kind: "window", remainingPercent: 70, balance: null, resetAt: null, windowLabel: `${n}h`, observedAt: Date.now() / 1000, stale: false });
    const gauges = [gauge(5), gauge(7)];
    rememberProfileList({ defaultProfile: initial[0].name, profiles: initial }, q.host);
    rememberUsage(q.host, { rows: initial.map(p => p.name), off: [], counts: Object.fromEntries(initial.map(p => [p.name, 2])), gauges: Object.fromEntries(initial.map(p => [p.name, gauges])) });
    q.useApp.setState({ quotas: Object.fromEntries(initial.map(p => [p.name, gauges])) });
    q.apiCalls = [];
    window.cutex.api.listProfiles = async () => { q.apiCalls.push("profiles"); await new Promise(r => setTimeout(r, 900)); return { defaultProfile: initial[0].name, profiles: final }; };
    window.cutex.api.profileQuota = async name => { q.apiCalls.push(name); await new Promise(r => setTimeout(r, name.endsWith("Alpha") ? 150 : 350)); return name.endsWith("Gamma") ? [gauge(1)] : [...gauges, gauge(9)]; };
    q.frames = [];
    const frame = () => {
      const e = document.querySelector("[data-flyout]");
      if (e && e.getBoundingClientRect().width) { const r = e.getBoundingClientRect(); q.frames.push({ at: performance.now(), phase: q.phase, x: r.x, y: r.y, w: r.width, h: r.height }); }
      q.raf = requestAnimationFrame(frame);
    };
    q.phase = "refresh"; frame();
  });
  const openUsage = async () => {
    await page.locator('button[aria-haspopup="menu"][aria-label*="个人菜单"]').first().click();
    await page.getByRole("menuitem", { name: "用量", exact: true }).hover();
    await page.locator("[data-flyout]").waitFor();
  };
  await openUsage(); await page.waitForTimeout(1900);
  await page.screenshot({ path: `${out}/${name}-usage-refresh.png` });
  assert(await page.getByText("QA_Gamma", { exact: true }).count(), "New profile remains accessible");
  assert(await page.getByText("9h", { exact: true }).count(), "Third gauge remains accessible");
  await select("usage-card-chrome", page.getByText("QA_Alpha", { exact: true }));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.evaluate(() => { window.qa.phase = "warm"; });
  await openUsage(); await page.waitForTimeout(1700);
  await page.screenshot({ path: `${out}/${name}-usage-warm.png` });
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.qa.raf); return window.qa.frames; });
  for (const phase of ["refresh", "warm"]) {
    const rows = frames.filter(r => r.phase === phase); assert(rows.length > 20);
    const delta = Object.fromEntries(["x", "y", "w", "h"].map(k => [k, Math.max(...rows.map(r => r[k])) - Math.min(...rows.map(r => r[k]))]));
    result.usage.push({ phase, frames: rows.length, first: rows[0], last: rows.at(-1), delta });
    if (!baseline) assert.deepEqual(delta, { x: 0, y: 0, w: 0, h: 0 });
  }
  result.frames = frames;
  result.apiCalls = await page.evaluate(() => window.qa.apiCalls);
  await writeFile(`${out}/${name}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, frames: undefined }, null, 2));
} finally { await browser.close(); }
