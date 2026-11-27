// Browser-preview data for archived agents (dev/mockTypes.ts): the stored threads that
// GET /v2/sessions/{id}/history returns for two of the core mock's archived agents — old2 (a plain
// archived agent) and old5 (archived together with its project proto-lab). Other archived agents
// have no saved turns.
import type { ModuleMock } from "../../dev/mockTypes";
import type { SidebarSnapshot } from "../../../../shared/ipc";

const day = 86_400;

function storedThread(id: string, ageDays: number, user: string, commands: string[], answer: string) {
  const t = Math.floor(Date.now() / 1000) - ageDays * day;
  return {
    thread: {
      id: `thread-${id}`,
      turns: [
        {
          id: `${id}-t1`,
          status: "completed",
          startedAt: t,
          completedAt: t + 240,
          items: [
            { type: "userMessage", id: `${id}-u1`, content: [{ type: "text", text: user }] },
            ...commands.map((command, i) => ({ type: "commandExecution", id: `${id}-c${i}`, command, status: "completed", exitCode: 0, durationMs: 600 })),
            { type: "agentMessage", id: `${id}-a1`, text: answer },
          ],
        },
      ],
    },
  };
}

// 整理不常用的智能体 (./IdleAgents): the core agents were all used today; here the plain helpers (auto-*, a-*, a few
// demo-*) last talked 2…120 days ago (fixed per id), one project gets a 副主管, one agent is paused by the owner and
// one is an agent cutex will not archive (allowedActions without archive). Under `?legacy` nothing changes.
const IDLE = /^(?:auto-\d+|a-\d+|demo-(?:idle2?|done|figs|deseq|atac|annot|traj|velo|cluster|review|integ|doublet)|chores-1|notes-1|widgets|chat-(?:trip|rust)|vcc-1|ifm-plot)$/;
const IDLE_DAYS = [2, 4, 9, 16, 23, 35, 48, 64, 90, 120];
const daysOf = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return IDLE_DAYS[h % IDLE_DAYS.length]!; };

function idleSidebar(snapshot: SidebarSnapshot): SidebarSnapshot {
  const now = Date.now();
  const active = snapshot.active.map((s) => {
    let next = s;
    if (IDLE.test(s.cutexSessionId)) {
      const at = new Date(now - daysOf(s.cutexSessionId) * 86_400_000 - 3_600_000).toISOString();
      next = { ...next, activity: { ...((next.activity as Record<string, unknown> | null) ?? {}), lastConversationAt: at } as typeof s.activity, lastActivityAt: at };
    }
    if (s.cutexSessionId === "demo-figs") next = { ...next, allowedActions: ["send", "start"] };
    if (s.cutexSessionId === "a-3") next = { ...next, agentPause: { cutexSessionId: "a-3", phase: "paused", requestedAt: new Date(now - 20 * 86_400_000).toISOString(), pausedAt: new Date(now - 20 * 86_400_000).toISOString(), by: "owner" } } as typeof s;
    return next;
  });
  // A 副主管: the first project with a non-Director member that has none yet.
  const operators = { ...(snapshot.projectOperators ?? {}) };
  for (const p of snapshot.projects?.projects ?? []) {
    if (operators[p.project_id]?.length) continue;
    const member = Object.entries(snapshot.hostRows).find(([id, row]) => row.projectId === p.project_id && id !== p.director_cutex_session_id && IDLE.test(id));
    if (member) { operators[p.project_id] = [member[0]]; break; }
  }
  return { ...snapshot, active, projectOperators: operators };
}

export const mock: ModuleMock = {
  sidebar: (snapshot, core) => (core.legacy ? snapshot : idleSidebar(snapshot)),
  thread: (sessionId) =>
    sessionId === "old2"
      ? storedThread("old2", 21, "把 v3 的会话记录迁到 v4 的 SQLite 存储，跑完核对条数。", ["python migrate.py --dry-run", "python migrate.py"], "迁移完成，共 1,204 条记录，与 v3 的计数一致。")
      : sessionId === "old5"
        ? storedThread("old5", 31, "试一下 WebSocket 推送能不能替代轮询。", ["pnpm vitest run ws"], "原型跑通了：推送延迟 < 50 ms。结论写在 NOTES.md。")
        : null,
};
