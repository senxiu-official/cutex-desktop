// A viewer's activity preference, shared by the project page and Shelf views on this device.
import { create } from "zustand";

export const ACTIVITY_PREFS_KEY = "cutex-desktop.project-view.activity";
export interface ActivityPrefs { includeOwnerTurns: boolean }
export function parseActivityPrefs(raw: unknown): ActivityPrefs {
  return { includeOwnerTurns: !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).includeOwnerTurns === true };
}
function load(): ActivityPrefs {
  try { return parseActivityPrefs(JSON.parse(localStorage.getItem(ACTIVITY_PREFS_KEY) ?? "null")); }
  catch { return { includeOwnerTurns: false }; }
}
export const useActivityPrefs = create<ActivityPrefs>(() => load());
export function setIncludeOwnerTurns(includeOwnerTurns: boolean): void {
  useActivityPrefs.setState({ includeOwnerTurns });
  try { localStorage.setItem(ACTIVITY_PREFS_KEY, JSON.stringify({ includeOwnerTurns })); }
  catch { /* storage unavailable: retained for this session */ }
}
/** Re-read device storage (also used by tests simulating a fresh renderer). */
export function reloadActivityPrefs(): void { useActivityPrefs.setState(load(), true); }
