// Shared admission order (cutex admission-order) as turn groups: grouping, ride-along timing, drop
// targets (insert into the running turn, slots between turns, never onto a delegation), move targets
// (incl. queue.ownerMayPassAsks off), the optimistic move with rollback, and main's refusal mapping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionItem, AdmissionNextStep, QueueAdmission, QueueItem } from "@cutex-desktop/protocol";
import type { AskSummary } from "../src/shared/ipc";
import { admittedAskIds, applyMove, askWithAdmissionPosition, atBoundary, beforeForSlot, canMoveTo, currentTurnOf, insertRefusal, moveTargets, pausedFrom, turnStopped, readOwnerMayPassAsks, rideAlongAsk, rideAlongLabel, rideAlongTiming, rideAlongView, foldQueueRows, foldRow, pendingSectionMessages, slotForGroup, turnGroups } from "../src/renderer/src/lib/admissionOrder";
import { stripInside, STRIP_ROOM } from "../src/renderer/src/lib/railStrip";
import { parseQueueMoveError, queueMoveErrorKind, queueMoveErrorMessage } from "../src/shared/queueMove";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { viewKey } from "../src/renderer/src/lib/viewKey";

const api = vi.hoisted(() => ({
  queueMove: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})),
  queueList: vi.fn(async () => ({ revision: 1, items: [] })),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api, onEvent: () => () => {} }));

const at = "2026-10-12T00:00:00Z";
const owner = (id: string, position: number, state: AdmissionItem["state"] = "waiting"): AdmissionItem => ({ kind: "owner", id, position, enqueuedAt: at, state });
const askItem = (id: string, position: number, hold: string | null = "targetBusy"): AdmissionItem => ({ kind: "ask", id, position, enqueuedAt: at, state: "waiting", hold });
const delivery = (id: string, position: number): AdmissionItem => ({ kind: "delivery", id, position, enqueuedAt: at, state: "waiting", deliveryKind: "alarm", label: "check" });
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: queueId, text_elements: [] }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const summary = (askId: string, position: number): AskSummary => ({ askId, title: askId, hold: { reason: "targetBusy", position }, queuePosition: position } as AskSummary);

// A B c D e: owner A, ask B, owner c, delivery D, owner e.
const admission: QueueAdmission = { revision: 17, items: [owner("A", 1), askItem("B", 2), owner("c", 3), delivery("D", 4), owner("e", 5)] };
const ids = (a: QueueAdmission) => [...a.items].sort((x, y) => x.position - y.position).map((e) => e.id).join("");

describe("turn groups", () => {
  it("numbers owner / ask turns in admission order; deliveries ride along", () => {
    const shuffled = { ...admission, items: [...admission.items].reverse(), nextStep: [{ id: "N", deliveryKind: "tell", enqueuedAt: at }] };
    const { turns, nextStep } = turnGroups(shuffled, [queued("e"), queued("A"), queued("c")], { B: summary("B", 1) });
    expect(turns.map((r) => `${r.kind}:${r.entry.id}`)).toEqual(["owner:A", "ask:B", "owner:c", "owner:e"]);
    // An older draft's delivery entry is read as a ride-along item, after the listed ones.
    expect(nextStep.map((n) => n.id)).toEqual(["N", "D"]);
    const first = turns[0]!;
    expect(first.kind === "owner" && first.item.queueId).toBe("A");
    expect(first.key).toBe("cm-A");
    const ask = turns[1]!;
    expect(ask.kind === "ask" && ask.ask?.askId).toBe("B");
  });

  it("leaves out hidden owner turns, keeps unknown asks and their notes, appends owner items the list lacks", () => {
    const withNotes: QueueAdmission = { revision: 1, items: [owner("A", 1), { ...askItem("B", 2), includedNotes: [{ label: "tell" }] } as AdmissionItem, owner("e", 3)] };
    const { turns } = turnGroups(withNotes, [queued("A"), queued("new")], {});
    expect(turns.map((r) => r.entry.id)).toEqual(["A", "B", "new"]);
    const b = turns[1]!;
    expect(b.kind === "ask" && b.ask).toBeNull();
    expect(b.kind === "ask" && b.entry.includedNotes).toEqual([{ label: "tell" }]);
    expect(turns.at(-1)!.entry.position).toBe(4);
  });

  it("names the admitted asks; the status mark shows the turn number", () => {
    expect([...admittedAskIds(admission)]).toEqual(["B"]);
    expect(admittedAskIds(null).size).toBe(0);
    const s = summary("B", 1);
    expect(askWithAdmissionPosition(s, askItem("B", 2)).hold).toEqual({ reason: "targetBusy", position: 2 });
    expect(askWithAdmissionPosition(s, askItem("B", 1))).toBe(s);
    const paused = { ...s, hold: { reason: "paused" as const, by: "owner" as const } };
    expect(askWithAdmissionPosition(paused, askItem("B", 4))).toBe(paused);
  });

  it("up to 3 rows all show; past that the first 2 (the boundary section always full), then 还有 N 项; the paused divider goes before the first paused turn", () => {
    expect(foldQueueRows(0, 3, false)).toEqual({ shown: 3, hidden: 0 });
    expect(foldQueueRows(1, 2, false)).toEqual({ shown: 2, hidden: 0 });
    expect(foldQueueRows(0, 4, false)).toEqual({ shown: 2, hidden: 2 });
    expect(foldQueueRows(0, 7, false)).toEqual({ shown: 2, hidden: 5 });
    expect(foldQueueRows(1, 7, false)).toEqual({ shown: 1, hidden: 6 });
    expect(foldQueueRows(3, 7, false)).toEqual({ shown: 0, hidden: 7 });
    expect(foldQueueRows(6, 2, false)).toEqual({ shown: 0, hidden: 2 });
    expect(foldQueueRows(3, 7, true)).toEqual({ shown: 7, hidden: 0 });
    expect(foldQueueRows(1, 3, false)).toEqual({ shown: 1, hidden: 2 });
    const { turns } = turnGroups({ revision: 1, items: [askItem("B", 1), owner("A", 2, "paused"), owner("c", 3, "paused")] }, [queued("A"), queued("c")], {});
    expect(pausedFrom(turns, new Set())).toBe(1);
    const waiting = turnGroups({ revision: 1, items: [owner("A", 1), owner("c", 2)] }, [queued("A"), queued("c")], {}).turns;
    expect(pausedFrom(waiting, new Set())).toBe(-1);
    expect(pausedFrom(waiting, new Set(["c"]))).toBe(1);
    // A stopped owner turn before a startable ask doesn't block it: no divider there, only the trailing run.
    const mixed = turnGroups({ revision: 1, items: [owner("A", 1, "paused"), askItem("B", 2), owner("c", 3, "paused")] }, [queued("A"), queued("c")], {}).turns;
    expect(pausedFrom(mixed, new Set())).toBe(2);
    expect(mixed.map((r) => turnStopped(r, new Set()))).toEqual([true, false, true]);
    const none = turnGroups({ revision: 1, items: [owner("A", 1, "paused"), askItem("B", 2)] }, [queued("A")], {}).turns;
    expect(pausedFrom(none, new Set())).toBe(-1);
  });
});

describe("fold row, strips, old 待读留言 section", () => {
  it("no 「还有 0 项」: the fold row only while something folds, or as 收起 after the owner expanded", () => {
    expect(foldRow(0, 7, false, false)).toEqual({ show: true, hidden: 5 });
    // A drag expands everything: nothing folded, no row.
    expect(foldRow(0, 7, false, true)).toEqual({ show: false, hidden: 0 });
    // Expanded by the owner: 收起.
    expect(foldRow(0, 7, true, false)).toEqual({ show: true, hidden: 0 });
    expect(foldRow(0, 7, true, true)).toEqual({ show: true, hidden: 0 });
    // Everything fits: never a row.
    expect(foldRow(1, 2, false, false).show).toBe(false);
    expect(foldRow(1, 2, true, false).show).toBe(false);
  });

  it("the strip flips inside the frame without room on the left", () => {
    expect(stripInside(STRIP_ROOM - 1)).toBe(true);
    expect(stripInside(STRIP_ROOM + 200)).toBe(false);
  });

  it("the 待读留言 section: every unread row without admission-order, with it those nextStep does not list (notes)", () => {
    const rows = [{ messageId: "note-1" }, { messageId: "wake-1" }, { messageId: "ptell-1" }];
    const nextStep = [{ id: "wake-1" }];
    expect(pendingSectionMessages(new Set(["agent-messages-v2"]), rows, nextStep).map((m) => m.messageId)).toEqual(["note-1", "wake-1", "ptell-1"]);
    // Passive notes are never ride-along items in cutex (user-input-delivery §3): they stay in the section.
    expect(pendingSectionMessages(new Set(["agent-messages-v2", "admission-order"]), rows, nextStep).map((m) => m.messageId)).toEqual(["note-1", "ptell-1"]);
    expect(pendingSectionMessages(new Set(["agent-messages-v2", "admission-order"]), rows, undefined)).toHaveLength(3);
    expect(pendingSectionMessages(new Set(["agent-messages-v2"]), [], nextStep)).toEqual([]);
    expect(pendingSectionMessages(new Set([]), rows, nextStep)).toEqual([]);
  });
});

describe("ride-along timing", () => {
  const now = Date.parse("2026-10-12T00:10:00Z");
  const item = (over: Partial<AdmissionNextStep>): AdmissionNextStep => ({ id: "x", deliveryKind: "tell", enqueuedAt: "2026-10-12T00:09:00Z", ...over });

  it("a waiting wake counts down (ring share of the whole wait), then inserts at the next step", () => {
    const wake = item({ timing: "afterTurn", nextStepAt: "2026-10-12T00:11:00Z" });
    expect(rideAlongTiming(wake, now)).toEqual({ kind: "waitInsert", secs: 60, left: 0.5 });
    expect(rideAlongTiming(wake, now + 59_500)).toMatchObject({ kind: "waitInsert", secs: 1 });
    expect(rideAlongTiming(wake, now + 60_000)).toEqual({ kind: "nextStep" });
    expect(atBoundary(wake)).toBe(true);
  });

  it("alarms and wakes that never switch wait for the turn end; older drafts default by kind", () => {
    expect(rideAlongTiming(item({ deliveryKind: "alarm", timing: "afterTurn" }), now)).toEqual({ kind: "afterTurn" });
    expect(rideAlongTiming(item({ timing: "afterTurn", nextStepAt: null }), now)).toEqual({ kind: "afterTurn" });
    expect(rideAlongTiming(item({ deliveryKind: "alarm" }), now)).toEqual({ kind: "afterTurn" });
    expect(rideAlongTiming(item({}), now)).toEqual({ kind: "nextStep" });
    expect(atBoundary(item({ deliveryKind: "alarm", timing: "afterTurn" }))).toBe(false);
    expect(atBoundary(item({ timing: "afterTurn" }))).toBe(false);
    expect(atBoundary(item({ timing: "nextStep" }))).toBe(true);
  });
});

describe("drop targets", () => {
  it("insert into the running turn: refused in a delegation's turn and without steering", () => {
    expect(insertRefusal({ kind: "owner" }, true)).toBeNull();
    expect(insertRefusal({ kind: "delivery" }, true)).toBeNull();
    expect(insertRefusal({ kind: "ask", askId: "a" }, true)).toBe("askTurn");
    expect(insertRefusal({ kind: "owner" }, false)).toBe("noSteer");
  });

  it("the running turn's owner falls back to the timeline's delegation, else the owner", () => {
    expect(currentTurnOf(false, { kind: "owner" }, "a")).toBeNull();
    expect(currentTurnOf(true, { kind: "ask", askId: "b" }, null)).toEqual({ kind: "ask", askId: "b" });
    expect(currentTurnOf(true, null, "a")).toEqual({ kind: "ask", askId: "a" });
    expect(currentTurnOf(true, undefined, null)).toEqual({ kind: "owner" });
  });

  it("slots: owner groups split in halves; a delegation only near its edges", () => {
    expect(slotForGroup("owner", 2, 0.2)).toBe(2);
    expect(slotForGroup("owner", 2, 0.6)).toBe(3);
    expect(slotForGroup("ask", 2, 0.1)).toBe(2);
    expect(slotForGroup("ask", 2, 0.5)).toBeNull();
    expect(slotForGroup("ask", 2, 0.9)).toBe(3);
  });
});

describe("move targets", () => {
  const entries = [...admission.items];

  it("offers 上移 / 下移 / 移到最后 as before-refs; never for non-owner rows", () => {
    expect(moveTargets(entries, "c", true)).toEqual({ up: { before: { kind: "ask", id: "B" } }, down: { before: { kind: "owner", id: "e" } }, last: { before: null } });
    expect(moveTargets(entries, "A", true)).toEqual({ up: undefined, down: { before: { kind: "owner", id: "c" } }, last: { before: null } });
    expect(moveTargets(entries, "e", true)).toEqual({ up: { before: { kind: "delivery", id: "D" } }, down: undefined, last: undefined });
    expect(moveTargets(entries, "B", true)).toEqual({});
  });

  it("ownerMayPassAsks off: no move ahead of a non-owner row ahead of it; later is fine", () => {
    expect(moveTargets(entries, "c", false).up).toBeUndefined();
    expect(moveTargets(entries, "c", false).down).toEqual({ before: { kind: "owner", id: "e" } });
    expect(moveTargets(entries, "e", false).up).toBeUndefined();
    // c → before A passes B: refused; e → before c passes D: refused.
    expect(canMoveTo(entries, 2, 0, false)).toBe(false);
    expect(canMoveTo(entries, 4, 2, false)).toBe(false);
    expect(canMoveTo(entries, 2, 0, true)).toBe(true);
    // Between owner rows only: allowed.
    const owners = [owner("A", 1), owner("b", 2), askItem("X", 3)];
    expect(canMoveTo(owners, 1, 0, false)).toBe(true);
    // A after B (later): allowed either way.
    expect(canMoveTo(entries, 0, 2, false)).toBe(true);
  });

  it("drop slots: no-op slots and non-owner sources are refused; before of a slot", () => {
    expect(canMoveTo(entries, 2, 2, true)).toBe(false);
    expect(canMoveTo(entries, 2, 3, true)).toBe(false);
    expect(canMoveTo(entries, 1, 0, true)).toBe(false);
    expect(canMoveTo(entries, 0, 6, true)).toBe(false);
    expect(canMoveTo(entries, 0, 5, true)).toBe(true);
    expect(beforeForSlot(entries, 1)).toEqual({ kind: "ask", id: "B" });
    expect(beforeForSlot(entries, 5)).toBeNull();
  });
});

describe("applyMove (optimistic order)", () => {
  it("moves only the owner item; asks and deliveries keep their relative order", () => {
    expect(ids(applyMove(admission, "c", { kind: "owner", id: "A" }))).toBe("cABDe");
    expect(ids(applyMove(admission, "A", { kind: "delivery", id: "D" }))).toBe("BcADe");
    expect(ids(applyMove(admission, "A", null))).toBe("BcDeA");
    expect(ids(applyMove(admission, "e", { kind: "ask", id: "B" }))).toBe("AeBcD");
    const moved = applyMove(admission, "e", { kind: "ask", id: "B" });
    expect(moved.items.map((e) => e.position)).toEqual([1, 2, 3, 4, 5]);
    expect(moved.revision).toBe(17);
  });

  it("returns the same list for no-ops and unknown items", () => {
    expect(applyMove(admission, "c", { kind: "delivery", id: "D" })).toBe(admission);
    expect(applyMove(admission, "e", null)).toBe(admission);
    expect(applyMove(admission, "B", null)).toBe(admission);
    expect(applyMove(admission, "c", { kind: "ask", id: "nope" })).toBe(admission);
    expect(applyMove(admission, "c", { kind: "owner", id: "c" })).toBe(admission);
  });

  it("reads the setting (undefined on older cutex)", () => {
    expect(readOwnerMayPassAsks({ queue: { ownerMayPassAsks: false } })).toBe(false);
    expect(readOwnerMayPassAsks({})).toBeUndefined();
    expect(readOwnerMayPassAsks(null)).toBeUndefined();
  });
});

describe("move refusals", () => {
  it("maps cutex codes and reads them after the IPC hop", () => {
    expect(queueMoveErrorKind("revision_conflict")).toBe("conflict");
    expect(queueMoveErrorKind("passing_not_allowed")).toBe("passingNotAllowed");
    expect(queueMoveErrorKind("queue_item_not_found")).toBe("gone");
    expect(queueMoveErrorKind("persistence_failed")).toBeNull();
    expect(parseQueueMoveError(`Error invoking remote method 'invoke': Error: ${queueMoveErrorMessage("passingNotAllowed")}`)).toBe("passingNotAllowed");
    expect(parseQueueMoveError("queue_move_refused:bogus")).toBeNull();
    for (const key of Object.keys(zhCN).filter((k) => k.startsWith("queue.move.") || k.startsWith("queue.order.") || k.startsWith("queue.delivery."))) expect((en as Record<string, string>)[key]).toBeTruthy();
  });
});

describe("store queueMove", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.queueMove.mockReset();
    api.queueList.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  async function seed() {
    const { useApp } = await import("../src/renderer/src/store");
    useApp.setState({ selectedId: "s", features: new Set(["admission-order"]), sessions: { [viewKey("local", "s")]: { queue: [queued("A"), queued("c"), queued("e")], admission } as never } });
    return useApp;
  }

  it("shows the new order at once and keeps cutex's answer", async () => {
    const useApp = await seed();
    const answer = { revision: 18, items: [owner("c", 1), owner("A", 2), askItem("B", 3), delivery("D", 4), owner("e", 5)] };
    let release!: (v: unknown) => void;
    api.queueMove.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const done = useApp.getState().queueMove(queued("c"), { kind: "owner", id: "A" });
    expect(ids(useApp.getState().sessions[viewKey("local", "s")]!.admission!)).toBe("cABDe");
    expect(api.queueMove).toHaveBeenCalledWith("s", "c", 17, { kind: "owner", id: "A" });
    release({ revision: 18, admission: answer });
    await done;
    expect(useApp.getState().sessions[viewKey("local", "s")]!.admission).toEqual(answer);
  });

  it("sends the order revision (not the snapshot revision) as the move's CAS", async () => {
    const { useApp } = await import("../src/renderer/src/store");
    useApp.setState({ selectedId: "s", features: new Set(["admission-order"]), sessions: { [viewKey("local", "s")]: { queue: [queued("A"), queued("c"), queued("e")], admission: { ...admission, revision: 40, orderRevision: 9 } } as never } });
    api.queueMove.mockResolvedValueOnce({});
    await useApp.getState().queueMove(queued("c"), { kind: "owner", id: "A" });
    expect(api.queueMove).toHaveBeenCalledWith("s", "c", 9, { kind: "owner", id: "A" });
  });

  it("rolls back on a refusal and words it as a notice", async () => {
    const useApp = await seed();
    api.queueMove.mockRejectedValueOnce(new Error("Error invoking remote method: Error: queue_move_refused:conflict"));
    const error = await useApp.getState().queueMove(queued("e"), { kind: "ask", id: "B" }).catch((e: Error & { moveRefusal?: string }) => e);
    expect(useApp.getState().sessions[viewKey("local", "s")]!.admission).toBe(admission);
    expect(error).toMatchObject({ moveRefusal: "conflict" });
    expect((error as Error).message).not.toContain("queue_move_refused");
    api.queueMove.mockRejectedValueOnce(new Error("queue_move_refused:passingNotAllowed"));
    await expect(useApp.getState().queueMove(queued("e"), { kind: "ask", id: "B" })).rejects.toMatchObject({ moveRefusal: "passingNotAllowed" });
    const other = new Error("ssh tunnel closed");
    api.queueMove.mockRejectedValueOnce(other);
    await expect(useApp.getState().queueMove(queued("A"), null)).rejects.toBe(other);
    expect(useApp.getState().sessions[viewKey("local", "s")]!.admission).toBe(admission);
  });

  it("does nothing for a no-op or without an admission list", async () => {
    const useApp = await seed();
    await useApp.getState().queueMove(queued("e"), null);
    useApp.setState({ sessions: { [viewKey("local", "s")]: { queue: [queued("A")], admission: null } as never } });
    await useApp.getState().queueMove(queued("A"), null);
    expect(api.queueMove).not.toHaveBeenCalled();
  });
});

describe("rideAlongLabel", () => {
  it("drops cutex's English fallback for an untitled delegation, keeps real titles", () => {
    expect(rideAlongLabel({ deliveryKind: "answer", label: "Answer" })).toBeNull();
    expect(rideAlongLabel({ deliveryKind: "question", label: "Question" })).toBeNull();
    expect(rideAlongLabel({ deliveryKind: "bus", label: "Delegation status" })).toBeNull();
    expect(rideAlongLabel({ deliveryKind: "answer", label: "  整理 scratch 里的脚本 " })).toBe("整理 scratch 里的脚本");
    expect(rideAlongLabel({ deliveryKind: "alarm", label: "Answer" })).toBe("Answer");
    expect(rideAlongLabel({ deliveryKind: "answer", label: null })).toBeNull();
    // The generic bus / tell / alarm labels of cutex before admission-ridealong-detail.
    expect(rideAlongLabel({ deliveryKind: "bus", label: "Bus delivery" })).toBeNull();
    expect(rideAlongLabel({ deliveryKind: "tell", label: "Agent message" })).toBeNull();
    expect(rideAlongLabel({ deliveryKind: "alarm", label: "Alarm" })).toBeNull();
  });
});

describe("rideAlongView", () => {
  it("the most specific text: preview, else a non-generic label; the sender beside it", () => {
    expect(rideAlongView({ deliveryKind: "tell", label: "please review", from: "Reviewer", preview: "please review" })).toEqual({ kind: "tell", from: "Reviewer", text: "please review", note: null });
    expect(rideAlongView({ deliveryKind: "alarm", label: "stand-up", preview: "stand-up" })).toEqual({ kind: "alarm", from: null, text: "stand-up", note: null });
    // A control-type description stays as the tooltip next to the preview.
    expect(rideAlongView({ deliveryKind: "bus", label: "Start message", from: "Agent Management System", preview: "set up the repo" })).toEqual({ kind: "bus", from: "Agent Management System", text: "set up the repo", note: "Start message" });
    expect(rideAlongView({ deliveryKind: "bus", label: "Job job-1 failed (exit 2)", preview: "Job job-1 failed (exit 2)", askId: "ask-1" }).kind).toBe("status");
  });

  it("a cross-host tell is a peer message; an older cutex's generic labels leave no text (the row falls back)", () => {
    expect(rideAlongView({ deliveryKind: "tell", label: "see the log", from: "worker@alpha", fromHost: "alpha", preview: "see the log" }).kind).toBe("peer");
    expect(rideAlongView({ deliveryKind: "bus", label: "Bus delivery" })).toEqual({ kind: "bus", from: null, text: null, note: null });
    expect(rideAlongView({ deliveryKind: "tell", label: "Agent message" }).text).toBeNull();
    expect(rideAlongView({ deliveryKind: "alarm", label: "Alarm", from: "  " })).toEqual({ kind: "alarm", from: null, text: null, note: null });
  });
});

describe("rideAlongAsk", () => {
  const ask = { askId: "ask-1", target: "helper", title: "  整理脚本 " };
  it("names the handler for the requester's ride-along, with the trimmed title", () => {
    expect(rideAlongAsk({ askId: "ask-1" }, ask, "lead")).toEqual({ askId: "ask-1", party: "target", title: "整理脚本" });
  });
  it("names the requester when this agent handles the delegation", () => {
    expect(rideAlongAsk({ askId: "ask-1" }, ask, "helper")?.party).toBe("requester");
  });
  it("an untitled delegation has no title", () => {
    expect(rideAlongAsk({ askId: "ask-1" }, { ...ask, title: " " }, "lead")?.title).toBeNull();
  });
  it("null without askId (older cutex), without the loaded ask, or for another ask", () => {
    expect(rideAlongAsk({}, ask, "lead")).toBeNull();
    expect(rideAlongAsk({ askId: "ask-1" }, undefined, "lead")).toBeNull();
    expect(rideAlongAsk({ askId: "ask-2" }, ask, "lead")).toBeNull();
  });
});
