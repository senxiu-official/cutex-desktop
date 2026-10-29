// 多窗口 (Settings → 通用 → 窗口, multi-window; docs/desktop-modules.md §24.17). Default off. Main owns the setting
// (desktop-prefs.json, ShellState.prefs.multiWindow) and refuses desk tickets while it is off; this is the renderer's
// copy of it: the menus, the Settings row and lib/deskSync read it here.
//
// Before main owned it, the renderer kept it: the P6 pref (lib/prefs `multiWindow`) and, before that, the P1–P3.5 local
// flag (localStorage DESKS_FLAG_KEY = "1"). lib/prefs reads that old value once at load and drops it from storage;
// startMultiWindowPref hands it to main, which adopts it at most once (shared/shell.ts multiWindowChange). From then on
// only the Settings switch changes it.
import { useSyncExternalStore } from "react";
import type { ShellBridge, ShellState } from "../../../shared/ipc";

/** The old local flag (multi-window P1–P3.5). */
export const DESKS_FLAG_KEY = "cutex-desktop.multiWindow";

type FlagStorage = Pick<Storage, "getItem">;

/** The renderer's old value: the P6 pref when it is a boolean, else the old flag ("1" = on), else off. */
export function migrateMultiWindow(value: unknown, storage: FlagStorage | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  if (typeof value === "boolean") return value;
  try {
    return storage?.getItem(DESKS_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

/** Drop the old flag; true when it was there. */
export function takeLegacyDesksFlag(storage: Pick<Storage, "getItem" | "removeItem"> | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  try {
    if (storage?.getItem(DESKS_FLAG_KEY) === null || !storage) return false;
    storage.removeItem(DESKS_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

let on = false;
const listeners = new Set<() => void>();

/** Multi-window is on for this device (main's setting as last heard; off until then). */
export function multiWindowOn(): boolean {
  return on;
}

export function subscribeMultiWindow(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useMultiWindow(): boolean {
  return useSyncExternalStore(subscribeMultiWindow, multiWindowOn, multiWindowOn);
}

/** Follow main's answer (any ShellState: Settings rows hand theirs in too). */
export function adoptShellState(state: Pick<ShellState, "prefs"> | null | undefined): void {
  const next = state?.prefs.multiWindow === true;
  if (next === on) return;
  on = next;
  for (const l of listeners) l();
}

/**
 * Start: hand main the renderer's old value (on or off — either way it uses up main's one-time migration in its first
 * run; later runs ignore it) and follow main's answer. No shell (tests, a bare preview): stays off.
 */
export async function startMultiWindowPref(shell: Pick<ShellBridge, "state" | "migrateMultiWindow"> | undefined, legacy: boolean): Promise<void> {
  if (!shell) return;
  try {
    adoptShellState(shell.migrateMultiWindow ? await shell.migrateMultiWindow(legacy) : await shell.state());
  } catch {
    // stays as it was (off): main refuses tickets anyway
  }
}

/** Settings → 通用 → 窗口 → 多窗口. Off keeps the open desks until they close and the remembered ones stored. */
export async function setMultiWindow(shell: Pick<ShellBridge, "setMultiWindow"> | undefined, value: boolean): Promise<void> {
  if (!shell?.setMultiWindow) return;
  adoptShellState(await shell.setMultiWindow(value));
}
