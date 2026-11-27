// Back from a sub-page lands where the owner left (owner 2026-11-28): opening a sub-page (a settings sub-page, a
// Profile's page, a page with a back link…) remembers the parent's scroll offset and the control that opened it;
// going back to that parent puts both back — the offset, and keyboard focus on the opening row. Any other page change
// starts at the top (components/Page.tsx PageBody). Pure DOM, no React: PageBody drives it.

import { isDom } from "./ownerWindow";

/**
 * Where a control sits, so it can be found again after its page is rendered anew: its card (`section[id]`, or the
 * whole column when the card has no id), its text and its place among the card's controls.
 */
export interface ControlSpot {
  section: string | null;
  text: string;
  index: number;
}

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role=button], [role=link]";
const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

function container(root: HTMLElement, section: string | null): HTMLElement | null {
  if (section === null) return root;
  const el = root.ownerDocument.getElementById(section);
  return el && root.contains(el) ? el : null;
}

export function controlSpot(target: EventTarget | null, root: HTMLElement): ControlSpot | null {
  const el = isDom(target, "Element") ? target.closest<HTMLElement>(FOCUSABLE) : null;
  if (!el || !root.contains(el)) return null;
  const card = el.closest<HTMLElement>("section[id]");
  const section = card && root.contains(card) ? card.id : null;
  const index = [...container(root, section)!.querySelectorAll<HTMLElement>(FOCUSABLE)].indexOf(el);
  return index < 0 ? null : { section, text: textOf(el), index };
}

/** The control again: the one with the same text (nearest the old place when several), else none. */
export function findControl(root: HTMLElement, spot: ControlSpot): HTMLElement | null {
  const box = container(root, spot.section);
  if (!box) return null;
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
  let best: HTMLElement | null = null;
  let distance = Infinity;
  all.forEach((el, i) => {
    if (textOf(el) !== spot.text || Math.abs(i - spot.index) >= distance) return;
    best = el;
    distance = Math.abs(i - spot.index);
  });
  return best;
}

interface Left {
  key: string;
  top: number;
  spot: ControlSpot | null;
}

/**
 * The pages left for a sub-page, innermost last. `go(prev, next, nested)` on every page change: returns what to put
 * back when `next` is the page a sub-page was opened from, else null (and starts the next page fresh).
 */
export class ReturnStack {
  private stack: Left[] = [];

  go(prev: Left, next: string, nested: boolean): Left | null {
    const at = this.stack.map((l) => l.key).lastIndexOf(next);
    if (at >= 0) {
      const back = this.stack[at]!;
      this.stack.length = at;
      return back;
    }
    if (nested) this.stack.push(prev);
    else this.stack.length = 0;
    return null;
  }
}
