// When and how often the desktop asks for `thread/backgroundTerminals/list`. Every native request
// costs the cutex daemon a durable idempotency record (and, on a large store, ~1 s under a lock
// shared by all sessions), so a send queued behind these reads waits: re-read only when a command
// starts / finishes or the turn changes (not on every streamed delta), and let the status capsule
// and the status bar share one request. Pure helpers, unit-tested.
import type { TimelineState } from "./timeline";

/**
 * Changes when background terminals can have appeared or ended: a command item started or
 * completed in the newest turn, or the active turn / its status changed. Streamed text, reasoning
 * and other items leave it unchanged. Terminals that exit on their own are caught by the light poll.
 */
export function terminalsRefreshKey(timeline: TimelineState | null): string {
  if (!timeline) return "";
  const last = timeline.turns[timeline.turns.length - 1];
  let commands = 0;
  let done = 0;
  for (const id of last?.entryIds ?? []) {
    const entry = timeline.entries.get(id);
    if (entry?.kind !== "tool" || entry.item.type !== "commandExecution") continue;
    commands += 1;
    const status = entry.item.status;
    if (status !== "inProgress" && status !== "running") done += 1;
  }
  return `${timeline.threadId ?? ""}|${timeline.activeTurnId ?? ""}|${last?.id ?? ""}:${last?.status ?? ""}|${commands}:${done}`;
}

/**
 * One request per key in flight, and its result reused for `freshMs` after it settled: callers
 * asking for the same key at about the same time (two components, one refresh) share it. A failed
 * request is not cached.
 */
export class RequestCoalescer<T> {
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly settled = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly freshMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string, fetch: () => Promise<T>): Promise<T> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const recent = this.settled.get(key);
    if (recent && this.now() - recent.at < this.freshMs) return Promise.resolve(recent.value);
    const request = fetch().then(
      (value) => {
        this.inFlight.delete(key);
        this.settled.set(key, { at: this.now(), value });
        return value;
      },
      (error: unknown) => {
        this.inFlight.delete(key);
        this.settled.delete(key);
        throw error;
      },
    );
    this.inFlight.set(key, request);
    return request;
  }

  /** Forget the cached result (e.g. after terminating a terminal), so the next get re-reads. */
  invalidate(key: string): void {
    this.settled.delete(key);
  }
}
