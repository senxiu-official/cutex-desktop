// Answered questions and approvals cutex keeps (session-interaction-history-v1, owner TODO 2026-10-06), the pure
// parts: a saved record from cutex's row (who, when, hidden secret answers, trimmed params), one identity for live
// and saved rows (runtime generation + typed native id), the merge rules (a saved record upgrades a live row in
// place and is never replaced), where a saved row goes in the timeline (its own loaded 回合 only, after its item),
// structured decisions matched by value, and secret answers never shown — compact or opened, before or after reload.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InteractionHistoryRecord } from "@cutex-desktop/protocol";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { answeredRecord, choiceOf, elsewhereRecord, glyphOf, putRecord, questionAnswers, recordsOf, savedRecord, useInteractionLog } from "../src/renderer/src/lib/interactionLog";
import { insertInteraction, orderedEntries, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { hasInteractionHistory, interactionKey, INTERACTION_HISTORY_FEATURE } from "../src/shared/interactionHistory";
import type { PendingRequest } from "../src/renderer/src/lib/interactions";
import { InteractionRow } from "../src/renderer/src/components/InteractionRow";

vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ timelineInteractions: true }) }));
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (fn: () => void) => fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "zh-CN", t: (key: keyof typeof zhCN, vars?: Record<string, string | number>) => {
  const template = zhCN[key] ?? String(key);
  return vars ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : template;
} }) }));

const QUESTIONS_PARAMS = {
  threadId: "t", turnId: "turn-2", itemId: "item-q", isBlocking: true,
  questions: [
    { id: "q1", header: "Deploy", question: "现在部署吗？", isOther: false, isSecret: false, options: [{ label: "现在", description: "" }, { label: "稍后", description: "" }] },
    { id: "token", header: "Token", question: "API token？", isOther: true, isSecret: true, options: null },
  ],
};
const QUESTIONS: PendingRequest = { id: 9, method: "item/tool/requestUserInput", params: QUESTIONS_PARAMS };
const COMMAND_PARAMS = { kind: "command", threadId: "t", turnId: "turn-2", itemId: "item-c", startedAtMs: 0, environmentId: null, command: "rm -rf build", cwd: "/w", reason: null, availableDecisions: ["accept", "decline"] };
const COMMAND: PendingRequest = { id: 7, method: "item/commandExecution/requestApproval", params: COMMAND_PARAMS };

const row = (over: Partial<InteractionHistoryRecord> = {}): InteractionHistoryRecord => ({
  runtimeGeneration: 3,
  native: { id: 7, method: COMMAND.method, params: COMMAND_PARAMS },
  turnId: "turn-2",
  result: { decision: "decline" },
  actor: { kind: "owner" },
  answeredAt: "2026-11-25T06:30:00Z",
  redactedQuestionIds: [],
  ...over,
});

const thread = (turns: { id: string; items?: unknown[] }[]) => timelineFromThreadRead({ thread: { id: "t", turns: turns.map((t) => ({ id: t.id, status: "completed", items: t.items ?? [] })) } } as never, [], { runtimeLive: false });
const rowIds = (state: ReturnType<typeof thread>, turnId: string) => state.turns.find((t) => t.id === turnId)!.entryIds;

describe("capability and identity", () => {
  it("reads the feature from the list or the camel flag; older hosts have neither", () => {
    expect(hasInteractionHistory({ featureList: [INTERACTION_HISTORY_FEATURE] })).toBe(true);
    expect(hasInteractionHistory({ featureList: [], features: { sessionInteractionHistoryV1: true } })).toBe(true);
    expect(hasInteractionHistory({ featureList: ["offline-history"] })).toBe(false);
    expect(hasInteractionHistory(null)).toBe(false);
  });
  it("keys a request by generation and its typed native id", () => {
    expect(interactionKey(3, 7)).not.toBe(interactionKey(3, "7"));
    expect(interactionKey(3, 7)).not.toBe(interactionKey(4, 7));
    expect(savedRecord(row())!.key).toBe(answeredRecord(COMMAND, { result: { decision: "decline" } }, "turn-2", 1, 3).key);
  });
});

describe("savedRecord", () => {
  it("rebuilds the request and keeps the reply, who and when", () => {
    const record = savedRecord(row({ actor: { kind: "agent", cutexSessionId: "lead" } }), false, (id) => (id === "lead" ? "Lead" : null))!;
    expect(record.saved).toBe(true);
    expect(record.at).toBe(Date.parse("2026-11-25T06:30:00Z") / 1000);
    expect(record.actor).toEqual({ kind: "agent", cutexSessionId: "lead", agentName: "Lead" });
    expect(record.itemId).toBe("item-c");
    expect(glyphOf(record)).toBe("reject");
    expect(choiceOf(record)?.label).toBe("decline");
  });
  it("matches a structured decision whatever its key order", () => {
    const amend = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["rm", "-rf"] } };
    const params = { ...COMMAND_PARAMS, availableDecisions: [amend, "decline"] };
    const record = savedRecord(row({ native: { id: 7, method: COMMAND.method, params }, result: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["rm", "-rf"] } } } }))!;
    expect(choiceOf(record)?.label).toBe("acceptAndRemember");
    const reordered = savedRecord(row({ native: { id: 8, method: "item/permissions/requestApproval", params: { threadId: "t", turnId: "turn-2", itemId: "p", startedAtMs: 0, permissions: { fs: { write: ["/tmp"] } }, reason: null } }, result: { scope: "turn", permissions: { fs: { write: ["/tmp"] } } } }))!;
    expect(choiceOf(reordered)?.label).toBe("grantTurn");
  });
  it("an abbreviated row keeps its request (flagged); a missing flag is false", () => {
    const record = savedRecord(row({ native: { id: 7, method: COMMAND.method, params: { ...COMMAND_PARAMS, command: "rm -rf bui" } }, truncated: true }))!;
    expect(record.truncated).toBe(true);
    expect(record.asked?.kind === "approval" && record.asked.subject).toBe("rm -rf bui");
    expect(savedRecord(row())!.truncated).toBeUndefined();
  });
  it("upgrading a live row, an abbreviated saved record keeps the request as seen here", () => {
    useInteractionLog.setState({ bySession: {} });
    putRecord("t", answeredRecord(COMMAND, { result: { decision: "decline" } }, "turn-2", 1, 3));
    const stored = putRecord("t", savedRecord(row({ native: { id: 7, method: COMMAND.method, params: { ...COMMAND_PARAMS, command: "rm -rf bui" } }, truncated: true }))!)!;
    expect(stored.saved).toBe(true);
    expect(stored.truncated).toBe(false);
    expect(stored.asked?.kind === "approval" && stored.asked.subject).toBe("rm -rf build");
  });
  it("a row without params is still an answered row named by its method", () => {
    const record = savedRecord(row({ native: { id: 7, method: COMMAND.method } }))!;
    expect(record.asked).toBeNull();
    expect(glyphOf(record)).toBe("reject");
    const accepted = savedRecord(row({ native: { id: 7, method: COMMAND.method }, result: { decision: "accept" } }))!;
    expect(glyphOf(accepted)).toBe("approve");
  });
  it("rejects rows without a usable identity", () => {
    expect(savedRecord(row({ native: { id: null as never, method: "x" } }))).toBeNull();
    expect(savedRecord({ ...row(), runtimeGeneration: "3" as never })).toBeNull();
  });
});

describe("one row per request", () => {
  beforeEach(() => useInteractionLog.setState({ bySession: {} }));
  it("a saved record upgrades a live answered or elsewhere row in place, and a later live one leaves it", () => {
    const view = "local\u0000a1";
    expect(putRecord(view, elsewhereRecord(COMMAND, "turn-2", 1, 3))).not.toBeNull();
    const saved = putRecord(view, savedRecord(row())!);
    expect(saved?.saved).toBe(true);
    expect(putRecord(view, answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-2", 2, 3))).toBeNull();
    expect(putRecord(view, elsewhereRecord(COMMAND, "turn-2", 3, 3))).toBeNull();
    expect(recordsOf(view)).toHaveLength(1);
    expect(recordsOf(view)[0]!.saved).toBe(true);
  });
  it("either order converges to one row, at the same timeline position (an open row stays open)", () => {
    for (const order of ["live-first", "saved-first"] as const) {
      useInteractionLog.setState({ bySession: {} });
      const state = thread([{ id: "turn-2", items: [{ type: "agentMessage", id: "m1", text: "a" }] }]);
      const live = answeredRecord(COMMAND, { result: { decision: "decline" } }, "turn-2", 1, 3);
      const saved = savedRecord(row())!;
      for (const record of order === "live-first" ? [live, saved] : [saved, live]) {
        const stored = putRecord("v", record);
        if (stored) insertInteraction(state, stored);
      }
      const ids = rowIds(state, "turn-2").filter((id) => id.startsWith("interaction:"));
      expect(ids).toEqual([`interaction:${interactionKey(3, 7)}`]);
      const entry = state.entries.get(ids[0]!);
      expect(entry?.kind === "interaction" && entry.record.saved).toBe(true);
    }
  });
  it("the same id after a restart, and a string id equal to a number id, are different rows", () => {
    const view = "v2";
    putRecord(view, savedRecord(row())!);
    putRecord(view, savedRecord(row({ runtimeGeneration: 4 }))!);
    putRecord(view, savedRecord(row({ native: { id: "7", method: COMMAND.method, params: COMMAND_PARAMS } }))!);
    expect(recordsOf(view).map((r) => r.key)).toEqual([interactionKey(3, 7), interactionKey(4, 7), interactionKey(3, "7")]);
  });
});

describe("where a saved row goes", () => {
  it("only into its own loaded 回合, after its item, oldest first; never the active 回合 or without a turn", () => {
    const state = thread([{ id: "turn-1" }, { id: "turn-2", items: [{ type: "agentMessage", id: "item-c", text: "x" }, { type: "agentMessage", id: "later", text: "y" }] }]);
    state.activeTurnId = "turn-2";
    expect(insertInteraction(state, savedRecord(row({ turnId: "gone" }))!)).toBe(false);
    expect(insertInteraction(state, savedRecord(row({ turnId: null }))!)).toBe(false);
    const first = savedRecord(row({ answeredAt: "2026-11-25T06:00:00Z" }))!;
    const second = savedRecord(row({ native: { id: 8, method: COMMAND.method, params: COMMAND_PARAMS }, answeredAt: "2026-11-25T06:10:00Z" }))!;
    insertInteraction(state, first);
    insertInteraction(state, second);
    expect(rowIds(state, "turn-2")).toEqual(["item-c", `interaction:${first.key}`, `interaction:${second.key}`, "later"]);
    // Without its item in the 回合: at the end.
    const loose = savedRecord(row({ native: { id: 9, method: COMMAND.method, params: { ...COMMAND_PARAMS, itemId: "elsewhere" } }, turnId: "turn-1" }))!;
    insertInteraction(state, loose);
    expect(rowIds(state, "turn-1")).toEqual([`interaction:${loose.key}`]);
    expect(orderedEntries(state).filter((e) => e.kind === "interaction")).toHaveLength(3);
  });
});

describe("secret answers", () => {
  const html = (record: ReturnType<typeof answeredRecord>) => renderToStaticMarkup(createElement(InteractionRow, { record }));
  it("a reply sent here keeps no secret value, and its line shows it hidden", () => {
    const record = answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["现在"] }, token: { answers: ["sk-plain-secret"] } } } }, "turn-2", 1, 3);
    expect(JSON.stringify(record)).not.toContain("sk-plain-secret");
    expect(record.redacted).toEqual(["token"]);
    expect(questionAnswers(record)).toEqual({ q1: ["现在"] });
    expect(html(record)).not.toContain("sk-plain-secret");
  });
  it("a saved secret answer reads as hidden, never as unanswered (collapsed)", () => {
    const onlySecret = { ...QUESTIONS_PARAMS, questions: [QUESTIONS_PARAMS.questions[1]!] };
    const record = savedRecord(row({ native: { id: 9, method: QUESTIONS.method, params: onlySecret }, result: { answers: {} }, redactedQuestionIds: ["token"] }))!;
    const collapsed = renderToStaticMarkup(createElement(InteractionRow, { record }));
    expect(collapsed).toContain("（已隐藏）");
    expect(collapsed).not.toContain("（没有回答）");
    // Opened: test/interactionHistoryRow.test.tsx.
  });
});
