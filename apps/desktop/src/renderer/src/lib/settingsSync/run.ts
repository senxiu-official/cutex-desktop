// Starts settings sync in a window (App): the memory host and hosts come from the sidebar layout's view (one memory
// host for the whole person document, lib/userLayoutSync), writes go through the main-process bridge, another
// device's write arrives as `cutex/users/me/layoutChanged` for a `settings-*` section.
import { apiFor, bridge } from "../../bridge";
import { useLayoutView } from "../userLayoutView";
import { layoutStore } from "../userLayout";
import { createSettingsSync, type SettingsSyncStore } from "./engine";
export { storedSyncOn } from "./engine";
import { registerBuiltInSyncCategories } from "./categories";
import { startKeybindingSync } from "../keybindingSync";
import { syncCategories, useSyncRegistry } from "./registry";
import { IDLE_SYNC_STATE, useSettingsSync } from "./view";
export { pageSynced, useSettingsSync } from "./view";
import type { SyncDoc } from "./model";

/** How often this device's values are compared for categories without a change listener (and on focus). */
export const SYNC_CHECK_MS = 5000;
export const LAYOUT_CATEGORY = "sidebar-layout";

let active: SettingsSyncStore | null = null;
export const settingsSync = () => active;

export function startSettingsSync(): () => void {
  registerBuiltInSyncCategories();
  // A feature's own category: 快捷键方案 (lib/keybindingSync).
  const stopKeybindings = startKeybindingSync();
  const store = createSettingsSync({
    storage: localStorage,
    categories: syncCategories,
    backend: (id) => ({ get: () => apiFor(id).userLayout(), put: (section: string, revision: number, data: SyncDoc) => apiFor(id).putUserLayout(section, revision, data) }),
  });
  active = store;
  const offState = store.state.subscribe((s) => {
    useSettingsSync.setState(s, true);
    layoutStore()?.setFollow(s.categories[LAYOUT_CATEGORY]?.on ?? true);
  });
  useSettingsSync.setState(store.state.getState(), true);
  const follow = () => { const s = useLayoutView.getState(); store.setMemory(s.memoryHost, s.hosts); };
  const offView = useLayoutView.subscribe(follow);
  // A category registered later (e.g. 快捷键方案) is read on the next check.
  const offRegistry = useSyncRegistry.subscribe(() => store.check());
  const offEvent = bridge.on("hostEvent", ({ envelope }) => {
    if (envelope.cutex?.method !== "cutex/users/me/layoutChanged") return;
    const section = (envelope.cutex.params as { section?: unknown } | undefined)?.section;
    if (typeof section === "string") store.invalidate(section);
  });
  const offResync = bridge.on("hostResync", () => void store.refresh());
  const timer = setInterval(() => store.check(), SYNC_CHECK_MS);
  const onVisible = () => store.check();
  document.addEventListener("visibilitychange", onVisible);
  follow();
  return () => {
    clearInterval(timer); document.removeEventListener("visibilitychange", onVisible);
    offState(); offView(); offRegistry(); offEvent(); offResync(); store.dispose(); stopKeybindings();
    if (active === store) { active = null; useSettingsSync.setState(IDLE_SYNC_STATE, true); }
  };
}

