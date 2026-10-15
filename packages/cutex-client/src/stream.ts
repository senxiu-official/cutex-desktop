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
  options: { query?: Record<string, string | number | undefined>; reconnect?: boolean } = {},
): StreamHandle {
  const controller = new AbortController();
  let lastId: string | undefined;
  let closed = false;

  const run = async () => {
    let delay = 500;
    while (!closed) {
      try {
        const headers = client.headers({ Accept: "text/event-stream" });
        if (lastId) headers["Last-Event-ID"] = lastId;
        const response = await client.fetchRaw(client.url(path, options.query), { headers, signal: controller.signal });
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
        const parser = new SseParser();
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
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
