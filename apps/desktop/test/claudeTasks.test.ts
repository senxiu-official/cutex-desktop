import { describe, expect, it } from "vitest";
import { canOpenSubAgent, isClaudeAgentTool, isClaudeTaskRef } from "../src/renderer/src/lib/claudeTasks";
import { agentFeaturesOf, CLAUDE_PROTOCOL, CODEX_FEATURES, opensClaudeSubagents } from "../src/renderer/src/lib/agentFeatures";
import { activeSubAgents, subAgentsOf, takeSubAgentReads } from "../src/renderer/src/lib/subagents";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

// claude-r8 adapter `runtime_tasks.py`: an SDK sub-agent task of a Claude session.
const TASK = "claude:4f1d2c3b-9a8e-4d7c-b6a5-0e1f2a3b4c5d:task:toolu_01AbCdEf";
const CODEX_CHILD = "00000000-0000-7000-8000-000000000002";

describe("isClaudeTaskRef", () => {
  it("recognises the adapter's claude:<session>:task:<id> references", () => {
    expect(isClaudeTaskRef(TASK)).toBe(true);
    expect(isClaudeTaskRef("claude:s:task:t")).toBe(true);
    // Any claude: namespaced id is not a thread either.
    expect(isClaudeTaskRef("claude:s:agent:a")).toBe(true);
  });

  it("leaves Codex sub-agent threads (and anything else) openable", () => {
    expect(isClaudeTaskRef(CODEX_CHILD)).toBe(false);
    expect(isClaudeTaskRef("thread-sub-explorer")).toBe(false);
    expect(isClaudeTaskRef("claudex-thread")).toBe(false);
    expect(isClaudeTaskRef("Claude:s:task:t")).toBe(false);
    expect(isClaudeTaskRef("")).toBe(false);
    expect(isClaudeTaskRef(null)).toBe(false);
    expect(isClaudeTaskRef(undefined)).toBe(false);
    expect(isClaudeTaskRef(42)).toBe(false);
  });

  it("still lists a Claude task as a sub-agent (status only), named after its task", () => {
    const item = (id: string, kind: string) => ({ type: "subAgentActivity", id, kind, agentThreadId: TASK, agentPath: "/claude/toolu_01AbCdEf" });
    const running = timelineFromThreadRead({ thread: { id: "t", turns: [{ id: "t1", status: "completed", items: [item("a1", "started")] }] } });
    const info = subAgentsOf(running).get(TASK);
    expect(info).toMatchObject({ threadId: TASK, name: "toolu_01AbCdEf", status: "running" });
    expect(activeSubAgents(running, true).map((a) => a.threadId)).toEqual([TASK]);
    const done = timelineFromThreadRead({ thread: { id: "t", turns: [{ id: "t1", status: "completed", items: [item("a1", "started"), item("a2", "completed")] }] } });
    expect(activeSubAgents(done, true)).toEqual([]);
  });

  it("explains it in both locales", () => {
    expect(zhCN["sub.claudeTask"]).toBeTruthy();
    expect(en["sub.claudeTask"]).toBeTruthy();
  });
});

const claude = (features: Record<string, unknown> | null) => agentFeaturesOf({ native: { schema: { protocol: CLAUDE_PROTOCOL, capabilities: { features } } } });

describe("Claude subagent transcripts (adapter subagentTranscripts)", () => {
  it("opens a Claude task only when the adapter keeps transcripts; Codex children always", () => {
    expect(opensClaudeSubagents(claude({ subagentTranscripts: true }))).toBe(true);
    for (const f of [claude({ subagentTranscripts: false }), claude({}), claude(null), CODEX_FEATURES]) expect(opensClaudeSubagents(f)).toBe(false);
    expect(canOpenSubAgent(TASK, claude({ subagentTranscripts: true }))).toBe(true);
    expect(canOpenSubAgent(TASK, claude({ subagents: true }))).toBe(false);
    expect(canOpenSubAgent(CODEX_CHILD, CODEX_FEATURES)).toBe(true);
  });

  it("reads Claude tasks (settle / name) only when asked to", () => {
    const item = { type: "subAgentActivity", id: "a1", kind: "started", agentThreadId: TASK, agentPath: "/claude/x" };
    const timeline = timelineFromThreadRead({ thread: { id: "t", turns: [{ id: "t1", status: "inProgress", items: [item] }] } });
    const agents = [...subAgentsOf(timeline).values()];
    const log = () => ({ settle: new Set<string>(), name: new Map<string, { at: number; tries: number }>() });
    expect(takeSubAgentReads("s", agents, {}, {}, log(), 0, 1)).toEqual([]);
    expect(takeSubAgentReads("s", agents, {}, {}, log(), 0, 1, true)).toEqual([{ threadId: TASK, settle: true }]);
  });

  it("matches the adapter's Agent / Task tool calls", () => {
    expect(isClaudeAgentTool({ type: "dynamicToolCall", id: "c", namespace: "claude", tool: "Agent" })).toBe(true);
    expect(isClaudeAgentTool({ type: "dynamicToolCall", id: "c", namespace: "claude", tool: "Task" })).toBe(true);
    expect(isClaudeAgentTool({ type: "dynamicToolCall", id: "c", namespace: "claude", tool: "WebFetch" })).toBe(false);
    expect(isClaudeAgentTool({ type: "dynamicToolCall", id: "c", namespace: "mcp", tool: "Agent" })).toBe(false);
    expect(isClaudeAgentTool({ type: "collabAgentToolCall", id: "c", tool: "spawnAgent" })).toBe(false);
  });
});
