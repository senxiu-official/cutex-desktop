import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { DesktopEvents, HostsState } from "../src/shared/ipc";

const fx = vi.hoisted(() => ({
  listeners: new Map<string, (value: never) => void>(),
  capabilities: vi.fn(),
  remoteCapabilities: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: { hosts: async () => ({ active: "local", hosts: [] }), capabilities: fx.capabilities },
  apiFor: (id: string) => ({ capabilities: id === "local" ? fx.capabilities : fx.remoteCapabilities }),
  bridge: { on: (name: string, fn: (value: never) => void) => { fx.listeners.set(name, fn); return () => {}; } },
}));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ startDelegationSync() {} }));
vi.mock("../src/renderer/src/lib/jobStore", () => ({ startJobSync() {} }));
vi.mock("../src/renderer/src/lib/runtimePackageStore", () => ({ startRuntimePackageSync() {} }));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({ startOwnerNotifySync() {} }));

let store: typeof import("../src/renderer/src/store").useApp;
let reset: typeof import("../src/renderer/src/lib/hostSwitch").fireHostReset;
const connected = { kind: "connected" as const, baseUrl: "mock://", hostId: "mock" };
const caps = (dsh: boolean) => ({ featureList: ["components", ...(dsh ? ["dsh-runtime"] : [])] });
const emit = <K extends keyof DesktopEvents>(name: K, value: DesktopEvents[K]) => fx.listeners.get(name)!(value as never);
const event = (hostId = "local", reason = "installed") => emit("hostEvent", {
  hostId, epoch: hostId === "local" ? "l1" : "r1", envelope: { cutex: { method: "cutex/components/updated", params: { name: "dsh-runtime", reason } } },
} as unknown as DesktopEvents["hostEvent"]);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (value: ReturnType<typeof caps>) => void;
  const promise = new Promise<ReturnType<typeof caps>>(r => { resolve = r; });
  return { promise, resolve };
}
beforeAll(async () => {
  ({ useApp: store } = await import("../src/renderer/src/store"));
  ({ fireHostReset: reset } = await import("../src/renderer/src/lib/hostSwitch"));
  store.getState().init();
  await flush();
}, 60_000);
beforeEach(() => {
  vi.clearAllMocks();
  fx.capabilities.mockReset();
  fx.remoteCapabilities.mockReset();
  store.setState({
    daemon: connected, hosts: null, features: new Set(["components"]), featuresKnown: true,
    services: null, approvals: null,
    sidebar: { active: [{ cutexSessionId: "existing-dsh", runtime: { backend: "dsh" } }], retired: [{ cutexSessionId: "archived-dsh", runtime: { backend: "dsh" } }] } as never,
    refreshSidebar: vi.fn(async () => {}), refreshServices: vi.fn(async () => {}), refreshApprovals: vi.fn(async () => {}),
    byHost: { remote: { epoch: "r1", daemon: connected, features: new Set(["components"]), featuresKnown: true, sidebar: null, approvals: null, services: null, waiting: {} } },
  });
  fx.capabilities.mockResolvedValue(caps(true));
  fx.remoteCapabilities.mockResolvedValue(caps(true));
  vi.useFakeTimers();
});
afterEach(async () => {
  // Invalidate outstanding response tokens, then drain scheduled reloads while
  // their fences are invalid: callbacks remove their timer-map entries without I/O.
  // The same imported store/listeners are reused by every test.
  reset("local");
  reset("remote");
  await vi.runOnlyPendingTimersAsync();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("refreshes install/remove capabilities without any mounted component card, coalescing bursts", async () => {
  const history = store.getState().sessions;
  const sidebar = store.getState().sidebar;
  event(); event(); event();
  await vi.advanceTimersByTimeAsync(300);
  expect(fx.capabilities).toHaveBeenCalledTimes(1);
  expect(store.getState().features.has("dsh-runtime")).toBe(true);
  fx.capabilities.mockResolvedValue(caps(false));
  event("local", "removed");
  await vi.advanceTimersByTimeAsync(300);
  expect(store.getState().features.has("dsh-runtime")).toBe(false);
  expect(store.getState().sessions).toBe(history);
  expect(store.getState().sidebar).toBe(sidebar);
});

it("updates only the event's host, including outside the focus", async () => {
  event("remote");
  await vi.advanceTimersByTimeAsync(300);
  expect(fx.capabilities).not.toHaveBeenCalled();
  expect(store.getState().features.has("dsh-runtime")).toBe(false);
  expect(store.getState().byHost.remote!.features.has("dsh-runtime")).toBe(true);
});

it("ignores older capability replies when removal overtakes installation", async () => {
  const old = deferred();
  fx.capabilities.mockReturnValueOnce(old.promise).mockResolvedValue(caps(false));
  event();
  await vi.advanceTimersByTimeAsync(300);
  event("local", "removed");
  await vi.advanceTimersByTimeAsync(300);
  old.resolve(caps(true)); await flush();
  expect(store.getState().features.has("dsh-runtime")).toBe(false);
  expect(store.getState().refreshServices).toHaveBeenCalledTimes(1);
  expect(store.getState().refreshApprovals).toHaveBeenCalledTimes(1);
});

it("prevents a connect read from overwriting the component event's newer capabilities", async () => {
  const old = deferred();
  fx.capabilities.mockReturnValueOnce(old.promise).mockResolvedValue(caps(false));
  emit("daemonState", { hostId: "local", epoch: "a", state: connected });
  event("local", "removed");
  await vi.advanceTimersByTimeAsync(300);
  old.resolve(caps(true)); await flush();
  expect(store.getState().features.has("dsh-runtime")).toBe(false);
});

it("drops a late reply after host replacement", async () => {
  const old = deferred(); fx.remoteCapabilities.mockReturnValue(old.promise);
  event("remote"); await vi.advanceTimersByTimeAsync(300);
  reset("remote");
  store.setState({ byHost: { remote: { ...store.getState().byHost.remote!, epoch: "r2" } } });
  old.resolve(caps(true)); await flush();
  expect(store.getState().byHost.remote!.features.has("dsh-runtime")).toBe(false);
});

it("does not resurrect a removed host or erase known capabilities on a failed read", async () => {
  const old = deferred(); fx.remoteCapabilities.mockReturnValue(old.promise);
  event("remote"); await vi.advanceTimersByTimeAsync(300);
  reset("remote"); store.setState({ byHost: {} });
  old.resolve(caps(true)); await flush();
  expect(store.getState().byHost.remote).toBeUndefined();
  fx.capabilities.mockRejectedValue(new Error("offline"));
  const before = store.getState().features;
  event(); await vi.advanceTimersByTimeAsync(300);
  expect(store.getState().features).toBe(before);
});

it("routes an in-flight reply to the same host's slice after focus changes", async () => {
  const old = deferred(); fx.capabilities.mockReturnValue(old.promise);
  event(); await vi.advanceTimersByTimeAsync(300);
  store.setState({ hosts: { active: "remote" } as HostsState, byHost: { local: { ...store.getState().byHost.remote!, epoch: "l1" } } });
  old.resolve(caps(true)); await flush();
  expect(store.getState().features.has("dsh-runtime")).toBe(false);
  expect(store.getState().byHost.local!.features.has("dsh-runtime")).toBe(true);
});
