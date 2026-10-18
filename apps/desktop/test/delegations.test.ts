import { describe, expect, it } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import {
  agentDelegations,
  applyAskEvent,
  askRowTurnOf,
  delegateCallOf,
  delegateEntryOf,
  delegationActions,
  delegationAskRow,
  delegationBucket,
  delegationResultItems,
  delegationStatus,
  fallbackSummary,
  formatSpan,
  handlerReplies,
  inferDelegations,
  isStandalone,
  mergeSummaries,
  needsYouCount,
  orderDelegations,
  pendingForAgent,
  requesterSession,
  rowSeconds,
  stopPending,
  summaryFromRecord,
  waitSeconds,
  isDelegationRunning,
  isUnfinished,
  type DelegationRecords,
  type DelegationStatusKey,
} from "../src/renderer/src/lib/delegations";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import type { ExternalMessage, TimelineEntry } from "../src/renderer/src/lib/timeline";
import { segmentEntries } from "../src/renderer/src/lib/workGroups";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

const ask = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1",
  title: "Parser review",
  requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Lead" },
  target: "cutex.helper",
  targetName: "Helper",
  execution: "running",
  attempts: 1,
  createdAt: ago(600),
  updatedAt: ago(60),
  revision: 3,
  ...over,
});

const done = (tool: string, args: unknown, result: unknown, id = "m1", turnId = "t1"): TimelineEntry => ({
  kind: "tool",
  id,
  turnId,
  item: { type: "mcpToolCall", id, server: "cutex", tool, status: "completed", arguments: args, result: { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: null } } as never,
});

const message = (schema: string, data: Record<string, unknown>, text = "body"): ExternalMessage => ({ senderId: "cutex-asks", senderName: "cutex", deliveryMode: null, text, schema, data, eventType: null, sourceKind: "service" });
const itemOf = (e: TimelineEntry) => (e as Extract<TimelineEntry, { kind: "tool" }>).item;
const received = (id: string, turnId: string, m: ExternalMessage): TimelineEntry => ({ kind: "received", id, turnId, message: m });
const agentText = (id: string, turnId: string): TimelineEntry => ({ kind: "agent", id, turnId, text: "done", streaming: false });

describe("delegationStatus", () => {
  it("names holds and positions", () => {
    expect(delegationStatus(ask({ execution: "queued", queuePosition: 2, hold: { reason: "targetBusy" } as never }))).toMatchObject({ key: "queuedAt", n: 2 });
    expect(delegationStatus(ask({ execution: "queued", queuePosition: 1, hold: { reason: "targetBusy" } as never })).key).toBe("waitTurn");
    expect(delegationStatus(ask({ execution: "admitted", hold: { reason: "blocked", detail: { reason: "runtimeDown" } } as never })).dangerText).toBeTruthy();
    expect(delegationStatus(ask({ execution: "running" })).key).toBe("running");
  });

  it("closed outcomes win over execution", () => {
    expect(delegationStatus(ask({ execution: "answered", closed: "abandoned" })).key).toBe("abandoned");
    expect(delegationStatus(ask({ execution: "failed" })).glyph).toBe("cross");
  });
});

describe("stop pending and offline targets", () => {
  // Workstation 2026-10-11 (cutex r217h2, same in r222): proj-ceo-r1 abandoned a running review delegation
  // after its target was archived. cutex: execution running, review abandoned, closed null, attempt 1
  // running with stopRequested (full record only); the stop never reaches the offline runtime.
  const abandoning = ask({ review: "abandoned", closed: null, createdAt: ago(86400 + 100), attempt: { n: 1, state: "running", startedAt: ago(86400) } });
  const offline = { targetOffline: true };
  const word = (catalog: Record<string, string>, key: DelegationStatusKey, name = "proj-glm-research-r1") => catalog[`delegation.status.${key}`]!.replace("{name}", name);

  it("an abandoned delegation still open in cutex is 放弃中: not running, no 停止, not finished", () => {
    expect(stopPending(abandoning)).toBe("abandon");
    expect(delegationStatus(abandoning)).toMatchObject({ key: "abandoning", glyph: "hollow" });
    expect(delegationStatus(abandoning, offline)).toMatchObject({ key: "abandoningOffline", dangerText: true });
    expect(isDelegationRunning(abandoning)).toBe(false);
    expect(isDelegationRunning(abandoning, offline)).toBe(false);
    expect(delegationActions(abandoning)).toEqual({ stop: false, retry: false, accept: false, abandon: false });
    expect(delegationBucket(abandoning)).toBe("waiting");
    expect(isUnfinished(abandoning)).toBe(true);
    // Header 「委托 · 我发出的 1」 and the row agree: listed, nothing counted as running.
    const r = agentDelegations({ [abandoning.askId]: abandoning }, "cutex.lead", 10, () => offline);
    expect(r.mine.map((d) => d.askId)).toEqual([abandoning.askId]);
    expect(r.mine.filter((d) => isDelegationRunning(d, offline))).toHaveLength(0);
  });

  it("is 已放弃 only once cutex closed it", () => {
    for (const closed of ["abandoned", "stopped"] as const) {
      const d = ask({ execution: "interrupted", review: "abandoned", closed, attempt: { n: 1, interruptReason: "stopped" } });
      expect(stopPending(d)).toBeNull();
      expect(delegationStatus(d, offline).key).toBe("abandoned");
      expect(delegationBucket(d)).toBe("done");
    }
  });

  it("a stop the attempt has not carried out yet is 停止中", () => {
    const d = ask({ attempt: { n: 1, state: "running", stopRequested: true } });
    expect(stopPending(d)).toBe("stop");
    expect(delegationStatus(d).key).toBe("stopping");
    expect(delegationStatus(d, offline).key).toBe("stoppingOffline");
    expect(delegationActions(d).stop).toBe(false);
    expect(isDelegationRunning(d)).toBe(false);
    // Only from the full record: list rows do not carry it yet.
    const s = summaryFromRecord({ askId: "ask-9", execution: "running", attempts: [{ n: 1, state: "running", stopRequested: true }] });
    expect(s?.attempt?.stopRequested).toBe(true);
    expect(summaryFromRecord({ askId: "ask-9", execution: "running", attempts: [{ n: 1, state: "running", stopRequested: false }] })?.attempt).not.toHaveProperty("stopRequested");
  });

  it("running on an offline target says so and keeps 停止 (cutex applies it when the target is back)", () => {
    const d = ask({ attempt: { n: 1, state: "running", startedAt: ago(7200) } });
    expect(delegationStatus(d, offline)).toMatchObject({ key: "offline", dangerText: true, glyph: "hollow" });
    expect(isDelegationRunning(d, offline)).toBe(false);
    expect(delegationBucket(d, offline)).toBe("waiting");
    expect(delegationActions(d).stop).toBe(true);
    // Online (or unknown) target: unchanged.
    expect(delegationStatus(d).key).toBe("running");
    expect(isDelegationRunning(d)).toBe(true);
    expect(delegationBucket(d)).toBe("active");
    // A question still needs its answer, wherever the target is.
    expect(delegationStatus(ask({ hold: { reason: "waitingForInput" } as never }), offline).key).toBe("question");
    // Only a running attempt: queued / closed ones keep their words.
    expect(delegationStatus(ask({ execution: "queued" }), offline).key).toBe("queued");
    expect(delegationStatus(ask({ execution: "answered", closed: "completed" }), offline).key).toBe("answered");
  });

  it("has the words in zh-CN and en", () => {
    expect(word(zhCN, "abandoning")).toBe("放弃中");
    expect(word(zhCN, "abandoningOffline")).toBe("放弃中 · proj-glm-research-r1 离线");
    expect(word(zhCN, "stopping")).toBe("停止中");
    expect(word(zhCN, "stoppingOffline")).toBe("停止中 · proj-glm-research-r1 离线");
    expect(word(zhCN, "offline")).toBe("proj-glm-research-r1 离线");
    expect(word(en, "abandoning")).toBe("Abandoning");
    expect(word(en, "abandoningOffline")).toBe("Abandoning · proj-glm-research-r1 is offline");
    expect(word(en, "stopping")).toBe("Stopping");
    expect(word(en, "stoppingOffline")).toBe("Stopping · proj-glm-research-r1 is offline");
    expect(word(en, "offline")).toBe("proj-glm-research-r1 is offline");
  });
});

describe("closed events before the summary refresh", () => {
  it.each([
    ["abandoned", "abandoned"],
    ["stopped", "stopped"],
    ["cancelled", "cancelled"],
    ["accepted", "accepted"],
    ["completed", "ended"],
    ["superseded", "ended"],
  ] as const)("%s wins over the old running attempt", (outcome, key) => {
    const current = ask({ attempt: { n: 1, state: "running", startedAt: ago(86400) } });
    const records: DelegationRecords = { byId: { [current.askId]: current }, progress: {}, questions: {} };
    const next = applyAskEvent(records, "cutex/ask/closed", { askId: current.askId, outcome, revision: 4 })!.byId![current.askId]!;
    // The close event has no execution or attempt snapshot; they arrive on the next refresh.
    expect(next.execution).toBe("running");
    expect(next.attempt?.state).toBe("running");
    for (const ctx of [{}, { targetOffline: true }]) {
      expect(delegationStatus(next, ctx).key).toBe(key);
      expect(isDelegationRunning(next, ctx)).toBe(false);
      expect(delegationBucket(next, ctx)).toBe("done");
    }
    expect(delegationActions(next)).toEqual({ stop: false, retry: false, accept: false, abandon: false });
    expect(agentDelegations({ [next.askId]: next }, "cutex.lead")).toMatchObject({ mine: [], toMe: [], finished: 1 });
  });

  it.each(["answered", "failed", "rejected", "cancelled"] as const)("completed preserves known %s execution", (execution) => {
    expect(delegationStatus(ask({ execution, closed: "completed" })).key).toBe(execution);
  });

  it("uses an accepted close event before its review snapshot arrives", () => {
    expect(delegationStatus(ask({ execution: "answered", review: "awaitingAcceptance", closed: "accepted" })).key).toBe("accepted");
    expect(delegationStatus(ask({ execution: "answered", review: "awaitingAcceptance", closed: "completed" })).key).toBe("answered");
  });

  it("keeps a superseded answer's requested changes visible", () => {
    const d = ask({ execution: "answered", review: "changesRequested", closed: "superseded" });
    expect(delegationStatus(d).key).toBe("changesRequested");
    expect(delegationBucket(d)).toBe("done");
    expect(delegationActions(d)).toEqual({ stop: false, retry: false, accept: false, abandon: false });
  });
});

describe("buckets", () => {
  it("sorts delegations into needs-you / waiting / active / done", () => {
    expect(delegationBucket(ask({ execution: "pendingReview" }))).toBe("needsYou");
    expect(delegationBucket(ask({ ownerQuestions: 1 }))).toBe("needsYou");
    expect(delegationBucket(ask({ execution: "interrupted", attempt: { n: 1, interruptReason: "outcomeUnknown" } }))).toBe("needsYou");
    expect(delegationBucket(ask({ execution: "interrupted", attempt: { n: 1, interruptReason: "ownerStop" } as never }))).toBe("waiting");
    expect(delegationBucket(ask({ execution: "answered", review: "awaitingAcceptance", requester: { kind: "owner" } }))).toBe("needsYou");
    expect(delegationBucket(ask({ execution: "answered", review: "awaitingAcceptance" }))).toBe("waiting");
    expect(delegationBucket(ask({ execution: "answered" }))).toBe("done");
    expect(delegationBucket(ask({ execution: "queued" }))).toBe("waiting");
    expect(delegationBucket(ask({ execution: "admitted", hold: { reason: "paused" } as never }))).toBe("waiting");
    expect(delegationBucket(ask({ execution: "admitted" }))).toBe("active");
    expect(delegationBucket(ask({ closed: "accepted" }))).toBe("done");
  });

  it("orders waiting oldest first, active newest start first", () => {
    const rows = [
      ask({ askId: "w-new", execution: "queued", createdAt: ago(10) }),
      ask({ askId: "w-old", execution: "queued", createdAt: ago(900) }),
      ask({ askId: "r-old", attempt: { n: 1, startedAt: ago(500) } }),
      ask({ askId: "r-new", attempt: { n: 1, startedAt: ago(5) } }),
      ask({ askId: "review", execution: "pendingReview" }),
    ];
    expect(orderDelegations(rows).map((d) => d.askId)).toEqual(["review", "w-old", "w-new", "r-new", "r-old"]);
    expect(needsYouCount(rows)).toBe(1);
  });

  it("waits from creation, runs from the attempt start", () => {
    const d = ask({ attempt: { n: 1, startedAt: ago(42) } });
    expect(waitSeconds(d, NOW)).toBe(600);
    expect(rowSeconds(d, "active", NOW)).toBe(42);
    expect(rowSeconds(ask(), "active", NOW)).toBe(600);
    expect(rowSeconds(d, "done", NOW)).toBeNull();
    expect([formatSpan(3.33), formatSpan(12), formatSpan(250), formatSpan(3900), formatSpan(3 * 86400)]).toEqual(["3.3s", "12s", "4m", "1h 5m", "3d"]);
  });

  it("offers only the commands that apply", () => {
    expect(delegationActions(ask())).toEqual({ stop: true, retry: false, accept: false, abandon: false });
    expect(delegationActions(ask({ execution: "interrupted" }))).toEqual({ stop: false, retry: true, accept: false, abandon: true });
    expect(delegationActions(ask({ execution: "answered", review: "awaitingAcceptance" }))).toMatchObject({ accept: true, abandon: true });
    expect(delegationActions(ask({ closed: "accepted" }))).toEqual({ stop: false, retry: false, accept: false, abandon: false });
  });
});

describe("per-agent selections", () => {
  const byId = Object.fromEntries(
    [
      ask({ askId: "mine-run" }),
      ask({ askId: "mine-done", execution: "answered" }),
      ask({ askId: "to-me-q2", requester: { kind: "owner" }, target: "cutex.lead", execution: "queued", queuePosition: 2 }),
      ask({ askId: "to-me-q1", target: "cutex.lead", requester: { kind: "agent", cutex_session_id: "cutex.eva" }, execution: "queued", queuePosition: 1 }),
      ask({ askId: "to-me-run", target: "cutex.lead", requester: { kind: "owner" } }),
      ask({ askId: "other", requester: { kind: "owner" } }),
    ].map((d) => [d.askId, d]),
  );

  it("splits an agent's unfinished delegations by direction", () => {
    const r = agentDelegations(byId, "cutex.lead");
    expect(r.mine.map((d) => d.askId)).toEqual(["mine-run"]);
    expect(r.toMe.map((d) => d.askId).sort()).toEqual(["to-me-q1", "to-me-q2", "to-me-run"]);
    expect(r.finished).toBe(1);
  });

  it("lists the not-started ones for the queue panel by position", () => {
    expect(pendingForAgent(byId, "cutex.lead").map((d) => d.askId)).toEqual(["to-me-q1", "to-me-q2"]);
  });

  it("reads both requester spellings", () => {
    expect(requesterSession({ kind: "agent", cutex_session_id: "cutex.a" })).toBe("cutex.a");
    expect(requesterSession({ kind: "agent", cutexSessionId: "cutex.b" })).toBe("cutex.b");
    expect(requesterSession({ kind: "owner" })).toBeNull();
  });
});

describe("events", () => {
  const records = (d: AskSummary): DelegationRecords => ({ byId: { [d.askId]: d }, progress: {}, questions: {} });

  it("applies newer state changes only (each event arrives twice)", () => {
    const r = records(ask({ execution: "queued", revision: 3 }));
    const patch = applyAskEvent(r, "cutex/ask/stateChanged", { askId: "ask-1", execution: "running", hold: null, review: null, revision: 4, attempt: { n: 1, turnId: "t9", state: "running" } });
    expect(patch?.byId?.["ask-1"]).toMatchObject({ execution: "running", revision: 4, attempt: { n: 1, turnId: "t9" } });
    const next = { ...r, ...patch } as DelegationRecords;
    expect(applyAskEvent(next, "cutex/ask/stateChanged", { askId: "ask-1", execution: "running", revision: 4 })).toBeNull();
    expect(applyAskEvent(r, "cutex/ask/stateChanged", { askId: "ask-1", targetReverted: true })).toBeNull();
  });

  it("dedupes progress notes and merges questions", () => {
    const r = records(ask());
    const p1 = applyAskEvent(r, "cutex/ask/progress", { askId: "ask-1", text: "half way", at: ago(5) })!;
    const r2 = { ...r, ...p1 } as DelegationRecords;
    expect(r2.progress["ask-1"]).toHaveLength(1);
    expect(applyAskEvent(r2, "cutex/ask/progress", { askId: "ask-1", text: "half way", at: ago(5) })).toBeNull();
    const q = applyAskEvent(r2, "cutex/ask/question", { question: { askId: "ask-1", questionId: "q1", state: "open", questions: ["Which branch?"] }, routedToOwner: true })!;
    expect(q.questions?.["ask-1"]?.[0]).toMatchObject({ questionId: "q1", route: "owner" });
  });

  it("records answers and closes", () => {
    const r = records(ask({ execution: "answered", revision: 5 }));
    expect(applyAskEvent(r, "cutex/ask/answered", { askId: "ask-1", answerId: "an-1", preview: "LGTM" })?.byId?.["ask-1"]).toMatchObject({ answerId: "an-1", answerPreview: "LGTM" });
    expect(applyAskEvent(r, "cutex/ask/closed", { askId: "ask-1", outcome: "accepted", revision: 6 })?.byId?.["ask-1"]?.closed).toBe("accepted");
    expect(applyAskEvent(r, "cutex/ask/closed", { askId: "ask-1", outcome: "accepted", revision: 5 })).toBeNull();
    expect(applyAskEvent(r, "cutex/ask/progress", { askId: "missing" })).toBeNull();
  });

  it("adds created asks and lets newer list rows win when merging", () => {
    const created = applyAskEvent({ byId: {}, progress: {}, questions: {} }, "cutex/ask/created", {
      ask: { askId: "ask-9", title: "New", requester: { kind: "owner" }, targetCutexSessionId: "cutex.helper", execution: "pendingReview", revision: 1, attempts: [], questions: [{ questionId: "q", state: "open", route: "owner" }] },
    });
    expect(created?.byId?.["ask-9"]).toMatchObject({ target: "cutex.helper", execution: "pendingReview", ownerQuestions: 1 });
    const byId = { "ask-1": ask({ revision: 5, answerPreview: "kept" }) };
    expect(mergeSummaries(byId, [ask({ revision: 4, title: "stale" })])).toBe(byId);
    expect(mergeSummaries(byId, [ask({ revision: 5, title: "fresh" })])["ask-1"]).toMatchObject({ title: "fresh", answerPreview: "kept" });
  });

  it("reads a full record's last attempt", () => {
    const s = summaryFromRecord({ askId: "a", title: "T", targetCutexSessionId: "cutex.x", execution: "running", attempts: [{ n: 1 }, { n: 2, turnId: "t2", startedAt: ago(3) }], revision: 2 });
    expect(s).toMatchObject({ attempts: 2, attempt: { n: 2, turnId: "t2" } });
    expect(summaryFromRecord({ title: "no id" })).toBeNull();
  });
});

describe("transcript", () => {
  const delegate = done("agent_delegate", { target: "Helper", title: "Parser review", text: "Review it" }, { ok: true, delegation_id: "ask-1", target: "Helper", target_id: "cutex.helper", state: "queued", queue_position: 2 }, "c1", "t1");

  it("reads agent_delegate calls; refused calls have no id", () => {
    expect(delegateCallOf(itemOf(delegate))).toMatchObject({ askId: "ask-1", title: "Parser review", targetId: "cutex.helper", snapshot: { execution: "queued", queuePosition: 2 } });
    const refused = done("agent_delegate", { target: "Helper", text: "x" }, { ok: false, error: "no" });
    expect(delegateCallOf(itemOf(refused))?.askId).toBeNull();
    expect(isStandalone(delegate)).toBe(true);
    expect(isStandalone(refused)).toBe(false);
  });

  // Owner report 2026-10-18: since cutex prompt revision A8 (117b2c8) the delegate result carries
  // the id as `delegation` (`delegation-<hex>`), which the card never read: every delegation fell
  // back to a plain task line inside the work group. Exact shapes of a reviewed and a normal call.
  const reviewed = done(
    "agent_delegate",
    { target: "test1018-claude", title: "Check the parser", text: "Review it" },
    { approval_id: "apr-0123abcd", delegation: "delegation-e0eee0", detail: "test1018-claude can do more than you, so the owner reviews each delegation to it before it runs (this one included). Nothing to do now: continue or end your turn.", ok: true, state: "pendingReview", target: "test1018-claude" },
    "c2",
    "t1",
  );
  const queuedA8 = done("agent_delegate", { target: "Helper", title: "Parser review", text: "Review it" }, { ok: true, created: true, delegation: "delegation-1a2b3c", target: "Helper", target_id: "cutex.…a1b2c3", state: "queued", queue_position: 1 }, "c3", "t1");

  it("reads the A8 `delegation` id: a pendingReview call and a queued one are both cards", () => {
    expect(delegateCallOf(itemOf(reviewed))).toMatchObject({ askId: "delegation-e0eee0", title: "Check the parser", targetName: "test1018-claude", snapshot: { execution: "pendingReview" } });
    expect(isStandalone(reviewed)).toBe(true);
    expect(delegateCallOf(itemOf(queuedA8))).toMatchObject({ askId: "delegation-1a2b3c", snapshot: { execution: "queued", queuePosition: 1 } });
    expect(isStandalone(queuedA8)).toBe(true);
    const refused = done("agent_delegate", { target: "Helper", text: "x" }, { ok: false, code: "delegation_cycle", delegation: "delegation-1a2b3c" });
    expect(delegateCallOf(itemOf(refused))?.askId).toBeNull();
  });

  it("infers A8 wait results under `delegation`", () => {
    const wait = done("delegation_wait", {}, { results: [{ kind: "answer", delegation: "delegation-e0eee0", status: "answered", answer: "done" }], delegations: [] }, "w2", "t2");
    expect(inferDelegations([reviewed, wait]).get("delegation-e0eee0")).toMatchObject({ execution: "answered", answerPreview: "done" });
  });

  it("keeps delegation cards out of work groups", () => {
    const cmd: TimelineEntry = { kind: "tool", id: "x", turnId: "t1", item: { id: "x", type: "commandExecution", command: "ls", status: "completed" } as never };
    const segs = segmentEntries([cmd, delegate, cmd], { standalone: (item) => isStandalone({ kind: "tool", id: item.id, turnId: "t1", item }) });
    expect(segs.map((s) => s.kind)).toEqual(["work", "entry", "work"]);
  });

  it("infers state from waits and closes", () => {
    const wait = done("delegation_wait", {}, { results: [{ kind: "answer", delegation_id: "ask-1", status: "answered", answer: "LGTM", awaiting_acceptance: true }] }, "w1", "t2");
    const close = done("delegation_close", { delegation: "ask-1", outcome: "accepted" }, { ok: true }, "x1", "t3");
    const inferred = inferDelegations([delegate, wait, close]).get("ask-1");
    expect(inferred).toMatchObject({ execution: "answered", review: "awaitingAcceptance", answerPreview: "LGTM", closed: "accepted" });
    const fallback = fallbackSummary("ask-1", delegateCallOf(itemOf(delegate)), inferred, "cutex.lead");
    expect(fallback).toMatchObject({ revision: -1, target: "cutex.helper", requester: { kind: "agent", cutexSessionId: "cutex.lead" } });
    expect(delegationBucket(fallback)).toBe("done");
    expect(delegateEntryOf([wait, delegate], "ask-1")).toEqual({ entryId: "c1", turnId: "t1" });
  });

  it("parses the delegation views", () => {
    const askMsg = message("cutex.delegation-ask.v1", { askId: "ask-1", attempt: 2, requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Lead" }, title: "Parser review", gated: true });
    expect(delegationAskRow(askMsg)).toMatchObject({ askId: "ask-1", attempt: 2, requesterId: "cutex.lead", requesterName: "Lead", owner: false, gated: true });
    expect(delegationAskRow(message("cutex.delegation-ask.v1", { askId: "a", requester: { kind: "owner" } }))).toMatchObject({ owner: true, attempt: 1 });
    expect(delegationAskRow(message("cutex.agent-message.v1", { askId: "a" }))).toBeNull();
    const results = message("cutex.delegation-results.v1", {
      items: [
        { kind: "answer", askId: "ask-1", title: "Parser review", target: { id: "cutex.helper", name: "Helper" }, status: "answered", preview: "LGTM" },
        { kind: "question", askId: "ask-2", title: "Other", questionId: "q1" },
        { kind: "nonsense-without-id" },
      ],
    });
    expect(delegationResultItems(results)).toMatchObject([
      { kind: "answer", askId: "ask-1", targetId: "cutex.helper", targetName: "Helper", preview: "LGTM" },
      { kind: "question", askId: "ask-2", questionId: "q1" },
    ]);
  });

  it("badges the final reply of finished turns an ASK started", () => {
    const askMsg = message("cutex.delegation-ask.v1", { askId: "ask-1", requester: { kind: "agent", cutexSessionId: "cutex.lead" }, title: "T" });
    const entries = [received("r1", "t1", askMsg), agentText("a1", "t1"), agentText("a2", "t1"), received("r2", "t2", askMsg), agentText("a3", "t2"), agentText("a4", "t3")];
    const turns = [
      { id: "t1", status: "completed" },
      { id: "t2", status: "inProgress" },
      { id: "t3", status: "completed" },
    ] as never;
    expect([...handlerReplies(entries, turns).keys()]).toEqual(["a2"]);
    expect(askRowTurnOf(entries, "ask-1")).toBe("t2");
    expect(askRowTurnOf(entries, "nope")).toBeNull();
  });
});
