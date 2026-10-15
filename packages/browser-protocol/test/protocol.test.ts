import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import fixtures from '../fixtures/messages.json';
import {
  MAX_MESSAGE_BYTES, MAX_SCREENSHOT_BASE64_LENGTH, ProtocolError, acceptHello, assertBoundTarget,
  browserMessageSchema, decodeBrowserMessage, encodeBrowserMessage, hasSideEffects, isBrowserUrl,
  isSameConnection, isTerminalRequestState, parseBrowserHello, parseBrowserMessage,
  parseBrowserOperation, parseBrowserRequest, transitionRequest, validateSchema,
} from '../src';
import type { BrowserHello, BrowserMessage, BrowserOperation, BrowserResult, BrowserTabRequest } from '../src';

const request: BrowserTabRequest = {
  protocolVersion: 1, type: 'request', requestId: 'r1', hostId: 'host-1', deviceId: 'device-1',
  cutexSessionId: 'session-1', turnId: 'turn-1', providerId: 'inApp', connectionGeneration: 1,
  guestId: 'guest-1', leaseId: 'lease-1', pageGeneration: 1, deadline: '2026-10-10T12:00:00.000Z', operation: { kind: 'tab.snapshot' },
};
const hello: BrowserHello = { protocolVersion: 1, type: 'hello', hostId: 'host-1', deviceId: 'device-1',
  providerId: 'inApp', connectionGeneration: 1, instanceId: 'desktop-lab', endpoint: 'lab-private' };
const result = (body: Extract<BrowserResult, { status: 'succeeded' }>['result']): BrowserResult => ({
  protocolVersion: 1, type: 'result', requestId: 'r1', hostId: 'host-1', deviceId: 'device-1',
  providerId: 'inApp', connectionGeneration: 1, status: 'succeeded', result: body,
});
const expectCode = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error('Expected protocol error'); }
  catch (error) { expect(error).toBeInstanceOf(ProtocolError); expect((error as ProtocolError).code).toBe(code); }
};

describe('wire shapes and schema parity', () => {
  it('checked-in JSON schema exactly matches the runtime schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../schema/browser-v1.schema.json', import.meta.url), 'utf8'));
    expect(schema).toEqual(browserMessageSchema);
    for (const fixture of fixtures) expect(validateSchema(fixture, schema)).toBeUndefined();
  });
  it.each(fixtures.map((fixture, index) => [index, fixture] as const))('round trips fixture %s', (_index, fixture) => {
    const message = parseBrowserMessage(fixture);
    expect(decodeBrowserMessage(encodeBrowserMessage(message))).toEqual(fixture);
  });
  const operations = [
    { kind: 'tab.snapshot' }, { kind: 'tab.act', action: { kind: 'click', ref: 'p1.s1.n1' } },
    { kind: 'tab.act', action: { kind: 'fill', ref: 'p1.s1.n1', text: '中文\nline 2' } },
    { kind: 'tab.act', action: { kind: 'press', ref: 'p1.s1.n1', key: 'Control+a' } },
    { kind: 'tab.navigate', url: 'http://fixture.svc.localhost:12345/' },
    { kind: 'tab.screenshot' }, { kind: 'tab.screenshot', format: 'png' },
    { kind: 'tab.screenshot', format: 'jpeg', quality: 85 }, { kind: 'tab.release' },
    { kind: 'tabs.list' }, { kind: 'tabs.open', url: 'about:blank' }, { kind: 'tabs.claim' },
  ] satisfies BrowserOperation[];
  it.each(operations)('accepts $kind operation', operation => expect(parseBrowserOperation(operation)).toEqual(operation));
  it('type and schema agree on target and registry discriminants', () => {
    expectTypeOf<ReturnType<typeof parseBrowserOperation>>().toEqualTypeOf<BrowserOperation>();
  });
  it('list/open omit guest/lease and owner-origin claim only identifies the selected tab', () => {
    const { guestId: _guest, leaseId: _lease, pageGeneration: _page, ...context } = request;
    for (const operation of [{ kind: 'tabs.list' }, { kind: 'tabs.open', url: 'about:blank' }]) expect(parseBrowserRequest({ ...context, operation })).toBeDefined();
    expect(parseBrowserRequest({ ...context, guestId: 'g1', operation: { kind: 'tabs.claim' } })).toBeDefined();
    expectCode(() => parseBrowserRequest({ ...request, operation: { kind: 'tabs.list' } }), 'invalid_request');
  });
  it.each([
    { kind: 'tab.snapshot', code: 'eval(1)' }, { kind: 'tab.eval', code: '1' },
    { kind: 'tab.screenshot', quality: 90 }, { kind: 'tab.screenshot', format: 'png', quality: 90 },
    { kind: 'tab.screenshot', format: 'jpeg', quality: 101 },
    { kind: 'tab.act', action: { kind: 'click', ref: 'r', selector: '#secret' } },
    { kind: 'tab.act', action: { kind: 'press', ref: 'r', key: '\n' } },
    { kind: 'tab.act', action: { kind: 'fill', ref: 'r', text: 'x'.repeat(65537) } },
  ])('rejects malformed operation %s', operation => expectCode(() => parseBrowserOperation(operation), 'invalid_request'));
  it.each(['guestId', 'leaseId', 'pageGeneration', 'hostId', 'deviceId', 'cutexSessionId', 'deadline', 'requestId'])('requires %s', key => {
    const value = { ...request } as Record<string, unknown>; delete value[key];
    expectCode(() => parseBrowserRequest(value), 'invalid_request');
  });
  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects non-generation %s', value => {
    expectCode(() => parseBrowserRequest({ ...request, connectionGeneration: value }), 'invalid_request');
    expectCode(() => parseBrowserRequest({ ...request, pageGeneration: value }), 'invalid_request');
  });
  it.each(['', 'a'.repeat(257), '../guest', ' 123', 'guest\n', 123])('rejects malformed guest handle %s', guestId => {
    expectCode(() => parseBrowserRequest({ ...request, guestId }), 'invalid_request');
  });
  it.each(['2026-02-30T00:00:00.000Z', '2026-10-10T12:00:00Z', '2026-10-10T12:00:00.000+00:00', 'tomorrow', 1791633600000])('requires real canonical timestamp %s', deadline => {
    expectCode(() => parseBrowserRequest({ ...request, deadline }), 'invalid_request');
  });
  it('rejects prototype fields, accessors, symbols and unexpected data without calling getters', () => {
    let called = false;
    const value = { ...request }; Object.defineProperty(value, 'hostId', { enumerable: true, get() { called = true; return 'host-1'; } });
    expectCode(() => parseBrowserRequest(value), 'invalid_request'); expect(called).toBe(false);
    expectCode(() => parseBrowserRequest({ ...request, [Symbol('secret')]: 1 }), 'invalid_request');
    expectCode(() => parseBrowserRequest(Object.assign(Object.create({ inherited: true }), request)), 'invalid_request');
    expectCode(() => parseBrowserRequest(JSON.parse(JSON.stringify(request).replace('"requestId":', '"__proto__":{},"requestId":'))), 'invalid_request');
  });
});

describe('navigation is a scheme boundary, not origin authorization', () => {
  it.each(['about:blank', 'https://example.test/path?q=1#x', 'http://127.0.0.1:4567', 'http://[::1]:1234', 'http://fixture.svc.localhost:4567/'])('allows %s', url => expect(isBrowserUrl(url)).toBe(true));
  it.each(['file:///a', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'devtools://x', 'about:srcdoc', 'https:example.test', 'https://u:p@example.test', 'https://x\\@example.test', 'https://', ' https://example.test', 'https://example.test\n'])('denies %s', url => {
    expect(isBrowserUrl(url)).toBe(false);
    expectCode(() => parseBrowserOperation({ kind: 'tab.navigate', url }), 'invalid_request');
  });
});

describe('bounded UTF-8 codec and results', () => {
  it('measures bytes, not JS string length, at exact boundary', () => {
    const message: BrowserTabRequest = { ...request, operation: { kind: 'tab.act', action: { kind: 'fill', ref: 'r', text: '你好🌏' } } };
    const encoded = encodeBrowserMessage(message);
    expect(decodeBrowserMessage(encoded, encoded.length)).toEqual(message);
    expectCode(() => encodeBrowserMessage(message, encoded.length - 1), 'message_too_large');
    expectCode(() => decodeBrowserMessage(encoded, encoded.length - 1), 'message_too_large');
  });
  it.each([new Uint8Array([0xff]), new TextEncoder().encode('{'), new TextEncoder().encode('null'), new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])])('rejects invalid UTF-8/JSON/body', bytes => expectCode(() => decodeBrowserMessage(bytes), 'invalid_request'));
  it('rejects oversized bytes before parsing', () => expectCode(() => decodeBrowserMessage(new Uint8Array(MAX_MESSAGE_BYTES + 1)), 'message_too_large'));
  it.each([0, -1, NaN, 1.5, MAX_MESSAGE_BYTES + 1])('rejects invalid codec limit %s', limit => expectCode(() => encodeBrowserMessage(hello, limit), 'invalid_request'));
  it('rejects unknown versions distinctly', () => expectCode(() => parseBrowserMessage({ ...hello, protocolVersion: 2 }), 'version_mismatch'));
  it('validates success and screenshot transport payload without relying on a URL artifact', () => {
    const message = result({ kind: 'tab.screenshot', pageGeneration: 1, mimeType: 'image/png', width: 640, height: 480, data: 'aGVsbG8=' });
    expect(decodeBrowserMessage(encodeBrowserMessage(message))).toEqual(message);
    expectCode(() => parseBrowserMessage(result({ kind: 'tab.screenshot', pageGeneration: 1, mimeType: 'image/png', width: 0, height: 480, data: 'broken!' })), 'invalid_request');
  });
  it('can validate the full screenshot limit without regexp stack overflow', () => {
    const data = 'A'.repeat(MAX_SCREENSHOT_BASE64_LENGTH);
    expect(encodeBrowserMessage(result({ kind: 'tab.screenshot', pageGeneration: 1, mimeType: 'image/png', width: 1, height: 1, data })).byteLength).toBeLessThan(MAX_MESSAGE_BYTES);
  });
  it('does not allow array accessors, holes, extras or raw browser node IDs', () => {
    const nodes: unknown[] = []; nodes.length = 1; Object.defineProperty(nodes, 'extra', { enumerable: true, value: 1 });
    const value = { kind: 'tab.snapshot', pageGeneration: 1, snapshotId: 1, url: 'about:blank', nodes, truncated: false };
    expectCode(() => parseBrowserMessage(result(value as never)), 'invalid_request');
    expectCode(() => parseBrowserMessage(result({ ...value, nodes: [{ ref: 'r', name: 'x', role: 'button', backendDOMNodeId: 1 }] } as never)), 'invalid_request');
  });
  it('does not let error status lie about an unknown outcome', () => {
    const base = { ...hello, type: 'result', requestId: 'r', status: 'outcome_unknown', error: { code: 'deadline_exceeded', message: 'unknown' } };
    delete (base as Partial<typeof hello>).instanceId; delete (base as Partial<typeof hello>).endpoint;
    expectCode(() => parseBrowserMessage(base), 'invalid_request');
  });
});

describe('bound identity and handshake', () => {
  it('returns bounded capabilities only after matching paired endpoint', () => expect(acceptHello(hello, hello)).toMatchObject({ type: 'hello.ack', maxMessageBytes: MAX_MESSAGE_BYTES }));
  it.each(['hostId', 'deviceId', 'providerId', 'instanceId', 'endpoint'])('rejects handshake mismatch %s', key => expectCode(() => acceptHello(hello, { ...hello, [key]: 'other' }), 'permission_denied'));
  it('rejects stale generations and extension origin impersonation', () => {
    expectCode(() => acceptHello(hello, { ...hello, connectionGeneration: 2 }), 'stale_connection');
    const extension: BrowserHello = { ...hello, providerId: 'extension', extensionOrigin: `chrome-extension://${'a'.repeat(32)}/` };
    expectCode(() => acceptHello(extension, { ...extension, extensionOrigin: `chrome-extension://${'b'.repeat(32)}/` }), 'permission_denied');
    expect(acceptHello(extension, extension).providerId).toBe('extension');
    expectCode(() => parseBrowserHello({ ...hello, extensionOrigin: extension.extensionOrigin }), 'invalid_request');
  });
  it('binds full target, session, connection and page generation', () => {
    const now = Date.parse(request.deadline) - 1;
    expect(assertBoundTarget(request, request, now)).toBeUndefined();
    for (const key of ['hostId', 'deviceId', 'providerId', 'cutexSessionId', 'guestId', 'leaseId']) expectCode(() => assertBoundTarget(request, { ...request, [key]: 'other' }, now), 'permission_denied');
    expectCode(() => assertBoundTarget(request, { ...request, pageGeneration: 2 }, now), 'stale_ref');
    expectCode(() => assertBoundTarget(request, { ...request, connectionGeneration: 2 }, now), 'stale_connection');
    expectCode(() => assertBoundTarget(request, request, now + 1), 'deadline_exceeded');
    expect(isSameConnection(hello, { ...hello, hostId: 'other' })).toBe(false);
  });
});

describe('request lifecycle and no replay', () => {
  it('moves through accepted/dispatched/running to a terminal result', () => {
    const op: BrowserOperation = { kind: 'tab.snapshot' };
    expect(transitionRequest('accepted', 'dispatch', op)).toBe('dispatched');
    expect(transitionRequest('dispatched', 'start', op)).toBe('running');
    expect(transitionRequest('running', 'succeed', op)).toBe('succeeded');
    expectCode(() => transitionRequest('succeeded', 'dispatch', op), 'invalid_request');
    expectCode(() => transitionRequest('accepted', 'succeed', op), 'invalid_request');
  });
  it.each(['tab.act', 'tab.navigate', 'tabs.open', 'tabs.claim', 'tab.release'] as const)('conservatively treats dispatched %s as irreversible', kind => {
    const operation = { kind } as BrowserOperation;
    expect(hasSideEffects(operation)).toBe(true);
    for (const event of ['disconnect', 'deadline', 'cancel'] as const) expect(transitionRequest('dispatched', event, operation)).toBe('outcome_unknown');
    expect(transitionRequest('accepted', 'cancel', operation)).toBe('cancelled');
  });
  it.each(['tabs.list', 'tab.snapshot', 'tab.screenshot'] as const)('reads %s fail without falsely implying a write', kind => {
    const operation = { kind } as BrowserOperation;
    expect(hasSideEffects(operation)).toBe(false);
    expect(transitionRequest('running', 'disconnect', operation)).toBe('failed');
    expect(transitionRequest('running', 'cancel', operation)).toBe('cancelled');
  });
  it.each(['succeeded', 'failed', 'cancelled', 'outcome_unknown'] as const)('keeps %s terminal', state => expect(isTerminalRequestState(state)).toBe(true));
});

// These are checked by tsc in addition to the runtime fixture tests.
const typedMessage: BrowserMessage = request;
void typedMessage;
// @ts-expect-error PNG quality is not part of v1.
const badScreenshot: BrowserOperation = { kind: 'tab.screenshot', format: 'png', quality: 90 };
void badScreenshot;
// @ts-expect-error No arbitrary script execution operation.
const badEval: BrowserOperation = { kind: 'tab.eval', code: '1' };
void badEval;
