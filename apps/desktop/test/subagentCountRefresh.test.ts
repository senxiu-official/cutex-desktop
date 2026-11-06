// Owner report 2026-11-06: the sub-agent count stayed at 3 after sub-agents finished, until a click.
// Reproduced on a private r277 instance (real Claude runtime): three background subagents, the owner
// looked at another agent while two finished, then came back. A child's own events come only on its
// parent's feed, and that feed is closed while the agent is not open, so the children's
// `turn/completed` never arrived. The re-read parent timeline said completed, but the child status
// heard earlier ("running") outranked it and no settle read ran (one per generation, only without a
// child status). Now a load forgets those statuses and settles once per loaded timeline.
import { describe, expect, it, vi } from "vitest";
import { activeSubAgents, forgetSubAgents, subAgentsOf, takeSubAgentReads, timelineLoad, type SubAgentReadLog } from "../src/renderer/src/lib/subagents";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, onEvent: () => () => {} }));

const ref = (task: string) => `claude:sess:task:${task}`;
const [A, B, C] = [ref("a"), ref("b"), ref("c")];
const activity = (id: string, kind: string, thread: string) => ({ type: "subAgentActivity", id, kind, agentThreadId: thread, agentPath: `/claude/${thread.slice(-1)}` });

// Claude background subagents as the r277 adapter records them on the parent thread.
function claudeParent(finished: string[]) {
  const items = [A, B, C].map((t, i) => activity(`s${i}`, "started", t));
  const later = finished.map((t, i) => ({ id: `t${i + 2}`, status: "completed", items: [activity(`c${i}`, "completed", t)] }));
  return timelineFromThreadRead({ thread: { id: "thread-parent", turns: [{ id: "t1", status: "completed", items }, ...later] } } as never);
}

// Codex: three spawns (call-time snapshot pendingInit), then a `wait` that reports two completed.
function codexParent(waited: boolean) {
  const spawn = (id: string, child: string) => ({ type: "collabAgentToolCall", id, tool: "spawnAgent", status: "completed", senderThreadId: "thread-parent", receiverThreadIds: [child], prompt: child, agentsStates: { [child]: { status: "pendingInit", message: null } } });
  const items: unknown[] = [spawn("s1", "c1"), spawn("s2", "c2"), spawn("s3", "c3")];
  if (waited) items.push({ type: "collabAgentToolCall", id: "w1", tool: "wait", status: "completed", senderThreadId: "thread-parent", receiverThreadIds: ["c1", "c2"], agentsStates: { c1: { status: "completed", message: "done" }, c2: { status: "completed", message: "done" } } });
  return timelineFromThreadRead({ thread: { id: "thread-parent", turns: [{ id: "t1", status: "completed", items }] } } as never);
}

const log = (): SubAgentReadLog => ({ settle: new Set(), name: new Map() });
const named = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { nickname: id, role: null }]));

describe("sub-agent count after the agent was not open", () => {
  it.each([
    { shape: "claude background", ids: [A, B, C], before: claudeParent([]), after: claudeParent([A, B]) },
    { shape: "codex", ids: ["c1", "c2", "c3"], before: codexParent(false), after: codexParent(true) },
  ])("$shape: the re-read timeline counts, then one settle read per active child", ({ ids, before, after }) => {
    // Heard on the feed while the agent was open: all three working.
    const live = Object.fromEntries(ids.map((id) => [id, "running"]));
    const seenAt = Object.fromEntries(ids.map((id) => [id, 1]));
    expect(activeSubAgents(before, true, live)).toHaveLength(3);
    // The bug: back on the agent, its re-read timeline says two finished, the stale child status wins.
    expect(activeSubAgents(after, true, live)).toHaveLength(3);
    const reads = log();
    expect(takeSubAgentReads("s", subAgentsOf(after, live).values(), live, named(ids), reads, 0, 1, true, timelineLoad(before))).toEqual([]);

    // The load forgets them: the parent's timeline decides at once …
    const forgotten = forgetSubAgents(live, seenAt, subAgentsOf(after).keys())!;
    expect(forgotten.live).toEqual({});
    expect(forgotten.seenAt).toEqual({});
    expect(activeSubAgents(after, true, forgotten.live).map((a) => a.threadId)).toEqual([ids[2]]);
    // … and the child still active gets one settle read for this loaded timeline, not again until the next load.
    const load = timelineLoad(after);
    expect(takeSubAgentReads("s", subAgentsOf(after, forgotten.live).values(), forgotten.live, named(ids), reads, 0, 1, true, load)).toEqual([{ threadId: ids[2], settle: true }]);
    expect(takeSubAgentReads("s", subAgentsOf(after, forgotten.live).values(), forgotten.live, named(ids), reads, 1, 1, true, load)).toEqual([]);
  });

  it("forgets only the given children and keeps unchanged maps", () => {
    const live = { x: "running", y: "completed" };
    const seenAt = { x: 2 };
    expect(forgetSubAgents(live, seenAt, ["z"])).toBeNull();
    expect(forgetSubAgents(live, seenAt, ["y"])).toEqual({ live: { x: "running" }, seenAt });
    expect(live).toEqual({ x: "running", y: "completed" });
  });

  it("numbers each loaded timeline once", () => {
    const one = claudeParent([]), two = claudeParent([]);
    expect(timelineLoad(one)).toBe(timelineLoad(one));
    expect(timelineLoad(two)).not.toBe(timelineLoad(one));
    expect(timelineLoad(null)).toBe(0);
  });
});
