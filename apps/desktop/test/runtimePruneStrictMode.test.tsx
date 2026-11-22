// @vitest-environment jsdom
// Cross-review 2026-11-15 (gate-notice-review): React.StrictMode's mount / unmount / mount sent [CANCEL, GET, GET];
// only the surviving read may reach main.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimePrunePlan, RuntimePruneVersion } from "../src/shared/runtimes";
const env = vi.hoisted(() => ({ host: "a", enabled: true, get: vi.fn(), post: vi.fn(), runtimes: vi.fn(), components: vi.fn(), calls: [] as string[] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: (host: string) => ({ runtimePrunePlan: () => { env.calls.push(`GET:${host}`); return env.get(host); }, cancelRuntimePrunePlan: () => { env.calls.push(`CANCEL:${host}`); }, pruneRuntimes: (ids: string[]) => { env.calls.push(`POST:${host}`); return env.post(host, ids); } }) }));
vi.mock("../src/renderer/src/lib/useArchivedAgents", () => ({ useArchivedAgents: () => {} }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: { active: env.host }, daemon: { kind: "connected" }, features: new Set(env.enabled ? ["runtime-prune-v1"] : []), byHost: { a: { daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]) }, b: { daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]) } } }) } }));
vi.mock("../src/renderer/src/lib/runtimesStore", () => ({ refreshRuntimes: (host: string) => env.runtimes(host) }));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ loadComponents: (host: string) => env.components(host) }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => ({ daemon: { kind: "connected" }, features: env.enabled ? CAPS : NO_CAPS }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => env.host }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: object) => key + (vars ? JSON.stringify(vars) : "") }) }));
const CAPS = new Set(["runtime-prune-v1"]);
const NO_CAPS = new Set<string>();
const { useRuntimePruneStore, refreshRuntimePrune, pruneRuntimeVersions, RUNTIME_PRUNE_PLAN_WAIT_MS } = await import("../src/renderer/src/lib/runtimePruneStore");
const { RUNTIME_PRUNE_PLAN_TIMEOUT } = await import("../src/shared/runtimes");
const { captureHostAction, fireHostReset } = await import("../src/renderer/src/lib/hostSwitch");
const { RuntimeGroup } = await import("../src/renderer/src/components/RuntimeVersions");
const version = (id: string, extra: Partial<RuntimePruneVersion> = {}): RuntimePruneVersion => ({ id, kind: "native", release: `release-${id}`, bytes: 1024, canPrune: true, blockedReasons: [], ...extra });
const plan = (...versions: RuntimePruneVersion[]): RuntimePrunePlan => ({ versions });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, node: HTMLDivElement;
beforeEach(() => {
  fireHostReset("a"); fireHostReset("b"); env.host = "a"; env.enabled = true; env.calls = []; vi.clearAllMocks();
  env.get.mockResolvedValue(plan(version("one"))); env.post.mockResolvedValue({ freedBytes: 1024, results: [{ id: "one", status: "deleted", freedBytes: 1024 }] });
  env.runtimes.mockResolvedValue(undefined); env.components.mockResolvedValue(undefined);
  node = document.createElement("div"); document.body.append(node); root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); node.remove(); });
async function render() { await act(async () => root.render(h(RuntimeGroup, { kind: "native", title: "native", list: [] }))); }
const btn = (key: string) => [...node.querySelectorAll("button")].find(b => b.textContent?.startsWith(key))!;


it("StrictMode starts only the surviving cleanup plan read", async () => {
  const { StrictMode } = await import("react");
  env.get.mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(h(StrictMode, null,
    h(RuntimeGroup, { kind: "native", title: "native", list: [] }))));
  expect(env.calls).toEqual(["CANCEL:a", "GET:a"]);
});
