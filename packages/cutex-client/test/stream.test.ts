import { describe, expect, it } from "vitest";
import { CutexClient } from "../src/client";
import { openStream } from "../src/stream";

const endpoint = { baseUrl: "http://127.0.0.1:1", token: "t", configPath: "test" };

/** A response whose body sends `chunks` and then stays open (a half-open connection) until aborted. */
function hangingResponse(chunks: string[], signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("openStream", () => {
  it("reconnects a silent stream after idleTimeoutMs", async () => {
    let opens = 0;
    const fetch = (async (_url: string, init?: RequestInit) => {
      opens++;
      return hangingResponse([`event: ready\ndata: {"n":${opens}}\n\n`], init!.signal!);
    }) as typeof globalThis.fetch;
    const client = new CutexClient(endpoint, { fetch });
    const ready: string[] = [];
    const handle = openStream(client, "/watch", { onMessage: (m) => ready.push(m.data) }, { reconnect: true, idleTimeoutMs: 40 });
    await expect.poll(() => ready.length, { timeout: 3000 }).toBeGreaterThanOrEqual(2);
    handle.close();
    expect(ready.slice(0, 2)).toEqual(['{"n":1}', '{"n":2}']);
  });

  it("keepalive comments hold an idle-timed stream open", async () => {
    let opens = 0;
    const fetch = (async (_url: string, init?: RequestInit) => {
      opens++;
      const encoder = new TextEncoder();
      const signal = init!.signal!;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
          const timer = setInterval(() => controller.enqueue(encoder.encode(": keepalive\n\n")), 10);
          signal.addEventListener("abort", () => {
            clearInterval(timer);
            controller.error(signal.reason);
          }, { once: true });
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof globalThis.fetch;
    const client = new CutexClient(endpoint, { fetch });
    const handle = openStream(client, "/watch", { onMessage: () => {} }, { reconnect: true, idleTimeoutMs: 60 });
    await new Promise((r) => setTimeout(r, 250));
    handle.close();
    expect(opens).toBe(1);
  });

  it("without idleTimeoutMs a silent stream stays on one connection", async () => {
    let opens = 0;
    const fetch = (async (_url: string, init?: RequestInit) => {
      opens++;
      return hangingResponse(["event: ready\ndata: {}\n\n"], init!.signal!);
    }) as typeof globalThis.fetch;
    const client = new CutexClient(endpoint, { fetch });
    const handle = openStream(client, "/term", { onMessage: () => {} }, { reconnect: true });
    await new Promise((r) => setTimeout(r, 150));
    handle.close();
    expect(opens).toBe(1);
  });
});
