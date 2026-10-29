import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/client";
import { ProjectEventFollower } from "../src/projectEvents";

afterEach(() => vi.useRealTimers());
const busy = () => Response.json({ error: { code: "temporarily_busy", retryable: true, details: { retryAfterMs: 100 } } }, { status: 503 });

describe("ProjectEventFollower owns HTTP retry backoff", () => {
  it("waits for outer backoff after a transient stream-opening 503", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => busy());
    const client = new CutexClient({ baseUrl: "http://project.test", token: null }, { fetch, retryRandom: () => 0 });
    const event = vi.fn(), status = vi.fn(), failed = vi.fn(), reset = vi.fn();
    const follower = new ProjectEventFollower(client, "project", { event, status, failed, reset }, { after: "pe:1", retryDelaysMs: [1_000] });
    try {
      follower.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(status.mock.calls).toEqual([["connecting"], ["retrying"]]);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(event).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      expect(follower.cursor).toBe("pe:1");
    } finally { follower.stop(); client.dispose(); }
  });

  it("does not retry a lagged catch-up 503 inside HTTP before reconnecting", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (!new URL(String(url)).pathname.endsWith("/stream")) return busy();
      if (fetch.mock.calls.length === 1) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode('event: cutex_management_stream_error\ndata: {"error":{"code":"lagged","details":{"lastDeliveredCursor":"pe:1"}}}\n\n')); },
          cancel: cancelled,
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      return busy();
    });
    const client = new CutexClient({ baseUrl: "http://project.test", token: null }, { fetch, retryRandom: () => 0 });
    const event = vi.fn(), status = vi.fn(), failed = vi.fn(), reset = vi.fn();
    const follower = new ProjectEventFollower(client, "project", { event, status, failed, reset }, { after: "pe:1", streamId: "stream-1", retryDelaysMs: [1_000] });
    try {
      follower.start();
      await vi.advanceTimersByTimeAsync(0);
      // Lagged recovery reconnects immediately; its failed opening then owns outer backoff.
      expect(fetch).toHaveBeenCalledTimes(3);
      const pages = () => fetch.mock.calls.filter(([url]) => !new URL(String(url)).pathname.endsWith("/stream"));
      expect(pages()).toHaveLength(1);
      const page = new URL(String(pages()[0]![0]));
      expect(page.searchParams.get("after")).toBe("pe:1");
      expect(page.searchParams.get("streamId")).toBe("stream-1");
      expect(cancelled).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(pages()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(event).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      expect(follower.cursor).toBe("pe:1");
    } finally { follower.stop(); client.dispose(); }
  });
});
