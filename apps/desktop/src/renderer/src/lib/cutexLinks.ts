// `cutex:<kind>/<key>` links and images in Markdown (docs/desktop-modules.md §19.6, contract 1.7):
// agent replies, reports and memory cite module-defined targets this way, e.g.
// `[regression.md v4](cutex:artifact/af-…@4)`. Pure helpers (tested): parsing, the escape that carries
// the href through streamdown's `sanitize` (which drops unknown protocols), and the ref a link
// stands for. Core only knows the form; which kinds are live is decided by the `ref.target` slot.
// Shell file: no feature names.
import type { CutexRef } from "../modules/slots";
import { BUILTIN_REF_KINDS, REF_KIND, REF_MAX_KEY, REF_MAX_TITLE } from "./refs";

/** Fragment prefix of an escaped `cutex:` href / src (like workspace.ts FILE_HREF_ESCAPE). */
export const CUTEX_HREF_ESCAPE = "#cutex-ref:";

export interface CutexLinkTarget {
  kind: string;
  key: string;
}

const SCHEME = /^cutex:/i;
// eslint-disable-next-line no-control-regex -- a key as written: no whitespace, no control characters
const BAD_KEY = /[\s\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex -- the decoded key may hold spaces, never control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * `cutex:<kind>/<key>` → its kind and key, or null. The kind follows the ref kind rule (lowercase);
 * the key is everything after the first `/`, non-empty, without whitespace, `?` or `#` as written, `%xx`
 * decoded once (kept as written when that fails). `cutex://…` is not this form.
 */
export function parseCutexLink(href: string | null | undefined): CutexLinkTarget | null {
  if (typeof href !== "string" || !SCHEME.test(href)) return null;
  const rest = href.slice("cutex:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const kind = rest.slice(0, slash);
  const raw = rest.slice(slash + 1);
  if (!REF_KIND.test(kind) || !raw || /[?#]/.test(raw) || BAD_KEY.test(raw)) return null;
  let key = raw;
  try {
    key = decodeURIComponent(raw);
  } catch {
    key = raw;
  }
  if (!key || key.length > REF_MAX_KEY || CONTROL.test(key)) return null;
  return { kind, key };
}

/** Kinds a link may name: not the built-in ones (they need params; agent text must not move the UI). */
export function linkableKind(kind: string): boolean {
  return !BUILTIN_REF_KINDS.includes(kind);
}

/** Escape a `cutex:` href / src before `sanitize`; null = not a cutex link (leave it alone). */
export function escapeCutexHref(href: string): string | null {
  return parseCutexLink(href) ? CUTEX_HREF_ESCAPE + encodeURIComponent(href) : null;
}

/** The original `cutex:` href of an escaped one; null = not an escaped cutex link. */
export function unescapeCutexHref(href: string | null | undefined): string | null {
  if (typeof href !== "string" || !href.startsWith(CUTEX_HREF_ESCAPE)) return null;
  try {
    const original = decodeURIComponent(href.slice(CUTEX_HREF_ESCAPE.length));
    return parseCutexLink(original) ? original : null;
  } catch {
    return null;
  }
}

/** The ref a link stands for (title = the link text, clipped; the key when there is no text). */
export function cutexLinkRef(hostId: string, target: CutexLinkTarget, text: string): CutexRef {
  const title = text.replace(/\s+/g, " ").trim().slice(0, REF_MAX_TITLE) || target.key.slice(0, REF_MAX_TITLE);
  return { hostId, kind: target.kind, key: target.key, title, params: {} };
}

/** The canonical href of a target (copy link). */
export function cutexHref(target: CutexLinkTarget): string {
  return `cutex:${target.kind}/${target.key}`;
}
