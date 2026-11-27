// 外观 → 应用图标 (owner 2026-11-28, shared/appIcons.ts): the chosen style, its pictures for the in-app logos and the
// picker, and the hand-off to main (tray, windows, Windows shortcuts). The choice is a person-level preference synced
// with 外观 (lib/settingsSync/categories.ts); each device applies it as far as its OS allows. A synced style this
// build lacks leaves the device on its current one.
import { useSyncExternalStore } from "react";
import { bridge } from "../bridge";
import { DEFAULT_APP_ICON, isAppIconId } from "../../../shared/appIcons";
import { appIconLook, type AppIconSize } from "./appIconLooks";

export { appIconLook, appIconLooks, type AppIconLook, type AppIconSize } from "./appIconLooks";
export const APP_ICON_PREVIEW_SIZES: readonly AppIconSize[] = [16, 32, 256];

export function isKnownAppIcon(id: unknown): id is string {
  return isAppIconId(id);
}

const KEY = "cutex-desktop.appIcon";
let current: string = read();
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

function read(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && isAppIconId(v) ? v : DEFAULT_APP_ICON;
  } catch {
    return DEFAULT_APP_ICON;
  }
}

export function loadAppIcon(): string {
  return isKnownAppIcon(current) ? current : DEFAULT_APP_ICON;
}

export function subscribeAppIcon(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pick a style: in-app at once, then main applies it to the OS side (where this OS allows). Unknown ids are ignored. */
export function applyAppIcon(id: string): void {
  if (!isKnownAppIcon(id)) return;
  current = id;
  try {
    if (id === DEFAULT_APP_ICON) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, id);
  } catch {
    // storage off: this run only
  }
  emit();
  void bridge?.shell?.setAppIcon?.(id).catch(() => {});
}

/**
 * At start: main remembers the device's style for the tray before any page loads; this keeps the two in step. A
 * renderer choice made here wins (it is the synced one); on a device with none yet, main's is adopted.
 */
export function initAppIcon(): void {
  void bridge?.shell?.state?.().then((state) => {
    const mainId = state?.appIcon?.id;
    if (!mainId) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    if (stored === null && mainId !== DEFAULT_APP_ICON && isKnownAppIcon(mainId)) {
      current = mainId;
      try {
        localStorage.setItem(KEY, mainId);
      } catch {
        // storage off
      }
      emit();
    } else if (mainId !== loadAppIcon()) void bridge?.shell?.setAppIcon?.(loadAppIcon()).catch(() => {});
  }).catch(() => {});
}

export function useAppIcon(): string {
  return useSyncExternalStore(subscribeAppIcon, loadAppIcon, loadAppIcon);
}

/**
 * The logo for a small spot `px` CSS pixels wide (title bar 16, system avatars 28): the browser picks the file made
 * for the device pixels it needs (a style's hand-made small pictures at 16 / 24 / 32 / 48 px).
 */
export function useAppLogo(px: number): { src: string; srcSet?: string; sizes?: string } {
  const look = appIconLook(useAppIcon());
  const sizes: AppIconSize[] = [16, 24, 32, 48, 256];
  return { src: look.url(32), srcSet: sizes.map((n) => `${look.url(n)} ${n}w`).join(", "), sizes: `${px}px` };
}

/** The logo for a large spot (关于). */
export function useAppLogoLarge(): string {
  return appIconLook(useAppIcon()).url(256);
}
