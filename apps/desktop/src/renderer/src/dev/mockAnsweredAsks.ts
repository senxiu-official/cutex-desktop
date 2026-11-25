// Preview mock of cutex's saved answered questions / approvals (session-interaction-history-v1, owner TODO 2026-10-06).
// `?answeredasks`: every agent's two newest 回合 have saved rows (a multi-choice question you answered and a command
// you declined in the newest; a secret question Mika answered and a file change Lead approved in the one before),
// served 2 a page so the cursor is followed. The declined command is stored abbreviated (`truncated`, 已截断). `?answeredasks=off`: the host has no such feature (today's behaviour).
import type { InteractionHistoryPage, InteractionHistoryRecord } from "@cutex-desktop/protocol";
import { INTERACTION_HISTORY_FEATURE, type InteractionHistoryRequest } from "../../../shared/interactionHistory";

const MODE = typeof location !== "undefined" ? new URLSearchParams(location.search).get("answeredasks") : null;
/** The feature as the mock host offers it ([] with `=off` or without the scene). */
export const mockAnsweredAsksFeatures = (): string[] => (MODE !== null && MODE !== "off" ? [INTERACTION_HISTORY_FEATURE] : []);

type MockTurn = { id: string; items?: { id?: string }[] };

function rowsFor(turns: readonly MockTurn[]): InteractionHistoryRecord[] {
  const newest = turns.at(-1);
  const before = turns.at(-2);
  const out: InteractionHistoryRecord[] = [];
  const anchor = (t: MockTurn) => t.items?.[0]?.id ?? null;
  if (newest) {
    out.push({
      runtimeGeneration: 1, turnId: newest.id, answeredAt: "2026-11-25T06:31:00Z", actor: { kind: "owner" }, redactedQuestionIds: [],
      native: { id: 901, method: "item/tool/requestUserInput", params: { threadId: "t", turnId: newest.id, itemId: anchor(newest), isBlocking: true, questions: [
        { id: "scope", header: "范围", question: "这次迁移要包括哪些表？", isOther: true, isSecret: false, options: [{ label: "sessions", description: "会话与回合" }, { label: "inputs", description: "输入框与队列" }, { label: "bus", description: "消息" }] },
      ] } },
      result: { answers: { scope: { answers: ["sessions", "inputs"] } } },
    });
    out.push({
      runtimeGeneration: 1, turnId: newest.id, answeredAt: "2026-11-25T06:33:00Z", actor: { kind: "owner" }, redactedQuestionIds: [],
      native: { id: "cmd-902", method: "item/commandExecution/requestApproval", params: { kind: "command", threadId: "t", turnId: newest.id, itemId: anchor(newest), startedAtMs: 0, environmentId: null, command: "psql -c 'DROP TABLE legacy_inputs'", cwd: "D:/Apps/cutex", reason: "删除旧表", availableDecisions: ["accept", "acceptForSession", "decline"] } },
      result: { decision: "decline" },
      truncated: true,
    });
  }
  if (before) {
    out.push({
      runtimeGeneration: 1, turnId: before.id, answeredAt: "2026-11-25T05:12:00Z", actor: { kind: "user", userId: "u-mika", name: "Mika" }, redactedQuestionIds: ["token"],
      native: { id: 903, method: "item/tool/requestUserInput", params: { threadId: "t", turnId: before.id, itemId: anchor(before), isBlocking: true, questions: [
        { id: "token", header: "Token", question: "测试库的访问令牌？", isOther: true, isSecret: true, options: null },
      ] } },
      result: { answers: {} },
    });
    out.push({
      runtimeGeneration: 1, turnId: before.id, answeredAt: "2026-11-25T05:14:00Z", actor: { kind: "agent", cutexSessionId: "lead" }, redactedQuestionIds: [],
      native: { id: 904, method: "item/fileChange/requestApproval", params: { threadId: "t", turnId: before.id, itemId: anchor(before), startedAtMs: 0, grantRoot: "D:/Apps/cutex/migrations", reason: "写入迁移脚本" } },
      result: { decision: "accept" },
    });
  }
  return out;
}

/** One page, newest first, 2 rows a page (the cursor is an offset). */
export function mockAnsweredAsksPage(id: string, request: InteractionHistoryRequest, turns: readonly MockTurn[]): InteractionHistoryPage | null {
  if (!mockAnsweredAsksFeatures().length) return null;
  const wanted = request.turnIds?.length ? new Set(request.turnIds) : null;
  const all = rowsFor(turns).filter((r) => !wanted || (r.turnId !== null && wanted.has(r.turnId))).sort((a, b) => b.answeredAt.localeCompare(a.answeredAt));
  const from = request.cursor ? Number(request.cursor) || 0 : 0;
  const size = Math.min(request.limit ?? 20, 2);
  const slice = all.slice(from, from + size);
  return { contractVersion: 2, cutexSessionId: id, interactions: slice, nextCursor: from + size < all.length ? String(from + size) : null };
}
