// Each desk window's own sidebar (multi-window P3, owner 2026-10-27: the same sidebar in every window, its state per
// window — collapsed, width, scroll, filter). Scroll and the filter are the component's own already (one Sidebar per
// window); the collapse (hidden, popping out at the left edge) and the width are kept here per desk, on this device.
// The main window keeps the prefs it always had (lib/prefs sidebarRail, appearance sidebarWidth); a desk starts from them.
import { create } from "zustand";
import { getLiveWidth } from "./appearance";
import { useDeskId } from "./deskContext";
import { getUiPrefs, setSidebarRailWindowHook, useUiPrefs } from "./prefs";
import { currentWindow, deskIdOf, windowStore } from "./windowScope";
import { togglePortraitSidebar, usePortraitOn } from "./portrait";
import { toggleAutoRail, useSidebarRail } from "./workspaces";

export const DESK_SIDEBAR_KEY = "cutex-desktop.deskSidebar.v1";

export interface DeskSidebar {
  /** Collapsed = hidden with the left-edge pop-out (null / absent: as the main window's setting). */
  rail?: boolean;
  /** Its width (px; absent: the main window's). */
  width?: number;
}

/** Stored per desk id, defensively (a desk id is `d` + 12 hex digits). */
export function parseDeskSidebars(raw: string | null): Record<string, DeskSidebar> {
  try {
    const value = JSON.parse(raw ?? "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, DeskSidebar> = {};
    for (const [id, v] of Object.entries(value as Record<string, unknown>)) {
      if (!/^d[0-9a-f]{12}$/.test(id) || !v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const entry: DeskSidebar = {};
      if (typeof e.rail === "boolean") entry.rail = e.rail;
      if (typeof e.width === "number" && Number.isFinite(e.width) && e.width >= 120 && e.width <= 800) entry.width = Math.round(e.width);
      out[id] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

const read = (): Record<string, DeskSidebar> => (typeof localStorage === "undefined" ? {} : parseDeskSidebars(localStorage.getItem(DESK_SIDEBAR_KEY)));

export const useDeskSidebars = create<Record<string, DeskSidebar>>(() => read());

function patch(deskId: string, next: DeskSidebar): void {
  const all = { ...useDeskSidebars.getState(), [deskId]: { ...useDeskSidebars.getState()[deskId], ...next } };
  useDeskSidebars.setState(all, true);
  try {
    localStorage.setItem(DESK_SIDEBAR_KEY, JSON.stringify(all));
  } catch {
    // storage full: this desk's sidebar is only not remembered
  }
}

/** The sidebar's collapse setting in this component's window (a desk's own, else the main window's pref). */
export function useSidebarRailPref(): boolean {
  const deskId = useDeskId();
  const pref = useUiPrefs().sidebarRail;
  const own = useDeskSidebars((s) => (deskId ? s[deskId]?.rail : undefined));
  return own ?? pref;
}

/** A desk's own sidebar width (null: the main window's; the main window: null). */
export function useDeskSidebarWidth(): number | null {
  const deskId = useDeskId();
  return useDeskSidebars((s) => (deskId ? (s[deskId]?.width ?? null) : null));
}

/** A desk's sidebar width, as dragged there (its edge, components/PaneResizer). */
export function setDeskSidebarWidth(deskId: string, px: number): void {
  patch(deskId, { width: px });
}

/** The width a desk's sidebar has now (its own, else the main window's). */
export function deskSidebarWidth(deskId: string): number {
  return useDeskSidebars.getState()[deskId]?.width ?? getLiveWidth("sidebarWidth");
}

/**
 * Ctrl/⌘+B and the sidebar's own toggles in a desk (lib/prefs toggleSidebarRail asks here first): that desk's rail
 * flips, the main window's stays. True = handled (the current window is a desk).
 */
export function toggleDeskSidebarRail(): boolean {
  const deskId = deskIdOf(currentWindow());
  if (!deskId) return false;
  const rail = useDeskSidebars.getState()[deskId]?.rail ?? getUiPrefs().sidebarRail;
  // Hidden only because two workspaces are short of width: the toggle keeps it expanded (lib/workspaces).
  if (toggleAutoRail(rail, deskSidebarWidth(deskId))) return true;
  patch(deskId, { rail: !rail });
  return true;
}

// A portrait window first (lib/portrait: its overlay sidebar, a pref of its own), then a desk's own rail.
setSidebarRailWindowHook(() => togglePortraitSidebar(currentWindow()) || toggleDeskSidebarRail());

/**
 * This window's sidebar draws its width edge (expanded, not the avatar rail; components/Sidebar sets it while
 * mounted). A conversation column or workspace column that sits against the sidebar then leaves the 8 px gap to that
 * edge — no column edge of its own there (components/side/SideArea; owner 2026-10-28: a press in the middle of the
 * gap resized the conversation instead of the sidebar).
 */
export const useSidebarEdge = windowStore(() => create<{ shown: boolean }>(() => ({ shown: false })));

/**
 * The hidden sidebar's temporary pop-out (owner 2026-10-28), this window's own: the collapsed sidebar is fully
 * hidden; resting the pointer at the window's left edge or on the logo (components/SidebarPeek) pops the whole
 * sidebar over the content until the pointer leaves it. Fixed / hidden stays a setting; this is transient.
 */
export const useSidebarPeek = windowStore(() => create<{ popped: boolean }>(() => ({ popped: false })));

/** Whether this window's sidebar is collapsed (hidden) now: the window's own choice, two workspaces short of
 * width, or a pane in full screen (§24.13 / §24.16; lib/workspaces useSidebarRail). */
export function useSidebarCollapsed(): boolean {
  // Portrait (lib/portrait): the sidebar is never in the flow — hidden, or shown over the stack (components/SidebarPeek).
  const portrait = usePortraitOn();
  return useSidebarRail(useSidebarRailPref(), useDeskSidebarWidth() ?? undefined) || portrait;
}
