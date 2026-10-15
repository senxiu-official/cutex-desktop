// Card body placeholders of the right side (docs/desktop-modules.md §18.10, the instance layer): each
// card registers the element its shown instance should cover; the instance layer (App root) renders
// that instance in a fixed box aligned to it. Moving / maximising / full screen only change the
// placeholder, never the instance's parent, so nothing remounts.
import { useSyncExternalStore } from "react";

export interface SideSlot {
  el: HTMLElement;
  /** The card's page / card ids (Body props: mode, focus). */
  cardId: string;
  pageId: string;
}

let slots: ReadonlyMap<string, SideSlot> = new Map();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function registerSideSlot(instanceId: string, slot: SideSlot): () => void {
  const next = new Map(slots);
  next.set(instanceId, slot);
  slots = next;
  emit();
  return () => {
    if (slots.get(instanceId)?.el !== slot.el) return;
    const after = new Map(slots);
    after.delete(instanceId);
    slots = after;
    emit();
  };
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSideSlots(): ReadonlyMap<string, SideSlot> {
  return useSyncExternalStore(subscribe, () => slots);
}

// Elements whose size changes move the placeholders without resizing them (the work area: the
// sidebar dragged / toggled, a banner above). The instance layer observes them too.
let anchors: ReadonlySet<HTMLElement> = new Set();

export function registerSideAnchor(el: HTMLElement): () => void {
  anchors = new Set([...anchors, el]);
  emit();
  return () => {
    const next = new Set(anchors);
    next.delete(el);
    anchors = next;
    emit();
  };
}

export function useSideAnchors(): ReadonlySet<HTMLElement> {
  return useSyncExternalStore(subscribe, () => anchors);
}
