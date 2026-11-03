import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SidebarSnapshot } from "../src/shared/ipc";

const fx = vi.hoisted(() => {
  const calls: { host: string; method: string; args: unknown[] }[] = [];
  const respond = new Map<string, (...args: unknown[]) => unknown>();
  const make = (host: () => string) => new Proxy({}, { get: (_target, method) => {
    if (typeof method !== "string" || method === "then") return undefined;
    return async (...args: unknown[]) => {
      calls.push({ host: host(), method, args });
      return respond.get(method)?.(...args) ?? null;
    };
  } });
  const state = { focus: "original" };
  return { calls, respond, state, api: make(() => state.focus), apiFor: (host: string) => make(() => host) };
});
vi.mock("../src/renderer/src/bridge", () => ({ api: fx.api, apiFor: fx.apiFor, bridge: { api: fx.api, apiFor: fx.apiFor, on: () => () => {} } }));

let store: (typeof import("../src/renderer/src/store"))["useApp"];
let packages: typeof import("../src/renderer/src/lib/runtimePackageStore");
let feedback: typeof import("../src/renderer/src/lib/hostBusyActions");
let sessionAction: { mock: { calls: unknown[][] } };
const features = new Set(["runtime-package-upgrade", "claude-runtime-repin", "session-claude-runtime"]);
const view = (id: string) => ({ cutexSessionId: id, name: id, current: { release: "claude-r24", missing: false }, pending: null, selected: { release: "claude-r25" }, selectedError: null, direction: "upgrade", upgradeAvailable: true, dryRun: { outcome: "deferred", reason: "next start", restartRequired: true } });
const sidebar = { active: ["a", "b"].map(id => ({ cutexSessionId: id, displayName: id, revision: 3, lifecycle: "active", native: { threadId: id }, runtime: { backend: "claude_subscription", status: "online", runtimeGeneration: 7, activeTurnId: null, threadStatus: { type: "idle" }, claudeRuntime: { release: "claude-r24", pendingRelease: null } } })), retired: [], projects: null, hostRows: {}, claudeRuntime: { selectedRelease: "claude-r25" } } as unknown as SidebarSnapshot;
const connection = { features, daemon: { kind: "connected", hostId: "original" }, sidebar };

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal("document", { hasFocus: () => false, visibilityState: "hidden" });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0));
  fx.calls.length = 0; fx.respond.clear(); fx.state.focus = "original";
  store = (await import("../src/renderer/src/store")).useApp;
  store.setState({ ...connection, hosts: { active: "original", hosts: ["original", "other"].map(id => ({ id, conn: { epoch: `${id}-1` } })) }, byHost: {}, refreshHostSidebar: vi.fn(async () => {}) } as never);
  sessionAction = vi.spyOn(store.getState(), "sessionAction");
  packages = await import("../src/renderer/src/lib/runtimePackageStore");
  feedback = await import("../src/renderer/src/lib/hostBusyActions");
  packages.startRuntimePackageSync(store);
  fx.respond.set("claudeRuntime", id => view(id as string));
  fx.respond.set("repinClaudeRuntime", id => ({ ok: true, done: { result: { outcome: "deferred", reason: "next start", restartRequired: true, previous: "claude-r24", target: "claude-r25" }, runtime: view(id as string) } }));
}, 20_000);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["wrapped503", "legacy500", "legacy500HostBusy"])("actual caller uses fenced store online (%s), continues after exhaustion and retries only the captured online", async shape => {
  const { CutexApiError } = await import("@cutex-desktop/cutex-client");
  const { hostBusyActionWire } = await import("../src/shared/hostBusyAction");
  const error = shape === "wrapped503"
    ? CutexApiError.fromBody(503, { contractVersion: 2, error: { code: "admission_busy", message: "private runtime refusal", retryable: true, details: { reason: "hostBusy", retryAfterMs: 1000 } } })
    : new CutexApiError(500, "runtime_mutation_failed", shape === "legacy500HostBusy" ? "hostBusy/runtime admission unavailable" : "admission_busy: host_busy: the launch claim check waits for the host authority fence; retry shortly", true);
  const wire = hostBusyActionWire(error);
  expect(wire).toBeTruthy();
  let busy = true;
  fx.respond.set("sessionAction", (id, method) => {
    if (id === "a" && method === "cutex/runtime/online" && busy) throw new Error(`Error invoking remote method 'cutex-desktop:invoke': Error: ${wire}`);
    return { status: method === "cutex/runtime/online" ? "online" : "offline" };
  });
  const result = packages.startRuntimePackageUpgrade("original");
  await vi.advanceTimersByTimeAsync(999);
  expect(feedback.useHostBusyActions.getState().rows).toMatchObject([{ hostId: "original", state: "retrying" }]);
  expect(fx.calls.filter(c => c.method === "sessionAction" && c.args[1] === "cutex/runtime/online")).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5000); await result;
  const state = packages.useRuntimePackages.getState().byHost.original!;
  expect(state.actionError).toBeNull();
  expect(state.claudeBatch?.run.items).toMatchObject([{ state: "moved", backOnline: null, reason: null }, { state: "moved", backOnline: true }]);
  expect(state.claudeBatch?.run.counts.failed).toBe(0);
  const row = feedback.useHostBusyActions.getState().rows[0]!;
  expect(row).toMatchObject({ hostId: "original", sessionId: "a", state: "exhausted" });
  expect(sessionAction.mock.calls.map((call: unknown[]) => [call[0], call[1], call[3]])).toEqual(["a", "b"].flatMap(id => [[id, "cutex/runtime/offline", "original"], [id, "cutex/runtime/online", "original"]]));
  const before = fx.calls.filter(c => c.method === "sessionAction" && c.args[1] === "cutex/runtime/online");
  expect(before.filter(c => c.args[0] === "a")).toHaveLength(5);
  expect(before.every(c => (c.args[2] as { expectedRuntimeGeneration: number }).expectedRuntimeGeneration === 7)).toBe(true);
  busy = false; row.retry(); row.retry(); await vi.advanceTimersByTimeAsync(0);
  expect(feedback.useHostBusyActions.getState().rows).toEqual([]);
  expect(fx.calls.filter(c => c.method === "repinClaudeRuntime")).toHaveLength(2);
  expect(fx.calls.filter(c => c.method === "sessionAction" && c.args[1] === "cutex/runtime/offline")).toHaveLength(2);
  expect(fx.calls.filter(c => c.method === "sessionAction" && c.args[1] === "cutex/runtime/online")).toHaveLength(7);
  expect(fx.calls.filter(c => c.method === "sessionAction" && c.args[1] === "cutex/runtime/online").at(-1)?.args).toEqual(before[0]?.args);
  expect(fx.calls.every(c => c.host === "original")).toBe(true);
});

it("host switch during retry keeps later batch work on the original host and cancels stale manual Retry", async () => {
  fx.respond.set("sessionAction", (id, method) => {
    if (id === "a" && method === "cutex/runtime/online") throw new Error('host_action_busy:{"retryAfterMs":1000}');
    return { status: method === "cutex/runtime/online" ? "online" : "offline" };
  });
  const result = packages.startRuntimePackageUpgrade("original");
  await vi.advanceTimersByTimeAsync(1);
  fx.state.focus = "other";
  store.setState({ hosts: { active: "other", hosts: ["original", "other"].map(id => ({ id, conn: { epoch: `${id}-1` } })) }, byHost: { original: connection }, sidebar: { ...sidebar, active: [] } } as never);
  await vi.advanceTimersByTimeAsync(1500); await result;
  expect(fx.calls.every(c => c.host === "original")).toBe(true);
  expect(sessionAction.mock.calls.every((call: unknown[]) => call[3] === "original")).toBe(true);
  const row = feedback.useHostBusyActions.getState().rows[0]!;
  expect(row).toMatchObject({ hostId: "original", state: "cancelled" });
  const count = fx.calls.length;
  row.retry(); await vi.advanceTimersByTimeAsync(0);
  expect(fx.calls).toHaveLength(count);
  expect(packages.useRuntimePackages.getState().byHost.other).toBeUndefined();
});
