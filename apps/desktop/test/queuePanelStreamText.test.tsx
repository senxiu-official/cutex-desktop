// @vitest-environment jsdom
// A streamed reply bumps its view's `version` together with `textVersion` once per frame (store.ts streamBumps). The
// queue tray reads nothing of that text: such a bump must neither re-render it nor make it read layout or rebuild its
// observer. Structural changes (a turn completing, rows coming) still update and measure it.
import { act, createElement as h, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionItem, AdmissionNextStep, QueueItem } from "@cutex-desktop/protocol";
import type { TimelineState } from "../src/renderer/src/lib/timeline";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: vi.fn(), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: { n?: number }) => vars?.n === undefined ? key : `${key}(${vars.n})` }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn(), openMenuAt: vi.fn() }));
vi.mock("../src/renderer/src/lib/cleanupNav", () => ({ openCleanup: vi.fn() }));
vi.mock("../src/renderer/src/lib/panelGuideMenu", () => ({ panelGuideItem: () => ({ label: "guide", onSelect: () => {} }) }));
vi.mock("../src/renderer/src/store", async () => {
  const { create } = await import("zustand");
  const features = new Set<string>();
  const useApp = create(() => ({ sessions: {} as Record<string, { timeline: TimelineState; version: number; textVersion?: number }>, selectedId: null, hosts: { active: "local" } }));
  return {
    useApp,
    viewOf: (s: ReturnType<typeof useApp.getState>, host: string, session: string) => s.sessions[`${host}\n${session}`],
    agentHost: () => "local", featuresOf: () => features, selectedFeatures: () => features,
    sidebarOf: () => null, hostApi: vi.fn(),
    queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map(part => part.text ?? "").join(""),
  };
});

import { QueuePanel } from "../src/renderer/src/components/QueuePanel";
import { turnGroups } from "../src/renderer/src/lib/legacyDelivery/admissionOrder";
import { ConversationScope } from "../src/renderer/src/lib/conversationScope";
import { resetQueueViewCache } from "../src/renderer/src/lib/queueView";
import { createShortPaneStore, ShortPaneContext, type ShortPaneStore } from "../src/renderer/src/lib/shortPane";
import { emptyTimeline } from "../src/renderer/src/lib/timeline";
import { useApp } from "../src/renderer/src/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = "2000-01-01T00:00:00Z";
const host = "host-A";
const receipt = (id: string): AdmissionNextStep => ({ id, deliveryKind: "bus", preview: "Claude Task finished", enqueuedAt: at, waitReason: "nativeReceipt" });
const ownerItem = (n: number): QueueItem => ({ queueId: `owner-${n}`, clientUserMessageId: `owner-client-${n}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `follow-up ${n}` }], position: n, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const noop = () => {};

// Counts what the tray costs: observers built, elements observed, and layout reads of its list.
const observers: { callback: ResizeObserverCallback; observed: Set<Element> }[] = [];
class CountingResizeObserver {
  observed = new Set<Element>();
  constructor(public callback: ResizeObserverCallback) { observers.push(this); }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.observed.clear(); }
}
let reads = 0;
const realScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let session: string;
let serial = 0;
let commits = 0;
let store: ShortPaneStore;
beforeEach(() => {
  session = `stream-text-${++serial}`;
  localStorage.clear();
  resetQueueViewCache();
  observers.length = 0;
  reads = 0;
  commits = 0;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = CountingResizeObserver;
  Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get() { if ((this as Element).hasAttribute("data-queue-body")) reads += 1; return realScrollHeight.get!.call(this); } });
  store = createShortPaneStore();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(Element.prototype, "scrollHeight", realScrollHeight);
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

function render(queued: number, nextStep: AdmissionNextStep[], extraSections = 0) {
  const queue = Array.from({ length: queued }, (_, i) => ownerItem(i));
  const entries: AdmissionItem[] = queue.map((item, i) => ({ id: item.queueId, kind: "owner", position: i + 1, state: "waiting", enqueuedAt: at }));
  const groups = turnGroups({ revision: 1, items: entries, nextStep }, queue, {});
  act(() => root.render(h(ConversationScope.Provider, { value: { paneId: "main", hostId: host, sessionId: session, focused: true, visible: true } },
    h(ShortPaneContext.Provider, { value: store },
      h(Profiler, { id: "tray", onRender: () => { commits += 1; } }, h(QueuePanel, {
        hostId: host, sessionId: session,
        steers: [], outbox: { onRetry: noop, onEdit: noop, onDiscard: noop }, onInterruptSendSteers: noop, onDismissSteer: noop,
        paused: { steers: [], items: [], count: 0 }, onResumePaused: noop, onRestorePaused: noop, onClearPaused: noop,
        items: queue, canEdit: true, onEdit: noop, onDelete: noop,
        sections: Array.from({ length: extraSections }, (_, i) => ({ node: h("p", null, `extra ${i}`) })),
        ordered: { ...groups, running: true, runningSince: null, currentTurn: null, mayPass: true, onMove: noop, onInsert: noop, sessionId: session },
      }))))));
}
function putView(timeline: TimelineState, version: number, textVersion = 0) {
  act(() => useApp.setState(state => ({ sessions: { ...state.sessions, [`${host}\n${session}`]: { timeline, version, textVersion } as never } })));
}
const queueBody = () => container.querySelector<HTMLElement>("[data-queue-body]");

describe("QueuePanel while a reply streams", () => {
  it("a text-only version bump neither re-renders the tray nor measures it", () => {
    const timeline = emptyTimeline();
    putView(timeline, 1);
    render(2, [receipt("ctask-1")]);
    expect(queueBody()).not.toBeNull();
    expect(observers).toHaveLength(1);
    const watched = observers[0]!.observed.size;
    expect(watched).toBeGreaterThan(1); // the list and its rows
    const before = { commits, reads };
    // Thirty streamed frames: the timeline is mutated in place, each frame bumps version and textVersion together.
    for (let i = 1; i <= 30; i += 1) putView(timeline, 1 + i, i);
    expect(commits).toBe(before.commits);
    expect(reads).toBe(before.reads);
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed.size).toBe(watched);
  });

  it("a re-render without a size change reads no layout and keeps its one observer", () => {
    const timeline = emptyTimeline();
    putView(timeline, 1);
    render(2, [receipt("ctask-1")]);
    const before = reads;
    // A structural bump (not text): the tray may re-render, but its rows are the same — nothing to measure.
    putView(timeline, 2, 0);
    render(2, [receipt("ctask-1")]);
    expect(reads).toBe(before);
    expect(observers).toHaveLength(1);
  });

  it("measures again when its groups come or go, when its observer reports a size change, and on remount", () => {
    putView(emptyTimeline(), 1);
    render(1, []);
    const first = reads;
    expect(first).toBeGreaterThan(0); // measured once on mount
    // More rows in the same group: that group's size changes, which its observer reports (below), not the render.
    render(3, []);
    expect(reads).toBe(first);
    // A new group (a direct child of the list) is observed and measured in the same commit.
    const watched = observers[0]!.observed.size;
    render(3, [], 1);
    expect(observers[0]!.observed.size).toBe(watched + 1);
    expect(reads).toBe(first + 1);
    render(3, [], 0);
    expect(observers[0]!.observed.size).toBe(watched);
    expect(reads).toBe(first + 2);
    const afterRows = reads;
    const ro = observers[0]!;
    act(() => ro.callback([], ro as unknown as ResizeObserver));
    expect(reads).toBe(afterRows + 1);
    render(0, []);
    expect(queueBody()).toBeNull();
    render(1, []);
    expect(observers).toHaveLength(2);
    expect(observers[0]!.observed.size).toBe(0); // the old list's observer was disconnected
  });

  it("folded by the short pane, a size change of its list asks the pane to measure again", () => {
    putView(emptyTimeline(), 1);
    act(() => store.set(true));
    render(2, []);
    const recheck = vi.fn();
    store.onRecheck = recheck;
    expect(container.querySelector("[data-short-fold]")).not.toBeNull();
    const ro = observers.at(-1)!;
    act(() => ro.callback([], ro as unknown as ResizeObserver));
    expect(recheck).toHaveBeenCalledTimes(1);
  });
});
