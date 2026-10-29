// The tray's place on this machine (owner 2026-10-21; lib/trayModel, components/ChipTray): 托盘常驻 (default
// on: a strip in its own band; off: auto-hidden behind a small handle) and the edge of the work area it is
// docked to (bottom by default; dragged by its grip, or 停靠在… in its menu), 「允许 3 列」 (design 039) and 「托盘两排」
// (owner 2026-10-24, default off: a tray card that does not fit one row lays out in two before anything folds). Per machine, like 外观
// (localStorage; each screen keeps its own). Shell code: names no feature.
import { create } from "zustand";
import { setAllowThreeColumns } from "./paneLayout";
import { TRAY_EDGES, type TrayEdge } from "./trayModel";

export interface TrayPrefs {
  persistent: boolean;
  edge: TrayEdge;
  /** 「允许 3 列」 (design 039): up to 3 conversation columns side by side instead of 2. */
  allowThreeColumns: boolean;
  /** 「托盘两排」: the tray card uses two rows when one does not hold its items (display only). */
  twoRows: boolean;
}

export const DEFAULT_TRAY_PREFS: TrayPrefs = { persistent: true, edge: "bottom", allowThreeColumns: false, twoRows: false };

export const TRAY_PREFS_KEY = "cutex-desktop.tray";

/** Stored prefs as read back (unknown values: the defaults). */
export function parseTrayPrefs(raw: unknown): TrayPrefs {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    persistent: v.persistent !== false,
    edge: (TRAY_EDGES as readonly unknown[]).includes(v.edge) ? (v.edge as TrayEdge) : DEFAULT_TRAY_PREFS.edge,
    allowThreeColumns: v.allowThreeColumns === true,
    twoRows: v.twoRows === true,
  };
}

function load(): TrayPrefs {
  try {
    return parseTrayPrefs(JSON.parse(localStorage.getItem(TRAY_PREFS_KEY) ?? "{}"));
  } catch {
    return { ...DEFAULT_TRAY_PREFS };
  }
}

export const useTrayPrefs = create<TrayPrefs>(() => (typeof localStorage === "undefined" ? { ...DEFAULT_TRAY_PREFS } : load()));
setAllowThreeColumns(useTrayPrefs.getState().allowThreeColumns);

export function setTrayPrefs(patch: Partial<TrayPrefs>): void {
  const next = parseTrayPrefs({ ...useTrayPrefs.getState(), ...patch });
  useTrayPrefs.setState(next);
  setAllowThreeColumns(next.allowThreeColumns);
  try {
    localStorage.setItem(TRAY_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage full / unavailable: this session only */
  }
}

/** Reads the stored prefs again (tests; another window of this machine). */
export function reloadTrayPrefs(): void {
  const next = load();
  useTrayPrefs.setState(next);
  setAllowThreeColumns(next.allowThreeColumns);
}
