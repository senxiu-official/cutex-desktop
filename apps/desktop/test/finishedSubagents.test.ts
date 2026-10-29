import { describe, expect, it } from "vitest";
import { backgroundClaudeRefs, finishedSubAgents, subAgentSpanFromThreadRead } from "../src/renderer/src/lib/finishedSubagents";
import { claudeTaskIdOf, claudeTaskStatus } from "../src/renderer/src/lib/claudeTasks";
import { activeSubAgents, claudeTaskStatusFromEvent } from "../src/renderer/src/lib/subagents";
import { stopsClaudeTasks } from "../src/renderer/src/lib/agentFeatures";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { zhCN } from "../src/renderer/src/modules/subagents/i18n";
import { en } from "../src/renderer/src/modules/subagents/i18n.en";

const PARENT = "00000000-0000-7000-8000-000000000001";
const A = "00000000-0000-7000-8000-00000000000a";
const B = "00000000-0000-7000-8000-00000000000b";
const C = "00000000-0000-7000-8000-00000000000c";

const collab = (id: string, tool: string, receiver: string, status: string, prompt: string | null = null) => ({
  type: "collabAgentToolCall",
  id,
  tool,
  status: "completed",
  senderThreadId: PARENT,
  receiverThreadIds: [receiver],
  prompt,
  model: null,
  reasoningEffort: null,
  agentsStates: { [receiver]: { status, message: null } },
});

const agentCard = (id: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "dynamicToolCall",
  id,
  namespace: "claude",
  tool: "Agent",
  arguments: args,
  status: "completed",
  contentItems: [{ type: "inputText", text: "done" }],
  success: true,
  durationMs: 48_000,
  ...extra,
});

function timeline(turns: { id: string; status: string; items: unknown[] }[]) {
  return timelineFromThreadRead({ thread: { id: PARENT, turns } });
}

describe("finishedSubAgents", () => {
  it("lists finished Codex sub-agents newest first, without the running ones", () => {
    const tl = timeline([
      {
        id: "t1",
        status: "completed",
        items: [
          collab("s1", "spawnAgent", A, "pendingInit", "audit"),
          collab("s2", "spawnAgent", B, "pendingInit", "bench"),
          collab("s3", "spawnAgent", C, "pendingInit", "still going"),
          collab("w1", "wait", B, "errored"),
          collab("w2", "wait", A, "completed"),
        ],
      },
    ]);
    const rows = finishedSubAgents(tl, { live: { [C]: "running" } });
    expect(rows.map((r) => [r.threadId, r.outcome])).toEqual([
      [A, "completed"],
      [B, "failed"],
    ]);
    expect(rows[0]).toMatchObject({ name: A.slice(0, 8), task: "audit", background: false, durationMs: null });
  });

  it("names them like the running rows and takes durations from recorded spans", () => {
    const tl = timeline([{ id: "t1", status: "completed", items: [collab("s1", "spawnAgent", A, "completed")] }]);
    const [row] = finishedSubAgents(tl, { meta: { [A]: { nickname: "Euclid", role: "explorer" } }, spans: { [A]: { startedAt: 100, endedAt: 142 } } });
    expect(row).toMatchObject({ name: "Euclid · explorer", type: "explorer", durationMs: 42_000 });
    // The "default" role is no type.
    const [plain] = finishedSubAgents(tl, { meta: { [A]: { nickname: "Noether", role: "default" } } });
    expect(plain).toMatchObject({ name: "Noether", type: null });
  });

  it("keeps a completed outcome through a later closeAgent; a stale child is stopped", () => {
    const tl = timeline([
      {
        id: "t1",
        status: "completed",
        items: [collab("s1", "spawnAgent", A, "pendingInit"), collab("w1", "wait", A, "completed"), collab("c1", "closeAgent", A, "shutdown"), collab("s2", "spawnAgent", B, "pendingInit")],
      },
    ]);
    const rows = finishedSubAgents(tl, { live: { [B]: "interrupted" } });
    expect(rows.find((r) => r.threadId === A)?.outcome).toBe("completed");
    expect(rows.find((r) => r.threadId === B)?.outcome).toBe("stopped");
  });

  it("lists Claude Agent cards once (not their activity items) with type, duration and outcome", () => {
    const ref = "claude:sid:task:t1";
    const tl = timeline([
      {
        id: "t1",
        status: "completed",
        items: [
          agentCard("toolu_1", { description: "核对文档", subagent_type: "Explore", prompt: "read docs", run_in_background: false }, { agentThreadId: ref }),
          { type: "subAgentActivity", id: "a1", kind: "started", agentThreadId: ref, agentPath: "/claude/t1" },
          { type: "subAgentActivity", id: "a2", kind: "completed", agentThreadId: ref, agentPath: "/claude/t1" },
          agentCard("toolu_2", { subagent_type: "general-purpose", run_in_background: false }, { status: "failed", success: false, durationMs: 1_000 }),
        ],
      },
      { id: "t2", status: "interrupted", items: [agentCard("toolu_3", { description: "跑测试", run_in_background: false }, { status: "inProgress", durationMs: null })] },
    ]);
    const rows = finishedSubAgents(tl);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ key: "toolu_3", outcome: "stopped", threadId: null, name: "跑测试" });
    expect(rows[1]).toMatchObject({ key: "toolu_2", outcome: "failed", name: "general-purpose", type: "general-purpose" });
    expect(rows[2]).toMatchObject({ key: "toolu_1", threadId: ref, name: "核对文档 · Explore", type: "Explore", durationMs: 48_000, outcome: "completed", task: "read docs", background: false });
  });

  it("marks a background Claude subagent (run_in_background not false): no duration; a refused call is just failed", () => {
    const tl = timeline([
      {
        id: "t1",
        status: "completed",
        items: [
          agentCard("toolu_bg", { description: "扫描日志" }, { durationMs: 900 }),
          agentCard("toolu_refused", { description: "被拒", run_in_background: true }, { status: "failed", success: false }),
        ],
      },
    ]);
    const [refused, bg] = finishedSubAgents(tl);
    expect(bg).toMatchObject({ key: "toolu_bg", background: true, noTranscript: true, durationMs: null, outcome: "completed" });
    expect(refused).toMatchObject({ key: "toolu_refused", background: false, noTranscript: false, outcome: "failed" });
  });

  it("claude-r23: a background run with a transcript is a running row until its task ends, then opens with its span", () => {
    const ref = "claude:s1:task:bg1";
    const activity = (kind: string) => ({ type: "subAgentActivity", id: `act-${kind}`, kind, agentThreadId: ref, agentPath: "/claude/bg1" });
    const tl = timeline([
      { id: "t1", status: "completed", items: [agentCard("toolu_bg", { description: "整理日志", subagent_type: "general-purpose" }, { agentThreadId: ref, durationMs: 40 }), activity("started")] },
    ]);
    // The card completed at the launch; the run goes on after its turn.
    expect(finishedSubAgents(tl)).toEqual([]);
    expect(activeSubAgents(tl, true).map((a) => a.threadId)).toEqual([ref]);
    expect([...backgroundClaudeRefs(tl)]).toEqual([ref]);
    // claude/task/updated says how it ended (here: stopped).
    const spans = { [ref]: { startedAt: 100, endedAt: 190 } };
    const [row] = finishedSubAgents(tl, { live: { [ref]: "interrupted" }, spans });
    expect(row).toMatchObject({ key: "toolu_bg", threadId: ref, background: true, noTranscript: false, outcome: "stopped", durationMs: 90_000 });
    expect(activeSubAgents(tl, true, { [ref]: "interrupted" })).toEqual([]);
    // Or the adapter's own completed activity item in the origin turn.
    const done = timeline([{ id: "t1", status: "completed", items: [agentCard("toolu_bg", { description: "整理日志" }, { agentThreadId: ref }), activity("started"), activity("completed")] }]);
    expect(finishedSubAgents(done)[0]).toMatchObject({ outcome: "completed", noTranscript: false, durationMs: null });
  });

  it("reads claude/task/updated into a sub-agent status by the timeline's reference", () => {
    const ref = "claude:s1:task:bg1";
    const tl = timeline([{ id: "t1", status: "completed", items: [agentCard("toolu_bg", {}, { agentThreadId: ref })] }]);
    const envelope = (task: Record<string, unknown>, threadId = PARENT) =>
      ({ native: { kind: "notification", message: { method: "claude/task/updated", params: { threadId, task } } } }) as never;
    expect(claudeTaskStatusFromEvent(envelope({ taskId: "bg1", taskType: "local_agent", status: "running" }), tl)).toEqual({ threadId: ref, status: "running" });
    expect(claudeTaskStatusFromEvent(envelope({ taskId: "bg1", taskType: "local_agent", status: "lost" }), tl)).toEqual({ threadId: ref, status: "interrupted" });
    expect(claudeTaskStatusFromEvent(envelope({ taskId: "bg1", taskType: "local_agent", status: "failed" }), tl)).toEqual({ threadId: ref, status: "errored" });
    // Shell tasks, other threads and unknown tasks say nothing.
    expect(claudeTaskStatusFromEvent(envelope({ taskId: "bg1", taskType: "local_bash", status: "completed" }), tl)).toBeNull();
    expect(claudeTaskStatusFromEvent(envelope({ taskId: "bg1", taskType: "local_agent", status: "completed" }, "other"), tl)).toBeNull();
    expect(claudeTaskStatusFromEvent(envelope({ taskId: "nope", taskType: "local_agent", status: "completed" }), tl)).toBeNull();
    expect(claudeTaskStatus({ taskType: "local_agent", status: "unknown" })).toBeNull();
    expect(claudeTaskIdOf(ref)).toBe("bg1");
    expect(claudeTaskIdOf("00000000-0000-7000-8000-00000000000a")).toBeNull();
  });

  it("offers 停止 only with the adapter's backgroundSubagents and cutex claude-background-tasks", () => {
    const host = (on: boolean) => ({ has: (f: string) => on && f === "claude-background-tasks" });
    const claude = { runtime: "claude" as const, map: { backgroundSubagents: true } };
    expect(stopsClaudeTasks(claude, host(true))).toBe(true);
    expect(stopsClaudeTasks(claude, host(false))).toBe(false);
    expect(stopsClaudeTasks({ runtime: "claude", map: {} }, host(true))).toBe(false);
    expect(stopsClaudeTasks({ runtime: "codex", map: null }, host(true))).toBe(false);
    expect(zhCN["subagents.stop"]).toBe("停止");
    expect(en["subagents.stop"]).toBe("Stop");
  });

  it("skips a Claude card whose turn still runs, and caps the list", () => {
    const running = timeline([{ id: "t1", status: "inProgress", items: [agentCard("toolu_1", { description: "x" }, { status: "inProgress" })] }]);
    expect(finishedSubAgents(running)).toEqual([]);
    const many = timeline([{ id: "t1", status: "completed", items: Array.from({ length: 25 }, (_, i) => agentCard(`toolu_${i}`, { description: `n${i}`, run_in_background: false })) }]);
    const rows = finishedSubAgents(many);
    expect(rows).toHaveLength(20);
    expect(rows[0]!.key).toBe("toolu_24");
    expect(finishedSubAgents(many, {}, 3)).toHaveLength(3);
    expect(finishedSubAgents(null)).toEqual([]);
  });
});

describe("subAgentSpanFromThreadRead", () => {
  it("takes the turns' span, else createdAt → updatedAt; nothing while active", () => {
    expect(subAgentSpanFromThreadRead({ thread: { status: { type: "idle" }, createdAt: 1, updatedAt: 99, turns: [{ startedAt: 10, completedAt: 20 }, { startedAt: 30, completedAt: 52 }] } })).toEqual({ startedAt: 10, endedAt: 52 });
    expect(subAgentSpanFromThreadRead({ thread: { status: { type: "notLoaded" }, createdAt: 100, updatedAt: 160, turns: [] } })).toEqual({ startedAt: 100, endedAt: 160 });
    expect(subAgentSpanFromThreadRead({ thread: { status: { type: "active" }, createdAt: 100, updatedAt: 160, turns: [] } })).toBeNull();
    expect(subAgentSpanFromThreadRead({ thread: { status: { type: "idle" }, turns: [{ startedAt: 10, completedAt: null }] } })).toBeNull();
    expect(subAgentSpanFromThreadRead(null)).toBeNull();
  });
});

describe("最近完成 strings", () => {
  it("has the group, outcomes and the background reason in both locales", () => {
    expect(zhCN["subagents.recent.background"]).toBe("后台运行，没有过程记录");
    expect([zhCN["subagents.outcome.completed"], zhCN["subagents.outcome.failed"], zhCN["subagents.outcome.stopped"]]).toEqual(["完成", "失败", "已停止"]);
    expect(en["subagents.recent"]).toContain("{n}");
  });
});
