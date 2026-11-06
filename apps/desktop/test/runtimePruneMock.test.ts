// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mock } from "../src/renderer/src/modules/runtimes/mock";
import { adaptRuntimes } from "../src/shared/runtimes";
import { mergeRuntimePruneVersions } from "../src/renderer/src/lib/runtimePruneView";

it("previews discovery-only duplicate releases, partial success, refusal and I/O failure", async () => {
  expect(mock.features?.new).toContain("runtime-prune-v1");
  const api = mock.api!({} as never);
  const before = await api.runtimePrunePlan!();
  expect(before.versions.filter(v => v.release === "claude-r0")).toHaveLength(2);
  const result = await api.pruneRuntimes!(before.versions.filter(v => v.kind === "claude" && v.canPrune).map(v => v.id));
  expect(result.results.map(r => r.status)).toEqual(["deleted", "refused", "failed", "deleted", "deleted"]);
  expect(result.results.find(r => r.status === "refused")?.reason).toBe("pinned");
  expect(result.freedBytes).toBe(161_000_000);
  expect((await api.runtimePrunePlan!()).versions.some(v => v.release === "claude-r0")).toBe(false);
  expect((await api.runtimes!())?.claude?.some(v => v.release === "claude-r3")).toBe(false);
});

it("merges discovered versions without altering pin counts or authorizing cleanup", () => {
  const raw = adaptRuntimes({ claude: [{ release: "claude-r3", selected: true, agentCount: 8 }] })!.claude;
  const merged = mergeRuntimePruneVersions(raw, [
    { id: "a", kind: "claude", release: "claude-r2", bytes: 1, canPrune: false, blockedReasons: ["rollback"] },
    { id: "b", kind: "claude", release: "claude-r2", bytes: 2, canPrune: true, blockedReasons: [] },
  ]);
  expect(merged).toHaveLength(2); expect(merged[0]).toBe(raw[0]);
  expect(merged[1]).toMatchObject({ release: "claude-r2", selected: false, missing: false, agentCount: 0, agents: [], path: null });
  expect(raw).toHaveLength(1);
});
