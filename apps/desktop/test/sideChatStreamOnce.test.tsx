// Side chat text streams once (owner 2026-11-28: 思考 showed the same paragraph twice while 正在回答…), and the source
// turn shows as the owner knows it (their message, the reply's start, #n · time), never the raw turn id.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SideChat, SideEvent } from "../src/shared/sideChat";
import { applyEvent, emptyTimeline, orderedEntries, type TimelineState } from "../src/renderer/src/lib/timeline";

const views = new Map<string, { older: boolean; timeline: TimelineState }>();
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (select: (s: object) => unknown) => select({}),
  viewOf: (_s: object, _host: string, sessionId: string) => views.get(sessionId),
  agentHost: () => "local", sidebarOf: () => undefined, viewHostOf: () => "local", featuresOf: () => new Set(),
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const { sideTimeline } = await import("../src/renderer/src/modules/side-chat/model");
const { SideEntry } = await import("../src/renderer/src/modules/side-chat/SideChatBody");
const { useSourceTurn } = await import("../src/renderer/src/modules/side-chat/hooks");

const T = "turn-1", R = "reason-1", A = "answer-1";
const THOUGHT = "The owner wants the shortest path. Check the config first.";
const ANSWER = "Start with the config file, then restart.";

/** The Claude adapter's Side events (claude-runtime subscription.py → side_chats.py) as a mid-stream read returned
 *  them: recorded by reference, so each `item/started` already holds what streamed after it. */
function claudeMidStream(): SideEvent[] {
  const e = (method: string, params: unknown, seq: number): SideEvent => ({ seq, method, params });
  return [
    e("turn/started", { threadId: "side", turn: { id: T, status: "inProgress", items: [] } }, 2),
    e("item/completed", { threadId: "side", turnId: T, item: { id: "u", type: "userMessage", content: [{ type: "text", text: "Where do I start?" }] } }, 3),
    e("item/started", { threadId: "side", turnId: T, item: { type: "reasoning", id: R, summary: [THOUGHT], content: [] }, startedAtMs: 1 }, 4),
    e("item/reasoning/summaryPartAdded", { threadId: "side", turnId: T, itemId: R, summaryIndex: 0 }, 5),
    e("item/reasoning/summaryTextDelta", { threadId: "side", turnId: T, itemId: R, delta: "The owner wants the shortest path.", summaryIndex: 0 }, 6),
    e("item/reasoning/summaryTextDelta", { threadId: "side", turnId: T, itemId: R, delta: " Check the config first.", summaryIndex: 0 }, 7),
    e("item/completed", { threadId: "side", turnId: T, item: { type: "reasoning", id: R, summary: [THOUGHT], content: [] }, completedAtMs: 2 }, 8),
    e("item/started", { threadId: "side", turnId: T, item: { type: "agentMessage", id: A, text: ANSWER, phase: "commentary" }, startedAtMs: 3 }, 9),
    e("item/agentMessage/delta", { threadId: "side", turnId: T, itemId: A, delta: "Start with the config file," }, 10),
    e("item/agentMessage/delta", { threadId: "side", turnId: T, itemId: A, delta: " then restart." }, 11),
  ];
}
const chatOf = (events: SideEvent[]): SideChat => ({
  id: "c", sessionId: "s", threadId: "side", anchorTurnId: null, lastTurnId: null, forkedThroughTurnId: null, runtimeGeneration: 1,
  status: "running", createdAt: "2026-11-28T00:00:00Z", updatedAt: "2026-11-28T00:00:01Z", activeTurnId: T, revision: 11,
  events, pendingRequests: [], truncated: false, model: null, effort: null,
} as unknown as SideChat);

describe("side chat streaming text", () => {
  it("a mid-stream read with a started item that already holds the streamed text shows it once", () => {
    const entries = orderedEntries(sideTimeline(chatOf(claudeMidStream().slice(0, 5))));
    const reasoning = entries.find(e => e.kind === "reasoning");
    expect(reasoning).toMatchObject({ summary: ["The owner wants the shortest path."], streaming: true });
    const all = orderedEntries(sideTimeline(chatOf(claudeMidStream())));
    expect(all.find(e => e.kind === "reasoning")).toMatchObject({ summary: [THOUGHT] });
    expect(all.find(e => e.kind === "agent")).toMatchObject({ text: ANSWER, streaming: true });
  });

  it("after item/completed the text is the completed item's, unchanged", () => {
    const done = [...claudeMidStream(), { seq: 12, method: "item/completed", params: { threadId: "side", turnId: T, item: { type: "agentMessage", id: A, text: ANSWER } } }];
    expect(orderedEntries(sideTimeline(chatOf(done))).find(e => e.kind === "agent")).toMatchObject({ text: ANSWER, streaming: false });
  });

  it("native's own shape (started empty, then deltas) is unchanged, and so is the main timeline's", () => {
    const native = claudeMidStream().map(e => e.method === "item/started" ? { ...e, params: { ...(e.params as object), item: { ...(e.params as { item: object }).item, ...(e.seq === 4 ? { summary: [] } : { text: "" }) } } } : e);
    const side = orderedEntries(sideTimeline(chatOf(native)));
    expect(side.find(e => e.kind === "reasoning")).toMatchObject({ summary: [THOUGHT] });
    expect(side.find(e => e.kind === "agent")).toMatchObject({ text: ANSWER });
    // The main conversation gets these over the wire (serialized when sent), so its started items are empty too.
    const main = emptyTimeline();
    for (const e of native) applyEvent(main, { contractVersion: 2, eventId: String(e.seq), cursor: String(e.seq), streamId: "m", sequence: e.seq, receivedAt: "2026-11-28T00:00:01Z", cutexSessionId: "s", hostId: "local", source: "app_server", sensitivity: "owner", correlation: { threadId: "side" }, native: { kind: "notification", message: { method: e.method, params: e.params } } } as never);
    expect(orderedEntries(main).find(e => e.kind === "agent")).toMatchObject({ text: ANSWER });
  });

  it("reasoning with both full text and a summary shows one of them, like the main conversation", () => {
    const html = renderToStaticMarkup(h(SideEntry, { entry: { kind: "reasoning", id: R, turnId: T, summary: [THOUGHT], content: [THOUGHT], streaming: true, startedAt: 1, completedAt: null } }));
    expect(html.split("shortest path").length - 1).toBe(1);
  });
});

describe("the side chat's source turn", () => {
  const timeline = (): TimelineState => {
    const t = emptyTimeline();
    t.turns.push({ id: "t1", status: "completed", startedAt: 100, completedAt: 101, entryIds: ["u1", "a1"] }, { id: "t2", status: "completed", startedAt: 1_764_300_000, completedAt: 1_764_300_060, entryIds: ["u2", "a2", "a3"] });
    t.entries.set("u1", { kind: "user", id: "u1", turnId: "t1", text: "first" });
    t.entries.set("a1", { kind: "agent", id: "a1", turnId: "t1", text: "one", streaming: false });
    t.entries.set("u2", { kind: "user", id: "u2", turnId: "t2", text: "Why does the **build**\nfail on EVA?" });
    t.entries.set("a2", { kind: "agent", id: "a2", turnId: "t2", text: "Looking.", streaming: false });
    t.entries.set("a3", { kind: "agent", id: "a3", turnId: "t2", text: "## Cause\n\nThe cache   keeps old mtimes.", streaming: false });
    return t;
  };
  const Probe = ({ sessionId, turnId }: { sessionId: string; turnId: string }) => h("pre", null, JSON.stringify(useSourceTurn("local", sessionId, turnId)));
  const read = (sessionId: string, turnId: string) => JSON.parse(renderToStaticMarkup(h(Probe, { sessionId, turnId })).replace(/^<pre>|<\/pre>$/g, "").replace(/&quot;/g, '"'));

  it("is the owner's message, the start of the last reply, #n and the start time", () => {
    views.set("s", { older: false, timeline: timeline() });
    expect(read("s", "t2")).toEqual({ ordinal: 2, startedAt: 1_764_300_000, ask: "Why does the build fail on EVA?", reply: "Cause The cache keeps old mtimes." });
  });

  it("drops the ordinal when earlier turns aren't loaded; null when the turn isn't there", () => {
    views.set("s", { older: true, timeline: timeline() });
    expect(read("s", "t2")).toMatchObject({ ordinal: null, ask: "Why does the build fail on EVA?" });
    expect(read("s", "missing")).toBeNull();
    expect(read("other", "t2")).toBeNull();
  });
});
