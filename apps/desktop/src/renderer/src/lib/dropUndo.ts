// 撤销 for a Shelf drop (audit 2026-10-23 #6; owner's risk rule: low risk → no confirm, one undo): merge, split, move
// and cross-Shelf moves change only the arrangement — which page, pane and tab holds what. The undo puts the
// arrangement from before the drop back and keeps every instance as it is now (a terminal's scrollback, a page's
// state); it is offered only while the arrangement is still the drop's result (anything moved since: no undo).
// Pure; tested (test/dropUndo.test.ts). The toast is lib/shelves showShelfToast (the 7 s undo of 删除这一页).
import type { SideLayout } from "./sideLayout";

/** The arrangement of a layout as a string: Shelves, pages, panes, tabs, sizes, what is in view. */
export function arrangementKey(layout: SideLayout): string {
  return JSON.stringify([
    layout.open,
    layout.activePage,
    (layout.shelves ?? []).map((x) => [x.id, x.side, x.active, !!x.collapsed]),
    layout.pages.map((p) => [p.id, p.shelf ?? null, p.cards.map((c) => [c.id, c.tabs, c.active ?? null, c.size, !!c.collapsed])]),
  ]);
}

/**
 * `before`'s arrangement with the instances as they are now: each instance `before` held takes its current copy
 * from `pool` (the layouts it may be in now — the drop may have moved it to another workspace's Shelf); one
 * gone meanwhile stays as it was. The id counter never goes back.
 */
export function undoArrangement(now: SideLayout, before: SideLayout, pool: readonly SideLayout[] = [now]): SideLayout {
  const instances = { ...before.instances };
  for (const id of Object.keys(instances)) {
    const current = pool.find((l) => l.instances[id])?.instances[id];
    if (current) instances[id] = current;
  }
  return { ...before, instances, seq: Math.max(now.seq, before.seq) };
}
