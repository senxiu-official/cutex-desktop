// @vitest-environment jsdom
// Exercise the real QueuePanel + TurnQueue + receipt projection together. The app
// store stand-in uses Zustand subscriptions, including the real in-place timeline contract.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestReceiptState } from "./receiptVisibilityStorage";
import type { AdmissionItem, AdmissionNextStep, QueueItem } from "@cutex-desktop/protocol";
import type { TimelineState } from "../src/renderer/src/lib/timeline";

const transport = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: transport.call, bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: { n?: number }) => vars?.n === undefined ? key : `${key}(${vars.n})` }) }));
const menu = vi.hoisted(() => ({ openMenuAt: vi.fn(), openCleanup: vi.fn() }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn(), openMenuAt: menu.openMenuAt }));
vi.mock("../src/renderer/src/lib/cleanupNav", () => ({ openCleanup: menu.openCleanup }));
vi.mock("../src/renderer/src/lib/panelGuideMenu", () => ({ panelGuideItem: () => ({ label: "guide", onSelect: () => {} }) }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const features = new Set<string>();
  const useApp = create(() => ({ sessions: {} as Record<string, { timeline: TimelineState; version: number }>, selectedId: null, hosts: { active: "local" } }));
  return {
    useApp,
    viewOf: (s: ReturnType<typeof useApp.getState>, host: string, session: string) => s.sessions[`${host}\n${session}`],
    agentHost: () => "local", featuresOf: () => features, selectedFeatures: () => features,
    sidebarOf: () => null, hostApi: transport.call,
    queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map(part => part.text ?? "").join(""),
  };
});

import { QueuePanel } from "../src/renderer/src/components/QueuePanel";
import { turnGroups } from "../src/renderer/src/lib/legacyDelivery/admissionOrder";
import { ConversationScope } from "../src/renderer/src/lib/conversationScope";
import { dismissReceipt, restoreReceipt } from "../src/renderer/src/lib/legacyDelivery/busReceiptVisibility";
import { resetQueueViewCache, setQueueView } from "../src/renderer/src/lib/queueView";
import { applyEvent, emptyTimeline } from "../src/renderer/src/lib/timeline";
import { useApp } from "../src/renderer/src/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = "2000-01-01T00:00:00Z";
const receipt = (id: string): AdmissionNextStep => ({ id, deliveryKind: "bus", preview: "Claude Task finished", enqueuedAt: at, waitReason: "nativeReceipt" });
const ownerItem = (): QueueItem => ({ queueId: "owner", clientUserMessageId: "owner-client", origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: "owner follow-up" }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const noop = () => {};
const native = (method: string, params: Record<string, unknown>) => ({ native: { kind: "notification", message: { method, params: { threadId: "thread", ...params } } } }) as never;

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let session: string;
let serial = 0;
beforeEach(() => {
  session = `panel-receipt-${++serial}`;
  localStorage.clear();
  resetQueueViewCache();
  useApp.setState({ sessions: {} });
  transport.call.mockClear();
  menu.openMenuAt.mockClear();
  menu.openCleanup.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render(items: AdmissionNextStep[], options: { host?: string; sid?: string; queued?: boolean; omitSessionProp?: boolean } = {}) {
  const host = options.host ?? "host-A";
  const sid = options.sid ?? session;
  const queue = options.queued ? [ownerItem()] : [];
  const entries: AdmissionItem[] = options.queued ? [{ id: "owner", kind: "owner", position: 1, state: "waiting", enqueuedAt: at }] : [];
  const groups = turnGroups({ revision: 1, items: entries, nextStep: items }, queue, {});
  act(() => root.render(h(ConversationScope.Provider, { value: { paneId: "main", hostId: host, sessionId: sid, focused: true, visible: true } }, h(QueuePanel, {
    hostId: host, sessionId: options.omitSessionProp ? undefined : sid,
    steers: [], outbox: { onRetry: noop, onEdit: noop, onDiscard: noop }, onInterruptSendSteers: noop, onDismissSteer: noop,
    paused: { steers: [], items: [], count: 0 }, onResumePaused: noop, onRestorePaused: noop, onClearPaused: noop,
    items: queue, canEdit: true, onEdit: noop, onDelete: noop,
    ordered: { ...groups, running: false, runningSince: null, currentTurn: null, mayPass: true, onMove: noop, onInsert: noop, sessionId: sid },
  }))));
}
const query = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const count = () => query("queue-count")?.textContent;
const rows = () => container.querySelectorAll('[data-testid="queue-next-step"]');
const click = (id: string) => {
  if (id === "hide-native-receipt") {
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="hide-native-receipt"]')!.click());
  } else act(() => query(id)!.click());
};
function putTimeline(host: string, sid: string, timeline: TimelineState, version: number) {
  act(() => useApp.setState(state => ({ sessions: { ...state.sessions, [`${host}\n${sid}`]: { timeline, version } as never } })));
}
function inputHistory(id: string, status: "failed" | "inProgress" | "completed"): TimelineState {
  const timeline = emptyTimeline();
  applyEvent(timeline, native("turn/started", { turn: { id: "input-turn", status: "inProgress", items: [], startedAt: 1 } }));
  const item = { type: "functionCallOutput", id, name: "external_event", namespace: "external", output: JSON.stringify({ source: { kind: "service", id: "Claude Task" }, type: "claude_task", text: "Task ended" }), externalInputView: null };
  applyEvent(timeline, native("item/completed", { turnId: "input-turn", item }));
  if (status !== "inProgress") applyEvent(timeline, native("turn/completed", { turn: { id: "input-turn", status, items: [], completedAt: 2 } }));
  expect(timeline.entries.get(id)?.kind).toBe("received");
  return timeline;
}

describe("QueuePanel local receipt projection", () => {
  it("hiding the only row removes the whole strip (no 已隐藏 row); the hide stays recorded for 待清理", () => {
    render([receipt("last")], { omitSessionProp: true });
    expect(count()).toBe("1");
    expect(rows()).toHaveLength(1);
    click("hide-native-receipt");
    expect(rows()).toHaveLength(0);
    expect(query("queue-count")).toBeNull();
    expect(query("queue-header")).toBeNull();
    expect(container.textContent).toBe("");
    expect(latestReceiptState("host-A", session, "last")).toBe("hidden");
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("unhiding brings the strip back with the row", () => {
    render([receipt("back")]);
    click("hide-native-receipt");
    expect(query("queue-header")).toBeNull();
    act(() => restoreReceipt("host-A", session, "back"));
    expect(query("queue-header")).not.toBeNull();
    expect(rows()).toHaveLength(1);
    expect(count()).toBe("1");
  });

  it("with other rows visible, hidden ones are not listed in the strip; its menu links to 待清理", () => {
    const a = receipt("A"), b = receipt("B");
    render([a, b]);
    act(() => dismissReceipt("host-A", session, a));
    expect(rows()).toHaveLength(1);
    expect(container.textContent).not.toContain("queue.receipt.hidden");
    expect(query("hidden-bus-receipts")).toBeNull();
    act(() => query("queue-header")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 })));
    const entries = menu.openMenuAt.mock.calls.at(-1)![2] as ({ label: string; onSelect(): void } | false)[];
    const link = entries.find((e) => e && e.label === "queue.receipt.hiddenLink(1)");
    expect(link).toBeTruthy();
    (link as { onSelect(): void }).onSelect();
    expect(menu.openCleanup).toHaveBeenCalledWith("host-A", "receipts");
    // Nothing hidden: no link.
    act(() => restoreReceipt("host-A", session, "A"));
    act(() => query("queue-header")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 })));
    expect((menu.openMenuAt.mock.calls.at(-1)![2] as unknown[]).filter(Boolean)).toHaveLength(1);
  });

  it("recomputes compact chips and expanded counts while preserving other queued rows", () => {
    const a = receipt("A"), b = receipt("B");
    const alarm: AdmissionNextStep = { id: "alarm", deliveryKind: "alarm", preview: "keep alarm", enqueuedAt: at };
    const items = [a, b, alarm];
    setQueueView(session, { collapsed: true });
    render(items, { queued: true });
    expect(query("queue-chip-queued")?.textContent).toBe("queue.chip.queued(1)");
    expect(query("queue-chip-messages")?.textContent).toBe("queue.chip.messages(2)");
    expect(query("queue-chip-alarms")?.textContent).toBe("queue.chip.alarms(1)");
    act(() => dismissReceipt("host-A", session, a));
    expect(query("queue-chip-messages")?.textContent).toBe("queue.chip.messages(1)");
    act(() => dismissReceipt("host-A", session, b));
    expect(query("queue-chip-messages")).toBeNull();
    expect(query("queue-chip-queued")?.textContent).toBe("queue.chip.queued(1)");
    expect(query("queue-chip-alarms")?.textContent).toBe("queue.chip.alarms(1)");
    click("queue-collapse");
    expect(count()).toBe("2");
    expect(rows()).toHaveLength(1);
    expect(query("queue-item")?.textContent).toContain("owner follow-up");
    expect(query("ride-along-text")?.textContent).toBe("keep alarm");
    expect(query("hide-native-receipt")).toBeNull();
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("isolates the hidden panel by host and session, including the ordered.sessionId fallback", () => {
    const items = [receipt("shared-exact-id")];
    render(items, { omitSessionProp: true });
    click("hide-native-receipt");
    expect(query("queue-header")).toBeNull();
    expect(latestReceiptState("host-A", session, "shared-exact-id")).toBe("hidden");
    render(items, { host: "host-B", omitSessionProp: true });
    expect(count()).toBe("1");
    render(items, { sid: `${session}-other`, omitSessionProp: true });
    expect(count()).toBe("1");
    render(items, { omitSessionProp: true });
    expect(query("queue-header")).toBeNull();
  });

  it("does not consume a failed input after a later unrelated completed turn, but permits local hiding", () => {
    const timeline = inputHistory("failed-task", "failed");
    putTimeline("host-A", session, timeline, 1);
    render([receipt("failed-task")]);
    expect(count()).toBe("1");
    applyEvent(timeline, native("turn/started", { turn: { id: "unrelated", status: "inProgress", items: [], startedAt: 3 } }));
    applyEvent(timeline, native("turn/completed", { turn: { id: "unrelated", status: "completed", items: [], completedAt: 4 } }));
    putTimeline("host-A", session, timeline, 2);
    expect(count()).toBe("1");
    expect(rows()).toHaveLength(1);
    expect(localStorage.getItem("cutex-desktop.hiddenBusReceipts.v1:" + JSON.stringify(["host-A", session]))).toBeNull();
    click("hide-native-receipt");
    expect(latestReceiptState("host-A", session, "failed-task")).toBe("hidden");
    expect(query("queue-header")).toBeNull();
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("keeps an orphan received entry visible until the completed turn actually lists its ID", () => {
    const timeline = inputHistory("orphan", "completed");
    const turn = timeline.turns.find(turn => turn.id === "input-turn")!;
    turn.entryIds = [];
    putTimeline("host-A", session, timeline, 1);
    render([receipt("orphan")]);
    expect(count()).toBe("1");
    expect(rows()).toHaveLength(1);
    expect(localStorage.getItem("cutex-desktop.hiddenBusReceipts.v1:" + JSON.stringify(["host-A", session]))).toBeNull();
    // Membership arrives in-place, with the same timeline and completed turn.
    turn.entryIds.push("orphan");
    putTimeline("host-A", session, timeline, 2);
    expect(latestReceiptState("host-A", session, "orphan")).toBe("hidden");
    expect(query("queue-header")).toBeNull();
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("reacts to same-turn completion via version alone, persists consumption, and preserves a different ID", () => {
    const timeline = inputHistory("consumed", "inProgress");
    putTimeline("host-A", session, timeline, 1);
    const items = [receipt("consumed"), receipt("consumed-longer")];
    render(items);
    expect(count()).toBe("2");
    applyEvent(timeline, native("turn/completed", { turn: { id: "input-turn", status: "completed", items: [], completedAt: 2 } }));
    // No root.render and no replacement timeline/items: only the view version changes.
    putTimeline("host-A", session, timeline, 2);
    expect(count()).toBe("1");
    expect(rows()).toHaveLength(1);
    expect(latestReceiptState("host-A", session, "consumed")).toBe("hidden");
    putTimeline("host-A", session, emptyTimeline(), 3);
    expect(count()).toBe("1");
    act(() => root.render(null));
    render(items);
    expect(count()).toBe("1");
    render(items, { host: "host-B" });
    expect(count()).toBe("2");
    expect(transport.call).not.toHaveBeenCalled();
  });
});
