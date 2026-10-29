import { describe, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/bridge", () => ({ bridge: {} }));
import { updateSummary } from "../src/renderer/src/lib/update";
import type { UpdateStatus } from "../src/shared/ipc";

const latest: NonNullable<UpdateStatus["latest"]> = { commit: "b".repeat(40), committedAt: "", subject: "merged release", count: 3, sourceBuild: true };
const translate = (key: string, vars?: Record<string, string | number>) => JSON.stringify({ key, ...vars });

describe("source update wording", () => {
  it("describes an ancestor on main as unreleased development commits", () => {
    expect(JSON.parse(updateSummary(translate, { ...latest, sourceComparison: "ahead" }))).toEqual({ key: "update.sourceAhead", count: 3, subject: latest.subject });
  });
  it("offers a development switch without claiming an exported release is a fork", () => {
    expect(JSON.parse(updateSummary(translate, { ...latest, sourceComparison: "unknown", installedReleaseVersion: "0.2.1" }))).toEqual({ key: "update.sourceUnknown", version: "0.2.1", subject: latest.subject });
    expect(JSON.parse(updateSummary(translate, { ...latest, sourceComparison: "unknown" }, "release"))).toEqual({ key: "update.sourceUnknownBranch", branch: "release", subject: latest.subject });
  });
  it("keeps genuine divergence, explicit channel switches and binary releases distinct", () => {
    expect(JSON.parse(updateSummary(translate, { ...latest, sourceComparison: "diverged", offMain: true })).key).toBe("update.offMain");
    expect(JSON.parse(updateSummary(translate, { ...latest, switchChannel: true })).key).toBe("updater.switchChannel");
    expect(JSON.parse(updateSummary(translate, { ...latest, version: "0.2.2" })).key).toBe("update.availableVersion");
  });
});
