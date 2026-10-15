import { describe, expect, it, vi } from 'vitest';
import { encodeBrowserMessage, MAX_FILL_TEXT_CODE_POINTS, MAX_MESSAGE_BYTES, MAX_NODE_TEXT_CODE_POINTS,
  MAX_ROLE_CODE_POINTS, MAX_SCREENSHOT_BASE64_LENGTH, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_NODES,
  ProtocolError } from '@cutex-desktop/browser-protocol';
import { BrowserCdpExecutor } from '../src/index.js';
import type { CdpEvent, CdpTransport, ExecutorOptions } from '../src/index.js';
import fixture from '../fixtures/cdp-shapes.json';

type Json = Record<string, any>;
class FakeTransport implements CdpTransport {
  calls: { method: string; params: Json }[] = [];
  listeners = new Set<(event: CdpEvent) => void>();
  detachers = new Set<(reason?: string) => void>();
  handler?: (method: string, params: Json) => unknown;
  position: Json = { x: 75, y: 42 };
  receiptSeen = false;
  deliver = true;
  focused = true;
  mainFrame = true;
  value = 'before';
  nextContextId = 400;
  async send(method: string, params: Json = {}): Promise<unknown> {
    this.calls.push({ method, params });
    const result = this.handler?.(method, params);
    if (result !== undefined) return result;
    if (method === 'Page.getFrameTree') return fixture.frameTree;
    if (method === 'Accessibility.getFullAXTree') return fixture.ax;
    if (method === 'Page.createIsolatedWorld') return { executionContextId: ++this.nextContextId };
    if (method === 'DOM.resolveNode') return { object: { objectId: `node-${params.backendNodeId}` } };
    if (method === 'DOM.describeNode') return { node: { nodeName: 'INPUT', attributes: ['type', 'text'] } };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0 } };
    if (method === 'Page.captureScreenshot') return fixture.png;
    if (method === 'Runtime.evaluate') return { result: { objectId: 'main-window' } };
    if (method.startsWith('Input.')) {
      this.receiptSeen = this.deliver;
      if (method === 'Input.insertText') this.value = params.text;
      if (params.key === 'Backspace') this.value = '';
      return {};
    }
    if (method === 'Runtime.callFunctionOn') {
      const fn = params.functionDeclaration as string;
      if (fn.includes('getBoundingClientRect')) return { result: { value: this.position } };
      if (fn.includes('const receipt =')) { this.receiptSeen = false; return { result: { objectId: 'receipt' } }; }
      if (fn.includes('return this.read()')) return { result: { value: { seen: this.receiptSeen, value: this.value } } };
      if (fn.includes('focused:')) return { result: { value: { focused: this.focused } } };
      if (fn.includes('function(mainWindow)')) return { result: { value: this.mainFrame } };
      return { result: { value: { ok: true } } };
    }
    return {};
  }
  onEvent(callback: (event: CdpEvent) => void): () => void { this.listeners.add(callback); return () => this.listeners.delete(callback); }
  onDetach(callback: (reason?: string) => void): () => void { this.detachers.add(callback); return () => this.detachers.delete(callback); }
  event(method: string, params: Json): void { for (const callback of this.listeners) callback({ method, params }); }
  detach(): void { for (const callback of this.detachers) callback('gone'); }
  inputCalls() { return this.calls.filter(call => call.method.startsWith('Input.')); }
}
function setup(overrides: Partial<ExecutorOptions> = {}) {
  const transport = new FakeTransport();
  let generation = 0;
  const executor = new BrowserCdpExecutor(transport, {
    nextPageGeneration: () => ++generation,
    authorize: () => {}, ensureVisible: () => {}, allowUrl: () => true, ...overrides,
  });
  return { transport, executor };
}
const pending = () => new Promise<never>(() => {});
async function ref(executor: BrowserCdpExecutor, name = 'Message') {
  return (await executor.read()).nodes.find(node => node.name === name)!.ref;
}
async function eventually(predicate: () => boolean) {
  for (let i = 0; i < 1000 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}

describe('transport-injected browser executor', () => {
  it('generates opaque snapshot refs and filters ignored AX entries', async () => {
    const { executor } = setup();
    const result = await executor.read();
    expect(result.nodes).toHaveLength(4);
    expect(result.nodes[1]).toMatchObject({ name: 'Message', role: 'textbox', value: 'before' });
    expect(result.pageGeneration).toBeGreaterThan(0);
  });
  it('new snapshots invalidate old refs even on the same document', async () => {
    const { executor, transport } = setup();
    const old = await ref(executor);
    await executor.read();
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('refs expire, with a recheck after asynchronous authorization', async () => {
    let now = 1000;
    const { executor, transport } = setup({ now: () => now, snapshotTtlMs: 10 });
    const old = await ref(executor);
    now += 10;
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  for (const method of ['Page.frameNavigated', 'Page.navigatedWithinDocument', 'Page.frameStartedLoading', 'DOM.documentUpdated', 'Runtime.executionContextsCleared']) {
    it(`invalidates refs on ${method}`, async () => {
      const { executor, transport } = setup();
      const old = await ref(executor);
      const generation = executor.pageGeneration;
      transport.event(method, { frame: { id: 'main', url: 'http://127.0.0.1/next' }, frameId: 'main' });
      expect(executor.pageGeneration).toBeGreaterThan(generation);
      await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    });
  }
  it('fails closed on an iframe ref and drops detached frame refs', async () => {
    const { executor, transport } = setup();
    const child = await ref(executor, 'OOP child');
    await expect(executor.act(child, 'click')).rejects.toMatchObject({ code: 'unsupported_frame' });
    transport.event('Page.frameDetached', { frameId: 'child-process' });
    await expect(executor.act(child, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('rejects a detached or replaced DOM node before any input', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.position = { error: 'stale_ref' };
    await expect(executor.act(target, 'fill', 'new')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('rejects a child-frame node even when optional AX frameId was omitted', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.mainFrame = false;
    await expect(executor.act(target, 'fill', 'new')).rejects.toMatchObject({ code: 'unsupported_frame' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('maps an unresolvable backend node to stale_ref', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.handler = method => { if (method === 'DOM.resolveNode') throw new Error('No node'); };
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it('uses one private world for every fixed function and never falls back to the page context', async () => {
    const { executor, transport } = setup();
    await executor.act(await ref(executor), 'fill', 'isolated');
    const world = transport.calls.find(call => call.method === 'Page.createIsolatedWorld')!;
    expect(world.params).toMatchObject({ frameId: 'main', grantUniveralAccess: false });
    expect(world.params.worldName).toMatch(/^cutex-browser-[a-f0-9]{32}$/);
    expect(transport.calls.filter(call => call.method === 'DOM.resolveNode')).toEqual([
      { method: 'DOM.resolveNode', params: { backendNodeId: 2, executionContextId: 401 } },
    ]);
    expect(transport.calls.filter(call => call.method === 'Runtime.evaluate')).toEqual([
      { method: 'Runtime.evaluate', params: { expression: 'window', contextId: 401, returnByValue: false } },
    ]);
    await executor.act(await ref(executor), 'press', 'Enter');
    expect(transport.calls.filter(call => call.method === 'Page.createIsolatedWorld')).toHaveLength(1);
  });
  it.each([undefined, null, 0, -1, 1.5, '401', Number.MAX_SAFE_INTEGER + 1])('refuses malformed isolated context %s without default-world fallback', async executionContextId => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.handler = method => method === 'Page.createIsolatedWorld' ? { executionContextId } : undefined;
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'transport_error' });
    expect(transport.calls.some(call => call.method === 'DOM.resolveNode' || call.method === 'Runtime.evaluate')).toBe(false);
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('refuses unsupported isolated-world creation instead of executing in the main world', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.handler = method => { if (method === 'Page.createIsolatedWorld') throw new Error('Method unavailable'); };
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'transport_error' });
    expect(transport.calls.some(call => call.method === 'DOM.resolveNode' || call.method === 'Runtime.evaluate')).toBe(false);
  });
  for (const method of ['Page.frameNavigated', 'Page.navigatedWithinDocument', 'Page.frameStartedLoading', 'DOM.documentUpdated', 'Runtime.executionContextsCleared', 'Page.frameDetached']) {
    it(`re-establishes isolated context and fresh refs after ${method}`, async () => {
      const { executor, transport } = setup();
      const old = await ref(executor);
      await executor.act(old, 'click');
      transport.event(method, { frame: { id: 'main', url: 'http://127.0.0.1/next' }, frameId: 'main' });
      await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
      await executor.act(await ref(executor), 'click');
      expect(transport.calls.filter(call => call.method === 'Page.createIsolatedWorld')).toHaveLength(2);
      expect(transport.calls.filter(call => call.method === 'DOM.resolveNode').map(call => call.params.executionContextId)).toEqual([401, 402]);
    });
  }
  it('invalidates its destroyed context but ignores unrelated-world destruction', async () => {
    const { executor, transport } = setup();
    const old = await ref(executor);
    await executor.act(old, 'click');
    const generation = executor.pageGeneration;
    transport.event('Runtime.executionContextDestroyed', { executionContextId: 999 });
    expect(executor.pageGeneration).toBe(generation);
    transport.event('Runtime.executionContextDestroyed', { executionContextId: 401 });
    expect(executor.pageGeneration).toBeGreaterThan(generation);
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    await executor.act(await ref(executor), 'click');
    expect(transport.calls.filter(call => call.method === 'DOM.resolveNode').at(-1)?.params.executionContextId).toBe(402);
  });
  it('does not cache a world destroyed before its create acknowledgement', async () => {
    const { executor, transport } = setup();
    const old = await ref(executor);
    transport.handler = method => {
      if (method === 'Page.createIsolatedWorld') {
        transport.event('Runtime.executionContextDestroyed', { executionContextId: 401 });
        return { executionContextId: 401 };
      }
    };
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.calls.some(call => call.method === 'DOM.resolveNode')).toBe(false);
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('does not use a newly-created world after a concurrent navigation', async () => {
    const { executor, transport } = setup();
    const old = await ref(executor);
    transport.handler = method => {
      if (method === 'Page.createIsolatedWorld') transport.event('Page.frameNavigated', { frame: { id: 'main', url: 'http://127.0.0.1/next' } });
    };
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.calls.some(call => call.method === 'DOM.resolveNode')).toBe(false);
  });
  it.each(['cancel', 'deadline'] as const)('does not use or cache a late world acknowledgement after %s', async reason => {
    vi.useFakeTimers();
    try {
      const { executor, transport } = setup();
      const target = await ref(executor);
      const controller = new AbortController();
      let acknowledge!: (value: unknown) => void;
      transport.handler = method => method === 'Page.createIsolatedWorld'
        ? new Promise(resolve => { acknowledge = resolve; }) : undefined;
      const outcome = executor.act(target, 'click', '', { signal: controller.signal, deadline: Date.now() + 100 })
        .catch(cause => cause);
      await eventually(() => !!acknowledge);
      if (reason === 'cancel') controller.abort();
      else await vi.advanceTimersByTimeAsync(100);
      expect(await outcome).toMatchObject({ code: reason === 'cancel' ? 'cancelled' : 'deadline_exceeded' });
      expect(transport.calls.some(call => call.method === 'DOM.resolveNode')).toBe(false);
      expect(transport.inputCalls()).toHaveLength(0);
      // A later ordinary action obtains its own context acknowledgement. The abandoned
      // response must not overwrite it, even when delivered after the replacement action.
      transport.handler = undefined;
      await executor.act(target, 'click');
      acknowledge({ executionContextId: 999 });
      await Promise.resolve();
      await executor.act(target, 'click');
      expect(transport.calls.filter(call => call.method === 'Page.createIsolatedWorld')).toHaveLength(2);
      expect(transport.calls.filter(call => call.method === 'DOM.resolveNode')
        .map(call => call.params.executionContextId)).toEqual([401, 401]);
    } finally { vi.useRealTimers(); }
  });
  it('rechecks authorization after creating the isolated world and before resolving a node', async () => {
    let permitted = true;
    const { executor, transport } = setup({ authorize: () => {
      if (!permitted) throw new ProtocolError('permission_denied', 'Lease revoked');
    } });
    const target = await ref(executor);
    transport.handler = method => { if (method === 'Page.createIsolatedWorld') permitted = false; };
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'permission_denied' });
    expect(transport.calls.some(call => call.method === 'DOM.resolveNode')).toBe(false);
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it.each(['DOM.resolveNode', 'Input.dispatchMouseEvent'])('context loss after %s cannot send input into a replacement world', async lostAfter => {
    const { executor, transport } = setup();
    const old = await ref(executor);
    transport.handler = method => {
      if (method === lostAfter) transport.event('Runtime.executionContextDestroyed', { executionContextId: 401 });
    };
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: lostAfter === 'DOM.resolveNode' ? 'stale_ref' : 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(lostAfter === 'DOM.resolveNode' ? 0 : 1);
  });
  it('detects a replaced root frame from the authoritative frame tree even without an event', async () => {
    const { executor, transport } = setup();
    const old = await ref(executor);
    transport.handler = method => method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'replacement', url: 'http://127.0.0.1/new' } } } : undefined;
    await expect(executor.act(old, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.inputCalls()).toHaveLength(0);
    await executor.act(await ref(executor), 'click');
    expect(transport.calls.find(call => call.method === 'Page.createIsolatedWorld')?.params.frameId).toBe('replacement');
  });
  it('does not dispatch against an occluded/disabled/noneditable target', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.position = { error: 'not_actionable' };
    await expect(executor.act(target, 'fill', 'new')).rejects.toMatchObject({ code: 'not_actionable' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('host hidden preflight returns target_hidden without input or focus commands', async () => {
    const { executor, transport } = setup({ ensureVisible: () => { throw new ProtocolError('target_hidden', 'Minimized'); } });
    const target = await ref(executor);
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'target_hidden' });
    expect(transport.calls.some(call => call.method === 'DOM.focus')).toBe(false);
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('preserves typed host errors across separately bundled JS realms', async () => {
    const { executor } = setup({ ensureVisible: () => { throw Object.assign(new Error('Hidden'), { code: 'target_hidden' }); } });
    await expect(executor.act(await ref(executor), 'click')).rejects.toMatchObject({ code: 'target_hidden' });
  });
  it('enforces current-page URL and denies forbidden schemes even if the host callback allows', async () => {
    const { executor, transport } = setup({ allowUrl: () => false });
    await expect(executor.read()).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(executor.navigate('file:///secrets')).rejects.toMatchObject({ code: 'permission_denied' });
    expect(transport.calls.some(call => call.method === 'Page.navigate')).toBe(false);
  });
  it('clicks using trusted CDP input and observes receipt', async () => {
    const { executor, transport } = setup();
    const result = await executor.act(await ref(executor, 'Submit'), 'click');
    expect(result).toMatchObject({ status: 'dispatched', observed: true });
    expect(transport.inputCalls().map(call => call.params.type)).toEqual(['mousePressed', 'mouseReleased']);
  });
  it('fills with trusted text input, not JavaScript value/event mutation', async () => {
    const { executor, transport } = setup();
    await executor.act(await ref(executor), 'fill', '中文 hello');
    expect(transport.value).toBe('中文 hello');
    expect(transport.inputCalls()).toContainEqual({ method: 'Input.insertText', params: { text: '中文 hello' } });
    expect(transport.calls.some(call => String(call.params.functionDeclaration).includes('dispatchEvent('))).toBe(false);
  });
  it('uses Backspace to clear a selected input', async () => {
    const { executor, transport } = setup();
    await executor.act(await ref(executor), 'fill', '');
    expect(transport.value).toBe('');
    expect(transport.inputCalls()[0]?.params.key).toBe('Backspace');
  });
  it('sends Enter text and virtual key code to the guest, with keyup', async () => {
    const { executor, transport } = setup();
    await executor.act(await ref(executor), 'press', 'Enter');
    expect(transport.inputCalls()[0]?.params).toEqual({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    expect(transport.inputCalls()[1]?.params.type).toBe('keyUp');
  });
  it('rejects unsupported keys before focus/input dispatch', async () => {
    const { executor, transport } = setup();
    await expect(executor.act(await ref(executor), 'press', 'Ctrl+R')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('does not report a successful operation when acknowledged input was not delivered', async () => {
    const { executor, transport } = setup();
    transport.deliver = false;
    await expect(executor.act(await ref(executor), 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(2);
  });
  it('does not dispatch keys after failed focus', async () => {
    const { executor, transport } = setup();
    transport.focused = false;
    await expect(executor.act(await ref(executor), 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('lost input acknowledgement is outcome_unknown with no automatic replay', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor, 'Submit');
    transport.handler = method => { if (method === 'Input.dispatchMouseEvent') throw new Error('ack lost'); };
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(1);
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it('main navigation between mousedown and mouseup prevents input into the new page', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor, 'Submit');
    transport.handler = (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed')
        transport.event('Page.frameNavigated', { frame: { id: 'main', url: 'http://127.0.0.1/next' } });
    };
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(1);
  });
  it('stop cancels a pending read immediately and is terminal', async () => {
    const { executor, transport } = setup();
    transport.handler = method => method === 'Accessibility.getFullAXTree' ? pending() : undefined;
    const promise = executor.read();
    await eventually(() => transport.calls.some(call => call.method === 'Accessibility.getFullAXTree'));
    executor.stop();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    await expect(executor.read()).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('stop after input dispatch is outcome_unknown and does not wait for the acknowledgement', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor, 'Submit');
    transport.handler = method => method === 'Input.dispatchMouseEvent' ? pending() : undefined;
    const promise = executor.act(target, 'click');
    await eventually(() => transport.inputCalls().length > 0);
    executor.stop();
    await expect(promise).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(1);
  });
  it('detach cancels read without waiting and refuses future commands', async () => {
    const { executor, transport } = setup();
    transport.handler = method => method === 'Accessibility.getFullAXTree' ? pending() : undefined;
    const promise = executor.read();
    await eventually(() => transport.calls.some(call => call.method === 'Accessibility.getFullAXTree'));
    transport.detach();
    await expect(promise).rejects.toMatchObject({ code: 'transport_error' });
    await expect(executor.read()).rejects.toMatchObject({ code: 'target_closed' });
  });
  it('detach after navigation dispatch is outcome_unknown', async () => {
    const { executor, transport } = setup();
    transport.handler = method => {
      if (method === 'Page.navigate') { transport.detach(); return pending(); }
    };
    await expect(executor.navigate('http://127.0.0.1/next')).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('deadline before dispatch has no transport activity', async () => {
    const { executor, transport } = setup({ now: () => 100 });
    await expect(executor.read({ deadline: 100 })).rejects.toMatchObject({ code: 'deadline_exceeded' });
    expect(transport.calls).toHaveLength(0);
  });
  it('bounds an unresponsive read by its deadline', async () => {
    const { executor, transport } = setup({ defaultTimeoutMs: 15 });
    transport.handler = method => method === 'Accessibility.getFullAXTree' ? pending() : undefined;
    await expect(executor.read()).rejects.toMatchObject({ code: 'deadline_exceeded' });
  });
  it('cancellation while awaiting authorization does not dispatch', async () => {
    const { executor, transport } = setup({ authorize: pending });
    const controller = new AbortController();
    const promise = executor.read({ signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(transport.calls).toHaveLength(0);
  });
  it('cancellation after host guest-focus starts is outcome_unknown, without subsequent input', async () => {
    let focusing = false;
    const { executor, transport } = setup({ focusTarget: () => { focusing = true; return pending(); } });
    const target = await ref(executor);
    const controller = new AbortController();
    const promise = executor.act(target, 'press', 'Enter', { signal: controller.signal });
    await eventually(() => focusing);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('rechecks revoked permission before input', async () => {
    let allowed = true;
    const { executor, transport } = setup({ authorize: () => {
      if (!allowed) throw new ProtocolError('permission_denied', 'Revoked');
    } });
    const target = await ref(executor, 'Submit');
    transport.handler = (method, params) => {
      if (method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('const receipt =')) allowed = false;
    };
    await expect(executor.act(target, 'click')).rejects.toMatchObject({ code: 'permission_denied' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('does not queue a second operation behind a stalled command', async () => {
    const { executor, transport } = setup();
    transport.handler = () => pending();
    const first = executor.read();
    await expect(executor.read()).rejects.toMatchObject({ code: 'busy' });
    executor.stop();
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('returns screenshot image bytes and unsubscribes on dispose', async () => {
    const { executor, transport } = setup();
    expect(await executor.screenshot()).toMatchObject({ mimeType: 'image/png', data: fixture.png.data });
    executor.dispose();
    expect(transport.listeners.size).toBe(0);
    expect(transport.detachers.size).toBe(0);
  });
});

describe('M1 host generations and cryptographic ref namespaces', () => {
  it('rejects a previous executor ref after regrant and advances the shared guest generation', async () => {
    let guestGeneration = 0;
    const allocator = () => ++guestGeneration;
    const first = setup({ nextPageGeneration: allocator });
    const oldRef = await ref(first.executor);
    first.executor.stop();
    const oldLastGeneration = first.executor.pageGeneration;
    const second = setup({ nextPageGeneration: allocator });
    const newRef = await ref(second.executor);
    expect(second.executor.pageGeneration).toBeGreaterThan(oldLastGeneration);
    expect(newRef === oldRef).toBe(false);
    expect(newRef.split('-')[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(newRef.split('-')[0] === oldRef.split('-')[0]).toBe(false);
    await expect(second.executor.act(oldRef, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
    expect(second.transport.inputCalls()).toHaveLength(0);
  });
  it('independent namespaces prevent ref collisions even if two hosts allocate the same number', async () => {
    const a = setup(), b = setup();
    const aRef = await ref(a.executor), bRef = await ref(b.executor);
    expect(a.executor.pageGeneration).toBe(b.executor.pageGeneration);
    expect(aRef === bRef).toBe(false);
    await expect(b.executor.act(aRef, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it.each([0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid initial generation %s', value => {
    expect(() => setup({ nextPageGeneration: () => value })).toThrow('allocator failed');
  });
  it('fails closed when the allocator throws during construction', () => {
    expect(() => setup({ nextPageGeneration: () => { throw new Error('Registry gone'); } })).toThrow('allocator failed');
  });
  it.each(['repeated', 'regressing', 'throwing'] as const)('fails closed on %s invalidation without throwing from an event', async mode => {
    let calls = 0;
    const { executor, transport } = setup({ nextPageGeneration: () => {
      if (++calls === 1) return 5;
      if (mode === 'throwing') throw new Error('Registry gone');
      return mode === 'repeated' ? 5 : 4;
    } });
    await executor.read();
    transport.event('DOM.documentUpdated', {}); // Must not throw through the host event emitter.
    expect(() => executor.pageGeneration).toThrow('allocator failed');
    await expect(executor.read()).rejects.toMatchObject({ code: 'transport_error' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('invalid allocator interrupts an outstanding read and leaves no operational capability', async () => {
    let calls = 0;
    const { executor, transport } = setup({ nextPageGeneration: () => ++calls === 1 ? 1 : 1 });
    transport.handler = method => method === 'Accessibility.getFullAXTree' ? pending() : undefined;
    const reading = executor.read();
    await eventually(() => transport.calls.some(call => call.method === 'Accessibility.getFullAXTree'));
    transport.event('DOM.documentUpdated', {});
    await expect(reading).rejects.toMatchObject({ code: 'transport_error' });
    executor.dispose(); // Must not throw when already terminally invalidated.
  });
  it('does not fall back to noncryptographic randomness', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('Unavailable'); });
    try { expect(() => setup()).toThrow('Cryptographic ref namespace'); }
    finally { random.mockRestore(); }
  });
});

describe('M2 visibility at every dispatch boundary', () => {
  for (const action of ['click', 'fill', 'press'] as const) {
    it(`${action}: hide after DOM resolution sends no focus callback or input`, async () => {
      let visible = true;
      let focused = false;
      const { executor, transport } = setup({
        ensureVisible: () => { if (!visible) throw new ProtocolError('target_hidden', 'Hidden'); },
        focusTarget: () => { focused = true; },
      });
      const target = await ref(executor);
      transport.handler = method => { if (method === 'DOM.resolveNode') visible = false; };
      await expect(executor.act(target, action, action === 'press' ? 'Enter' : 'hello')).rejects.toMatchObject({ code: 'target_hidden' });
      expect(focused).toBe(false);
      expect(transport.inputCalls()).toHaveLength(0);
      expect(transport.calls.some(call => call.method === 'Emulation.setFocusEmulationEnabled')).toBe(false);
    });
  }
  it('rechecks before focus emulation even without focusTarget callback', async () => {
    let visible = true;
    const { executor, transport } = setup({ ensureVisible: () => {
      if (!visible) throw new ProtocolError('target_hidden', 'Hidden');
    } });
    const target = await ref(executor);
    transport.handler = method => { if (method === 'DOM.resolveNode') visible = false; };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'target_hidden' });
    expect(transport.calls.some(call => call.method === 'Emulation.setFocusEmulationEnabled')).toBe(false);
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('does not run a focus-reset side effect when focus emulation never dispatched', async () => {
    let checks = 0;
    const { executor, transport } = setup({ ensureVisible: () => {
      if (++checks === 2) throw new ProtocolError('target_hidden', 'Temporarily hidden');
    } });
    await expect(executor.act(await ref(executor), 'press', 'Enter')).rejects.toMatchObject({ code: 'target_hidden' });
    expect(transport.calls.some(call => call.method === 'Emulation.setFocusEmulationEnabled')).toBe(false);
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it.each(['Emulation.setFocusEmulationEnabled', 'DOM.focus', 'Input.dispatchKeyEvent'])('rechecks visibility after %s and stops further effects', async hiddenAfter => {
    let visible = true;
    const { executor, transport } = setup({ ensureVisible: () => {
      if (!visible) throw new ProtocolError('target_hidden', 'Hidden');
    } });
    const target = await ref(executor);
    transport.handler = method => { if (method === hiddenAfter) visible = false; };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(hiddenAfter === 'Input.dispatchKeyEvent' ? 1 : 0);
    if (hiddenAfter === 'Emulation.setFocusEmulationEnabled')
      expect(transport.calls.some(call => call.method === 'DOM.focus')).toBe(false);
  });
  it('hide after focusTarget is outcome_unknown, with no subsequent input', async () => {
    let visible = true;
    const { executor, transport } = setup({ ensureVisible: () => {
      if (!visible) throw new ProtocolError('target_hidden', 'Hidden');
    }, focusTarget: () => { visible = false; } });
    await expect(executor.act(await ref(executor), 'click')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCalls()).toHaveLength(0);
  });
  it('screenshots enforce visibility in the executor with a plain CDP transport', async () => {
    let checks = 0;
    const { executor, transport } = setup({ ensureVisible: () => {
      checks++; throw new ProtocolError('target_hidden', 'Hidden');
    } });
    await expect(executor.screenshot()).rejects.toMatchObject({ code: 'target_hidden' });
    expect(checks).toBe(1);
    expect(transport.calls.some(call => call.method === 'Page.captureScreenshot')).toBe(false);
  });
  it('rechecks visibility before JPEG fallback and remains deterministic for readonly capture', async () => {
    let visible = true;
    const { executor, transport } = setup({ ensureVisible: () => {
      if (!visible) throw new ProtocolError('target_hidden', 'Hidden');
    } });
    transport.handler = method => {
      if (method === 'Page.captureScreenshot') { visible = false; return { data: 'A'.repeat(MAX_SCREENSHOT_BASE64_LENGTH + 4) }; }
    };
    await expect(executor.screenshot()).rejects.toMatchObject({ code: 'target_hidden' });
    expect(transport.calls.filter(call => call.method === 'Page.captureScreenshot')).toHaveLength(1);
  });
});

describe('M3 bounded snapshots, fill and viewport screenshots', () => {
  const axNode = (id: number, extra: Json = {}) => ({ backendDOMNodeId: id, role: { value: 'textbox' }, name: { value: `node-${id}` }, ...extra });
  function ax(nodes: Json[]) {
    const test = setup();
    test.transport.handler = method => method === 'Accessibility.getFullAXTree' ? { nodes } : undefined;
    return test;
  }
  it('marks complete small snapshots as not truncated', async () => {
    const { executor } = setup();
    expect((await executor.read()).truncated).toBe(false);
  });
  it('caps node count deterministically and retains refs only for returned nodes', async () => {
    const { executor } = ax(Array.from({ length: MAX_SNAPSHOT_NODES + 2 }, (_, i) => axNode(i + 1)));
    const snapshot = await executor.read();
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.nodes).toHaveLength(MAX_SNAPSHOT_NODES);
    expect(snapshot.nodes[0]?.name).toBe('node-1');
    expect(snapshot.nodes.at(-1)?.name).toBe(`node-${MAX_SNAPSHOT_NODES}`);
    const omittedRef = snapshot.nodes[0]!.ref.replace(/n0$/, `n${MAX_SNAPSHOT_NODES}`);
    await expect(executor.act(omittedRef, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it('truncates role/name/value by code points without splitting non-BMP characters', async () => {
    const { executor } = ax([axNode(1, { role: { value: '🙂'.repeat(MAX_ROLE_CODE_POINTS + 1) },
      name: { value: '🙂'.repeat(MAX_NODE_TEXT_CODE_POINTS + 1) },
      value: { value: '𠮷'.repeat(MAX_NODE_TEXT_CODE_POINTS + 1) } })]);
    const snapshot = await executor.read(), node = snapshot.nodes[0]!;
    expect(snapshot.truncated).toBe(true);
    expect(node.truncated).toBe(true);
    expect([...node.role]).toHaveLength(MAX_ROLE_CODE_POINTS);
    expect([...node.name]).toHaveLength(MAX_NODE_TEXT_CODE_POINTS);
    expect([...node.value!]).toHaveLength(MAX_NODE_TEXT_CODE_POINTS);
    expect(node.name.endsWith('🙂')).toBe(true);
  });
  it('accounts for worst-case JSON escaping plus complete snapshot metadata and emits a valid envelope', async () => {
    const escaped = '\u0000'.repeat(MAX_NODE_TEXT_CODE_POINTS);
    const { executor } = ax(Array.from({ length: 100 }, (_, i) => axNode(i + 1, { name: { value: escaped }, value: { value: escaped } })));
    const snapshot = await executor.read();
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.nodes.length).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
    const encoded = encodeBrowserMessage({ protocolVersion: 1, type: 'result', requestId: 'snapshot-bound',
      hostId: 'host', deviceId: 'device', providerId: 'inApp', connectionGeneration: 1,
      status: 'succeeded', result: { kind: 'tab.snapshot', ...snapshot } });
    expect(encoded.byteLength).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    const omittedRef = snapshot.nodes[0]!.ref.replace(/n0$/, `n${snapshot.nodes.length}`);
    await expect(executor.act(omittedRef, 'click')).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it('omits password/protected values without relying on browser masking', async () => {
    const { executor } = ax([
      axNode(1, { role: { value: 'password' }, value: { value: 'secret-one' } }),
      axNode(2, { value: { value: 'secret-two' }, properties: [{ name: 'protected', value: { value: true } }] }),
      axNode(3, { value: { value: 'ordinary' } }),
    ]);
    const snapshot = await executor.read();
    expect(Object.hasOwn(snapshot.nodes[0]!, 'value')).toBe(false);
    expect(Object.hasOwn(snapshot.nodes[1]!, 'value')).toBe(false);
    expect(snapshot.nodes[2]?.value).toBe('ordinary');
    expect(JSON.stringify(snapshot).includes('secret-')).toBe(false);
  });
  it('accepts exactly 65536 Unicode code points for fill and rejects the next one before input', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    const text = '🙂'.repeat(MAX_FILL_TEXT_CODE_POINTS);
    await expect(executor.act(target, 'fill', text)).resolves.toMatchObject({ observed: true });
    expect(transport.value).toBe(text);
    const sent = transport.inputCalls().length;
    await expect(executor.act(target, 'fill', text + 'x')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(transport.inputCalls()).toHaveLength(sent);
  });
  it('returns PNG without recapturing when exactly at the image limit', async () => {
    const { executor, transport } = setup();
    // Valid header with opaque padded body: this test covers size, not PNG decoding.
    transport.handler = method => method === 'Page.captureScreenshot' ? { data: fixture.png.data.slice(0, 44) + 'A'.repeat(MAX_SCREENSHOT_BASE64_LENGTH - 44) } : undefined;
    expect((await executor.screenshot()).mimeType).toBe('image/png');
    expect(transport.calls.filter(call => call.method === 'Page.captureScreenshot')).toHaveLength(1);
  });
  it('tries one viewport JPEG at quality 60 after oversized PNG', async () => {
    const { executor, transport } = setup();
    const jpeg = Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,217]).toString('base64');
    transport.handler = (method, params) => method === 'Page.captureScreenshot'
      ? { data: params.format === 'png' ? 'A'.repeat(MAX_SCREENSHOT_BASE64_LENGTH + 4) : jpeg } : undefined;
    expect(await executor.screenshot()).toMatchObject({ mimeType: 'image/jpeg', data: jpeg });
    expect(transport.calls.filter(call => call.method === 'Page.captureScreenshot').map(call => call.params)).toEqual([
      { format: 'png', fromSurface: true, captureBeyondViewport: false },
      { format: 'jpeg', quality: 60, fromSurface: true, captureBeyondViewport: false },
    ]);
  });
  it('returns explicit message_too_large after two oversized images without a third attempt', async () => {
    const { executor, transport } = setup();
    transport.handler = method => method === 'Page.captureScreenshot' ? { data: 'A'.repeat(MAX_SCREENSHOT_BASE64_LENGTH + 4) } : undefined;
    await expect(executor.screenshot()).rejects.toMatchObject({ code: 'message_too_large' });
    expect(transport.calls.filter(call => call.method === 'Page.captureScreenshot')).toHaveLength(2);
  });
  it.each(['https://user:secret@example.com/', 'http://example.com/path with space', 'http://example.com\\path'])('uses protocol URL rejection for %s', async url => {
    const { executor, transport } = setup();
    await expect(executor.navigate(url)).rejects.toMatchObject({ code: 'permission_denied' });
    expect(transport.calls.some(call => call.method === 'Page.navigate')).toBe(false);
  });
});

describe('R1 unconditional bounded focus restoration', () => {
  const focusCalls = (transport: FakeTransport, enabled: boolean) => transport.calls.filter(call =>
    call.method === 'Emulation.setFocusEmulationEnabled' && call.params.enabled === enabled);
  const deferred = () => {
    let resolve!: (value?: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  for (const scenario of ['normal', 'hidden', 'stop', 'revoke', 'cancel', 'deadline', 'ref-expiry'] as const) {
    it(`${scenario}: emits exactly one reset, bypassing all ordinary command gates`, async () => {
      let visible = true, authorized = true, now = 1000;
      const controller = new AbortController();
      const { executor, transport } = setup({ now: () => now, snapshotTtlMs: 20,
        authorize: () => { if (!authorized) throw new ProtocolError('permission_denied', 'Revoked'); },
        ensureVisible: () => { if (!visible) throw new ProtocolError('target_hidden', 'Hidden'); },
      });
      const target = await ref(executor);
      transport.handler = (method, params) => {
        if (method !== 'Emulation.setFocusEmulationEnabled' || params.enabled !== true) return;
        if (scenario === 'hidden') visible = false;
        if (scenario === 'stop') { executor.stop(); executor.dispose(); }
        if (scenario === 'revoke') authorized = false;
        if (scenario === 'cancel') controller.abort();
        if (scenario === 'deadline') now += 20_000;
        if (scenario === 'ref-expiry') now += 21;
      };
      const action = executor.act(target, 'press', 'Enter', { signal: controller.signal });
      if (scenario === 'normal') await expect(action).resolves.toMatchObject({ observed: true });
      else await expect(action).rejects.toMatchObject({ code: 'outcome_unknown' });
      expect(focusCalls(transport, true)).toHaveLength(1);
      expect(focusCalls(transport, false)).toHaveLength(1);
      executor.stop(); executor.dispose();
      expect(focusCalls(transport, false)).toHaveLength(1);
    });
  }
  it('never-enabled stop/dispose issue no reset', async () => {
    const { executor, transport } = setup();
    await executor.read();
    executor.stop(); executor.dispose();
    expect(focusCalls(transport, false)).toHaveLength(0);
  });
  it('dirty is set before an enable send synchronously throws', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor), send = transport.send.bind(transport);
    transport.send = (method, params = {}) => {
      if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === true) {
        transport.calls.push({ method, params });
        throw new Error('Enable acknowledgement lost synchronously');
      }
      return send(method, params);
    };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(focusCalls(transport, true)).toHaveLength(1);
    expect(focusCalls(transport, false)).toHaveLength(1);
  });
  it('stop/dispose/finally deduplicate even when their shared reset immediately rejects', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.handler = (method, params) => {
      if (method !== 'Emulation.setFocusEmulationEnabled') return;
      if (params.enabled) { executor.stop(); executor.dispose(); return Promise.reject(new Error('Enable stopped')); }
      return Promise.reject(new Error('Reset transport detached'));
    };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    executor.stop(); executor.dispose();
    expect(focusCalls(transport, false)).toHaveLength(1);
  });
  it('stop/dispose/finally also deduplicate a synchronous reset adapter throw', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor), send = transport.send.bind(transport);
    transport.send = (method, params = {}) => {
      if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === false) {
        transport.calls.push({ method, params });
        throw new Error('Reset threw before returning a promise');
      }
      return send(method, params);
    };
    transport.handler = (method, params) => {
      if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === true) {
        executor.stop(); executor.dispose();
      }
    };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    executor.stop(); executor.dispose();
    expect(focusCalls(transport, false)).toHaveLength(1);
  });
  it('synchronous remote-object cleanup throws cannot prevent focus restoration', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor), send = transport.send.bind(transport);
    transport.send = (method, params = {}) => {
      if (method === 'Runtime.releaseObject' || (method === 'Runtime.callFunctionOn' &&
          String(params.functionDeclaration).includes('this.cleanup()'))) throw new Error('Cleanup adapter failed');
      return send(method, params);
    };
    await expect(executor.act(target, 'press', 'Enter')).resolves.toMatchObject({ observed: true });
    expect(focusCalls(transport, false)).toHaveLength(1);
  });
  it('failed reset is repaired before authorization or any ordinary work in the next run', async () => {
    const sequence: string[] = [];
    let failures = 1;
    const { executor, transport } = setup({ authorize: () => { sequence.push('authorize'); } });
    const target = await ref(executor);
    transport.handler = (method, params) => {
      sequence.push(method);
      if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === false && failures-- > 0)
        return Promise.reject(new Error('Reset failed'));
    };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    sequence.length = 0;
    await executor.read();
    expect(sequence[0]).toBe('Emulation.setFocusEmulationEnabled');
    expect(sequence[1]).toBe('authorize');
    expect(focusCalls(transport, false)).toHaveLength(2);
  });
  it('failed repair refuses ordinary work and remains repairable later', async () => {
    const { executor, transport } = setup();
    const target = await ref(executor);
    let failReset = true;
    transport.handler = (method, params) => {
      if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === false && failReset)
        throw new Error('Reset failed');
    };
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'outcome_unknown' });
    const count = transport.calls.length;
    await expect(executor.read()).rejects.toMatchObject({ code: 'transport_error' });
    expect(transport.calls.slice(count).map(call => call.method)).toEqual(['Emulation.setFocusEmulationEnabled']);
    failReset = false;
    await expect(executor.read()).resolves.toMatchObject({ truncated: false });
    expect(focusCalls(transport, false)).toHaveLength(3);
  });
  it('stop is synchronous while finally shares a pending reset and blocks concurrent operations', async () => {
    const reset = deferred();
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.handler = (method, params) => {
      if (method !== 'Emulation.setFocusEmulationEnabled') return;
      if (params.enabled === false) return reset.promise;
      executor.stop(); executor.dispose();
    };
    const action = executor.act(target, 'press', 'Enter');
    const rejected = expect(action).rejects.toMatchObject({ code: 'outcome_unknown' });
    await eventually(() => focusCalls(transport, false).length === 1);
    executor.stop(); executor.dispose();
    expect(focusCalls(transport, false)).toHaveLength(1);
    reset.resolve({});
    await rejected;
  });
  it('a delayed old reset cannot race a later enable: timeout blocks work until settlement and fresh repair', async () => {
    vi.useFakeTimers();
    try {
      const oldReset = deferred();
      const { executor, transport } = setup();
      const target = await ref(executor);
      let resetCount = 0;
      transport.handler = (method, params) => {
        if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === false && ++resetCount === 1)
          return oldReset.promise;
      };
      const action = executor.act(target, 'press', 'Enter');
      const rejection = expect(action).rejects.toMatchObject({ code: 'outcome_unknown' });
      await eventually(() => focusCalls(transport, false).length === 1);
      await vi.advanceTimersByTimeAsync(1001);
      await rejection;
      const beforeRetry = transport.calls.length;
      await expect(executor.read()).rejects.toMatchObject({ code: 'transport_error' });
      expect(transport.calls).toHaveLength(beforeRetry); // Still one unresolved command, not two racing resets.
      expect(focusCalls(transport, true)).toHaveLength(1);
      oldReset.resolve({});
      await Promise.resolve(); await Promise.resolve();
      const recovered = await executor.read();
      expect(focusCalls(transport, false)).toHaveLength(2); // Fresh repair after the old command settled.
      await executor.act(recovered.nodes.find(node => node.name === 'Message')!.ref, 'press', 'Enter');
      const focusSequence = transport.calls.filter(call => call.method === 'Emulation.setFocusEmulationEnabled')
        .map(call => call.params.enabled);
      expect(focusSequence).toEqual([true, false, false, true, false]);
    } finally { vi.useRealTimers(); }
  });
  it('context deadline does not bound restoration, but restoration itself has a one-second bound', async () => {
    vi.useFakeTimers();
    try {
      const reset = deferred();
      const { executor, transport } = setup({ defaultTimeoutMs: 10 });
      const target = await ref(executor);
      transport.handler = (method, params) => {
        if (method === 'Emulation.setFocusEmulationEnabled' && params.enabled === false) return reset.promise;
      };
      let done = false;
      const action = executor.act(target, 'press', 'Enter').finally(() => { done = true; });
      const rejected = expect(action).rejects.toMatchObject({ code: 'outcome_unknown' });
      await eventually(() => focusCalls(transport, false).length === 1);
      await vi.advanceTimersByTimeAsync(11);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(990);
      await rejected;
      expect(done).toBe(true);
      expect(focusCalls(transport, false)).toHaveLength(1);
      reset.reject(new Error('Late reset rejection is observed'));
      await Promise.resolve(); await Promise.resolve();
    } finally { vi.useRealTimers(); }
  });
  it('an unacknowledged reset keeps the executor busy rather than permitting a second enable', async () => {
    const reset = deferred();
    const { executor, transport } = setup();
    const target = await ref(executor);
    transport.handler = (method, params) => method === 'Emulation.setFocusEmulationEnabled' && params.enabled === false
      ? reset.promise : undefined;
    const action = executor.act(target, 'press', 'Enter');
    await eventually(() => focusCalls(transport, false).length === 1);
    await expect(executor.act(target, 'press', 'Enter')).rejects.toMatchObject({ code: 'busy' });
    expect(focusCalls(transport, true)).toHaveLength(1);
    reset.resolve({});
    await expect(action).resolves.toMatchObject({ observed: true });
  });
});
