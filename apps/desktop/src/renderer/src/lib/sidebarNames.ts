// Shorter agent names inside a big project group (sidebar density, owner 2026-10-21): when most of a
// project's agents share a name prefix ("demo-annotate-…", "demo-cluster-…"), the sidebar shows the
// rest ("annotate-…") so the names are not all truncated to the same first letters. The full name
// stays in tooltips, search and menus (rows keep `name`; `shortName` is the shown label).

/** Characters a stripped prefix must end with. */
const SEPARATORS = new Set(["-", "_", ".", ":", "/", " "]);
/** A prefix is stripped only from this many characters (separator included) … */
export const MIN_PREFIX_CHARS = 3;
/** … and when at least this share of the group's agents carries it. */
export const MIN_PREFIX_SHARE = 0.6;

/**
 * The group's shared name prefixes, longest first: every prefix that ends at a separator (- _ . : /
 * or space), is at least MIN_PREFIX_CHARS long and starts at least MIN_PREFIX_SHARE (and at least
 * two) of `names`. Compared case-insensitively, returned lower-case. Two different prefixes of one
 * length cannot both pass the share, so the list is a chain ("demo-gpt-", "demo-").
 */
export function sharedNamePrefixes(names: readonly string[]): string[] {
  if (names.length < 2) return [];
  const need = Math.max(2, Math.ceil(names.length * MIN_PREFIX_SHARE - 1e-9));
  const counts = new Map<string, number>();
  for (const raw of names) {
    const name = raw.trim().toLowerCase();
    // A separator ending the whole name leaves nothing to show: only prefixes with a remainder count.
    for (let i = MIN_PREFIX_CHARS - 1; i < name.length - 1; i++) {
      if (!SEPARATORS.has(name[i]!)) continue;
      const prefix = name.slice(0, i + 1);
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= need).map(([p]) => p).sort((a, b) => b.length - a.length);
}

/** The longest shared prefix (`sharedNamePrefixes`), or "" when there is none. */
export function groupNamePrefix(names: readonly string[]): string {
  return sharedNamePrefixes(names)[0] ?? "";
}

/**
 * `name` without the longest of `prefixes` (longest first) it starts with (case-insensitive), the
 * original case kept. The rest must still hold a letter: "demo-worker-07" under "demo-worker-" would
 * be a bare "07", so the next shorter prefix applies ("worker-07"). null when none does.
 */
export function stripNamePrefix(name: string, prefixes: readonly string[]): string | null {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  for (const prefix of prefixes) {
    if (!lower.startsWith(prefix)) continue;
    const rest = trimmed.slice(prefix.length).replace(/^[\s\-_.:/]+/, "");
    if (/\p{L}/u.test(rest)) return rest;
  }
  return null;
}

/** Shown names of a group's agents (name → shorter name), only for the names that get shorter. */
export function shortNames(names: readonly string[]): Map<string, string> {
  const prefixes = sharedNamePrefixes(names);
  const out = new Map<string, string>();
  if (prefixes.length === 0) return out;
  for (const name of names) {
    const short = stripNamePrefix(name, prefixes);
    if (short !== null) out.set(name, short);
  }
  return out;
}
