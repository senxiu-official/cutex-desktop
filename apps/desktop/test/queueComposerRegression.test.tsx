// @vitest-environment jsdom
// Regression guard for design 040 step 9 (queue + composer as one input card): the restyle must keep the queue's
// behaviour. Rendered through the real QueuePanel (as Composer mounts it, admission-order): drag a queued turn
// onto 「插入当前回合」 and stay = insert; a quick drop or a drop on a turn only moves; Alt+↑ / Alt+↓ / Alt+End on a
// focused row move it; the row's actions are buttons in the Tab order; the header chevron collapses and expands.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionItem, QueueItem } from "@cutex-desktop/protocol";
import type { PendingSteer } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { beginQueueInsert, DELIVERED_FEEDBACK_MS, dismissQueueInsert, finishQueueInsert, insertFeedbackOf, reconcileQueueInsert, setQueueInsertChecking, useQueueInsertFeedback } from "../src/renderer/src/lib/queueInsertFeedback";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign(
    (select: (s: unknown) => unknown) => {
      try {
        return select({});
      } catch {
        return false;
      }
    },
    { getState: () => ({}) },
  ),
  selectedFeatures: () => new Set(),
  agentHost: () => "local",
  featuresOf: () => new Set(),
  hostApi: () => ({}),
  queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map((p) => p.text ?? "").join(""),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { QueuePanel } = await import("../src/renderer/src/components/QueuePanel");
const { turnGroups } = await import("../src/renderer/src/lib/legacyDelivery/admissionOrder");
const { INSERT_DWELL_MS } = await import("../src/renderer/src/lib/insertTarget");

const at = "2026-10-23T00:00:00Z";
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `msg-${queueId}` }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const owner = (id: string, position: number): AdmissionItem => ({ kind: "owner", id, position, enqueuedAt: at, state: "waiting" });

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
const onMove = vi.fn();
const onInsert = vi.fn();
const onSendNow = vi.fn();
const onEdit = vi.fn();
const onDelete = vi.fn();

function mount(running = true, custom: { items?: QueueItem[]; sessionId?: string; steers?: PendingSteer[] } = {}) {
  const items = custom.items ?? [queued("A"), queued("B"), queued("C")];
  const { turns, nextStep } = turnGroups({ revision: 1, items: items.map((q, i) => owner(q.queueId, i + 1)), nextStep: [] }, items, {});
  act(() =>
    root!.render(
      h(QueuePanel, {
        sessionId: custom.sessionId ?? `s-${Math.random()}`,
        steers: custom.steers ?? [],
        outbox: { onRetry() {}, onEdit() {}, onDiscard() {} },
        onInterruptSendSteers() {},
        onDismissSteer() {},
        paused: { steers: [], items: [], count: 0 },
        onResumePaused() {},
        onRestorePaused() {},
        onClearPaused() {},
        items,
        canEdit: true,
        onSendNow,
        onEdit,
        onDelete,
        running,
        ordered: { turns, nextStep, running, runningSince: null, currentTurn: running ? { kind: "owner" } : null, mayPass: true, onMove, onInsert, onMergeInsert() {}, sessionId: "s" },
      }),
    ),
  );
}

const q = (sel: string) => host.querySelector<HTMLElement>(sel)!;
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
function fire(el: Element, type: string, clientY = 0): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" } });
  Object.defineProperty(ev, "clientY", { value: clientY });
  act(() => void el.dispatchEvent(ev));
  return ev;
}
const key = (el: Element, k: string, alt = true) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, altKey: alt, bubbles: true, cancelable: true })));
const queueRows = () => qa('[data-testid="queue-item"]');
const rowOf = (id: string) => queueRows().find((r) => r.textContent?.includes(`msg-${id}`))!;

beforeEach(() => {
  useQueueInsertFeedback.setState({ byView: {} });
  vi.useFakeTimers();
  for (const f of [onMove, onInsert, onSendNow, onEdit, onDelete]) f.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

describe("insert feedback belongs to its message row", () => {
  it("a delivered owner-input row never renders stale refusal, pending, details or resend actions", async () => {
    const { QueueInsertStatus } = await import("../src/renderer/src/components/QueueInsertStatus");
    mount(true, { sessionId: "feedback", items: [] });
    const item = { ...queued("A"), state: "delivered" };
    act(() => root!.render(h(QueueInsertStatus, { hostId: "local", sessionId: "feedback", feedback: { token: {}, item, state: "rejected", reason: "委托占用中", detail: "stale refusal" } })));
    expect(host.textContent).toContain("queue.insert.delivered");
    expect(host.textContent).not.toContain("queue.insert.rejected");
    expect(host.textContent).not.toContain("委托占用中");
    expect(host.textContent).not.toContain("stale refusal");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
  it("expires a delivered receipt normalized from a late refusal exactly once", () => {
    const item = { ...queued("A"), state: "delivered" };
    const token = beginQueueInsert("local", "feedback", item)!;
    finishQueueInsert("local", "feedback", token, "rejected", "delegation busy");
    expect(insertFeedbackOf("local", "feedback")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "delivered", reason: undefined }]);
    vi.advanceTimersByTime(DELIVERED_FEEDBACK_MS - 1);
    finishQueueInsert("local", "feedback", token, "rejected", "late duplicate");
    vi.advanceTimersByTime(1);
    expect(insertFeedbackOf("local", "feedback")(useQueueInsertFeedback.getState())).toEqual([]);
  });
  it("shows immediate pending, disables duplicate actions, then shows a refusal in the same single status slot", () => {
    mount(true, { sessionId: "feedback" });
    let token!: object;
    act(() => { token = beginQueueInsert("local", "feedback", queued("A"))!; });
    const row = rowOf("A");
    expect(row.querySelectorAll('[data-testid="queue-insert-status"]')).toHaveLength(1);
    expect(row.querySelector('[data-testid="queue-delivery-note"]')).toBeNull();
    expect(row.textContent).toContain("queue.insert.requesting");
    expect((row.querySelector('[data-testid="queue-send-now"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => finishQueueInsert("local", "feedback", token, "rejected", "control unavailable; kept in queue"));
    expect(rowOf("A").textContent).toContain("control unavailable; kept in queue");
    expect(rowOf("A").querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(rowOf("A").innerHTML).not.toContain("text-warn");
    expect((rowOf("A").querySelector('[data-testid="queue-send-now"]') as HTMLButtonElement).disabled).toBe(false);
    expect(queueRows().map((r) => r.querySelector('.text-foreground')?.textContent)).toEqual(["msg-A", "msg-B", "msg-C"]);
  });

  it("keeps acceptance until native delivery, then removes the receipt after one second without a close button", () => {
    mount(true, { sessionId: "feedback" });
    let token!: object;
    act(() => { token = beginQueueInsert("local", "feedback", queued("A"))!; });
    mount(true, { sessionId: "feedback", items: [] });
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insert.requesting");
    act(() => finishQueueInsert("local", "feedback", token, "inserted"));
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insertedToast");
    expect(host.querySelector('[data-testid="turn-group-owner"]')).toBeNull();
    expect(host.querySelector('[aria-label="common.close"]')).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insertedToast");
    act(() => reconcileQueueInsert("local", "feedback", (id) => id === "cm-A"));
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insert.delivered");
    act(() => void vi.advanceTimersByTime(DELIVERED_FEEDBACK_MS / 2));
    // Repeated history reads cannot keep extending the receipt's lifetime.
    act(() => reconcileQueueInsert("local", "feedback", () => true));
    act(() => void vi.advanceTimersByTime(DELIVERED_FEEDBACK_MS / 2 - 1));
    expect(host.querySelector('[data-testid="queue-insert-receipt"]')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(host.querySelector('[data-testid="queue-tray"]')).toBeNull();
    expect(insertFeedbackOf("local", "feedback")(useQueueInsertFeedback.getState())).toEqual([]);
  });

  it("uses one status on the actual pending steer, without a second receipt or boundary note", () => {
    const token = beginQueueInsert("local", "feedback", queued("A"))!;
    finishQueueInsert("local", "feedback", token, "inserted");
    mount(true, { sessionId: "feedback", items: [], steers: [{ id: "cm-A", text: "msg-A", imageCount: 0, turnId: "t1", baseline: 0 }] });
    expect(qa('[data-testid="queue-insert-status"]')).toHaveLength(1);
    expect(q('[data-testid="boundary-steer"]').textContent).toContain("queue.insertedToast");
    expect(host.querySelector('[data-testid="queue-insert-receipt"]')).toBeNull();
    expect(q('[data-testid="boundary-steer"]').textContent).not.toContain("queue.meta.nextStep");
  });

  it("unknown outcomes cannot be dismissed into a retry, and receipts are isolated by host and session", () => {
    const token = beginQueueInsert("local", "feedback", queued("A"))!;
    finishQueueInsert("local", "feedback", token, "unknown", undefined, undefined, undefined, { detail: "request timed out", checking: true });
    expect(insertFeedbackOf("remote", "feedback")(useQueueInsertFeedback.getState())).toEqual([]);
    expect(beginQueueInsert("remote", "feedback", queued("A"))).not.toBeNull();
    mount(true, { sessionId: "different" });
    expect(host.querySelector('[data-testid="queue-insert-status"]')).toBeNull();
    mount(true, { sessionId: "feedback" });
    // While the desktop resyncs: 正在确认…, nothing to click, the row's actions held.
    expect(rowOf("A").textContent).toContain("queue.insert.checking");
    expect(rowOf("A").querySelector('[aria-label="common.close"]')).toBeNull();
    expect(rowOf("A").querySelector('[data-testid="queue-insert-resend"]')).toBeNull();
    expect((rowOf("A").querySelector('[data-testid="queue-delete"]') as HTMLButtonElement).disabled).toBe(true);
    // Could not tell, still listed (cutex unreadable): 再发一次 / 已送达, deletable, never 插话 again from the row.
    act(() => setQueueInsertChecking("local", "feedback", token, false));
    expect(rowOf("A").textContent).toContain("queue.insert.unknown");
    expect(rowOf("A").textContent).not.toContain("request timed out");
    expect(rowOf("A").querySelector('[data-testid="queue-insert-resend"]')).not.toBeNull();
    expect(rowOf("A").querySelector('[data-testid="queue-insert-delivered"]')).not.toBeNull();
    expect(rowOf("A").querySelector('[data-testid="queue-insert-forget"]')).toBeNull();
    expect(rowOf("A").querySelector('[data-testid="queue-insert-detail"]')!.getAttribute("data-tip")).toContain("request timed out");
    expect((rowOf("A").querySelector('[data-testid="queue-send-now"]') as HTMLButtonElement).disabled).toBe(true);
    expect((rowOf("A").querySelector('[data-testid="queue-delete"]') as HTMLButtonElement).disabled).toBe(false);
    expect(beginQueueInsert("local", "feedback", queued("A"))).toBeNull();
    act(() => dismissQueueInsert("local", "feedback", token));
    expect(rowOf("A").querySelector('[data-testid="queue-insert-status"]')).toBeNull();
    expect(beginQueueInsert("local", "feedback", queued("A"))).toBeNull();
    expect(insertFeedbackOf("local", "feedback")(useQueueInsertFeedback.getState())[0]).toMatchObject({ state: "unknown", hidden: true });
  });

  it("an unsure receipt says what to do in plain words; the backend's words only behind 详情", () => {
    mount(true, { sessionId: "feedback", items: [] });
    const raw = "request_outcome_unknown: the cutex operation completed far enough that its durable outcome is unknown (originalCode: outcome_unknown)";
    act(() => { const token = beginQueueInsert("local", "feedback", queued("A"))!; finishQueueInsert("local", "feedback", token, "unknown", undefined, undefined, undefined, { detail: raw, checking: false }); });
    const receipt = q('[data-testid="queue-insert-receipt"]');
    expect(receipt.textContent).toContain("queue.insert.unknown");
    expect(receipt.textContent).toContain("queue.insert.resend");
    expect(receipt.textContent).toContain("queue.insert.markDelivered");
    expect(receipt.querySelector('[data-testid="queue-insert-forget"]')).not.toBeNull();
    expect(host.textContent).not.toContain("request_outcome_unknown");
    expect(host.textContent).not.toContain("outcome_unknown");
    const hint = q('[data-testid="queue-insert-unsure-hint"]');
    expect(hint.textContent).toContain("queue.insert.unsureHint");
    const toggle = q('[data-testid="queue-insert-details-toggle"]');
    expect(toggle.getAttribute("data-tip")).toBe(raw);
    act(() => toggle.click());
    expect(q('[data-testid="queue-insert-raw"]').textContent).toBe(raw);
  });

  it("a refusal's native words are a 详情 tooltip, not the row's text", () => {
    mount(true, { sessionId: "feedback", items: [] });
    act(() => { const token = beginQueueInsert("local", "feedback", queued("A"))!; finishQueueInsert("local", "feedback", token, "rejected", "queue.steer.runtimeRefusedPlain", undefined, undefined, { detail: "cannot steer a review turn" }); });
    const receipt = q('[data-testid="queue-insert-receipt"]');
    expect(receipt.textContent).not.toContain("cannot steer");
    expect(q('[data-testid="queue-insert-detail"]').getAttribute("data-tip")).toContain("cannot steer a review turn");
  });

  it("positive history evidence resolves an unknown result and a late request error cannot overwrite it", () => {
    const token = beginQueueInsert("local", "feedback", queued("A"))!;
    finishQueueInsert("local", "feedback", token, "unknown", "timeout");
    reconcileQueueInsert("local", "feedback", () => false);
    expect(insertFeedbackOf("local", "feedback")(useQueueInsertFeedback.getState())[0]?.state).toBe("unknown");
    reconcileQueueInsert("local", "feedback", (id) => id === "cm-A");
    finishQueueInsert("local", "feedback", token, "rejected", "stale refusal");
    mount(true, { sessionId: "feedback", items: [] });
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insert.delivered");
    expect(q('[data-testid="queue-insert-receipt"]').textContent).not.toContain("stale refusal");
  });

  it("retains refusal receipts until closed, and closing an unknown receipt hides it without forgetting the request", () => {
    mount(true, { sessionId: "feedback", items: [] });
    let token!: object;
    act(() => { token = beginQueueInsert("local", "feedback", queued("A"))!; finishQueueInsert("local", "feedback", token, "rejected", "kept in queue"); });
    act(() => void vi.advanceTimersByTime(5000));
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("kept in queue");
    act(() => (q('[aria-label="common.close"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-testid="queue-tray"]')).toBeNull();
    act(() => { token = beginQueueInsert("local", "feedback", queued("A"))!; finishQueueInsert("local", "feedback", token, "unknown", undefined, undefined, undefined, { detail: "timeout", checking: false }); });
    act(() => void vi.advanceTimersByTime(5000));
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insert.unknown");
    // 删除 (the store's queueInsertDecide "forget") hides it and keeps the duplicate-send guard.
    act(() => dismissQueueInsert("local", "feedback", token));
    expect(host.querySelector('[data-testid="queue-tray"]')).toBeNull();
    expect(beginQueueInsert("local", "feedback", queued("A"))).toBeNull();
    act(() => reconcileQueueInsert("local", "feedback", () => true));
    act(() => void vi.advanceTimersByTime(DELIVERED_FEEDBACK_MS));
    expect(insertFeedbackOf("local", "feedback")(useQueueInsertFeedback.getState())).toEqual([]);
  });

  it("expiration belongs to the original operation, survives pane switches, and cannot remove another host's error", () => {
    const token = beginQueueInsert("local", "feedback", queued("A"))!;
    finishQueueInsert("local", "feedback", token, "inserted");
    const remote = beginQueueInsert("remote", "feedback", queued("A"))!;
    finishQueueInsert("remote", "feedback", remote, "unknown", "remote timeout");
    reconcileQueueInsert("local", "feedback", () => true);
    mount(true, { sessionId: "different", items: [] });
    act(() => void vi.advanceTimersByTime(600));
    mount(true, { sessionId: "feedback", items: [] });
    expect(q('[data-testid="queue-insert-receipt"]').textContent).toContain("queue.insert.delivered");
    act(() => void vi.advanceTimersByTime(DELIVERED_FEEDBACK_MS - 600));
    expect(host.querySelector('[data-testid="queue-tray"]')).toBeNull();
    expect(insertFeedbackOf("remote", "feedback")(useQueueInsertFeedback.getState())).toMatchObject([{ state: "unknown" }]);
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
});

describe("drag-insert into the current turn (through QueuePanel)", () => {
  it("drag row 2 onto 「插入当前回合」 (the header line while dragging), stay INSERT_DWELL_MS, drop = inserts that row", () => {
    mount();
    expect(host.querySelector('[data-testid="insert-target"]')).toBeNull();
    fire(qa('[data-testid="queue-drag-grip"]')[1]!, "dragstart");
    const target = q('[data-testid="insert-target"]');
    expect(target.closest('[data-testid="queue-header"]')).not.toBeNull();
    const early = fire(target, "dragover");
    expect(early.defaultPrevented).toBe(false);
    act(() => void vi.advanceTimersByTime(INSERT_DWELL_MS));
    const armed = fire(target, "dragover");
    expect(armed.defaultPrevented).toBe(true);
    expect(target.getAttribute("data-state")).toBe("armed");
    fire(target, "drop");
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0]![0].queueId).toBe("B");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("a quick drop on the target inserts nothing; a drop on a turn only moves", () => {
    mount();
    fire(qa('[data-testid="queue-drag-grip"]')[1]!, "dragstart");
    fire(q('[data-testid="insert-target"]'), "dragover");
    fire(q('[data-testid="insert-target"]'), "drop");
    expect(onInsert).not.toHaveBeenCalled();
    fire(qa('[data-testid="queue-drag-grip"]')[2]!, "dragstart");
    const first = qa('[data-testid="turn-group-owner"]')[0]!;
    fire(first, "dragover", 0);
    fire(first, "drop", 0);
    expect(onInsert).not.toHaveBeenCalled();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].queueId).toBe("C");
  });

  it("idle: no insert target, the grips still reorder", () => {
    mount(false);
    expect(host.querySelector('[data-testid="insert-target"]')).toBeNull();
    expect(qa('[data-testid="queue-drag-grip"]').length).toBe(3);
  });
});

describe("keyboard", () => {
  it("a queued row is focusable; Alt+↑ / Alt+↓ / Alt+End move it; plain arrows and keys from its buttons do not", () => {
    mount();
    const b = rowOf("B");
    expect(b.tabIndex).toBe(0);
    key(b, "ArrowUp");
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].queueId).toBe("B");
    expect(onMove.mock.calls[0]![1]).toMatchObject({ id: "A" });
    key(b, "ArrowDown");
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onMove.mock.calls[1]![1]).not.toMatchObject({ id: "B" });
    key(rowOf("A"), "End");
    expect(onMove).toHaveBeenCalledTimes(3);
    expect(onMove.mock.calls[2]![0].queueId).toBe("A");
    expect(onMove.mock.calls[2]![1]).toBeNull();
    key(b, "ArrowUp", false);
    key(b.querySelector("button")!, "ArrowUp");
    expect(onMove).toHaveBeenCalledTimes(3);
  });

  it("row actions are real buttons (Tab reaches them): 插入 / 编辑 / 删除 call their handlers", () => {
    mount();
    const b = rowOf("B");
    const buttons = [...b.querySelectorAll<HTMLButtonElement>('[data-testid="queue-item-actions"] button')];
    expect(buttons.length).toBe(3);
    for (const btn of buttons) expect(btn.tabIndex).toBe(0);
    act(() => b.querySelector<HTMLButtonElement>('[data-testid="queue-send-now"]')!.click());
    act(() => buttons[1]!.click());
    act(() => b.querySelector<HTMLButtonElement>('[data-testid="queue-delete"]')!.click());
    expect(onSendNow.mock.calls[0]![0].queueId).toBe("B");
    expect(onEdit.mock.calls[0]![0].queueId).toBe("B");
    expect(onDelete.mock.calls[0]![0].queueId).toBe("B");
  });

  it("the header chevron collapses the card to its line and expands it again", () => {
    mount();
    const tray = q('[data-testid="queue-tray"]');
    expect(q('[data-testid="queue-collapse"]').querySelector(".lucide-chevron-down")).not.toBeNull();
    act(() => q('[data-testid="queue-collapse"]').click());
    expect(tray.getAttribute("data-collapsed")).not.toBeNull();
    expect(q('[data-testid="queue-collapse"]').querySelector(".lucide-chevron-right")).not.toBeNull();
    expect(queueRows().length).toBe(0);
    act(() => q('[data-testid="queue-collapse"]').click());
    expect(queueRows().length).toBeGreaterThan(0);
    expect(q('[data-testid="queue-collapse"]').querySelector(".lucide-chevron-down")).not.toBeNull();
  });
});

describe("「接下来」 above the input box (owner 2026-10-26)", () => {
  it("the queue tray is its own block: framed, square bottom, no bottom edge (the input box's top border is it)", () => {
    mount();
    const tray = q('[data-testid="queue-tray"]');
    expect(tray.hasAttribute("data-queue-tray")).toBe(true);
    expect(tray.className.split(/\s+/)).toEqual(expect.arrayContaining(["border", "border-b-0", "rounded-t-inner", "bg-surface"]));
    // No 「插入当前回合」 row, so no boundary section while nothing waits at the boundary.
    expect(host.querySelector('[data-testid="boundary-card"]')).toBeNull();
    // 「全部合并插入」 is at the right of the header line.
    expect(q('[data-testid="queue-merge-insert"]').closest('[data-testid="queue-header"]')).not.toBeNull();
  });

  it("Composer never wraps or insets the input box for it: only the box's top corners square off under the tray", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/renderer/src/components/Composer.tsx", "utf8");
    expect(src).toMatch(/<div className="group\/inputcard relative flex min-h-0 flex-col rounded-inner" data-customize-region="composer">/);
    expect(src).toMatch(/const INPUT_IN_CARD = "group-has-\[\[data-queue-tray\]\]\/inputcard:rounded-t-none";/);
    expect(src).not.toMatch(/INPUT_CARD\b/);
    expect(src).toMatch(/data-gutter-anchor="composer"\s+className=\{`relative rounded-inner border bg-surface px-3 py-2 focus-within:border-accent\/60 \$\{INPUT_IN_CARD\}/);
  });

  it("in a short pane its rows scroll inside it instead of running under the input box (待读留言 cut, owner 2026-10-26)", async () => {
    // The chain down from the conversation column may shrink: composer block → Composer → input card → tray → rows.
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/renderer/src/components/Conversation.tsx", "utf8")).toMatch(/<div data-composer-block className=\{[^}]*\? "hidden" : "flex min-h-0 flex-col"\}>/);
    expect(readFileSync("src/renderer/src/components/Composer.tsx", "utf8")).toMatch(/<div className="side-col side-col-composer flex min-h-0 w-full flex-col px-4 pb-3">/);
    const sh = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get");
    const ch = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
    try {
      sh.mockReturnValue(100);
      mount();
      const body = q("[data-queue-body]");
      expect(q('[data-testid="queue-tray"]').className.split(/\s+/)).toContain("min-h-0");
      expect(body.className.split(/\s+/)).toContain("min-h-0");
      // Fits: no scroll box (the rail strip may stand outside the frame).
      expect(body.hasAttribute("data-scrolls")).toBe(false);
      expect(body.className).not.toMatch(/overflow-y-auto/);
      // Taller than the room it got: it scrolls.
      sh.mockReturnValue(160);
      mount();
      expect(q("[data-queue-body]").getAttribute("data-scrolls")).toBe("true");
      expect(q("[data-queue-body]").className).toMatch(/overflow-y-auto/);
    } finally {
      sh.mockRestore();
      ch.mockRestore();
    }
  });
});
