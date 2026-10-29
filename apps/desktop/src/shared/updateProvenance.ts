import type { ReleaseInfo } from "./update";

const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

/** Owner-local metadata only: never added to a public package or EXPORT-MANIFEST. */
export function sourceCommitFromReceipt(raw: unknown, build: Pick<ReleaseInfo, "commit" | "version">): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  // New local installation record, or the legacy private release-build receipt (0.2.0 / 0.2.1).
  const packaged = v.build ?? v.publicStagingCommit;
  const source = v.sourceCommit ?? v.privateProductCommit ?? v.buildPrivateProductCommit;
  if (packaged !== build.commit || !hash(source) || !build.version || v.version !== build.version) return null;
  return source;
}
