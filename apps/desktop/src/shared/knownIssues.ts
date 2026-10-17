// Known issues (Settings → 关于 → 已知问题): the machine-readable list `docs/known-issues.json`, schema 1.
// The app bundles that file (the built-in list) and the main process also fetches the copy on the public
// repo's `release` branch (main/knownIssues.ts), so publishing known issues needs only a docs push.
// Both pass `parseKnownIssues`: strict about what is used, unknown fields ignored, plain-text strings only.
//
//   { "schema": 1, "issues": [ {
//       "id": "phone",                                  // [A-Za-z0-9_-]{1,64}, unique
//       "title": { "zh-CN": "…", "en": "…", "zh-Hant-CN": "…" },   // zh-CN + en required, other app locales optional
//       "body": { … },                                  // same rules
//       "workaround": { … },                            // optional, same rules
//       "fixedIn": "0.1.3",                             // optional: "0.1.3" = desktop, "cutex 0.1.2" = the backend
//       "appliesTo": { "desktop": "<0.1.3", "cutex": ">=0.1.0 <0.1.2" }  // optional version ranges
//   } ] }
//
// An entry that breaks a rule is dropped (the rest still show); a document whose shape is wrong (schema
// other than 1, no issue list, too many issues) is rejected as a whole. Strings may carry `{{agent}}`-style
// term tokens (lib/terms.ts), nothing else is interpreted: no HTML, no Markdown, no links.
import { APP_LOCALES, type AppLocale } from "./locales";
import { compareVersions, parseVersion } from "./binaryUpdate";

export const KNOWN_ISSUES_SCHEMA = 1;
/** Repository path of the list (also its path on the `release` branch). */
export const KNOWN_ISSUES_PATH = "docs/known-issues.json";
export const KNOWN_ISSUES_MAX_BYTES = 256 * 1024;
export const MAX_ISSUES = 100;
export const MAX_LENGTH = { title: 200, body: 2000, workaround: 1000, fixedIn: 40, range: 100 } as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// C0 / C1 controls except \n, and the bidi overrides / isolates (no visual spoofing of the text).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

export type LocalizedText = Partial<Record<AppLocale, string>> & { "zh-CN": string; en: string };

export interface KnownIssueEntry {
  id: string;
  title: LocalizedText;
  body: LocalizedText;
  workaround?: LocalizedText;
  fixedIn?: string;
  appliesTo?: { desktop?: string; cutex?: string };
}

export interface KnownIssuesDoc {
  schema: 1;
  issues: KnownIssueEntry[];
}

/** What main answers for `knownIssues.get`: the release branch's list (fresh or the last good copy). */
export type KnownIssuesResult =
  | {
      source: "github";
      doc: KnownIssuesDoc;
      /** When this copy was fetched (ISO). */
      fetchedAt: string;
      /** The latest attempt failed; `doc` is the last good copy. */
      stale?: boolean;
      error?: string;
    }
  /** Never fetched successfully (offline, invalid, …): the renderer shows its built-in list. */
  | { source: "none"; error?: string };

export const KNOWN_ISSUES_CHANNEL = "cutex-desktop:known-issues";
export type KnownIssuesRequest = { op: "get"; refresh?: boolean };
export interface KnownIssuesBridge {
  /** The release branch's list; `refresh` fetches even when the copy is recent. */
  get(refresh?: boolean): Promise<KnownIssuesResult>;
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > max || FORBIDDEN.test(v)) return null;
  return v;
}

function localized(raw: unknown, max: number): LocalizedText | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<AppLocale, string>> = {};
  for (const locale of APP_LOCALES) {
    if (!(locale in src)) continue;
    const v = text(src[locale], max);
    if (v === null) return null;
    out[locale] = v;
  }
  if (!out["zh-CN"] || !out.en) return null;
  return out as LocalizedText;
}

interface Comparator {
  op: "<" | "<=" | ">" | ">=" | "=";
  version: NonNullable<ReturnType<typeof parseVersion>>;
}

/** A version range: space-separated comparators, all must hold (`<0.1.3`, `>=0.1.0 <0.1.2`, `=0.1.2`, `0.1.2`). */
export function parseRange(raw: unknown): Comparator[] | null {
  const v = text(raw, MAX_LENGTH.range);
  if (v === null) return null;
  const out: Comparator[] = [];
  for (const part of v.split(/\s+/)) {
    const m = /^(<=|>=|<|>|=)?(.+)$/.exec(part);
    const version = m ? parseVersion(m[2]) : null;
    if (!m || !version) return null;
    out.push({ op: (m[1] as Comparator["op"] | undefined) ?? "=", version });
  }
  return out.length ? out : null;
}

/** Whether `version` lies in `range`; an unknown / unparsable running version counts as inside (shown). */
export function inRange(range: string, version: string | null | undefined): boolean {
  const comparators = parseRange(range);
  const v = parseVersion(version ?? null);
  if (!comparators || !v) return true;
  return comparators.every(({ op, version: bound }) => {
    const c = compareVersions(v, bound);
    return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === ">=" ? c >= 0 : c === 0;
  });
}

function entry(raw: unknown): KnownIssueEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === "string" && ID.test(e.id) ? e.id : null;
  const title = localized(e.title, MAX_LENGTH.title);
  const body = localized(e.body, MAX_LENGTH.body);
  if (!id || !title || !body) return null;
  const out: KnownIssueEntry = { id, title, body };
  if (e.workaround !== undefined) {
    const workaround = localized(e.workaround, MAX_LENGTH.workaround);
    if (!workaround) return null;
    out.workaround = workaround;
  }
  if (e.fixedIn !== undefined) {
    const fixedIn = text(e.fixedIn, MAX_LENGTH.fixedIn);
    if (!fixedIn) return null;
    out.fixedIn = fixedIn;
  }
  if (e.appliesTo !== undefined) {
    if (!e.appliesTo || typeof e.appliesTo !== "object" || Array.isArray(e.appliesTo)) return null;
    const a = e.appliesTo as Record<string, unknown>;
    const appliesTo: { desktop?: string; cutex?: string } = {};
    for (const k of ["desktop", "cutex"] as const) {
      if (a[k] === undefined) continue;
      if (!parseRange(a[k])) return null;
      appliesTo[k] = (a[k] as string).trim();
    }
    if (appliesTo.desktop || appliesTo.cutex) out.appliesTo = appliesTo;
  }
  return out;
}

/** A validated list, or null when the document as a whole is unusable. */
export function parseKnownIssues(raw: unknown): KnownIssuesDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (d.schema !== KNOWN_ISSUES_SCHEMA || !Array.isArray(d.issues) || d.issues.length > MAX_ISSUES) return null;
  const issues: KnownIssueEntry[] = [];
  const seen = new Set<string>();
  for (const item of d.issues) {
    const e = entry(item);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    issues.push(e);
  }
  return { schema: 1, issues };
}

/** The entries that apply to the running desktop / connected cutex versions (unknown versions: all). */
export function applicableIssues(doc: KnownIssuesDoc, versions: { desktop?: string | null; cutex?: string | null }): KnownIssueEntry[] {
  return doc.issues.filter((e) => (!e.appliesTo?.desktop || inRange(e.appliesTo.desktop, versions.desktop)) && (!e.appliesTo?.cutex || inRange(e.appliesTo.cutex, versions.cutex)));
}

/** The string for `locale`: its own, zh-Hant-CN falls back to zh-CN, everything else to en. */
export function localizedText(value: LocalizedText, locale: AppLocale): string {
  return value[locale] ?? (locale === "zh-Hant-CN" ? value["zh-CN"] : undefined) ?? value.en;
}
