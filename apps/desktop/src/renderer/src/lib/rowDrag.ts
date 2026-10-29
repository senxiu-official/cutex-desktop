// What the work row keeps between drags (宽度规则, owner 2026-10-21; docs/desktop-modules.md §24.15): memory
// only, components/side/SideArea reads and writes it, lib/workspaceRow has the rules.
//   lead   — by content, where the group starts after a drag moved it off centre (the sidebar's edge, a single
//            column's edge beside one Shelf): no re-centring jump after the release; forgotten when a workspace
//            opens / closes, 工作区宽度 changes. When the window resizes (the row changes width by itself) it
//            becomes `leadShare`: the group keeps its relative place in the free space — re-centring there was a
//            jump of up to half the free space for a 1 px resize (owner 2026-10-21: panels flying on a resize).
//   leadShare — that place as a share of the free space (0 = at the left, 0.5 = centred, 1 = at the right).
//   colW   — by content with two workspaces, a column's width after a Shelf beside it was dragged (only the two
//            panels beside the edge change); forgotten when a workspace opens / closes.
//   push   — while a Shelf's edge is dragged: px the Shelf, already at its minimum, is pushed on into the free desktop
//            (推挤, lib/workspaceRow pushEdge; lib/sideResize sets it, the row lays it out, the release keeps it).
// The handle between two filling columns is not here: while dragged it writes the two columns' widths to their
// elements (components/PaneResizer RowSplitter, no React render per move) and stores the share in the pane
// layout on release (perf re-run 2026-10-21 §7.3 N1).
import { create } from "zustand";
import { windowStore } from "./windowScope";

export interface RowDragState {
  lead: number | null;
  leadShare: number | null;
  colW: readonly (number | null)[];
  push: number;
}

/** Per app window (multi-window P3, lib/windowScope). */
export const useRowDrag = windowStore(() => create<RowDragState>(() => ({ lead: null, leadShare: null, colW: [null, null], push: 0 })));

export function setShelfPush(px: number): void {
  const v = Math.max(0, Math.round(px));
  if (useRowDrag.getState().push !== v) useRowDrag.setState({ push: v });
}

export function setPinnedLead(lead: number | null): void {
  const v = lead === null ? null : Math.max(0, Math.round(lead));
  const s = useRowDrag.getState();
  if (s.lead !== v || s.leadShare !== null) useRowDrag.setState({ lead: v, leadShare: null });
}

/**
 * The window resized (the row changed width by itself) while the group was left off centre: it keeps its place
 * as a share of the free space (`free` px before the resize; nothing free = centred). Pure on the store.
 */
export function keepLeadShare(free: number): void {
  const s = useRowDrag.getState();
  if (s.lead === null) return;
  const share = free > 0 ? Math.min(1, Math.max(0, s.lead / free)) : 0.5;
  useRowDrag.setState({ lead: null, leadShare: share });
}

/** Where the group starts (px of free row before it), pinned by a drag or kept by a resize; null = centred. */
export function pinnedLead(s: Pick<RowDragState, "lead" | "leadShare">, free: number): number | null {
  if (s.lead !== null) return s.lead;
  return s.leadShare === null ? null : Math.round(s.leadShare * Math.max(0, free));
}

export function setColumnWidth(index: number, width: number | null): void {
  const colW = [...useRowDrag.getState().colW];
  if ((colW[index] ?? null) === width) return;
  colW[index] = width === null ? null : Math.round(width);
  useRowDrag.setState({ colW });
}

/** The row re-lays out (a workspace opened / closed, 工作区宽度 changed): back to centred, the columns' own widths. */
export function resetRowDrag(opts: { columns?: boolean } = {}): void {
  const s = useRowDrag.getState();
  const clear = !!opts.columns && s.colW.some((x) => x !== null);
  if (s.lead === null && s.leadShare === null && !clear) return;
  useRowDrag.setState({ lead: null, leadShare: null, colW: clear ? [null, null] : s.colW });
}
