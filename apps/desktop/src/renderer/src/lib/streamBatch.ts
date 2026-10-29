// Streamed deltas, one render per frame (perf baseline 2026-10-20, H2 / fix order 4). A session event
// is applied to its view's timeline at once (in place, in arrival order — nothing is held back or
// reordered); only the view's `version`, which is what makes React re-render, moves at most once per
// animation frame (or after `maxMs` when frames do not run, e.g. a hidden window) for the text deltas
// of a streaming reply. Any other event of that view (turn end, approval, error, item start / end …)
// bumps the version immediately as before and takes the waiting bump with it.
import type { EventEnvelope } from "@cutex-desktop/protocol";

/** Native notifications that only append text to an entry (agent reply, plan, reasoning). */
const STREAM_DELTAS = new Set([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryPartAdded",
]);

/** A text delta whose re-render may wait for the next frame. */
export function isStreamDelta(envelope: EventEnvelope): boolean {
  const native = envelope.native;
  return !!native && native.kind === "notification" && STREAM_DELTAS.has(native.message.method);
}

/** Runs `run` once, later; returns a cancel. */
export type Schedule = (run: () => void) => () => void;

/** The next animation frame, or `maxMs` at the latest (frames stop in a hidden / minimised window). */
export function frameOrTimeout(maxMs = 50): Schedule {
  return (run) => {
    let done = false;
    let frame = 0;
    const fire = () => {
      if (done) return;
      done = true;
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      clearTimeout(timer);
      run();
    };
    const timer = setTimeout(fire, maxMs);
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(fire);
    return () => {
      done = true;
      if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  };
}

/**
 * Keys waiting for one deferred flush. `add` queues a key (the flush is scheduled once for all of
 * them); `take` removes a key an immediate update has covered; `flush` runs what waits now. The flush
 * gets the keys in the order they were first queued.
 */
export class FrameBatch<K> {
  private pending = new Set<K>();
  private cancel: (() => void) | null = null;

  constructor(
    private readonly onFlush: (keys: K[]) => void,
    private readonly schedule: Schedule = frameOrTimeout(),
  ) {}

  add(key: K): void {
    this.pending.add(key);
    this.cancel ??= this.schedule(() => {
      this.cancel = null;
      this.flush();
    });
  }

  /** An immediate update of `key` covers its waiting one. True when one was waiting. */
  take(key: K): boolean {
    const had = this.pending.delete(key);
    if (!this.pending.size) this.stop();
    return had;
  }

  has(key: K): boolean {
    return this.pending.has(key);
  }

  get size(): number {
    return this.pending.size;
  }

  flush(): void {
    this.stop();
    if (!this.pending.size) return;
    const keys = [...this.pending];
    this.pending = new Set();
    this.onFlush(keys);
  }

  private stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
