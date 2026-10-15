// Which module switches Settings → 模块 offers (docs/desktop-modules.md §10.1, acceptance O4).

/**
 * Wired, default-off modules that have no real install entry yet. Their switch is not listed
 * unless the module is already on (so it can be turned off again) or this device opted in with
 * localStorage `cutex-desktop.showUnlistedModules = "1"` (developers / acceptance runs).
 */
export const UNLISTED_MODULES: ReadonlySet<string> = new Set(["plugins"]);
export const SHOW_UNLISTED_MODULES_KEY = "cutex-desktop.showUnlistedModules";

export function listedInSettings(id: string, enabled: boolean, revealUnlisted: boolean): boolean {
  return !UNLISTED_MODULES.has(id) || enabled || revealUnlisted;
}

export function revealUnlistedModules(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try { return storage?.getItem(SHOW_UNLISTED_MODULES_KEY) === "1"; } catch { return false; }
}
