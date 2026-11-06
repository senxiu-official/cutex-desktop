// Who stopped an agent's runtime (r276 `runtime-stop-requested-by`), for the interrupted turn's end mark
// (Timeline TurnInterruptedRow): an agent's own script that ran `cutex human stop` on itself left only 已中断.
// cutex/runtime/closing | offlineRequested (and their closed | offline) carry the stop's `reason` and, when an
// agent's `cutex` CLI asked, `requestedBy {kind: agent, runtimeAgentId, cutexSessionId?, name?}`. Kept per
// (host, agent) as the events arrive (live and replayed); hosts without the capability show the bare mark.
import { create } from "zustand";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { TurnView } from "./timeline";
import { hostKey, type HostKey } from "./hostKeys";

export const RUNTIME_STOP_REQUESTED_BY_FEATURE = "runtime-stop-requested-by";

const STOP_METHODS = new Set(["cutex/runtime/closing", "cutex/runtime/closed", "cutex/runtime/offlineRequested", "cutex/runtime/offline"]);

/** self: the agent stopped its own runtime; agent: another agent's command; cli: `cutex` CLI outside an agent;
 *  owner: a stop without a reason (the desktop's 停止). */
export type RuntimeStopBy = { kind: "self" } | { kind: "agent"; name: string } | { kind: "cli" } | { kind: "owner" };

export interface RuntimeStop {
  /** Epoch seconds, like TurnView.completedAt. */
  at: number;
  by: RuntimeStopBy;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The stop an event names, or null (another event, or a stop for another reason: a package run, a restart). */
export function runtimeStopOf(envelope: EventEnvelope, features: ReadonlySet<string>): RuntimeStop | null {
  if (!features.has(RUNTIME_STOP_REQUESTED_BY_FEATURE)) return null;
  const method = envelope.cutex?.method;
  if (!method || !STOP_METHODS.has(method)) return null;
  const params = (envelope.cutex?.params ?? {}) as Record<string, unknown>;
  const at = Date.parse(text(params.occurredAt) ?? envelope.receivedAt);
  if (!Number.isFinite(at)) return null;
  const requester = params.requestedBy && typeof params.requestedBy === "object" ? params.requestedBy as Record<string, unknown> : null;
  let by: RuntimeStopBy | null = null;
  if (requester?.kind === "agent") {
    const id = text(requester.runtimeAgentId);
    if (text(requester.cutexSessionId) === envelope.cutexSessionId) by = { kind: "self" };
    else if (text(requester.name) ?? id) by = { kind: "agent", name: (text(requester.name) ?? id)! };
  } else if (params.reason === undefined || params.reason === null || params.reason === "owner_requested") by = { kind: "owner" };
  else if (params.reason === "cutex_cli") by = { kind: "cli" };
  return by ? { at: at / 1000, by } : null;
}

/** The stop that cut this turn off: one that came while it ran or within moments of its end. */
export function stopOfTurn(stop: RuntimeStop | undefined, turn: Pick<TurnView, "startedAt" | "completedAt">): RuntimeStop | null {
  if (!stop || turn.completedAt == null) return null;
  const from = Math.max(turn.startedAt ?? -Infinity, turn.completedAt - 120);
  return stop.at >= from - 1 && stop.at <= turn.completedAt + 5 ? stop : null;
}

interface RuntimeStopsState {
  byKey: Record<HostKey, RuntimeStop>;
}

export const useRuntimeStops = create<RuntimeStopsState>(() => ({ byKey: {} }));

/** Records an event's stop (idempotent: the requested and the terminal event name the same stop). */
export function recordRuntimeStop(hostId: string, envelope: EventEnvelope, features: ReadonlySet<string>): void {
  const stop = runtimeStopOf(envelope, features);
  if (!stop || !envelope.cutexSessionId) return;
  const key = hostKey(hostId, envelope.cutexSessionId);
  const previous = useRuntimeStops.getState().byKey[key];
  // The requested event comes first; its terminal event keeps that time so the turn window matches.
  if (previous && previous.by.kind === stop.by.kind && Math.abs(stop.at - previous.at) < 60 && (previous.by.kind !== "agent" || stop.by.kind === "agent" && previous.by.name === stop.by.name)) return;
  useRuntimeStops.setState((state) => ({ byKey: { ...state.byKey, [key]: stop } }));
}

export function useTurnStop(hostId: string, sessionId: string, turn: Pick<TurnView, "startedAt" | "completedAt">): RuntimeStop | null {
  const stop = useRuntimeStops((state) => state.byKey[hostKey(hostId, sessionId)]);
  return stopOfTurn(stop, turn);
}
