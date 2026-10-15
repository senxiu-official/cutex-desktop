import { createContext, runInContext } from 'node:vm';
import type { Context } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { BrowserCdpExecutor } from '../src/index.js';
import type { CdpTransport } from '../src/index.js';

// Deterministic separate-JS-realm model, not a browser/DOM-isolation acceptance
// claim. Both wrappers see shared DOM state but have distinct builtins/expandos.
// It executes the real fixed function source, rather than classifying strings.
const BOOTSTRAP = `
  globalThis.window = globalThis;
  globalThis.innerWidth = 800; globalThis.innerHeight = 600;
  const listeners = new Map();
  globalThis.document = {
    defaultView: globalThis, activeElement: null,
    elementFromPoint() { return __dom.occluded ? {} : target; },
    addEventListener(type, listener) { let set=listeners.get(type); if(!set) listeners.set(type,set=new Set()); set.add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  globalThis.getComputedStyle = () => ({visibility:'visible',display:'block',opacity:'1'});
  globalThis.target = {
    ownerDocument: document, nodeType: 1, tagName: 'INPUT', type: 'text', readOnly: false,
    get isConnected() { return __dom.connected; },
    get value() { return __dom.value; },
    matches() { return false; }, closest() { return null; }, getAttribute() { return null; },
    getBoundingClientRect() { return {left:10,top:10,right:110,bottom:40,width:100,height:30}; },
    getClientRects() { return [this.getBoundingClientRect()]; },
    contains(node) { return node === this; },
    setSelectionRange(start,end) { __dom.selection=[start,end]; }
  };
  globalThis.deliver = (type,key,trusted) => {
    for(const listener of listeners.get(type) ?? []) listener({isTrusted:trusted,target,key});
  };
  globalThis.listenerCount = () => [...listeners.values()].reduce((n,set)=>n+set.size,0);
`;

class RealmTransport implements CdpTransport {
  readonly dom = { connected: true, occluded: false, value: 'before', selection: [] as number[] };
  readonly main = this.realm();
  readonly contexts = new Map<number, Context>();
  readonly objects = new Map<string, { contextId: number; value: unknown }>();
  readonly executed: { contextId: number; functionDeclaration: string }[] = [];
  deliverInput = true;
  trusted = true;
  inputCount = 0;
  private objectSequence = 0;
  private realm(): Context {
    const realm = createContext({ __dom: this.dom });
    runInContext(BOOTSTRAP, realm);
    return realm;
  }
  private keep(contextId: number, value: unknown) {
    const objectId = `remote-${++this.objectSequence}`;
    this.objects.set(objectId, { contextId, value }); return { objectId };
  }
  async send(method: string, params: Record<string, any> = {}): Promise<unknown> {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: 'https://fixture.invalid/' } } };
    if (method === 'Accessibility.getFullAXTree') return { nodes: [{ backendDOMNodeId: 2, role: { value: 'textbox' }, name: { value: 'field' } }] };
    if (method === 'Page.createIsolatedWorld') {
      expect(params.frameId).toBe('main'); expect(params.grantUniveralAccess).toBe(false);
      this.contexts.set(51, this.realm()); return { executionContextId: 51 };
    }
    if (method === 'DOM.resolveNode') {
      const id = params.executionContextId ?? 0;
      const realm = id === 0 ? this.main : this.contexts.get(id)!;
      return { object: this.keep(id, runInContext('target', realm)) };
    }
    if (method === 'Runtime.evaluate') {
      const id = params.contextId ?? 0;
      return { result: this.keep(id, runInContext(params.expression, id === 0 ? this.main : this.contexts.get(id)!)) };
    }
    if (method === 'Runtime.callFunctionOn') {
      const receiver = this.objects.get(params.objectId)!;
      const realm = receiver.contextId === 0 ? this.main : this.contexts.get(receiver.contextId)!;
      realm.__receiver = receiver.value;
      realm.__args = (params.arguments ?? []).map((arg: Record<string, unknown>) => arg.objectId ? this.objects.get(arg.objectId as string)!.value : arg.value);
      this.executed.push({ contextId: receiver.contextId, functionDeclaration: params.functionDeclaration });
      try {
        const value = runInContext(`(${params.functionDeclaration}).apply(__receiver,__args)`, realm);
        return { result: params.returnByValue || value === null || (typeof value !== 'object' && typeof value !== 'function')
          ? { value } : this.keep(receiver.contextId, value) };
      } catch { return { exceptionDetails: { text: 'Realm function threw' } }; }
    }
    if (method === 'DOM.focus') for (const realm of this.contexts.values()) runInContext('document.activeElement=target', realm);
    if (method.startsWith('Input.')) {
      this.inputCount++;
      if (this.deliverInput) {
        if (method === 'Input.insertText') this.dom.value = params.text;
        if (method === 'Input.dispatchKeyEvent' && params.type === 'keyDown' && params.key === 'Backspace') this.dom.value = '';
        const type = method === 'Input.insertText' ? 'input' : params.type === 'mouseReleased' ? 'click' : params.type === 'keyDown' ? 'keydown' : null;
        if (type) for (const realm of this.contexts.values()) {
          realm.__eventType = type; realm.__key = params.key; realm.__trusted = this.trusted;
          runInContext('deliver(__eventType,__key,__trusted)', realm);
        }
      }
    }
    if (method === 'Runtime.releaseObject') this.objects.delete(params.objectId);
    return {};
  }
  onEvent() { return () => {}; }
  onDetach() { return () => {}; }
}
function setup() {
  const transport = new RealmTransport(); let generation = 0;
  const executor = new BrowserCdpExecutor(transport, { nextPageGeneration: () => ++generation,
    authorize: () => {}, ensureVisible: () => {}, allowUrl: () => true });
  return { transport, executor };
}

describe('fixed checks and receipts use isolated objects, not main-world monkeypatches', () => {
  it('real fixed fill/focus/selection/receipt functions ignore poisoned main builtins and wrappers', async () => {
    const { transport, executor } = setup();
    runInContext(`
      getComputedStyle = () => { throw Error('page override'); };
      target.getBoundingClientRect = () => { throw Error('page override'); };
      target.setSelectionRange = () => { throw Error('page override'); };
      document.addEventListener = () => { throw Error('page override'); };
      Object.defineProperty(document,'activeElement',{get(){throw Error('page override')}});
      Math.min = () => { throw Error('page override'); };
    `, transport.main);
    const ref = (await executor.read()).nodes[0]!.ref;
    await expect(executor.act(ref, 'fill', 'verified')).resolves.toMatchObject({ status: 'dispatched', observed: true });
    expect(transport.dom.value).toBe('verified'); expect(transport.dom.selection).toEqual([0, 6]);
    expect(transport.executed.length).toBeGreaterThan(5);
    expect(transport.executed.every(call => call.contextId === 51)).toBe(true);
    expect(runInContext('listenerCount()', transport.contexts.get(51)!)).toBe(0);
    expect(transport.objects.size).toBe(0);
  });
  it('main-world forged hit testing cannot make an actually occluded node actionable', async () => {
    const { transport, executor } = setup();
    transport.dom.occluded = true;
    runInContext('document.elementFromPoint=()=>target', transport.main);
    await expect(executor.act((await executor.read()).nodes[0]!.ref, 'click')).rejects.toMatchObject({ code: 'not_actionable' });
    expect(transport.inputCount).toBe(0);
  });
  it('main-world forged event listener/value cannot manufacture an isolated receipt', async () => {
    const { transport, executor } = setup();
    transport.deliverInput = false;
    runInContext(`document.addEventListener=(type,listener)=>listener({isTrusted:true,target});
      Object.defineProperty(target,'value',{get:()=> 'forged'});`, transport.main);
    await expect(executor.act((await executor.read()).nodes[0]!.ref, 'fill', 'forged')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.dom.value).toBe('before'); expect(transport.inputCount).toBe(1);
    expect(transport.executed.every(call => call.contextId === 51)).toBe(true);
  });
  it('synthetic untrusted events in the shared document remain insufficient', async () => {
    const { transport, executor } = setup(); transport.trusted = false;
    await expect(executor.act((await executor.read()).nodes[0]!.ref, 'click')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(transport.inputCount).toBe(2);
  });
});
