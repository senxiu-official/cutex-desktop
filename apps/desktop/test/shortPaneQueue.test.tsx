// @vitest-environment jsdom
// Short pane through the real QueuePanel (lib/shortPane, owner 2026-10-26 option B): folded by the pane, the card is
// its header line and the list an overlay above it — the chevron opens it and moves the focus in, Esc closes it and
// gives the focus back to the header, a click elsewhere or Tab out closes it, a drag from it keeps it (and the fold)
// until the drag ends. The owner's own collapse / expand wins over the auto-fold.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmissionItem, QueueItem } from "@cutex-desktop/protocol";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn(), openMenuAt: vi.fn() }));
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
const { createShortPaneStore, ShortPaneContext } = await import("../src/renderer/src/lib/shortPane");
const { resetQueueViewCache, setQueueView } = await import("../src/renderer/src/lib/queueView");

const at = "2026-10-27T00:00:00Z";
const queued = (queueId: string): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input: [{ type: "text", text: `msg-${queueId}` }], position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const owner = (id: string, position: number): AdmissionItem => ({ kind: "owner", id, position, enqueuedAt: at, state: "waiting" });

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement;
let outside: HTMLButtonElement;
let store: ReturnType<typeof createShortPaneStore>;
/** What the pane's measurement answers on a recheck (Conversation's observer in the app). */
let paneShort = true;
let agent = "";

function mount() {
  const items = [queued("A"), queued("B"), queued("C")];
  const { turns, nextStep } = turnGroups({ revision: 1, items: items.map((q, i) => owner(q.queueId, i + 1)), nextStep: [] }, items, {});
  act(() =>
    root!.render(
      h(
        ShortPaneContext.Provider,
        { value: store },
        h(QueuePanel, {
          sessionId: agent,
          steers: [],
          outbox: { onRetry() {}, onEdit() {}, onDiscard() {} },
          onInterruptSendSteers() {},
          onDismissSteer() {},
          paused: { steers: [], items: [], count: 0 },
          onResumePaused() {},
          onRestorePaused() {},
          onClearPaused() {},
          items,
          canEdit: true,
          onEdit() {},
          onDelete() {},
          running: true,
          ordered: { turns, nextStep, running: true, runningSince: null, currentTurn: { kind: "owner" }, mayPass: true, onMove() {}, onInsert() {}, sessionId: agent },
        }),
      ),
    ),
  );
}

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const tray = () => q('[data-testid="queue-tray"]')!;
const toggle = () => q('[data-testid="queue-collapse"]')!;
const overlay = () => q('[data-testid="queue-overlay"]');
const setFold = (v: boolean) => act(() => {
  paneShort = v;
  store.set(v);
});
const click = (el: Element) => act(() => void (el as HTMLElement).click());
async function frame() {
  await act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(null)))));
}
function fireDrag(el: Element, type: string) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { effectAllowed: "", dropEffect: "", setData() {}, getData: () => "" } });
  act(() => void el.dispatchEvent(ev));
}

beforeEach(() => {
  resetQueueViewCache();
  agent = `sp-${Math.random()}`;
  paneShort = true;
  store = createShortPaneStore();
  store.onRecheck = () => store.set(paneShort);
  host = document.createElement("div");
  outside = document.createElement("button");
  document.body.append(host, outside);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  outside.remove();
});

describe("short pane: the auto-fold", () => {
  it("folds to the header line at short heights: the list is a closed overlay (hidden, out of the Tab order)", () => {
    mount();
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    setFold(true);
    expect(tray().hasAttribute("data-short-fold")).toBe(true);
    expect(tray().hasAttribute("data-collapsed")).toBe(false);
    const list = overlay()!;
    expect(list.getAttribute("role")).toBe("dialog");
    expect(list.getAttribute("aria-hidden")).toBe("true");
    expect(list.className).toContain("invisible");
    expect(list.className).toContain("absolute");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-controls")).toBe(list.id);
    expect(toggle().getAttribute("aria-label")).toBe("queue.overlay.open");
  });
  it("unfolds when the pane is tall again: the list back in place", () => {
    mount();
    setFold(true);
    setFold(false);
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    expect(overlay()).toBeNull();
    expect(q("[data-queue-body]")!.className).not.toContain("absolute");
  });
});

describe("short pane: the overlay", () => {
  it("the chevron opens it and moves the focus into it; Esc closes it and gives the focus back to the chevron", async () => {
    mount();
    setFold(true);
    click(toggle());
    await frame();
    expect(tray().hasAttribute("data-overlay")).toBe(true);
    expect(overlay()!.getAttribute("aria-hidden")).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(overlay());
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    act(() => void overlay()!.dispatchEvent(esc));
    document.removeEventListener("keydown", seen);
    expect(tray().hasAttribute("data-overlay")).toBe(false);
    expect(document.activeElement).toBe(toggle());
    // Esc stays with the card (no stop / other Esc handler further up).
    expect(seen).not.toHaveBeenCalled();
  });
  it("a click elsewhere closes it; a click on its header line does not count as elsewhere", async () => {
    mount();
    setFold(true);
    click(toggle());
    await frame();
    act(() => void q('[data-testid="queue-header"]')!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(tray().hasAttribute("data-overlay")).toBe(true);
    act(() => void outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(tray().hasAttribute("data-overlay")).toBe(false);
  });
  it("focus leaving the card (Tab out) closes it", async () => {
    mount();
    setFold(true);
    click(toggle());
    await frame();
    act(() => outside.focus());
    expect(tray().hasAttribute("data-overlay")).toBe(false);
  });
  it("a drag from it keeps it open — through a click elsewhere and the pane growing — until the drag ends", async () => {
    mount();
    setFold(true);
    click(toggle());
    await frame();
    const grip = q('[data-testid="queue-drag-grip"]')!;
    expect(overlay()!.contains(grip)).toBe(true);
    fireDrag(grip, "dragstart");
    act(() => void outside.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    setFold(false);
    expect(tray().hasAttribute("data-short-fold")).toBe(true);
    expect(tray().hasAttribute("data-overlay")).toBe(true);
    fireDrag(grip, "dragend");
    // Over: the pane has room now, the list goes back in place.
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    expect(tray().hasAttribute("data-overlay")).toBe(false);
  });
});

describe("short pane: a drag in place", () => {
  it("a drag started with the list in place keeps it in place when the pane turns short mid-drag; folds after", () => {
    mount();
    const grip = q('[data-testid="queue-drag-grip"]')!;
    fireDrag(grip, "dragstart");
    setFold(true);
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    expect(q("[data-queue-body]")!.className).not.toContain("absolute");
    fireDrag(grip, "dragend");
    expect(tray().hasAttribute("data-short-fold")).toBe(true);
  });
});

describe("short pane: the owner's choice wins", () => {
  it("a card the owner collapsed stays collapsed (the auto-fold never takes it)", () => {
    setQueueView(agent, { collapsed: true });
    mount();
    setFold(true);
    expect(tray().hasAttribute("data-collapsed")).toBe(true);
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    setFold(false);
    expect(tray().hasAttribute("data-collapsed")).toBe(true);
  });
  it("expanded by hand in a short pane it stays in place until the pane has room again, then the rule applies again", () => {
    setQueueView(agent, { collapsed: true });
    mount();
    setFold(true);
    click(toggle()); // the owner expands it
    expect(tray().hasAttribute("data-collapsed")).toBe(false);
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    expect(q("[data-queue-body]")!.className).not.toContain("absolute");
    // Still short on the next measurements: kept in place.
    setFold(false);
    setFold(true);
    expect(tray().hasAttribute("data-short-fold")).toBe(true);
  });
  it("kept in place while the pane stays short", () => {
    setQueueView(agent, { collapsed: true });
    mount();
    setFold(true);
    click(toggle());
    act(() => store.recheck());
    act(() => store.recheck());
    expect(tray().hasAttribute("data-short-fold")).toBe(false);
    expect(q("[data-queue-body]")).not.toBeNull();
  });
  it("expanded by hand in a tall pane: nothing held — the pane getting short later folds it", () => {
    setQueueView(agent, { collapsed: true });
    paneShort = false;
    mount();
    click(toggle());
    expect(tray().hasAttribute("data-collapsed")).toBe(false);
    setFold(true);
    expect(tray().hasAttribute("data-short-fold")).toBe(true);
  });
});
