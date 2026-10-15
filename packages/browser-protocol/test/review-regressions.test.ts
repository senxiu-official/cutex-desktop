import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_BYTES, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_NODES, MAX_NODE_TEXT_CODE_POINTS,
  MAX_ROLE_CODE_POINTS, MAX_FILL_TEXT_CODE_POINTS, ProtocolError, encodeBrowserMessage,
  decodeBrowserMessage, parseBrowserMessage, parseBrowserOperation, validateSchema,
} from '../src';
import type { BrowserEvent, BrowserOperationResult, BrowserPageNode, BrowserResult, BrowserSnapshot } from '../src';

const route = { protocolVersion: 1 as const, hostId: 'host-1', deviceId: 'device-1', providerId: 'inApp' as const, connectionGeneration: 1 };
const event: BrowserEvent = { ...route, type: 'event', eventSeq: 1, guestId: 'guest-1', pageGeneration: 1, event: 'navigated' };
const success = (result: BrowserOperationResult): BrowserResult => ({ ...route, type: 'result', requestId: 'r1', status: 'succeeded', result });
const snapshot = (nodes: BrowserPageNode[] = [], truncated = false): BrowserOperationResult => ({
  kind: 'tab.snapshot', pageGeneration: 1, snapshotId: 1, url: 'about:blank', nodes, truncated,
});
function invalid(value: unknown): void {
  try { parseBrowserMessage(value); throw new Error('Expected invalid request'); }
  catch (error) { expect(error).toBeInstanceOf(ProtocolError); expect((error as ProtocolError).code).toBe('invalid_request'); }
}

describe('M4 provider event sequence is not bridge HostTag.epoch', () => {
  it('round trips eventSeq and does not add a main-owned host epoch', () => {
    expect(decodeBrowserMessage(encodeBrowserMessage(event))).toEqual(event);
  });
  it.each([2, 'host-connection-token'])('rejects obsolete epoch even alongside valid eventSeq (%s)', epoch => {
    invalid({ ...event, epoch });
    const { eventSeq: _sequence, ...legacy } = event;
    invalid({ ...legacy, epoch });
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null])('requires positive safe integer eventSeq %s', eventSeq => invalid({ ...event, eventSeq }));
  it('allows the largest safe eventSeq without allowing host routing fields', () => {
    expect(parseBrowserMessage({ ...event, eventSeq: Number.MAX_SAFE_INTEGER })).toBeDefined();
    invalid({ ...event, hostTag: { hostId: 'host-1', epoch: 'main-owned' } });
  });
});

describe('M5 provider creation/selection never issues a lease', () => {
  const tab = { guestId: 'guest-1', url: 'about:blank', title: 'Owner selection', pageGeneration: 1 };
  it.each(['tabs.open', 'tabs.claim'] as const)('%s returns only the selected tab summary', kind => {
    const message = success({ kind, tab });
    expect(decodeBrowserMessage(encodeBrowserMessage(message))).toEqual(message);
  });
  it.each(['tabs.open', 'tabs.claim'] as const)('%s rejects provider-issued lease fields anywhere in its result', kind => {
    invalid({ ...success({ kind, tab }), result: { kind, tab, leaseId: 'provider-made-lease' } });
    invalid({ ...success({ kind, tab }), result: { kind, tab: { ...tab, leaseId: 'provider-made-lease' } } });
  });
});

describe('M3 snapshot flags and shared output budgets', () => {
  it('exports one set of wire/executor limits', () => {
    expect({ MAX_SNAPSHOT_NODES, MAX_NODE_TEXT_CODE_POINTS, MAX_ROLE_CODE_POINTS, MAX_FILL_TEXT_CODE_POINTS }).toEqual({
      MAX_SNAPSHOT_NODES: 20000, MAX_NODE_TEXT_CODE_POINTS: 16384, MAX_ROLE_CODE_POINTS: 256, MAX_FILL_TEXT_CODE_POINTS: 65536,
    });
    expect(MAX_SNAPSHOT_BYTES).toBe(MAX_MESSAGE_BYTES - 64 * 1024);
  });
  it.each([true, false])('requires a real snapshot-level boolean (%s)', truncated => {
    expect(parseBrowserMessage(success(snapshot([], truncated)))).toBeDefined();
  });
  it.each([undefined, 0, 1, 'true', 'false', null, {}])('rejects missing/non-boolean snapshot truncation %s', truncated => {
    const body = { kind: 'tab.snapshot', pageGeneration: 1, snapshotId: 1, url: 'about:blank', nodes: [] };
    invalid({ ...success(snapshot()), result: truncated === undefined ? body : { ...body, truncated } });
  });
  it('supports boolean type, false constants and boolean enums without truthy coercion', () => {
    expect(validateSchema(false, { type: 'boolean', const: false })).toBeUndefined();
    expect(validateSchema(true, { type: 'boolean', enum: [true, false] })).toBeUndefined();
    expect(typeof validateSchema('false', { type: 'boolean' })).toBe('string');
    expect(typeof validateSchema(true, { const: false })).toBe('string');
  });
  it('optional node truncated marker is literal true, never false or another truthy value', () => {
    const node = { ref: 'node-1', role: 'textbox', name: 'Shortened label' };
    expect(parseBrowserMessage(success(snapshot([node])))).toBeDefined();
    expect(parseBrowserMessage(success(snapshot([{ ...node, truncated: true }], true)))).toBeDefined();
    for (const truncated of [false, 'true', 1, null]) {
      invalid({ ...success(snapshot()), result: { ...snapshot(), truncated: true, nodes: [{ ...node, truncated }] } });
    }
  });
  it('accepts exactly 20,000 nodes and rejects one extra', () => {
    const nodes = Array.from({ length: MAX_SNAPSHOT_NODES }, (_, index) => ({ ref: `n${index}`, role: '', name: '' }));
    expect(parseBrowserMessage(success(snapshot(nodes, true)))).toBeDefined();
    invalid(success(snapshot([...nodes, { ref: 'extra', role: '', name: '' }], true)));
  });
  it.each(['name', 'value'] as const)('%s limit is Unicode code points, not UTF-16 units', field => {
    const exact = { ref: 'n1', role: 'textbox', name: '', [field]: '🌏'.repeat(MAX_NODE_TEXT_CODE_POINTS), truncated: true as const };
    expect(parseBrowserMessage(success(snapshot([exact], true)))).toBeDefined();
    invalid(success(snapshot([{ ...exact, [field]: '🌏'.repeat(MAX_NODE_TEXT_CODE_POINTS + 1) }], true)));
  });
  it('role has a separate 256-code-point cap', () => {
    expect(parseBrowserMessage(success(snapshot([{ ref: 'n1', role: '🌏'.repeat(MAX_ROLE_CODE_POINTS), name: '', truncated: true }], true)))).toBeDefined();
    invalid(success(snapshot([{ ref: 'n1', role: '🌏'.repeat(MAX_ROLE_CODE_POINTS + 1), name: '', truncated: true }], true)));
  });
  it('fill accepts 65,536 non-BMP code points but not one more', () => {
    const operation = { kind: 'tab.act', action: { kind: 'fill', ref: 'n1', text: '🌏'.repeat(MAX_FILL_TEXT_CODE_POINTS) } };
    expect(parseBrowserOperation(operation)).toBeDefined();
    expect(() => parseBrowserOperation({ ...operation, action: { ...operation.action, text: operation.action.text + '🌏' } })).toThrow(ProtocolError);
  });
  it('a snapshot at its exact serialized-byte budget still fits the full provider envelope', () => {
    const encoder = new TextEncoder();
    const value: BrowserSnapshot = { pageGeneration: 1, snapshotId: 1, url: 'about:blank', nodes: [], truncated: true };
    let bytes = encoder.encode(JSON.stringify(value)).length;
    for (let index = 0; ; index++) {
      const node: BrowserPageNode = { ref: `n${index}`, role: 'textbox', name: '', value: '' };
      const overhead = encoder.encode(JSON.stringify(node)).length + (index > 0 ? 1 : 0);
      const available = MAX_SNAPSHOT_BYTES - bytes - overhead;
      if (available < 0) break;
      node.name = 'x'.repeat(Math.min(MAX_NODE_TEXT_CODE_POINTS, available));
      node.value = 'y'.repeat(Math.min(MAX_NODE_TEXT_CODE_POINTS, available - node.name.length));
      value.nodes.push(node);bytes += overhead + node.name.length + node.value.length;
      if (bytes === MAX_SNAPSHOT_BYTES) break;
    }
    expect(encoder.encode(JSON.stringify(value)).length).toBe(MAX_SNAPSHOT_BYTES);
    expect(encodeBrowserMessage(success({ kind: 'tab.snapshot', ...value })).length).toBeLessThan(MAX_MESSAGE_BYTES);
  });
});

// Negative compile fixtures accompany the runtime regressions.
// @ts-expect-error provider events must not include main's host epoch.
const oldEpoch: BrowserEvent = { ...event, epoch: 1 };
void oldEpoch;
// @ts-expect-error provider creation results do not grant leases.
const providerLease: BrowserOperationResult = { kind: 'tabs.open', tab: { guestId: 'g', url: 'about:blank', title: '', pageGeneration: 1 }, leaseId: 'not-provider-authority' };
void providerLease;
// @ts-expect-error every snapshot explicitly signals completeness.
const missingTruncation: BrowserSnapshot = { pageGeneration: 1, snapshotId: 1, url: 'about:blank', nodes: [] };
void missingTruncation;
// @ts-expect-error node-level false is omitted, not serialized.
const falseNodeMarker: BrowserPageNode = { ref: 'r', name: '', role: '', truncated: false };
void falseNodeMarker;
