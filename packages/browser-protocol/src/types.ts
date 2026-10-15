/** Provider wire types. Identity fields are assigned by a trusted host, never by the model. */
export const BROWSER_PROTOCOL_VERSION = 1 as const;
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
export const MAX_SCREENSHOT_BASE64_LENGTH = 6 * 1024 * 1024;
export const MAX_SNAPSHOT_NODES = 20_000;
export const MAX_NODE_TEXT_CODE_POINTS = 16_384;
export const MAX_ROLE_CODE_POINTS = 256;
export const MAX_FILL_TEXT_CODE_POINTS = 65_536;
/** UTF-8 JSON budget for BrowserSnapshot; leaves room for the provider/result envelope. */
export const MAX_SNAPSHOT_BYTES = MAX_MESSAGE_BYTES - 64 * 1024;
/** Agent-facing budgets, not replacements for the provider transport limits above. */
export const MAX_MODEL_SNAPSHOT_BYTES = 64 * 1024;
export const MAX_MODEL_SCREENSHOT_DIMENSION = 1600;
export const DEFAULT_FIND_LIMIT = 20;
export const MAX_FIND_RESULTS = 100;
export const MAX_FIND_TEXT_CODE_POINTS = 1024;
export const DEFAULT_SCROLL_AMOUNT = 500;
export const MAX_SCROLL_AMOUNT = 4096;
export const MAX_SELECT_VALUES = 100;
export const MAX_SELECT_TEXT_CODE_POINTS = MAX_NODE_TEXT_CODE_POINTS;
export const MAX_DIALOG_TEXT_CODE_POINTS = 4096;
/** Next-dialog response is one-shot and expires no later than this, revocation or navigation. */
export const MAX_DIALOG_POLICY_MS = 5000;

export type BrowserProviderId = 'inApp' | 'extension';
/** Accessibility query only. No CSS, XPath, regular expressions or page script. */
export type BrowserFindQuery = (
  | { role: string; name?: string; text?: never }
  | { text: string; role?: never; name?: never }
) & { exact?: boolean; limit?: number };
export type BrowserWaitCondition =
  | { kind: 'url'; url: string }
  | { kind: 'load'; state: 'domcontentloaded' | 'load' }
  | { kind: 'element'; query: BrowserFindQuery };
export type BrowserAction =
  | { kind: 'click'; ref: string }
  | { kind: 'fill'; ref: string; text: string }
  | { kind: 'press'; ref: string; key: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number; ref?: string }
  | { kind: 'scrollIntoView'; ref: string }
  | { kind: 'select'; ref: string; by: 'value' | 'label'; values: string[] }
  | { kind: 'check'; ref: string }
  | { kind: 'uncheck'; ref: string }
  | { kind: 'hover'; ref: string }
  | { kind: 'wait'; condition: BrowserWaitCondition }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'reload' }
  /** Arm the next dialog, not a persistent policy and not acknowledgement of an accepted dialog. */
  | { kind: 'dialog'; response: 'accept'; promptText?: string }
  | { kind: 'dialog'; response: 'dismiss'; promptText?: never };
export type BrowserTabOperation =
  | { kind: 'tab.snapshot' }
  | { kind: 'tab.find'; query: BrowserFindQuery }
  | { kind: 'tab.act'; action: BrowserAction }
  | { kind: 'tab.navigate'; url: string }
  | { kind: 'tab.screenshot'; ref?: string; format?: 'png'; quality?: never }
  | { kind: 'tab.screenshot'; ref?: string; format: 'jpeg'; quality?: number }
  | { kind: 'tab.release' };
export type BrowserOperation = BrowserTabOperation
  | { kind: 'tabs.list' }
  | { kind: 'tabs.open'; url: string }
  /** Reserved owner-origin selection: reports a chosen tab, never grants control. */
  | { kind: 'tabs.claim' };

export const BROWSER_ERROR_CODES = [
  'invalid_request', 'message_too_large', 'version_mismatch', 'permission_denied',
  'browser_unavailable', 'navigation_failed', 'tab_busy', 'busy', 'lease_expired', 'stale_ref',
  'stale_connection', 'debugger_detached', 'unsupported_frame', 'unsupported_operation',
  'deadline_exceeded', 'outcome_unknown', 'target_hidden', 'target_closed',
  'not_actionable', 'cancelled', 'transport_error', 'request_id_conflict',
] as const;
export type BrowserErrorCode = typeof BROWSER_ERROR_CODES[number];
export interface BrowserError { code: BrowserErrorCode; message: string }

export interface BrowserRequestContext {
  protocolVersion: 1;
  type: 'request';
  requestId: string;
  hostId: string;
  deviceId: string;
  cutexSessionId: string;
  turnId?: string;
  providerId: BrowserProviderId;
  connectionGeneration: number;
  /** Canonical UTC ISO timestamp, including milliseconds. */
  deadline: string;
}
export interface BrowserTarget {
  /** Main-owned opaque handle. Never Electron's numeric webContents id. */
  guestId: string;
  leaseId: string;
  pageGeneration: number;
  /** Reserved opaque extension compatibility handle, not a browser's numeric tab id. */
  tabRef?: string;
}
export type BrowserTabRequest = BrowserRequestContext & BrowserTarget & { operation: BrowserTabOperation };
export type BrowserRequest = BrowserTabRequest
  | (BrowserRequestContext & { operation: { kind: 'tabs.list' } | { kind: 'tabs.open'; url: string } })
  | (BrowserRequestContext & { guestId: string; tabRef?: string; operation: { kind: 'tabs.claim' } });
export type BrowserCommandEnvelope = BrowserRequest;

export interface BrowserPageNode {
  ref: string; role: string; name: string; value?: string;
  /** Present only when a role/name/value was shortened to satisfy a protocol limit. */
  truncated?: true;
}
export interface BrowserSnapshot {
  pageGeneration: number;
  snapshotId: number;
  url: string;
  nodes: BrowserPageNode[];
  /** True if any node was omitted or any role/name/value was shortened. */
  truncated: boolean;
}
export interface BrowserTabSummary { guestId: string; url: string; title: string; pageGeneration: number; tabRef?: string }
export interface BrowserScreenshotMetadata {
  /** CSS layout viewport, independent of the host card's displayed size. */
  viewport: { width: number; height: number };
  /** Captured rectangle in CSS viewport coordinates, not document or screen coordinates. */
  captureRect: { x: number; y: number; width: number; height: number };
  /** Actual output image pixels per CSS pixel in captureRect, after any image resizing. */
  imageScale: { x: number; y: number };
  /** Host card fit scale. This is not devicePixelRatio or imageScale. */
  displayScale: number;
}
export interface BrowserScreenshotPayload {
  mimeType: 'image/png' | 'image/jpeg'; data: string; width: number; height: number; pageGeneration: number;
}
/** Legacy I1 results omit the entire metadata group; I2c producers must supply it in full. */
export type BrowserScreenshotResult = BrowserScreenshotPayload & (BrowserScreenshotMetadata | {
  viewport?: never; captureRect?: never; imageScale?: never; displayScale?: never;
});
export type BrowserOperationResult =
  | ({ kind: 'tab.snapshot' } & BrowserSnapshot)
  | ({ kind: 'tab.find' } & BrowserSnapshot)
  | { kind: 'tab.act'; pageGeneration: number }
  | { kind: 'tab.navigate'; pageGeneration: number; url: string }
  | ({ kind: 'tab.screenshot' } & BrowserScreenshotResult)
  | { kind: 'tab.release' }
  | { kind: 'tabs.list'; tabs: BrowserTabSummary[] }
  /** Selection/creation acknowledgement only. Cutex, not a provider, issues leaseId. */
  | { kind: 'tabs.open' | 'tabs.claim'; tab: BrowserTabSummary };

export interface BrowserMessageRoute {
  protocolVersion: 1;
  hostId: string;
  deviceId: string;
  providerId: BrowserProviderId;
  connectionGeneration: number;
}
export type BrowserResult = BrowserMessageRoute & { type: 'result'; requestId: string } & (
  | { status: 'succeeded'; result: BrowserOperationResult }
  | { status: 'failed'; error: { code: Exclude<BrowserErrorCode, 'cancelled' | 'outcome_unknown'>; message: string } }
  | { status: 'cancelled'; error: { code: 'cancelled'; message: string } }
  | { status: 'outcome_unknown'; error: { code: 'outcome_unknown'; message: string } }
);
export type BrowserHello = BrowserMessageRoute & {
  type: 'hello';
  instanceId: string;
  /** Opaque endpoint identity, not a URL to connect to automatically. */
  endpoint: string;
} & ({ providerId: 'inApp' } | { providerId: 'extension'; extensionOrigin: string });
export interface BrowserHelloAck extends BrowserMessageRoute {
  type: 'hello.ack'; instanceId: string; endpoint: string; maxMessageBytes: number;
}
export interface BrowserCancel extends BrowserMessageRoute {
  type: 'cancel'; requestId: string; cutexSessionId: string; reason: 'user_stop' | 'deadline' | 'lease_revoked';
}
export interface BrowserHeartbeat extends BrowserMessageRoute { type: 'heartbeat'; nonce: string }
export interface BrowserEvent extends BrowserMessageRoute {
  type: 'event';
  /** Monotonic sequence within this provider connection; not HostBinding.epoch. */
  eventSeq: number;
  guestId: string;
  pageGeneration: number;
  event: 'navigated' | 'released' | 'crashed' | 'closed' | 'debugger_detached';
}
export type BrowserMessage = BrowserRequest | BrowserResult | BrowserHello | BrowserHelloAck | BrowserCancel | BrowserHeartbeat | BrowserEvent;

export type BrowserRequestState = 'accepted' | 'dispatched' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';
export type BrowserRequestEvent = 'dispatch' | 'start' | 'succeed' | 'fail' | 'cancel' | 'disconnect' | 'deadline';
