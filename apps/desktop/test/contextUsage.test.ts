import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, contextUsageFromLatest, contextUsageOf, emptyTimeline, seedContextUsage, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

function native(method: string, params: unknown): EventEnvelope {
  return {
    cutexSessionId: "s",
    correlation: {},
    native: { kind: "notification", message: { method, params } },
  } as unknown as EventEnvelope;
}

const usage = (threadId: string, used: number, window: number | null) =>
  native("thread/tokenUsage/updated", { threadId, turnId: "u1", tokenUsage: { total: {}, last: { inputTokens: used }, modelContextWindow: window } });
const threadRead = { thread: { id: "t", turns: [{ id: "u1", status: "completed", items: [] }] } };

describe("contextUsageOf / seedContextUsage", () => {
  it("reads the thread's last input tokens and window", () => {
    expect(contextUsageOf(usage("t", 21_000, 258_400))).toEqual({ threadId: "t", used: 21_000, window: 258_400 });
    expect(contextUsageOf(native("turn/completed", {}))).toBeNull();
    const state = emptyTimeline();
    expect(applyEvent(state, usage("t", 5, null))).toBe(true);
    expect(state.contextUsage).toEqual({ used: 5, window: null });
  });

  it("re-seeds a re-bootstrapped timeline from the same thread only", () => {
    const state = timelineFromThreadRead(threadRead);
    expect(state.contextUsage).toBeNull();
    expect(seedContextUsage(state, { threadId: "other", used: 1, window: 10 })).toBe(false);
    expect(seedContextUsage(state, { threadId: "t", used: 1_000, window: 258_400 })).toBe(true);
    expect(state.contextUsage).toEqual({ used: 1_000, window: 258_400 });
    // A live report already there wins.
    expect(seedContextUsage(state, { threadId: "t", used: 9, window: 9 })).toBe(false);
  });
});

describe("contextUsageFromLatest", () => {
  const breakdown = (inputTokens: number) => ({ totalTokens: inputTokens + 10, inputTokens, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 });
  const latest = (threadId: string, used: number) => ({
    threadId,
    turnId: "u1",
    tokenUsage: { total: breakdown(used * 3), last: breakdown(used), modelContextWindow: 258_400 },
    updatedAt: "2026-10-07T00:00:00.000Z",
  });

  it("maps cutex latestTokenUsage (recovered from the rollout) to a seedable usage", () => {
    expect(contextUsageFromLatest(null)).toBeNull();
    expect(contextUsageFromLatest(undefined)).toBeNull();
    expect(contextUsageFromLatest(latest("t", 30_000))).toEqual({ threadId: "t", used: 30_000, window: 258_400 });
  });

  it("seeds only when nothing newer is known, and a live event still wins", () => {
    const state = timelineFromThreadRead(threadRead);
    // What this desktop saw on the host feed is preferred over the bootstrap value.
    const live = { threadId: "t", used: 50_000, window: 258_400 };
    expect(seedContextUsage(state, live) || seedContextUsage(state, contextUsageFromLatest(latest("t", 30_000)))).toBe(true);
    expect(state.contextUsage).toEqual({ used: 50_000, window: 258_400 });

    const fresh = timelineFromThreadRead(threadRead);
    expect(seedContextUsage(fresh, undefined) || seedContextUsage(fresh, contextUsageFromLatest(latest("t", 30_000)))).toBe(true);
    expect(fresh.contextUsage).toEqual({ used: 30_000, window: 258_400 });
    expect(seedContextUsage(timelineFromThreadRead(threadRead), contextUsageFromLatest(latest("other", 1)))).toBe(false);
    expect(applyEvent(fresh, usage("t", 31_000, 258_400))).toBe(true);
    expect(fresh.contextUsage).toEqual({ used: 31_000, window: 258_400 });
  });
});
