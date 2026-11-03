// @vitest-environment jsdom
// 「全部合并插入」 at the right of the queue card's header line (components/TurnQueue `slots.actions`, owner
// 2026-10-23): shown while a turn runs with ≥ 2 queued owner messages; it hands over every owner message in
// queue order, never a delegation turn.
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

const at = "2026-10-21T00:00:00Z";
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `msg-${queueId}` }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const owner = (id: string, position: number): AdmissionItem => ({ kind: "owner", id, position, enqueuedAt: at, state: "waiting" });
const ask = (id: string, position: number): AdmissionItem => ({ kind: "ask", id, position, enqueuedAt: at, state: "waiting" });

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let slots: { target: HTMLElement; actions: HTMLElement };
const onMergeInsert = vi.fn();

function mount(opts: { running?: boolean; owners?: string[]; askTurn?: boolean; merge?: boolean } = {}) {
  const running = opts.running ?? true;
  const owners = opts.owners ?? ["A", "B"];
  const items: AdmissionItem[] = [owner(owners[0]!, 1), ask("x1", 2), ...owners.slice(1).map((id, i) => owner(id, i + 3))];
  const { turns, nextStep } = turnGroups({ revision: 1, items, nextStep: [] }, owners.map(queued), {});
  act(() =>
    root!.render(
      h(TurnQueue, {
        ordered: { turns, nextStep, running, runningSince: null, currentTurn: running ? (opts.askTurn ? { kind: "ask", askId: "x0" } : { kind: "owner" }) : null, mayPass: true, onMove() {}, onInsert() {}, onMergeInsert: opts.merge === false ? undefined : onMergeInsert, sessionId: "s" } as never,
        waiting: [],
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
const button = () => host.querySelector<HTMLButtonElement>('[data-testid="queue-merge-insert"]');

beforeEach(() => {
  onMergeInsert.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  slots = { target: document.createElement("span"), actions: document.createElement("span") };
  host.append(slots.target, slots.actions);
  const app = document.createElement("div");
  host.appendChild(app);
  root = createRoot(app);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

describe("「全部合并插入」 button", () => {
  it("sits at the right of the header line and passes the owner messages in queue order (no delegation)", () => {
    mount({ owners: ["A", "B", "C"] });
    expect(button()?.parentElement).toBe(slots.actions);
    expect(button()!.textContent).toBe("queue.merge.action");
    act(() => button()!.click());
    expect(onMergeInsert).toHaveBeenCalledTimes(1);
    expect(onMergeInsert.mock.calls[0]![0].map((i: QueueItem) => i.queueId)).toEqual(["A", "B", "C"]);
  });

  it("hidden with one owner message, when idle, in a delegation's turn, or without the action", () => {
    mount({ owners: ["A"] });
    expect(button()).toBeNull();
    mount({ running: false });
    expect(button()).toBeNull();
    mount({ askTurn: true });
    expect(button()).toBeNull();
    mount({ merge: false });
    expect(button()).toBeNull();
  });
});

it("the additional queue rows disclose right/down and return to their original folded set", () => {
  mount({ owners: ["A", "B", "C", "D", "E", "F"] });
  const more = () => host.querySelector<HTMLButtonElement>('[data-testid="queue-more"]')!;
  const folded = host.querySelectorAll("[data-row]").length;
  expect(more().getAttribute("aria-expanded")).toBe("false");
  expect(more().parentElement!.querySelector(".lucide-chevron-right")).not.toBeNull();
  act(() => more().click());
  expect(more().getAttribute("aria-expanded")).toBe("true");
  expect(more().parentElement!.querySelector(".lucide-chevron-down")).not.toBeNull();
  expect(host.querySelectorAll("[data-row]").length).toBeGreaterThan(folded);
  act(() => more().click());
  expect(host.querySelectorAll("[data-row]").length).toBe(folded);
  expect(more().parentElement!.querySelector(".lucide-chevron-right")).not.toBeNull();
});
