import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DEFAULT_FIND_LIMIT, DEFAULT_SCROLL_AMOUNT, MAX_DIALOG_POLICY_MS, MAX_DIALOG_TEXT_CODE_POINTS,
  MAX_FIND_RESULTS, MAX_FIND_TEXT_CODE_POINTS, MAX_MESSAGE_BYTES, MAX_MODEL_SCREENSHOT_DIMENSION,
  MAX_MODEL_SNAPSHOT_BYTES, MAX_ROLE_CODE_POINTS, MAX_SCREENSHOT_BASE64_LENGTH, MAX_SCROLL_AMOUNT,
  MAX_SELECT_TEXT_CODE_POINTS, MAX_SELECT_VALUES, MAX_SNAPSHOT_BYTES, ProtocolError,
  assertBoundTarget, decodeBrowserMessage, encodeBrowserMessage, hasSideEffects, parseBrowserAction,
  parseBrowserFindQuery, parseBrowserMessage, parseBrowserOperation, parseBrowserOperationResult, parseBrowserScreenshotMetadata,
  transitionRequest, validateSchema,
} from '../src';
import type { BrowserAction, BrowserFindQuery, BrowserOperation, BrowserOperationResult,
  BrowserResult, BrowserScreenshotMetadata, BrowserScreenshotResult, BrowserTabRequest } from '../src';

const actions = [
  { kind: 'click', ref: 'r' }, { kind: 'fill', ref: 'r', text: 'email@example.test' },
  { kind: 'press', ref: 'r', key: 'Enter' },
  { kind: 'scroll', direction: 'down' }, { kind: 'scroll', direction: 'left', amount: MAX_SCROLL_AMOUNT, ref: 'r' },
  { kind: 'scrollIntoView', ref: 'r' },
  { kind: 'select', ref: 'r', by: 'value', values: ['', 'two'] },
  { kind: 'select', ref: 'r', by: 'label', values: ['第三项'] },
  { kind: 'check', ref: 'r' }, { kind: 'uncheck', ref: 'r' }, { kind: 'hover', ref: 'r' },
  { kind: 'wait', condition: { kind: 'url', url: 'https://example.test/done' } },
  { kind: 'wait', condition: { kind: 'load', state: 'domcontentloaded' } },
  { kind: 'wait', condition: { kind: 'load', state: 'load' } },
  { kind: 'wait', condition: { kind: 'element', query: { role: 'button', name: 'Save', exact: true } } },
  { kind: 'wait', condition: { kind: 'element', query: { text: '已完成', limit: 1 } } },
  { kind: 'back' }, { kind: 'forward' }, { kind: 'reload' },
  { kind: 'dialog', response: 'accept', promptText: 'Test fixture input' },
  { kind: 'dialog', response: 'accept' }, { kind: 'dialog', response: 'dismiss' },
] satisfies BrowserAction[];
const route = { protocolVersion: 1 as const, hostId: 'host', deviceId: 'device', providerId: 'inApp' as const, connectionGeneration: 1 };
const request: BrowserTabRequest = { ...route, type: 'request', requestId: 'r1', cutexSessionId: 'session',
  guestId: 'guest', leaseId: 'lease', pageGeneration: 1, deadline: '2026-10-11T12:00:00.000Z', operation: { kind: 'tab.snapshot' } };
const success = (result: unknown) => ({ ...route, type: 'result', requestId: 'r1', status: 'succeeded', result });
const metadata: BrowserScreenshotMetadata = {
  viewport: { width: 1280, height: 720 }, captureRect: { x: 10.5, y: 20.25, width: 320, height: 180 },
  imageScale: { x: 1.5, y: 1.5 }, displayScale: 0.4,
};
const screenshot = { kind: 'tab.screenshot' as const, pageGeneration: 1, mimeType: 'image/png' as const,
  data: 'aGVsbG8=', width: 480, height: 270 };
const find = { kind: 'tab.find' as const, pageGeneration: 1, snapshotId: 2, url: 'about:blank',
  nodes: [{ ref: 'node', role: 'button', name: 'Save' }], truncated: false };
function invalid(action: () => unknown): void {
  try { action(); throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(ProtocolError); expect((error as ProtocolError).code).toBe('invalid_request'); }
}

describe('I2c action shapes remain strict and dependency-free', () => {
  it.each(actions)('accepts $kind and round trips its bound request', action => {
    expect(parseBrowserAction(action)).toEqual(action);
    const operation = { kind: 'tab.act' as const, action };
    expect(parseBrowserOperation(operation)).toEqual(operation);
    const message = { ...request, operation };
    expect(decodeBrowserMessage(encodeBrowserMessage(message))).toEqual(message);
  });
  it.each([
    { kind: 'scroll', direction: 'diagonal' }, { kind: 'scroll', direction: 'down', x: 100, y: 200 },
    { kind: 'scroll', direction: 'down', ref: '../node' }, { kind: 'scrollIntoView' },
    { kind: 'scrollIntoView', ref: 'r', selector: '#element' },
    { kind: 'select', ref: 'r', by: 'index', values: ['0'] },
    { kind: 'select', ref: 'r', by: 'label', values: ['a', 'a'] },
    { kind: 'select', ref: 'r', by: 'value', values: [] },
    { kind: 'select', ref: 'r', by: 'value', values: [1] },
    { kind: 'check', ref: 'r', checked: true }, { kind: 'uncheck', ref: 'r', force: true },
    { kind: 'hover', ref: 'r', x: 0 },
    { kind: 'wait', milliseconds: 1000 }, { kind: 'wait', condition: { kind: 'url', url: 'file:///tmp/test' } },
    { kind: 'wait', condition: { kind: 'url', url: 'https://example.test/', regexp: '.*' } },
    { kind: 'wait', condition: { kind: 'load', state: 'networkidle' } },
    { kind: 'wait', condition: { kind: 'element', ref: 'old-ref' } },
    { kind: 'wait', condition: { kind: 'element', query: { selector: '#element' } } },
    { kind: 'back', count: 2 }, { kind: 'forward', url: 'https://example.test/' }, { kind: 'reload', ignoreCache: true },
    { kind: 'dialog', response: 'dismiss', promptText: '' },
    { kind: 'dialog', response: 'accept', ttlMs: 999999 }, { kind: 'dialog', response: 'accept', pageGeneration: 2 },
    { kind: 'dialog', response: 'accept', leaseId: 'other' }, { kind: 'dialog', response: 'accept', persistent: true },
    { kind: 'evaluate', script: '1' }, { kind: 'rawCDP', method: 'Input.dispatchMouseEvent' },
    { kind: 'click_at', x: 1, y: 2 }, { kind: 'upload', ref: 'r', path: 'secret.txt' },
  ])('rejects unsupported or over-authoritative action %j', action => invalid(() => parseBrowserAction(action)));
  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, MAX_SCROLL_AMOUNT + 1, '500', null])('rejects scroll amount %s', amount => {
    invalid(() => parseBrowserAction({ kind: 'scroll', direction: 'down', amount }));
  });
  it('accepts exact select count/text boundaries including Unicode and an empty value', () => {
    const action = { kind: 'select', ref: 'r', by: 'value', values: Array.from({ length: MAX_SELECT_VALUES }, (_, i) => String(i)) };
    expect(parseBrowserAction(action)).toBeDefined();
    invalid(() => parseBrowserAction({ ...action, values: [...action.values, 'extra'] }));
    expect(parseBrowserAction({ ...action, values: ['🌏'.repeat(MAX_SELECT_TEXT_CODE_POINTS)] })).toBeDefined();
    invalid(() => parseBrowserAction({ ...action, values: ['🌏'.repeat(MAX_SELECT_TEXT_CODE_POINTS + 1)] }));
    expect(parseBrowserAction({ ...action, values: [''] })).toBeDefined();
  });
  it('bounds prompt text independently and does not expose the dialog policy lifetime', () => {
    const action = { kind: 'dialog', response: 'accept', promptText: '🌏'.repeat(MAX_DIALOG_TEXT_CODE_POINTS) };
    expect(parseBrowserAction(action)).toBeDefined();
    invalid(() => parseBrowserAction({ ...action, promptText: action.promptText + '🌏' }));
    expect(MAX_DIALOG_POLICY_MS).toBe(5000);
  });
  it('never reads accessors in select arrays or nested conditions', () => {
    let reads = 0;
    const values: string[] = ['value'];
    Object.defineProperty(values, 0, { enumerable: true, get: () => { reads++; return 'value'; } });
    invalid(() => parseBrowserAction({ kind: 'select', ref: 'r', by: 'value', values }));
    const query = { role: 'button' };
    Object.defineProperty(query, 'name', { enumerable: true, get: () => { reads++; return 'Save'; } });
    invalid(() => parseBrowserAction({ kind: 'wait', condition: { kind: 'element', query } }));
    expect(reads).toBe(0);
  });
});

describe('Z2 find creates a bounded observation, never a selector execution surface', () => {
  it.each([
    { role: 'button' }, { role: 'button', name: 'Save', exact: true, limit: MAX_FIND_RESULTS },
    { text: 'Save', exact: false, limit: 1 },
  ] satisfies BrowserFindQuery[])('accepts query %j', query => {
    expect(parseBrowserFindQuery(query)).toEqual(query);
    const operation = { kind: 'tab.find' as const, query };
    expect(parseBrowserOperation(operation)).toEqual(operation);
    expect(decodeBrowserMessage(encodeBrowserMessage({ ...request, operation }))).toEqual({ ...request, operation });
  });
  it.each([
    {}, { name: 'Save' }, { role: 'button', text: 'Save' }, { text: 'Save', name: 'Save' },
    { role: '' }, { role: 'button', name: '' }, { text: '' }, { text: 'Save', exact: 'true' },
    { text: 'Save', ref: 'old-ref' }, { role: 'button', selector: '#button' },
    { text: 'Save', regex: true }, { text: 'Save', caseSensitive: false },
  ])('rejects unsupported query %j', query => invalid(() => parseBrowserFindQuery(query)));
  it.each([0, -1, 1.1, NaN, Infinity, MAX_FIND_RESULTS + 1, '20'])('rejects result limit %s', limit => {
    invalid(() => parseBrowserFindQuery({ text: 'Save', limit }));
  });
  it('caps role and query text by code points', () => {
    expect(parseBrowserFindQuery({ role: '🌏'.repeat(MAX_ROLE_CODE_POINTS) })).toBeDefined();
    invalid(() => parseBrowserFindQuery({ role: '🌏'.repeat(MAX_ROLE_CODE_POINTS + 1) }));
    for (const query of [{ text: '🌏'.repeat(MAX_FIND_TEXT_CODE_POINTS) }, { role: 'button', name: '🌏'.repeat(MAX_FIND_TEXT_CODE_POINTS) }])
      expect(parseBrowserFindQuery(query)).toBeDefined();
    invalid(() => parseBrowserFindQuery({ text: '🌏'.repeat(MAX_FIND_TEXT_CODE_POINTS + 1) }));
  });
  it('requires completeness and caps find result nodes independently from full snapshots', () => {
    const nodes = Array.from({ length: MAX_FIND_RESULTS }, (_, i) => ({ ref: `r${i}`, role: 'button', name: '' }));
    expect(parseBrowserMessage(success({ ...find, nodes, truncated: true }))).toBeDefined();
    invalid(() => parseBrowserMessage(success({ ...find, nodes: [...nodes, nodes[0]], truncated: true })));
    const { truncated: _flag, ...incomplete } = find;
    invalid(() => parseBrowserMessage(success(incomplete)));
    invalid(() => parseBrowserMessage(success({ ...find, nodes: [{ ...find.nodes[0], backendNodeId: 42 }] })));
    const message = parseBrowserMessage(success(find));
    expect(decodeBrowserMessage(encodeBrowserMessage(message))).toEqual(message);
  });
  it('validates an unwrapped operation result without manufacturing trusted route identity', () => {
    expect(parseBrowserOperationResult(find)).toEqual(find);
    expect(parseBrowserOperationResult({ ...screenshot, ...metadata })).toEqual({ ...screenshot, ...metadata });
    invalid(() => parseBrowserOperationResult({ ...find, hostId: 'model-supplied' }));
    invalid(() => parseBrowserOperationResult({ ...find, url: 'file:///private' }));
    invalid(() => parseBrowserOperationResult({ kind: 'tab.act', pageGeneration: 1, leaseId: 'forged' }));
  });
});

describe('S4 metadata distinguishes CSS coordinates, image pixels and host display fit', () => {
  it('preserves legacy screenshot results while new producers provide the complete group', () => {
    expect(parseBrowserMessage(success(screenshot))).toBeDefined();
    expect(parseBrowserScreenshotMetadata(metadata)).toEqual(metadata);
    const result: BrowserOperationResult = { ...screenshot, ...metadata };
    const message = parseBrowserMessage(success(result));
    expect(decodeBrowserMessage(encodeBrowserMessage(message))).toEqual(message);
  });
  it.each(['viewport', 'captureRect', 'imageScale', 'displayScale'] as const)('rejects a partially populated group missing %s', key => {
    const result = { ...screenshot, ...metadata }; delete (result as Record<string, unknown>)[key];
    invalid(() => parseBrowserMessage(success(result)));
    invalid(() => parseBrowserMessage(success({ ...screenshot, [key]: metadata[key] })));
  });
  it.each([NaN, Infinity, -Infinity, 0, -1, '1', null])('rejects nonpositive/nonfinite scale or size %s', value => {
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, displayScale: value }));
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, imageScale: { x: value, y: 1 } }));
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, viewport: { width: value, height: 720 } }));
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, captureRect: { ...metadata.captureRect, width: value } }));
  });
  it.each([NaN, Infinity, -Infinity, -0.1, 32769, '0'])('rejects invalid CSS offset %s', x => {
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, captureRect: { ...metadata.captureRect, x } }));
  });
  it('allows fractional CSS geometry and all valid boundaries, not an ambiguous scale field', () => {
    expect(parseBrowserScreenshotMetadata({ viewport: { width: 32768, height: 0.5 },
      captureRect: { x: 0, y: 0, width: 32768, height: 0.5 }, imageScale: { x: 0.001, y: 32768 }, displayScale: 1 })).toBeDefined();
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, scale: 1 }));
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, displayScale: 1.01 }));
    invalid(() => parseBrowserScreenshotMetadata({ ...metadata, imageScale: { x: 32769, y: 1 } }));
  });
  it.each([
    { kind: 'tab.screenshot', ref: 'r' }, { kind: 'tab.screenshot', ref: 'r', format: 'png' },
    { kind: 'tab.screenshot', ref: 'r', format: 'jpeg', quality: 0 },
  ] satisfies BrowserOperation[])('accepts ref-bound screenshot %j', operation => expect(parseBrowserOperation(operation)).toEqual(operation));
  it.each([
    { kind: 'tab.screenshot', ref: 'r', clip: { x: 0, y: 0, width: 1, height: 1 } },
    { kind: 'tab.screenshot', ref: 'r', quality: 90 }, { kind: 'tab.screenshot', ref: 'r', fullPage: true },
  ])('rejects caller-defined geometry or unsupported screenshot mode %j', operation => invalid(() => parseBrowserOperation(operation)));
  it('validates finite numbers without coercion and applies exclusiveMinimum', () => {
    expect(validateSchema(0.5, { type: 'number', exclusiveMinimum: 0, maximum: 1 })).toBeUndefined();
    for (const value of [NaN, Infinity, -Infinity, '0.5', null, {}, false])
      expect(typeof validateSchema(value, { type: 'number' })).toBe('string');
    expect(typeof validateSchema(0, { type: 'number', exclusiveMinimum: 0 })).toBe('string');
    expect(typeof validateSchema(1.5, { type: 'integer' })).toBe('string');
  });
});

describe('bounded observations and conservative action state transitions', () => {
  it('exports separate agent-facing budgets without shrinking the provider limits', () => {
    expect(MAX_MODEL_SNAPSHOT_BYTES).toBe(64 * 1024);
    expect(MAX_MODEL_SCREENSHOT_DIMENSION).toBe(1600);
    expect(MAX_MESSAGE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_SCREENSHOT_BASE64_LENGTH).toBe(6 * 1024 * 1024);
    expect(MAX_SNAPSHOT_BYTES).toBe(MAX_MESSAGE_BYTES - 64 * 1024);
    expect(DEFAULT_FIND_LIMIT).toBe(20); expect(DEFAULT_SCROLL_AMOUNT).toBe(500);
  });
  it.each(actions.filter(action => action.kind !== 'wait'))('$kind remains potentially mutating after dispatch', action => {
    const operation: BrowserOperation = { kind: 'tab.act', action };
    expect(hasSideEffects(operation)).toBe(true);
    for (const state of ['dispatched', 'running'] as const) for (const event of ['disconnect', 'deadline', 'cancel'] as const)
      expect(transitionRequest(state, event, operation)).toBe('outcome_unknown');
    expect(transitionRequest('accepted', 'cancel', operation)).toBe('cancelled');
  });
  it.each(actions.filter(action => action.kind === 'wait'))('wait %j does not imply a page write', action => {
    const operation: BrowserOperation = { kind: 'tab.act', action };
    expect(hasSideEffects(operation)).toBe(false);
    expect(transitionRequest('running', 'disconnect', operation)).toBe('failed');
    expect(transitionRequest('running', 'deadline', operation)).toBe('failed');
    expect(transitionRequest('running', 'cancel', operation)).toBe('cancelled');
  });
  it('find is read-only; wait crossing a generation during execution never weakens initial binding checks', () => {
    const operation: BrowserOperation = { kind: 'tab.find', query: { role: 'button' } };
    expect(hasSideEffects(operation)).toBe(false);
    expect(transitionRequest('running', 'disconnect', operation)).toBe('failed');
    const waitRequest: BrowserTabRequest = { ...request, operation: { kind: 'tab.act', action: { kind: 'wait', condition: { kind: 'load', state: 'load' } } } };
    expect(() => assertBoundTarget(waitRequest, { ...waitRequest, pageGeneration: 2 }, Date.parse(request.deadline) - 1)).toThrowError(ProtocolError);
  });
  it('uniqueItems compares JSON structures without property order or getter invocation', () => {
    const schema = { type: 'array', uniqueItems: true, items: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, additionalProperties: false } } as const;
    expect(typeof validateSchema([{ a: 1, b: 2 }, { b: 2, a: 1 }], schema)).toBe('string');
    expect(validateSchema([{ a: 1 }, { a: 2 }], schema)).toBeUndefined();
  });
  it('exports types matching the public parsers', () => {
    expectTypeOf<ReturnType<typeof parseBrowserFindQuery>>().toEqualTypeOf<BrowserFindQuery>();
    expectTypeOf<ReturnType<typeof parseBrowserAction>>().toEqualTypeOf<BrowserAction>();
    expectTypeOf<ReturnType<typeof parseBrowserScreenshotMetadata>>().toEqualTypeOf<BrowserScreenshotMetadata>();
    expectTypeOf<ReturnType<typeof parseBrowserOperationResult>>().toEqualTypeOf<BrowserOperationResult>();
  });
});

// Compile-time counterparts for strict runtime unions.
// @ts-expect-error a find query cannot combine role and text modes.
const badQuery: BrowserFindQuery = { role: 'button', text: 'Save' };
// @ts-expect-error element waits require a query, never a prior snapshot ref.
const oldRefWait: BrowserAction = { kind: 'wait', condition: { kind: 'element', ref: 'r' } };
// @ts-expect-error dismiss cannot carry prompt input.
const dismissInput: BrowserAction = { kind: 'dialog', response: 'dismiss', promptText: '' };
// @ts-expect-error partial metadata is not a valid legacy or I2c screenshot result.
const partialScreenshot: BrowserScreenshotResult = { ...screenshot, viewport: metadata.viewport };
const typedResult: BrowserResult = { ...route, type: 'result', requestId: 'r1', status: 'succeeded', result: { ...screenshot, ...metadata } };
void [badQuery, oldRefWait, dismissInput, partialScreenshot, typedResult];
