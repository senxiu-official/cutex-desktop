import { DEFAULT_ORDER, locate, moveInstance, type SideLayout, type SidePage } from "./sideLayout";
import { DIFF_COMPONENT } from "./sideKinds";

const TURN_DIFF_GROUP = "workspace.turn-diffs";
export function isTurnDiffPage(layout: SideLayout, page: SidePage): boolean {
  return page.cards.length === 1 && page.cards[0]!.tabs.length > 0 && page.cards[0]!.tabs.every(id => {
    const instance = layout.instances[id];
    return instance?.kind === DIFF_COMPONENT && (instance.state as { source?: unknown } | null)?.source === "turn";
  });
}

/** A turn diff is a full-height workspace page. Git browsing retains its list/diff placement. */
export function turnDiffPage(layout: SideLayout, instanceId: string, now: number): SideLayout {
  const from = locate(layout, instanceId);
  if (!from || layout.instances[instanceId]?.kind !== DIFF_COMPONENT ||
      (layout.instances[instanceId]?.state as { source?: unknown } | null)?.source !== "turn") return layout;
  let next = layout;
  if (!isTurnDiffPage(layout, from.page)) {
    const own = layout.pages.find(page => page.shelf === from.page.shelf && isTurnDiffPage(layout, page));
    next = moveInstance(layout, instanceId, own ? { page: own.id } : { newPage: true }, now, () => DEFAULT_ORDER);
    // Automatic separation is not a user's drag preference for every diff (including git).
    if (next !== layout) next = { ...next, overrides: layout.overrides };
  }
  const at = locate(next, instanceId);
  if (!at || !isTurnDiffPage(next, at.page)) return next; // Keep the existing sanity Shelf limit.
  // Opening Changes/Files later must not add another pane to this turn-only page.
  if (at.page.groups.includes(TURN_DIFF_GROUP) && !at.page.groups.includes("workspace")) return next;
  return { ...next, pages: next.pages.map(page => page.id === at.page.id ? {
    ...page, groups: [...page.groups.filter(group => group !== "workspace"), TURN_DIFF_GROUP],
  } : page) };
}
