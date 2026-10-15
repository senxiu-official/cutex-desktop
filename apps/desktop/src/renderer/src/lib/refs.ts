// CutexRef (docs/desktop-modules.md §19): stored pointers to turns, agents, pages, side instances and
// module-defined targets. Everything that reads one (bookmarks, note sources, links) validates it
// here first, every time — stored data is untrusted. Also the `ref.target` ownership check: each
// kind has one provider; built-in kinds and side component ids are taken.
import type { CutexRef, RefParams, RefSnapshot } from "../modules/slots";

export const REF_KIND = /^[a-z][a-z0-9.:-]{0,99}$/;
export const REF_PARAM_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const REF_MAX_PARAMS = 32;
export const REF_MAX_PARAM = 8000;
export const REF_MAX_TITLE = 200;
export const REF_MAX_KEY = 2000;
export const REF_MAX_SNIPPET = 500;
/** Kinds the shell / core open itself (§19 kind table). */
export const BUILTIN_REF_KINDS: readonly string[] = ["turn", "agent", "main.page", "side.page"];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** Untrusted JSON → a valid ref, or null. Unknown fields are dropped; nothing is coerced. */
export function parseRef(raw: unknown): CutexRef | null {
  if (!isRecord(raw)) return null;
  const hostId = str(raw.hostId, 200);
  const kind = str(raw.kind, 100);
  const key = str(raw.key, REF_MAX_KEY);
  const title = str(raw.title, REF_MAX_TITLE);
  if (!hostId || !kind || !REF_KIND.test(kind) || key === null || !key || title === null) return null;
  if (!isRecord(raw.params)) return null;
  const entries = Object.entries(raw.params);
  if (entries.length > REF_MAX_PARAMS) return null;
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, value] of entries) {
    if (!REF_PARAM_NAME.test(name) || name === "__proto__" || name === "constructor" || name === "prototype") return null;
    const v = str(value, REF_MAX_PARAM);
    if (v === null) return null;
    params[name] = v;
  }
  const ref: CutexRef = { hostId, kind, key, title, params: { ...params } as RefParams };
  if (raw.snapshot !== undefined) {
    if (!isRecord(raw.snapshot)) return null;
    const at = str(raw.snapshot.at, 40);
    if (!at) return null;
    const snapshot: RefSnapshot = { at };
    const icon = str(raw.snapshot.icon, 60);
    const agentName = str(raw.snapshot.agentName, 200);
    const snippet = typeof raw.snapshot.snippet === "string" ? raw.snapshot.snippet.slice(0, REF_MAX_SNIPPET) : null;
    if (icon) snapshot.icon = icon;
    if (agentName) snapshot.agentName = agentName;
    if (snippet) snapshot.snippet = snippet;
    ref.snapshot = snapshot;
  }
  return ref;
}

// ── Builders of the built-in kinds (§19.9 kind table) ──────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** "10-09 14:20" (local time) of a unix time in seconds. */
export function shortTime(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A turn's title: 「Lead · #36 · 10-09 14:20」 (the ordinal only when known). */
export function turnTitle(agentName: string, ordinal: number | null | undefined, startedAt: number | null | undefined): string {
  return [agentName, ordinal ? `#${ordinal}` : null, startedAt ? shortTime(startedAt) : null].filter(Boolean).join(" · ").slice(0, REF_MAX_TITLE);
}

export interface TurnRefInput {
  hostId: string;
  sessionId: string;
  turnId: string;
  agentName?: string;
  startedAt?: number | null;
  ordinal?: number | null;
  threadId?: string | null;
  /** Plain text of the turn (the user's message / the reply), clipped to 500. */
  snippet?: string;
  /** ISO capture time (default now). */
  at?: string;
}

/** `turn`: key `<sessionId>:<turnId>`; params sessionId, turnId, threadId?, ordinal?. */
export function turnRef(i: TurnRefInput): CutexRef {
  const snippet = i.snippet?.replace(/\s+/g, " ").trim().slice(0, REF_MAX_SNIPPET);
  return {
    hostId: i.hostId,
    kind: "turn",
    key: `${i.sessionId}:${i.turnId}`,
    title: turnTitle(i.agentName ?? i.sessionId, i.ordinal, i.startedAt),
    params: { sessionId: i.sessionId, turnId: i.turnId, ...(i.threadId ? { threadId: i.threadId } : {}), ...(i.ordinal ? { ordinal: String(i.ordinal) } : {}) },
    snapshot: { at: i.at ?? new Date().toISOString(), ...(i.agentName ? { agentName: i.agentName.slice(0, 200) } : {}), ...(snippet ? { snippet } : {}) },
  };
}

/** `agent`: key `<sessionId>`. */
export function agentRef(hostId: string, sessionId: string, name: string): CutexRef {
  return { hostId, kind: "agent", key: sessionId, title: name.slice(0, REF_MAX_TITLE), params: { sessionId }, snapshot: { at: new Date().toISOString(), agentName: name.slice(0, 200) } };
}

/** `side.page`: key `<pageId>`; params pageId, groups (comma-separated). Meaningful on this device only. */
export function sidePageRef(hostId: string, page: { id: string; groups: readonly string[] }, title: string): CutexRef {
  return { hostId, kind: "side.page", key: page.id, title: title.slice(0, REF_MAX_TITLE), params: { pageId: page.id, groups: page.groups.join(",") } };
}

/** `main.page`: key `<pageId>:<params JSON>` (params already passed through the page's refParams). */
export function mainPageRef(hostId: string, page: string, params: Readonly<Record<string, string>>, title: string): CutexRef {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const json = JSON.stringify(sorted);
  return { hostId, kind: "main.page", key: `${page}:${json}`.slice(0, REF_MAX_KEY), title: title.slice(0, REF_MAX_TITLE), params: { page, pageParams: json } };
}

/** Flat string params from a `main.page` ref's pageParams JSON; null = not valid. */
export function pageParamsOf(json: string | undefined): Record<string, string> | null {
  try {
    const parsed = JSON.parse(json ?? "{}") as unknown;
    if (!isRecord(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== "string" || !REF_PARAM_NAME.test(k)) return null;
      out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

interface RefContributor {
  id: string;
  contributes?: { readonly "ref.target"?: readonly { kind: string }[]; readonly "side.component"?: readonly { id: string }[] };
}

/**
 * Registration check for `ref.target` (app validate): a kind may have one provider; built-in kinds
 * and side component ids are taken; an earlier module keeps its kind even while it is off.
 */
export function checkRefContributions(candidates: readonly RefContributor[], existing: readonly RefContributor[]): Map<string, string> {
  const rejected = new Map<string, string>();
  const taken = new Map<string, string>();
  for (const kind of BUILTIN_REF_KINDS) taken.set(kind, "(built-in)");
  for (const module of [...existing, ...candidates]) for (const c of module.contributes?.["side.component"] ?? []) if (!taken.has(c.id)) taken.set(c.id, module.id);
  for (const module of existing) for (const t of module.contributes?.["ref.target"] ?? []) if (!taken.has(t.kind)) taken.set(t.kind, module.id);
  for (const module of candidates) {
    for (const t of module.contributes?.["ref.target"] ?? []) {
      const owner = taken.get(t.kind);
      if (!REF_KIND.test(t.kind)) rejected.set(module.id, `ref.target kind "${t.kind}" is not a valid ref kind`);
      else if (owner !== undefined && owner !== module.id) rejected.set(module.id, `ref.target kind "${t.kind}" is already provided by ${owner}`);
      else taken.set(t.kind, module.id);
    }
  }
  return rejected;
}
