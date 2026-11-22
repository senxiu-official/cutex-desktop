import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ caps: vi.fn(), plan: vi.fn(), prune: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class { capabilities() { return f.caps(); } runtimePrunePlan(options?: { signal?: AbortSignal }) { return f.plan(options); } pruneRuntimes(ids: string[]) { return f.prune(ids); } },
}));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { hostFeatureSet } from "../src/shared/users";
import { RUNTIME_PRUNE_PLAN_TIMEOUT } from "../src/shared/runtimes";
beforeEach(() => vi.clearAllMocks());
function fixture() {
  const daemon = new DaemonService(() => {});
  (daemon as unknown as { client: CutexClient }).client = new CutexClient({ baseUrl: "http://fixture.invalid", token: null });
  return daemon;
}
it.each([
  [{ hostId: "old", featureList: [] }, false],
  [{ hostId: "new", featureList: ["runtime-prune-v1"] }, true],
  [{ hostId: "new", featureList: [], features: { runtimePruneV1: true } }, true],
  [{ hostId: "old", featureList: [], features: { runtimePruneV1: false } }, false],
])("normalizes either capability advertisement: %j", async (caps, supported) => {
  f.caps.mockResolvedValue(caps);
  expect((await fixture().capabilities())?.featureList.includes("runtime-prune-v1")).toBe(supported);
});
it("preserves plan and mixed-result envelopes through main", async () => {
  const daemon = fixture(), plan = { versions: [{ id: "opaque", kind: "claude", release: "r1", bytes: 2, canPrune: false, blockedReasons: ["rollback"] }] };
  const result = { freedBytes: 0, results: [{ id: "opaque", status: "refused", freedBytes: 0, reason: "rollback" }] };
  f.plan.mockResolvedValue(plan); f.prune.mockResolvedValue(result);
  expect(await daemon.runtimePrunePlan()).toBe(plan); expect(await daemon.pruneRuntimes(["opaque"])).toBe(result); expect(f.prune).toHaveBeenCalledWith(["opaque"]);
});
/** A plan read that only ends when its signal aborts, like `GET /v2/runtimes/prune` on EVA (2026-11-15). */
function hangingPlan() {
  f.plan.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))));
}
it("gives up on a plan read after 20 s and frees the request", async () => {
  vi.useFakeTimers();
  try {
    hangingPlan();
    const read = fixture().runtimePrunePlan();
    const outcome = read.then(() => "answered", (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(19_999);
    expect((f.plan.mock.calls[0]![0] as { signal: AbortSignal }).signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe(RUNTIME_PRUNE_PLAN_TIMEOUT);
    expect((f.plan.mock.calls[0]![0] as { signal: AbortSignal }).signal.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});
it("cancel drops the reads still waiting, and only those", async () => {
  hangingPlan();
  const daemon = fixture();
  const first = daemon.runtimePrunePlan().catch((e: Error) => e.message);
  daemon.cancelRuntimePrunePlan();
  expect(await first).toContain("cancelled");
  const second = daemon.runtimePrunePlan();
  expect((f.plan.mock.calls[1]![0] as { signal: AbortSignal }).signal.aborted).toBe(false);
  daemon.cancelRuntimePrunePlan();
  await expect(second).rejects.toThrow("cancelled");
});
it("hides owner-only cleanup capability on restricted connections", () => {
  expect(hostFeatureSet({ featureList: ["runtime-prune-v1"], user: { id: "u", name: "Member", isOwner: false, pending: false, grant: null } }).has("runtime-prune-v1")).toBe(false);
});
