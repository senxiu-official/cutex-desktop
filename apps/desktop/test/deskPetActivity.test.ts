// services.activity (lib/activityFeed.ts): what counts, once each, and no cost without a subscriber.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostListeners = new Set<(e: { hostId: string; envelope: unknown }) => void>();
const on = vi.fn((event: string, listener: (e: { hostId: string; envelope: unknown }) => void) => {
  expect(event).toBe("hostEvent");
  hostListeners.add(listener);
  return () => hostListeners.delete(listener);
});
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (event: string, l: (e: { hostId: string; envelope: unknown }) => void) => on(event, l) } }));

const { classifyActivity, noteOwnerMessage, seenOnce, subscribeActivity } = await import("../src/renderer/src/lib/activityFeed");

const native = (method: string, item: unknown, kind = "notification") => ({ cutexSessionId: "s1", native: { kind, message: { method, params: { threadId: "t1", item } } } });

describe("classifyActivity", () => {
  it("commands and tools, nothing else", () => {
    expect(classifyActivity(native("item/started", { type: "commandExecution", id: "a" }) as never)).toEqual({ kind: "command", key: "s1/t1/a" });
    for (const type of ["mcpToolCall", "dynamicToolCall", "fileChange", "webSearch"]) expect(classifyActivity(native("item/started", { type, id: "b" }) as never)?.kind).toBe("tool");
    for (const type of ["agentMessage", "reasoning", "userMessage", "plan"]) expect(classifyActivity(native("item/started", { type, id: "c" }) as never)).toBeNull();
    expect(classifyActivity(native("item/updated", { type: "commandExecution", id: "d" }) as never)).toBeNull();
    expect(classifyActivity(native("item/started", { type: "commandExecution", id: "e" }, "serverRequest") as never)).toBeNull();
    expect(classifyActivity({ cutexSessionId: "s1" } as never)).toBeNull();
  });

  it("seenOnce remembers a bounded number of keys", () => {
    const seen = new Set<string>();
    expect(seenOnce(seen, "a", 2)).toBe(true);
    expect(seenOnce(seen, "a", 2)).toBe(false);
    seenOnce(seen, "b", 2);
    seenOnce(seen, "c", 2);
    expect(seen.size).toBe(2);
    expect(seenOnce(seen, "a", 2)).toBe(true);
  });
});

describe("subscribeActivity", () => {
  beforeEach(() => {
    on.mockClear();
    hostListeners.clear();
  });

  it("without a subscriber nothing listens and a send does nothing", () => {
    noteOwnerMessage("local");
    expect(on).not.toHaveBeenCalled();
    expect(hostListeners.size).toBe(0);
  });

  it("the first subscriber attaches one listener, the last removes it", () => {
    const a = subscribeActivity(() => {});
    const b = subscribeActivity(() => {});
    expect(on).toHaveBeenCalledTimes(1);
    a();
    expect(hostListeners.size).toBe(1);
    b();
    expect(hostListeners.size).toBe(0);
  });

  it("a call counts once across started and completed, and per host", () => {
    const events: { kind: string; hostId: string }[] = [];
    const off = subscribeActivity((e) => events.push(e));
    const send = (hostId: string, method: string, id: string, type = "commandExecution") => {
      for (const l of hostListeners) l({ hostId, envelope: native(method, { type, id }) });
    };
    send("h1", "item/started", "x");
    send("h1", "item/completed", "x");
    send("h2", "item/started", "x");
    // A runtime that only reports the end still counts.
    send("h1", "item/completed", "y", "mcpToolCall");
    noteOwnerMessage("h1");
    expect(events).toEqual([{ kind: "command", hostId: "h1", agentId: "s1" }, { kind: "command", hostId: "h2", agentId: "s1" }, { kind: "tool", hostId: "h1", agentId: "s1" }, { kind: "ownerMessage", hostId: "h1" }]);
    off();
  });
});
