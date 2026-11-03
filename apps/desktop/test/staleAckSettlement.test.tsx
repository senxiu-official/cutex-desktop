// @vitest-environment jsdom
import { act, createElement as h, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { latestReceiptState } from "./receiptVisibilityStorage";
import type { AdmissionNextStep, MessageSettlement } from "@cutex-desktop/protocol";

const env = vi.hoisted(() => ({ features: new Set<string>(), api: vi.fn(), list: vi.fn(), evidence: vi.fn(), boot: vi.fn(), close: vi.fn(), refresh: vi.fn(), active: "host" }));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: env.api, bridge: {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { active: env.active }, refreshAdmission: env.refresh }) }),
  featuresOf: () => env.features,
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: { n: number }) => key + (vars ? ` ${vars.n}` : "") }) }));

import { HiddenReceiptsTable } from "../src/renderer/src/modules/agent-bus/HiddenReceiptsTable";
import { MessageSettlementControl } from "../src/renderer/src/components/MessageSettlementControl";
import { dismissReceipt, restoreReceipt, useHiddenReceiptIds, useHiddenReceiptsOf } from "../src/renderer/src/lib/legacyDelivery/busReceiptVisibility";
import { closeHiddenMessageFollowUp, discoverMessageSettlement, settlementWriteKey, useSettlementWrites } from "../src/renderer/src/lib/messageSettlementWrites";
import { useAgentMessages } from "../src/renderer/src/lib/agentMessageStore";
import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { settlementFixture } from "../src/renderer/src/modules/agent-bus/settlementFixture";
import { MESSAGE_SETTLEMENT_FEATURE, STALE_ACK_SETTLEMENT_FEATURE, readMessageSettlement } from "../src/shared/messageSettlement";

let root: ReturnType<typeof createRoot>, node: HTMLDivElement, session: string;
let serial = 0;
let rows: { messageId: string; body: string; settlement?: MessageSettlement }[];
const receipt = (id: string): AdmissionNextStep => ({ id, deliveryKind: "tell", waitReason: "nativeReceipt", preview: "ordinary note", enqueuedAt: "2026-10-20T00:00:00Z" });
const storageKey = () => "cutex-desktop.hiddenBusReceipts.v1:" + JSON.stringify(["host", session]);
const entry = (id: string, host = "host") => useSettlementWrites.getState().entries[settlementWriteKey(host, id)];
const hiddenRows = () => [...node.querySelectorAll<HTMLElement>('[data-testid="hidden-receipt-row"]')];
const rowId = (row: HTMLElement) => (JSON.parse(row.dataset.rowId!) as [string, string])[1];
const closed = (id: string): MessageSettlement => ({ ...settlementFixture(), state: "closed", canClose: false, closure: { actor: "owner", reason: "reviewed", requestId: id, closedAt: "2026-10-30T00:00:00Z" } });

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear();
  session = `stale-ack-${++serial}`; env.active = "host";
  env.features = new Set([MESSAGE_SETTLEMENT_FEATURE, STALE_ACK_SETTLEMENT_FEATURE]);
  noteHostAccess("host", { user: { id: "owner", isOwner: true, token: null } });
  rows = [];
  env.list.mockImplementation(async () => ({ messages: rows.map(row => ({ ...row, contentPreview: row.body, to: { id: session } })) }));
  env.boot.mockImplementation(async () => ({ cutexState: { agentBusMessages: rows } }));
  env.evidence.mockImplementation(async ({messageId}) => { const row=rows.find(row=>row.messageId===messageId); return row ? {ok:true,result:{messageId,settlement:row.settlement??null}} : {ok:false,error:{status:404,code:"message_not_found"}}; });
  env.api.mockImplementation(() => ({ busMessageEvidence: env.evidence, stuckBusMessages: env.list, bootstrap: env.boot, closeBusMessage: env.close }));
  env.refresh.mockResolvedValue(undefined);
  env.close.mockImplementation(async request => ({ ok: true, result: { messageId: request.messageId, changed: true, settlement: closed(request.requestId) } }));
  useSettlementWrites.setState({ entries: {} }); useAgentMessages.getState().reset();
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
// 待清理 → 已隐藏的回执 (Settings): the host-wide list, rows shown directly (the category header is the section's).
// Each test has its own session; earlier tests' sessions stay in the store's memory, so the harness keeps to this one.
function Hidden() {
  const all = useHiddenReceiptsOf("host");
  const rows = useMemo(() => all.filter(r => r.session === session), [all]);
  return h(HiddenReceiptsTable, { hostId: "host", rows });
}
async function render(ids: string[]) {
  for (const id of ids) dismissReceipt("host", session, receipt(id));
  await act(async () => root.render(h(Hidden)));
}
function button(label: string) {
  const found = [...node.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label);
  if (!found) throw new Error(`missing ${label}: ${node.textContent}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function setReason() {
  await act(async () => {
    const input = node.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "reviewed by owner");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function batch() { await click("queue.receipt.closeAll"); await setReason(); await click("agent-bus.settlement.confirm"); }

it("retains legacy ID-only rows on old hosts, shows current body when available and restores a single row without RPC", async () => {
  env.features.delete(STALE_ACK_SETTLEMENT_FEATURE);
  localStorage.setItem(storageKey(), '["legacy","unknown"]');
  // The text comes from the message this window holds (the strip's 接下来 rows are not at hand in Settings).
  useAgentMessages.getState().seed(session, [{ messageId: "legacy", body: "ordinary note" }], []);
  await act(async () => root.render(h(Hidden)));
  expect(hiddenRows()).toHaveLength(2); expect(node.textContent).toContain("ordinary note"); expect(node.textContent).toContain("unknown");
  expect(node.textContent).not.toContain("queue.receipt.closeAll");
  await click("queue.receipt.restore");
  expect(hiddenRows()).toHaveLength(1); expect(latestReceiptState("host", session, "legacy")).toBe("restored"); expect(latestReceiptState("host", session, "unknown")).toBe("hidden");
  expect(env.api).not.toHaveBeenCalled();
});

it("ordinary no-settlement notes discover server eligibility only on intent and fetch fresh evidence before close", async () => {
  await act(async () => root.render(h(MessageSettlementControl, { hostId: "host", sessionId: session, messageId: "ordinary", discover: true })));
  expect(env.api).not.toHaveBeenCalled();
  rows = [{ messageId: "ordinary", body: "Alice to Osprey", settlement: settlementFixture() }];
  await click("agent-bus.settlement.recheck"); expect(env.close).not.toHaveBeenCalled();
  expect(button("agent-bus.settlement.close")).toBeDefined();
  rows[0]!.settlement = { ...settlementFixture(), evidenceToken: "fresh-proof" };
  await click("agent-bus.settlement.close"); await setReason(); await click("agent-bus.settlement.confirm");
  expect(env.close).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageId: "ordinary", expectedEvidenceToken: "fresh-proof" }));
  expect(env.api.mock.calls.every(([host]) => host === "host")).toBe(true);
  expect(env.boot.mock.calls.every(([sid]) => sid === session)).toBe(true);
  expect(node.textContent).toContain("agent-bus.settlement.closed");
});

it.each([{features: []}, {features: [MESSAGE_SETTLEMENT_FEATURE]}, {features: [STALE_ACK_SETTLEMENT_FEATURE]}])("does not discover or batch-close when either required capability is absent: %j", async ({features}) => {
  env.features = new Set(features);
  await act(async () => root.render(h(MessageSettlementControl, { hostId: "host", sessionId: session, messageId: "ordinary", discover: true })));
  expect(node.textContent).toBe("");
  await closeHiddenMessageFollowUp("host", "ordinary", session, "reviewed");
  expect(env.api).not.toHaveBeenCalled();
});

it("removes an inherited hidden row on a live server closure even before discovery", async () => {
  await render(["already-hidden"]);
  await act(async () => useAgentMessages.getState().applySettlement("already-hidden", closed("other-client")));
  expect(hiddenRows()).toHaveLength(0);
  expect(latestReceiptState("host", session, "already-hidden")).toBe("restored");
  expect(env.api).not.toHaveBeenCalled();
});

it("double confirmation while the first read is pending starts only one batch", async () => {
  await render(["double"]); await click("queue.receipt.closeAll"); await setReason();
  let finish!: (value: unknown) => void;
  env.evidence.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { const confirm = button("agent-bus.settlement.confirm"); confirm.click(); confirm.click(); });
  expect(env.boot).toHaveBeenCalledTimes(1); expect(env.close).not.toHaveBeenCalled();
  await act(async () => finish({ ok: true, result: { messageId: "double", settlement: settlementFixture() } }));
  expect(env.close).toHaveBeenCalledTimes(1); expect(hiddenRows()).toHaveLength(0);
});

it.each(["unavailable", "ineligible", "missing"])("preserves every hidden ID after %s discovery without close or resend", async kind => {
  await render(["kept"]);
  if (kind === "unavailable") { env.evidence.mockRejectedValue(new Error("offline")); env.boot.mockRejectedValue(new Error("offline")); }
  if (kind === "ineligible") rows = [{ messageId: "kept", body: "ordinary note" }];
  await batch();
  expect(hiddenRows()).toHaveLength(1); expect(node.textContent).toContain(`agent-bus.settlement.${kind}`);
  expect(env.close).not.toHaveBeenCalled(); expect(latestReceiptState("host", session, "kept")).toBe("hidden");
});

it.each([null, { ok: true, result: { messageId: "another", settlement: settlementFixture() } }, { ok: true, result: { messageId: "invalid", settlement: { state: "outcome_unknown", canClose: true } } }])("rejects malformed or wrong-ID collector evidence without using a cached sidecar: %j", async response => {
  rows = [{ messageId: "invalid", body: "cached", settlement: settlementFixture() }];
  env.evidence.mockResolvedValue(response);
  await closeHiddenMessageFollowUp("host", "invalid", session, "reviewed");
  expect(env.close).not.toHaveBeenCalled(); expect(entry("invalid")?.error).toBe("unavailable");
});

it("old passive notes with no entry turn display unassigned and unknown, preserving only server qualification", async () => {
  const base = settlementFixture();
  const evidence = { ...base.evidence, actualTurnId: "unassigned", terminalStatus: "unknown", staleAck: { queuedAt: "2026-10-20T00:00:00Z", acceptedAt: "2026-10-29T00:00:00Z", minWaitSecs: 300, laterCompletedTurnId: "actual-later-witness" } };
  rows = [{ messageId: "passive", body: "ordinary passive note", settlement: { ...base, evidence } }];
  await act(async () => root.render(h(MessageSettlementControl, { hostId: "host", sessionId: session, messageId: "passive", discover: true })));
  await click("agent-bus.settlement.recheck"); await click("agent-bus.settlement.close");
  expect(node.textContent).toContain("agent-bus.settlement.unassignedTurn");
  expect(node.textContent).toContain("unknown"); expect(node.textContent).toContain("actual-later-witness");
  expect(node.textContent).not.toContain("· unassigned"); expect(env.close).not.toHaveBeenCalled();
  expect(readMessageSettlement(entry("passive")?.settlement)?.evidence.staleAck).toEqual(evidence.staleAck);
});

it("surfaces partial refusal per row, retains it, and only retries remaining rows after a new evidence read", async () => {
  rows = ["good", "refused"].map(messageId => ({ messageId, body: messageId, settlement: settlementFixture() }));
  env.close.mockImplementationOnce(async request => ({ ok: true, result: { messageId: request.messageId, changed: true, settlement: closed(request.requestId) } }))
    .mockResolvedValueOnce({ ok: false, error: { status: 409, code: "settlement_evidence_changed" } });
  await render(["good", "refused"]); await batch();
  expect(hiddenRows().map(rowId)).toEqual(["refused"]);
  expect(node.textContent).toContain("agent-bus.settlement.conflict"); expect(env.close).toHaveBeenCalledTimes(2);
  const previous = env.close.mock.calls[1]![0];
  rows[1]!.settlement = { ...settlementFixture(), evidenceToken: "fresh-after-refusal" };
  await click("agent-bus.settlement.confirm");
  expect(env.close).toHaveBeenCalledTimes(3);
  expect(env.close.mock.calls[2]![0]).toMatchObject({ messageId: "refused", expectedEvidenceToken: "fresh-after-refusal" });
  expect(env.close.mock.calls[2]![0].requestId).not.toBe(previous.requestId);
  expect(hiddenRows()).toHaveLength(0); for (const id of ["good", "refused"]) expect(latestReceiptState("host", session, id)).toBe("restored");
});

it("keeps lost writes hidden and retries the original immutable request only after explicit batch intent", async () => {
  rows = [{ messageId: "lost", body: "note", settlement: settlementFixture() }];
  env.close.mockRejectedValueOnce(new Error("lost result"));
  await render(["lost"]); await batch();
  expect(hiddenRows()).toHaveLength(1); expect(entry("lost")?.phase).toBe("uncertain");
  expect(env.close).toHaveBeenCalledTimes(1); const original = env.close.mock.calls[0]![0];
  rows[0]!.settlement = { ...settlementFixture(), evidenceToken: "later-proof" };
  await click("agent-bus.settlement.confirm");
  expect(env.close.mock.calls[1]![0]).toEqual(original); expect(hiddenRows()).toHaveLength(0);
});

it("deduplicates repeated clicks and overlapping per-row/batch operations during discovery", async () => {
  let finish!: (value: unknown) => void;
  env.evidence.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  env.list.mockResolvedValue({ messages: [] });
  let first!: Promise<void>;
  await act(async () => {
    first = closeHiddenMessageFollowUp("host", "once", session, "owner reason");
    await closeHiddenMessageFollowUp("host", "once", session, "other reason");
  });
  expect(env.boot).toHaveBeenCalledTimes(1); expect(env.close).not.toHaveBeenCalled();
  await act(async () => { finish({ ok: true, result: { messageId: "once", settlement: settlementFixture() } }); await first; });
  expect(env.close).toHaveBeenCalledTimes(1);
});

it("a live revocation racing discovery cannot authorize a close from the older read", async () => {
  let finish!: (value: unknown) => void;
  env.list.mockResolvedValue({ messages: [] }); env.evidence.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const run = closeHiddenMessageFollowUp("host", "race", session, "reviewed");
  useAgentMessages.getState().seed(session, [{ messageId: "race", settlement: { ...settlementFixture(), canClose: false } }], []);
  finish({ ok: true, result: { messageId: "race", settlement: settlementFixture() } }); await run;
  expect(env.close).not.toHaveBeenCalled(); expect(entry("race")?.settlement?.canClose).toBe(false);
});

it("preserves a closure arriving during a read and removes a hidden ID only after that proof", async () => {
  dismissReceipt("host", session, receipt("race-closed"));
  let finish!: (value: unknown) => void;
  env.evidence.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const run = discoverMessageSettlement("host", "race-closed", session);
  expect(latestReceiptState("host", session, "race-closed")).toBe("hidden");
  useAgentMessages.getState().applySettlement("race-closed", closed("external-close"));
  finish({ ok: true, result: { messageId: "race-closed", settlement: null } }); await run;
  expect(entry("race-closed")?.settlement?.state).toBe("closed");
  expect(latestReceiptState("host", session, "race-closed")).toBe("restored"); expect(env.close).not.toHaveBeenCalled();
});

it("does not publish evidence into another host's global cache and uses the exact bound ID/session", async () => {
  env.active = "another-host";
  env.list.mockResolvedValue({ messages: [{ messageId: "same", to: { id: "wrong-session" }, settlement: settlementFixture() }] });
  await closeHiddenMessageFollowUp("host", "same", session, "reviewed");
  expect(env.close).not.toHaveBeenCalled(); expect(entry("same")?.error).toBe("missing");
  rows = [{ messageId: "same", body: "right session", settlement: settlementFixture() }];
  await closeHiddenMessageFollowUp("host", "same", session, "reviewed");
  expect(env.close).toHaveBeenCalledTimes(1); expect(useAgentMessages.getState().byId.same).toBeUndefined();
});

it("explicit unhide stays observable across a stale other-window hide snapshot", async () => {
  function Probe() { return h("span", null, [...useHiddenReceiptIds("host", session)].join(",")); }
  dismissReceipt("host", session, receipt("restored"));
  await act(async () => root.render(h(Probe)));
  await act(async () => restoreReceipt("host", session, "restored"));
  await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: storageKey(), newValue: '["restored"]', storageArea: localStorage })));
  expect(node.textContent).toBe("");
  await act(async () => dismissReceipt("host", session, receipt("restored")));
  expect(node.textContent).toBe("restored");
});

it.each(["inProgress", "unknown"])("preserves honest %s stale-ACK evidence and its optional identity fields", terminalStatus => {
  const base = settlementFixture();
  const staleAck = { queuedAt: "2026-10-20T00:00:00Z", acceptedAt: "2026-10-29T00:00:00Z", minWaitSecs: 300, nativeAttemptId: null, laterCompletedTurnId: "later-turn" };
  const value = { ...base, evidence: { ...base.evidence, terminalStatus, staleAck } };
  expect(readMessageSettlement(value)?.evidence).toMatchObject({ terminalStatus, staleAck });
  expect(readMessageSettlement({ ...value, evidence: { ...value.evidence, staleAck: { ...staleAck, laterCompletedTurnId: null } } })).toBeUndefined();
});

it.each([undefined, "", "not-an-ISO-date"])("rejects stale-ACK qualification without valid durable acceptedAt: %j", acceptedAt => {
  const base = settlementFixture();
  const staleAck = { queuedAt: "2000-01-01T00:00:00Z", acceptedAt, minWaitSecs: 300, laterCompletedTurnId: "later" };
  expect(readMessageSettlement({ ...base, evidence: { ...base.evidence, staleAck } })).toBeUndefined();
  // Existing ordinary settlement evidence remains valid without any stale-ACK qualification.
  expect(readMessageSettlement(base)).toEqual(base);
});
