import {
  BROWSER_ERROR_CODES, MAX_MESSAGE_BYTES, MAX_SCREENSHOT_BASE64_LENGTH, MAX_SNAPSHOT_NODES,
  MAX_NODE_TEXT_CODE_POINTS, MAX_ROLE_CODE_POINTS, MAX_FILL_TEXT_CODE_POINTS,
  MAX_FIND_RESULTS, MAX_FIND_TEXT_CODE_POINTS, MAX_SCROLL_AMOUNT, MAX_SELECT_VALUES,
  MAX_SELECT_TEXT_CODE_POINTS, MAX_DIALOG_TEXT_CODE_POINTS,
} from './types';

/** Deliberately small JSON Schema vocabulary; mirrored in schema/browser-v1.schema.json. */
export interface Schema {
  $schema?: string; $id?: string; title?: string;
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: false;
  items?: Schema; minItems?: number; maxItems?: number; uniqueItems?: boolean;
  minLength?: number; maxLength?: number; pattern?: string; format?: 'date-time' | 'browser-url' | 'base64';
  minimum?: number; exclusiveMinimum?: number; maximum?: number; const?: string | number | boolean; enum?: readonly (string | number | boolean)[];
  oneOf?: Schema[];
}
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false,
});
const text = (maxLength: number, minLength = 0): Schema => ({ type: 'string', minLength, maxLength });
const identifier: Schema = { ...text(256, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const literal = (value: string | number | boolean): Schema => ({ const: value });
const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER): Schema => ({ type: 'integer', minimum, maximum });
const finite = (minimum: number, maximum: number): Schema => ({ type: 'number', minimum, maximum });
const positive = (maximum: number): Schema => ({ type: 'number', exclusiveMinimum: 0, maximum });
const url: Schema = { ...text(8192, 1), format: 'browser-url', pattern: '^(https?://[^\\s]+|about:blank)$' };
const generation = integer(1);
const requestRoute = {
  protocolVersion: literal(1), hostId: identifier, deviceId: identifier,
  providerId: { enum: ['inApp', 'extension'] } as Schema, connectionGeneration: generation,
};
const requestContext = {
  ...requestRoute, type: literal('request'), requestId: identifier, cutexSessionId: identifier,
  turnId: identifier, deadline: { ...text(24, 24), format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' } as Schema,
};
const target = { guestId: identifier, leaseId: identifier, pageGeneration: generation, tabRef: identifier };
const click = object({ kind: literal('click'), ref: identifier });
const fill = object({ kind: literal('fill'), ref: identifier, text: text(MAX_FILL_TEXT_CODE_POINTS) });
const press = object({ kind: literal('press'), ref: identifier, key: { ...text(64, 1), pattern: '^[^\\x00-\\x1f\\x7f]+$' } });
const findOptions = { exact: { type: 'boolean' } as Schema, limit: integer(1, MAX_FIND_RESULTS) };
export const browserFindQuerySchema: Schema = { oneOf: [
  object({ role: text(MAX_ROLE_CODE_POINTS, 1), name: text(MAX_FIND_TEXT_CODE_POINTS, 1), ...findOptions }, ['name', 'exact', 'limit']),
  object({ text: text(MAX_FIND_TEXT_CODE_POINTS, 1), ...findOptions }, ['exact', 'limit']),
] };
export const browserWaitConditionSchema: Schema = { oneOf: [
  object({ kind: literal('url'), url }),
  object({ kind: literal('load'), state: { enum: ['domcontentloaded', 'load'] } }),
  object({ kind: literal('element'), query: browserFindQuerySchema }),
] };
export const browserActionSchema: Schema = { oneOf: [click, fill, press,
  object({ kind: literal('scroll'), direction: { enum: ['up', 'down', 'left', 'right'] }, amount: integer(1, MAX_SCROLL_AMOUNT), ref: identifier }, ['amount', 'ref']),
  ...(['scrollIntoView', 'check', 'uncheck', 'hover'] as const).map(kind => object({ kind: literal(kind), ref: identifier })),
  object({ kind: literal('select'), ref: identifier, by: { enum: ['value', 'label'] },
    values: { type: 'array', minItems: 1, maxItems: MAX_SELECT_VALUES, uniqueItems: true, items: text(MAX_SELECT_TEXT_CODE_POINTS) } }),
  object({ kind: literal('wait'), condition: browserWaitConditionSchema }),
  ...(['back', 'forward', 'reload'] as const).map(kind => object({ kind: literal(kind) })),
  object({ kind: literal('dialog'), response: literal('accept'), promptText: text(MAX_DIALOG_TEXT_CODE_POINTS) }, ['promptText']),
  object({ kind: literal('dialog'), response: literal('dismiss') }),
] };
const tabOperations: Schema[] = [
  object({ kind: literal('tab.snapshot') }),
  object({ kind: literal('tab.find'), query: browserFindQuerySchema }),
  object({ kind: literal('tab.act'), action: browserActionSchema }),
  object({ kind: literal('tab.navigate'), url }),
  object({ kind: literal('tab.screenshot'), ref: identifier, format: literal('png') }, ['ref', 'format']),
  object({ kind: literal('tab.screenshot'), ref: identifier, format: literal('jpeg'), quality: integer(0, 100) }, ['ref', 'quality']),
  object({ kind: literal('tab.release') }),
];
const list = object({ kind: literal('tabs.list') });
const open = object({ kind: literal('tabs.open'), url });
const claim = object({ kind: literal('tabs.claim') });
export const browserOperationSchema: Schema = { oneOf: [...tabOperations, list, open, claim] };
export const browserRequestSchema: Schema = { oneOf: [
  object({ ...requestContext, ...target, operation: { oneOf: tabOperations } }, ['turnId', 'tabRef']),
  object({ ...requestContext, operation: { oneOf: [list, open] } }, ['turnId']),
  object({ ...requestContext, guestId: identifier, tabRef: identifier, operation: claim }, ['turnId', 'tabRef']),
] };
const pageNode = object({ ref: identifier, role: text(MAX_ROLE_CODE_POINTS), name: text(MAX_NODE_TEXT_CODE_POINTS),
  value: text(MAX_NODE_TEXT_CODE_POINTS), truncated: literal(true) }, ['value', 'truncated']);
const tabSummary = object({ guestId: identifier, url, title: text(4096), pageGeneration: generation, tabRef: identifier }, ['tabRef']);
const snapshotFields = { pageGeneration: generation, snapshotId: generation, url,
  nodes: { type: 'array', items: pageNode, maxItems: MAX_SNAPSHOT_NODES } as Schema, truncated: { type: 'boolean' } as Schema };
const screenshotFields = { kind: literal('tab.screenshot'), pageGeneration: generation, mimeType: { enum: ['image/png', 'image/jpeg'] } as Schema,
  data: { ...text(MAX_SCREENSHOT_BASE64_LENGTH, 4), pattern: '^[A-Za-z0-9+/]*={0,2}$', format: 'base64' } as Schema,
  width: integer(1, 32768), height: integer(1, 32768) };
const screenshotMetadataFields = {
  viewport: object({ width: positive(32768), height: positive(32768) }),
  captureRect: object({ x: finite(0, 32768), y: finite(0, 32768), width: positive(32768), height: positive(32768) }),
  imageScale: object({ x: positive(32768), y: positive(32768) }),
  displayScale: positive(1),
};
export const browserScreenshotMetadataSchema: Schema = object(screenshotMetadataFields);
const results: Schema[] = [
  object({ kind: literal('tab.snapshot'), ...snapshotFields }),
  object({ kind: literal('tab.find'), ...snapshotFields, nodes: { type: 'array', items: pageNode, maxItems: MAX_FIND_RESULTS } }),
  object({ kind: literal('tab.act'), pageGeneration: generation }),
  object({ kind: literal('tab.navigate'), pageGeneration: generation, url }),
  object(screenshotFields),
  object({ ...screenshotFields, ...screenshotMetadataFields }),
  object({ kind: literal('tab.release') }),
  object({ kind: literal('tabs.list'), tabs: { type: 'array', items: tabSummary, maxItems: 256 } }),
  object({ kind: { enum: ['tabs.open', 'tabs.claim'] }, tab: tabSummary }),
];
export const browserOperationResultSchema: Schema = { oneOf: results };
export const browserResultSchema: Schema = { oneOf: [
  object({ ...requestRoute, type: literal('result'), requestId: identifier, status: literal('succeeded'), result: browserOperationResultSchema }),
  ...(['failed', 'cancelled', 'outcome_unknown'] as const).map(status => object({
    ...requestRoute, type: literal('result'), requestId: identifier, status: literal(status),
    error: object({ code: status === 'failed' ? { enum: BROWSER_ERROR_CODES.filter(code => !['cancelled', 'outcome_unknown'].includes(code)) }
      : literal(status), message: text(2048, 1) }),
  })),
] };
const endpoint = { ...text(256, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
export const browserHelloSchema: Schema = { oneOf: [
  object({ ...requestRoute, type: literal('hello'), providerId: literal('inApp'), instanceId: identifier, endpoint }),
  object({ ...requestRoute, type: literal('hello'), providerId: literal('extension'), instanceId: identifier, endpoint,
    extensionOrigin: { ...text(64, 1), pattern: '^chrome-extension://[a-p]{32}/$' } }),
] };
export const browserMessageSchema: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://cutex.invalid/schema/browser-provider-v1.json',
  title: 'Cutex browser provider protocol v1 (frozen 2026-10-11)',
  oneOf: [browserRequestSchema, browserResultSchema, browserHelloSchema,
    object({ ...requestRoute, type: literal('hello.ack'), instanceId: identifier, endpoint, maxMessageBytes: integer(1, MAX_MESSAGE_BYTES) }),
    object({ ...requestRoute, type: literal('cancel'), requestId: identifier, cutexSessionId: identifier, reason: { enum: ['user_stop', 'deadline', 'lease_revoked'] } }),
    object({ ...requestRoute, type: literal('heartbeat'), nonce: identifier }),
    object({ ...requestRoute, type: literal('event'), eventSeq: generation, guestId: identifier, pageGeneration: generation,
      event: { enum: ['navigated', 'released', 'crashed', 'closed', 'debugger_detached'] } }),
  ],
};
