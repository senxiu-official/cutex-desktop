// Avatar initials for agents of one project (sidebar v2, owner 2026-10-12): every agent of a project
// usually shares its prefix ("proj-ceo-r1", "proj-gpt-research-r1"), so the plain first letter makes
// every avatar the same "V". The initial skips the project's prefix and role / revision suffixes.
// Only generated initials use this; custom avatar pictures / emoji are unchanged (components/Avatar).

/** Trailing revision / version suffixes: `-r1`, `-v12` (repeated: `-v2-r3`). */
const SUFFIX = /(?:[-_](?:r|v)\d+)+$/i;

/**
 * The longest `xxx-` prefix (ending at a separator) every name shares; "" for fewer than two names
 * or nothing shared. Compared case-insensitively.
 */
export function commonDashPrefix(names: readonly string[]): string {
  if (names.length < 2) return "";
  const lower = names.map((n) => n.trim().toLowerCase());
  let prefix = lower[0]!;
  for (const n of lower.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  const cut = Math.max(prefix.lastIndexOf("-"), prefix.lastIndexOf("_"));
  return cut < 0 ? "" : prefix.slice(0, cut + 1);
}

/**
 * The part of a name an initial is taken from: without a leading `<slug>-` (any of `slugs`, case-
 * insensitive) or the shared `prefix`, and without trailing `-r<n>` / `-v<n>`. Falls back to the
 * whole name when stripping would leave nothing.
 */
export function initialStem(name: string, prefix = "", slugs: readonly string[] = []): string {
  const trimmed = name.trim();
  let stem = trimmed;
  const lower = stem.toLowerCase();
  const slug = slugs.map((s) => s.trim().toLowerCase()).filter(Boolean).find((s) => lower.startsWith(`${s}-`) || lower.startsWith(`${s}_`));
  // The longer of the two (a shared "proj-gpt-" beats the slug "proj-").
  const lead = Math.max(slug ? slug.length + 1 : 0, prefix && lower.startsWith(prefix) ? prefix.length : 0);
  if (lead > 0 && lead < stem.length) stem = stem.slice(lead);
  const bare = stem.replace(SUFFIX, "");
  if (bare) stem = bare;
  return stem || trimmed;
}

/** First letter / digit (CJK: first character) of a stem, upper-cased; "?" when there is none. */
export function initialOf(stem: string): string {
  const chars = [...stem];
  const first = chars.find((c) => /[\p{L}\p{N}]/u.test(c)) ?? chars.find((c) => c.trim() !== "");
  return first ? first.toUpperCase() : "?";
}

/**
 * Initials of a project's agents, by name: the project's slug (id / display name) or the members'
 * longest shared `xxx-` prefix, whichever is longer, is skipped. proj-ceo-r1 → C, proj-gpt-research-r1 → G.
 */
export function projectInitials(names: readonly string[], slugs: readonly string[] = []): Map<string, string> {
  const prefix = commonDashPrefix(names);
  const out = new Map<string, string>();
  for (const name of names) out.set(name, initialOf(initialStem(name, prefix, slugs)));
  return out;
}
