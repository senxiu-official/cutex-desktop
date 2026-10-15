// Manual profile order (Settings → Profiles: drag, or 上移 / 下移 / 移到最前 in a card's menu).
// cutex keeps no order field for profiles, so this is a desktop UI pref: `profileOrder` in lib/prefs,
// a host-keyed list of profile ids (ids survive a rename). Per host: each daemon has its own profiles.
// Listed profiles come first in that order wherever profiles are listed for picking; the rest keep
// cutex's order after them; ids no longer listed by cutex are ignored and drop out on the next write.
import { useMemo } from "react";
import { hostKey, keyFocus, parseHostKey } from "./hostKeys";
import { hostListKeys, setHostListKeys, useUiPrefs } from "./prefs";

type Orderable = { id: string; name: string };

/** Rank of a profile in `order` (matched by id, else by name); `order.length` = unlisted. */
function rankOf(order: readonly string[]): (p: Orderable) => number {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  return (p) => rank.get(p.id) ?? rank.get(p.name) ?? order.length;
}

/** `items` in the manual order: listed ones first, the rest keep their given order (stable). */
export function applyProfileOrder<T extends Orderable>(items: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...items];
  const at = rankOf(order);
  // Array.prototype.sort is stable, so unlisted profiles keep their incoming order.
  return [...items].sort((a, b) => at(a) - at(b));
}

/** The order after dropping `dragged` before (or after) `target`, over the ids shown now. */
export function dropProfile(shown: readonly string[], dragged: string, target: string, after: boolean): string[] {
  if (dragged === target || !shown.includes(dragged)) return [...shown];
  const rest = shown.filter((id) => id !== dragged);
  const i = rest.indexOf(target);
  if (i < 0) return [...shown];
  rest.splice(after ? i + 1 : i, 0, dragged);
  return rest;
}

export type ProfileMove = "up" | "down" | "top";

/** The order after moving `id` one step up / down or to the front; unchanged at an edge. */
export function moveProfile(shown: readonly string[], id: string, move: ProfileMove): string[] {
  const i = shown.indexOf(id);
  if (i < 0) return [...shown];
  const to = move === "top" ? 0 : move === "up" ? Math.max(0, i - 1) : Math.min(shown.length - 1, i + 1);
  if (to === i) return [...shown];
  const out = shown.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** Whether `move` would change anything for the profile at `index` of `count`. */
export function canMoveProfile(index: number, count: number, move: ProfileMove): boolean {
  if (index < 0) return false;
  return move === "down" ? index < count - 1 : index > 0;
}

// ---------- the pref (per host) ----------

/** `hostId`'s saved order (profile ids); empty = cutex's order. */
export function profileOrderOf(hostId: string = keyFocus()): string[] {
  const out: string[] = [];
  for (const key of hostListKeys("profileOrder", [hostId])) {
    const parsed = parseHostKey(key);
    if (parsed) out.push(parsed[1]);
  }
  return out;
}

/** Save `hostId`'s order (the ids of every profile it lists now); [] = back to cutex's order. */
export function setProfileOrder(hostId: string, ids: readonly string[]): void {
  setHostListKeys(
    "profileOrder",
    [hostId],
    [...new Set(ids)].map((id) => hostKey(hostId, id)),
  );
}

/** `hostId`'s saved order (default: the focus host), re-rendering when it changes. */
export function useProfileOrder(hostId?: string): string[] {
  const prefs = useUiPrefs();
  return useMemo(() => profileOrderOf(hostId ?? keyFocus()), [prefs, hostId]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** `items` (cutex's list) in `hostId`'s manual order; null / undefined pass through. */
export function useOrderedProfiles<T extends Orderable>(items: readonly T[], hostId?: string): T[];
export function useOrderedProfiles<T extends Orderable>(items: readonly T[] | null | undefined, hostId?: string): T[] | null;
export function useOrderedProfiles<T extends Orderable>(items: readonly T[] | null | undefined, hostId?: string): T[] | null {
  const order = useProfileOrder(hostId);
  return useMemo(() => (items ? applyProfileOrder(items, order) : null), [items, order]);
}
