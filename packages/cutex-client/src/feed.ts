import type { EventEnvelope } from "@cutex-desktop/protocol";
import { SSE_EVENT, SSE_STREAM_ERROR } from "@cutex-desktop/protocol";
import type { CutexClient } from "./client";
import { CutexApiError } from "./errors";
import { SseParser } from "./sse";
import { ACCESS_CHANGED_EVENT } from "./users";

/** `access_changed` (users): the token's user / grant changed; the visible set may differ, so re-bootstrap. */
export type FeedResyncReason = "stream_changed" | "cursor_expired" | "stream_reset" | "stream_error" | "access_changed";

export interface FeedPosition {
  streamId?: string;
  /** Last cursor already applied by the consumer; events strictly after it are delivered. */
  after?: string;
}

export interface EventFeedOptions extends FeedPosition {
  /** Scope to one session (`cutexSessionId` filter). Omit for the host-wide stream. */
  cutexSessionId?: string;
  /** Skip the retained backlog and start at the live tail (for host-wide UI refresh feeds). */
  fromLatest?: boolean;
  /** Reconnect backoff bounds in ms. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Bound each catch-up page (headers + body) and opening SSE headers. Read-only retries; default 30s. */
  requestTimeoutMs?: number;
  /** Abort and reconnect if nothing (event or keepalive) arrives for this long. Server sends keepalive every 15s. */
  idleTimeoutMs?: number;
}

export interface EventFeedHandlers {
  event(envelope: EventEnvelope): void;
  /** Raw SSE chunk bytes and delivered envelope count; metadata only, best effort. */
  traffic?(sample: { bytes: number; events: number }): void;
  /** Our view is invalid (new stream, expired cursor, crash reset). Feed has stopped; re-bootstrap and start a new feed. */
  resync(reason: FeedResyncReason, detail?: unknown): void;
  /** Connection state for UI ("connecting" / "live" / "retrying"). */
  status?(status: "connecting" | "live" | "retrying", error?: unknown): void;
}

const PAGE_LIMIT = 1000;

/**
 * Durable event subscription: pages `/v2/events` until caught up, then follows
 * `/v2/events/stream`, reconnecting with the last cursor. Paging on every reconnect also covers the
 * server silently dropping subscribers that lag more than 1024 events.
 */
export class EventFeed {
  private streamId: string | undefined;
  private after: string | undefined;
  private lastSequence = 0;
  private controller: AbortController | null = null;
  private stopped = false;
  /** The next reconnect wait; `reconnectNow` resets it. */
  private backoff: number;
  /** Ends the reconnect wait in progress early (null while not waiting). */
  private wake: (() => void) | null = null;

  constructor(
    private readonly client: CutexClient,
    private readonly handlers: EventFeedHandlers,
    private readonly options: EventFeedOptions = {},
  ) {
    this.streamId = options.streamId;
    this.after = options.after ?? undefined;
    this.backoff = options.minBackoffMs ?? 500;
  }

  get position(): FeedPosition {
    return { streamId: this.streamId, after: this.after };
  }

  start(): void {
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.wake?.();
  }

  /**
   * The way to the daemon is back (e.g. an SSH tunnel reconnected): end the reconnect wait in progress
   * and start the next one from the minimum again. A live stream or an attempt in flight is left alone.
   */
  reconnectNow(): void {
    if (this.stopped) return;
    this.backoff = this.options.minBackoffMs ?? 500;
    this.wake?.();
  }

  private async run(): Promise<void> {
    const minBackoff = this.options.minBackoffMs ?? 500;
    const maxBackoff = this.options.maxBackoffMs ?? 15_000;
    let skipBacklog = this.options.fromLatest === true && this.after === undefined;

    while (!this.stopped) {
      try {
        this.handlers.status?.("connecting");
        await this.catchUp(skipBacklog);
        if (this.stopped) return;
        skipBacklog = false;
        await this.follow(() => {
          this.backoff = minBackoff;
          this.handlers.status?.("live");
        });
      } catch (error) {
        if (this.stopped) return;
        if (error instanceof CutexApiError && error.requiresResync) {
          this.halt(error.code as FeedResyncReason, error.details);
          return;
        }
        // cutex ≥ r210: a nonzero cursor without its streamId is refused (400); retrying the
        // same request can never succeed, so start over from a fresh bootstrap instead.
        if (error instanceof CutexApiError && error.status === 400 && hasCursor(this.after) && /streamId/i.test(error.message)) {
          this.halt("stream_changed", error.details);
          return;
        }
        if (error instanceof ResyncSignal) {
          this.halt(error.reason, error.detail);
          return;
        }
        this.handlers.status?.("retrying", error);
      }
      if (this.stopped) return;
      const wait = this.backoff;
      this.backoff = Math.min(wait * 2, maxBackoff);
      await this.sleep(wait);
    }
  }

  /** The reconnect wait; `reconnectNow` and `stop` end it early. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (this.wake === done) this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }

  private halt(reason: FeedResyncReason, detail?: unknown): void {
    this.stopped = true;
    this.controller?.abort();
    this.handlers.resync(reason, detail);
  }

  private async catchUp(discard: boolean): Promise<void> {
    // Cursors are only meaningful inside one stream; cutex requires `streamId` with a nonzero
    // `after`. A cursor whose stream we do not know cannot be resumed: re-bootstrap.
    if (hasCursor(this.after) && !this.streamId) throw new ResyncSignal("stream_changed", { reason: "cursor without streamId" });
    if (this.stopped) return;
    const controller = new AbortController();
    this.controller = controller;
    try {
      for (;;) {
        const page = await this.withReadDeadline(this.client.events({
          streamId: this.streamId,
          after: this.after,
          limit: PAGE_LIMIT,
          cutexSessionId: this.options.cutexSessionId,
        }, { signal: controller.signal }), controller);
        // An injected transport may finish despite abort. Never deliver its stale page.
        if (this.stopped) return;
        if (this.streamId && page.streamId !== this.streamId) {
          throw new ResyncSignal("stream_changed", page);
        }
        this.streamId = page.streamId;
        for (const envelope of page.events) {
          if (discard) this.advance(envelope);
          else this.deliver(envelope);
          if (this.stopped) return;
        }
        if (page.nextCursor) this.after = page.nextCursor;
        if (!page.hasMore) return;
      }
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private async follow(onOpen: () => void): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const idleMs = this.options.idleTimeoutMs ?? 45_000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let body: ReadableStream<Uint8Array> | null = null;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new Error("event stream idle")), idleMs);
    };

    const headers = this.client.headers({ Accept: "text/event-stream" });
    if (this.after) headers["Last-Event-ID"] = this.after;
    const url = this.client.url("/v2/events/stream", {
      streamId: this.streamId,
      cutexSessionId: this.options.cutexSessionId,
    });

    try {
      const response = await this.withReadDeadline(this.client.fetchRaw(url, { headers, signal: controller.signal }), controller, (late) => {
        void late.body?.cancel().catch(() => {});
      });
      body = response.body;
      if (this.stopped) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.ok || !response.body) {
        const text = await this.withReadDeadline(response.text(), controller);
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // raw
        }
        throw CutexApiError.fromBody(response.status, body);
      }
      onOpen();
      if (this.stopped) return;
      touch();
      const parser = new SseParser(() => touch());
      const decoder = new TextDecoder();
      reader = response.body.getReader();
      for (;;) {
        const { value, done } = await abortableRead(reader.read(), controller.signal);
        if (done || this.stopped) break;
        touch();
        let events = 0;
        try {
          for (const message of parser.push(decoder.decode(value, { stream: true }))) {
            if (this.stopped) return;
            if (message.event === SSE_STREAM_ERROR) {
              throw new ResyncSignal("stream_error", safeJson(message.data));
            }
            // users: the stream ends because the token's user or grant changed (not a revoke).
            if (message.event === ACCESS_CHANGED_EVENT) {
              throw new ResyncSignal("access_changed", safeJson(message.data));
            }
            if (message.event !== SSE_EVENT) continue;
            if (this.deliver(JSON.parse(message.data) as EventEnvelope)) events++;
          }
        } finally {
          // Telemetry must not interrupt delivery or expose event payloads.
          try { this.handlers.traffic?.({ bytes: value.byteLength, events }); } catch { /* best effort */ }
        }
      }
    } finally {
      clearTimeout(idleTimer);
      // A timeout or parser/consumer failure must close the old subscription before retrying.
      controller.abort();
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      } else {
        void body?.cancel().catch(() => {});
      }
      if (this.controller === controller) this.controller = null;
    }
  }

  private async withReadDeadline<T>(pending: Promise<T>, controller: AbortController, discardLate?: (value: T) => void): Promise<T> {
    const timer = setTimeout(() => controller.abort(new Error("event feed read timed out")), this.options.requestTimeoutMs ?? 30_000);
    try {
      return await abortableRead(pending, controller.signal, discardLate);
    } finally {
      clearTimeout(timer);
    }
  }

  private advance(envelope: EventEnvelope): boolean {
    if (envelope.streamId !== this.streamId && this.streamId !== undefined) {
      throw new ResyncSignal("stream_changed", envelope);
    }
    if (envelope.sequence <= this.lastSequence) return false; // duplicate across page/stream boundary
    this.lastSequence = envelope.sequence;
    this.after = envelope.cursor;
    return true;
  }

  private deliver(envelope: EventEnvelope): boolean {
    if (!this.advance(envelope)) return false;
    this.handlers.event(envelope);
    if (envelope.cutex?.method === "cutex/stream/reset") {
      throw new ResyncSignal("stream_reset", envelope.cutex.params);
    }
    return true;
  }
}

class ResyncSignal extends Error {
  constructor(readonly reason: FeedResyncReason, readonly detail?: unknown) {
    super(`resync required: ${reason}`);
  }
}

/** A resume cursor cutex treats as "after something" (absent / "" / "0" start from the beginning). */
function hasCursor(after: string | undefined): boolean {
  return !!after && after !== "0";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Bound even an injected transport that ignores abort; late results never advance the cursor. */
function abortableRead<T>(pending: Promise<T>, signal: AbortSignal, discardLate?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("event feed read aborted"));
    if (signal.aborted) aborted();
    else signal.addEventListener("abort", aborted, { once: true });
    pending.then((value) => {
      signal.removeEventListener("abort", aborted);
      if (signal.aborted) discardLate?.(value);
      else resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", aborted);
      reject(error);
    });
  });
}
