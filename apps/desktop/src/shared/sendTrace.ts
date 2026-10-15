/** Slow-send diagnostics only: never pass message bodies, attachment paths or thrown values here. */
export interface SendTraceContext {
  stage: "chain-wait" | "ipc-submit" | "prepare-input" | "daemon-submit";
  hostId?: string;
  sessionId: string;
  clientUserMessageId?: string;
}

export interface SendTraceRecord {
  source: "send-latency";
  method: SendTraceContext["stage"];
  message: string;
  hostId?: string;
  sessionId?: string;
  clientUserMessageId?: string;
  outcome: "pending" | "succeeded" | "failed";
  elapsedMs: number;
}

type Sink = (record: SendTraceRecord) => unknown;
const safeId = (value: unknown): string | undefined =>
  typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined;

/** One pending observation at 5 s, then the outcome for stages lasting at least 1 s.
 * The sink is best effort and deliberately never receives the operation's input/result/error.
 */
export function traceSendStage<T>(context: SendTraceContext, sink: Sink, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const ids = {
    hostId: safeId(context.hostId),
    sessionId: safeId(context.sessionId),
    clientUserMessageId: safeId(context.clientUserMessageId),
  };
  const emit = (outcome: SendTraceRecord["outcome"]) => {
    const elapsedMs = Math.max(0, Math.round(performance.now() - started));
    if (outcome !== "pending" && elapsedMs < 1000) return;
    try {
      // Include correlation + outcome in message so errors.jsonl's repeat filter keeps each send.
      void Promise.resolve(sink({
        source: "send-latency", method: context.stage,
        message: `send-latency ${context.stage} ${outcome} ${ids.clientUserMessageId ?? "unknown"}`,
        ...ids, outcome, elapsedMs,
      })).catch(() => {});
    } catch { /* Diagnostics must never affect submission. */ }
  };
  const timer = setTimeout(() => emit("pending"), 5000);
  const finish = (outcome: "succeeded" | "failed") => {
    try { emit(outcome); } finally { clearTimeout(timer); }
  };
  try {
    const pending = run();
    // Observe the original promise instead of adding an await: dispatch ordering and the
    // existing caller's microtask timing stay intact, even for immediately resolved stages.
    void pending.then(() => finish("succeeded"), () => finish("failed"));
    return pending;
  } catch (error) {
    finish("failed");
    return Promise.reject(error);
  }
}
