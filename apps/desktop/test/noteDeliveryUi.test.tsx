// @vitest-environment jsdom
// Agent-note delivery in 接下来 (owner decision 2026-11-19; cutex fix/nextup-delivery 790bce4a, UI handoff): 现在读取 sends
// the clicked note as a fixed set, refusals are said truthfully, the row's hover / details say where a note is and what it
// waits for, 允许发送 says when it only lifts the owner's pause, and a turn a note started reads 「工作中」.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InputRecord } from "@cutex-desktop/protocol";
import { record, delivery, T0, iso } from "../src/renderer/src/lib/inputLedger/testkit";
import { emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";

const calls = vi.hoisted(() => ({ wake: vi.fn(), hold: vi.fn(), refresh: vi.fn(), notify: vi.fn(), log: vi.fn(), dismiss: vi.fn() }));
const features = vi.hoisted(() => new Set<string>(["input-ledger-v1", "owner-carries-v1"]));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { shell: { logError: calls.log } }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/lib/delegationOpen", () => ({ openDelegationDetail: vi.fn() }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn(), openMenuAt: vi.fn() }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ inputs: {}, ledgerOutbox: {}, sessions: {}, byHost: {}, selectedId: null, hosts: { active: "h" },
    sessionAction: calls.wake, holdInput: calls.hold, refreshInputs: calls.refresh, notify: calls.notify, dismissInput: calls.dismiss }));
  return { useApp, agentState: (map: Record<string, unknown>, host: string, session: string) => map?.[host + "\n" + session],
    featuresOf: () => features, selectedFeatures: () => features, agentHost: () => "h", sidebarOf: () => null, viewOf: () => null };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { InputStatus } = await import("../src/renderer/src/components/InputStatus");
const { DeliveryStatus } = await import("../src/renderer/src/components/DeliveryStatus");
const { useApp } = await import("../src/renderer/src/store");
const { seedMessages } = await import("../src/renderer/src/lib/legacyDelivery/agentMessages");

let root: ReturnType<typeof createRoot>;
let el: HTMLDivElement;
const NOTE_FEATURES = ["agent-bus-read-notes-v1", "pre-turn-passive-notes-v1", "passive-note-diagnostics-v1"];
const seed = (records: InputRecord[], state = delivery("idle", 1)) =>
  act(() => useApp.setState({ inputs: { "h\ncutex.s1": { ...emptyInputLedgerSession(), delivery: state, records: new Map(records.map((r) => [r.inputId, r])) } } } as never));
const note = (id: string, patch: Partial<InputRecord> = {}) => record(id, { kind: "agentMessage", surface: "pendingNotes", state: "waiting", reason: "passive", actions: ["dismiss"],
  sender: { kind: "agent", id: "alice", name: "Alice", host: null, cutexSessionId: null }, ...patch });
const show = (r: InputRecord) => act(() => root.render(h(InputStatus, { record: r, sessionId: "cutex.s1", hostId: "h" })));
const button = (effect: string) => el.querySelector<HTMLButtonElement>(`button[data-effect="${effect}"]`)!;
const press = (effect: string) => act(async () => button(effect).click());

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  for (const f of NOTE_FEATURES) features.add(f);
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe("现在读取", () => {
  it("sends the clicked note as a fixed inputIds set; an older host keeps the old call", async () => {
    const r = note("n1"); seed([r, note("n2")]); show(r);
    calls.wake.mockResolvedValue({ pendingNotes: 1, started: true, submit: { passiveNotes: { admitted: ["n1"], skipped: [], errors: [] } } });
    await press("readNow");
    expect(calls.wake).toHaveBeenCalledWith("cutex.s1", "cutex/agentBus/wake", { inputIds: ["n1"] }, "h");
    expect(calls.notify).not.toHaveBeenCalled(); // started / admitted is no read receipt: nothing claims it was read
    features.delete("agent-bus-read-notes-v1");
    show({ ...r, rev: 2 });
    await press("readNow");
    expect(calls.wake).toHaveBeenLastCalledWith("cutex.s1", "cutex/agentBus/wake", {}, "h");
  });
  it("notes the turn did not carry are said, not resent", async () => {
    const r = note("n1"); seed([r]); show(r);
    calls.wake.mockResolvedValue({ pendingNotes: 2, started: true, submit: { passiveNotes: { admitted: ["n1"], skipped: [{ inputId: "n2", waitingFor: "nativeReconciliation", error: null }], errors: [] } } });
    await press("readNow");
    expect(calls.wake).toHaveBeenCalledTimes(1);
    expect(calls.notify).toHaveBeenCalledWith('noteDelivery.skipped{"n":1}', "info", { hostId: "h", sessionId: "cutex.s1" });
  });
  it("a report with only errors is said (as an error), never dropped; skipped + errors in one notice", async () => {
    const r = note("n1"); seed([r]); show(r);
    calls.wake.mockResolvedValue({ pendingNotes: 1, started: true, submit: { passiveNotes: { admitted: [], skipped: [], errors: ["enumeration failed"] } } });
    await press("readNow");
    expect(calls.notify).toHaveBeenCalledWith('noteDelivery.reportErrors{"errors":"enumeration failed"}', "error", { hostId: "h", sessionId: "cutex.s1" });
    calls.notify.mockReset();
    calls.wake.mockResolvedValue({ pendingNotes: 2, started: true, submit: { passiveNotes: { admitted: [], skipped: [{ inputId: "n2", waitingFor: "nativeReconciliation", error: null }], errors: ["a", "b", "c", "d"] } } });
    show({ ...r, rev: 2 });
    await press("readNow");
    expect(calls.notify).toHaveBeenCalledWith('noteDelivery.skipped{"n":1} · noteDelivery.reportErrors{"errors":"a; b; c (+1)"}', "error", { hostId: "h", sessionId: "cutex.s1" });
  });
  it("without pre-turn-passive-notes-v1 the answer's report is not read (older host: no notice)", async () => {
    features.delete("pre-turn-passive-notes-v1");
    const r = note("n1"); seed([r]); show(r);
    calls.wake.mockResolvedValue({ pendingNotes: 1, started: true, submit: { passiveNotes: { admitted: [], skipped: [{ inputId: "n2", waitingFor: null, error: null }], errors: ["x"] } } });
    await press("readNow");
    expect(calls.notify).not.toHaveBeenCalled();
  });
  it.each([
    ["read_notes_unsupported", "noteDelivery.readNow.unsupported", "error", false],
    ["read_notes_unavailable", "noteDelivery.readNow.unavailable", "info", true],
    ["request_outcome_unknown", "noteDelivery.readNow.outcomeUnknown", "error", true],
  ] as const)("%s: its own words, no blind resend", async (code, key, tone, refresh) => {
    const r = note("n1"); seed([r]); show(r);
    calls.wake.mockRejectedValue(new Error(`Error invoking remote method 'cutex:session-action': Error: ${code}: refused`));
    await press("readNow");
    expect(calls.wake).toHaveBeenCalledTimes(1);
    expect(calls.notify).toHaveBeenCalledWith(key, tone, { hostId: "h", sessionId: "cutex.s1" });
    expect(calls.refresh).toHaveBeenCalledTimes(refresh ? 1 : 0);
  });
  it.each(["read_notes_unsupported", "read_notes_unavailable", "request_outcome_unknown"])("%s on a host without agent-bus-read-notes-v1: the old plain failure, no refresh", async (code) => {
    features.delete("agent-bus-read-notes-v1");
    const r = note("n1"); seed([r]); show(r);
    calls.wake.mockRejectedValue(new Error(`${code}: refused`));
    await press("readNow");
    expect(calls.notify).not.toHaveBeenCalledWith(expect.stringContaining("noteDelivery"), expect.anything(), expect.anything());
    expect(calls.notify).toHaveBeenCalledTimes(1);
    expect(calls.refresh).not.toHaveBeenCalled();
  });
});

describe("where a note is (hover and details)", () => {
  const diag = (extra: Record<string, unknown>) => ({ deliveryDiagnostics: { stage: "inbox", since: iso(T0), sinceEvidence: "firstRecordedNativeEvidence", lastAttemptAt: null, lastAttemptKind: null, lastError: null, waitingFor: "nextTurn", blockedByInputId: null, ...extra } });
  it("an idle agent's next-turn wait reads calmly in the label tip, with the stage; no stall line", () => {
    const r = note("n1", { details: diag({}) }); seed([r]); show(r);
    const tip = el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
    expect(tip).toContain("noteDelivery.wait.nextTurn");
    expect(tip).toContain('noteDelivery.whereSince{"stage":"noteDelivery.stage.inbox"');
    expect(el.querySelector('[data-testid="next-up-stalled"]')).toBeNull();
    expect(el.querySelector('[data-testid="next-up-info"]')!.getAttribute("data-tip")).toContain("noteDelivery.wait.nextTurn");
  });
  it("names the exact blocking row (sender and words), the projection failures and the last error", () => {
    const blocker = note("b1", { preview: "the earlier note" });
    const r = note("n2", { surface: "nextUp", details: { blockedByInputId: "b1", projectionFailure: { code: "external_projection_failed", message: "bad attachment", attempts: 2, lastAttemptAt: iso(T0) }, ...diag({ waitingFor: "earlierInput", lastError: "bad attachment", lastAttemptAt: iso(T0), lastAttemptKind: "preTurnAdmission" }) } });
    seed([blocker, r]); show(r);
    const tip = el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
    expect(tip).toContain("noteDelivery.wait.earlierInput");
    expect(tip).toContain('noteDelivery.blockedBy{"who":"Alice · the earlier note"}');
    expect(tip).toContain('noteDelivery.projectionFailed{"n":2,"message":"bad attachment"}');
    expect(tip).toContain('noteDelivery.lastAttemptKind{"kind":"noteDelivery.attempt.preTurnAdmission"');
    expect(tip).toContain('noteDelivery.lastError{"error":"bad attachment"}');
  });
  it("retryBlocked: one explanation line; no new state or button, and never inferred from a missing Retry", () => {
    const r = note("n9", { state: "uncertain", reason: "outcomeUnknown", actions: ["dismiss"], details: diag({ stage: "context", waitingFor: "contextReceipt", retryBlocked: true }) });
    seed([r]); show(r);
    const tip = el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
    expect(tip).toContain("noteDelivery.retryBlocked.timeline");
    const effects = () => [...el.querySelectorAll("button[data-effect]")].map((b) => b.getAttribute("data-effect"));
    const withMarker = effects();
    expect(button("retry").disabled).toBe(true); // the host offers no Retry; the line says why
    const plain = note("n10", { state: "uncertain", reason: "outcomeUnknown", actions: ["dismiss"], details: diag({ stage: "context", waitingFor: "contextReceipt" }) });
    seed([plain]); show(plain);
    expect(effects()).toEqual(withMarker); // no new button
    expect(el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip") ?? "").not.toContain("noteDelivery.retryBlocked.timeline");
  });
  it("the last try shows without an error too; an unknown kind keeps only the time", () => {
    const r = note("n3", { details: diag({ waitingFor: "nativeAcceptance", lastAttemptAt: iso(T0), lastAttemptKind: "nativeStatus" }) }); seed([r]); show(r);
    let tip = el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
    expect(tip).toContain('noteDelivery.lastAttemptKind{"kind":"noteDelivery.attempt.nativeStatus"');
    expect(tip).not.toContain("noteDelivery.lastError");
    show({ ...r, rev: 2, details: diag({ waitingFor: "nativeAcceptance", lastAttemptAt: iso(T0), lastAttemptKind: "warpDrive" }) });
    tip = el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
    expect(tip).toContain('noteDelivery.lastAttempt{"time"');
    expect(tip).not.toContain("warpDrive");
  });
  it("an unknown future waitingFor gets the generic line; without the capability nothing is added", () => {
    const r = note("n1", { details: diag({ waitingFor: "somethingNew" }) }); seed([r]); show(r);
    expect(el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")).toContain('noteDelivery.wait.other{"code":"somethingNew"}');
    features.delete("passive-note-diagnostics-v1");
    show({ ...r, rev: 2 });
    expect(el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")).not.toContain("noteDelivery");
  });
  it("the details panel lists the lines under the state's meaning", async () => {
    const r = note("u1", { surface: "nextUp", state: "uncertain", reason: "receiptTimeout", actions: ["retry", "dismiss"], details: diag({ stage: "context", waitingFor: "contextReceipt" }) });
    seed([r]); show(r);
    await press("viewReason");
    expect(document.querySelector('[data-testid="next-up-delivery-lines"]')?.textContent).toContain("noteDelivery.wait.contextReceipt");
  });
  it("the input that started a turn says how many notes it carried and how many it left", () => {
    const r = record("o1", { kind: "owner", surface: "nextUp", state: "accepted", details: { passiveNotes: { admitted: ["a", "b"], skipped: [{ inputId: "c", waitingFor: "nextBoundaryBudget", error: null }], errors: [] } } });
    seed([r]); show(r);
    const tip = el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
    expect(tip).toContain('noteDelivery.carried{"n":2}');
    expect(tip).toContain('noteDelivery.skipped{"n":1}');
  });
  it("a report holding only errors still shows them in the tip", () => {
    const r = record("o2", { kind: "owner", surface: "nextUp", state: "accepted", details: { passiveNotes: { admitted: [], skipped: [], errors: ["could not record"] } } });
    seed([r]); show(r);
    expect(el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")).toContain('noteDelivery.reportErrors{"errors":"could not record"}');
  });
});

describe("允许发送", () => {
  const paused = () => note("p1", { surface: "nextUp", reason: "staleHeld", actions: ["releaseHold", "dismiss"], details: { staleReleaseAllowed: true, ownerHold: true, releaseEffect: "removeOwnerPauseOnly" } });
  it("follows the host's actions and says when this click only lifts the owner's pause", () => {
    seed([paused()]); show(paused());
    expect(button("releaseHold").disabled).toBe(false);
    expect(button("releaseHold").getAttribute("data-tip")).toContain("noteDelivery.release.pauseOnly");
    const plain = note("p2", { surface: "nextUp", reason: "staleHeld", actions: ["dismiss"], details: { staleReleaseAllowed: false } });
    seed([plain]); show(plain);
    expect(button("releaseHold").disabled).toBe(true); // not offered by the host: never enabled from staleHeld alone
  });
  it("a recorded release whose redrive failed is said as recorded, re-read, not released again", async () => {
    seed([paused()]); show(paused());
    calls.hold.mockRejectedValue(new Error("Error: bus_redrive_failed: release recorded; automatic redrive / Bus recovery will restore delivery"));
    await press("releaseHold");
    expect(calls.hold).toHaveBeenCalledTimes(1);
    expect(calls.notify).toHaveBeenCalledWith("noteDelivery.release.recorded", "info", { hostId: "h", sessionId: "cutex.s1" });
    expect(calls.refresh).toHaveBeenCalledTimes(1);
  });
  it("a revision conflict re-reads the row and never retries with the old rev", async () => {
    seed([paused()]); show(paused());
    calls.hold.mockRejectedValue(new Error("revision_conflict: stale"));
    await press("releaseHold");
    expect(calls.hold).toHaveBeenCalledTimes(1);
    expect(calls.refresh).toHaveBeenCalledTimes(1);
  });
  it.each(["bus_redrive_failed", "revision_conflict", "input_not_holdable", "input_not_found"])("%s on a host without passive-note-diagnostics-v1: the old plain failure, no refresh", async (code) => {
    features.delete("passive-note-diagnostics-v1");
    seed([paused()]); show(paused());
    calls.hold.mockRejectedValue(new Error(`${code}: x`));
    await press("releaseHold");
    expect(calls.notify).toHaveBeenCalledTimes(1);
    expect(calls.notify).not.toHaveBeenCalledWith("noteDelivery.release.recorded", expect.anything(), expect.anything());
    expect(calls.refresh).not.toHaveBeenCalled();
  });
});

describe("the session line", () => {
  it("a turn a result or note started reads 「工作中」; where it came from and its minutes are the hover", () => {
    vi.useFakeTimers(); vi.setSystemTime(T0 + 10 * 60_000);
    try {
      act(() => root.render(h(DeliveryStatus, { delivery: delivery("turn", 1, { turn: { kind: "delivery", askId: null, turnId: "t", inputIds: [], startedAt: iso(T0) }, lease: { holder: "event", turnId: "t", since: iso(T0 + 3 * 60_000), runtimeGeneration: 1, inputIds: [], reconcile: { state: "checking" } } as never }), sessionId: "cutex.s1", hostId: "h" })));
      const line = el.querySelector('[data-testid="delivery-status"]')!;
      expect(line.textContent).toBe("inputLedger.delivery.turn.owner");
      expect(line.getAttribute("data-tip")).toBe('noteDelivery.turnFrom.delivery · noteDelivery.turnFor{"n":7}');
      expect(el.querySelector('[data-testid="delivery-lease-elapsed"]')).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe("older hosts' note rows (no ledger)", () => {
  it("keep the source's delivery diagnostics", () => {
    const map = seedMessages({}, "cutex.s1", [{ messageId: "m1", body: "hi", state: "pending", deliveryDiagnostics: { stage: "bus", waitingFor: "runtimeConnection", since: null } }, { messageId: "m2", body: "old", state: "pending" }], []);
    expect(map.m1!.delivery).toMatchObject({ stage: "bus", waitingFor: "runtimeConnection", since: null });
    expect(map.m2!.delivery).toBeUndefined();
  });
});
