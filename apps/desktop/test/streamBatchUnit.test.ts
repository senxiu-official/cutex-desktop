// lib/streamBatch (FrameBatch, isStreamDelta) and lib/timelineShape: the pieces behind per-frame streaming
// renders (perf baseline 2026-10-20, fix order 4).
import { describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { FrameBatch, isStreamDelta } from "../src/renderer/src/lib/streamBatch";
import { sameShape, timelineShape } from "../src/renderer/src/lib/timelineShape";
import { emptyTimeline } from "../src/renderer/src/lib/timeline";

const manual = () => {
  const runs: (() => void)[] = [];
  const cancelled = vi.fn();
  const schedule = vi.fn((run: () => void) => {
    runs.push(run);
    return cancelled;
  });
  return { schedule, runs, cancelled };
};
const native = (method: string, kind = "notification") => ({ native: { kind, message: { method, params: {} } } }) as unknown as EventEnvelope;

describe("FrameBatch", () => {
  it("schedules once for many keys and flushes them in first-queued order", () => {
    const m = manual();
    const flushed: string[][] = [];
    const batch = new FrameBatch<string>((keys) => void flushed.push(keys), m.schedule);
    batch.add("b");
    batch.add("a");
    batch.add("b");
    expect(m.schedule).toHaveBeenCalledTimes(1);
    m.runs[0]!();
    expect(flushed).toEqual([["b", "a"]]);
    expect(batch.size).toBe(0);
    batch.add("c");
    expect(m.schedule).toHaveBeenCalledTimes(2);
  });

  it("take: an immediate update covers the waiting one; the last one cancels the schedule", () => {
    const m = manual();
    const onFlush = vi.fn();
    const batch = new FrameBatch<string>(onFlush, m.schedule);
    batch.add("a");
    batch.add("b");
    expect(batch.take("a")).toBe(true);
    expect(m.cancelled).not.toHaveBeenCalled();
    expect(batch.take("b")).toBe(true);
    expect(m.cancelled).toHaveBeenCalledTimes(1);
    expect(batch.take("b")).toBe(false);
    batch.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("flush now runs what waits and cancels the scheduled run", () => {
    const m = manual();
    const onFlush = vi.fn();
    const batch = new FrameBatch<string>(onFlush, m.schedule);
    batch.add("a");
    batch.flush();
    expect(onFlush).toHaveBeenCalledWith(["a"]);
    expect(m.cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("isStreamDelta", () => {
  it("only text deltas wait for the frame", () => {
    for (const m of ["item/agentMessage/delta", "item/plan/delta", "item/reasoning/summaryTextDelta", "item/reasoning/textDelta"]) expect(isStreamDelta(native(m))).toBe(true);
    for (const m of ["turn/completed", "turn/started", "item/completed", "item/started", "error", "serverRequest/resolved", "thread/tokenUsage/updated"]) expect(isStreamDelta(native(m))).toBe(false);
    expect(isStreamDelta(native("item/agentMessage/delta", "serverRequest"))).toBe(false);
    expect(isStreamDelta({ cutex: { method: "cutex/userInput/submitted", params: {} } } as unknown as EventEnvelope)).toBe(false);
  });
});

describe("timelineShape", () => {
  it("ignores an entry's text, sees new entries, approvals, settings and the last turn", () => {
    const t = emptyTimeline();
    t.entries.set("m1", { kind: "agent", id: "m1", text: "a", turnId: "t1", streaming: true });
    t.turns.push({ id: "t1", status: "inProgress", startedAt: 1, completedAt: null } as never);
    const s0 = timelineShape(t);
    t.entries.set("m1", { kind: "agent", id: "m1", text: "ab", turnId: "t1", streaming: true });
    expect(sameShape(s0, timelineShape(t))).toBe(true);
    const changes: ((x: typeof t) => void)[] = [
      (x) => x.entries.set("m2", { kind: "agent", id: "m2", text: "", turnId: "t1", streaming: true }),
      (x) => x.pending.set("7", { id: 7, method: "x", params: {} }),
      (x) => (x.settings = { model: "m" }),
      (x) => (x.contextUsage = { used: 1, window: 2 }),
      (x) => ((x.turns[0] as { status: string }).status = "completed"),
      (x) => (x.activeTurnId = "t1"),
    ];
    for (const change of changes) {
      const before = timelineShape(t);
      change(t);
      expect(sameShape(before, timelineShape(t))).toBe(false);
    }
  });
});
