/** Capability for opt-in, non-durable text notifications (r260). */
export const LIVE_DELTAS_FEATURE = "live-text-deltas";
export const LIVE_DELTA_EVENT = "live_delta";

export type LiveDeltaMethod = "item/agentMessage/delta" | "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta";

interface LiveDeltaIdentity {
  version: 1;
  cutexSessionId: string;
  hostId: string;
  runtimeGeneration: number;
  threadId: string;
  turnId: string | null;
  itemId: string;
  method: LiveDeltaMethod;
  producerEpoch: string;
  revision: number;
  /** UTF-8 byte offsets within the native content/summary segment. */
  startOffset: number;
  endOffset: number;
  anchor: { streamId: string; sequence: number } | null;
}

/** Native parameters and unknown metadata are preserved verbatim, including null on gaps. */
export type LiveDeltaFrame = LiveDeltaIdentity & (
  | { kind: "delta"; gapScope?: never; params: Record<string, unknown> }
  | {
      kind: "gap";
      /** Item gaps invalidate every method/index segment of this item; absent means item. */
      gapScope?: "item" | "subscription";
      params: Record<string, unknown> | null;
    }
);

const methods = new Set<string>(["item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta"]);
const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const uint = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Read parsed JSON or SSE data. Unknown versions/methods and malformed frames are ignored. */
export function readLiveDeltaFrame(value: unknown): LiveDeltaFrame | null {
  if (typeof value === "string") {
    // Bound parsing/allocation too; a compliant frame is at most 64 KiB on the wire.
    if (value.length > 65_536 || encoder.encode(value).byteLength > 65_536) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!record(value) || value.version !== 1 || (value.kind !== "delta" && value.kind !== "gap")) return null;
  if (value.gapScope !== undefined && (value.kind !== "gap" || (value.gapScope !== "item" && value.gapScope !== "subscription"))) return null;
  if (![value.cutexSessionId, value.hostId, value.threadId, value.itemId, value.producerEpoch].every(id)) return null;
  if (value.turnId !== null && !id(value.turnId)) return null;
  if (!uint(value.runtimeGeneration) || !uint(value.revision) || value.revision === 0 ||
      !uint(value.startOffset) || !uint(value.endOffset) || value.endOffset < value.startOffset) return null;
  if (typeof value.method !== "string" || !methods.has(value.method)) return null;
  if (value.anchor !== null && (!record(value.anchor) || !id(value.anchor.streamId) || !uint(value.anchor.sequence))) return null;
  const params = value.params;
  if (params === null && value.kind === "gap") return value as unknown as LiveDeltaFrame;
  if (!record(params)) return null;
  for (const key of ["threadId", "turnId", "itemId"] as const) {
    if (key in params && params[key] !== value[key]) return null;
  }
  for (const key of ["summaryIndex", "contentIndex"]) {
    if (key in params && !uint(params[key])) return null;
  }
  if (value.kind === "delta" && (typeof params.delta !== "string" ||
      encoder.encode(params.delta).byteLength !== value.endOffset - value.startOffset)) return null;
  return value as unknown as LiveDeltaFrame;
}
