import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sourceCommitFromReceipt } from "../src/shared/updateProvenance";
import { localSourceCommit } from "../src/main/updateProvenance";
import { installLayout, parseReleaseInfo } from "../src/shared/update";

const build = { commit: "a".repeat(40), version: "0.2.1" };
const source = "b".repeat(40);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("private installation provenance", () => {
  it("matches new records and legacy 0.2.0/0.2.1 build receipts to the exact packaged version/hash", () => {
    for (const record of [
      { ...build, build: build.commit, sourceCommit: source },
      { version: build.version, publicStagingCommit: build.commit, privateProductCommit: source },
      { version: build.version, publicStagingCommit: build.commit, buildPrivateProductCommit: source },
    ]) expect(sourceCommitFromReceipt(record, build)).toBe(source);
    for (const record of [null, [], { build: build.commit, version: "0.2.0", sourceCommit: source },
      { build: "c".repeat(40), version: build.version, sourceCommit: source },
      { build: build.commit, version: build.version, sourceCommit: "--upload-pack=x" },
      { build: build.commit, version: build.version, sourceCommit: "b".repeat(39) },
      { version: build.version, publicStagingCommit: build.commit, releaseBranchTip: source },
    ]) expect(sourceCommitFromReceipt(record, build)).toBeNull();
  });

  it("reads only fixed, bounded, exact-build records; malformed, stale and conflicting mappings stay unknown", () => {
    const root = mkdtempSync(join(tmpdir(), "update-provenance-")); roots.push(root);
    const release = join(root, "releases", "export"); mkdirSync(release, { recursive: true });
    const layout = installLayout(join(release, "cutex"), "/");
    const info = parseReleaseInfo({ ...build, sourceDir: null, nodeDir: null });
    if ("reason" in layout || "reason" in info) throw new Error("invalid test layout");
    const sidecar = join(release, "source-provenance.json"), legacy = join(root, "RELEASE-RECEIPT.json");
    expect(localSourceCommit(layout, info)).toBeNull();
    writeFileSync(sidecar, "not json"); expect(localSourceCommit(layout, info)).toBeNull();
    writeFileSync(sidecar, JSON.stringify({ version: "0.2.0", build: build.commit, sourceCommit: source }));
    expect(localSourceCommit(layout, info)).toBeNull();
    writeFileSync(legacy, "\uFEFF" + JSON.stringify({ version: build.version, publicStagingCommit: build.commit, privateProductCommit: source }));
    expect(localSourceCommit(layout, info)).toBe(source);
    writeFileSync(sidecar, JSON.stringify({ version: build.version, build: build.commit, sourceCommit: "c".repeat(40) }));
    expect(localSourceCommit(layout, info)).toBeNull();
    writeFileSync(sidecar, JSON.stringify({ version: build.version, build: build.commit, sourceCommit: source }));
    expect(localSourceCommit(layout, info)).toBe(source);
    writeFileSync(sidecar, " ".repeat(256 * 1024 + 1)); rmSync(legacy);
    expect(localSourceCommit(layout, info)).toBeNull();
  });
});
