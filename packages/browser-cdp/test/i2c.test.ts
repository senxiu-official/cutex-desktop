import { describe, it, expect } from 'vitest';
import { runInNewContext } from 'node:vm';
import { ProtocolError, MAX_SNAPSHOT_NODES } from '@cutex-desktop/browser-protocol';
import type { BrowserAction } from '@cutex-desktop/browser-protocol';
import { BrowserCdpExecutor } from '../src/index.js';
import type { CdpTransport, CdpEvent, ExecutorOptions } from '../src/index.js';
import { SELECT_VALUE, SELECT_OPTIONS, ARM_MOTION } from '../src/page-functions.js';
import { imageDimensions } from '../src/image.js';

type Json = Record<string, any>;
const png = (width = 800, height = 400) => {
  const bytes = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes.toString('base64');
};
const ax = (id: number, name = 'field', role = 'textbox') => ({ backendDOMNodeId: id, name: { value: name }, role: { value: role }, value: { value: 'private-value' } });
class Transport implements CdpTransport {
  calls: { method: string; params: Json }[] = [];
  listener = (_event: CdpEvent) => {};
  url = 'https://fixture.invalid/'; nodes = [ax(1)]; checked = false; value = ''; seen = false; email = false;
  handler?: (method: string, params: Json) => unknown;
  async send(method: string, params: Json = {}): Promise<unknown> {
    this.calls.push({ method, params }); const custom = this.handler?.(method, params); if (custom !== undefined) return custom;
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: this.url } } };
    if (method === 'Accessibility.getFullAXTree') return { nodes: this.nodes };
    if (method === 'DOM.describeNode') return { node: { nodeName: 'INPUT', attributes: ['type', 'text'] } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 123 };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'node' } };
    if (method === 'Runtime.evaluate') return params.expression === 'document.readyState' ? { result: { value: 'complete' } } : { result: { objectId: 'window' } };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 800, clientHeight: 400, pageX: 12, pageY: 34 } };
    if (method === 'Page.captureScreenshot') return { data: png(160, 80) };
    if (method === 'Page.getNavigationHistory') return { currentIndex: 1, entries: [{ id: 10, url: 'https://fixture.invalid/back' }, {}, { id: 12, url: 'https://fixture.invalid/next' }] };
    if (method.startsWith('Input.')) {
      this.seen = true;
      if (params.type === 'mouseReleased') this.checked = !this.checked;
      if (method === 'Input.insertText') this.value = params.text;
      return {};
    }
    if (method === 'Runtime.callFunctionOn') {
      const fn: string = params.functionDeclaration;
      if (fn.includes('function(mainWindow)')) return { result: { value: true } };
      if (fn.includes('getBoundingClientRect')) return { result: { value: { x: 20, y: 30, checked: this.checked, rect: { x: 10, y: 20, width: 80, height: 40 } } } };
      if (fn.includes('const receipt =') || fn.includes('let seen=false')) { this.seen = false; return { result: { objectId: 'receipt' } }; }
      if (fn.includes('return this.read()')) return { result: { value: { seen: this.seen, value: this.value } } };
      if (fn.includes('focused:')) return { result: { value: { focused: true } } };
      if (fn === SELECT_VALUE) return { result: { value: { keyboardSelect: this.email } } };
      if (fn === SELECT_OPTIONS) return { result: { value: params.arguments[2].value ? { values: ['x'], expected: ['x'] } : { ok: true } } };
      if (fn.includes('checked:this.tagName')) return { result: { value: { checked: this.checked } } };
      return { result: { value: { ok: true } } };
    }
    return {};
  }
  onEvent(callback: (event: CdpEvent) => void) { this.listener = callback; return () => {}; }
  onDetach() { return () => {}; }
  event(method: string, params: Json = {}) { this.listener({ method, params }); }
  input() { return this.calls.filter(call => call.method.startsWith('Input.')); }
}
function setup(overrides: Partial<ExecutorOptions> = {}) {
  const transport = new Transport(); let generation = 0;
  const executor = new BrowserCdpExecutor(transport, { nextPageGeneration: () => ++generation, authorize() {}, ensureVisible() {}, allowUrl: () => true, ...overrides });
  return { transport, executor };
}
const getRef = async (executor: BrowserCdpExecutor) => (await executor.read()).nodes[0]!.ref;
const turns = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

describe('I2c S3 DOM-derived value redaction', () => {
  const sensitive = ['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp',
    'cc-exp-month', 'cc-exp-year', 'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-type',
    'password', 'section-private current-password', 'section-checkout billing CC-NUMBER', 'shipping cc-future-field', 'custom-passcode'];
  it.each(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider', 'custom-value-role'])('redacts sensitive autocomplete for any value-bearing %s in read and find', async role => {
    for (const token of sensitive) {
      const { transport, executor } = setup(); transport.nodes = [ax(1, 'private', role)];
      transport.handler = method => method === 'DOM.describeNode' ? { node: { nodeName: 'INPUT', attributes: ['type', 'text', 'autocomplete', token] } } : undefined;
      expect((await executor.read()).nodes[0]).not.toHaveProperty('value');
      expect((await executor.find({ text: 'private' })).nodes[0]).not.toHaveProperty('value');
      executor.dispose();
    }
  });
  it.each(['combobox', 'spinbutton', 'slider'])('retains ordinary %s values only after DOM proof; failed description redacts', async role => {
    const { transport, executor } = setup(); transport.nodes = [ax(1, 'ordinary', role)];
    expect((await executor.read()).nodes[0]).toHaveProperty('value', 'private-value');
    transport.handler = method => method === 'DOM.describeNode' ? { node: { nodeName: 'DIV', attributes: [] } } : undefined;
    expect((await executor.read()).nodes[0]).not.toHaveProperty('value');
    transport.handler = method => method === 'DOM.describeNode' ? { node: { nodeName: 'INPUT', attributes: ['type', 'password'] } } : undefined;
    expect((await executor.read()).nodes[0]).not.toHaveProperty('value');
  });
  it.each([['type', 'password'], ['autocomplete', 'current-password'], ['autocomplete', 'section-login new-password']])('redacts textbox attributes %j', async (...attributes) => {
    const { transport, executor } = setup();
    transport.handler = method => method === 'DOM.describeNode' ? { node: { nodeName: 'INPUT', attributes } } : undefined;
    expect(Object.hasOwn((await executor.read()).nodes[0]!, 'value')).toBe(false);
  });
  it('redacts failed, malformed and over-budget descriptions; never makes more than 256 DOM checks', async () => {
    const { transport, executor } = setup(); transport.nodes = Array.from({ length: 258 }, (_, i) => ax(i + 1));
    transport.handler = (method, params) => {
      if (method === 'DOM.describeNode' && params.backendNodeId === 1) throw Error('node disappeared');
      if (method === 'DOM.describeNode' && params.backendNodeId === 2) return { node: { attributes: ['type'] } };
    };
    const result = await executor.read();
    expect(transport.calls.filter(call => call.method === 'DOM.describeNode')).toHaveLength(256);
    expect(Object.hasOwn(result.nodes[0]!, 'value')).toBe(false); expect(Object.hasOwn(result.nodes[1]!, 'value')).toBe(false);
    expect(result.nodes[255]).toHaveProperty('value'); expect(Object.hasOwn(result.nodes[256]!, 'value')).toBe(false);
  });
  it.each(['permission_denied', 'cancelled', 'deadline_exceeded'] as const)('does not swallow %s as DOM redaction', async code => {
    const { transport, executor } = setup(); transport.handler = method => { if (method === 'DOM.describeNode') throw new ProtocolError(code, 'stop'); };
    await expect(executor.read()).rejects.toMatchObject({ code });
  });
});

describe('I2c find and wait', () => {
  it('filters original AX before node/text truncation and invalidates old refs', async () => {
    const { executor, transport } = setup(); const old = await getRef(executor);
    transport.nodes = Array.from({ length: MAX_SNAPSHOT_NODES + 1 }, (_, i) => ax(i, i === MAX_SNAPSHOT_NODES ? 'chosen' : 'other', 'button'));
    const result = await executor.find({ role: 'button', name: 'chosen', exact: true });
    expect(result.nodes).toHaveLength(1); expect(result.nodes[0]?.name).toBe('chosen');
    await expect(executor.action({ kind: 'hover', ref: old })).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it('find searches names, not secret values, and honors limit', async () => {
    const { executor, transport } = setup(); transport.nodes = Array.from({ length: 21 }, (_, i) => ax(i, 'Field', 'button'));
    expect((await executor.find({ text: 'private-value' })).nodes).toHaveLength(0);
    const found = await executor.find({ text: 'field' }); expect(found.nodes).toHaveLength(20); expect(found.truncated).toBe(true);
  });
  it('URL wait crosses navigation but old refs stay invalid; load and element waits observe the current page', async () => {
    const { executor, transport } = setup(); const old = await getRef(executor);
    let first = true;
    transport.handler = method => { if (method === 'Page.getFrameTree' && first) { first = false; transport.url = 'https://fixture.invalid/new'; transport.event('Page.frameNavigated', { frame: { id: 'main', url: transport.url } }); } };
    await expect(executor.action({ kind: 'wait', condition: { kind: 'url', url: 'https://fixture.invalid/new' } })).resolves.toMatchObject({ observed: true });
    await expect(executor.action({ kind: 'hover', ref: old })).rejects.toMatchObject({ code: 'stale_ref' });
    await executor.action({ kind: 'wait', condition: { kind: 'load', state: 'load' } });
    await executor.action({ kind: 'wait', condition: { kind: 'element', query: { role: 'textbox' } } });
    expect(transport.calls.filter(call => call.method === 'Runtime.evaluate' && call.params.expression === 'document.readyState')[0]?.params.contextId).toBe(123);
  });
  it('unsatisfied wait times out without a side effect or command replay', async () => {
    const { executor, transport } = setup();
    await expect(executor.action({ kind: 'wait', condition: { kind: 'element', query: { text: 'missing' } } }, { deadline: Date.now() + 80 })).rejects.toMatchObject({ code: 'deadline_exceeded' });
    expect(transport.input()).toHaveLength(0);
  });
});

describe('I2c Z1 actions and S2 email', () => {
  it.each(['check', 'uncheck', 'hover', 'scrollIntoView'] as const)('%s uses a main-frame ref', async kind => {
    const { transport, executor } = setup(); transport.checked = kind === 'uncheck';
    await expect(executor.action({ kind, ref: await getRef(executor) })).resolves.toMatchObject({ observed: true });
    expect(transport.calls.find(call => call.method === 'DOM.resolveNode')?.params.executionContextId).toBe(123);
  });
  it('already checked is an observed no-op; select validates before fixed mutation', async () => {
    const { executor, transport } = setup(); transport.checked = true;
    await executor.action({ kind: 'check', ref: await getRef(executor) }); expect(transport.input()).toHaveLength(0);
    await executor.action({ kind: 'select', ref: await getRef(executor), by: 'value', values: ['x'] });
    expect(transport.calls.filter(call => call.params.functionDeclaration === SELECT_OPTIONS).map(call => call.params.arguments[2].value)).toEqual([false, true]);
  });
  it('scroll dispatches bounded CSS wheel deltas with and without ref', async () => {
    const { executor, transport } = setup();
    await executor.action({ kind: 'scroll', direction: 'left', amount: 99 });
    expect(transport.input()[0]?.params).toMatchObject({ type: 'mouseWheel', deltaX: -99, deltaY: 0, x: 400 });
    await executor.action({ kind: 'scroll', direction: 'down', ref: await getRef(executor) });
    expect(transport.input()[1]?.params).toMatchObject({ deltaY: 500, x: 20 });
  });
  it('a wheel receipt delivered after the CDP acknowledgement is still observed (passive listener)', async () => {
    const { executor, transport } = setup(); let reads = 0;
    transport.handler = (method, params) => method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('return this.read()')
      ? { result: { value: ++reads < 3 ? { seen: false, moved: false, position: '0:0,0', dx: 0, dy: 0, atEdge: false }
        : { seen: true, moved: true, position: '0:0,812', dx: 0, dy: 812, atEdge: true } } } : undefined;
    await expect(executor.action({ kind: 'scroll', direction: 'down', amount: 1500 }))
      .resolves.toMatchObject({ observed: true, scroll: { dx: 0, dy: 812, atEdge: true } });
    expect(reads).toBeGreaterThanOrEqual(6); // seen, then settled over consecutive unchanged reads
    const arm = transport.calls.find(call => call.params.functionDeclaration?.includes('let seen=false'));
    expect(arm?.params.arguments.map((a: Json) => a.value)).toEqual(['scroll', 400, 200, 'down']);
  });
  it('a scroll in the requested direction counts as evidence; nothing at all stays unknown', async () => {
    const { executor, transport } = setup();
    transport.handler = (method, params) => method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('return this.read()')
      ? { result: { value: { seen: false, moved: true, position: '1:0,300', dx: 0, dy: 300, atEdge: false } } } : undefined;
    await expect(executor.action({ kind: 'scroll', direction: 'down' })).resolves.toMatchObject({ scroll: { dy: 300, atEdge: false } });
    const quiet = setup();
    quiet.transport.handler = (method, params) => method === 'Runtime.callFunctionOn' && params.functionDeclaration.includes('return this.read()')
      ? { result: { value: { seen: false, moved: false, position: '0:0,0', dx: 0, dy: 0, atEdge: false } } } : undefined;
    const started = Date.now();
    await expect(quiet.executor.action({ kind: 'scroll', direction: 'down' }, { deadline: Date.now() + 500 })).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(Date.now() - started).toBeLessThan(500); // stops before the command deadline, not at it
  });
  it('a same-document navigation while the scroll settles does not lose the outcome', async () => {
    const { executor, transport } = setup(); let reads = 0;
    transport.handler = (method, params) => {
      if (method !== 'Runtime.callFunctionOn' || !params.functionDeclaration.includes('return this.read()')) return undefined;
      if (++reads === 1) transport.event('Page.navigatedWithinDocument', { frameId: 'main', url: 'https://fixture.invalid/#section-2' });
      return { result: { value: { seen: true, moved: true, position: '0:0,700', dx: 0, dy: 700, atEdge: false } } };
    };
    const before = (await executor.read()).pageGeneration;
    const result = await executor.action({ kind: 'scroll', direction: 'down' });
    expect(result).toMatchObject({ observed: true, scroll: { dy: 700 } });
    expect(result.pageGeneration).toBeGreaterThan(before);
  });
  it('ARM_MOTION reports the moved container delta and the requested edge', () => {
    const run = (direction: string, scrollTo: number, inner: boolean) => runInNewContext(`
      const root={nodeType:1,scrollLeft:0,scrollTop:${inner ? 0 : 100},scrollHeight:2000,clientHeight:400,scrollWidth:800,clientWidth:800,parentElement:null};
      const box={nodeType:1,scrollLeft:0,scrollTop:0,scrollHeight:900,clientHeight:300,scrollWidth:500,clientWidth:500,parentElement:root};
      const leaf={nodeType:1,scrollLeft:0,scrollTop:0,scrollHeight:10,clientHeight:10,scrollWidth:10,clientWidth:10,parentElement:box};
      const win={getComputedStyle:el=>({overflowY:el===box?'auto':'visible',overflowX:'visible'})};
      const doc={defaultView:win,scrollingElement:root,documentElement:root,elementFromPoint:()=>leaf,addEventListener(){},removeEventListener(){}};
      win.document=doc;
      const receipt=(${ARM_MOTION}).call(win,'scroll',400,200,direction);
      (${inner ? 'box' : 'root'}).scrollTop=${scrollTo};
      receipt.read();`, { direction });
    expect(run('down', 1600, false)).toMatchObject({ moved: true, dy: 1500, atEdge: true });
    expect(run('down', 600, true)).toMatchObject({ moved: true, dy: 600, atEdge: true });
    expect(run('down', 0, true)).toMatchObject({ moved: false, dy: 0, atEdge: false }); // box can still scroll
    expect(run('up', 100, false)).toMatchObject({ moved: false, atEdge: true }); // nothing moved: innermost scrollable box is at its top
    expect(run('up', 40, false)).toMatchObject({ moved: true, dy: -60, atEdge: false });
  });
  it.each(['back', 'forward', 'reload'] as const)('%s invalidates old refs and honors navigation policy', async kind => {
    const { executor, transport } = setup(); const ref = await getRef(executor);
    await executor.action({ kind });
    await expect(executor.action({ kind: 'hover', ref })).rejects.toMatchObject({ code: 'stale_ref' });
    expect(transport.calls.some(call => call.method === (kind === 'reload' ? 'Page.reload' : 'Page.navigateToHistoryEntry'))).toBe(true);
  });
  it('email selects with Ctrl+A before insertText; never invokes unsupported setSelectionRange', async () => {
    const { executor, transport } = setup(); transport.email = true;
    await executor.action({ kind: 'fill', ref: await getRef(executor), text: 'dummy@example.invalid' });
    expect(transport.input().map(call => call.params.type ?? call.method)).toEqual(['keyDown', 'keyUp', 'Input.insertText']);
    expect(transport.input()[0]?.params).toMatchObject({ modifiers: 2, code: 'KeyA' });
    expect(runInNewContext(`(${SELECT_VALUE}).call(node)`, { node: { isConnected: true, tagName: 'INPUT', type: 'email', ownerDocument: { get activeElement() { return this.node; }, node: undefined } } })).toMatchObject({ error: 'not_actionable' });
    const node: Json = { isConnected: true, tagName: 'INPUT', type: 'email', setSelectionRange() { throw Error('must not call'); } }; node.ownerDocument = { activeElement: node };
    expect(runInNewContext(`(${SELECT_VALUE}).call(node)`, { node })).toMatchObject({ keyboardSelect: true });
  });
  it('a non-email selection API failure is unknown, not a keyboard retry', async () => {
    const { executor, transport } = setup(); const ref = await getRef(executor);
    transport.handler = (method, params) => method === 'Runtime.callFunctionOn' && params.functionDeclaration === SELECT_VALUE ? { exceptionDetails: {} } : undefined;
    await expect(executor.action({ kind: 'fill', ref, text: 'x' })).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.input()).toHaveLength(0);
    expect(transport.calls.filter(call => call.method === 'Emulation.setFocusEmulationEnabled').map(call => call.params.enabled)).toEqual([true, false]);
  });
  it('fixed select uses native accessors, exact unambiguous options and verifies state after untrusted events', () => {
    const run = (by: string, values: string[], mode: string) => runInNewContext(`
      class HTMLOptionElement {
        constructor(value,label){this.v=value;this.l=label;this.s=false}
        get value(){return this.v} get label(){return this.l} get disabled(){return false}
        get selected(){return this.s} set selected(value){this.s=value} closest(){return null}
      }
      class HTMLSelectElement {
        get options(){return this.o} get multiple(){return true}
      }
      const selected=new HTMLSelectElement();selected.o=[new HTMLOptionElement('a','One'),new HTMLOptionElement('b',mode==='ambiguous'?'One':'Two')];
      selected.isConnected=true;selected.tagName='SELECT';selected.matches=()=>false;selected.closest=()=>null;
      selected.events=[];selected.dispatchEvent=e=>{selected.events.push(e.type);if(mode==='tamper')selected.o[0].s=false};
      // Own getters deliberately lie: executor must read the prototype accessors.
      Object.defineProperty(selected.o[0],'value',{get(){throw Error('own override')}});
      const result=(${SELECT_OPTIONS}).call(selected,by,values,true);
      ({result,events:selected.events});`, { by, values, mode, Event: class { constructor(public type: string) {} } });
    expect(run('label', ['One'], 'normal')).toMatchObject({ result: { values: ['a'], expected: ['a'] }, events: ['input', 'change'] });
    expect(run('label', ['One'], 'ambiguous')).toMatchObject({ result: { error: 'not_actionable' }, events: [] });
    expect(run('value', ['a'], 'tamper')).toMatchObject({ result: { values: [], expected: ['a'] } });
  });
  it.each(['hover','check','scrollIntoView','select'] as const)('%s lost mutation acknowledgement is unknown and cannot reuse ref', async kind => {
    const { executor, transport } = setup(); const ref = await getRef(executor);
    const action: BrowserAction = kind === 'select' ? { kind, ref, by: 'value', values: ['x'] } : { kind, ref };
    transport.handler = (method, params) => { if (method.startsWith('Input.') || method === 'Runtime.callFunctionOn' &&
      (params.functionDeclaration.includes('this.scrollIntoView') || params.functionDeclaration === SELECT_OPTIONS && params.arguments[2].value)) throw Error('lost ack'); };
    await expect(executor.action(action)).rejects.toMatchObject({ code: 'outcome_unknown' });
    await expect(executor.action(action)).rejects.toMatchObject({ code: 'stale_ref' });
  });
  it('visibility change after resolving a new action ref emits no Input', async () => {
    let visible = true; const { executor, transport } = setup({ ensureVisible() { if (!visible) throw new ProtocolError('target_hidden', 'hidden'); } });
    const ref = await getRef(executor); transport.handler = method => { if (method === 'DOM.resolveNode') visible = false; };
    await expect(executor.action({ kind: 'hover', ref })).rejects.toMatchObject({ code: 'target_hidden' }); expect(transport.input()).toHaveLength(0);
  });
});

describe('I2c one-shot dialog policy and screenshot metadata', () => {
  it('policy is consumed once and defaults to dismiss after use/expiry/navigation/stop', async () => {
    let now = Date.now(); const { executor, transport } = setup({ now: () => now });
    await executor.action({ kind: 'dialog', response: 'accept', promptText: 'dummy' });
    transport.event('Page.javascriptDialogOpening'); await turns(); transport.event('Page.javascriptDialogOpening'); await turns();
    expect(transport.calls.filter(call => call.method === 'Page.handleJavaScriptDialog').map(call => call.params.accept)).toEqual([true, false]);
    await executor.action({ kind: 'dialog', response: 'accept' }); now += 5001;
    transport.event('Page.javascriptDialogOpening'); await turns();
    await executor.action({ kind: 'dialog', response: 'accept' }); transport.event('DOM.documentUpdated');
    transport.event('Page.javascriptDialogOpening'); await turns();
    await executor.action({ kind: 'dialog', response: 'accept' }); executor.stop();
    transport.event('Page.javascriptDialogOpening'); await turns();
    expect(transport.calls.filter(call => call.method === 'Page.handleJavaScriptDialog').slice(2).every(call => call.params.accept === false)).toBe(true);
  });
  it('revoked permission cannot apply an armed dialog accept', async () => {
    let granted = true; const { executor, transport } = setup({ authorize() { if (!granted) throw new ProtocolError('permission_denied', 'revoked'); } });
    await executor.action({ kind: 'dialog', response: 'accept' }); granted = false;
    transport.event('Page.javascriptDialogOpening'); await turns();
    expect(transport.calls.find(call => call.method === 'Page.handleJavaScriptDialog')?.params).toEqual({ accept: false });
  });
  it('rechecks permission after dialog visibility guard, without requiring host stop/dispose', async () => {
    let granted = true; let revokeOnVisibility = false;
    const { executor, transport } = setup({
      authorize() { if (!granted) throw new ProtocolError('permission_denied', 'revoked while checking visibility'); },
      ensureVisible() { if (revokeOnVisibility) granted = false; },
    });
    await executor.action({ kind: 'dialog', response: 'accept', promptText: 'dummy' }); revokeOnVisibility = true;
    transport.event('Page.javascriptDialogOpening'); await turns();
    expect(transport.calls.filter(call => call.method === 'Page.handleJavaScriptDialog').map(call => call.params)).toEqual([{ accept: false }]);
  });
  it('element screenshot is viewport-clipped with separate image scaling and document offset', async () => {
    const { executor, transport } = setup(); const result = await executor.screenshot({ ref: await getRef(executor) });
    expect(result).toMatchObject({ viewport: { width: 800, height: 400 }, captureRect: { x: 10, y: 20, width: 80, height: 40 }, imageScale: { x: 2, y: 2 } });
    expect(transport.calls.find(call => call.method === 'Page.captureScreenshot')?.params.clip).toEqual({ x: 22, y: 54, width: 80, height: 40, scale: 1 });
  });
  it('explicit JPEG is single attempt; malformed images never yield invented scale', async () => {
    const { executor, transport } = setup(); transport.handler = method => method === 'Page.captureScreenshot' ? { data: 'AAAA' } : undefined;
    await expect(executor.screenshot({ format: 'jpeg', quality: 75 })).rejects.toMatchObject({ code: 'transport_error' });
    expect(transport.calls.filter(call => call.method === 'Page.captureScreenshot')).toHaveLength(1);
    expect(() => imageDimensions('AAAA', 'png')).toThrow(); expect(imageDimensions(png(7, 9), 'png')).toEqual({ width: 7, height: 9 });
  });
  it('explicit JPEG accepts protocol quality zero and derives dimensions from its header', async () => {
    const { executor, transport } = setup();
    // Header-only deterministic parser fixture, not a decodable rendered image.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 20, 0, 40, 1, 1, 0x11, 0, 0xff, 0xd9]).toString('base64');
    transport.handler = method => method === 'Page.captureScreenshot' ? { data: jpeg } : undefined;
    await expect(executor.screenshot({ format: 'jpeg', quality: 0 })).resolves.toMatchObject({ mimeType: 'image/jpeg', imageScale: { x: 0.05, y: 0.05 } });
    expect(transport.calls.filter(call => call.method === 'Page.captureScreenshot').map(call => call.params.quality)).toEqual([0]);
  });
});
