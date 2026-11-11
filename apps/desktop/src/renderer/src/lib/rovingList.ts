// The sidebar's keyboard model (owner 2026-11-10): the list is one Tab stop (roving tabindex) instead of one per
// row; inside it ↑ / ↓ move between rows and fold headers, Home / End to the ends, → unfolds a header, ← folds it
// (on a row: back to its header), Enter / Space open as before (the rows' own handlers). The mouse is untouched:
// nothing here listens to the pointer, and a clicked row becomes the list's Tab stop like a focused one.
// DOM-level on purpose: the rows are drawn by many components (AgentRows, folds, sections); this pass only sets
// `tabIndex` and moves focus, after React has drawn them (a MutationObserver re-applies it to new rows).
import { useCallback, useRef } from "react";
import { isElement } from "./ownerWindow";

/** The list's stops: agent rows and fold toggles (project headers, 离线 +N / 空闲 folds, sections). */
export const ROVING_ITEMS = "[data-row-selectable], button[aria-expanded]";
/** Everything else focusable inside the list leaves the Tab order (still clickable; inputs stay). */
const FOCUSABLE = "button, a[href], [tabindex]";
const TYPING = "input, textarea, select, [contenteditable]";

const shown = (el: HTMLElement) => el.getClientRects().length > 0;

/** The stops in document order, visible only. */
export function rovingItems(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(ROVING_ITEMS)].filter(shown);
}

/** The fold toggle that owns `el`: its 离线 / 空闲 fold's button, else its project / section header's. */
function ownerToggle(el: HTMLElement, list: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at && at !== list; at = at.parentElement) {
    if (!at.matches("[data-agent-fold], section")) continue;
    const button = at.querySelector<HTMLElement>(":scope > button[aria-expanded], :scope > div > button[aria-expanded]");
    if (button && button !== el && shown(button)) return button;
  }
  return null;
}

/** Makes `current` the list's only Tab stop. `current` null: the selected row, else the first stop. */
export function applyRoving(list: HTMLElement, current: HTMLElement | null): HTMLElement | null {
  const items = rovingItems(list);
  const stop = current && items.includes(current) ? current : (items.find((el) => el.hasAttribute("data-row-selected")) ?? items[0] ?? null);
  for (const el of list.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.matches(TYPING)) continue;
    const want = el === stop ? 0 : -1;
    if (el.tabIndex !== want) el.tabIndex = want;
  }
  return stop;
}

/** Where the key moves the focus inside the list (folding / unfolding on the way); null: not a list key here. */
export function rovingKey(list: HTMLElement, from: HTMLElement, key: string): HTMLElement | null {
  const items = rovingItems(list);
  const i = items.indexOf(from);
  if (i < 0) return null;
  const toggle = from.matches("button[aria-expanded]");
  const open = from.getAttribute("aria-expanded") === "true";
  switch (key) {
    case "ArrowDown":
      return items[Math.min(items.length - 1, i + 1)] ?? null;
    case "ArrowUp":
      return items[Math.max(0, i - 1)] ?? null;
    case "Home":
      return items[0] ?? null;
    case "End":
      return items[items.length - 1] ?? null;
    case "ArrowRight":
      if (toggle && !open) from.click();
      return from;
    case "ArrowLeft":
      if (toggle && open) {
        from.click();
        return from;
      }
      return ownerToggle(from, list) ?? from;
    default:
      return null;
  }
}

const KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "ArrowLeft", "ArrowRight"]);

/** Wires the roving model to the list element: a callback ref (the list may mount late or be replaced). */
export function useRovingList(): (list: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((list: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = list ? bindRovingList(list) : null;
  }, []);
}

/** Binds the model to `list` (exported for tests); returns the unbind. */
export function bindRovingList(list: HTMLElement): () => void {
  // The stop the keyboard / a click chose; until then (or once it is gone) the stop follows the selected row.
  let chosen: HTMLElement | null = null;
  const apply = () => {
    if (chosen && !chosen.isConnected) chosen = null;
    applyRoving(list, chosen);
  };
  apply();
  const observer = new MutationObserver((records) => {
    // The selection moved from elsewhere (the tray, a link) while the focus is outside: the stop follows it again.
    if (records.some((r) => r.type === "attributes") && !list.contains(list.ownerDocument.activeElement)) chosen = null;
    apply();
  });
  // New rows, and the selection moving (the stop follows it until the keyboard chose one).
  observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-row-selected"] });
  // Elements of a popped-out window are not this window's HTMLElement: checked by node type (lib/ownerWindow).
  const elementOf = (t: EventTarget | null) => (isElement(t) ? (t as HTMLElement) : null);
  const onFocus = (e: FocusEvent) => {
    const el = elementOf(e.target)?.closest<HTMLElement>(ROVING_ITEMS) ?? null;
    if (el && list.contains(el) && el !== chosen) chosen = applyRoving(list, el);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = elementOf(e.target);
    if (!target || target.matches(TYPING)) return;
    const from = target.closest<HTMLElement>(ROVING_ITEMS);
    if (!from || !list.contains(from)) return;
    const to = rovingKey(list, from, e.key);
    if (!to) return;
    e.preventDefault();
    chosen = applyRoving(list, to);
    if (to !== from) to.focus();
    to.scrollIntoView?.({ block: "nearest" });
  };
  list.addEventListener("focusin", onFocus);
  list.addEventListener("keydown", onKey);
  return () => {
    observer.disconnect();
    list.removeEventListener("focusin", onFocus);
    list.removeEventListener("keydown", onKey);
  };
}
