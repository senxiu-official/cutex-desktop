// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";

const env = vi.hoisted(() => ({ target: null as EventTarget | null }));
vi.mock("../src/renderer/src/lib/appWindowSet", () => ({ onEveryAppWindow: (attach: (target: Window) => () => void) => attach(env.target as Window) }));
type Store = typeof import("../src/renderer/src/lib/legacyDelivery/busReceiptVisibility");
const PREFIX = "cutex-desktop.busReceiptVisibility.v2:";
const host = "concurrent-host", session = "concurrent-session";
const legacyKey = (restored = false) => `cutex-desktop.${restored ? "restored" : "hidden"}BusReceipts.v1:` + JSON.stringify([host, session]);
const receipt = (id: string): AdmissionNextStep => ({ id, deliveryKind: "tell", waitReason: "nativeReceipt", enqueuedAt: "2000-01-01T00:00:00Z" });
const roots: Root[] = [], targets: EventTarget[] = [];
const pending: { target: EventTarget; key: string; newValue: string }[] = [];
let originalSet: typeof Storage.prototype.setItem;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); roots.length = targets.length = pending.length = 0;
  originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) {
    originalSet.call(this, key, value);
    for (const target of targets) if (target !== env.target) pending.push({ target, key, newValue: value });
  });
});
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount(); });
  vi.restoreAllMocks();
});
async function renderer() {
  vi.resetModules();
  const store: Store = await import("../src/renderer/src/lib/legacyDelivery/busReceiptVisibility");
  const target = new EventTarget(); targets.push(target); env.target = target;
  const node = document.createElement("div"), root = createRoot(node); roots.push(root);
  let hidden: ReadonlySet<string>, restored: ReadonlySet<string>;
  function Probe() {
    hidden = store.useHiddenReceiptIds(host, session); restored = store.useRestoredReceiptIds(host, session);
    return h("span", null, [...hidden].sort().join(","));
  }
  await act(async () => root.render(h(Probe)));
  return { store, target, node, hidden: () => [...hidden!].sort(), restored: () => [...restored!].sort(),
    run: async (action: () => void) => { env.target = target; await act(async () => action()); } };
}
async function flush(reverse = false) {
  while (pending.length) {
    const event = reverse ? pending.pop()! : pending.shift()!;
    env.target = event.target;
    await act(async () => event.target.dispatchEvent(new StorageEvent("storage", { key: event.key, newValue: event.newValue, storageArea: localStorage })));
  }
}

it.each([false, true])("independent renderer restores of different legacy IDs survive delayed events (reverse=%s), fresh loads and explicit re-hide", async reverse => {
  localStorage.setItem(legacyKey(), '["a","b"]');
  const a = await renderer(), b = await renderer(); pending.length = 0;
  expect(a.hidden()).toEqual(["a", "b"]); expect(b.hidden()).toEqual(["a", "b"]);
  await a.run(() => a.store.restoreReceipt(host, session, "a"));
  // Same API is used after a confirmed server close: it must remain removed.
  await b.run(() => b.store.restoreReceipt(host, session, "b"));
  // Correct persistence cannot depend on either writer repairing a lost snapshot.
  const fresh = await renderer();
  expect(fresh.hidden()).toEqual([]); expect(fresh.restored()).toEqual(["a", "b"]);
  await flush(reverse);
  expect(a.hidden()).toEqual([]); expect(b.hidden()).toEqual([]);
  expect(a.restored()).toEqual(["a", "b"]); expect(b.restored()).toEqual(["a", "b"]);
  expect(localStorage.getItem(legacyKey())).toBe('["a","b"]');
  // Deliberate later hiding advances the version rather than losing to a permanent tombstone.
  await a.run(() => a.store.dismissReceipt(host, session, receipt("a")));
  await flush(reverse);
  expect(a.hidden()).toEqual(["a"]); expect(b.hidden()).toEqual(["a"]); expect(fresh.hidden()).toEqual(["a"]);
  const restarted = await renderer(); expect(restarted.hidden()).toEqual(["a"]); expect(restarted.restored()).toEqual(["b"]);
});

it("stale restore events cannot overwrite a later explicit re-hide of the same ID", async () => {
  const a = await renderer(), b = await renderer();
  await a.run(() => a.store.dismissReceipt(host, session, receipt("same"))); await flush();
  await b.run(() => b.store.restoreReceipt(host, session, "same"));
  const restoreEvents = pending.splice(0);
  await a.run(() => a.store.dismissReceipt(host, session, receipt("same")));
  await flush(); pending.push(...restoreEvents); await flush(true);
  expect(a.hidden()).toEqual(["same"]); expect(b.hidden()).toEqual(["same"]);
  const fresh = await renderer(); expect(fresh.hidden()).toEqual(["same"]);
});

it("concurrent same-ID versions retain a restore tombstone, and higher-version explicit hide wins after restart", async () => {
  // Separate writer registers also protect genuinely concurrent writers whose reads
  // both precede the other's write; neither record can overwrite the other physically.
  originalSet.call(localStorage, PREFIX + JSON.stringify([host, session, "same", "writer-a"]), JSON.stringify({ version: 2, revision: 4, state: "hidden" }));
  originalSet.call(localStorage, PREFIX + JSON.stringify([host, session, "same", "writer-b"]), JSON.stringify({ version: 2, revision: 4, state: "restored" }));
  const a = await renderer(); expect(a.hidden()).toEqual([]); expect(a.restored()).toEqual(["same"]);
  await a.run(() => a.store.dismissReceipt(host, session, receipt("same")));
  const fresh = await renderer(); expect(fresh.hidden()).toEqual(["same"]);
});

it("migrates legacy hidden/restored IDs additively, retains unknown IDs and ignores absent/corrupt records", async () => {
  originalSet.call(localStorage, legacyKey(), '["unknown","restored-before-upgrade",42]');
  originalSet.call(localStorage, legacyKey(true), '["restored-before-upgrade"]');
  const a = await renderer();
  expect(a.hidden()).toEqual(["unknown"]); expect(a.restored()).toEqual(["restored-before-upgrade"]);
  expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index)).filter(key => key?.startsWith(PREFIX))).toHaveLength(2);
  const baseline = [...Array(localStorage.length)].map((_, index) => localStorage.key(index)!).find(key => key.startsWith(PREFIX) && key.includes('"unknown"'))!;
  await a.run(() => a.target.dispatchEvent(new StorageEvent("storage", { key: baseline, newValue: null, storageArea: localStorage })));
  await a.run(() => a.target.dispatchEvent(new StorageEvent("storage", { key: baseline, newValue: '{bad', storageArea: localStorage })));
  expect(a.hidden()).toEqual(["unknown"]);
  await a.run(() => a.store.restoreReceipt(host, session, "unknown"));
  const fresh = await renderer(); expect(fresh.hidden()).toEqual([]); expect(fresh.restored()).toEqual(["restored-before-upgrade", "unknown"]);
});
