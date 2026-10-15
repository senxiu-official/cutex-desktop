export type EnterDecision = "ime-confirm" | "palette-pick" | "mention-pick" | "newline" | "unhandled" | "no-content" | "interrupt-busy" | "command" | "dispatched";
interface EnterObservation {
  decision: EnterDecision;
  composing: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  hasContent: boolean;
  eventLagMs: number;
}
export interface EnterTraceRecord extends EnterObservation {
  source: "composer-enter";
  sessionId?: string;
  /** Distinguishes repeated decisions from the error logger's identical-message suppression. */
  sequence: number;
}
const DECISIONS = new Set<EnterDecision>(["ime-confirm", "palette-pick", "mention-pick", "newline", "unhandled", "no-content", "interrupt-busy", "command", "dispatched"]);

/** At most 20 Enter observations/minute and 200 for this mounted composer. No input data. */
export function createComposerEnterTrace(sessionId: string, sink: (record: EnterTraceRecord) => unknown, now: () => number = () => performance.now()) {
  const safeSessionId = /^[a-zA-Z0-9._:-]{1,128}$/.test(sessionId) ? sessionId : undefined;
  let sequence = 0;
  let windowStart = Number.NEGATIVE_INFINITY;
  let windowCount = 0;
  return (observation: EnterObservation): void => {
    const at = now();
    if (sequence >= 200 || !DECISIONS.has(observation.decision)) return;
    if (at - windowStart >= 60_000) { windowStart = at; windowCount = 0; }
    if (windowCount >= 20) return;
    windowCount++;
    const record: EnterTraceRecord = {
      source: "composer-enter", sessionId: safeSessionId, sequence: ++sequence,
      decision: observation.decision,
      composing: !!observation.composing, ctrl: !!observation.ctrl, meta: !!observation.meta,
      shift: !!observation.shift, alt: !!observation.alt, hasContent: !!observation.hasContent,
      eventLagMs: Number.isFinite(observation.eventLagMs) ? Math.max(0, Math.min(60_000, Math.round(observation.eventLagMs))) : 0,
    };
    // Never await IPC or invoke its sink within the keyboard handler. Main uses its async report log.
    queueMicrotask(() => {
      try { void Promise.resolve(sink(record)).catch(() => {}); } catch { /* best effort */ }
    });
  };
}
