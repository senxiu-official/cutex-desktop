// owner-notify origin system / delete (capability owner-notify-delete): pure helpers and the renderer store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { applyAlertRecord, asRecord, canReply, deletedIdOfEvent, isAlerting, isPending, isSystemNotice, OWNER_NOTIFY_CREATED, OWNER_NOTIFY_DELETED, reconcileAlerts, wantsBigAlert, wantsDesktopNotification } from "../src/shared/ownerNotify";
import { ownerNeedReason, ownerNoteActions } from "../src/renderer/src/lib/ownerNotify";
import { emitNotify, retractNotify } from "../src/renderer/src/lib/notifyEvents";
import { needsYouByAgent } from "../src/renderer/src/lib/agentAttention";

const handlers: Record<string, (payload: unknown) => void> = {};
const api = { ownerNotifyAction: vi.fn(), ownerNotifications: vi.fn(async () => []) };
vi.mock("../src/renderer/src/bridge", () => ({
  api,
  bridge: { on: (name: string, fn: (payload: unknown) => void) => void (handlers[name] = fn) },
}));
vi.mock("../src/renderer/src/lib/notifyEvents", () => ({ emitNotify: vi.fn(), retractNotify: vi.fn() }));
/** A host event of the shown host (multi-host P0: tagged with its host and connection). */
const hostEvent = (envelope: unknown) => handlers.hostEvent!({ hostId: "local", epoch: "e1", envelope });

const rec = (id: string, over: Partial<OwnerNotification> = {}): OwnerNotification => ({
  notificationId: id,
  agentId: "eva",
  agentName: "Eva",
  origin: "agent",
  text: "hello",
  level: "attention",
  requestedLevel: "attention",
  downgraded: null,
  muted: false,
  channels: ["desktop"],
  needsReply: false,
  delegation: null,
  job: null,
  turnId: null,
  state: "open",
  createdAt: "2026-10-09T10:00:00.000Z",
  acknowledgedAt: null,
  reply: null,
  closedAt: null,
  ...over,
});

describe("origin and reply gating", () => {
  it("asRecord keeps system, defaults everything else to agent", () => {
    expect(asRecord({ ...rec("1"), origin: "system" })?.origin).toBe("system");
    const { origin: _drop, ...legacy } = rec("2");
    expect(asRecord(legacy)?.origin).toBe("agent");
    expect(asRecord({ ...rec("3"), origin: "martian" })?.origin).toBe("agent");
  });
  it("回复 only for open agent messages that ask for a reply", () => {
    expect(canReply(rec("1", { needsReply: true }))).toBe(true);
    expect(canReply(rec("1", { needsReply: true, state: "acknowledged" }))).toBe(true);
    expect(canReply(rec("1", { needsReply: false }))).toBe(false);
    expect(canReply(rec("1", { needsReply: true, origin: "system" }))).toBe(false);
    expect(canReply(rec("1", { needsReply: true, state: "answered" }))).toBe(false);
    expect(isSystemNotice(rec("1", { origin: "system" }))).toBe(true);
    expect(isSystemNotice({ origin: undefined })).toBe(false);
  });
  it("system notices are records only: not 需要你, no OS notification, no big alert", () => {
    expect(ownerNeedReason(rec("1", { needsReply: true }))).toBe("ownerReply");
    // Even an older cutex's attention notice with desktop + phone + bigAlert channels.
    const loud = rec("s", { origin: "system", channels: ["desktop", "phone", "bigAlert"] });
    expect(isPending(loud)).toBe(false);
    expect(isPending(rec("s", { origin: "system", needsReply: true }))).toBe(false);
    expect(isAlerting(loud)).toBe(false);
    expect(wantsBigAlert(loud)).toBe(false);
    expect(wantsDesktopNotification(loud)).toBe(false);
    expect(ownerNoteActions(loud)).toEqual([]);
    expect(ownerNoteActions(rec("m"))).toEqual(rec("m").channels);
    expect(applyAlertRecord([], loud)).toEqual([]);
    expect(reconcileAlerts([], [loud])).toEqual([]);
    const needs = needsYouByAgent({ ownerNotes: [loud, rec("m")] });
    expect(needs.get("eva")).toMatchObject({ count: 1, reasons: ["ownerMessage"], notificationIds: ["m"] });
    expect(needsYouByAgent({ ownerNotes: [loud] }).size).toBe(0);
  });
  it("deleted event: the id, else null", () => {
    expect(deletedIdOfEvent(OWNER_NOTIFY_DELETED, { notificationId: "ntf-1", agentId: "eva" })).toBe("ntf-1");
    expect(deletedIdOfEvent("cutex/ownerNotify/updated", { notificationId: "ntf-1" })).toBeNull();
    expect(deletedIdOfEvent(OWNER_NOTIFY_DELETED, { notificationId: "../x y" })).toBeNull();
    expect(deletedIdOfEvent(OWNER_NOTIFY_DELETED, null)).toBeNull();
  });
});

describe("owner notify store: delete", () => {
  beforeEach(async () => {
    const { useOwnerNotify } = await import("../src/renderer/src/lib/ownerNotifyStore");
    useOwnerNotify.getState().reset();
    api.ownerNotifyAction.mockReset();
  });

  async function started() {
    const store = await import("../src/renderer/src/lib/ownerNotifyStore");
    const state = { features: new Set<string>(), selectedId: null, view: { kind: "conversation" }, sidebar: null, select: async () => {} };
    store.startOwnerNotifySync({ getState: () => state, subscribe: () => () => {} });
    return store;
  }

  it("our own delete removes the record and a stale copy cannot bring it back", async () => {
    const { ownerNotifyAct, seedOwnerNotes, useOwnerNotify } = await started();
    seedOwnerNotes([rec("ntf-1", { origin: "system" }), rec("ntf-2")]);
    api.ownerNotifyAction.mockResolvedValueOnce({ ok: true, notification: rec("ntf-1", { origin: "system" }) });
    const r = await ownerNotifyAct({ agentId: "eva", notificationId: "ntf-1" }, "delete");
    expect(r.ok).toBe(true);
    expect(api.ownerNotifyAction).toHaveBeenCalledWith("eva", "delete", "ntf-1", undefined);
    expect(Object.keys(useOwnerNotify.getState().byId)).toEqual(["ntf-2"]);
    seedOwnerNotes([rec("ntf-1", { origin: "system" })]);
    expect(useOwnerNotify.getState().byId["ntf-1"]).toBeUndefined();
  });

  it("already gone on the daemon (not found) also removes it locally", async () => {
    const { ownerNotifyAct, seedOwnerNotes, useOwnerNotify } = await started();
    seedOwnerNotes([rec("ntf-1")]);
    api.ownerNotifyAction.mockResolvedValueOnce({ ok: false, error: { code: "notification_not_found", message: "gone" } });
    await ownerNotifyAct({ agentId: "eva", notificationId: "ntf-1" }, "delete");
    expect(useOwnerNotify.getState().byId).toEqual({});
  });

  it("a created system notice is kept (timeline card) but runs no device method", async () => {
    vi.stubGlobal("document", { hasFocus: () => false });
    vi.mocked(emitNotify).mockClear();
    const { useOwnerNotify } = await started();
    const loud = rec("ntf-s", { origin: "system", channels: ["desktop", "phone"] });
    hostEvent({ cutex: { method: OWNER_NOTIFY_CREATED, params: { notification: loud } } });
    expect(useOwnerNotify.getState().byId["ntf-s"]).toBeDefined();
    // Reported with no device methods (the notifications module runs nothing).
    expect(vi.mocked(emitNotify).mock.calls[0]?.[0].decided?.actions).toEqual([]);
    hostEvent({ cutex: { method: OWNER_NOTIFY_CREATED, params: { notification: rec("ntf-m") } } });
    expect(emitNotify).toHaveBeenCalledTimes(2);
    expect(vi.mocked(emitNotify).mock.calls[1]?.[0]).toMatchObject({ key: "owner-notify:ntf-m", skip: ["bigAlert"] });
    vi.unstubAllGlobals();
  });

  it("the deleted event from another client removes the card", async () => {
    const { seedOwnerNotes, useOwnerNotify } = await started();
    seedOwnerNotes([rec("ntf-1"), rec("ntf-2")]);
    hostEvent({ cutex: { method: OWNER_NOTIFY_DELETED, params: { notificationId: "ntf-1", agentId: "eva" } } });
    expect(Object.keys(useOwnerNotify.getState().byId)).toEqual(["ntf-2"]);
    // A late `updated` for the deleted record is ignored.
    hostEvent({ cutex: { method: "cutex/ownerNotify/updated", params: { notification: rec("ntf-1", { state: "acknowledged" }) } } });
    expect(useOwnerNotify.getState().byId["ntf-1"]).toBeUndefined();
  });

  it("a record that stops alerting takes back its popups and main's big alert (main may have missed the event)", async () => {
    const { seedOwnerNotes } = await started();
    seedOwnerNotes([rec("ntf-1"), rec("ntf-old", { state: "answered" })]);
    // The already closed record of the seed: main shows nothing for it unless it missed that too.
    expect(vi.mocked(retractNotify).mock.calls).toEqual([[{ keys: ["owner-notify:ntf-old"], notes: [{ hostId: "local", notificationId: "ntf-old" }] }]]);
    vi.mocked(retractNotify).mockClear();
    // Still open (a newer copy): nothing.
    hostEvent({ cutex: { method: "cutex/ownerNotify/updated", params: { notification: rec("ntf-1", { text: "edited", updatedAt: "2026-10-09T10:01:00.000Z" } as never) } } });
    hostEvent({ cutex: { method: "cutex/ownerNotify/updated", params: { notification: rec("ntf-1", { state: "acknowledged", acknowledgedAt: "2026-10-09T10:02:00.000Z" }) } } });
    expect(vi.mocked(retractNotify).mock.calls).toEqual([[{ keys: ["owner-notify:ntf-1"], notes: [{ hostId: "local", notificationId: "ntf-1" }] }]]);
    // The same closed record again (a list): no second retract.
    seedOwnerNotes([rec("ntf-1", { state: "acknowledged", acknowledgedAt: "2026-10-09T10:02:00.000Z" }), rec("ntf-old", { state: "answered" })]);
    expect(retractNotify).toHaveBeenCalledTimes(1);
    // Deleted elsewhere: once.
    seedOwnerNotes([rec("ntf-2")]);
    hostEvent({ cutex: { method: OWNER_NOTIFY_DELETED, params: { notificationId: "ntf-2", agentId: "eva" } } });
    hostEvent({ cutex: { method: OWNER_NOTIFY_DELETED, params: { notificationId: "ntf-2", agentId: "eva" } } });
    expect(vi.mocked(retractNotify).mock.calls.slice(1)).toEqual([[{ keys: ["owner-notify:ntf-2"], notes: [{ hostId: "local", notificationId: "ntf-2" }] }]]);
  });
});
