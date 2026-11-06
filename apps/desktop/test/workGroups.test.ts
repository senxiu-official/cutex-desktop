import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { applyEvent, emptyTimeline, orderedEntries, type TimelineEntry } from "../src/renderer/src/lib/timeline";
import { segmentEntries } from "../src/renderer/src/lib/workGroups";

const tool = (id: string, item: Record<string, unknown>, turnId = "t1"): TimelineEntry => ({ kind: "tool", id, turnId, item: { id, ...item } as never });
const agent = (id: string, turnId = "t1"): TimelineEntry => ({ kind: "agent", id, text: "…", turnId, streaming: false });

describe("segmentEntries", () => {
  it("keeps generated images and unavailable media visible outside work groups", () => {
    const image: TimelineEntry = { kind: "other", id: "image", turnId: "t1", item: { id: "image", type: "imageGeneration", result: "data:image/png;base64,aA==" } };
    const unavailable: TimelineEntry = { kind: "other", id: "missing", turnId: "t1", item: { id: "missing", type: "imageGeneration", result: { type: "imageNotLoaded", reason: "blob_size_limit" } } };
    const segments = segmentEntries([tool("cmd", { type: "commandExecution" }), image, unavailable]);
    expect(segments.map(s => s.kind)).toEqual(["work", "entry", "entry"]);
    expect(segments[1]).toEqual({ kind: "entry", entry: image });
    expect(segments[2]).toEqual({ kind: "entry", entry: unavailable });
  });
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

describe("Claude interleaved turn, adapter wire events → timeline → work groups", () => {
  // Owner report 2026-10-21: short user-facing lines showed as 推理 · 0s inside a work group. The
  // desktop renders 推理 only for `reasoning` items; a Claude turn's interim text arrives as a
  // commentary `agentMessage` (claude-runtime subscription.py) and must stay normal text.
  const native = (method: string, params: unknown): EventEnvelope =>
    ({ contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "", cutexSessionId: "me", hostId: "h", source: "app_server", sensitivity: "owner", correlation: {}, native: { kind: "notification", message: { method, params } } }) as EventEnvelope;
  const turnId = "turn-1";
  const item = (method: "item/started" | "item/completed", body: Record<string, unknown>) => native(method, { threadId: "t", turnId, item: body });

  it("thinking stays a 推理 step; interim text between tool calls is an agent entry, not reasoning", () => {
    const state = emptyTimeline();
    const events: EventEnvelope[] = [native("turn/started", { turn: { id: turnId, status: "inProgress" } })];
    for (const n of [1, 2]) {
      const r = { type: "reasoning", id: `r${n}`, summary: [] as string[], content: [] };
      const text = `我先看看第 ${n} 个文件。`;
      const cmd = { type: "commandExecution", id: `c${n}`, command: `ls ${n}`, status: "completed", exitCode: 0 };
      events.push(
        item("item/started", r),
        native("item/reasoning/summaryTextDelta", { threadId: "t", turnId, itemId: r.id, delta: `English thought ${n}`, summaryIndex: 0 }),
        item("item/completed", { ...r, summary: [`English thought ${n}`] }),
        item("item/started", { type: "agentMessage", id: `a${n}`, text: "", phase: "commentary" }),
        native("item/agentMessage/delta", { threadId: "t", turnId, itemId: `a${n}`, delta: text }),
        item("item/completed", { type: "agentMessage", id: `a${n}`, text, phase: "commentary" }),
        item("item/started", { ...cmd, status: "inProgress" }),
        item("item/completed", cmd),
      );
    }
    for (const e of events) applyEvent(state, e);
    const segs = segmentEntries(orderedEntries(state).filter((e) => e.turnId === turnId));
    const shape = segs.map((s) => (s.kind === "work" ? `work[${s.steps.map((st) => st.kind).join(",")}]` : s.entry.kind));
    expect(shape).toEqual(["work[reasoning]", "agent", "work[tool,reasoning]", "agent", "work[tool]"]);
    const agents = segs.flatMap((s) => (s.kind === "entry" && s.entry.kind === "agent" ? [s.entry.text] : []));
    expect(agents).toEqual(["我先看看第 1 个文件。", "我先看看第 2 个文件。"]);
    const reasoningText = segs.flatMap((s) => (s.kind === "work" ? s.steps.flatMap((st) => (st.kind === "reasoning" ? st.summary : [])) : []));
    expect(reasoningText).toEqual(["English thought 1", "English thought 2"]);
  });
});

describe("workGroupOutcome", () => {
  const cmd = (id: string, status: string, exitCode: number) => tool(id, { type: "commandExecution", status, exitCode }) as import("../src/renderer/src/lib/workGroups").ToolEntry;
  it("uses a later success after failures and ignores completed reasoning for the result", async () => {
    const { workGroupOutcome, summarize } = await import("../src/renderer/src/lib/workGroups");
    const steps: import("../src/renderer/src/lib/workGroups").StepEntry[] = [cmd("bad", "completed", 1), cmd("good", "completed", 0), { kind: "reasoning", id: "r", turnId: "t1", summary: ["done"], content: [], streaming: false, startedAt: null, completedAt: null }];
    expect(workGroupOutcome(steps).status).toBe("completed");
    expect(workGroupOutcome(steps).lastTool?.id).toBe("good");
    expect(summarize(steps).failed).toBe(1);
  });
  it("uses the last edit or tool call in a mixed group", async () => {
    const { workGroupOutcome } = await import("../src/renderer/src/lib/workGroups");
    const goodEdit = tool("edit", { type: "fileChange", status: "completed", changes: [] }) as import("../src/renderer/src/lib/workGroups").ToolEntry;
    const badTool = tool("call", { type: "dynamicToolCall", status: "failed", tool: "lookup" }) as import("../src/renderer/src/lib/workGroups").ToolEntry;
    expect(workGroupOutcome([cmd("bad", "failed", 1), goodEdit]).status).toBe("completed");
    expect(workGroupOutcome([cmd("good", "completed", 0), goodEdit, badTool]).status).toBe("failed");
  });
  it("keeps running ahead of historical failures", async () => {
    const { workGroupOutcome } = await import("../src/renderer/src/lib/workGroups");
    expect(workGroupOutcome([cmd("bad", "failed", 1), cmd("live", "inProgress", 1)]).status).toBe("running");
  });
  it("uses the sole command's result", async () => {
    const { workGroupOutcome } = await import("../src/renderer/src/lib/workGroups");
    expect(workGroupOutcome([cmd("good", "completed", 0)]).status).toBe("completed");
    expect(workGroupOutcome([cmd("bad", "failed", 1)]).status).toBe("failed");
  });
});
