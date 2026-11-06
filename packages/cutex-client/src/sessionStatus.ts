import type { EventEnvelope } from "@cutex-desktop/protocol";

/** Non-durable envelopes on the host status channel; never an SSE cursor. */
export const SESSION_STATUS_EVENT = "session_status";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function readSessionStatusEnvelope(data: string): EventEnvelope | null {
  if (data.length > 65_536 || new TextEncoder().encode(data).byteLength > 65_536) return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (!record(value) || value.contractVersion !== 2 || value.source !== "cutex" || value.sensitivity !== "owner" ||
      ![value.cutexSessionId, value.hostId, value.streamId, value.eventId, value.receivedAt].every(v => typeof v === "string" && v.length > 0) ||
      typeof value.cursor !== "string" || !uint(value.sequence) || !record(value.correlation) || !record(value.cutex) ||
      value.cutex.method !== "cutex/session/backgroundWork/changed" || !record(value.cutex.params)) return null;
  const params = value.cutex.params;
  if (params.cutexSessionId !== value.cutexSessionId || !uint(params.runtimeGeneration)) return null;
  if (params.backgroundWork !== null) {
    const work = params.backgroundWork;
    if (!record(work) || typeof work.running !== "boolean" || (work.complete !== undefined && typeof work.complete !== "boolean")) return null;
    for (const key of ["subagents", "shells", "terminals"]) if (work[key] !== undefined && !uint(work[key])) return null;
  }
  if (value.correlation.runtimeGeneration !== undefined && value.correlation.runtimeGeneration !== params.runtimeGeneration) return null;
  // The backend status envelope uses params as the generation authority.
  return { ...value, correlation: { ...value.correlation, runtimeGeneration: params.runtimeGeneration } } as unknown as EventEnvelope;
}
