import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { reasoningLastLine, reasoningPreview, reasoningText, type ReasoningEntry } from "../src/renderer/src/lib/reasoning";
import { applyEvent, emptyTimeline, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

function native(method: string, params: unknown, receivedAt = ""): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e",
    cursor: "c",
    streamId: "s",
    sequence: 1,
    receivedAt,
    cutexSessionId: "me",
    hostId: "h",
    source: "app_server",
    sensitivity: "owner",
    correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

const at = (s: number) => new Date(s * 1000).toISOString();
const item = (extra: Record<string, unknown> = {}) => ({ type: "reasoning", id: "r1", summary: [], content: [], ...extra });
const entry = (summary: string[], content: string[]): ReasoningEntry => ({ kind: "reasoning", id: "r", turnId: "t", summary, content, streaming: false, startedAt: null, completedAt: null });

describe("reasoning entries", () => {
  it("builds the text from live deltas, keeps it when the item completes empty, and times it", () => {
    const tl = emptyTimeline();
    applyEvent(tl, native("turn/started", { turn: { id: "t1", status: "inProgress", startedAt: 100 } }));
    applyEvent(tl, native("item/started", { turnId: "t1", item: item() }, at(100)));
    applyEvent(tl, native("item/reasoning/textDelta", { turnId: "t1", itemId: "r1", contentIndex: 0, delta: "Step one. " }, at(101)));
    applyEvent(tl, native("item/reasoning/textDelta", { turnId: "t1", itemId: "r1", contentIndex: 0, delta: "wait —" }, at(102)));
    applyEvent(tl, native("item/reasoning/summaryPartAdded", { turnId: "t1", itemId: "r1", summaryIndex: 1 }, at(103)));
    applyEvent(tl, native("item/reasoning/summaryTextDelta", { turnId: "t1", itemId: "r1", summaryIndex: 1, delta: "**Plan**" }, at(103)));
    expect(tl.entries.get("r1")).toMatchObject({ kind: "reasoning", content: ["Step one. wait —"], summary: ["", "**Plan**"], streaming: true, startedAt: 100 });
    applyEvent(tl, native("item/completed", { turnId: "t1", item: item() }, at(109)));
    expect(tl.entries.get("r1")).toMatchObject({ content: ["Step one. wait —"], streaming: false, startedAt: 100, completedAt: 109 });
    expect(tl.turns[0]!.entryIds).toEqual(["r1"]);
  });

  it("takes the completed item's text when it has some, and stops streaming at turn end", () => {
    const tl = emptyTimeline();
    applyEvent(tl, native("turn/started", { turn: { id: "t1", status: "inProgress", startedAt: 100 } }));
    applyEvent(tl, native("item/reasoning/summaryTextDelta", { turnId: "t1", itemId: "r1", summaryIndex: 0, delta: "partial" }, at(100)));
    applyEvent(tl, native("item/completed", { turnId: "t1", item: item({ summary: ["**Full** summary"] }) }, at(104)));
    expect(tl.entries.get("r1")).toMatchObject({ summary: ["**Full** summary"], completedAt: 104 });
    applyEvent(tl, native("item/reasoning/textDelta", { turnId: "t1", itemId: "r2", contentIndex: 0, delta: "cut off" }, at(105)));
    applyEvent(tl, native("turn/completed", { turn: { id: "t1", status: "interrupted", completedAt: 106 } }));
    expect(tl.entries.get("r2")).toMatchObject({ streaming: false, completedAt: 106 });
  });

  it("loads history items without times", () => {
    const tl = timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t1", status: "completed", items: [item({ content: ["thought"] })] }] } } as never);
    expect(tl.entries.get("r1")).toMatchObject({ kind: "reasoning", content: ["thought"], streaming: false, startedAt: null, completedAt: null });
  });

  it("shows full reasoning over summaries, else nothing", () => {
    expect(reasoningText(entry(["**Plan**\n\nsummary"], ["full", "", "thoughts"]))).toEqual({ source: "content", text: "full\n\nthoughts" });
    expect(reasoningText(entry(["**Plan**", " ", "more"], []))).toEqual({ source: "summary", text: "**Plan**\n\nmore" });
    expect(reasoningText(entry([""], [" "]))).toBeNull();
  });

  it("previews full reasoning's current paragraph, else the latest summary title", () => {
    expect(reasoningPreview(null)).toBeNull();
    expect(reasoningPreview(entry([], []))).toBeNull();
    expect(reasoningPreview(entry(["**Old**", "**Checking tests**\n\nI will…"], []))).toBe("Checking tests");
    expect(reasoningPreview(entry(["**Plan**"], ["Step one.\n\nwait — `module_tick` needs state"]))).toBe("wait — module_tick needs state");
  });
});

describe("reasoningLastLine", () => {
  const base = { kind: "reasoning", id: "r", turnId: "t", streaming: true, startedAt: null, completedAt: null } as const;
  it("is the last non-empty line of the shown text, markdown stripped", () => {
    expect(reasoningLastLine({ ...base, content: ["先看协议。\n\n**再确认** 字段"], summary: [] })).toBe("再确认 字段");
    // GLM: full reasoning arrives as summary parts.
    expect(reasoningLastLine({ ...base, content: [], summary: ["第一段", "第二段\n最后一行"] })).toBe("最后一行");
    expect(reasoningLastLine({ ...base, content: [], summary: [] })).toBeNull();
  });
});
