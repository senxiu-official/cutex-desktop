// Ownership of portaled popovers (cross-review of b8d26c931): an AnchoredPanel is portaled to <body>, so a container
// that closes on focus leaving it or on a press elsewhere (the short-window 接下来 overlay) would close the moment its
// own row opens one — and unmount the panel with it. AnchoredPanel registers each panel with its anchor; a container
// asks `withinOwned(root, node)`: in root, or in a popover whose anchor is (transitively) in root.
import { isNode } from "./ownerWindow";

const anchors = new WeakMap<Element, Element>();
/** The attribute an owned popover carries (the lookup key for `withinOwned`). */
export const OWNED_POPOVER = "data-owned-popover";

/** Register `panel` as opened from `anchor`; returns the unregister. */
export function ownPopover(panel: Element, anchor: Element): () => void {
  anchors.set(panel, anchor);
  return () => {
    if (anchors.get(panel) === anchor) anchors.delete(panel);
  };
}

/** Whether `node` is inside `root` or inside a popover opened (directly or through other popovers) from inside it. */
export function withinOwned(root: Node | null | undefined, node: unknown): boolean {
  if (!root || !isNode(node)) return false;
  let at: Node | null = node;
  for (let hops = 0; at && hops < 8; hops++) {
    if (root.contains(at)) return true;
    const el: Element | null = (at as Element).closest ? (at as Element) : at.parentElement;
    const popover: Element | null = el?.closest(`[${OWNED_POPOVER}]`) ?? null;
    at = popover ? anchors.get(popover) ?? null : null;
  }
  return false;
}
