// 恢复默认布局 for the whole window (owner 2026-10-21, checklist #4, docs/design/015-reset-layout.md): the sidebar's
// width, the workspaces' widths (the single column's dragged width, the two columns' ratio, what a drag left of the
// row), the on-screen workspaces' Shelves (width back to the default, expanded), the Settings Shelf (left, 760 px,
// category names, not maximised) and the tray (persistent, at the bottom). Nothing closes, no page / pane moves.
// Undoable once: the toast's 撤销 puts back exactly what was there (lib/shelves showShelfToast). Shell code.
import { translate } from "../i18n";
import { DEFAULT_APPEARANCE, getAppearance, setAppearance } from "./appearance";
import { setPaneLayout, usePanes } from "./paneStore";
import { endGrow } from "./panelGrow";
import { resetRowDrag, useRowDrag, type RowDragState } from "./rowDrag";
import { moveSettingsShelf, setSettingsRailLabels, setSettingsShelfMaximized, setSettingsShelfWidth, SETTINGS_SHELF_DEFAULT_W, useSettingsShelf } from "./settingsShelf";
import { showShelfToast } from "./shelves";
import { collapseShelf, expandShelf, setOpen, setShelfWidth, shelvesOf, type SideLayout } from "./sideLayout";
import { updateLayout, updatePeerView, useSide } from "./sideLayoutStore";
import { DEFAULT_TRAY_PREFS, setTrayPrefs, useTrayPrefs, type TrayPrefs } from "./trayPrefs";

/** A Shelf layout's width / collapsed state per Shelf, and whether its tool area is open. */
export interface ShelvesShot {
  open: boolean;
  shelves: Record<string, { width: number | null; collapsed: boolean }>;
}

export interface LayoutShot {
  appearance: { sidebarWidth: number; singleColumnW: number };
  row: Pick<RowDragState, "lead" | "leadShare" | "colW">;
  cols: number[];
  live: ShelvesShot;
  peers: Record<string, ShelvesShot>;
  settings: { side: "left" | "right"; width: number; railLabels: boolean; maximized: boolean };
  tray: TrayPrefs;
}

// ── Pure ────────────────────────────────────────────────────────────────────────────────────────

export function shelvesShot(layout: SideLayout): ShelvesShot {
  const shelves: ShelvesShot["shelves"] = {};
  for (const x of shelvesOf(layout)) shelves[x.id] = { width: x.width ?? null, collapsed: !!x.collapsed };
  return { open: layout.open, shelves };
}

/** Every Shelf with pages back to the default width and expanded, the tool area open (when it has pages). */
export function defaultShelves(layout: SideLayout): SideLayout {
  let next = layout;
  for (const x of shelvesOf(layout)) {
    next = setShelfWidth(next, x.id, null);
    if (layout.pages.some((p) => p.shelf === x.id)) next = expandShelf(next, x.id);
  }
  return layout.pages.length && !next.open ? setOpen(next, true) : next;
}

/** Back to a shot (Shelves that came or went since are left as they are). */
export function restoreShelves(layout: SideLayout, shot: ShelvesShot): SideLayout {
  let next = layout;
  for (const x of shelvesOf(layout)) {
    const was = shot.shelves[x.id];
    if (!was) continue;
    next = setShelfWidth(next, x.id, was.width);
    next = was.collapsed ? collapseShelf(next, x.id) : expandShelf(next, x.id);
  }
  return next.open === shot.open ? next : setOpen(next, shot.open);
}

// ── Store side ──────────────────────────────────────────────────────────────────────────────────

export function layoutShot(): LayoutShot {
  const a = getAppearance();
  const r = useRowDrag.getState();
  const side = useSide.getState();
  const st = useSettingsShelf.getState();
  return {
    appearance: { sidebarWidth: a.sidebarWidth, singleColumnW: a.singleColumnW },
    row: { lead: r.lead, leadShare: r.leadShare, colW: [...r.colW] },
    cols: usePanes.getState().layout.cols.map((c) => c.w),
    live: shelvesShot(side.layout),
    peers: Object.fromEntries(Object.keys(side.peers).map((k) => [k, shelvesShot(side.peers[k]!.own)])),
    settings: { side: st.side, width: st.width, railLabels: st.railLabels, maximized: st.maximized },
    tray: { ...useTrayPrefs.getState() },
  };
}

function applySettings(s: LayoutShot["settings"]): void {
  if (useSettingsShelf.getState().side !== s.side) moveSettingsShelf(s.side);
  setSettingsShelfWidth(s.width);
  setSettingsRailLabels(s.railLabels);
  setSettingsShelfMaximized(s.maximized);
}

/** 恢复默认布局: everything above back to its default; the toast offers 撤销 once. */
export function resetWindowLayout(): void {
  const shot = layoutShot();
  endGrow();
  setAppearance({ sidebarWidth: DEFAULT_APPEARANCE.sidebarWidth, singleColumnW: 0 });
  resetRowDrag({ columns: true });
  setPaneLayout((l) => (l.cols.length ? { ...l, cols: l.cols.map((c) => ({ ...c, w: 1 / l.cols.length })) } : l));
  updateLayout(defaultShelves);
  for (const key of Object.keys(shot.peers)) updatePeerView(key, defaultShelves);
  applySettings({ side: "left", width: SETTINGS_SHELF_DEFAULT_W, railLabels: true, maximized: false });
  setTrayPrefs({ ...DEFAULT_TRAY_PREFS });
  showShelfToast(translate("layout.resetDone"), () => undoWindowLayout(shot));
}

/** The toast's 撤销: exactly what was there before the reset. */
export function undoWindowLayout(shot: LayoutShot): void {
  setAppearance(shot.appearance);
  useRowDrag.setState({ lead: shot.row.lead, leadShare: shot.row.leadShare, colW: shot.row.colW });
  setPaneLayout((l) => (l.cols.length === shot.cols.length ? { ...l, cols: l.cols.map((c, i) => ({ ...c, w: shot.cols[i]! })) } : l));
  updateLayout((l) => restoreShelves(l, shot.live));
  for (const [key, s] of Object.entries(shot.peers)) updatePeerView(key, (l) => restoreShelves(l, s));
  applySettings(shot.settings);
  setTrayPrefs(shot.tray);
}
