import { describe, expect, it } from "vitest";
import { RecentFeedTraffic, submitHttpTraceBuffer } from "../src/main/sendDiagnostics";

describe("slow-send context", () => {
  it("bounds recent raw SSE traffic without keeping stale traffic after an idle gap", () => {
    let now = 0;
    const traffic = new RecentFeedTraffic(() => now);
    traffic.add({ bytes: 200, events: 2 });
    now = 9000;
    traffic.add({ bytes: 300, events: 3 });
    expect(traffic.snapshot()).toEqual({ windowMs: 10000, bytes: 500, events: 5 });
    now = 10000;
    expect(traffic.snapshot().bytes).toBe(300);
    now = 25000;
    expect(traffic.snapshot()).toEqual({ windowMs: 10000, bytes: 0, events: 0 });
    traffic.add({ bytes: 10, events: 0 });
    expect(traffic.snapshot().bytes).toBe(10);
  });

  it("bounds attempts and copies only public timing metadata", () => {
    const buffer = submitHttpTraceBuffer();
    const event = { requestId: "r-123", attempt: 1, stage: "fetch-headers" as const, elapsedMs: 1200.5, outcome: "completed" as const, status: 200, text: "private", token: "secret" };
    buffer.observe(event);
    const first = buffer.snapshot();
    first[0]!.status = 500;
    for (let n = 0; n < 100; n++) buffer.observe(event);
    expect(buffer.snapshot()).toHaveLength(12);
    expect(buffer.snapshot()[0]).toMatchObject({ status: 200, elapsedMs: 1201 });
    expect(JSON.stringify(buffer.snapshot())).not.toMatch(/private|secret|token|text/);
  });
});
