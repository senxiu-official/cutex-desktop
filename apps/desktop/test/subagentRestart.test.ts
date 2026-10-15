// A native sub-agent must not stay 运行中 after its parent's runtime was stopped and restarted
// (owner report 2026-10-11): the child thread lived in the old app-server process.
import { describe, expect, it, vi } from "vitest";
import { activeSubAgents, liveAtGeneration, subAgentsOf, takeSubAgentReads, type SubAgentReadLog } from "../src/renderer/src/lib/subagents";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));

const PARENT = "thread-parent";
const CHILD = "thread-child";

// The spawn happened in a turn the owner interrupted; the child kept working (its snapshot says
// pendingInit, its own events said running) until the runtime was stopped.
const spawn = {
  type: "collabAgentToolCall",
  id: "s1",
  tool: "spawnAgent",
  status: "completed",
  senderThreadId: PARENT,
  receiverThreadIds: [CHILD],
  prompt: "redraw figure 3",
  agentsStates: { [CHILD]: { status: "pendingInit", message: null } },
};
const timeline = () => timelineFromThreadRead({ thread: { id: PARENT, turns: [{ id: "t1", status: "interrupted", items: [spawn] }] } });

describe("sub-agents across a runtime restart", () => {
  it("a child seen running under an older runtime generation is interrupted, not running", () => {
    const live = { [CHILD]: "running" };
    const seenAt = { [CHILD]: 3 };
    // The bug: the raw live status keeps it active once the restarted parent is online again.
    expect(activeSubAgents(timeline(), true, live).map((a) => a.threadId)).toEqual([CHILD]);
    const now = liveAtGeneration(live, seenAt, 4);
    expect(now).toEqual({ [CHILD]: "interrupted" });
    expect(subAgentsOf(timeline(), now).get(CHILD)?.status).toBe("interrupted");
    expect(activeSubAgents(timeline(), true, now)).toEqual([]);
  });

  it("leaves current-generation, finished and unknown-generation statuses alone", () => {
    const live = { a: "running", b: "completed", c: "pendingInit", d: "running" };
    const seenAt = { a: 4, b: 3, d: 0 };
    expect(liveAtGeneration(live, seenAt, 4)).toBe(live);
    // Unknown current generation: nothing to compare with.
    expect(liveAtGeneration({ a: "running" }, { a: 3 }, 0)).toEqual({ a: "running" });
    expect(liveAtGeneration({ a: "pendingInit" }, { a: 2 }, 3)).toEqual({ a: "interrupted" });
  });

  it("settles a snapshot-only child once per runtime generation", () => {
    const log: SubAgentReadLog = { settle: new Set(), name: new Map() };
    const agents = () => subAgentsOf(timeline()).values();
    const meta = { [CHILD]: { nickname: "Laplace", role: null } };
    expect(takeSubAgentReads("s", agents(), {}, meta, log, 0, 3)).toEqual([{ threadId: CHILD, settle: true }]);
    expect(takeSubAgentReads("s", agents(), {}, meta, log, 1, 3)).toEqual([]);
    // The read under generation 3 settled nothing (or failed); the restarted runtime has its own answer.
    expect(takeSubAgentReads("s", agents(), {}, meta, log, 2, 4)).toEqual([{ threadId: CHILD, settle: true }]);
    expect(takeSubAgentReads("s", agents(), {}, meta, log, 3, 4)).toEqual([]);
  });

  it("the store records the generation and drops a late answer for an older runtime", async () => {
    const { useApp } = await import("../src/renderer/src/store");
    const set = useApp.getState().setSubAgentStatus;
    set(CHILD, "running", 3);
    expect(useApp.getState().subAgentLive[CHILD]).toBe("running");
    expect(useApp.getState().subAgentLiveGen[CHILD]).toBe(3);
    // The restarted runtime's read says interrupted.
    set(CHILD, "interrupted", 4);
    expect(useApp.getState().subAgentLiveGen[CHILD]).toBe(4);
    // A read asked before the restart answering late is ignored.
    set(CHILD, "running", 3);
    expect(useApp.getState().subAgentLive[CHILD]).toBe("interrupted");
    // Same status, newer generation: only the generation moves.
    set(CHILD, "interrupted", 5);
    expect(useApp.getState().subAgentLiveGen[CHILD]).toBe(5);
    // Unknown generation still updates the status (older callers).
    set(CHILD, "completed");
    expect(useApp.getState().subAgentLive[CHILD]).toBe("completed");
    expect(useApp.getState().subAgentLiveGen[CHILD]).toBe(5);
  });
});
