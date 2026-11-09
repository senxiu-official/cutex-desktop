// Items for what was right-clicked inside a menu's area (e.g. a formula's 「复制源码」, lib/mathMenu.ts), put above
// that menu's own items by lib/contextMenu. Its own module (no imports at runtime), so a contributor can register
// when it loads without pulling in the menu machinery.
import type { MenuEntry } from "./contextMenu";

const contributors = new Set<(target: Element) => MenuEntry[]>();

/** Registered once per module; `build` returns [] for targets it does not know. */
export function registerTargetMenuEntries(build: (target: Element) => MenuEntry[]): void {
  contributors.add(build);
}

/** The contributed items for `target`, with a separator after them; [] when none. */
export function targetMenuEntries(target: EventTarget | null): MenuEntry[] {
  if (!target || (target as Node).nodeType !== 1) return [];
  const entries = [...contributors].flatMap((build) => build(target as Element));
  return entries.length ? [...entries, "separator"] : [];
}
