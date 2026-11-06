// The roster holds still while the owner is in it (design 060 §4, phase 2): while the pointer or the
// keyboard focus is in the sidebar list, rows and projects keep their places; what changed is put in place
// in one go when the owner leaves (no bar counting it: owner 2026-11-06, it pushed the rows). Only the places
// are held: rows are the live ones, so a new 需要你 shows on its row and on
// the header counts at once, the row just does not move. Pure, except the small hook at the end.
import { useCallback, useMemo, useState, type FocusEvent, type PointerEvent } from "react";
import { isElement } from "./ownerWindow";
import { groupKey, rowKey, type AgentRow } from "./sidebar";
import type { GroupLayout, SidebarLayout } from "./sidebarLayout";

/**
 * A project's places (lib/sidebarLayout): the listed rows (big, running, recent) and the two folds (idle:
 * 「在线空闲 +N」, offline: 「离线 +N」). While held, a row stays in the place it had, also when it only
 * changed online state (idle ↔ offline, or its order among the listed rows).
 */
type Segment = "big" | "running" | "recent" | "idle" | "offline";
const SEGMENTS: readonly Segment[] = ["big", "running", "recent", "idle", "offline"];
type List = "main" | "others" | "older";
const LISTS: readonly List[] = ["main", "others", "older"];

/** Where one project's rows sit: its mode and each segment's row keys, in order. */
interface GroupPlace {
  key: string;
  mode: GroupLayout["mode"];
  segments: Record<Segment, string[]>;
}

/** Where every project and row of one laid-out list sits. */
export type Placement = Record<List, GroupPlace[]>;

function placeOf(l: GroupLayout): GroupPlace {
  return { key: groupKey(l.group), mode: l.mode, segments: { big: l.big.map(rowKey), running: l.running.map(rowKey), recent: l.recent.map(rowKey), idle: l.idle.map(rowKey), offline: l.offline.map(rowKey) } };
}

export function placementOf(layout: SidebarLayout): Placement {
  return { main: layout.main.map(placeOf), others: layout.others.map(placeOf), older: layout.older.map(placeOf) };
}

/**
 * `fresh` shown in the places of `held`: projects keep their list, order and mode; rows keep their segment
 * and order (the live row objects; rows gone are dropped, new rows and projects are added at the end of
 * where they belong now, so nothing already shown moves). Counts and the rest of each project come from
 * `fresh`.
 */
export function holdLayout(held: Placement, fresh: SidebarLayout): SidebarLayout {
  const freshByKey = new Map<string, GroupLayout>();
  for (const list of LISTS) for (const l of fresh[list]) freshByKey.set(groupKey(l.group), l);
  const heldKeys = new Set(LISTS.flatMap((list) => held[list].map((p) => p.key)));
  const out: SidebarLayout = { main: [], others: [], older: [] };
  for (const list of LISTS) {
    for (const place of held[list]) {
      const now = freshByKey.get(place.key);
      if (!now) continue;
      out[list].push(holdGroup(place, now));
    }
    // Projects that were not there when the hold began: at the end of where they belong now.
    for (const l of fresh[list]) if (!heldKeys.has(groupKey(l.group))) out[list].push(l);
  }
  return out;
}

/** One project's live layout with its rows in the held segments. */
function holdGroup(place: GroupPlace, fresh: GroupLayout): GroupLayout {
  const rows = new Map<string, AgentRow>();
  for (const s of SEGMENTS) for (const r of fresh[s]) rows.set(rowKey(r), r);
  const placed = new Set<string>();
  const next = { ...fresh, mode: place.mode } as GroupLayout;
  for (const s of SEGMENTS) {
    const list: AgentRow[] = [];
    for (const key of place.segments[s]) {
      const r = rows.get(key);
      if (r) {
        list.push(r);
        placed.add(key);
      }
    }
    next[s] = list;
  }
  // New rows: where the rule puts them, after the held ones.
  for (const s of SEGMENTS) for (const r of fresh[s]) if (!placed.has(rowKey(r))) next[s] = [...next[s], r];
  return next;
}

/**
 * Whether the owner is in the roster: the pointer over it, or the keyboard focus in it shown as such
 * (`:focus-visible`: a click on a row does not hold the roster after the pointer leaves). Spread `bind`
 * on the list element; portals rendered from inside it (menus) count as inside (React events).
 */
export function useRosterPresence(): { inside: boolean; bind: { onPointerEnter(e: PointerEvent): void; onPointerLeave(e: PointerEvent): void; onFocus(e: FocusEvent): void; onBlur(e: FocusEvent): void } } {
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const onPointerEnter = useCallback(() => setPointer(true), []);
  const onPointerLeave = useCallback(() => setPointer(false), []);
  const onFocus = useCallback((e: FocusEvent) => setFocus(visibleFocus(e.target)), []);
  const onBlur = useCallback((e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !(e.currentTarget as Node).contains(next)) setFocus(false);
  }, []);
  const bind = useMemo(() => ({ onPointerEnter, onPointerLeave, onFocus, onBlur }), [onPointerEnter, onPointerLeave, onFocus, onBlur]);
  return { inside: pointer || focus, bind };
}

function visibleFocus(target: EventTarget | null): boolean {
  try {
    return isElement(target) && target.matches(":focus-visible");
  } catch {
    return false;
  }
}
