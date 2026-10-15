import { browserMessageSchema, browserOperationSchema, browserActionSchema, browserFindQuerySchema,
  browserScreenshotMetadataSchema, browserOperationResultSchema, browserRequestSchema, browserHelloSchema, type Schema } from './schema';
import { MAX_MESSAGE_BYTES, type BrowserMessage, type BrowserOperation, type BrowserAction, type BrowserFindQuery,
  type BrowserScreenshotMetadata, type BrowserOperationResult, type BrowserRequest, type BrowserHello, type BrowserErrorCode } from './types';

export class ProtocolError extends Error {
  constructor(readonly code: BrowserErrorCode, message: string) { super(message); this.name = 'ProtocolError'; }
}

/** Only JSON records are accepted; never run getters from an untrusted object. */
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** JSON equality for uniqueItems, without invoking accessors or user-defined serialization. */
function equalJsonData(left: unknown, right: unknown, depth = 0): boolean {
  if (left === right) return true;
  if (depth > 32 || left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (!Array.isArray(left) && (!plainRecord(left) || !plainRecord(right))) return false;
  const a = Object.getOwnPropertyDescriptors(left), b = Object.getOwnPropertyDescriptors(right);
  const keys = Reflect.ownKeys(a);
  if (keys.length !== Reflect.ownKeys(b).length) return false;
  return keys.every(key => typeof key === 'string' && Object.hasOwn(b, key) &&
    'value' in a[key]! && 'value' in b[key]! && equalJsonData(a[key]!.value, b[key]!.value, depth + 1));
}

export function isBrowserUrl(value: string): boolean {
  if (value === 'about:blank') return true;
  if (!/^https?:\/\/[^\s]+$/.test(value) || /[\x00-\x20\x7f\\]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname !== '' && parsed.username === '' && parsed.password === '';
  } catch { return false; }
}

/** The package supports exactly its emitted schema vocabulary, not arbitrary JSON Schema. */
export function validateSchema(value: unknown, schema: Schema, path = '$', depth = 0): string | undefined {
  if (depth > 32) return `${path}: nesting limit exceeded`;
  if (schema.const !== undefined && value !== schema.const) return `${path}: unexpected constant`;
  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) return `${path}: value is not in enum`;
  if (schema.oneOf) {
    const matching = schema.oneOf.filter(branch => validateSchema(value, branch, path, depth + 1) === undefined).length;
    if (matching !== 1) return `${path}: expected exactly one supported shape`;
  }
  if (schema.type === 'object') {
    if (!plainRecord(value)) return `${path}: expected plain object`;
    const properties = schema.properties ?? {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || !Object.hasOwn(properties, key)) return `${path}: unexpected field`;
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) return `${path}.${key}: expected JSON data field`;
      const error = validateSchema(descriptor.value, properties[key]!, `${path}.${key}`, depth + 1);
      if (error) return error;
    }
    for (const key of schema.required ?? []) if (!Object.hasOwn(descriptors, key)) return `${path}.${key}: required`;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return `${path}: expected plain array`;
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: too few items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: too many items`;
    if (Reflect.ownKeys(value).length !== value.length + 1) return `${path}: expected dense JSON array`;
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return `${path}: expected JSON array values`;
      const error = schema.items && validateSchema(descriptor.value, schema.items, `${path}[${index}]`, depth + 1);
      if (error) return error;
      if (schema.uniqueItems) for (let previous = 0; previous < index; previous++) {
        if (equalJsonData(descriptor.value, Object.getOwnPropertyDescriptor(value, previous)!.value)) return `${path}: duplicate items`;
      }
    }
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    if (schema.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== 'number' || !Number.isFinite(value))
      return `${path}: expected ${schema.type === 'integer' ? 'safe integer' : 'finite number'}`;
    if ((schema.minimum !== undefined && (value as number) < schema.minimum) ||
        (schema.exclusiveMinimum !== undefined && (value as number) <= schema.exclusiveMinimum) ||
        (schema.maximum !== undefined && (value as number) > schema.maximum)) return `${path}: number out of range`;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `${path}: expected boolean`;
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path}: expected string`;
    // Schema lengths count Unicode code points, not UTF-16 code units.
    let length = 0;
    for (const _character of value) length++;
    if ((schema.minLength !== undefined && length < schema.minLength) || (schema.maxLength !== undefined && length > schema.maxLength)) return `${path}: string length out of range`;
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) return `${path}: invalid string format`;
    if (schema.format === 'base64' && value.length % 4 !== 0) return `${path}: invalid base64 length`;
    if (schema.format === 'browser-url' && !isBrowserUrl(value)) return `${path}: disallowed browser URL`;
    if (schema.format === 'date-time') {
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return `${path}: expected canonical UTC timestamp`;
    }
  }
  return undefined;
}

function parse<T>(value: unknown, schema: Schema): T {
  const error = validateSchema(value, schema);
  if (error) throw new ProtocolError('invalid_request', error);
  return value as T;
}
export const parseBrowserOperation = (value: unknown): BrowserOperation => parse(value, browserOperationSchema);
export const parseBrowserOperationResult = (value: unknown): BrowserOperationResult => parse(value, browserOperationResultSchema);
export const parseBrowserAction = (value: unknown): BrowserAction => parse(value, browserActionSchema);
export const parseBrowserFindQuery = (value: unknown): BrowserFindQuery => parse(value, browserFindQuerySchema);
export const parseBrowserScreenshotMetadata = (value: unknown): BrowserScreenshotMetadata => parse(value, browserScreenshotMetadataSchema);
function assertVersion(value: unknown): void {
  if (plainRecord(value)) {
    const version = Object.getOwnPropertyDescriptor(value, 'protocolVersion');
    if (version && 'value' in version && version.value !== 1) throw new ProtocolError('version_mismatch', 'Browser protocol version must be 1');
  }
}
export function parseBrowserRequest(value: unknown): BrowserRequest { assertVersion(value); return parse(value, browserRequestSchema); }
export function parseBrowserHello(value: unknown): BrowserHello { assertVersion(value); return parse(value, browserHelloSchema); }
export function parseBrowserMessage(value: unknown): BrowserMessage { assertVersion(value); return parse(value, browserMessageSchema); }
function checkLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MESSAGE_BYTES) throw new ProtocolError('invalid_request', 'Invalid message byte limit');
}
/** JSON UTF-8 payload, without a transport length prefix. Extension chunking is deferred to I4. */
export function encodeBrowserMessage(value: BrowserMessage, maxBytes = MAX_MESSAGE_BYTES): Uint8Array {
  checkLimit(maxBytes);
  const message = parseBrowserMessage(value);
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  if (bytes.byteLength > maxBytes) throw new ProtocolError('message_too_large', 'Browser message exceeds byte limit');
  return bytes;
}
export function decodeBrowserMessage(bytes: Uint8Array, maxBytes = MAX_MESSAGE_BYTES): BrowserMessage {
  checkLimit(maxBytes);
  if (!(bytes instanceof Uint8Array)) throw new ProtocolError('invalid_request', 'Expected UTF-8 byte array');
  if (bytes.byteLength > maxBytes) throw new ProtocolError('message_too_large', 'Browser message exceeds byte limit');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { throw new ProtocolError('invalid_request', 'Browser message is not valid UTF-8 JSON'); }
  return parseBrowserMessage(parsed);
}
