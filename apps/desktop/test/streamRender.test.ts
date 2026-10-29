import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "../src/renderer/src/store";
import type { TimelineEntry } from "../src/renderer/src/lib/timeline";
vi.mock("../src/renderer/src/store", () => ({ useApp: vi.fn(), viewOf: vi.fn() }));
import { conversationStructureSelector, createStreamRenderSource, STREAM_RENDER_MS } from "../src/renderer/src/lib/streamRender";

function fixture() {
  const entry: TimelineEntry = { kind: "agent", id: "reply", turnId: "turn", streaming: true, text: "" };
  return {
    version: 1, textVersion: 0, loading: false, connection: "live", queue: [],
    timeline: { threadId: "thread", entries: new Map([[entry.id, entry]]), turns: [{ id: "turn", status: "inProgress", entryIds: [entry.id] }], activeTurnId: "turn" },
  } as unknown as SessionView;
}
function delta(view: SessionView, text: string): SessionView {
  const old = view.timeline.entries.get("reply")!;
  view.timeline.entries.set("reply", { ...old, id: "reply", kind: "agent", turnId: "turn", streaming: true, text });
  return { ...view, version: view.version + 1, textVersion: (view.textVersion ?? 0) + 1 };
}
afterEach(() => vi.useRealTimers());

describe("conversation structure versus streamed text", () => {
  it("keeps the conversation snapshot while an existing agent entry receives text", () => {
    const select = conversationStructureSelector();
    const view = fixture();
    expect(select(view)).toBe(view);
    let next = view;
    for (let i = 1; i <= 100; i++) {
      next = delta(next, "text".repeat(i));
      expect(select(next)).toBe(view);
    }
    expect(next.timeline.entries.get("reply")).toMatchObject({ text: "text".repeat(100) });
  });
  it("publishes item completion and non-versioned view metadata immediately", () => {
    const select = conversationStructureSelector(), original = fixture();
    select(original);
    const streamed = delta(original, "full reply");
    select(streamed);
    const finished = { ...streamed, version: streamed.version + 1 };
    finished.timeline.entries.set("reply", { kind: "agent", id: "reply", turnId: "turn", streaming: false, text: "full reply" });
    expect(select(finished)).toBe(finished);
    const queue = { ...finished, queue: [{ id: "new" }] } as unknown as SessionView;
    expect(select(queue)).toBe(queue);
    expect(select(undefined)).toBeUndefined();
    expect(select(fixture())).not.toBe(queue);
  });
  it("does not hide a delta that creates a missing row without item/started", () => {
    const select = conversationStructureSelector(), original = fixture();
    original.timeline.entries.clear(); original.timeline.turns[0]!.entryIds = [];
    select(original);
    original.timeline.turns[0]!.entryIds.push("reply");
    const next = delta(original, "first text");
    expect(select(next)).toBe(next);
  });
  it("retains the existing reasoning path, including the first nonempty reasoning row", () => {
    const select = conversationStructureSelector(), original = fixture();
    const reasoning: TimelineEntry = { kind: "reasoning", id: "think", turnId: "turn", summary: [], content: [], streaming: true, startedAt: 1, completedAt: null };
    original.timeline.entries.set(reasoning.id, reasoning); original.timeline.turns[0]!.entryIds.push(reasoning.id);
    select(original);
    original.timeline.entries.set(reasoning.id, { ...reasoning, content: ["thinking"] });
    const next = { ...original, version: original.version + 1, textVersion: 1 };
    expect(select(next)).toBe(next);
  });
});

describe("one presentation clock for the live rows", () => {
  function clock() {
    let view = fixture();
    let changed = () => {};
    const unsubscribe = vi.fn();
    const source = createStreamRenderSource(() => view, (listener) => { changed = listener; return unsubscribe; });
    return { source, unsubscribe, text: (text: string) => { view = delta(view, text); changed(); },
      finish: () => { view = { ...view, version: view.version + 1 }; changed(); } };
  }
  it("coalesces only presentation, reads the complete latest text and notifies all rows together", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const c = clock(), first = vi.fn(), second = vi.fn();
    const off = c.source.subscribe(first), off2 = c.source.subscribe(second);
    c.text("a");
    expect(first).toHaveBeenCalledTimes(1);
    for (let i = 1; i < STREAM_RENDER_MS; i++) { vi.advanceTimersByTime(1); c.text("x".repeat(i)); }
    expect(first).toHaveBeenCalledTimes(1);
    expect(c.source.read()!.timeline.entries.get("reply")).toMatchObject({ text: "x".repeat(STREAM_RENDER_MS - 1) });
    vi.advanceTimersByTime(1);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    off(); off2();
  });
  it("flushes a pending text update immediately when the item finishes, without a stale timer", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const c = clock(), notify = vi.fn(); c.source.subscribe(notify);
    c.text("first"); vi.advanceTimersByTime(5); c.text("final text");
    expect(notify).toHaveBeenCalledTimes(1);
    c.finish();
    expect(notify).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(STREAM_RENDER_MS * 2);
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it("cancels pending publication when the last row unmounts and reconnects on the latest view", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const c = clock(), notify = vi.fn(), off = c.source.subscribe(notify);
    c.text("first"); vi.advanceTimersByTime(5); c.text("pending"); off();
    vi.advanceTimersByTime(STREAM_RENDER_MS * 2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(c.unsubscribe).toHaveBeenCalledOnce();
    const revision = c.source.getRevision(); const off2 = c.source.subscribe(notify);
    expect(c.source.getRevision()).toBeGreaterThan(revision);
    expect(c.source.read()!.timeline.entries.get("reply")).toMatchObject({ text: "pending" }); off2();
  });
});
