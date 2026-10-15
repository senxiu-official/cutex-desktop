import { describe, expect, it } from "vitest";
import type { AskDetail, AskSummary } from "../src/shared/ipc";
import { ownerSteeredOf } from "../src/renderer/src/lib/delegations";
import { currentDelegationTurn, delegationKeyAction, delegationSendChoices, delegationTurnSeconds, sendHowFor } from "../src/renderer/src/lib/delegationTurn";
import { emptyTimeline, type ExternalMessage, type TimelineEntry, type TimelineState } from "../src/renderer/src/lib/timeline";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ASKS = new Set(["agent-asks"]);

const askMessage = (data: Record<string, unknown>): ExternalMessage => ({ senderId: "lead", senderName: "Lead", deliveryMode: null, text: "brief", schema: "cutex.delegation-ask.v1", data, eventType: "ASK", sourceKind: "agent" });
const ASK_DATA = { askId: "ask-3", attempt: 1, requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Lead" }, title: "Parser review" };

/** A timeline whose turn t2 runs and opened with `first` (default: the ASK row). */
function running(first: TimelineEntry | null = { kind: "received", id: "r1", turnId: "t2", message: askMessage(ASK_DATA) }, active = true): TimelineState {
  const tl = emptyTimeline();
  const entries: TimelineEntry[] = [{ kind: "user", id: "u1", turnId: "t1", text: "hi" } as TimelineEntry, ...(first ? [first] : []), { kind: "agent", id: "a1", turnId: "t2", text: "working", streaming: true } as TimelineEntry];
  for (const e of entries) tl.entries.set(e.id, e);
  tl.turns = [
    { id: "t1", status: "completed", startedAt: NOW / 1000 - 600, completedAt: NOW / 1000 - 590, entryIds: ["u1"] },
    { id: "t2", status: active ? "inProgress" : "completed", startedAt: NOW / 1000 - 90, completedAt: null, entryIds: entries.filter((e) => e.turnId === "t2").map((e) => e.id) },
  ];
  tl.activeTurnId = active ? "t2" : null;
  return tl;
}

const record = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-3",
  title: "Parser review (record)",
  requester: { kind: "agent", cutexSessionId: "cutex.lead", name: "Lead" },
  target: "cutex.helper",
  execution: "running",
  attempts: 1,
  createdAt: new Date(NOW - 300_000).toISOString(),
  updatedAt: new Date(NOW - 60_000).toISOString(),
  revision: 4,
  ...over,
});

describe("currentDelegationTurn", () => {
  it("is the ASK row of the running turn, with the record's title and attempt start", () => {
    const turn = currentDelegationTurn(running(), { "ask-3": record({ attempt: { n: 1, startedAt: new Date(NOW - 120_000).toISOString() } }) }, ASKS);
    expect(turn).toMatchObject({ askId: "ask-3", title: "Parser review (record)", requesterId: "cutex.lead", requesterName: "Lead", owner: false, startedAt: NOW - 120_000 });
    expect(delegationTurnSeconds(turn!, NOW)).toBe(120);
  });

  it("falls back to the ASK row and the turn start without a record", () => {
    const turn = currentDelegationTurn(running(), {}, ASKS);
    expect(turn).toMatchObject({ title: "Parser review", startedAt: NOW - 90_000 });
    expect(delegationTurnSeconds({ startedAt: null }, NOW)).toBeNull();
  });

  it("names the owner as requester", () => {
    const turn = currentDelegationTurn(running({ kind: "received", id: "r1", turnId: "t2", message: askMessage({ ...ASK_DATA, requester: { kind: "owner" } }) }), {}, ASKS);
    expect(turn).toMatchObject({ owner: true, requesterId: null });
  });

  it("is null without agent-asks, without a running turn, or for a plain turn", () => {
    expect(currentDelegationTurn(running(), {}, new Set())).toBeNull();
    expect(currentDelegationTurn(running(undefined, false), {}, ASKS)).toBeNull();
    expect(currentDelegationTurn(running(null), {}, ASKS)).toBeNull();
    expect(currentDelegationTurn(null, {}, ASKS)).toBeNull();
  });

  it("ends with the record: answered / closed / interrupted are not running any more; queued / admitted lag", () => {
    for (const execution of ["answered", "failed", "interrupted", "cancelled"] as const) expect(currentDelegationTurn(running(), { "ask-3": record({ execution }) }, ASKS)).toBeNull();
    expect(currentDelegationTurn(running(), { "ask-3": record({ closed: "stopped" }) }, ASKS)).toBeNull();
    expect(currentDelegationTurn(running(), { "ask-3": record({ execution: "admitted" }) }, ASKS)).not.toBeNull();
  });
});

describe("delegationKeyAction", () => {
  const on = { delegation: true, allowSteerKeys: false };
  it("queues steer and interrupt-and-send shortcuts during a delegation turn by default", () => {
    expect(delegationKeyAction("steer", on)).toBe("queue");
    expect(delegationKeyAction("interruptSend", on)).toBe("queue");
    for (const a of ["send", "queue", "interrupt", "interruptSendSteers"] as const) expect(delegationKeyAction(a, on)).toBe(a);
  });

  it("leaves keys alone with the setting on or outside a delegation turn", () => {
    expect(delegationKeyAction("steer", { delegation: true, allowSteerKeys: true })).toBe("steer");
    expect(delegationKeyAction("interruptSend", { delegation: false, allowSteerKeys: false })).toBe("interruptSend");
  });
});

describe("send choices", () => {
  it("offers join only when the agent can steer, queue first", () => {
    expect(delegationSendChoices(true)).toEqual(["queue", "join", "interrupt"]);
    expect(delegationSendChoices(false)).toEqual(["queue", "interrupt"]);
    expect(["queue", "join", "interrupt"].map((c) => sendHowFor(c as never))).toEqual(["queue", "steer", "interruptSend"]);
  });
});

describe("ownerSteeredOf", () => {
  const detail = (over: Partial<AskDetail>) => over as AskDetail;
  it("reads the answer metadata, else the latest attempt", () => {
    expect(ownerSteeredOf(detail({ answer: { answerId: "a", metadata: { ownerSteered: true } } }))).toBe(true);
    expect(ownerSteeredOf(detail({ answer: { answerId: "a", metadata: { ownerSteered: false } } }))).toBe(false);
    expect(ownerSteeredOf(detail({ answer: null, attempts: [{ n: 1 }, { n: 2, ownerSteered: true } as never] }))).toBe(true);
    expect(ownerSteeredOf(detail({ answer: { answerId: "a", metadata: null }, attempts: [{ n: 1 }] }))).toBe(false);
    expect(ownerSteeredOf(null)).toBe(false);
    expect(ownerSteeredOf(undefined)).toBe(false);
  });
});
