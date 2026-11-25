// @vitest-environment jsdom
// 打断并发送 with several 插话 in 接下来 (cutex interrupt-send-many-v1; harness from test/noteDeliveryUi.test.tsx).
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

// 打断并发送 on a row with several unread 插话 (cutex interrupt-send-many-v1): the tip says how many go; an older runtime
// pin's refusal is said plainly. No new state, label or button.
const running = delivery("turn", 1, { runtimeGeneration: 7, turn: { turnId: "t1", kind: "owner", askId: null, startedAt: null, inputIds: [] } });
const steer = (id: string, s: number) => record(id, { kind: "owner", surface: "nextUp", state: "accepted", turnId: "t1", runtimeGeneration: 7, createdAt: iso(T0 + s * 1000), actions: ["interruptSend", "dismiss"], rev: s + 1 });

describe("打断并发送 with several 插话", () => {
  beforeEach(() => { features.add("interrupt-send-many-v1"); });
  afterEach(() => { features.delete("interrupt-send-many-v1"); });
  it("the tip says how many go; one alone (or an older host) keeps the registry tip", () => {
    const rows = [steer("a", 1), steer("b", 2), steer("c", 3)];
    seed(rows, running); show(rows[1]!);
    expect(button("interruptSend").getAttribute("data-tip")).toBe('interruptSend.manyTip{"n":3}');
    expect(button("interruptSend").textContent).toBe("Interrupt and send"); // the same button
    seed([rows[0]!], running); show(rows[0]!);
    expect(button("interruptSend").getAttribute("data-tip")).toBe("interruptSend.oneTip");
    features.delete("interrupt-send-many-v1");
    seed(rows, running); show({ ...rows[1]!, rev: 9 });
    expect(button("interruptSend").getAttribute("data-tip")).toBe("interruptSend.oneTip");
  });
  it("an older runtime pin refuses the batch: said, nothing retried one by one", async () => {
    const rows = [steer("a", 1), steer("b", 2)];
    seed(rows, running); show(rows[0]!);
    const interrupt = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'cutex:input-interrupt-send': Error: interrupt_send_many_unsupported: runtime pin lacks ownerInputBatch"));
    act(() => useApp.setState({ interruptSendInput: interrupt } as never));
    await press("interruptSend");
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(calls.notify).toHaveBeenCalledWith("interruptSend.manyUnsupported", "error", { hostId: "h", sessionId: "cutex.s1" });
  });
});

// cutex 1e92a78d (API handoff v6): unsent batch members follow their records; the buttons follow the host's actions.
describe("unsent batch members", () => {
  beforeEach(() => { features.add("interrupt-send-many-v1"); });
  afterEach(() => { features.delete("interrupt-send-many-v1"); });
  const owner = (id: string, patch: Parameters<typeof record>[1]) => record(id, { kind: "owner", surface: "nextUp", ...patch });
  const labelTip = () => el.querySelector('[data-testid="next-up-label"]')!.getAttribute("data-tip")!;
  it("blocked (definitely unsent, waiting{nativeHeld}): state 11 shows the host's Resend with its own tip and the reason", () => {
    const r = owner("b1", { state: "waiting", reason: "nativeHeld", actions: ["retry", "dismiss"], details: { nativeReason: "hook_blocked", interruptBatch: { attempt: 1, deferred: false, blocked: true, notSubmittedReason: "hook_blocked" } } });
    seed([r]); show(r);
    expect(button("retry").disabled).toBe(false);
    expect(button("retry").getAttribute("data-tip")).toBe("interruptBatch.retryTip");
    expect(labelTip()).toContain("interruptBatch.hookBlocked");
  });
  it("a state-11 owner row the host offers no Resend on shows none (no grey placeholder)", () => {
    const r = owner("b2", { state: "waiting", reason: "nativeHeld", actions: ["dismiss"], details: { nativeReason: "something" } });
    seed([r]); show(r);
    expect(el.querySelector('button[data-effect="retry"]')).toBeNull();
  });
  it("groupIncomplete and an unknown reason get their lines; busy held members say the group goes later", () => {
    const g = owner("g1", { state: "waiting", reason: "nativeHeld", actions: ["retry", "dismiss"], details: { interruptBatch: { attempt: 1, deferred: false, blocked: true, notSubmittedReason: "groupIncomplete", incompleteIds: ["x"] } } });
    seed([g]); show(g);
    expect(labelTip()).toContain("interruptBatch.groupIncomplete");
    const o = owner("o1", { state: "waiting", reason: "nativeHeld", actions: ["dismiss"], details: { interruptBatch: { attempt: 1, deferred: false, blocked: true, notSubmittedReason: "new_reason" } } });
    seed([o]); show(o);
    expect(labelTip()).toContain('interruptBatch.notSentOther{"reason":"new_reason"}');
    const h = owner("h1", { state: "held", reason: "hostBusy", actions: ["dismiss"], details: { interruptBatch: { attempt: 1, deferred: true, deferredIds: ["h1", "h2"], notSubmittedReason: "not_idle" } } });
    seed([h]); show(h);
    expect(labelTip()).toContain("interruptBatch.waitBusy");
  });
  it("an unmarked refusal (retryBlocked): unconfirmed, Resend not offered, says it may already be taken", () => {
    const r = owner("u1", { state: "uncertain", reason: "outcomeUnknown", actions: ["dismiss"], details: { interruptBatch: { attempt: 1, retryBlocked: true } } });
    seed([r]); show(r);
    expect(button("retry").disabled).toBe(true);
    expect(labelTip()).toContain("interruptBatch.retryBlocked");
  });
  it("an older attempt's audit mark says nothing: a manual retry whose outcome is unknown keeps the registry wording", () => {
    // attempt 1 was blocked by a hook; the owner resent it (attempt 2) and that outcome is unknown.
    const r = owner("s1", { state: "uncertain", reason: "outcomeUnknown", attempt: 2, actions: ["retry", "dismiss"], details: { interruptBatch: { attempt: 1, deferred: false, blocked: true, notSubmittedReason: "hook_blocked" } } });
    seed([r]); show(r);
    expect(labelTip()).not.toContain("interruptBatch");
    expect(button("retry").getAttribute("data-tip")).toBe("It may arrive twice");
  });
  it("more unread 插话 than one interrupt takes: the tip says so", () => {
    const rows = Array.from({ length: 101 }, (_, i) => steer(`m${i}`, i + 1));
    seed(rows, running); show(rows[0]!);
    expect(button("interruptSend").getAttribute("data-tip")).toBe('interruptSend.tooMany{"max":100}');
  });
  it("without the capability nothing is added", () => {
    features.delete("interrupt-send-many-v1");
    const r = owner("b3", { state: "waiting", reason: "nativeHeld", actions: ["retry", "dismiss"], details: { interruptBatch: { blocked: true, notSubmittedReason: "hook_blocked" } } });
    seed([r]); show(r);
    expect(labelTip()).not.toContain("interruptBatch");
    expect(button("retry").getAttribute("data-tip")).not.toBe("interruptBatch.retryTip");
  });
});
