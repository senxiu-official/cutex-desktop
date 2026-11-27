// The settings-sync state for React (Settings → 你, 「已同步」 on settings pages): light on imports so the settings
// form can read it; lib/settingsSync/run fills it.
import { create } from "zustand";
import type { SettingsSyncState } from "./engine";
import { syncCategory } from "./registry";

export const IDLE_SYNC_STATE: SettingsSyncState = { status: "noHost", memoryHost: null, lastSync: null, pending: 0, error: null, ask: [], categories: {} };
export const useSettingsSync = create<SettingsSyncState>(() => IDLE_SYNC_STATE);

/** Whether a settings page shows 「已同步」: a category it holds is followed on this device. */
export function pageSynced(state: SettingsSyncState, page: string): boolean {
  if (state.status !== "synced" && state.status !== "offline") return false;
  return Object.entries(state.categories).some(([id, v]) => v.on && v.adopted && !!syncCategory(id)?.pages.includes(page));
}

/** Whether one category is followed on this device (on, adopted, with a memory host that syncs). */
export function categoryFollowed(state: SettingsSyncState, id: string): boolean {
  if (state.status !== "synced" && state.status !== "offline") return false;
  const v = state.categories[id];
  return !!v && v.on && v.adopted;
}
