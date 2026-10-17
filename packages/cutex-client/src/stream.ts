import type { CutexClient } from "./client";
import { CutexApiError } from "./errors";
import { SseParser, type SseMessage } from "./sse";

export interface StreamHandle {
  close(): void;
}

/**
 * Keep an auxiliary SSE stream open (workspace watch, terminal output): reconnects with backoff
 * and resumes from the last event id when the server provides ids. Distinct from `EventFeed`,
 * which handles the durable management event log.
 */
export function openStream(
  client: CutexClient,
  path: string,
  handlers: { onMessage(message: SseMessage): void; onError?(error: unknown): void; onEnd?(): void },
  options: {
    query?: Record<string, string | number | undefined>;
    reconnect?: boolean;
    /**
     * Abort and reconnect when nothing (message or `: keepalive` comment) arrives for this long: a
     * half-open connection (sleep / wake, a dropped SSH tunnel) otherwise never ends. Off by default;
     * set it only for streams whose server sends keepalives (workspace watch: every 15 s).
     */
    idleTimeoutMs?: number;
  } = {},
): StreamHandle {
  let controller = new AbortController();
  let lastId: string | undefined;
  let closed = false;

  const run = async () => {
    let delay = 500;
    while (!closed) {
      const attempt = new AbortController();
      controller = attempt;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const touch = () => {
        if (!options.idleTimeoutMs) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => attempt.abort(new Error("stream idle")), options.idleTimeoutMs);
      };
      try {
        touch();
        const headers = client.headers({ Accept: "text/event-stream" });
        if (lastId) headers["Last-Event-ID"] = lastId;
        const response = await client.fetchRaw(client.url(path, options.query), { headers, signal: attempt.signal });
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => "");
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            // raw
          }
          throw CutexApiError.fromBody(response.status, body);
        }
        delay = 500;
        touch();
        const parser = new SseParser(() => touch());
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await abortable(reader.read(), attempt.signal).catch((error: unknown) => {
            void reader.cancel().catch(() => {});
            throw error;
          });
          if (done) break;
          touch();
          for (const message of parser.push(decoder.decode(value, { stream: true }))) {
            if (message.id) lastId = message.id;
            handlers.onMessage(message);
          }
        }
        handlers.onEnd?.();
        if (!options.reconnect) return;
      } catch (error) {
        if (closed) return;
        handlers.onError?.(error);
        if (!options.reconnect || (error instanceof CutexApiError && error.status < 500 && error.status !== 429)) return;
      } finally {
        clearTimeout(idleTimer);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10_000);
    }
  };
  void run();
  return {
    close() {
      closed = true;
      controller.abort();
    },
  };
}

/** `pending`, or the signal's reason once it aborts (an idle stream's read never settles by itself). */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}
