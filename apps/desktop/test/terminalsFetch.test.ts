import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { RequestCoalescer, terminalsRefreshKey } from "../src/renderer/src/lib/terminalsFetch";

function native(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e",
    cursor: "c",
    streamId: "s",
    sequence: 1,
    receivedAt: "",
    cutexSessionId: "me",
    hostId: "h",
    source: "app_server",
    sensitivity: "owner",
    correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

const running = () =>
  timelineFromThreadRead({ thread: { id: "t", turns: [{ id: "u1", status: "inProgress", items: [{ type: "agentMessage", id: "m1", text: "hi" }] }] } }, []);

const command = (status: string) => ({ type: "commandExecution", id: "c1", command: "sleep 100", status });

describe("terminalsRefreshKey", () => {
  it("ignores streamed text but changes when a command starts or completes", () => {
    const timeline = running();
    const idle = terminalsRefreshKey(timeline);
    applyEvent(timeline, native("item/agentMessage/delta", { threadId: "t", turnId: "u1", itemId: "m1", delta: " more" }));
    expect(terminalsRefreshKey(timeline)).toBe(idle);

    applyEvent(timeline, native("item/started", { threadId: "t", turnId: "u1", item: command("inProgress") }));
    const started = terminalsRefreshKey(timeline);
    expect(started).not.toBe(idle);
    applyEvent(timeline, native("item/commandExecution/outputDelta", { threadId: "t", turnId: "u1", itemId: "c1", delta: "x" }));
    expect(terminalsRefreshKey(timeline)).toBe(started);

    applyEvent(timeline, native("item/completed", { threadId: "t", turnId: "u1", item: command("completed") }));
    expect(terminalsRefreshKey(timeline)).not.toBe(started);
  });

  it("changes when the turn ends", () => {
    const timeline = running();
    const before = terminalsRefreshKey(timeline);
    applyEvent(timeline, native("turn/completed", { threadId: "t", turn: { id: "u1", status: "completed", items: [] } }));
    expect(terminalsRefreshKey(timeline)).not.toBe(before);
    expect(terminalsRefreshKey(null)).toBe("");
  });
});

describe("RequestCoalescer", () => {
  it("shares one in-flight request and reuses its result while fresh", async () => {
    let now = 0;
    let calls = 0;
    const coalescer = new RequestCoalescer<number>(2_000, () => now);
    const fetch = () => Promise.resolve(++calls);
    const [a, b] = await Promise.all([coalescer.get("k", fetch), coalescer.get("k", fetch)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    now = 1_500;
    expect(await coalescer.get("k", fetch)).toBe(1);
    expect(await coalescer.get("other", fetch)).toBe(2);
    now = 2_100;
    expect(await coalescer.get("k", fetch)).toBe(3);
    coalescer.invalidate("k");
    expect(await coalescer.get("k", fetch)).toBe(4);
  });

  it("does not cache failures", async () => {
    const coalescer = new RequestCoalescer<number>(2_000, () => 0);
    await expect(coalescer.get("k", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(await coalescer.get("k", () => Promise.resolve(7))).toBe(7);
  });
});
