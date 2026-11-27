// Windows: keep the Start-menu shortcut, desktop shortcuts and taskbar pins of a portable install pointing at
// <base>\current\cutex.exe with the app's AppUserModelID (src/shared/winShortcuts.ts), so the
// running window joins the pinned "Cutex" entry instead of showing up as a separate one, and showing the
// 外观 → 应用图标 style (owner 2026-11-28). Only shortcuts that launch this install are touched; cutex.exe's own
// resource icon stays the build default. Idempotent and never throws (failures go to the error log).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { app, shell, type BrowserWindow } from "electron";
import { DEFAULT_APP_ICON, appIconDir, isAppIconId } from "../shared/appIcons";
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

/**
 * The .ico shortcuts and the taskbar relaunch icon use for an 应用图标 style: the default style (螺钿) inside the release
 * (null), else a copy under userData/app-icons/<id>.ico. A copy, not the release's file: it stays valid if a later
 * release drops the style, and a new path per style makes Explorer's icon cache load it afresh.
 */
export function styleIcoPath(style: string): string | null {
  if (style === DEFAULT_APP_ICON || !isAppIconId(style)) return null;
  const source = join(app.getAppPath(), "resources", appIconDir(style), "icon.ico");
  const dir = join(app.getPath("userData"), "app-icons");
  const dest = join(dir, `${style}.ico`);
  try {
    mkdirSync(dir, { recursive: true });
    copyFileSync(source, dest);
    return dest;
  } catch (error) {
    logError({ source: "shortcuts", method: "styleIco", style, ...errorFields(error) });
    return existsSync(dest) ? dest : null;
  }
}

/** Pinning the running window then creates a launcher for `current`, not for this release (and with the style's icon). */
export function setWindowAppDetails(win: BrowserWindow, icon?: string | null): void {
  const layout = portableLayout();
  if (!layout) return;
  const spec = launcherSpec(layout, icon ?? undefined);
  try {
    win.setAppDetails({ appId: spec.appUserModelId, appIconPath: spec.icon, appIconIndex: spec.iconIndex, relaunchCommand: `"${spec.target}"`, relaunchDisplayName: spec.description });
  } catch (error) {
    logError({ source: "shortcuts", method: "setAppDetails", ...errorFields(error) });
  }
}

/** What syncShortcutsIn reads and writes (Electron's shell + fs in the app; fakes in tests). */
export interface ShortcutIo {
  read(path: string): Partial<ShortcutSpec> | null;
  write(path: string, mode: "create" | "update", spec: ShortcutSpec): boolean;
  /** .lnk file names in a folder ([] when it is missing). */
  links(dir: string): string[];
  exists(path: string): boolean;
  log(entry: Record<string, unknown>): void;
}

/**
 * Bring this install's shortcuts in line with `spec`: create the Start-menu "Cutex" when missing (repoint it only when
 * it launches this install — never steal a Cutex.lnk aimed at another install), and update desktop shortcuts and
 * taskbar pins that launch this install (any name; never create those). Returns how many of them now match.
 */
export function syncShortcutsIn(io: ShortcutIo, where: { appData: string; desktop: string | null }, layout: InstallLayout, spec: ShortcutSpec): number {
  let matching = 0;
  const write = (path: string, mode: "create" | "update", existing: Partial<ShortcutSpec> | null) => {
    if (!shortcutNeedsUpdate(existing, spec)) return void matching++;
    try {
      if (io.write(path, mode, spec)) matching++;
      else io.log({ source: "shortcuts", method: mode, message: `writeShortcutLink failed: ${path}` });
    } catch (error) {
      io.log({ source: "shortcuts", method: mode, path, ...errorFields(error) });
    }
  };

  const startMenu = startMenuShortcutPath(where.appData);
  const existing = io.exists(startMenu) ? io.read(startMenu) : null;
  if (!existing) write(startMenu, "create", null);
  else if (targetsInstall(existing.target, layout)) write(startMenu, "update", existing);

  // Taskbar pins and desktop shortcuts that launch this install. Explorer picks up a new AUMID on its next start; a
  // pin it keeps ungrouped has to be unpinned and re-pinned once from the running window.
  for (const dir of [taskbarPinDir(where.appData), where.desktop]) {
    if (!dir) continue;
    for (const name of io.links(dir)) {
      const path = join(dir, name);
      const link = io.read(path);
      if (link && targetsInstall(link.target, layout)) write(path, "update", link);
    }
  }
  return matching;
}

const electronIo: ShortcutIo = {
  read(path) {
    try {
      return shell.readShortcutLink(path);
    } catch {
      return null;
    }
  },
  write: (path, mode, spec) => shell.writeShortcutLink(path, mode, spec),
  links(dir) {
    try {
      return readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".lnk"));
    } catch {
      return [];
    }
  },
  exists: existsSync,
  log: (entry) => logError(entry as Parameters<typeof logError>[0]),
};

/**
 * Create / repoint this install's shortcuts (`icon`: the style's .ico, styleIcoPath; null = the default style).
 * Returns how many shortcuts launch this install with that icon, or null when this run manages none (not a packaged
 * portable install on Windows, or a side instance). Side instances (CUTEX_DESKTOP_USER_DATA) leave the user's
 * shortcuts alone unless CUTEX_DESKTOP_SHORTCUT_ROOT points them at a scratch directory (stands in for %APPDATA%;
 * its Desktop subfolder stands in for the desktop).
 */
export function syncWindowsShortcuts(icon: string | null = null): number | null {
  const layout = portableLayout();
  const scratch = process.env.CUTEX_DESKTOP_SHORTCUT_ROOT;
  const root = scratch || (process.env.CUTEX_DESKTOP_USER_DATA ? "" : process.env.APPDATA);
  if (!layout || !root) return null;
  const spec = launcherSpec(layout, icon ?? undefined);
  // The target lives in every release; skip if `current` is missing (nothing valid to point at).
  if (!existsSync(spec.target)) return null;
  let desktop: string | null = null;
  try {
    desktop = scratch ? join(scratch, "Desktop") : app.getPath("desktop");
  } catch {
    desktop = null;
  }
  return syncShortcutsIn(electronIo, { appData: root, desktop }, layout, spec);
}
