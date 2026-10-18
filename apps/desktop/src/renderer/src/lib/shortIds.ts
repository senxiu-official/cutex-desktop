// Short cutex ids in agent-facing tool text (cutex task 06 "short ids"). Since that release the
// MCP tool results an agent sees — and so the desktop parses from its transcript — carry short
// ids: a session as its tail (`cutex.…3f9a1c`), every other kind as a prefix (`ask-123456`, since
// cutex prompt revision A8 `delegation-123456`,
// `q-…`, `doc-…`, `art-…`), at least 6 hex characters and longer only when needed to stay
// unique. Agents may also *write* a bare unique prefix / suffix (`019ab1`, `…abc123`, `...abc123`).
// Management v2 HTTP and the external-input views still carry full ids, so a parsed short id is
// resolved against ids the desktop already holds (sidebar agents, the delegation store); when it
// is unknown or ambiguous the row shows the text and links nothing. Older daemons send full ids,
// which pass through unchanged. Mirrors `query` / `Index::short` in cutex `src/short_ids.rs`.

export type IdKind = "session" | "ask" | "question" | "document" | "artifact";

const KIND_PREFIX: readonly (readonly [IdKind, string])[] = [
  ["session", "cutex."],
  ["ask", "ask-"],
  // cutex prompt revision A8 (117b2c8): agents see a delegation id as `delegation-<hex>` (stored `ask-`).
  ["ask", "delegation-"],
  ["question", "q-"],
  ["document", "doc-"],
  ["artifact", "art-"],
];
/** Hex digits of a full id (a uuid without dashes). */
const FULL_HEX = 32;
/** cutex's smallest accepted abbreviation (`agent_short_ids.min_len`, clamped to ≥ 6). */
const MIN_HEX = 6;

/**
 * A parsed id reference. `full`: a complete id. `suffix`: written with a leading ellipsis (the
 * session display form). `either`: a bare abbreviation; cutex matches it as a prefix or a suffix.
 */
export interface IdRef {
  kind: IdKind | null;
  hex: string;
  mode: "full" | "suffix" | "either";
}

/** The id reference `input` spells, or null when it is not a hex cutex id (a name, `ask-run`, `af-…`). */
export function parseIdRef(input: string | null | undefined): IdRef | null {
  if (typeof input !== "string") return null;
  const text = input.trim().toLowerCase();
  const hit = KIND_PREFIX.find(([, prefix]) => text.startsWith(prefix));
  const kind = hit?.[0] ?? null;
  // Artifact-store ids (`af-…`) are another namespace, never an abbreviation.
  if (!kind && text.startsWith("af-")) return null;
  let rest = hit ? text.slice(hit[1].length) : text;
  const ellipsis = rest.startsWith("…") ? 1 : rest.startsWith("...") ? 3 : 0;
  rest = rest.slice(ellipsis);
  const hex = rest.replace(/-/g, "");
  if (!hex || !/^[0-9a-f]+$/.test(hex)) return null;
  if (!ellipsis && hex.length === FULL_HEX) return { kind, hex, mode: "full" };
  if (hex.length > FULL_HEX) return null;
  return { kind, hex, mode: ellipsis ? "suffix" : "either" };
}

/** A short form (`cutex.…3f9a1c`, `ask-123456`, `019ab1`) — not a full id, not a name. */
export function isShortId(input: string | null | undefined): boolean {
  const ref = parseIdRef(input);
  return !!ref && ref.mode !== "full";
}

/** A session reference (full `cutex.<uuid>` or its short form): an id, not an agent name. */
export function isSessionRef(input: string | null | undefined): boolean {
  return typeof input === "string" && input.trim().toLowerCase().startsWith("cutex.");
}

const kindsAgree = (a: IdRef, b: IdRef) => !a.kind || !b.kind || a.kind === b.kind;

function abbreviates(short: IdRef, full: IdRef): boolean {
  if (short.hex.length < MIN_HEX || !kindsAgree(short, full)) return false;
  if (short.mode === "suffix") return full.hex.endsWith(short.hex);
  return full.hex.startsWith(short.hex) || full.hex.endsWith(short.hex);
}

/**
 * Whether two references can name the same object: equal strings, a full id and an abbreviation
 * of it, or two abbreviations where one extends the other (a display form that grew longer after
 * a new collision). Two different full ids never match.
 */
export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = parseIdRef(a);
  const y = parseIdRef(b);
  if (!x || !y || !kindsAgree(x, y)) return false;
  if (x.mode === "full" && y.mode === "full") return x.hex === y.hex;
  if (x.mode === "full") return abbreviates(y, x);
  if (y.mode === "full") return abbreviates(x, y);
  if (x.mode !== y.mode) return false;
  const [shorter, longer] = x.hex.length <= y.hex.length ? [x.hex, y.hex] : [y.hex, x.hex];
  return x.mode === "suffix" ? longer.endsWith(shorter) : longer.startsWith(shorter);
}

/**
 * The full id among `candidates` that `input` names: itself when listed, else the one candidate
 * a short form abbreviates. null when unknown or ambiguous (show the text, link nothing).
 */
export function resolveId(input: string | null | undefined, candidates: Iterable<string>): string | null {
  if (!input) return null;
  const ref = parseIdRef(input);
  const matches = new Set<string>();
  for (const id of candidates) {
    if (id === input) return id;
    if (!ref) continue;
    const full = parseIdRef(id);
    if (full?.mode !== "full") continue;
    // A full id in another spelling (case, no dashes, no kind) or an abbreviation of one.
    if (ref.mode === "full" ? kindsAgree(ref, full) && ref.hex === full.hex : abbreviates(ref, full)) matches.add(id);
  }
  return matches.size === 1 ? [...matches][0]! : null;
}

/** The entry of `map` whose key names the same object as `ref` (exact key first, then a unique match). */
export function findById<T>(map: ReadonlyMap<string, T>, ref: string | null | undefined): T | undefined {
  if (!ref) return undefined;
  const exact = map.get(ref);
  if (exact !== undefined) return exact;
  let hit: T | undefined;
  let hits = 0;
  for (const [key, value] of map) {
    if (sameId(key, ref)) {
      hit = value;
      if (++hits > 1) return undefined;
    }
  }
  return hit;
}
