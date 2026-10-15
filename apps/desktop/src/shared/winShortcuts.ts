// Pure Windows launcher logic (no Electron): the AppUserModelID and the shortcuts that carry it.
// Windows groups a running window with a pinned / Start-menu shortcut only when both report the same
// System.AppUserModel.ID; without one it groups by the executable path, and a portable install runs
// <base>\releases\<release>\cutex.exe while launchers point at <base>\current\cutex.exe.
// src/main/winShortcuts.ts applies these specs with shell.writeShortcutLink.
import type { InstallLayout } from "./update";

/** AppUserModelID of the installed (packaged) app. */
export const APP_USER_MODEL_ID = "dev.cutex.desktop";

/** Dev runs get their own id so a dev window never merges with the installed app's taskbar entry. */
export function appUserModelId(packaged: boolean): string {
  return packaged ? APP_USER_MODEL_ID : `${APP_USER_MODEL_ID}.dev`;
}

/** The fields of Electron's ShortcutDetails we manage. */
export interface ShortcutSpec {
  target: string;
  cwd: string;
  icon: string;
  iconIndex: number;
  appUserModelId: string;
  description: string;
}

/** Launcher for a portable install: through the `current` link, so updates keep it valid. */
export function launcherSpec(layout: InstallLayout): ShortcutSpec {
  const current = layout.currentLink;
  return {
    target: `${current}\\cutex.exe`,
    cwd: current,
    icon: `${current}\\resources\\app\\resources\\icons\\icon.ico`,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
    description: "Cutex",
  };
}

export function startMenuShortcutPath(appData: string): string {
  return `${appData}\\Microsoft\\Windows\\Start Menu\\Programs\\Cutex.lnk`;
}

export function taskbarPinDir(appData: string): string {
  return `${appData}\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar`;
}

function norm(path: string): string {
  return path.trim().replace(/^"|"$/g, "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** Whether a shortcut target launches this install: <base>\current\cutex.exe or a release's cutex.exe. */
export function targetsInstall(target: string | undefined, layout: InstallLayout): boolean {
  if (!target) return false;
  const t = norm(target);
  if (t === norm(`${layout.currentLink}\\cutex.exe`)) return true;
  const releases = `${norm(layout.releasesDir)}\\`;
  if (!t.startsWith(releases)) return false;
  const rest = t.slice(releases.length).split("\\");
  return rest.length === 2 && rest[1] === "cutex.exe";
}

/** Whether an existing shortcut (null = missing) differs from the spec in a field we manage. */
export function shortcutNeedsUpdate(existing: Partial<ShortcutSpec> | null, spec: ShortcutSpec): boolean {
  if (!existing) return true;
  const same = (a: string | undefined, b: string) => norm(a ?? "") === norm(b);
  return !(
    same(existing.target, spec.target) &&
    same(existing.cwd, spec.cwd) &&
    same(existing.icon, spec.icon) &&
    (existing.iconIndex ?? 0) === spec.iconIndex &&
    existing.appUserModelId === spec.appUserModelId
  );
}
