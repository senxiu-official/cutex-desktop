// claude-safety-grants: safety-block notices (owner notices with `safetyBlock`) in 需要你, the timeline
// line of the declined tool row, and 批准一次 / 不批准 through the renderer store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerNotification, SafetyBlock } from "@cutex-desktop/protocol";
import { asRecord, isAlerting, isPending, mergeRecords, safetyBlockState, wantsBigAlert, wantsDesktopNotification } from "../src/shared/ownerNotify";
import { notePresentation, ownerNeedReason, safetyNoteOfItem } from "../src/renderer/src/lib/ownerNotify";
import { needsYouByAgent } from "../src/renderer/src/lib/agentAttention";
import { chipTone } from "../src/renderer/src/lib/statusChips";
import { isDeclinedTool } from "../src/renderer/src/modules/safety-grants/declined";
import { OWNER_ONLY_CAPABILITIES } from "../src/shared/users";

const handlers: Record<string, (payload: unknown) => void> = {};
const api = { safetyCheckDecide: vi.fn(), ownerNotifications: vi.fn(async () => []) };
vi.mock("../src/renderer/src/bridge", () => ({
  api,
  bridge: { on: (name: string, fn: (payload: unknown) => void) => void (handlers[name] = fn) },
}));
vi.mock("../src/renderer/src/lib/notifyEvents", () => ({ emitNotify: vi.fn(), retractNotify: vi.fn() }));

const block = (over: Partial<SafetyBlock> = {}): SafetyBlock => ({
  blockId: "sb-1",
  runtime: "claude",
  threadId: "thread-1",
  turnId: "turn-1",
  itemId: "call-1",
  toolName: "Bash",
  toolInput: { command: "rm -rf $S/$v", description: "clean" },
  command: "rm -rf $S/$v",
  reason: "Dangerous rm operation on possibly-empty variable path: $S/$v",
  state: "blocked",
  blockedAt: "2026-10-16T01:00:00.000Z",
  decidedAt: null,
  expiresAt: null,
  usedAt: null,
  grantSeconds: 1800,
  ...over,
});

const rec = (over: Partial<OwnerNotification> = {}): OwnerNotification => ({
  notificationId: "ntf-sb-1",
  agentId: "eva",
  agentName: "Eva",
  origin: "system",
  text: "Claude Code 安全检查拦下了一条命令：rm -rf $S/$v",
  level: "info",
  requestedLevel: "info",
  downgraded: null,
  muted: false,
  channels: ["desktop", "phone"],
  needsReply: false,
  delegation: null,
  job: null,
  turnId: "turn-1",
  state: "open",
  createdAt: "2026-10-16T01:00:00.000Z",
  acknowledgedAt: null,
  reply: null,
  closedAt: null,
  notificationLevel: "needsYou",
  notificationEvent: "system.safetyBlock",
  actions: ["needsYou", "mark", "desktop", "phone"],
  systemKind: "safetyBlock",
  safetyBlock: block(),
  ...over,
});

describe("safety-block notices", () => {
  it("parse from the wire; a malformed block is dropped", () => {
    expect(asRecord(rec())?.safetyBlock).toEqual(block());
    expect(asRecord({ ...rec(), safetyBlock: { ...block(), state: "weird" } })?.safetyBlock).toBeUndefined();
    expect(asRecord({ ...rec(), safetyBlock: { blockId: "x" } })?.safetyBlock).toBeUndefined();
  });

  it("count in 需要你 (as an urgent safetyBlock reason) until decided, also after the agent was read", () => {
    expect(isPending(rec())).toBe(true);
    expect(isPending(rec({ state: "acknowledged" }))).toBe(true);
    for (const state of ["granted", "used", "dismissed", "expired"] as const) expect(isPending(rec({ state: "acknowledged", safetyBlock: block({ state }) }))).toBe(false);
    // The owner's notification levels took 需要你 away.
    expect(isPending(rec({ actions: ["mark"] }))).toBe(false);
    expect(ownerNeedReason(rec())).toBe("safetyBlock");
    const needs = needsYouByAgent({ ownerNotes: [rec()] });
    expect(needs.get("eva")).toMatchObject({ count: 1, reasons: ["safetyBlock"], notificationIds: ["ntf-sb-1"] });
    expect(chipTone("needsYou", needs.get("eva"))).toBe("urgent");
    expect(needsYouByAgent({ ownerNotes: [rec({ safetyBlock: block({ state: "dismissed" }) })] }).size).toBe(0);
  });

  it("alert on the desktop while open, never as a big alert", () => {
    expect(isAlerting(rec())).toBe(true);
    expect(wantsDesktopNotification(rec())).toBe(true);
    expect(wantsBigAlert(rec())).toBe(false);
    expect(isAlerting(rec({ state: "acknowledged" }))).toBe(false);
    expect(isAlerting(rec({ safetyBlock: block({ state: "granted" }) }))).toBe(false);
  });

  it("a stale list copy cannot reopen a decided block", () => {
    const decided = rec({ state: "acknowledged", safetyBlock: block({ state: "granted" }) });
    const stale = rec({ state: "acknowledged" });
    expect(mergeRecords({ [decided.notificationId]: decided }, [stale])[decided.notificationId]!.safetyBlock!.state).toBe("granted");
    const used = rec({ state: "acknowledged", safetyBlock: block({ state: "used" }) });
    expect(mergeRecords({ [decided.notificationId]: decided }, [used])[decided.notificationId]!.safetyBlock!.state).toBe("used");
  });

  it("card while open, a quiet row once decided; granted reads expired after its window", () => {
    expect(notePresentation(rec())).toBe("card");
    expect(notePresentation(rec({ state: "acknowledged", safetyBlock: block({ state: "dismissed" }) }))).toBe("row");
    const granted = block({ state: "granted", expiresAt: "2026-10-16T01:35:00.000Z" });
    expect(safetyBlockState(granted, Date.parse("2026-10-16T01:30:00.000Z"))).toBe("granted");
    expect(safetyBlockState(granted, Date.parse("2026-10-16T01:36:00.000Z"))).toBe("expired");
  });

  it("the declined tool row finds its notice (the latest for that call)", () => {
    const older = rec({ notificationId: "ntf-old", createdAt: "2026-10-16T00:00:00.000Z", safetyBlock: block({ blockId: "sb-0", state: "dismissed" }) });
    const byId = { [older.notificationId]: older, "ntf-sb-1": rec() };
    expect(safetyNoteOfItem(byId, "eva", "call-1")?.notificationId).toBe("ntf-sb-1");
    expect(safetyNoteOfItem(byId, "mika", "call-1")).toBeNull();
    expect(safetyNoteOfItem(byId, "eva", "call-2")).toBeNull();
    expect(isDeclinedTool({ type: "commandExecution", id: "c", status: "declined" })).toBe(true);
    expect(isDeclinedTool({ type: "commandExecution", id: "c", status: "failed" })).toBe(false);
    expect(isDeclinedTool({ type: "fileChange", id: "f", status: "declined" })).toBe(true);
    expect(isDeclinedTool({ type: "dynamicToolCall", id: "d", namespace: "claude", status: "failed" })).toBe(true);
    expect(isDeclinedTool({ type: "agentMessage", id: "a" })).toBe(false);
  });

  it("the capability is the owner's only", () => {
    expect(OWNER_ONLY_CAPABILITIES).toContain("claude-safety-grants");
  });
});

describe("批准一次 / 不批准", () => {
  beforeEach(async () => {
    const { useOwnerNotify } = await import("../src/renderer/src/lib/ownerNotifyStore");
    useOwnerNotify.getState().reset();
    api.safetyCheckDecide.mockReset();
  });

  async function started() {
    const store = await import("../src/renderer/src/lib/ownerNotifyStore");
    const state = { features: new Set<string>(), selectedId: null, view: { kind: "conversation" }, sidebar: null, select: async () => {} };
    store.startOwnerNotifySync({ getState: () => state, subscribe: () => () => {} });
    return store;
  }

  it("grant goes to the agent's session and the returned notice closes the item", async () => {
    const { safetyCheckAct, seedOwnerNotes, useOwnerNotify } = await started();
    seedOwnerNotes([rec()]);
    const granted = rec({ state: "acknowledged", safetyBlock: block({ state: "granted", expiresAt: "2026-10-16T01:35:00.000Z" }) });
    api.safetyCheckDecide.mockResolvedValueOnce({ ok: true, notification: granted, submitError: null });
    const r = await safetyCheckAct(rec(), "grant");
    expect(r.ok).toBe(true);
    expect(api.safetyCheckDecide).toHaveBeenCalledWith("eva", "sb-1", "grant");
    expect(useOwnerNotify.getState().byId["ntf-sb-1"]!.safetyBlock!.state).toBe("granted");
    expect(isPending(useOwnerNotify.getState().byId["ntf-sb-1"]!)).toBe(false);
  });

  it("decided elsewhere meanwhile: the refusal's notice is applied", async () => {
    const { safetyCheckAct, seedOwnerNotes, useOwnerNotify } = await started();
    seedOwnerNotes([rec()]);
    const dismissed = rec({ state: "acknowledged", safetyBlock: block({ state: "dismissed" }) });
    api.safetyCheckDecide.mockResolvedValueOnce({ ok: false, error: { code: "safety_block_closed", message: "already dismissed" }, notification: dismissed });
    const r = await safetyCheckAct(rec(), "grant");
    expect(r.ok).toBe(false);
    expect(useOwnerNotify.getState().byId["ntf-sb-1"]!.safetyBlock!.state).toBe("dismissed");
  });

  it("an offline agent leaves the item open", async () => {
    const { safetyCheckAct, seedOwnerNotes, useOwnerNotify } = await started();
    seedOwnerNotes([rec()]);
    api.safetyCheckDecide.mockResolvedValueOnce({ ok: false, error: { code: "session_offline", message: "start it" } });
    await safetyCheckAct(rec(), "grant");
    expect(isPending(useOwnerNotify.getState().byId["ntf-sb-1"]!)).toBe(true);
  });
});
