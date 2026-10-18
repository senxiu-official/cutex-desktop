// Browser-preview data for sub-agent threads (read-only sub-agent pane; dev/mockTypes.ts).
import type { ModuleMock } from "../../dev/mockTypes";

const now = Date.now() / 1000;
/** Sub-agent threads for the read-only sub-agent pane. */
const subThreads: Record<string, unknown> = {
  "thread-sub-explorer": {
    thread: {
      id: "thread-sub-explorer",
      // cute-codex names each spawned sub-agent (Thread.agentNickname / agentRole): 「Euclid · explorer」.
      agentNickname: "Euclid",
      agentRole: "explorer",
      turns: [
        {
          id: "st1",
          status: "completed",
          startedAt: now - 190,
          completedAt: now - 150,
          items: [
            { type: "userMessage", id: "su1", content: [{ type: "text", text: "找出所有调用 queue flush 的地方，列出每处是否校验了 revision。只读，不要改代码。" }] },
            { type: "commandExecution", id: "sc1", command: 'rg -n "flush" src/management', status: "completed", exitCode: 0, durationMs: 400, aggregatedOutput: "src/management/v2/server.rs:3830\nsrc/management/v2/user_input.rs:212" },
            { type: "commandExecution", id: "sc2", command: "sed -n 3830,3870p src/management/v2/server.rs", status: "completed", exitCode: 0, durationMs: 90 },
            { type: "commandExecution", id: "sc3", command: "sed -n 200,230p src/management/v2/user_input.rs", status: "completed", exitCode: 0, durationMs: 80 },
            {
              type: "agentMessage",
              id: "sm1",
              text: "共 3 处调用 flush：\n\n1. `server.rs:3830` — **未校验** revision\n2. `user_input.rs:212` — 已校验\n3. queue 面板「立即发送」路径 — **未校验**\n\n建议在 `dispatch_queue_flush` 统一加 `expectedRevision`。",
            },
          ],
        },
      ],
    },
  },
  "thread-sub-acl": {
    thread: {
      id: "thread-sub-acl",
      // The "default" role is not shown: 「Noether」. Older runtimes put them only in the source.
      agentNickname: null,
      agentRole: null,
      source: { subAgent: { thread_spawn: { parent_thread_id: "thread-eva", depth: 1, agent_path: "/root/acl_checker", agent_nickname: "Noether", agent_role: "default" } } },
      turns: [
        {
          id: "st2",
          status: "inProgress",
          startedAt: now - 150,
          completedAt: null,
          items: [
            { type: "userMessage", id: "su2", content: [{ type: "text", text: "并行检查 Windows 上 ACL 相关测试为什么不稳定" }] },
            { type: "commandExecution", id: "sc4", command: "icacls %USERPROFILE%\\.cutex-desktop-dev", status: "completed", exitCode: 0, durationMs: 300 },
            { type: "agentMessage", id: "sm2", text: "dev home 的 ACL 正常（owner-only）。怀疑是测试临时目录继承了 Authenticated Users，继续跑 task_service 验证。" },
            { type: "commandExecution", id: "sc5", command: "cargo test --lib task_service", status: "inProgress", aggregatedOutput: "test task_service::tests::persists_owner_private ... FAILED\ntest task_service::tests::rejects_shared_acl ... ok" },
          ],
        },
      ],
    },
  },
};

// Stale-running repro (ifm-ema-figures): the agent spawned a sub-agent, the owner interrupted the
// turn while it still worked, then stopped and restarted the runtime (停止运行时 → 启动运行时). The
// child ran inside the old runtime (generation 3); after the restart cute-codex no longer has it
// loaded, so its `thread/read` reports the in-progress turn as interrupted (thread status notLoaded).
const STALE_PARENT = "ifm-figures";
const STALE_CHILD = "thread-sub-figures";
const STALE_GENERATION = 3;
const staleTask = "重画 EMA 图 3 的置信带，换成 bootstrap 95% 区间";
function staleParentThread(): unknown {
  return {
    thread: {
      id: `thread-${STALE_PARENT}`,
      turns: [
        {
          id: "fig-t1",
          status: "interrupted",
          startedAt: now - 900,
          completedAt: now - 700,
          items: [
            { type: "userMessage", id: "fig-u1", content: [{ type: "text", text: "图 3 的置信带不对，派个子 agent 重画，你先核对图 1、2。" }] },
            { type: "collabAgentToolCall", id: "fig-s1", tool: "spawnAgent", status: "completed", senderThreadId: `thread-${STALE_PARENT}`, receiverThreadIds: [STALE_CHILD], prompt: staleTask, model: null, reasoningEffort: null, agentsStates: { [STALE_CHILD]: { status: "pendingInit", message: null } } },
            { type: "agentMessage", id: "fig-a1", text: "已派出子 agent 重画图 3，我先核对图 1、2 的坐标轴。" },
          ],
        },
      ],
    },
  };
}
function staleChildThread(generation: number): unknown {
  const stopped = generation > STALE_GENERATION;
  return {
    thread: {
      id: STALE_CHILD,
      agentNickname: "Laplace",
      agentRole: "worker",
      status: { type: stopped ? "notLoaded" : "active", activeFlags: [] },
      turns: [
        {
          id: "fst1",
          status: stopped ? "interrupted" : "inProgress",
          startedAt: now - 850,
          completedAt: null,
          items: [
            { type: "userMessage", id: "fsu1", content: [{ type: "text", text: staleTask }] },
            { type: "commandExecution", id: "fsc1", command: "Rscript figures/ema_fig3.R --ci bootstrap --reps 2000", status: stopped ? "failed" : "inProgress", aggregatedOutput: "bootstrap 1/2000 …" },
          ],
        },
      ],
    },
  };
}

// Sora's (Claude) foreground subagent: the adapter's stored transcript (subagent_transcripts.py),
// answered for `claude:<session>:task:<id>` with `parentThreadId` = the agent's thread.
const CLAUDE_SUB = "claude:mock-sora:task:task-docs";
subThreads[CLAUDE_SUB] = {
  thread: {
    id: CLAUDE_SUB,
    parentThreadId: "thread-sora",
    agentNickname: "核对文档",
    agentRole: "Explore",
    status: { type: "idle" },
    source: { subAgent: { thread_spawn: { parent_thread_id: "thread-sora", depth: 1, agent_nickname: "核对文档", agent_role: "Explore" } } },
    transcriptTruncated: false,
    turns: [
      {
        id: "subagent:toolu_docs_review",
        status: "completed",
        startedAt: now - 890,
        completedAt: now - 842,
        items: [
          { type: "userMessage", id: "cs-u", content: [{ type: "text", text: "读 docs/DESKTOP_PARITY.md 和 timeline 的工具行代码，列出 dynamicToolCall 显示上还缺什么。只读。" }] },
          { type: "reasoning", id: "cs-r", summary: ["先看文档里对 dynamicToolCall 的要求，再对照 PlainToolRow。"], content: [] },
          { type: "commandExecution", id: "cs-c1", command: "Read docs/DESKTOP_PARITY.md", commandActions: [{ type: "read", command: "Read docs/DESKTOP_PARITY.md", name: "DESKTOP_PARITY.md", path: "docs/DESKTOP_PARITY.md" }], status: "completed", exitCode: 0, aggregatedOutput: "## What the desktop should change\n2. Render dynamicToolCall as namespace.tool …" },
          { type: "commandExecution", id: "cs-c2", command: 'Grep "dynamicToolCall" in src/renderer', commandActions: [{ type: "search", command: 'Grep "dynamicToolCall"', query: "dynamicToolCall", path: "src/renderer" }], status: "completed", exitCode: 0, aggregatedOutput: "components/PlainToolRow.tsx:23\nlib/taskRows.ts:330" },
          { type: "agentMessage", id: "cs-a", text: "缺两处：\n\n1. `dynamicToolCall` 没显示 namespace（应为 `claude.WebFetch`）；\n2. 失败时错误文本被截断。\n\n其余与 DESKTOP_PARITY 一致。" },
        ],
      },
    ],
  },
};

export const mock: ModuleMock = {
  features: { new: ["claude-subagent-transcripts"] },
  thread: (sessionId) => (sessionId === STALE_PARENT ? staleParentThread() : null),
  api: (core) => ({
    async subAgentThread(sessionId, threadId, opts) {
      const r = (threadId === STALE_CHILD ? staleChildThread(core.runtimeGeneration(sessionId)) : subThreads[threadId]) as { thread: Record<string, unknown> } | undefined;
      if (!r) throw new Error("unknown sub-agent thread");
      return opts?.includeTurns === false ? { thread: { ...r.thread, turns: [] } } : r;
    },
  }),
};
