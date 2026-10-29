// The app's own light / dark (Settings → 外观 → 主题: 跟随系统 / 浅色 / 深色, resolved by the renderer and reported
// through the window channel). Main uses it only for cutex's own pages in the in-app browser (browser/pageScheme);
// nativeTheme.themeSource stays the OS's, so every other site and the native UI keep the OS preference.
import { nativeTheme } from "electron";
import type { PageScheme } from "./browser/pageScheme";

let reported: PageScheme | null = null;
const listeners = new Set<() => void>();

export const osScheme = (): PageScheme => (nativeTheme.shouldUseDarkColors ? "dark" : "light");
/** The app's scheme; the OS one until the renderer has reported. */
export const appScheme = (): PageScheme => reported ?? osScheme();

export function setAppScheme(scheme: unknown): void {
  if (scheme !== "light" && scheme !== "dark") return;
  if (scheme === reported) return;
  reported = scheme;
  for (const l of listeners) l();
}

/** Called when the app's or the OS's scheme changes. */
export function onSchemeChange(listener: () => void): () => void {
  listeners.add(listener);
  nativeTheme.on?.("updated", listener);
  return () => {
    listeners.delete(listener);
    nativeTheme.off?.("updated", listener);
  };
}
