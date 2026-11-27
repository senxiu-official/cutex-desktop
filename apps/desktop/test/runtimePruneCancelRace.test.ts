// Cross-review 2026-11-15 (gate-notice-review): a plan read whose last panel closed before its GET started must not
// send the GET (order was CANCEL, GET: the cancelled request ran unwatched for up to 20 s).
import { expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({
  runtimePrunePlan: () => { env.calls.push("GET"); return new Promise(() => {}); },
  cancelRuntimePrunePlan: () => { env.calls.push("CANCEL"); },
}) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: { active: "a" }, daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]), byHost: { a: { daemon: { kind: "connected" }, features: new Set(["runtime-prune-v1"]) } } }) } }));
vi.mock("../src/renderer/src/lib/runtimesStore", () => ({ refreshRuntimes: vi.fn() }));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ loadComponents: vi.fn() }));
import { refreshRuntimePrune, watchRuntimePrune } from "../src/renderer/src/lib/runtimePruneStore";
it("does not start a read after its last watcher has already cancelled it", async () => {
  const unwatch = watchRuntimePrune("a");
  const operation = refreshRuntimePrune("a");
  unwatch();
  await operation;
  expect(env.calls).toEqual(["CANCEL"]);
});
