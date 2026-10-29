import type { EventEnvelope } from "@cutex-desktop/protocol";
import { MAX_EVENT_MEDIA_BYTES, eventMediaNotice, mediaRecord, parseCutexBlobRef, parseMediaBlob } from "../shared/mediaBlobs";

type RecordValue = Record<string, unknown>;
export interface FullTextReference {
  sessionId: string;
  sha256: string;
  expected: { mime: string; size: number };
}
export type FullTextRead = (sessionId: string, sha256: string, expected: FullTextReference["expected"]) =>
  Promise<{ bytes: Uint8Array; mime: string; size: number } | null>;

const owns = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function completion(envelope: EventEnvelope) {
  const message: unknown = envelope.native?.message;
  if (!mediaRecord(message) || message.method !== "item/completed") return null;
  const params = mediaRecord(message.params) ? message.params : null;
  const item = params && mediaRecord(params.item) ? params.item : null;
  return { message, params, item };
}

/** Fence completed text before awaiting its sidecar, including previews that cannot be repaired. */
export function hasFullTextCompletion(envelope: EventEnvelope): boolean {
  const c = completion(envelope);
  return !!c && (c.item?.type === "agentMessage" || c.item?.type === "reasoning" ||
    owns(c.message, "_cutexFullText") || owns(c.message, "_cutexTruncated") ||
    !!c.params && owns(c.params, "_cutexTruncated"));
}

/** Ordinary complete text needs no reload; only marked previews enter asynchronous repair. */
export function needsFullTextRepair(envelope: EventEnvelope, requireComplete = false): boolean {
  const c = completion(envelope);
  return !!c && (owns(c.message, "_cutexFullText") || !!c.params && owns(c.params, "_cutexFullText") ||
    !!c.item && (c.item.type === "agentMessage" || c.item.type === "reasoning") &&
      (eventMediaNotice(c.message) || eventMediaNotice(c.params)) ||
    requireComplete && !!c.item && (c.item.type === "agentMessage" ? typeof c.item.text !== "string" :
      c.item.type === "reasoning" && (!strings(c.item.summary) || !strings(c.item.content))));
}

/** Only the notification root is authoritative; never follow params/item references or URLs. */
export function fullTextReference(envelope: EventEnvelope): FullTextReference | null {
  const c = completion(envelope);
  if (!c || !c.item || typeof c.item.id !== "string" || !c.item.id ||
      (c.item.type !== "agentMessage" && c.item.type !== "reasoning")) return null;
  const blob = parseMediaBlob(c.message._cutexFullText);
  const ref = blob && parseCutexBlobRef(blob.url);
  if (!blob || !ref || ref.sessionId !== envelope.cutexSessionId || blob.mime !== "application/json" ||
      blob.size <= 0 || blob.size > MAX_EVENT_MEDIA_BYTES) return null;
  return { sessionId: ref.sessionId, sha256: ref.sha256, expected: { mime: blob.mime, size: blob.size } };
}

/** A full item cannot itself contain another partial preview or another full-item reference. */
function hasNestedMarker(item: RecordValue): boolean {
  const stack: unknown[] = [item];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === "object") stack.push(child);
    } else if (mediaRecord(value)) {
      if (owns(value, "_cutexTruncated") || owns(value, "_cutexFullText")) return true;
      for (const child of Object.values(value)) if (child && typeof child === "object") stack.push(child);
    }
  }
  return false;
}
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string");
function withoutMarkers(value: RecordValue): RecordValue {
  const { _cutexTruncated: _truncated, _cutexFullText: _fullText, ...rest } = value;
  return rest;
}

/** SDK read verifies the hash; this boundary additionally checks returned bytes, MIME and full-item shape. */
export async function hydrateFullText(envelope: EventEnvelope, read: FullTextRead): Promise<EventEnvelope | null> {
  const c = completion(envelope);
  if (!c) return envelope;
  const ref = fullTextReference(envelope);
  if (!ref) {
    // A params reference is not authorized, including on an otherwise plausible inline preview.
    const marked = owns(c.message, "_cutexFullText") || owns(c.message, "_cutexTruncated") ||
      !!c.params && (owns(c.params, "_cutexFullText") || owns(c.params, "_cutexTruncated")) ||
      !!c.item && hasNestedMarker(c.item);
    return marked ? null : envelope;
  }
  try {
    const result = await read(ref.sessionId, ref.sha256, ref.expected);
    if (!result || !(result.bytes instanceof Uint8Array) || result.mime !== ref.expected.mime ||
        result.size !== ref.expected.size || result.bytes.byteLength !== ref.expected.size ||
        result.bytes.byteLength > MAX_EVENT_MEDIA_BYTES) return null;
    const item: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.bytes));
    if (!mediaRecord(item) || item.id !== c.item!.id || item.type !== c.item!.type || hasNestedMarker(item)) return null;
    if (item.type === "agentMessage" ? typeof item.text !== "string" : !strings(item.summary) || !strings(item.content)) return null;
    return { ...envelope, native: { ...envelope.native!, message: {
      ...withoutMarkers(c.message), params: { ...withoutMarkers(c.params!), item },
    } } } as EventEnvelope;
  } catch {
    return null;
  }
}
