import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallLayout, ReleaseInfo } from "../shared/update";
import { sourceCommitFromReceipt } from "../shared/updateProvenance";

/** Fixed local paths, capped reads; receipts are optional and cannot supply paths or Git arguments. */
export function localSourceCommit(layout: InstallLayout, build: ReleaseInfo): string | null {
  const sources = new Set<string>();
  for (const path of [join(layout.releaseDir, "source-provenance.json"), join(layout.baseDir, "RELEASE-RECEIPT.json")]) {
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 256 * 1024) continue;
      const source = sourceCommitFromReceipt(JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")), build);
      if (source) sources.add(source);
    } catch {
      // Old installations have no receipt; missing, malformed or stale metadata is not divergence.
    }
  }
  return sources.size === 1 ? [...sources][0]! : null;
}
