// Handled interactions stay in the timeline (lib/interactionLog): records for every request kind
// (question wizard, command / file / permission approvals, elicitation, settled elsewhere), where
// insertInteraction puts them (the request's own turn, else the active one), the store's upsert
// rules, and the row's visibility with Settings → 对话 → 在时间线中保留已处理的交互 off.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { answeredRecord, choiceOf, elsewhereRecord, glyphOf, putRecord, questionAnswers, recordsOf, requestTurnId, retainSessions, useInteractionLog, type InteractionRecord } from "../src/renderer/src/lib/interactionLog";
import { insertInteraction, orderedEntries, seedInteractions, timelineFromThreadRead, type TimelineEntry } from "../src/renderer/src/lib/timeline";
import { segmentEntries } from "../src/renderer/src/lib/workGroups";
import type { PendingRequest } from "../src/renderer/src/lib/interactions";
import { InteractionRow } from "../src/renderer/src/components/InteractionRow";

const uiPrefs = vi.hoisted(() => ({ timelineInteractions: true }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => uiPrefs }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "zh-CN", t: (key: keyof typeof zhCN, vars?: Record<string, string | number>) => {
  const template = zhCN[key] ?? String(key);
  return vars ? template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? `{${name}}`)) : template;
} }) }));

const COMMAND: PendingRequest = {
  id: 7,
  method: "item/commandExecution/requestApproval",
  params: { kind: "command", threadId: "t", turnId: "turn-2", itemId: "c", startedAtMs: 0, environmentId: null, command: "cargo add serde --features derive", cwd: "/w", reason: "needs network", availableDecisions: ["accept", "acceptForSession", "decline", "cancel"] },
};
const FILE_CHANGE: PendingRequest = {
  id: 8,
  method: "item/fileChange/requestApproval",
  params: { threadId: "t", turnId: "turn-2", itemId: "f", startedAtMs: 0, grantRoot: "/mnt/w/src", reason: "writes outside the sandbox root" },
};
const PERMISSIONS: PendingRequest = {
  id: 10,
  method: "item/permissions/requestApproval",
  params: { threadId: "t", turnId: "turn-2", itemId: "p", startedAtMs: 0, permissions: { fs: { write: ["/tmp"] } }, reason: null },
};
const QUESTIONS: PendingRequest = {
  id: 9,
  method: "item/tool/requestUserInput",
  params: {
    threadId: "t", turnId: "turn-2", itemId: "i", isBlocking: true,
    questions: [{ id: "q1", header: "Queue UI", question: "队列面板要支持拖拽排序吗？", isOther: true, isSecret: false, options: [{ label: "先不做", description: "等 cutex 加上" }, { label: "前端先做", description: "" }] }],
  },
};
const ELICITATION: PendingRequest = {
  id: 11,
  method: "mcpServer/elicitation/request",
  params: { serverName: "cutex", message: "需要服务器地址", requestedSchema: { properties: { host: { type: "string", title: "Host" } }, required: ["host"] } },
};

describe("answeredRecord / elsewhereRecord (record source)", () => {
  it("a command approval keeps the command and the decision", () => {
    const record = answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-2", 100);
    expect(record.settled).toEqual({ kind: "answered", result: { decision: "accept" } });
    expect(record.asked?.kind).toBe("approval");
    expect(glyphOf(record)).toBe("approve");
    expect(choiceOf(record)?.label).toBe("accept");
    expect(choiceOf(record)?.tone).toBe("primary");
    expect(record.asked?.kind === "approval" && record.asked.subject).toBe("cargo add serde --features derive");
  });

  it("decline / cancel are rejections; acceptForSession is an approval", () => {
    expect(glyphOf(answeredRecord(COMMAND, { result: { decision: "decline" } }, "turn-2", 100))).toBe("reject");
    expect(glyphOf(answeredRecord(COMMAND, { result: { decision: "cancel" } }, "turn-2", 100))).toBe("reject");
    expect(glyphOf(answeredRecord(COMMAND, { result: { decision: "acceptForSession" } }, "turn-2", 100))).toBe("approve");
  });

  it("a file-change approval keeps the grant root", () => {
    const record = answeredRecord(FILE_CHANGE, { result: { decision: "decline" } }, "turn-2", 100);
    expect(glyphOf(record)).toBe("reject");
    expect(record.asked?.kind === "approval" && record.asked.subject).toBe("/mnt/w/src");
    expect(record.asked?.kind === "approval" && record.asked.title).toBe("fileChange");
  });

  it("a permissions approval matches the granted choice by value", () => {
    const granted = { permissions: { fs: { write: ["/tmp"] } }, scope: "turn" };
    const record = answeredRecord(PERMISSIONS, { result: granted }, "turn-2", 100);
    expect(choiceOf(record)?.label).toBe("grantTurn");
    expect(glyphOf(record)).toBe("approve");
    const denied = answeredRecord(PERMISSIONS, { result: { permissions: {}, scope: "turn" } }, "turn-2", 100);
    expect(choiceOf(denied)?.label).toBe("decline");
    expect(glyphOf(denied)).toBe("reject");
  });

  it("a question wizard keeps every question and the selected values (option or typed)", () => {
    const picked = answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["先不做"] } } } }, "turn-2", 100);
    expect(glyphOf(picked)).toBe("question");
    expect(questionAnswers(picked)).toEqual({ q1: ["先不做"] });
    const typed = answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["等 cutex r228"] } } } }, "turn-2", 100);
    expect(questionAnswers(typed)).toEqual({ q1: ["等 cutex r228"] });
  });

  it("elicitation: accept approves, decline / cancel reject; the subject is the server", () => {
    const accept = answeredRecord(ELICITATION, { result: { action: "accept", content: { host: "localhost" }, _meta: null } }, "turn-2", 100);
    expect(glyphOf(accept)).toBe("approve");
    expect(accept.asked?.kind === "elicitation" && accept.asked.params.serverName).toBe("cutex");
    expect(glyphOf(answeredRecord(ELICITATION, { result: { action: "decline", content: null, _meta: null } }, "turn-2", 100))).toBe("reject");
  });

  it("an unsupported request answered with an error reply is still answered here", () => {
    const unknown: PendingRequest = { id: 12, method: "item/somethingElse", params: {} };
    const record = answeredRecord(unknown, { error: { code: -32601, message: "unsupported" } }, "turn-2", 100);
    expect(record.settled).toEqual({ kind: "answered", result: null });
    expect(record.asked?.kind).toBe("unknown");
    expect(glyphOf(record)).toBe("reject");
  });

  it("a request resolved without our reply is settled elsewhere", () => {
    const record = elsewhereRecord(COMMAND, "turn-2", 100);
    expect(record.settled.kind).toBe("elsewhere");
    expect(glyphOf(record)).toBe("elsewhere");
    expect(choiceOf(record)).toBeNull();
  });

  it("requestTurnId prefers the request's own turn, else the active one", () => {
    expect(requestTurnId({ activeTurnId: "turn-3" }, COMMAND)).toBe("turn-2");
    expect(requestTurnId({ activeTurnId: "turn-3" }, ELICITATION)).toBe("turn-3");
    expect(requestTurnId({ activeTurnId: null }, ELICITATION)).toBeNull();
  });
});

describe("record store (this run only)", () => {
  beforeEach(() => useInteractionLog.setState({ bySession: {} }));

  it("an answered record upgrades an earlier elsewhere row for the same request", () => {
    const id = String(COMMAND.id);
    expect(putRecord("a", elsewhereRecord(COMMAND, "t", 1))).toBe(true);
    expect(putRecord("a", answeredRecord(COMMAND, { result: { decision: "accept" } }, "t", 2))).toBe(true);
    const records = recordsOf("a");
    expect(records).toHaveLength(1);
    expect(records[0]!.requestId).toBe(id);
    expect(records[0]!.settled.kind).toBe("answered");
  });

  it("an answered record is never downgraded, and elsewhere never duplicates", () => {
    expect(putRecord("a", answeredRecord(COMMAND, { result: { decision: "accept" } }, "t", 1))).toBe(true);
    expect(putRecord("a", elsewhereRecord(COMMAND, "t", 2))).toBe(false);
    expect(recordsOf("a")).toHaveLength(1);
    expect(recordsOf("a")[0]!.settled.kind).toBe("answered");
  });

  it("records of sessions whose views went away are dropped", () => {
    putRecord("a", elsewhereRecord(COMMAND, "t", 1));
    putRecord("b", elsewhereRecord(COMMAND, "t", 1));
    retainSessions(["a"]);
    expect(recordsOf("a")).toHaveLength(1);
    expect(recordsOf("b")).toHaveLength(0);
  });
});

function twoTurnTimeline() {
  return timelineFromThreadRead({
    thread: {
      id: "t",
      turns: [
        { id: "turn-1", status: "completed", items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] }] },
        { id: "turn-2", status: "inProgress", items: [{ type: "userMessage", id: "u2", content: [{ type: "text", text: "go" }] }] },
      ],
    },
  });
}

describe("insertInteraction / seedInteractions", () => {
  it("appends the row inside the request's own turn, after its entries", () => {
    const timeline = twoTurnTimeline();
    expect(insertInteraction(timeline, answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-1", 1))).toBe(true);
    const order = orderedEntries(timeline);
    expect(order.map((e) => e.kind)).toEqual(["user", "interaction", "user"]);
    expect(order[1]).toMatchObject({ kind: "interaction", turnId: "turn-1" });
  });

  it("falls back to the active turn when the record has no turn of its own", () => {
    const timeline = twoTurnTimeline();
    insertInteraction(timeline, answeredRecord(ELICITATION, { result: { action: "accept", content: null, _meta: null } }, null, 1));
    expect(orderedEntries(timeline).at(-1)).toMatchObject({ kind: "interaction", turnId: "turn-2" });
  });

  it("a record whose turn is gone (and no active turn) is left out", () => {
    const timeline = twoTurnTimeline();
    timeline.activeTurnId = null;
    expect(insertInteraction(timeline, answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-9", 1))).toBe(false);
    expect(orderedEntries(timeline).every((e) => e.kind !== "interaction")).toBe(true);
  });

  it("a record whose turn is gone is left out even while another turn runs (revert / history window)", () => {
    const timeline = twoTurnTimeline();
    expect(timeline.activeTurnId).toBeTruthy();
    expect(insertInteraction(timeline, answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-9", 1))).toBe(false);
    expect(orderedEntries(timeline).every((e) => e.kind !== "interaction")).toBe(true);
  });

  it("a hidden row (setting off) does not split a work group", () => {
    const tool = (id: string) => ({ kind: "tool" as const, id, turnId: "turn-1", item: { type: "commandExecution", id, status: "completed" } });
    const row = { kind: "interaction" as const, id: "interaction:1", turnId: "turn-1", record: answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-1", 1) };
    const entries = [tool("a"), row, tool("b")] as TimelineEntry[];
    expect(segmentEntries(entries).map((s) => s.kind)).toEqual(["work", "entry", "work"]);
    expect(segmentEntries(entries, { interactions: false }).map((s) => s.kind)).toEqual(["work"]);
  });

  it("re-putting the same record changes nothing; an upgrade keeps the row's position", () => {
    const timeline = twoTurnTimeline();
    const elsewhere = elsewhereRecord(COMMAND, "turn-1", 1);
    insertInteraction(timeline, elsewhere);
    const before = orderedEntries(timeline).map((e) => e.id);
    expect(insertInteraction(timeline, elsewhere)).toBe(false);
    expect(insertInteraction(timeline, { ...elsewhere, settled: { kind: "answered", result: { decision: "accept" } } })).toBe(true);
    const after = orderedEntries(timeline);
    expect(after.map((e) => e.id)).toEqual(before);
    expect(after[1]).toMatchObject({ record: { settled: { kind: "answered" } } });
  });

  it("seeding a rebuilt timeline places the rows back into their turns, skipping missing ones", () => {
    const records = [
      answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-1", 1),
      answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["先不做"] } } } }, "turn-2", 2),
      answeredRecord(FILE_CHANGE, { result: { decision: "decline" } }, "turn-gone", 3),
    ];
    const rebuilt = timelineFromThreadRead({ thread: { id: "t", turns: [{ id: "turn-1", status: "completed" }, { id: "turn-2", status: "completed" }] } });
    expect(seedInteractions(rebuilt, records)).toBe(true);
    const rows = orderedEntries(rebuilt).filter((e) => e.kind === "interaction");
    expect(rows.map((r) => r.turnId)).toEqual(["turn-1", "turn-2"]);
    // Idempotent: a second seeding over the same records adds nothing.
    expect(seedInteractions(rebuilt, records)).toBe(false);
  });
});

describe("InteractionRow", () => {
  beforeEach(() => {
    uiPrefs.timelineInteractions = true;
    useInteractionLog.setState({ bySession: {} });
  });

  const render = (record: InteractionRecord) => renderToStaticMarkup(createElement(InteractionRow, { record }));

  it("shows the question and the picked answer on one collapsed line", () => {
    const markup = render(answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["先不做"] } } } }, "turn-2", 1));
    expect(markup).toContain("问：");
    expect(markup).toContain("队列面板要支持拖拽排序吗？");
    expect(markup).toContain("答：");
    expect(markup).toContain("先不做");
  });

  it("shows an approval with its subject; a rejection keeps the same shape", () => {
    const approved = render(answeredRecord(COMMAND, { result: { decision: "accept" } }, "turn-2", 1));
    expect(approved).toContain("批准：");
    expect(approved).toContain("cargo add serde --features derive");
    const rejected = render(answeredRecord(COMMAND, { result: { decision: "decline" } }, "turn-2", 1));
    expect(rejected).toContain("拒绝：");
    expect(rejected).toContain("cargo add serde --features derive");
  });

  it("a permissions approval names its kind instead of the JSON subject's first line", () => {
    // The dock replies with the chosen grant itself (lib/interactions grants exactly what was asked).
    const grant = { permissions: { fs: { write: ["/tmp"] } }, scope: "turn" };
    const markup = render(answeredRecord(PERMISSIONS, { result: grant }, "turn-2", 1));
    expect(markup).toContain("批准：");
    expect(markup).toContain("额外权限");
    expect(markup).not.toContain("批准：{");
  });

  it("several answers on one question join with the locale list separator", () => {
    const markup = render(answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["先不做", "前端先做"] } } } }, "turn-2", 1));
    expect(markup).toContain("答：先不做、前端先做");
  });

  it("settled elsewhere says so", () => {
    const markup = render(elsewhereRecord(COMMAND, "turn-2", 1));
    expect(markup).toContain("已在别处处理：");
    expect(markup).toContain("cargo add serde --features derive");
  });

  it("Settings → 对话 → 在时间线中保留已处理的交互 off: nothing renders", () => {
    uiPrefs.timelineInteractions = false;
    expect(render(answeredRecord(QUESTIONS, { result: { answers: { q1: { answers: ["先不做"] } } } }, "turn-2", 1))).toBe("");
    expect(render(elsewhereRecord(COMMAND, "turn-2", 1))).toBe("");
  });
});
