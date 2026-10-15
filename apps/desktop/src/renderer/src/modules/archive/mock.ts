// Browser-preview data for archived agents (dev/mockTypes.ts): the stored threads that
// GET /v2/sessions/{id}/history returns for two of the core mock's archived agents — old2 (a plain
// archived agent) and old5 (archived together with its project proto-lab). Other archived agents
// have no saved turns.
import type { ModuleMock } from "../../dev/mockTypes";

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

export const mock: ModuleMock = {
  thread: (sessionId) =>
    sessionId === "old2"
      ? storedThread("old2", 21, "把 v3 的会话记录迁到 v4 的 SQLite 存储，跑完核对条数。", ["python migrate.py --dry-run", "python migrate.py"], "迁移完成，共 1,204 条记录，与 v3 的计数一致。")
      : sessionId === "old5"
        ? storedThread("old5", 31, "试一下 WebSocket 推送能不能替代轮询。", ["pnpm vitest run ws"], "原型跑通了：推送延迟 < 50 ms。结论写在 NOTES.md。")
        : null,
};
