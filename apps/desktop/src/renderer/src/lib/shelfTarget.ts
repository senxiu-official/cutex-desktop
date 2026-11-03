// Which Shelf an open lands in (docs/design/017-open-in-own-shelf.md, checklist #8): an open that comes from
// inside a pane — a web page's popup, a service page, a pane's own props.open — lands in the Shelf that holds
// that pane, even when the other workspace has the focus; only an open with no source pane (window bar, global
// shortcuts, ⌘K, the tray, agent events) uses the focused workspace's Shelf.
//
// The live layout (lib/sideLayoutStore `layout`) is always the focused conversation's Shelf and every placement
// rule (lib/sideServices open → lib/sideLayout place) works on it, so the other workspace's Shelf is reached by
// making it the live layout for the open:
//   - `focus` opens (the user is going there): that workspace takes the focus first, as a press in it would
//     (lib/shelfSource focusPeer) — then a plain open;
//   - every other open: its Shelf is swapped in for the open and back out (withLiveShelf); the focus, the
//     selected agent and the focused Shelf's mode stay as they were. A folded Shelf stays folded (its page's
//     Rail button flashes instead: lib/railNews).
// Shell-internal: the module-facing SideOpenOptions has no source field (MODULE_API_VERSION unchanged); a side
// component's props.open carries its instance (lib/sideBody), the browser's popups their opener tab.
import type { SideOpenOptions, SideOpenResult } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { parseConvKey } from "./convShelves";
import { focusPeer } from "./shelfSource";
import { locate, shelfOfPage, type SideLayout } from "./sideLayout";
import { markRailNews, railPageState } from "./railNews";
import { instanceOwner, liveConversation, useSide, withLiveShelf } from "./sideLayoutStore";
import { sideOpen, sideOpenAs } from "./sideServices";

/** Where an open comes from: the side instance (a pane's tab) whose Shelf it belongs in. */
export interface OpenSource {
  instanceId: string;
}

/**
 * How an open finds its Shelf (pure): `focused` = the live layout as it is (no source, the source is in the
 * focused Shelf, or it is gone); `focus-source` = give the source's workspace the focus, then open; `in-source`
 * = open in the source's Shelf without moving the focus. `owner`: lib/sideLayoutStore instanceOwner of the source.
 */
export type OpenTargetPlan = { kind: "focused" } | { kind: "focus-source"; key: string } | { kind: "in-source"; key: string };

export function planOpenTarget(owner: string | null | undefined, live: string | null, opts: Pick<SideOpenOptions, "focus" | "background"> = {}): OpenTargetPlan {
  if (!owner || owner === live) return { kind: "focused" };
  return opts.focus && !opts.background ? { kind: "focus-source", key: owner } : { kind: "in-source", key: owner };
}

/** Whether an open from `source` lands somewhere else than the focused Shelf (the other workspace's). */
export function opensElsewhere(source: OpenSource | null | undefined): boolean {
  return !!source && planOpenTarget(instanceOwner(source.instanceId), liveConversation()).kind !== "focused";
}

/** services.side.open for an open from inside a pane: in the Shelf that holds `source` (null: the focused Shelf). */
export function sideOpenFrom(source: OpenSource | null | undefined, kind: ItemId, params: Json = null, opts: SideOpenOptions = {}): SideOpenResult {
  const plan = planOpenTarget(source ? instanceOwner(source.instanceId) : null, liveConversation(), opts);
  if (plan.kind === "focused" || !source) return sideOpen(kind, params, source ? onSourcePage(source, opts) : opts);
  if (plan.kind === "focus-source") {
    focusPeer(plan.key);
    // focusPeer is synchronous for a host in view; when it did not take (a host still switching), still its Shelf.
    if (liveConversation() === plan.key) return sideOpen(kind, params, onSourcePage(source, opts));
  }
  const from = parseConvKey(plan.key);
  if (!from) return sideOpen(kind, params, opts);
  return withLiveShelf(plan.key, () => {
    const o = onSourcePage(source, opts);
    // Its Shelf folded (to its rail): it stays folded — no unfolding, no folding the focused one for room — and the
    // page's Rail button gets the news (lib/railNews; design 017, the lead's default).
    const folded = liveConversation() === plan.key && foldedAt(useSide.getState().layout, o.page ?? o.sourcePage);
    const result = sideOpenAs({ hostId: from.hostId, sessionId: from.sessionId }, kind, params, folded ? { ...o, reveal: false } : o);
    if (folded && result.status === "opened" && result.pageId && railPageState(result.pageId) === "hidden") markRailNews(result.pageId);
    return result;
  });
}

/** Whether the Shelf of page `pageId` shows only its rail (folded, or the whole tool area closed). */
function foldedAt(layout: SideLayout, pageId: string | undefined): boolean {
  return !layout.open || !!shelfOfPage(layout, pageId)?.collapsed;
}

/**
 * Use the source's Shelf as the destination, without an implicit split of its page. With the other workspace's Shelf swapped
 * in, its active page can be a shared page (it joins every Shelf) — an open placed there would follow the focus
 * back out of that Shelf. Read while the source's Shelf is the live layout; a source in a chip: place() decides.
 */
function onSourcePage(source: OpenSource, opts: SideOpenOptions): SideOpenOptions & { sourcePage?: string } {
  if (opts.page) return opts;
  const page = locate(useSide.getState().layout, source.instanceId)?.page.id;
  return page ? { ...opts, sourcePage: page } : opts;
}
