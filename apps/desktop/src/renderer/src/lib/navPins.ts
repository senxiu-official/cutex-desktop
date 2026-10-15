// The sidebar's top entries (`nav.primary`, area "top"): a first screen of pinned entries and a last
// row 「更多」 with the rest (owner 2026-10-14). Pure model, unit-tested in test/navPins.test.ts; the
// pin list is a per-device desktop pref (lib/prefs `navPins`, not per host) like the title bar's
// launcher pins (lib/sideLaunchers), but ordered: entries show in the order they were pinned.
//
// An unpinned entry that needs the owner right now (its badge is `attention`, e.g. 审批 ⚠ 2)
// surfaces in the first screen after the pinned ones until that clears; 「更多」 carries a dot while
// a folded entry has attention (none can, as such entries surface, unless they are unavailable).

/** Pinned until the owner changes the pins: 新建智能体, 快速启动, 委托, 审批 (in this order). */
export const DEFAULT_NAV_PINS: readonly string[] = ["agent-config.newAgent", "quick-chats.nav", "delegations.nav", "approvals.nav"];
const ID = /^[A-Za-z0-9:._-]{1,200}$/;
const MAX = 100;

/** The stored pin list (null = never changed: the defaults). */
export function migrateNavPins(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.filter((id): id is string => typeof id === "string" && ID.test(id)))].slice(0, MAX);
}

/** The pins in effect. */
export function navPins(stored: readonly string[] | null): readonly string[] {
  return stored ?? DEFAULT_NAV_PINS;
}

/** The pin list with `id` pinned (appended: the newest pin comes last) or unpinned. */
export function withNavPin(stored: readonly string[] | null, id: string, on: boolean): string[] {
  const pins = navPins(stored).filter((p) => p !== id);
  return on ? [...pins, id].slice(-MAX) : pins;
}

export interface NavLayout {
  /** Pinned entries that exist here, in pin order. */
  pinned: string[];
  /** Unpinned entries that need the owner now (entry order), shown after the pinned ones. */
  surfaced: string[];
  /** Everything else (entry order): only in 「更多」. */
  folded: string[];
  /** A folded entry has attention (the 「更多」 dot). */
  moreAttention: boolean;
}

/**
 * Split the available entries (`ids`, in their slot order) into the first screen and 「更多」.
 * `attention`: entries whose badge needs the owner; `available`: entries that can surface (a disabled
 * one stays folded even with a count).
 */
export function layoutNav(ids: readonly string[], stored: readonly string[] | null, attention: ReadonlySet<string>, available: (id: string) => boolean = () => true): NavLayout {
  const present = new Set(ids);
  const pinnedSet = new Set(navPins(stored));
  const pinned = navPins(stored).filter((id) => present.has(id));
  const unpinned = ids.filter((id) => !pinnedSet.has(id));
  const surfaced = unpinned.filter((id) => attention.has(id) && available(id));
  const folded = unpinned.filter((id) => !surfaced.includes(id));
  return { pinned, surfaced, folded, moreAttention: folded.some((id) => attention.has(id)) };
}
