// Real line-box regression for shared mention chips in bubbles, Markdown, and the contenteditable.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const module = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await (isAbsolute(module) ? import(pathToFileURL(module).href) : import(module));
const url = new URL(process.env.OVERFLOW_PREVIEW_URL || "http://127.0.0.1:5199");
assert(url.hostname === "127.0.0.1" && !["24270", "24260", "25370"].includes(url.port));
url.searchParams.set("guidesSkipped", "0.2.0");
const out = resolve(process.env.OVERFLOW_QA_OUTPUT || ".test-temp/mention-line-box"); await mkdir(out, { recursive: true });
const name = process.env.OVERFLOW_RUN_NAME || "mention-wide", baseline = process.env.OVERFLOW_BASELINE === "1";
const browser = await chromium.launch({ headless: true, ...(process.env.JITTER_CHROME ? { executablePath: process.env.JITTER_CHROME } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.OVERFLOW_WIDTH || 1280), height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem("cutex-desktop.locale", "zh-CN"); localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 999, whatsNew: false }));
    window.qaImport = async (path) => { const r = performance.getEntriesByType("resource").filter((e) => new URL(e.name).pathname === path).at(-1); return import(r?.name || path); };
  });
  await page.goto(url.href);
  await page.waitForFunction(async () => { const { useApp } = await window.qaImport('/src/store.ts'); return useApp.getState().featuresKnown && useApp.getState().sidebar.active.length; });
  await page.evaluate(async () => {
    const { useApp, agentHost } = await window.qaImport('/src/store.ts');
    await useApp.getState().select(useApp.getState().sidebar.active[0].cutexSessionId);
    window.qa = { useApp, host: agentHost(useApp.getState()), id: useApp.getState().selectedId, target: 'cutex.ag-mention-qa', frames: [] };
  });
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    const q = window.qa, s = q.useApp.getState(), key = `${q.host}\n${q.id}`;
    const target = { ...s.sidebar.active[0], cutexSessionId: q.target, displayName: 'release-021', formalAgentName: 'release-021', runtime: { ...s.sidebar.active[0].runtime, status: 'online' } };
    q.useApp.setState({ sidebar: { ...s.sidebar, active: [...s.sidebar.active, target] } });
    const { agentMentionMarkdown } = await window.qaImport('/src/lib/agentMentions.ts');
    const { insertComposerDraft } = await window.qaImport('/src/lib/composerDrafts.ts');
    q.setDraft = (text) => insertComposerDraft(q.host, q.id, text);
    const tail = '批准了。\nB第二行没有提及。\nC第三行用作基线。';
    q.rich = 'A我给 ' + agentMentionMarkdown('release-021', q.target) + tail;
    q.plain = 'A我给 @release-021' + tail;
    const tl = s.sessions[key].timeline, turnId = 'qa-mention-turn', now = Date.now() / 1000;
    const entries = [{ kind: 'user', id: 'qa-mention-user', clientId: 'qa-mention-user-cm', turnId, text: q.rich }, { kind: 'agent', id: 'qa-mention-agent', turnId, streaming: false, text: q.rich.replaceAll('\n', '  \n') }];
    q.useApp.setState((state) => ({ sessions: { ...state.sessions, [key]: { ...state.sessions[key], version: state.sessions[key].version + 1, queue: [], admission: { revision: 1, items: [], nextStep: [] }, timeline: { ...tl, activeTurnId: null, entries: new Map(entries.map((e) => [e.id, e])), turns: [{ id: turnId, status: 'completed', startedAt: now - 1, completedAt: now, entryIds: entries.map((e) => e.id) }] } } } }));
    q.setDraft(q.plain);
  });
  await page.waitForTimeout(400);
  const plainEditor = await page.locator('[data-composer-input]').boundingBox();
  await page.evaluate(() => {
    const q = window.qa;
    q.frame = () => { const e = document.querySelector('[data-composer-input]'), r = e.getBoundingClientRect(), box = document.querySelector('[data-gutter-anchor="composer"]').getBoundingClientRect(); q.frames.push({ width: r.width, height: r.height, x: r.x, y: r.y, inputWidth: box.width, inputHeight: box.height }); q.raf = requestAnimationFrame(q.frame); };
    q.frame(); q.setDraft(q.rich);
  });
  await page.locator('[data-agent-mention-editor] [data-agent-mention]').waitFor();
  await page.waitForTimeout(350);
  const richEditor = await page.locator('[data-composer-input]').boundingBox();
  const frames = await page.evaluate(() => { cancelAnimationFrame(window.qa.raf); return window.qa.frames; });
  const measurements = [];
  for (const size of [12, 14, 18, 22]) for (const family of ['default', 'monospace']) {
    measurements.push(...await page.evaluate(({ fontSize, family }) => {
      const rangeFor = (root, text) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) { const index = n.textContent.indexOf(text); if (index < 0) continue; const r = document.createRange(); r.setStart(n, index); r.setEnd(n, index + text.length); return r.getBoundingClientRect(); }
        throw Error('Missing marker ' + text);
      };
      const result = [];
      for (const [context, selector] of [['bubble', '[data-send-bubble]'], ['markdown', '[data-timeline-root] .markdown p'], ['editor', '[data-agent-mention-editor]']]) {
        const root = document.querySelector(selector); if (!root) throw Error('Missing ' + context);
        root.dataset.originalFont ??= getComputedStyle(root).fontFamily;
        Object.assign(root.style, { fontSize: `${fontSize}px`, fontFamily: family === 'default' ? root.dataset.originalFont : family, lineHeight: '1.5', height: 'auto' });
        const a = rangeFor(root, 'A'), b = rangeFor(root, 'B'), c = rangeFor(root, 'C'), label = ((r) => { r.selectNodeContents(root.querySelector('[data-agent-mention-name]')); return r.getBoundingClientRect(); })(document.createRange()), after = rangeFor(root, '批准');
        const chip = root.querySelector('[data-agent-mention]'), avatar = chip.querySelector('[data-mention-avatar]') ?? chip.querySelector('[data-avatar-presence]') ?? chip.firstElementChild;
        const face = chip.querySelector('[data-avatar]');
        result.push({ context, fontSize, family, lineHeight: parseFloat(getComputedStyle(root).lineHeight), firstAdvance: b.top - a.top, secondAdvance: c.top - b.top, baselineDelta: label.top - a.top, afterGap: after.left - label.right, chipHeight: chip.getBoundingClientRect().height, avatarWidth: avatar.getBoundingClientRect().width, faceWidth: face.getBoundingClientRect().width, width: root.clientWidth, scroll: root.scrollWidth });
      }
      return result;
    }, { fontSize: size, family }));
  }
  await page.evaluate(() => {
    for (const root of document.querySelectorAll('[data-send-bubble], [data-timeline-root] .markdown p, [data-agent-mention-editor]')) Object.assign(root.style, { fontSize: '14px', fontFamily: root.dataset.originalFont, height: 'auto' });
    const r = document.querySelector('[data-timeline-root]').parentElement; r.scrollTop = r.scrollHeight;
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  const result = { plainEditor, richEditor, frames, measurements, zoom: await page.evaluate(() => CSS.supports('zoom', 'calc(1em / 16px)')) };
  await writeFile(`${out}/${name}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!baseline) {
    for (const row of measurements) {
      assert(Math.abs(row.firstAdvance - row.secondAdvance) <= 0.05, `${row.context}/${row.fontSize}: mention changed its line box`);
      assert(Math.abs(row.firstAdvance - row.lineHeight) <= 0.05, `${row.context}/${row.fontSize}: line height mismatch`);
      assert(Math.abs(row.baselineDelta) <= 0.05, `${row.context}/${row.fontSize}: label baseline mismatch ${row.baselineDelta}`);
      assert(Math.abs(row.afterGap) <= 0.05, `${row.context}/${row.fontSize}: extra spacing after mention ${row.afterGap}`);
      assert(row.chipHeight <= row.lineHeight && Math.abs(row.avatarWidth - row.fontSize) <= 1);
      assert(Math.abs(row.faceWidth - row.fontSize) <= 0.05, 'The actual avatar must scale with the text, not just its wrapper');
      assert(row.scroll <= row.width + 1);
    }
    assert.deepEqual(richEditor, plainEditor, 'Adding a mention changed editor geometry');
    for (const frame of frames) assert.deepEqual(frame, frames[0], 'Input jumped during mention insertion');
  }
} finally { await browser.close(); }
