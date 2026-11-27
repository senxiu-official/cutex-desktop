// Preview: Settings → 键盘快捷键 with shortcut schemes (lib/keybindingSchemes). `?keySchemes` seeds 「我的快捷键」
// (active, synced: two changed commands and a macOS-only key) and 「演示用」 (kept on this device);
// `?keySchemes=builtin` makes 默认 active, `?keySchemes=nosync` turns the 快捷键方案 sync category off on this device,
// `?keySchemes=legacy` starts from old `cutex.keybindings` overrides (migration). The 已同步 marker comes from the real
// settings-sync engine: add `&layoutMemory=on` for a memory host (dev/mockUserLayout).
import { BUILTIN_SCHEME_ID, LEGACY_STORAGE_KEY, SCHEMES_STORAGE_KEY, type SchemeLibrary } from "../lib/keybindingSchemes";
import { reloadSchemesFromStorage } from "../lib/keybindingSchemeStore";
import { KEYBINDING_SYNC_ID } from "../lib/keybindingSync";

export function installMockKeySchemes(mode: string): void {
  try {
    if (mode === "legacy") {
      localStorage.removeItem(SCHEMES_STORAGE_KEY);
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ v: 1, bindings: { sidebar: ["Mod+Backslash"], tray: ["Mod+KeyJ", "Mod+Shift+KeyJ"] } }));
    } else {
      const t = Date.UTC(2026, 10, 26, 9);
      const lib: SchemeLibrary = {
        v: 1,
        schemes: [
          { id: "s-mine", name: null, parent: BUILTIN_SCHEME_ID, sync: true, updatedAt: t,
            bindings: { sidebar: { keys: ["Mod+Backslash"] }, quickSwitch: { keys: ["Mod+KeyK", "Mod+KeyP"] }, paneCloseTab: { keys: ["Mod+KeyW"], mac: ["Mod+Shift+KeyW"] } } },
          { id: "s-demo", name: "演示用", parent: BUILTIN_SCHEME_ID, sync: false, updatedAt: t - 86_400_000, bindings: { zoomIn: { keys: ["Mod+Equal"] }, zoomOut: { keys: ["Mod+Minus"] } } },
        ],
        active: mode === "builtin" ? BUILTIN_SCHEME_ID : "s-mine",
        activeShared: true,
        deleted: {},
      };
      localStorage.setItem(SCHEMES_STORAGE_KEY, JSON.stringify(lib));
    }
  } catch {
    // preview storage can be disabled
  }
  reloadSchemesFromStorage();
  // This device's switch, once the settings-sync engine runs (App starts it).
  if (mode === "nosync")
    void import("../lib/settingsSync/run").then(({ settingsSync }) => {
      let tries = 0;
      const off = () => {
        const engine = settingsSync();
        if (engine) engine.setOn(KEYBINDING_SYNC_ID, false);
        else if (tries++ < 100) setTimeout(off, 100);
      };
      off();
    });
}
