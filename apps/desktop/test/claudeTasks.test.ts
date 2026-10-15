import { describe, expect, it } from "vitest";
import { isClaudeTaskRef } from "../src/renderer/src/lib/claudeTasks";
import { activeSubAgents, subAgentsOf } from "../src/renderer/src/lib/subagents";
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
