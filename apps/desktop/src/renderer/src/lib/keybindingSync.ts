// The 快捷键方案 category of settings sync (lib/settingsSync; Settings → 你 → 设置同步): the engine writes the user-layout
// section `settings-keybindings`, merges last-writer-per-field and keeps this device's on/off (default on). While it is
// off the engine neither reads nor writes it, so nothing syncs; while on, a scheme marked 「不同步」 is simply not among
// the fields. The engine's view of it (on, following, host reachable) drives the 已同步 marker on Settings → 快捷键.
//
// Fields: `scheme:<id>` per synced scheme (null = deleted on some device), `active` once the owner switched on purpose.
import { BUILTIN_SCHEME_ID } from "./keybindingSchemes";
import { applyKeybindingSyncFields, keybindingSyncFields, schemeLibrary, setKeybindingSyncOn, subscribeSchemes } from "./keybindingSchemeStore";
import { registerSyncCategory, type SyncCategory } from "./settingsSync/registry";
import type { SyncValues } from "./settingsSync/model";
import { categoryFollowed, useSettingsSync } from "./settingsSync/view";

export const KEYBINDING_SYNC_ID = "keybindings";

export const keybindingSyncCategory: SyncCategory = {
  id: KEYBINDING_SYNC_ID,
  /** After the app's on-by-default categories (外观 100 … 引导 500), before the opt-in ones (缩放 600 …; categories.ts). */
  order: 550,
  titleKey: "keySchemes.syncTitle",
  hintKey: "keySchemes.syncCategoryHint",
  defaultOn: true,
  pages: ["shortcuts"],
  read: () => keybindingSyncFields() as SyncValues,
  write: (values) => applyKeybindingSyncFields(values),
  subscribe: (onChange) => subscribeSchemes(onChange),
  /** One line for 设置同步: the active scheme and how many schemes sync. */
  summary: (_values, t) => {
    const lib = schemeLibrary();
    const active = lib.schemes.find((s) => s.id === lib.active);
    const name = lib.active === BUILTIN_SCHEME_ID || !active ? t("keySchemes.builtin") : (active.name ?? t("keySchemes.mine"));
    return t("keySchemes.syncSummary", { name, n: lib.schemes.filter((s) => s.sync).length + 1 });
  },
};

/** Register the category and keep the 已同步 marker in step with the engine (lib/settingsSync/run, once per window). */
export function startKeybindingSync(): () => void {
  const unregister = registerSyncCategory(keybindingSyncCategory);
  const update = () => setKeybindingSyncOn(categoryFollowed(useSettingsSync.getState(), KEYBINDING_SYNC_ID));
  const off = useSettingsSync.subscribe(update);
  update();
  return () => {
    off();
    unregister();
    setKeybindingSyncOn(false);
  };
}
