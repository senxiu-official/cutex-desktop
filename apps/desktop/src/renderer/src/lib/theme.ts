// Theme preference (desktop-local): follow the OS, or force light/dark via data-theme on <html>.
export type ThemePref = "system" | "light" | "dark";

const KEY = "cutex-desktop.theme";

export function loadTheme(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // preference just won't persist
  }
}

/** Text contrast (desktop-local): raises the muted / subtle text colours (data-contrast on <html>). */
export type ContrastPref = "standard" | "high" | "max";

const CONTRAST_KEY = "cutex-desktop.contrast";

export function loadContrast(): ContrastPref {
  try {
    const saved = localStorage.getItem(CONTRAST_KEY);
    return saved === "high" || saved === "max" ? saved : "standard";
  } catch {
    return "standard";
  }
}

export function applyContrast(pref: ContrastPref): void {
  const root = document.documentElement;
  if (pref === "standard") delete root.dataset.contrast;
  else root.dataset.contrast = pref;
  try {
    localStorage.setItem(CONTRAST_KEY, pref);
  } catch {
    // preference just won't persist
  }
}

/**
 * Palettes (desktop-local, owner 2026-10-18): one for the light theme and one for the dark theme, kept
 * apart so 「跟随系统」 switches between the two picks. The default of each is today's look and sets no
 * attribute; others set data-light-palette / data-dark-palette on <html> (styles.css).
 */
export const LIGHT_PALETTES = ["plain", "paper", "mist"] as const;
export const DARK_PALETTES = ["graphite", "smoke", "dusk", "tea", "sandalwood", "ink"] as const;
export type LightPalette = (typeof LIGHT_PALETTES)[number];
export type DarkPalette = (typeof DARK_PALETTES)[number];

const LIGHT_PALETTE_KEY = "cutex-desktop.lightPalette";
const DARK_PALETTE_KEY = "cutex-desktop.darkPalette";

function loadPalette<T extends string>(key: string, all: readonly T[]): T {
  try {
    const saved = localStorage.getItem(key);
    return all.includes(saved as T) ? (saved as T) : all[0]!;
  } catch {
    return all[0]!;
  }
}

function applyPalette(key: string, attr: "lightPalette" | "darkPalette", value: string, fallback: string): void {
  const root = document.documentElement;
  if (value === fallback) delete root.dataset[attr];
  else root.dataset[attr] = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    // preference just won't persist
  }
}

/** Swatch colours for the picker: [page, card] (kept in step with styles.css). */
export const PALETTE_SWATCH: Record<LightPalette | DarkPalette, readonly [string, string]> = {
  plain: ["#ffffff", "#f1f1f3"],
  paper: ["#faf9f5", "#efede5"],
  mist: ["#f8f8f7", "#ececea"],
  graphite: ["#161616", "#262628"],
  smoke: ["#212120", "#313130"],
  dusk: ["#252524", "#353534"],
  tea: ["#262624", "#363633"],
  sandalwood: ["#262423", "#363332"],
  ink: ["#000000", "#18181a"],
};

export const loadLightPalette = (): LightPalette => loadPalette(LIGHT_PALETTE_KEY, LIGHT_PALETTES);
export const loadDarkPalette = (): DarkPalette => loadPalette(DARK_PALETTE_KEY, DARK_PALETTES);
export const applyLightPalette = (v: LightPalette): void => applyPalette(LIGHT_PALETTE_KEY, "lightPalette", v, LIGHT_PALETTES[0]);
export const applyDarkPalette = (v: DarkPalette): void => applyPalette(DARK_PALETTE_KEY, "darkPalette", v, DARK_PALETTES[0]);
