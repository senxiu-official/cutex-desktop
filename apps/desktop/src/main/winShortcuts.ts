// Windows: keep the Start-menu shortcut and taskbar pins of a portable install pointing at
// <base>\current\cutex.exe with the app's AppUserModelID (src/shared/winShortcuts.ts), so the
// running window joins the pinned "Cutex" entry instead of showing up as a separate one.
// Idempotent and never throws (failures go to the error log).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { app, shell, type BrowserWindow } from "electron";
import { installLayout, type InstallLayout } from "../shared/update";
import { appUserModelId, launcherSpec, shortcutNeedsUpdate, startMenuShortcutPath, targetsInstall, taskbarPinDir, type ShortcutSpec } from "../shared/winShortcuts";
import { errorFields, logError } from "./errorLog";
import { realExecPath } from "./updater";

/** Call before app ready: taskbar grouping uses the id from the first window on. */
export function setWindowsAppId(): void {
  if (process.platform === "win32") app.setAppUserModelId(appUserModelId(app.isPackaged));
}

function portableLayout(): InstallLayout | null {
  if (process.platform !== "win32" || !app.isPackaged) return null;
  const layout = installLayout(realExecPath(), "\\");
  return "reason" in layout ? null : layout;
}

/** Pinning the running window then creates a launcher for `current`, not for this release. */
export function setWindowAppDetails(win: BrowserWindow): void {
  const layout = portableLayout();
  if (!layout) return;
  const spec = launcherSpec(layout);
  try {
    win.setAppDetails({ appId: spec.appUserModelId, appIconPath: spec.icon, appIconIndex: spec.iconIndex, relaunchCommand: `"${spec.target}"`, relaunchDisplayName: spec.description });
  } catch (error) {
    logError({ source: "shortcuts", method: "setAppDetails", ...errorFields(error) });
  }
}

function read(path: string): Partial<ShortcutSpec> | null {
  try {
    return shell.readShortcutLink(path);
  } catch {
    return null;
  }
}

/**
 * Create / repoint the Start-menu "Cutex" shortcut and update taskbar pins of this install.
 * Side instances (CUTEX_DESKTOP_USER_DATA) leave the user's shortcuts alone unless
 * CUTEX_DESKTOP_SHORTCUT_ROOT points them at a scratch directory (stands in for %APPDATA%).
 */
export function syncWindowsShortcuts(): void {
  const layout = portableLayout();
  const root = process.env.CUTEX_DESKTOP_SHORTCUT_ROOT || (process.env.CUTEX_DESKTOP_USER_DATA ? "" : process.env.APPDATA);
  if (!layout || !root) return;
  const spec = launcherSpec(layout);
  // The icon file lives in every release; skip if `current` is missing (nothing valid to point at).
  if (!existsSync(spec.target)) return;
  const write = (path: string, mode: "create" | "update", existing: Partial<ShortcutSpec> | null) => {
    if (!shortcutNeedsUpdate(existing, spec)) return;
    try {
      if (!shell.writeShortcutLink(path, mode, spec)) logError({ source: "shortcuts", method: mode, message: `writeShortcutLink failed: ${path}` });
    } catch (error) {
      logError({ source: "shortcuts", method: mode, path, ...errorFields(error) });
    }
  };

  // Start menu: create when missing; repoint only when it launches this install (never steal
  // a Cutex.lnk the user aimed at another install).
  const startMenu = startMenuShortcutPath(root);
  const existing = existsSync(startMenu) ? read(startMenu) : null;
  if (!existing) write(startMenu, "create", null);
  else if (targetsInstall(existing.target, layout)) write(startMenu, "update", existing);

  // Taskbar pins that launch this install (any name). Explorer picks up the new AUMID on its next
  // start; a pin it keeps ungrouped has to be unpinned and re-pinned once from the running window.
  const pins = taskbarPinDir(root);
  let names: string[] = [];
  try {
    names = readdirSync(pins).filter((n) => n.toLowerCase().endsWith(".lnk"));
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(pins, name);
    const pin = read(path);
    if (pin && targetsInstall(pin.target, layout)) write(path, "update", pin);
  }
}
