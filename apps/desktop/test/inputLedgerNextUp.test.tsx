// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";
import type { InputRecord, QueueItem } from "@cutex-desktop/protocol";
import { record, delivery, T0, iso } from "../src/renderer/src/lib/inputLedger/testkit";
import { emptyInputLedgerSession } from "../src/renderer/src/lib/inputLedger/alignment";
const calls = vi.hoisted(() => ({ retry: vi.fn(), dismiss: vi.fn(), release: vi.fn(), resume: vi.fn(), notify: vi.fn(), log: vi.fn(), open: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { shell: { logError: calls.log } }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => vars?.n === undefined ? key : key + "(" + vars.n + ")" }) }));
vi.mock("../src/renderer/src/lib/delegationOpen", () => ({ openDelegationDetail: calls.open }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn(), openMenuAt: vi.fn() }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const useApp = create(() => ({ inputs: {}, ledgerOutbox: {}, sessions: {}, byHost: {}, selectedId: null, hosts: { active: "old-focus" },
    retryInput: calls.retry, dismissInput: calls.dismiss, releaseInputLease: calls.release, resumePaused: calls.resume, notify: calls.notify }));
  return { useApp, agentState: (map: Record<string, unknown>, host: string, session: string) => map?.[host+"\n"+session],
    featuresOf: (_s: unknown, host: string) => new Set(host === "new-host" ? ["input-ledger-v1"] : []),
    selectedFeatures: () => new Set(), agentHost: () => "old-focus", sidebarOf: () => null, viewOf: () => null,
    queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map(p => p.text ?? "").join("") };
});
vi.mock("../src/renderer/src/lib/legacyDelivery/consumedBusReceipts", () => ({ useUnsettledBusReceipts: () => { throw Error("legacy receipt inference"); } }));
import { QueuePanel } from "../src/renderer/src/components/QueuePanel";
import { InputStatus } from "../src/renderer/src/components/InputStatus";
import { DeliveryStatus } from "../src/renderer/src/components/DeliveryStatus";
import { SessionDeliveryStatus } from "../src/renderer/src/components/PendingSends";
import { useApp } from "../src/renderer/src/store";
import { resetQueueViewCache } from "../src/renderer/src/lib/queueView";
import { ledgerOrderRef } from "../src/renderer/src/lib/admissionOrder";
import { ledgerQueue, deliveryBusy } from "../src/renderer/src/lib/inputLedger/nextUp";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import { useDelegations } from "../src/renderer/src/lib/delegationStore";
import { useAgentMessages } from "../src/renderer/src/lib/agentMessageStore";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let el: HTMLDivElement;
const key = "new-host\ncutex.s1";
const noop = () => {};
const session = (records: InputRecord[], state = delivery("idle", 1)) => ({ ...emptyInputLedgerSession(), delivery: state, records: new Map(records.map(r => [r.inputId, r])) });
const seed = (records: InputRecord[], state = delivery("idle", 1)) => act(() => useApp.setState({ inputs: { [key]: session(records, state) } }));
const panelProps = (overrides: Partial<React.ComponentProps<typeof QueuePanel>> = {}) => ({ sessionId: "cutex.s1", hostId: "new-host", steers: [], outbox: { onRetry: noop, onEdit: noop, onDiscard: noop }, onInterruptSendSteers: noop, onDismissSteer: noop, paused: { steers: [], items: [], count: 0 }, onResumePaused: noop, onRestorePaused: noop, onClearPaused: noop, items: [], canEdit: true, onEdit: noop, onDelete: noop, ...overrides });
const panel = (overrides: Partial<React.ComponentProps<typeof QueuePanel>> = {}) => act(() => root.render(h(QueuePanel, panelProps(overrides))));
const ids = () => [...el.querySelectorAll<HTMLElement>('[data-testid="ledger-queue-row"]')].map(n => n.dataset.inputId);
async function click(text: string) { await act(async () => { const button = [...el.querySelectorAll("button")].find(b => b.textContent === text); expect(button).toBeTruthy(); button!.click(); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(T0 + 20*86400000);
  for (const fn of Object.values(calls)) fn.mockReset();
  useDelegations.setState({ byKey: {} });
  resetQueueViewCache(); localStorage.clear(); useApp.setState({ inputs: {}, ledgerOutbox: {} }); useAgentMessages.getState().reset();
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); vi.useRealTimers(); });
describe("D4 ledger surfaces", () => {
  const queued = (id: string): QueueItem => ({ queueId: `q-${id}`, clientUserMessageId: id, input: [{ type: "text", text: id }], origin: { kind: "other", clientId: "desktop" }, position: 0, revision: 7, state: "queued", createdAt: iso(T0), updatedAt: iso(T0) });
  const mergeable = (id: string, position: number, patch: Partial<InputRecord> = {}) => record(id, { kind: "owner", surface: "nextUp", state: "waiting", reason: "explicitQueue", actions: ["cancel", "sendNow", "edit"], order: { admissionKey: id, position }, ...patch });
  it("merges matching eligible owner items in ledger order through Composer callback, prevents double-submit", async () => {
    seed([mergeable("b", 2), mergeable("a", 1), mergeable("bus", 0, { kind: "agentMessage" }), mergeable("sending", 3, { state: "sending" }), mergeable("unmatched", 4), mergeable("no-action", 5, { actions: [] })]);
    let finish!: () => void;
    const merge = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    panel({ items: [queued("b"), queued("a"), queued("bus"), queued("sending"), queued("no-action")], onSendNow: noop, onMergeInsert: merge });
    await click("queue.merge.action");
    expect(merge).toHaveBeenCalledWith([queued("a"), queued("b")]);
    const button = el.querySelector<HTMLButtonElement>('[data-testid="queue-merge-insert"]')!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click()); expect(merge).toHaveBeenCalledTimes(1);
    // The control does not optimistically move or delete any authoritative row.
    expect(ids()).toEqual(["bus", "a", "b", "sending", "unmatched", "no-action"]);
    await act(async () => finish()); expect(button.disabled).toBe(false);
  });
  it("hides merge with fewer than two eligible items or without insert capability", () => {
    const merge = vi.fn();
    seed([mergeable("a", 1), mergeable("held", 2, { reason: "hostBusy" })]);
    panel({ items: [queued("a"), queued("held")], onSendNow: noop, onMergeInsert: merge });
    expect(el.querySelector('[data-testid="queue-merge-insert"]')).toBeNull();
    seed([mergeable("a", 1), mergeable("b", 2)]);
    panel({ items: [queued("a"), queued("b")], onMergeInsert: merge });
    expect(el.querySelector('[data-testid="queue-merge-insert"]')).toBeNull();
  });
  it("reports merge refusal in this panel's host/session and keeps all rows", async () => {
    seed([mergeable("a", 1), mergeable("b", 2)]);
    panel({ items: [queued("a"), queued("b")], onSendNow: noop, onMergeInsert: vi.fn().mockRejectedValue(Error("queue_merge_failed:changed")) });
    await click("queue.merge.action");
    expect(calls.notify).toHaveBeenCalledWith(expect.any(String), "error", { hostId: "new-host", sessionId: "cutex.s1" });
    expect(ids()).toEqual(["a", "b"]);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="queue-merge-insert"]')!.disabled).toBe(false);
  });
  it("uses this host's capability, surface and D1 ordering, regardless of receipt age or accepted state", () => {
    seed([record("b", { surface: "nextUp", state: "waiting", reason: "reviewPending", order: { admissionKey: "b", position: 2 } }),
      record("a", { surface: "nextUp", state: "accepted", order: { admissionKey: "a", position: 1 } }),
      record("timeline", { surface: "timeline", state: "accepted" }), record("none", { surface: "none" }),
      record("old", { surface: "pendingNotes", state: "uncertain", reason: "outcomeUnknown", actions: ["retry","dismiss"] })]);
    panel(); expect(ids()).toEqual(["a","b","old"]); expect(el.textContent).not.toMatch(/nativeReceipt|notStarted|startsNow/);
    seed([record("a", { surface: "timeline", state: "inContext" })]); expect(ids()).toEqual([]);
  });
  const statusNotice = (patch: Partial<InputRecord> = {}) => record("delivery-held", { kind: "delegationStatus", surface: "pendingNotes", state: "waiting", reason: "passive", preview: "held@2: Publish public desktop 0.2.1", askId: "ask-b0", actions: ["dismiss"], sender: { kind: "agent", id: "mujika", name: "Mujika", host: null, cutexSessionId: "mujika" }, ...patch });
  const summary = (title: string, patch: Partial<AskSummary> = {}): AskSummary => ({ askId: "ask-b0", title, requester: { kind: "agent", cutexSessionId: "cutex.s1" }, target: "mujika", targetName: "Mujika", execution: "queued", attempts: 0, createdAt: iso(T0), updatedAt: iso(T0), revision: 2, ...patch });
  it("status notices use the row host's authoritative title and open that host's delegation", async () => {
    useDelegations.setState({ byKey: { [hostKey("new-host", "ask-b0")]: summary("Publish public desktop 0.2.1"), [hostKey("old-focus", "ask-b0")]: summary("Wrong host title") } });
    seed([statusNotice()]); panel();
    expect(ids()).toEqual(["delivery-held"]);
    expect(el.textContent).toContain("Mujika");
    expect(el.textContent).toContain("Publish public desktop 0.2.1");
    expect(el.textContent).not.toContain("Wrong host title");
    expect(el.innerHTML).not.toContain("held@2");
    const tag = el.querySelector<HTMLElement>("[data-delegation-tag]")!;
    expect(tag.textContent).toMatch(/^#\d+$/);
    await act(async () => tag.click());
    expect(calls.open).toHaveBeenLastCalledWith("new-host", "ask-b0", { title: "Publish public desktop 0.2.1" });
    await click("Publish public desktop 0.2.1");
    expect(calls.open).toHaveBeenCalledTimes(2);
    // Terminal ask state cannot settle this independent notification input.
    act(() => useDelegations.setState({ byKey: { [hostKey("new-host", "ask-b0")]: summary("Publish public desktop 0.2.1", { execution: "answered", closed: "accepted" }) } }));
    expect(ids()).toEqual(["delivery-held"]);
    expect(el.querySelector('[data-testid="input-status"]')?.getAttribute("data-state")).toBe("waiting");
    expect(el.textContent).toContain("inputLedger.record.passive");
    expect(el.textContent).toContain("inputLedger.ignoreNotification");
  });
  it("a missing summary keeps the status row, tag, safe fallback and only its ledger dismiss action", async () => {
    useAgentMessages.setState({ byId: { "delivery-held": { body: "held@2: internal bus body" } as never } });
    useDelegations.setState({ byKey: { [hostKey("old-focus", "ask-b0")]: summary("Wrong host title") } });
    seed([statusNotice(), record("other-input", { kind: "agentMessage", surface: "pendingNotes", reason: "passive", actions: [] })]); panel();
    const row = el.querySelector<HTMLElement>('[data-input-id="delivery-held"]')!;
    expect(row.textContent).toContain("inputLedger.statusNotification");
    expect(row.querySelector("[data-delegation-tag]")).toBeTruthy();
    expect(row.innerHTML).not.toMatch(/held@2|internal bus body|Wrong host title/);
    await click("inputLedger.ignoreNotification");
    expect(calls.dismiss).toHaveBeenCalledExactlyOnceWith("cutex.s1", "delivery-held", "new-host");
    expect(calls.retry).not.toHaveBeenCalled();
    expect(ids()).toEqual(["delivery-held", "other-input"]);
    seed([statusNotice({ actions: [] })]);
    expect(el.textContent).not.toContain("inputLedger.ignoreNotification");
  });
  it("other input kinds retain unknown raw prose without interpreting its prefix", () => {
    seed([statusNotice({ kind: "delegationResult", preview: "held@2: unstructured result prose" })]); panel();
    expect(el.textContent).toContain("held@2: unstructured result prose");
    expect(el.querySelector('[title="held@2: unstructured result prose"]')).toBeTruthy();
    expect(el.textContent).toContain("inputLedger.dismiss");
    expect(el.querySelector("[data-delegation-tag]")).toBeNull();
  });
  it("reads bus body without using its delivered/dismissed state", () => {
    seed([record("note", { surface: "pendingNotes", kind: "agentMessage", state: "waiting", reason: "passive" })]);
    useAgentMessages.setState({ byId: { note: { messageId: "note", body: "full bus body", state: "delivered", to: "cutex.s1" } as never }, dismissed: new Set(["note"]) });
    panel(); expect(ids()).toEqual(["note"]); expect(el.textContent).toContain("full bus body");
  });
  it("routes single retry and dismiss to the record's host; keeps the row pending authoritative update", async () => {
    seed([record("a", { surface: "nextUp", state: "uncertain", reason: "receiptTimeout", actions: ["retry","dismiss"] })]); panel();
    await click("inputLedger.retry"); await click("inputLedger.dismiss");
    expect(calls.retry).toHaveBeenCalledWith("cutex.s1","a","new-host"); expect(calls.dismiss).toHaveBeenCalledWith("cutex.s1","a","new-host");
    expect(ids()).toEqual(["a"]);
  });
  it("bulk dismiss includes timeline uncertainty, respects offered actions, and preserves failed rows", async () => {
    calls.dismiss.mockImplementation((_s,id) => id === "a" ? Promise.reject(Error("failed")) : Promise.resolve());
    seed([record("a", { surface: "timeline", state: "uncertain", reason: "outcomeUnknown", actions: ["dismiss"] }),
      record("b", { surface: "pendingNotes", state: "uncertain", reason: "outcomeUnknown", actions: ["dismiss"] }),
      record("c", { surface: "nextUp", state: "uncertain", reason: "outcomeUnknown", actions: [] })]); panel();
    await click("inputLedger.cleanup(2)"); expect(calls.dismiss).not.toHaveBeenCalled(); await click("inputLedger.cleanupAgain(2)");
    expect(calls.dismiss.mock.calls.map(c => c[1])).toEqual(["a","b"]);
    expect(calls.notify).toHaveBeenCalledWith("inputLedger.cleanupFailed(1)","error",{ hostId: "new-host", sessionId: "cutex.s1" });
    expect(ids()).toEqual(["c","b"]);
  });
  it("shows offline O0 once and replaces it with the first server record", () => {
    seed([],delivery("offline",1)); act(() => useApp.setState({ ledgerOutbox: { [key]: [{ inputId: "o0", hostId: "new-host", sessionId: "cutex.s1", text: "offline", extra: [], strategy: "auto", phase: "sending", createdAt: iso(T0) }] } })); panel();
    expect(el.querySelectorAll('[data-testid="ledger-nextup-outbox"]')).toHaveLength(1);
    seed([record("o0", { surface: "nextUp", state: "waiting", reason: "agentOffline" })],delivery("starting",2));
    expect(el.querySelectorAll('[data-testid="ledger-nextup-outbox"]')).toHaveLength(0); expect(ids()).toEqual(["o0"]);
    seed([record("o0", { surface: "timeline", state: "accepted" })]); expect(ids()).toEqual([]);
    seed([],delivery("idle",3)); expect(el.querySelector('[data-testid="ledger-nextup-outbox"]')).toBeNull();
  });
  it("keeps old uncertainty indefinitely", () => {
    expect(ledgerQueue(session([record("old", { surface: "nextUp", state: "uncertain", reason: "outcomeUnknown" })]), T0+20*86400000).nextUp.map(r=>r.inputId)).toEqual(["old"]);
  });
  it("fixes row and action heights with long text; hover introduces no height rule", () => {
    seed([record("long", { surface: "nextUp", state: "uncertain", reason: "outcomeUnknown", preview: "long ".repeat(100), actions: ["retry","dismiss"] })]); panel();
    const row = el.querySelector<HTMLElement>('[data-testid="ledger-queue-row"]')!;
    expect(row.classList.contains("h-6")).toBe(true); expect(row.classList.contains("max-h-6")).toBe(true);
    expect(row.className).not.toMatch(/hover[^ ]*:h-/);
    for (const button of row.querySelectorAll("button")) expect(button.classList.contains("h-5")).toBe(true);
  });
});
describe("shared ledger statuses", () => {
  const lease = (holder: "ask" | "event" | "owner", stale = false) => ({ holder, turnId: null, since: iso(T0), runtimeGeneration: 1, inputIds: [], reconcile: { state: stale ? "stale" as const : "checking" as const } });
  it.each(["turn", "held"] as const)("does not create a duplicate queue group for delegation %s", state => {
    seed([], delivery(state, 1, { reason: state === "held" ? "delegationLease" : null, turn: state === "turn" ? { kind: "ask", askId: "ask-private", turnId: "t", inputIds: [], startedAt: iso(T0) } : null, lease: lease("ask") }));
    panel(); expect(el.querySelector('[data-testid="queue-tray"]')).toBeNull();
    seed([record("unlinked", { surface: "nextUp", state: "waiting", reason: "delegationLease" })], delivery(state, 2, { reason: state === "held" ? "delegationLease" : null, turn: state === "turn" ? { kind: "ask", askId: "ask-private", turnId: "t", inputIds: [], startedAt: iso(T0) } : null, lease: lease("ask") }));
    expect(ids()).toEqual(["unlinked"]);
    expect(el.querySelector('[data-testid="delivery-status"]')).toBeNull();
  });
  it.each(["ask", "event", "owner"] as const)("preserves stale %s lease recovery in the queue", async holder => {
    seed([], delivery("held", 1, { reason: holder === "ask" ? "delegationLease" : "eventLease", lease: lease(holder, true) })); panel();
    expect(el.querySelector('[data-testid="delivery-status"]')).toBeTruthy();
    await click("inputLedger.release"); expect(calls.release).not.toHaveBeenCalled();
    await click("inputLedger.releaseAgain"); expect(calls.release).toHaveBeenCalledWith("cutex.s1", "new-host");
  });
  it("shows stale lease recovery only in the queue, not also in the session header", async () => {
    const state = delivery("held", 1, { reason: "delegationLease", lease: lease("ask", true) });
    seed([], state);
    act(() => root.render(h("div", {}, h(SessionDeliveryStatus, { delivery: state, sessionId: "cutex.s1", hostId: "new-host" }), h(QueuePanel, panelProps()))));
    expect([...el.querySelectorAll("button")].filter(node => node.textContent === "inputLedger.release")).toHaveLength(1);
    expect(el.querySelector('[data-testid="queue-tray"]')?.textContent).toContain("inputLedger.release");
    await click("inputLedger.release"); expect(calls.release).not.toHaveBeenCalled();
    await click("inputLedger.releaseAgain"); expect(calls.release).toHaveBeenCalledTimes(1);
  });
  it.each(["event", "owner"] as const)("preserves ordinary %s lease delivery alerts", holder => {
    seed([], delivery("held", 1, { reason: "eventLease", lease: lease(holder) })); panel();
    expect(el.querySelector('[data-testid="delivery-status"]')).toBeTruthy();
  });
  it.each(["paused", "stopHold"] as const)("preserves %s recovery even with an ask lease", async reason => {
    seed([], delivery("held", 1, { reason, lease: lease("ask") })); panel();
    await click("paused.resume"); expect(calls.resume).toHaveBeenCalledWith("cutex.s1", "new-host");
  });
  it("displays and reports unknown reason codes", () => {
    act(()=>root.render(h(InputStatus,{record:record("u",{state:"waiting",reason:"futureReason"}),sessionId:"cutex.s1"})));
    expect(el.textContent).toContain("futureReason"); expect(calls.log).toHaveBeenCalledOnce(); expect(el.textContent).not.toContain("inputLedger.record.queued");
  });
  it("counts down only the host deadline and never infers a new state at zero", () => {
    act(()=>root.render(h(DeliveryStatus,{delivery:delivery("held",1,{reason:"hostBusy",heldUntil:iso(Date.now()+3000)}),sessionId:"cutex.s1"})));
    expect(el.textContent).toContain("queue.meta.countdown(3)"); act(()=>vi.advanceTimersByTime(5000));
    expect(el.textContent).toContain("queue.meta.countdown(0)"); expect(el.querySelector('[data-state="held"]')).toBeTruthy();
  });
  it("shows lease elapsed minutes and requires a second click to release stale lease", async () => {
    act(()=>root.render(h(DeliveryStatus,{delivery:delivery("held",1,{reason:"eventLease",lease:{holder:"event",turnId:null,since:iso(Date.now()-180000),runtimeGeneration:1,inputIds:[],reconcile:{state:"stale"}}}),sessionId:"cutex.s1",hostId:"new-host"})));
    expect(el.textContent).toContain("inputLedger.leaseElapsed(3)"); await click("inputLedger.release"); expect(calls.release).not.toHaveBeenCalled();
    await click("inputLedger.releaseAgain"); expect(calls.release).toHaveBeenCalledWith("cutex.s1","new-host");
  });
  it.each(["paused","stopHold"] as const)("continues server-held %s through queueResume's store action", async reason => {
    act(()=>root.render(h(DeliveryStatus,{delivery:delivery("held",1,{reason}),sessionId:"cutex.s1",hostId:"new-host"})));
    await click("paused.resume"); expect(calls.resume).toHaveBeenCalledWith("cutex.s1","new-host");
  });
  it("never falls back to a raw ask id and suppresses timers when disconnected", () => {
    act(()=>root.render(h(DeliveryStatus,{delivery:delivery("turn",1,{turn:{kind:"ask",askId:"ask-123",turnId:"t",inputIds:[],startedAt:iso(T0)}}),sessionId:"cutex.s1"})));
    expect(el.innerHTML).not.toContain("ask-123");
    act(()=>root.render(h(DeliveryStatus,{delivery:delivery("turn",1,{turn:{kind:"ask",askId:"ask-123",turnId:"t",inputIds:[],startedAt:iso(T0)}}),sessionId:"cutex.s1",askTitle:"Review parser"})));
    expect(el.textContent).toContain("Review parser");
    act(()=>root.render(h(DeliveryStatus,{delivery:delivery("disconnected",2,{lease:{holder:"event",turnId:null,since:iso(T0),inputIds:[],runtimeGeneration:1,reconcile:{state:"checking"}}}),sessionId:"cutex.s1"})));
    expect(el.querySelector('[data-testid="delivery-lease-elapsed"]')).toBeNull();
  });
  it("uses delivery busy without smoothing idle/offline/disconnected", () => {
    for(const state of ["turn","finishing","starting"] as const) expect(deliveryBusy(delivery(state,1))).toBe(true);
    for(const state of ["idle","offline","disconnected"] as const) expect(deliveryBusy(delivery(state,1))).toBe(false);
    expect(deliveryBusy(delivery("held",1,{reason:"stopHold"}))).toBe(false);
  });
});

describe("ledger reorder addressing", () => {
  const queue = [{ queueId: "queue-id", clientUserMessageId: "owner-id" } as QueueItem];
  const admission = { revision: 1, stale: true, items: [
    { kind: "owner", id: "queue-id", position: 1, state: "waiting", enqueuedAt: iso(T0) },
    { kind: "ask", id: "ask-id", position: 2, state: "waiting", enqueuedAt: iso(T0) },
  ] } as import("@cutex-desktop/protocol").QueueAdmission;
  it("uses admission only to address move targets, even if stale; never supplies row membership", () => {
    expect(ledgerOrderRef(record("owner-id"), queue, admission)).toEqual({ kind: "owner", id: "queue-id" });
    expect(ledgerOrderRef(record("ask-input", { kind: "delegationRequest", askId: "ask-id", state: "inContext" }), queue, admission)).toEqual({ kind: "ask", id: "ask-id" });
    expect(ledgerOrderRef(record("missing"), queue, admission)).toBeUndefined();
    const rows = ledgerQueue(session([record("a", { surface: "nextUp", state: "waiting", reason: "explicitQueue" })]), T0);
    expect(rows.nextUp.map(r => r.inputId)).toEqual(["a"]);
  });
});
