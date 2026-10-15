// Browser-preview data for goals (/goal, thread/goal/*; dev/mockTypes.ts).
import type { ModuleMock } from "../../dev/mockTypes";

const mockGoals = new Map<string, import("@cutex-desktop/protocol/codex/v2").ThreadGoal>([
  ["eva", { threadId: "thread-eva", objective: "把 desktop 的 slash 命令面板做完：/goal /review /plan 全部接通并有测试", status: "active", tokenBudget: 2_000_000, tokensUsed: 486_000, timeUsedSeconds: 3120, createdAt: Date.now() / 1000 - 3600, updatedAt: Date.now() / 1000 }],
]);
export const mock: ModuleMock = {
  api: (core) => ({
    async threadGoal(sessionId) {
      return mockGoals.get(sessionId) ?? null;
    },
    async setThreadGoal(sessionId, threadId, patch) {
      core.unsupportedFor(sessionId, "goals");
      const prev = mockGoals.get(sessionId);
      const goal = { threadId, objective: patch.objective ?? prev?.objective ?? "", status: patch.status ?? prev?.status ?? "active", tokenBudget: patch.tokenBudget ?? prev?.tokenBudget ?? null, tokensUsed: prev?.tokensUsed ?? 0, timeUsedSeconds: prev?.timeUsedSeconds ?? 0, createdAt: prev?.createdAt ?? Date.now() / 1000, updatedAt: Date.now() / 1000 };
      mockGoals.set(sessionId, goal);
      core.nativeEvent(sessionId, "thread/goal/updated", { threadId, turnId: null, goal });
      return goal;
    },
    async clearThreadGoal(sessionId, threadId) {
      const had = mockGoals.delete(sessionId);
      core.nativeEvent(sessionId, "thread/goal/cleared", { threadId });
      return had;
    },
  }),
};
