// Avatar initials for agents of one project (sidebar v2, owner 2026-10-12): every agent of a project
// usually shares its prefix ("proj-ceo-r1", "proj-gpt-research-r1"), so the plain first letter makes
// every avatar the same "V". The initial skips the project's prefix and role / revision suffixes.
// Only generated initials use this; custom avatar pictures / emoji are unchanged (components/Avatar). Since 2026-11-01
// two letters (twoLetterInitials below).

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
 * Initials of a project's agents, by name (listInitials in the given order): the project's slug (id / display name) or
 * the members' longest shared `xxx-` prefix, whichever is longer, is skipped. proj-ceo-r1 → Ce, proj-gpt-research-r1 → GR.
 */
export function projectInitials(names: readonly string[], slugs: readonly string[] = []): Map<string, string> {
  return listInitials(names.map((name, i) => ({ key: name, name, order: String(i).padStart(6, "0") })), slugs);
}

// Two-letter initials (owner 2026-11-01: single letters on the same fill read alike — P / M / R). From the stem:
// - one word → its first two letters, first upper, second lower: Pipit → Pi, Moth → Mo, 2026 → 20;
// - several parts (`-` / `_` / space / `.` / camelCase) → the initials of the first and the last part, upper:
//   review-insert-sol → RS, review-insert-opus → RO, uiLead → UL (the last part is usually what tells siblings apart);
// - CJK (the stem starts with a Han / kana / Hangul character) → that one character: a hanzi says as much as a
//   Latin pair, and two would not read in a 16–20 px tile; CJK parts after a Latin one are skipped (Rust 生命周期 → Ru);
// - no letter or digit at all (emoji) → the first character as it is; empty → "?".
// A clash in one list (agentInitials listInitials) takes the next candidate (initialCandidates).

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}]/u;

/** The stem's parts: split at separators and camelCase humps (`uiLead` → ui, Lead), each kept only with a letter / digit. */
function partsOf(stem: string): string[] {
  return stem
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[\s\-_.·/]+/u)
    .map((p) => [...p].filter((c) => WORD.test(c)).join(""))
    .filter(Boolean);
}

const upper = (c: string) => c.toUpperCase();
const lower = (c: string) => c.toLowerCase();

/** Every initial a stem may take, best first (the first is its plain initials; the rest break a clash). */
export function initialCandidates(stem: string): string[] {
  const chars = [...stem.trim()];
  const firstWord = chars.find((c) => WORD.test(c));
  if (!firstWord) {
    const first = chars.find((c) => c.trim() !== "");
    return [first ?? "?"];
  }
  if (CJK.test(firstWord)) return [...new Set(chars.filter((c) => CJK.test(c)))];
  // Parts in another script (`Rust 生命周期报错`) are left out: R生 reads as neither.
  const parts = partsOf(stem).filter((p) => !CJK.test([...p][0]!));
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  const head = upper([...parts[0]!][0]!);
  if (parts.length >= 2) {
    add(head + upper([...parts[parts.length - 1]!][0]!));
    for (const p of parts.slice(1, -1)) add(head + upper([...p][0]!));
  }
  const letters = parts.flatMap((p) => [...p]);
  if (letters.length === 1) add(head);
  for (const c of letters.slice(1)) add(head + lower(c));
  return out;
}

/** A stem's two-letter initials (see above). */
export const twoLetterInitials = (stem: string): string => initialCandidates(stem)[0]!;

/**
 * The initials of one list (a project's agents, the independent agents): each its two letters (twoLetterInitials of
 * initialStem — the project's slug / shared prefix and revision suffixes skipped), and when two would match, the later
 * one (`order`, e.g. its creation time; then the key) takes its next candidate — so adding an agent never changes the
 * letters of one already there. Keyed by `key`.
 */
export function listInitials(items: readonly { key: string; name: string; order?: string | null }[], slugs: readonly string[] = [], stripPrefix = true): Map<string, string> {
  const prefix = stripPrefix ? commonDashPrefix(items.map((i) => i.name)) : "";
  const sorted = [...items].sort((a, b) => (a.order ?? "").localeCompare(b.order ?? "") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const item of sorted) {
    const candidates = initialCandidates(initialStem(item.name, prefix, slugs));
    const pick = candidates.find((c) => !taken.has(c)) ?? candidates[0]!;
    taken.add(pick);
    out.set(item.key, pick);
  }
  return out;
}
