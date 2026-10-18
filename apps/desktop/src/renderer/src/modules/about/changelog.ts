// 更新记录 on Settings → 关于: this desktop's release history, bundled at build time from CHANGELOG.md
// (shared/changelog.ts; regenerate with `node apps/desktop/scripts/bundle-changelog.mjs`,
// test/changelog.test.ts fails when the copy is stale). Released sections only, newest first.
import bundledJson from "./changelog.bundled.json";
import { readChangelogDoc, type ChangelogDoc, type ChangelogRelease } from "../../../../shared/changelog";
import { compareVersions, parseVersion } from "../../../../shared/binaryUpdate";

export const BUNDLED_CHANGELOG: ChangelogDoc = readChangelogDoc(bundledJson);

/** The newest version the owner has seen in 更新记录 (a per-viewer convenience: unavailable storage = nothing marked new). */
const SEEN_KEY = "cutex-desktop.about.changelogSeen";

export function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_KEY, version);
  } catch {
    // ignore: the same entries show as new next time
  }
}

/**
 * Versions newer than the one last seen (none on the first visit: without a baseline, everything
 * would be "new"). Unparsable versions are never new.
 */
export function newSince(releases: readonly ChangelogRelease[], seen: string | null): Set<string> {
  const base = seen ? parseVersion(seen) : null;
  if (!base) return new Set();
  return new Set(
    releases.filter((r) => {
      const v = parseVersion(r.version);
      return !!v && compareVersions(v, base) > 0;
    }).map((r) => r.version),
  );
}

/** The release to open first: the installed version's when it is listed, else the newest. */
export function initialOpen(releases: readonly ChangelogRelease[], installed: string | null | undefined): string | null {
  if (installed && releases.some((r) => r.version === installed)) return installed;
  return releases[0]?.version ?? null;
}

/** Inline Markdown of a changelog text as tokens: `code`, **bold**, [label](url) → label; the rest plain. */
export type InlineToken = { kind: "text" | "code" | "bold"; text: string };

export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)\s]+\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "code", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "bold", text: m[2] });
    else out.push({ kind: "text", text: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
