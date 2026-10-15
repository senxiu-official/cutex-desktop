// Host-scoped desktop prefs (multi-host RFC §6.1 / §6.4). Agent and project ids are only unique per
// host, so the per-device prefs that name them (turn marks, pins, project order, folds, stars) are
// stored under host keys `JSON.stringify([hostId, id])` — the same convention as lib/composerDrafts.
// The app shows one host at a time (P0: the focus host), so readers keep seeing bare ids: each store
// projects its entries onto the focus host.
//
// Migration (★ Q18, one-time, forward only): entries written before multi-host carry a bare id. Such
// a legacy entry stays visible on every host until the first host whose sidebar snapshot lists the id
// claims it (rewritten to that host's key; the owner may have pinned a remote host's agent in that host's mode, so
// they cannot all be `local`). Legacy entries never claimed are dropped 30 days after the first start
// of this version.

export type HostKey = string;

export const hostKey = (hostId: string, id: string): HostKey => JSON.stringify([hostId, id]);

/** [hostId, id] of a host key; null for a legacy bare id. */
export function parseHostKey(key: string): [string, string] | null {
  if (!key.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(key) as unknown;
    return Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && typeof parsed[1] === "string" ? [parsed[0], parsed[1]] : null;
  } catch {
    return null;
  }
}

// ---------- focus host ----------

let focus = "local";
const focusListeners = new Set<() => void>();

/** The host the projections show (store.ts, on every host notification). */
export function setKeyFocus(hostId: string): void {
  if (hostId === focus) return;
  focus = hostId;
  for (const listener of [...focusListeners]) {
    try {
      listener();
    } catch {
      // one projection failing must not keep the others on the old host
    }
  }
}

export function keyFocus(): string {
  return focus;
}

/** The host the app shows (P0: the scope host); host-scoped events of other hosts are not this store's. */
export const focusHostId = keyFocus;

export function onKeyFocus(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

// ---------- projections ----------

/** The focus host's ids of a host-keyed list, in order (legacy bare ids included until claimed). */
export function projectList(list: readonly string[], hostId = focus): string[] {
  const out: string[] = [];
  for (const entry of list) {
    const key = parseHostKey(entry);
    if (!key) out.push(entry);
    else if (key[0] === hostId) out.push(key[1]);
  }
  return out;
}

/**
 * A new list after the focus host's ids became `ids`: other hosts' entries stay; legacy bare ids that
 * are still listed stay bare (not claimed yet: they may belong to another host); the rest is keyed.
 */
export function writeList(list: readonly string[], ids: readonly string[], hostId = focus): string[] {
  const legacy = new Set(list.filter((entry) => !parseHostKey(entry)));
  const others = list.filter((entry) => {
    const key = parseHostKey(entry);
    return key !== null && key[0] !== hostId;
  });
  return [...others, ...ids.map((id) => (legacy.has(id) ? id : hostKey(hostId, id)))];
}

/** `list` with legacy entries matching `claims` rewritten to `hostId`'s keys (the same array when none). */
export function claimList(list: readonly string[], hostId: string, claims: (entry: string) => boolean): readonly string[] {
  let changed = false;
  const next = list.map((entry) => {
    if (parseHostKey(entry) || !claims(entry)) return entry;
    changed = true;
    return hostKey(hostId, entry);
  });
  return changed ? [...new Set(next)] : list;
}

/** `list` without legacy bare entries (the same array when none). */
export function dropLegacy(list: readonly string[]): readonly string[] {
  return list.some((entry) => !parseHostKey(entry)) ? list.filter((entry) => parseHostKey(entry) !== null) : list;
}

/** The focus host's entries of a host-keyed record, keyed by bare id (legacy bare keys included until claimed). */
export function projectRecord<T>(record: Readonly<Record<string, T>>, hostId = focus): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [entry, value] of Object.entries(record)) {
    const key = parseHostKey(entry);
    if (!key) {
      if (!(entry in out)) out[entry] = value;
    } else if (key[0] === hostId) out[key[1]] = value;
  }
  return out;
}

// ---------- claims ----------

export interface HostKeyed {
  /** Rewrite legacy entries whose id `hostId` lists. */
  claim(hostId: string, ids: ReadonlySet<string>): void;
  /** Drop every legacy entry (30 days after the migration started). */
  dropLegacy(): void;
}

const keyed = new Set<HostKeyed>();

export function registerHostKeyed(store: HostKeyed): void {
  keyed.add(store);
  if (legacyExpired()) store.dropLegacy();
}

/** A host's sidebar snapshot listed these agent / project ids (store.ts, every host). */
export function claimHostIds(hostId: string, ids: ReadonlySet<string>): void {
  if (legacyExpired()) {
    for (const store of keyed) store.dropLegacy();
    return;
  }
  for (const store of keyed) {
    try {
      store.claim(hostId, ids);
    } catch {
      // storage unavailable: try again with the next snapshot
    }
  }
}

const MIGRATION_KEY = "cutex-desktop.hostKeys";
export const LEGACY_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let since: number | null = null;

/** When this version first ran (ms); written once. */
export function legacySince(now = Date.now()): number {
  if (since !== null) return since;
  try {
    const stored = JSON.parse(localStorage.getItem(MIGRATION_KEY) ?? "null") as { since?: unknown } | null;
    if (stored && typeof stored.since === "number" && Number.isFinite(stored.since)) return (since = stored.since);
    localStorage.setItem(MIGRATION_KEY, JSON.stringify({ v: 1, since: now }));
  } catch {
    // storage unavailable: count from this start
  }
  return (since = now);
}

export function legacyExpired(now = Date.now()): boolean {
  return now - legacySince(now) > LEGACY_KEY_TTL_MS;
}

/** Tests: forget the cached migration start. */
export function resetHostKeysForTest(): void {
  since = null;
  focus = "local";
}
