// @vitest-environment jsdom
// Reordering never inserts by accident (owner 2026-10-21): the 「插入当前回合」 target is no row — while an
// owner row is dragged, the queue card's header line becomes it (owner 2026-10-23; an overlay in the header's
// slot, so no row moves), and a drop on it inserts only after the drag stayed on it INSERT_DWELL_MS
// (lib/insertTarget). Drops on the numbered turns — including the "before row 1" slot — only move.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionItem, QueueItem } from "@cutex-desktop/protocol";
vi.mock("../src/renderer/src/lib/modelOverloadRetryView", () => ({ useModelOverloadRetry: () => null }));

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: null }), subscribe: () => () => {} }, queueItemText: (item: QueueItem) => (item.input as { text: string }[]).map((p) => p.text).join("") }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TurnQueue } = await import("../src/renderer/src/components/TurnQueue");
const { turnGroups } = await import("../src/renderer/src/lib/legacyDelivery/admissionOrder");
const { INSERT_DWELL_MS, insertTargetShown, insertTargetState } = await import("../src/renderer/src/lib/insertTarget");

const at = "2026-10-21T00:00:00Z";
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `msg-${queueId}` }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const owner = (id: string, position: number): AdmissionItem => ({ kind: "owner", id, position, enqueuedAt: at, state: "waiting" });

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
/** QueuePanel's header slots (TurnQueue `slots`), inside `host` so the queries see them. */
let slots: { target: HTMLElement; actions: HTMLElement };
const onMove = vi.fn();
const onInsert = vi.fn();

function mount(opts: { running?: boolean; steer?: boolean } = {}) {
  const running = opts.running ?? true;
  const { turns, nextStep } = turnGroups({ revision: 1, items: [owner("A", 1), owner("B", 2)], nextStep: [] }, [queued("A"), queued("B")], {});
  act(() =>
    root!.render(
      h(TurnQueue, {
        ordered: { turns, nextStep, running, runningSince: null, currentTurn: running ? { kind: "owner" } : null, mayPass: true, onMove, onInsert, sessionId: "s" },
        waiting: opts.steer ? [{ id: "s1", text: "steer-text", imageCount: 0, turnId: "t1", baseline: 0, state: "waiting" }] : [],
        sendingSteers: [],
        sendingQueue: [],
        renderOutbox: () => null,
        onInterruptSendSteers() {},
        heldIds: new Set<string>(),
        paused: { controls: false, onResume() {}, onRestore() {} },
        itemRow: (item: QueueItem) => h("span", { "data-row": item.queueId }, `msg-${item.queueId}`),
        slots,
      }),
    ),
  );
}

const q = (sel: string) => host.querySelector<HTMLElement>(sel)!;
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const dataTransfer = () => ({ effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" });
function fire(el: Element, type: string, clientY = 0): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dataTransfer() });
  Object.defineProperty(ev, "clientY", { value: clientY });
  act(() => void el.dispatchEvent(ev));
  return ev;
}
const startDrag = (row: number) => fire(qa('[data-testid="queue-drag-grip"]')[row]!, "dragstart");

beforeEach(() => {
  vi.useFakeTimers();
  onMove.mockReset();
  onInsert.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  slots = { target: document.createElement("span"), actions: document.createElement("span") };
  slots.target.dataset.insertSlot = "";
  host.append(slots.target, slots.actions);
  const app = document.createElement("div");
  host.appendChild(app);
  root = createRoot(app);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
});

describe("insert target (lib/insertTarget)", () => {
  it("pure: shown only while dragging, a turn runs and there is an owner turn (refused shows during the drag); hold → armed", () => {
    expect(insertTargetShown(true, true, null, false)).toBe(false);
    expect(insertTargetShown(true, true, null, true)).toBe(true);
    expect(insertTargetShown(false, true, null, true)).toBe(false);
    expect(insertTargetShown(true, false, null, true)).toBe(false);
    expect(insertTargetShown(true, true, "askTurn", false)).toBe(false);
    expect(insertTargetShown(true, true, "askTurn", true)).toBe(true);
    expect(insertTargetState(false, true, null)).toBe("idle");
    expect(insertTargetState(true, false, null)).toBe("hold");
    expect(insertTargetState(true, true, null)).toBe("armed");
    expect(insertTargetState(true, false, "noSteer")).toBe("refused");
    expect(INSERT_DWELL_MS).toBeGreaterThanOrEqual(400);
  });

  it("no target row: starting a drag turns the header line into the target, and no row moves", () => {
    mount();
    const rows = () => host.querySelector('[data-testid="turn-frame"]')!.innerHTML.replace(/class="[^"]*"/g, "");
    expect(qa('[data-testid="insert-target"]')).toHaveLength(0);
    const before = rows();
    startDrag(1);
    const target = q('[data-testid="insert-target"]');
    expect(target.textContent).toBe("queue.turn.insertTargetIdle");
    // In the header's slot (an overlay on that line), not among the rows.
    expect(target.parentElement).toBe(slots.target);
    expect(rows()).toBe(before);
    fire(target, "dragend");
  });

  it("dragging row 2 into the top half of row 1 only moves it (no insert)", () => {
    mount();
    startDrag(1);
    const row1 = qa('[data-testid="turn-group-owner"]')[0]!;
    row1.getBoundingClientRect = () => ({ top: 100, height: 24, bottom: 124, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON() {} }) as DOMRect;
    expect(fire(row1, "dragover", 102).defaultPrevented).toBe(true);
    fire(row1, "drop", 102);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]![0].queueId).toBe("B");
    expect(onMove.mock.calls[0]![1]).toMatchObject({ kind: "owner", id: "A" });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("a quick drop on the target (before the dwell) does nothing: the drop is refused, no insert", () => {
    mount();
    startDrag(0);
    const target = q('[data-testid="insert-target"]');
    const over = fire(target, "dragover");
    expect(over.defaultPrevented).toBe(false); // not a drop target yet
    expect(target.dataset.state).toBe("hold");
    expect(target.textContent).toBe("queue.turn.insertTargetHold");
    act(() => void vi.advanceTimersByTime(INSERT_DWELL_MS - 100));
    fire(target, "drop");
    expect(onInsert).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it("passing over the target and leaving resets the dwell", () => {
    mount();
    startDrag(1);
    const target = q('[data-testid="insert-target"]');
    fire(target, "dragover");
    act(() => void vi.advanceTimersByTime(INSERT_DWELL_MS - 100));
    fire(target, "dragleave");
    act(() => void vi.advanceTimersByTime(200));
    expect(q('[data-testid="insert-target"]').dataset.state).toBe("idle");
    expect(q('[data-testid="insert-target"]').classList.contains("drop-tint")).toBe(false);
    fire(target, "dragover");
    act(() => void vi.advanceTimersByTime(INSERT_DWELL_MS - 100));
    expect(fire(target, "dragover").defaultPrevented).toBe(false);
    fire(target, "drop");
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("staying on the target arms it (松开 = 插入当前回合), then a drop inserts that row", () => {
    mount({ steer: true });
    startDrag(1);
    const target = q('[data-testid="insert-target"]');
    fire(target, "dragover");
    act(() => void vi.advanceTimersByTime(INSERT_DWELL_MS));
    expect(target.dataset.state).toBe("armed");
    expect(target.textContent).toBe("queue.turn.insertTargetArmed");
    // 拖放落点预览: the dashed outline always; the tint only through lib/dropTint (框线+底色), opaque over --surface.
    expect(target.className).toMatch(/border-dashed/);
    expect(target.classList.contains("drop-tint")).toBe(true);
    expect(target.className).not.toMatch(/bg-accent-soft|bg-danger-soft/);
    expect(target.style.getPropertyValue("--drop-tint")).toBe("color-mix(in srgb, var(--accent) 12%, var(--surface))");
    expect(fire(target, "dragover").defaultPrevented).toBe(true);
    fire(target, "drop");
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0]![0].queueId).toBe("B");
    expect(onMove).not.toHaveBeenCalled();
    // The drag ended: the header line is the header again.
    expect(qa('[data-testid="insert-target"]')).toHaveLength(0);
  });

  it("a drop on a waiting insert row (not the target) never inserts", () => {
    mount({ steer: true });
    startDrag(0);
    const steer = q('[data-testid="boundary-steer"]');
    expect(fire(steer, "dragover").defaultPrevented).toBe(false);
    act(() => void vi.advanceTimersByTime(INSERT_DWELL_MS * 2));
    fire(steer, "drop");
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("idle (no running turn): no insert target", () => {
    mount({ running: false });
    expect(qa('[data-testid="insert-target"]')).toHaveLength(0);
  });
});
