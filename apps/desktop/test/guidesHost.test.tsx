// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  state: { hosts: { active: "a" }, supported: {} as Record<string, boolean> },
  listeners: new Set<() => void>(),
  apis: new Map<string, { guidesPreferences: ReturnType<typeof vi.fn>; putGuidesPreferences: ReturnType<typeof vi.fn> }>(),
  version: "0.2.0" as string | null,
}));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: (state: typeof env.state, host: string) => new Set(state.supported[host] ? ["guides.preferences"] : []),
  useApp: Object.assign((selector: (state: typeof env.state) => unknown) => useSyncExternalStore(
    (listener) => { env.listeners.add(listener); return () => { env.listeners.delete(listener); }; },
    () => selector(env.state),
  ), { getState: () => env.state }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ apiFor: (host: string) => env.apis.get(host) }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => ({ current: { version: env.version } }) }));
vi.mock("../src/renderer/src/lib/onboarding", () => ({ finishOnboarding: vi.fn(), openOnboarding: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
let guides: typeof import("../src/renderer/src/lib/guides");
let sync: typeof import("../src/renderer/src/lib/guidesHost");
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function api(host: string) {
  const value = { guidesPreferences: vi.fn().mockResolvedValue({ skippedThrough: null }), putGuidesPreferences: vi.fn().mockResolvedValue({ skippedThrough: null }) };
  env.apis.set(host, value);
  return value;
}
function Probe() {
  sync.useGuidesHostSync();
  const pending = guides.useGuidesHostPending(), state = guides.useGuideState();
  return h("span", { "data-pending": String(pending), "data-asked": String(state.asked) });
}
const mount = () => act(async () => { root.render(h(Probe)); });
const pending = () => container.querySelector("span")!.getAttribute("data-pending") === "true";
async function update(host: string, supported: Record<string, boolean>) {
  await act(async () => {
    env.state = { hosts: { active: host }, supported };
    env.listeners.forEach(listener => listener());
  });
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); localStorage.clear();
  env.state = { hosts: { active: "a" }, supported: {} }; env.version = "0.2.0";
  env.listeners.clear(); env.apis.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  guides = await import("../src/renderer/src/lib/guides");
  sync = await import("../src/renderer/src/lib/guidesHost");
});
afterEach(() => {
  act(() => root.unmount()); container.remove();
  vi.clearAllTimers(); vi.useRealTimers();
});

it("never re-suspends after the original startup deadline when capabilities and a slow GET arrive late", async () => {
  const a = api("a"), get = deferred<{ skippedThrough: string | null }>();
  a.guidesPreferences.mockReturnValue(get.promise);
  await mount(); expect(pending()).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(sync.START_WAIT_MS); });
  expect(pending()).toBe(false);
  await update("a", { a: true });
  expect(a.guidesPreferences).toHaveBeenCalledOnce(); expect(pending()).toBe(false);
  env.version = "0.2.1";
  await act(async () => { root.render(h(Probe)); await vi.advanceTimersByTimeAsync(10000); });
  expect(pending()).toBe(false);
  await act(async () => get.resolve({ skippedThrough: null }));
  expect(pending()).toBe(false);
});

it("keeps one startup budget across host switches and ignores GETs from the old host", async () => {
  const a = api("a"), b = api("b"), c = api("c");
  const first = deferred<{ skippedThrough: string | null }>(), second = deferred<{ skippedThrough: string | null }>();
  a.guidesPreferences.mockReturnValue(first.promise); b.guidesPreferences.mockReturnValue(second.promise);
  env.state.supported = { a: true, b: true, c: true };
  await mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await update("b", env.state.supported);
  await act(async () => first.resolve({ skippedThrough: "0.2.0" }));
  expect(guides.getGuides().asked).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(pending()).toBe(false);
  await update("c", env.state.supported);
  expect(c.guidesPreferences).toHaveBeenCalledOnce(); expect(pending()).toBe(false);
  await act(async () => second.resolve({ skippedThrough: "0.2.0" }));
  expect(guides.getGuides().asked).toBe(false);
});

it("backfills a skip made before the host advertises capabilities", async () => {
  const a = api("a");
  await mount();
  await act(async () => guides.skipAllGuides("0.2.0"));
  expect(a.putGuidesPreferences).not.toHaveBeenCalled();
  expect(guides.getGuides().asked).toBe(true);
  await update("a", { a: true });
  expect(a.putGuidesPreferences).toHaveBeenCalledExactlyOnceWith("0.2.0");
  expect(a.guidesPreferences).not.toHaveBeenCalled();
});

it("retains local fallback on older hosts and persists a reset for capability discovery after restart", async () => {
  const a = api("a");
  await mount();
  await act(async () => { guides.skipAllGuides("0.2.0"); guides.resetGuides(); });
  expect(guides.guideSeen("tip.tray")).toBe(false);
  expect(a.putGuidesPreferences).not.toHaveBeenCalled();
  act(() => root.unmount()); vi.resetModules();
  guides = await import("../src/renderer/src/lib/guides");
  sync = await import("../src/renderer/src/lib/guidesHost");
  root = createRoot(container); env.state.supported = { a: true };
  await mount();
  expect(a.putGuidesPreferences).toHaveBeenCalledExactlyOnceWith(null);
  expect(guides.guideSeen("tip.tray")).toBe(false);
});

it("retries failed writes without losing the durable choice", async () => {
  const a = api("a"); a.putGuidesPreferences.mockRejectedValueOnce(new Error("offline"));
  env.state.supported = { a: true }; await mount();
  await act(async () => guides.skipAllGuides("0.2.0"));
  expect(a.putGuidesPreferences).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(a.putGuidesPreferences.mock.calls).toEqual([["0.2.0"], ["0.2.0"]]);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(a.putGuidesPreferences).toHaveBeenCalledTimes(2);
});

it.each(["success", "failure"])("serializes skip then reset while the first write ends in %s", async outcome => {
  const a = api("a"), first = deferred<unknown>();
  a.putGuidesPreferences.mockReturnValueOnce(first.promise);
  env.state.supported = { a: true }; await mount();
  await act(async () => guides.skipAllGuides("0.2.0"));
  await act(async () => guides.resetGuides());
  expect(a.putGuidesPreferences.mock.calls).toEqual([["0.2.0"]]);
  await act(async () => { if (outcome === "success") first.resolve({}); else first.reject(new Error("offline")); });
  expect(a.putGuidesPreferences.mock.calls).toEqual([["0.2.0"], [null]]);
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(a.putGuidesPreferences).toHaveBeenCalledTimes(2);
});

it("pins queued and in-flight writes to the gesture's target host, even before React renders its switch", async () => {
  const a = api("a"), b = api("b"), first = deferred<unknown>();
  a.putGuidesPreferences.mockReturnValueOnce(first.promise);
  env.state.supported = { a: true, b: true }; await mount();
  await act(async () => guides.skipAllGuides("0.2.0"));
  await act(async () => {
    env.state = { hosts: { active: "b" }, supported: { a: true, b: true } };
    guides.resetGuides(); // The host changed, but the hook has not rendered yet.
    env.listeners.forEach(listener => listener());
  });
  expect(b.putGuidesPreferences).toHaveBeenCalledExactlyOnceWith(null);
  await act(async () => first.resolve({}));
  expect(a.putGuidesPreferences.mock.calls).toEqual([["0.2.0"]]);
  expect(b.putGuidesPreferences.mock.calls).toEqual([[null]]);
});

it("does not apply a stale GET over a local reset", async () => {
  const a = api("a"), get = deferred<{ skippedThrough: string | null }>();
  a.guidesPreferences.mockReturnValue(get.promise);
  env.state.supported = { a: true }; await mount();
  await act(async () => guides.resetGuides());
  await act(async () => get.resolve({ skippedThrough: "0.2.0" }));
  expect(guides.guideSeen("tip.tray")).toBe(false);
  expect(guides.getGuides().asked).toBe(true);
  expect(a.putGuidesPreferences).toHaveBeenCalledExactlyOnceWith(null);
});

it("pauses retries while a host lacks the capability, then backfills its retained intent", async () => {
  const a = api("a"); a.putGuidesPreferences.mockRejectedValueOnce(new Error("offline"));
  env.state.supported = { a: true }; await mount();
  await act(async () => guides.skipAllGuides("0.2.0"));
  await update("a", {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(a.putGuidesPreferences).toHaveBeenCalledTimes(1);
  await update("a", { a: true });
  expect(a.putGuidesPreferences.mock.calls).toEqual([["0.2.0"], ["0.2.0"]]);
});
