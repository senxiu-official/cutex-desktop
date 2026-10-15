// cutex build identity: `GET /v2/capabilities` `cutexBuild` (cutex `build_info.rs`, r224+), which
// replaced `cutexVersion` / `gitSha`. `version` is the Cargo version (never bumped, not a release id);
// release / commit / builtAt are null on builds that did not set CUTEX_RELEASE / CUTEX_COMMIT /
// CUTEX_BUILD_TIME (dev builds).

export interface CutexBuild {
  version: string;
  release: string | null;
  commit: string | null;
  builtAt: string | null;
  profile: "release" | "debug";
  /** cutex upgrade channel: `release` / `main` (older cutex said `stable` / `dev`; read as these). */
  channel: "main" | "release";
}

/** `cutexBuild` of a capabilities response; null when absent (cutex before r224) or malformed. */
export function readCutexBuild(caps: unknown): CutexBuild | null {
  const raw = caps && typeof caps === "object" ? (caps as { cutexBuild?: unknown }).cutexBuild : undefined;
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  return {
    version: str(b.version) ?? "?",
    release: str(b.release),
    commit: str(b.commit),
    builtAt: str(b.builtAt),
    profile: b.profile === "debug" ? "debug" : "release",
    channel: b.channel === "release" || b.channel === "stable" ? "release" : "main",
  };
}

/**
 * Short build label in the desktop's `commit · date` style: `r224 · 5f30a7c`, `5f30a7c` (commit
 * only) or `r224` (release only), plus ` · <builtAt date>` when known. Null for a build without
 * release and commit (callers show "dev build"). The channel is not part of it (see
 * `cutexBuildChannelTag`).
 */
export function cutexBuildLabel(build: CutexBuild | null | undefined): string | null {
  if (!build) return null;
  const parts = [build.release, build.commit?.slice(0, 7) ?? null].filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  const date = build.builtAt ? build.builtAt.slice(0, 16).replace("T", " ") : null;
  return [...parts, ...(date ? [date] : [])].join(" · ");
}

/** The channel worth showing next to the label: only `release`; null for `main` (dev builds). */
export function cutexBuildChannelTag(build: CutexBuild | null | undefined): string | null {
  return build && build.channel !== "main" ? build.channel : null;
}
