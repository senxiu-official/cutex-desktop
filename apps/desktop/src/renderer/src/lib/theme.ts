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
