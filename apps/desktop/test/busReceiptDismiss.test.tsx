// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestReceiptState } from "./receiptVisibilityStorage";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";

const transport = vi.hoisted(() => ({ mutation: vi.fn(), host: "receipt-host" }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: transport.mutation, bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (state: unknown) => unknown) => select({ hosts: { active: transport.host } }), { getState: () => ({}) }),
  featuresOf: () => new Set(), selectedFeatures: () => new Set(), agentHost: () => transport.host,
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({ useAgentHost: () => transport.host, useAgentNames: () => (id: string) => id }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => 0, useNow: () => 0, formatWhen: () => "" }));
import { NextStepRow } from "../src/renderer/src/components/AdmissionRows";
import { dismissReceipt, isDismissibleReceipt, useHiddenReceiptIds } from "../src/renderer/src/lib/legacyDelivery/busReceiptVisibility";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const receipt = (id: string, patch: Partial<AdmissionNextStep> = {}): AdmissionNextStep => ({
  id, deliveryKind: "bus", label: "Claude Task background notification", enqueuedAt: "2000-01-01T00:00:00Z", waitReason: "nativeReceipt", ...patch,
});
const keyFor = (host: string, session: string) => "cutex-desktop.hiddenBusReceipts.v1:" + JSON.stringify([host, session]);
let sequence = 0;
let session: string;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  session = `session-${++sequence}`;
  localStorage.clear();
  transport.mutation.mockClear();
  transport.host = "receipt-host";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("accepted receipt eligibility", () => {
  it.each(["bus", "tell", "alarm"])("allows an explicitly accepted %s receipt", (deliveryKind) => {
    expect(isDismissibleReceipt(receipt("id", { deliveryKind }))).toBe(true);
  });
  it.each([
    { waitReason: undefined }, { waitReason: "resultCoalescing" }, { waitReason: "pending" },
    { deliveryKind: "answer" }, { deliveryKind: "question" }, { deliveryKind: "owner" },
    { deliveryKind: "ask" }, { deliveryKind: "delegation" }, { deliveryKind: "unknown" },
    { askId: "ask-1" }, { askId: "" }, { id: "" },
  ])("rejects unaccepted, owner and delegation rows: %j", (patch) => {
    const item = receipt("id", patch);
    expect(isDismissibleReceipt(item)).toBe(false);
    dismissReceipt(transport.host, session, item);
    expect(localStorage.length).toBe(0);
  });
});

describe("local receipt UI", () => {
  function Queue({ items, host = transport.host, sid = session }: { items: AdmissionNextStep[]; host?: string; sid?: string }) {
    const hidden = useHiddenReceiptIds(host, sid);
    // The lead applies this exact-ID filtering to QueuePanel; exercise its consumer contract here.
    return h("div", { onClick: transport.mutation }, items.filter((item) => !hidden.has(item.id)).map((item) => h(NextStepRow, { key: item.id, item, running: false, sessionId: sid, stuck: true })));
  }

  it("hides an ordinary Alice/Osprey note with accepted nativeReceipt and no settlement", () => {
    const item = receipt("ordinary-note", { deliveryKind: "tell", label: "Alice", from: "Alice", preview: "Please check the result", settlement: undefined });
    act(() => root.render(h(Queue, { items: [item] })));
    expect(container.textContent).toContain("Please check the result");
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="hide-native-receipt"]')!.click());
    expect(container.querySelector('[data-testid="queue-next-step"]')).toBeNull();
    expect(latestReceiptState(transport.host, session, "ordinary-note")).toBe("hidden");
    expect(transport.mutation).not.toHaveBeenCalled();
  });

  it("click hides only this ID, re-renders subscribers, persists across remounts and never mutates the bridge", () => {
    const first = Object.freeze(receipt("message-1"));
    const items = [first, receipt("message-10")];
    act(() => root.render(h(Queue, { items })));
    expect(container.querySelector('[data-testid="hide-native-receipt"]')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="menu.more"]')!;
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const button = document.querySelector<HTMLButtonElement>('[data-testid="hide-native-receipt"]')!;
    expect(button.textContent).toBe("queue.receipt.hide");
    expect(button.getAttribute("aria-label")).toBe("queue.receipt.hideHint");
    transport.mutation.mockClear();
    act(() => button.click());
    expect(container.querySelectorAll('[data-testid="queue-next-step"]')).toHaveLength(1);
    expect(latestReceiptState(transport.host, session, "message-1")).toBe("hidden");
    expect(first.waitReason).toBe("nativeReceipt");
    expect(first.settlement).toBeUndefined();
    expect(transport.mutation).not.toHaveBeenCalled();
    act(() => root.render(null));
    act(() => root.render(h(Queue, { items: items.map((item) => ({ ...item })) })));
    expect(container.querySelectorAll('[data-testid="queue-next-step"]')).toHaveLength(1);
    act(() => root.render(h(Queue, { items, host: "other-host" })));
    expect(container.querySelectorAll('[data-testid="queue-next-step"]')).toHaveLength(2);
    act(() => root.render(h(Queue, { items, sid: "other-session" })));
    expect(container.querySelectorAll('[data-testid="queue-next-step"]')).toHaveLength(2);
  });

  it("offers no local-hide button for an unaccepted item, delegation or missing session", () => {
    for (const [item, sid] of [[receipt("pending", { waitReason: undefined }), session], [receipt("ask", { askId: "ask-1" }), session], [receipt("no-session"), undefined]] as const) {
      act(() => root.render(h(NextStepRow, { item, running: false, sessionId: sid })));
      expect(container.querySelector('[data-testid="hide-native-receipt"]')).toBeNull();
    }
  });
});

describe("persistent snapshot contract", () => {
  it("loads exact persisted IDs, keeps snapshots stable, and has no age eviction", () => {
    localStorage.setItem(keyFor("persist-host", session), JSON.stringify(["Exact-ID", "Exact-ID-long", 42, null]));
    const snapshots: ReadonlySet<string>[] = [];
    function Probe() { snapshots.push(useHiddenReceiptIds("persist-host", session)); return null; }
    act(() => root.render(h(Probe)));
    expect([...snapshots[0]!]).toEqual(["Exact-ID", "Exact-ID-long"]);
    act(() => root.render(h(Probe)));
    expect(snapshots.at(-1)).toBe(snapshots[0]);
    expect(snapshots[0]!.has("exact-id")).toBe(false);
    expect(snapshots[0]!.has("Exact")).toBe(false);
    const before = snapshots.length;
    act(() => dismissReceipt("persist-host", session, receipt("Exact-ID")));
    expect(snapshots).toHaveLength(before);
    act(() => dismissReceipt("persist-host", session, receipt("new")));
    expect([...snapshots.at(-1)!]).toEqual(["Exact-ID", "Exact-ID-long", "new"]);
    expect([...snapshots[0]!]).toEqual(["Exact-ID", "Exact-ID-long"]);
  });

  it("survives unavailable storage in memory and ignores corrupt persisted data", () => {
    localStorage.setItem(keyFor("broken", session), "{bad json");
    let ids: ReadonlySet<string> = new Set();
    function Probe() { ids = useHiddenReceiptIds("broken", session); return h("span", null, [...ids].join(",")); }
    act(() => root.render(h(Probe)));
    expect(ids.size).toBe(0);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    act(() => dismissReceipt("broken", session, receipt("kept")));
    expect(container.textContent).toBe("kept");
    act(() => root.render(null));
    act(() => root.render(h(Probe)));
    expect(ids.has("kept")).toBe(true);
  });

  it("observes another window's dismissal without losing existing IDs or crossing scopes", () => {
    function Probe() { return h("span", null, [...useHiddenReceiptIds("windows", session)].join(",")); }
    act(() => root.render(h(Probe)));
    act(() => dismissReceipt("windows", session, receipt("mine")));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: keyFor("windows", session), newValue: '["theirs"]', storageArea: localStorage })));
    expect(container.textContent).toBe("mine,theirs");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: keyFor("windows", "another"), newValue: '["other"]', storageArea: localStorage })));
    expect(container.textContent).toBe("mine,theirs");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: keyFor("windows", session), newValue: null, storageArea: localStorage })));
    expect(container.textContent).toBe("mine,theirs");
    act(() => dismissReceipt("windows", session, receipt("last")));
    for (const id of ["mine", "theirs", "last"]) expect(latestReceiptState("windows", session, id)).toBe("hidden");
  });

  it("restores stored dismissals after a fresh module load", async () => {
    dismissReceipt("reload", session, receipt("durable"));
    vi.resetModules();
    const fresh = await import("../src/renderer/src/lib/legacyDelivery/busReceiptVisibility");
    function Probe() { return h("span", null, [...fresh.useHiddenReceiptIds("reload", session)].join(",")); }
    act(() => root.render(h(Probe)));
    expect(container.textContent).toBe("durable");
    expect(transport.mutation).not.toHaveBeenCalled();
  });
});
