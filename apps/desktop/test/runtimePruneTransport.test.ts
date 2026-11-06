import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ caps: vi.fn(), plan: vi.fn(), prune: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", async original => ({
  ...await original<typeof import("@cutex-desktop/cutex-client")>(),
  CutexClient: class { capabilities() { return f.caps(); } runtimePrunePlan() { return f.plan(); } pruneRuntimes(ids: string[]) { return f.prune(ids); } },
}));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { hostFeatureSet } from "../src/shared/users";
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
it("hides owner-only cleanup capability on restricted connections", () => {
  expect(hostFeatureSet({ featureList: ["runtime-prune-v1"], user: { id: "u", name: "Member", isOwner: false, pending: false, grant: null } }).has("runtime-prune-v1")).toBe(false);
});
