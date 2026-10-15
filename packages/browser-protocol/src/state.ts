import type { BrowserHello, BrowserHelloAck, BrowserOperation, BrowserProviderId, BrowserRequestEvent, BrowserRequestState, BrowserTabRequest } from './types';
import { MAX_MESSAGE_BYTES } from './types';
import { parseBrowserHello, parseBrowserRequest, ProtocolError } from './validation';

export function hasSideEffects(operation: BrowserOperation): boolean {
  if (operation.kind === 'tab.act') return operation.action?.kind !== 'wait';
  return operation.kind !== 'tab.snapshot' && operation.kind !== 'tab.find' && operation.kind !== 'tab.screenshot' && operation.kind !== 'tabs.list';
}
export function isTerminalRequestState(state: BrowserRequestState): boolean {
  return ['succeeded', 'failed', 'cancelled', 'outcome_unknown'].includes(state);
}
/** Conservative after dispatch: loss of a receipt is not proof that a write did not happen. */
export function transitionRequest(state: BrowserRequestState, event: BrowserRequestEvent, operation: BrowserOperation): BrowserRequestState {
  if (isTerminalRequestState(state)) throw new ProtocolError('invalid_request', 'A terminal request cannot transition or replay');
  if (event === 'disconnect' || event === 'deadline' || event === 'cancel') {
    if (state !== 'accepted' && hasSideEffects(operation)) return 'outcome_unknown';
    return event === 'cancel' ? 'cancelled' : 'failed';
  }
  if (event === 'fail') return 'failed';
  if (state === 'accepted' && event === 'dispatch') return 'dispatched';
  if (state === 'dispatched' && event === 'start') return 'running';
  if ((state === 'dispatched' || state === 'running') && event === 'succeed') return 'succeeded';
  throw new ProtocolError('invalid_request', `Invalid request transition ${state}/${event}`);
}

export interface ExpectedHello {
  hostId: string; deviceId: string; providerId: BrowserProviderId; instanceId: string;
  endpoint: string; connectionGeneration: number; extensionOrigin?: string;
}
/** Must run AFTER endpoint ACL/pairing authentication. A hello is not an authentication credential. */
export function acceptHello(value: unknown, expected: ExpectedHello): BrowserHelloAck {
  const hello = parseBrowserHello(value);
  for (const key of ['hostId', 'deviceId', 'providerId', 'instanceId', 'endpoint'] as const) {
    if (hello[key] !== expected[key]) throw new ProtocolError('permission_denied', 'Provider handshake does not match the bound endpoint');
  }
  if (hello.connectionGeneration !== expected.connectionGeneration) throw new ProtocolError('stale_connection', 'Provider connection generation does not match');
  if (hello.providerId === 'extension' && hello.extensionOrigin !== expected.extensionOrigin) throw new ProtocolError('permission_denied', 'Extension origin is not paired');
  return { protocolVersion: 1, type: 'hello.ack', hostId: hello.hostId, deviceId: hello.deviceId,
    providerId: hello.providerId, connectionGeneration: hello.connectionGeneration,
    instanceId: hello.instanceId, endpoint: hello.endpoint, maxMessageBytes: MAX_MESSAGE_BYTES };
}

export type BoundBrowserTarget = Pick<BrowserTabRequest, 'hostId' | 'deviceId' | 'cutexSessionId' | 'providerId' | 'connectionGeneration' | 'guestId' | 'leaseId' | 'pageGeneration'>;
/** Provider-side guard, not a lease authority. Revocation/expiry and URL policy still belong to the broker. */
export function assertBoundTarget(value: BrowserTabRequest, bound: BoundBrowserTarget, now = Date.now()): void {
  parseBrowserRequest(value);
  if (!Number.isSafeInteger(now) || now < 0) throw new ProtocolError('invalid_request', 'Invalid current timestamp');
  if (Date.parse(value.deadline) <= now) throw new ProtocolError('deadline_exceeded', 'Browser request expired before execution');
  for (const key of ['hostId', 'deviceId', 'cutexSessionId', 'providerId', 'guestId', 'leaseId'] as const) {
    if (value[key] !== bound[key]) throw new ProtocolError('permission_denied', 'Browser request does not match its bound target and controller');
  }
  if (value.connectionGeneration !== bound.connectionGeneration) throw new ProtocolError('stale_connection', 'Browser connection changed');
  if (value.pageGeneration !== bound.pageGeneration) throw new ProtocolError('stale_ref', 'Browser page generation changed');
}

/** Results from a previous generation must never be matched only by requestId. */
export function isSameConnection(left: Pick<BrowserHello, 'hostId' | 'deviceId' | 'providerId' | 'connectionGeneration'>, right: Pick<BrowserHello, 'hostId' | 'deviceId' | 'providerId' | 'connectionGeneration'>): boolean {
  return left.hostId === right.hostId && left.deviceId === right.deviceId && left.providerId === right.providerId && left.connectionGeneration === right.connectionGeneration;
}
