import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../src/renderer/src/lib/timeline";
import { segmentEntries } from "../src/renderer/src/lib/workGroups";

const tool = (id: string, item: Record<string, unknown>, turnId = "t1"): TimelineEntry => ({ kind: "tool", id, turnId, item: { id, ...item } as never });
const agent = (id: string, turnId = "t1"): TimelineEntry => ({ kind: "agent", id, text: "…", turnId, streaming: false });

describe("segmentEntries", () => {
  it("counts a Claude agent's Agent / Task calls as subagent actions, not tools", () => {
    const segs = segmentEntries([
      tool("a", { type: "commandExecution", command: "ls", status: "completed", exitCode: 0 }),
      tool("b", { type: "dynamicToolCall", namespace: "claude", tool: "Agent", status: "completed" }),
      tool("c", { type: "dynamicToolCall", namespace: "claude", tool: "Task", status: "inProgress" }),
      tool("d", { type: "dynamicToolCall", namespace: "claude", tool: "WebSearch", status: "completed" }),
      agent("m1"),
    ]);
    const first = segs[0] as Extract<(typeof segs)[number], { kind: "work" }>;
    expect(first.summary).toMatchObject({ commands: 1, tools: 1, agents: 2 });
  });
  it("closes a work group when the agent writes text and summarizes it", () => {
    const segs = segmentEntries(
      [
        tool("a", { type: "commandExecution", command: "ls", status: "completed", exitCode: 0, durationMs: 1000 }),
        { kind: "other", id: "r", turnId: "t1", item: { id: "r", type: "reasoning" } },
        tool("b", { type: "commandExecution", command: "cargo test", status: "failed", exitCode: 101, durationMs: 2500 }),
        tool("c", { type: "fileChange", changes: [{ path: "a.ts" }, { path: "b.ts" }], status: "completed" }),
        tool("d", { type: "fileChange", changes: [{ path: "a.ts" }], status: "completed" }),
        agent("m1"),
        tool("e", { type: "mcpToolCall", server: "cutex", tool: "send_message", status: "completed" }),
      ],
    );
    expect(segs.map((s) => s.kind)).toEqual(["work", "entry", "work"]);
    const first = segs[0]!;
    if (first.kind !== "work") throw new Error();
    expect(first.open).toBe(false);
    expect(first.summary).toEqual({ commands: 2, files: 2, tools: 0, agents: 0, failed: 1, durationMs: 3500, reasoning: 0 });
    const last = segs[2]!;
    expect(last.kind === "work" && last.open).toBe(true);
  });

  it("keeps a trailing group open even after the turn ends", () => {
    const segs = segmentEntries([tool("a", { type: "commandExecution", status: "completed" })]);
    expect(segs[0]!.kind === "work" && segs[0]!.open).toBe(true);
  });

  it("received / sent messages also close the group", () => {
    const segs = segmentEntries(
      [
        tool("a", { type: "commandExecution", status: "completed" }),
        { kind: "sent", id: "s", turnId: "t1", to: "x", deliveryMode: "auto", text: "hi" },
        tool("b", { type: "commandExecution", status: "completed" }),
      ],
    );
    expect(segs.map((s) => s.kind)).toEqual(["work", "entry", "work"]);
  });

  it("folds reasoning with text into the steps, never empty reasoning, and names it only when alone", () => {
    const thought = (id: string, content: string[]): TimelineEntry => ({ kind: "reasoning", id, turnId: "t1", summary: [], content, streaming: false, startedAt: null, completedAt: null });
    const entries: TimelineEntry[] = [
      thought("r1", ["look at the queue"]),
      tool("a", { type: "commandExecution", command: "ls", status: "completed" }),
      thought("r2", [""]),
      agent("m1"),
      thought("r3", ["just thinking"]),
      thought("r4", ["more"]),
      agent("m2"),
    ];
    const segs = segmentEntries(entries);
    expect(segs.map((s) => s.kind)).toEqual(["work", "entry", "work", "entry"]);
    const [first, , second] = segs;
    if (first?.kind !== "work" || second?.kind !== "work") throw new Error();
    expect(first.steps.map((s) => s.id)).toEqual(["r1", "a"]);
    expect(first.summary).toMatchObject({ commands: 1, reasoning: 1 });
    expect(second.steps.map((s) => s.id)).toEqual(["r3", "r4"]);
    expect(second.summary).toMatchObject({ commands: 0, reasoning: 2 });
    // 推理过程 = 隐藏: reasoning leaves the timeline entirely.
    expect(segmentEntries(entries, { reasoning: false }).map((s) => s.kind)).toEqual(["work", "entry", "entry"]);
  });
});
