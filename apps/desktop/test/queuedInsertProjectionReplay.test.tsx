// @vitest-environment jsdom
// Projection replay through the real timeline/receipt and pending-steer reducers,
// Composer helpers and QueuePanel. Store owns transport/held admission normalization.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionNextStep, QueueItem } from "@cutex-desktop/protocol";
import { confirmOutbox, flushOutbox, newOutboxEntry, outboxAt, pendingTail, pendingUserEntry, reconcileOutbox, sendRowKey, timelineRowKey, visiblePendingSteers, visibleQueue, type OutboxEntry } from "../src/renderer/src/lib/legacyDelivery/outbox";
import { newPendingSteer, recordedSteers, resolveChecked, settlePendingSteers, type PendingSteer } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { emptyTimeline, applyEvent, settleStaleTurns } from "../src/renderer/src/lib/timeline";
import { turnGroups } from "../src/renderer/src/lib/legacyDelivery/admissionOrder";
import { pausedSection } from "../src/renderer/src/lib/queuePause";
import observed from "./fixtures/r271-insert-stage-metadata.json";
import { beginQueueInsert, DELIVERED_FEEDBACK_MS, finishQueueInsert, reconcileQueueInsert, useQueueInsertFeedback, type QueueInsertState } from "../src/renderer/src/lib/queueInsertFeedback";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuAt: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => {
    try { return select({}); } catch { return false; }
  }, { getState: () => ({}) }),
  selectedFeatures: () => new Set(), agentHost: () => "local", featuresOf: () => new Set(), hostApi: () => ({}),
  queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map(p => p.text ?? "").join(""),
}));
const { QueuePanel } = await import("../src/renderer/src/components/QueuePanel");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = "2026-10-31T13:26:30Z";
const cid = "one-logical-insert";
const text = "owner insert";
const queued: QueueItem = { queueId: "queue-one", clientUserMessageId: cid, origin: { kind: "other", clientId: "desktop" } as never,
  input: [{ type: "text", text }], position: 1, revision: 1, state: "queued", createdAt: at, updatedAt: at };
const native = (method: string, params: Record<string, unknown>) => ({ native: { kind: "notification", message: { method, params: { threadId: "thread", ...params } } } }) as never;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let timeline: ReturnType<typeof emptyTimeline>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T13:27:00Z"));
  useQueueInsertFeedback.setState({ byView: {} });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  timeline = emptyTimeline();
  timeline.threadId = "thread";
  applyEvent(timeline, native("turn/started", { turn: { id: "turn", status: "inProgress", items: [] } }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

function project({ outbox = [], queue = [], hidden = [], steers = [], nextStep = [], onRecheck, withOrder = true }: {
  outbox?: OutboxEntry[]; queue?: QueueItem[]; hidden?: string[]; steers?: PendingSteer[]; nextStep?: AdmissionNextStep[];
  onRecheck?: (id: string) => void; withOrder?: boolean;
} = {}) {
  steers = visiblePendingSteers(outbox, steers, timeline);
  const items = visibleQueue(queue, hidden, outbox, timeline);
  const groups = turnGroups({ revision: 1, items: queue.map(q => ({ kind: "owner", id: q.queueId, position: q.position, state: "waiting", enqueuedAt: q.createdAt })), nextStep }, items, {});
  act(() => root.render(h(QueuePanel, {
    sessionId: "replay", runtime: "claude", items, steers,
    sendingSteers: outboxAt(outbox, "steer"), sendingQueue: outboxAt(outbox, "queue"),
    timelineSends: outboxAt(outbox, "turn"),
    outbox: { onRetry() {}, onEdit() {}, onDiscard() {} }, onInterruptSendSteers() {}, onDismissSteer() {}, onRecheckSteer: onRecheck,
    paused: pausedSection(steers, items, null), onResumePaused() {}, onRestorePaused() {}, onClearPaused() {},
    canEdit: true, onEdit() {}, onDelete() {}, running: true,
    ordered: withOrder ? { ...groups, running: true, runningSince: null, currentTurn: { kind: "owner" }, mayPass: true, onMove() {}, sessionId: "replay" } : undefined,
  })));
  return {
    rows: host.querySelectorAll('[data-testid="queue-item"], [data-testid="boundary-steer"], [data-testid="undelivered-steer"], [data-testid="outbox-sending"], [data-testid="queue-next-step"], [data-testid="queue-insert-receipt"]'),
    count: host.querySelector('[data-testid="queue-count"]')?.textContent,
    groups,
  };
}

describe("queued insert projection replay", () => {
  it.each([[false, false], [false, true], [true, false], [true, true]])("a history check only retries reading (failed=%s, ordered=%s)", (checkFailed, withOrder) => {
    const onRecheck = vi.fn();
    const p = { ...newPendingSteer(timeline, cid, text, 0, "turn"), state: "checking" as const, checkFailed };
    const token = beginQueueInsert("local", "replay", queued)!;
    act(() => finishQueueInsert("local", "replay", token, "inserted"));
    const visible = project({ steers: [p], onRecheck, withOrder });
    expect(visible.count).toBe("1");
    expect(host.querySelectorAll('[data-testid="steer-check-status"]')).toHaveLength(1);
    if (withOrder) expect(visible.rows).toHaveLength(1);
    expect(host.textContent).toContain(checkFailed ? "queue.insert.unknown" : "queue.insert.checking");
    expect(host.textContent).not.toContain("queue.insertedToast");
    expect(host.querySelector('[data-testid="boundary-interrupt-send"]')).toBeNull();
    expect(host.textContent).not.toContain("steer.interruptSend");
    const retry = host.querySelector<HTMLButtonElement>('[data-testid="steer-recheck"]');
    if (checkFailed) { expect(retry?.textContent).toBe("steer.recheck"); act(() => retry!.click()); expect(onRecheck).toHaveBeenCalledExactlyOnceWith(cid); }
    else expect(retry).toBeNull();
  });
  it("keeps a queue insert sent under another ID in one row with its operation receipt", () => {
    const token = beginQueueInsert("local", "replay", queued)!;
    act(() => finishQueueInsert("local", "replay", token, "inserted", undefined, "actual-sent-id"));
    const view = project({ steers: [newPendingSteer(timeline, "actual-sent-id", text, 0, "turn")] });
    expect(view.rows).toHaveLength(1);
    expect(view.count).toBe("1");
    expect(host.querySelector('[data-testid="queue-insert-receipt"]')).toBeNull();
    expect(host.querySelector('[data-testid="boundary-steer"]')?.textContent).toContain("queue.insertedToast");
  });
  it.each(["steered", "started-event-before-queued-reply"])("idle owner stays in timeline without a queue flash: %s", disposition => {
    const id = "owner-idle";
    let outbox = [newOutboxEntry(timeline, { id, text, strategy: "auto", placement: "turn" })];
    const key = sendRowKey(id);
    const assertTimeline = (steers: PendingSteer[] = []) => {
      expect(project({ outbox, steers }).rows).toHaveLength(0);
      expect(pendingTail(outbox, timeline).map(e => timelineRowKey(pendingUserEntry(e)))).toEqual([key]);
    };
    assertTimeline();
    // A notification/agent message starts the real turn after the owner clicked.
    applyEvent(timeline, native("turn/started", { turn: { id: "notification-turn", status: "inProgress", items: [] } }));
    let steers: PendingSteer[] = [];
    if (disposition === "steered") {
      outbox = confirmOutbox(outbox, id, { disposition: "steered", turnId: "notification-turn" } as never, 1);
      steers = [newPendingSteer(timeline, id, text, 0, "notification-turn")];
    } else {
      outbox = flushOutbox(outbox, timeline, { clientUserMessageId: id, disposition: "started", turnId: "notification-turn" }, 1);
      outbox = confirmOutbox(outbox, id, { disposition: "queued", queue: { ...queued, clientUserMessageId: id } } as never, 2);
    }
    assertTimeline(steers);
    applyEvent(timeline, native("item/completed", { turnId: "notification-turn", item: { type: "userMessage", id: "owner-native", clientId: id, content: [{ type: "text", text, text_elements: [] }] } }));
    expect(pendingTail(outbox, timeline)).toEqual([]);
    expect(timelineRowKey(timeline.entries.get("owner-native")!)).toBe(key);
    expect(project({ outbox, steers }).rows).toHaveLength(0);
    outbox = reconcileOutbox(outbox, timeline, []);
    expect(project({ outbox, steers }).rows).toHaveLength(0);
  });

  it("queueSendNow source order: false checking/undelivered plus stale queue echo and attached feedback remain one logical row", () => {
    // Source sequence in store.queueSendNow: begin feedback, retain queue while
    // waiting, hide queued ID on steered reply, finish feedback, trackSteer.
    // It constructs a probe/outbox entry but installs no optimistic row for steered.
    const token = beginQueueInsert("local", "replay", queued)!;
    expect(project({ queue: [queued] }).rows).toHaveLength(1);
    const hidden = [queued.queueId];
    finishQueueInsert("local", "replay", token, "inserted", undefined, cid);
    expect(project({ queue: [queued], hidden }).rows).toHaveLength(1); // operation receipt before trackSteer
    let steers = [newPendingSteer(timeline, cid, text, 0, "turn")];
    expect(project({ queue: [queued], hidden, steers }).rows).toHaveLength(1);
    settleStaleTurns(timeline, null); // controlled old-generation failure, never journal evidence
    steers = settlePendingSteers(steers, timeline, { carriesUnread: true }).pending;
    expect(steers[0]?.state).toBe("checking");
    expect(project({ queue: [queued], hidden, steers }).rows).toHaveLength(1);
    steers = resolveChecked(steers, new Set([cid]), new Set(), "undelivered");
    expect(project({ queue: [queued], hidden, steers }).rows).toHaveLength(1);
    expect(host.querySelector('[data-testid="queue-insert-receipt"]')).toBeNull();
    applyEvent(timeline, native("claude/input/stageChanged", { clientId: cid, turnId: "turn", stage: "contextPersisted" }));
    const recorded = recordedSteers(steers, timeline);
    steers = settlePendingSteers(steers, timeline, { carriesUnread: true }).pending;
    act(() => reconcileQueueInsert("local", "replay", id => recorded.has(id)));
    expect(project({ queue: [queued], hidden, steers }).rows).toHaveLength(1); // one delivered receipt, not another send
    expect(host.querySelectorAll('[data-testid="queue-insert-receipt"]')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(DELIVERED_FEEDBACK_MS));
    expect(project({ queue: [queued], hidden, steers }).rows).toHaveLength(0);
  });

  it("a controlled false stale-turn settlement changes one steer to checking/undelivered without making three owner copies", () => {
    const token = beginQueueInsert("local", "replay", queued)!;
    finishQueueInsert("local", "replay", token, "inserted");
    let steers = [newPendingSteer(timeline, cid, text, 0, "turn")];
    expect(project({ steers }).rows).toHaveLength(1);
    // Controlled old-generation failure injection, NOT extracted runtime evidence.
    // This is the call removed from generation-only reconciliation by the parent.
    settleStaleTurns(timeline, null);
    steers = settlePendingSteers(steers, timeline, { carriesUnread: true }).pending;
    expect(steers[0]?.state).toBe("checking");
    expect(project({ steers }).rows).toHaveLength(1);
    expect(host.querySelector('[data-testid="queue-insert-receipt"]')).toBeNull();
    steers = resolveChecked(steers, new Set([cid]), new Set(), "undelivered");
    expect(project({ steers }).rows).toHaveLength(1);
    expect(host.querySelectorAll('[data-testid="undelivered-steer"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="queue-insert-receipt"]')).toBeNull();
    // A paused heading is extra geometry, not an extra logical owner input.
    expect(host.querySelector('[data-testid="paused-section"]')).not.toBeNull(); // registry 1.8 legacyPausedQueue heading
  });

  for (const state of ["checking", "undelivered"] as const) {
    for (const placement of ["steer", "queue", "turn"] as const) {
      for (const feedbackState of ["requesting", "inserted", "unknown"] as QueueInsertState[]) {
        it(`diagnostic overlap (reachability unproved): ${state}, optimistic ${placement}, queue echo, ${feedbackState} feedback`, () => {
          // Deliberately force all supplied inputs to share one client ID. This
          // characterizes source composition; it does NOT claim store can produce it.
          const token = beginQueueInsert("local", "replay", queued)!;
          finishQueueInsert("local", "replay", token, feedbackState, undefined, cid, undefined, { checking: feedbackState === "unknown" });
          const steers = [{ ...newPendingSteer(timeline, cid, text, 0, "turn"), state }];
          const outbox = [newOutboxEntry(timeline, { id: cid, text, strategy: "auto", placement, promoted: true })];
          const view = project({ steers, outbox, queue: [queued] });
          // visibleQueue hides the original for steer/turn placement. Queue
          // placement preserves it; feedback attaches rather than adding a fourth.
          expect(view.rows).toHaveLength(placement === "queue" ? 3 : placement === "steer" ? 2 : 0);
          expect(view.count ?? "0").toBe(String(view.rows.length));
          expect(host.querySelector('[data-testid="queue-insert-receipt"]')).toBeNull();
          expect(pendingTail(outbox, timeline)).toHaveLength(placement === "turn" ? 1 : 0);
          // The promoted original is intentionally not delivery evidence: merely
          // reconciling a stale list cannot erase the in-flight operation.
          expect(reconcileOutbox(outbox, timeline, [queued])).toEqual(outbox);
        });
      }
    }
  }

  it("observed 3587–3687: three independent IDs, three persistence receipts, successful turn", () => {
    // Metadata-only extract of the target journal; no message/tool content.
    // Run actual parent-owned reducers, including native persistence receipts.
    // Registration represents the accepted steer; there is no text deduplication.
    let steers: PendingSteer[] = [];
    timeline = emptyTimeline();
    timeline.threadId = "thread";
    const counts: number[] = [];
    const seen = new Set<string>();
    for (const event of observed) {
      if (!event.stage) {
        applyEvent(timeline, native(event.method, { turn: { id: event.turnId, status: event.turnStatus, items: [] } }));
        continue;
      }
      expect(event.clientId).toBeTruthy();
      if (event.stage === "registered") {
        seen.add(event.clientId!);
        steers.push(newPendingSteer(timeline, event.clientId!, text, 0, event.turnId!));
      }
      applyEvent(timeline, native(event.method, { clientId: event.clientId, turnId: event.turnId, stage: event.stage }));
      steers = settlePendingSteers(steers, timeline, { carriesUnread: true }).pending;
      const view = project({ steers });
      counts.push(view.rows.length);
      expect(view.count ?? "0").toBe(String(steers.length));
    }
    expect(seen.size).toBe(3);
    expect(counts).toEqual([1, 1, 2, 2, 3, 3, 2, 1, 0]);
    expect(observed.at(-1)).toMatchObject({ sourceLine: 3687, method: "turn/completed", turnStatus: "completed" });
    expect(observed.filter(e => e.turnStatus === "interrupted" || e.turnStatus === "failed")).toEqual([]);
    expect(settlePendingSteers(steers, timeline, { carriesUnread: true }).pending).toEqual([]);
    expect(project({ steers }).rows).toHaveLength(0);
  });

  it("one owner ID: optimistic -> held snapshot -> queued -> registered/offered snapshots -> persisted terminal", () => {
    let outbox = [newOutboxEntry(timeline, { id: cid, text, strategy: "auto", placement: "steer", promoted: true })];
    const assertOne = (snapshot: Parameters<typeof project>[0]) => {
      const view = project(snapshot);
      expect(view.rows).toHaveLength(1);
      expect(view.count).toBe("1");
      expect(view.groups.nextStep).toEqual([]);
    };
    assertOne({ outbox, queue: [queued] }); // promotion's original queue copy is hidden by client ID
    // Held admission is NOT an AdmissionNextStep: while its outcome is pending,
    // the store supplies the original optimistic send, never a second held row.
    assertOne({ outbox, queue: [queued] });
    outbox = confirmOutbox(outbox, cid, { clientUserMessageId: cid, disposition: "queued", queue: queued } as never, 1);
    assertOne({ outbox }); // confirmed queue item before queue/list arrives
    assertOne({ outbox, queue: [queued] }); // the list and confirmed echo share clientUserMessageId
    outbox = confirmOutbox(outbox, cid, { clientUserMessageId: cid, disposition: "steered", turnId: "turn" } as never, 2);
    let steers = [newPendingSteer(timeline, cid, text, 0, "turn")];
    for (const stage of ["registered", "offered"]) {
      applyEvent(timeline, native("claude/input/stageChanged", { clientId: cid, turnId: "turn", stage }));
      steers = settlePendingSteers(steers, timeline, { carriesUnread: true }).pending;
      assertOne({ outbox, queue: [queued], hidden: [queued.queueId], steers });
      expect(host.querySelectorAll('[data-testid="boundary-steer"]'), stage).toHaveLength(1);
    }
    applyEvent(timeline, native("claude/input/stageChanged", { clientId: cid, turnId: "turn", stage: "contextPersisted" }));
    steers = settlePendingSteers(steers, timeline, { carriesUnread: true }).pending;
    expect(steers).toEqual([]);
    const terminal = project({ outbox, queue: [queued], hidden: [queued.queueId], steers });
    expect(terminal.rows).toHaveLength(0);
    expect(host.querySelector('[data-testid="queue-tray"]')).toBeNull();
  });

  it("a held bus delivery with matching text is a separate input, not another owner representation", () => {
    const outbox = [newOutboxEntry(timeline, { id: cid, text, strategy: "auto", placement: "steer" })];
    const view = project({ outbox, nextStep: [{ id: "bus-id", deliveryKind: "tell", preview: text, held: "ownerStop", enqueuedAt: at }] });
    expect(view.rows).toHaveLength(2);
    expect(view.count).toBe("2");
    expect(host.querySelectorAll('[data-testid="group-held-stop"]')).toHaveLength(1);
  });

  it("three distinct client IDs remain three rows even with identical text, until individually settled", () => {
    let steers = ["a", "b", "c"].map(id => newPendingSteer(timeline, id, text, 0, "turn"));
    expect(project({ steers }).rows).toHaveLength(3);
    for (const expected of [2, 1, 0]) {
      steers = steers.slice(1); // store supplies terminal settlement of exactly one ID
      expect(project({ steers }).rows).toHaveLength(expected);
    }
  });

  it("matching one client ID cannot merge away the other two owner rows", () => {
    const steers = ["a", "b", "c"].map(id => newPendingSteer(timeline, id, text, 0, "turn"));
    applyEvent(timeline, native("item/completed", { turnId: "turn", item: { id: "native-a", type: "userMessage", clientId: "a", content: [{ type: "text", text: `${text}\n\n${text}\n\n${text}`, text_elements: [] }] } }));
    expect([...recordedSteers(steers, timeline)]).toEqual(["a"]);
    expect(project({ steers: steers.filter(p => !recordedSteers(steers, timeline).has(p.id)) }).rows).toHaveLength(2);
  });

  it("actual merged untagged history needs ordered content evidence before multiple rows leave", () => {
    const steers = ["first", "second", "third"].map((s, i) => newPendingSteer(timeline, `m${i}`, s, 0, "turn"));
    expect(recordedSteers(steers, timeline).size).toBe(0);
    applyEvent(timeline, native("item/completed", { turnId: "turn", item: { id: "native-merged", type: "userMessage", content: [{ type: "text", text: "first\n\nsecond\n\nthird", text_elements: [] }] } }));
    expect([...recordedSteers(steers, timeline)]).toEqual(["m0", "m1", "m2"]);
    expect(project({ steers: steers.filter(p => !recordedSteers(steers, timeline).has(p.id)) }).rows).toHaveLength(0);
  });
});
