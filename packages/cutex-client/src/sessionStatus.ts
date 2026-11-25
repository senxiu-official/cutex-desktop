import type { EventEnvelope } from "@cutex-desktop/protocol";

/** Non-durable envelopes on the host status channel; never an SSE cursor. */
export const SESSION_STATUS_EVENT = "session_status";
/** claude-runtime-diagnostics-v1 (r295): a Claude runtime's startup warnings and running hooks, whole snapshot. */
export const CLAUDE_DIAGNOSTICS_METHOD = "cutex/session/claudeDiagnostics/changed";
const STATUS_METHODS = new Set(["cutex/session/backgroundWork/changed", CLAUDE_DIAGNOSTICS_METHOD]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

export function readSessionStatusEnvelope(data: string): EventEnvelope | null {
  if (data.length > 65_536 || new TextEncoder().encode(data).byteLength > 65_536) return null;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return null; }
  if (!record(value) || value.contractVersion !== 2 || value.source !== "cutex" || value.sensitivity !== "owner" ||
      ![value.cutexSessionId, value.hostId, value.streamId, value.eventId, value.receivedAt].every(v => typeof v === "string" && v.length > 0) ||
      typeof value.cursor !== "string" || !uint(value.sequence) || !record(value.correlation) || !record(value.cutex) ||
      !STATUS_METHODS.has(value.cutex.method as string) || !record(value.cutex.params)) return null;
  const params = value.cutex.params;
  if (params.cutexSessionId !== value.cutexSessionId || !uint(params.runtimeGeneration)) return null;
  if (value.cutex.method === CLAUDE_DIAGNOSTICS_METHOD) {
    // claude-runtime-diagnostics-v1: the whole snapshot (null = unavailable). The renderer allowlists the words.
    const d = params.claudeDiagnostics;
    if (d !== null && !(record(d) && Array.isArray(d.warnings) && d.warnings.length <= 32 && d.warnings.every(w => typeof w === "string") &&
        Array.isArray(d.activeHooks) && d.activeHooks.length <= 64 && d.activeHooks.every(h => record(h) && typeof h.event === "string" && uint(h.startedAtMs)))) return null;
  } else if (params.backgroundWork !== null) {
    const work = params.backgroundWork;
    if (!record(work) || typeof work.running !== "boolean" || (work.complete !== undefined && typeof work.complete !== "boolean")) return null;
    for (const key of ["subagents", "shells", "terminals"]) if (work[key] !== undefined && !uint(work[key])) return null;
  }
  if (value.correlation.runtimeGeneration !== undefined && value.correlation.runtimeGeneration !== params.runtimeGeneration) return null;
  // The backend status envelope uses params as the generation authority.
  return { ...value, correlation: { ...value.correlation, runtimeGeneration: params.runtimeGeneration } } as unknown as EventEnvelope;
}
