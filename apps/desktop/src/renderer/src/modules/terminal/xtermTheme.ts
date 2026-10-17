// xterm helpers for the terminal card: colours from the app's tokens plus a contrast-checked 16-colour
// ANSI palette per theme (re-read when the theme changes)
// and the base64 output the daemon streams.
import type { ITheme } from "@xterm/xterm";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type AnsiName =
  | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white"
  | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow" | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite";
export type AnsiPalette = Record<AnsiName, string>;

/** ANSI order (SGR 30–37, 90–97). */
export const ANSI_NAMES: readonly AnsiName[] = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

/** Background each palette is tuned for: the app's `--bg` in styles.css. */
export const PALETTE_BACKGROUND = { light: "#ffffff", dark: "#161616" } as const;

/**
 * 16 ANSI colours per app theme. Every colour reaches WCAG AA (4.5:1) on the theme's `--bg`, except the
 * ones that conventionally *are* the background (`ANSI_BACKGROUND_ROLE`): ANSI black on dark, white /
 * bright white on light. Those stay near their name so `\e[40m` / `\e[47m` fills still look like black /
 * white, and as text they are lifted by xterm's `minimumContrastRatio` (TERMINAL_MIN_CONTRAST).
 * Light theme: the "bright" variants are darker (stronger) than the normal ones — on white, lighter would
 * mean fainter.
 */
export const ANSI_PALETTES: Record<"light" | "dark", AnsiPalette> = {
  light: {
    black: "#1d1d1f", red: "#c4262e", green: "#21781a", yellow: "#8a5a00",
    blue: "#1f5fd1", magenta: "#a12bab", cyan: "#0b7285", white: "#9c9ca3",
    brightBlack: "#5f6066", brightRed: "#a3141c", brightGreen: "#1a6014", brightYellow: "#734a00",
    brightBlue: "#1747a6", brightMagenta: "#80208a", brightCyan: "#085a69", brightWhite: "#c4c4ca",
  },
  dark: {
    black: "#3a3a3e", red: "#f47174", green: "#4cc16b", yellow: "#e0b030",
    blue: "#5c9cf5", magenta: "#d07ae6", cyan: "#2fbfd3", white: "#c8c8cd",
    brightBlack: "#8c8c94", brightRed: "#ff9c9c", brightGreen: "#7ee29a", brightYellow: "#fbe07c",
    brightBlue: "#93c2ff", brightMagenta: "#ecaafb", brightCyan: "#7fe3f1", brightWhite: "#ffffff",
  },
};

/** Colours exempt from the 4.5:1 check because they are the theme's background role (see ANSI_PALETTES). */
export const ANSI_BACKGROUND_ROLE: Record<"light" | "dark", readonly AnsiName[]> = {
  light: ["white", "brightWhite"],
  dark: ["black"],
};

/** xterm re-colours any glyph below this ratio against its cell background (covers the exemptions above
 *  and program-chosen fg/bg pairs such as red text on a red fill). */
export const TERMINAL_MIN_CONTRAST = 4.5;

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  const digits = m?.[1];
  if (!digits) return null;
  const h = digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits;
  const n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function parseColor(color: string): [number, number, number] | null {
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return parseHex(color);
}

/** WCAG relative luminance of a `#rgb` / `#rrggbb` / `rgb()` colour (null if unparseable). */
export function luminance(color: string): number | null {
  const c = parseColor(color);
  if (!c) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a) ?? 0;
  const lb = luminance(b) ?? 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `#rrggbb` + alpha (0–1) as `#rrggbbaa`; other colour syntaxes are returned unchanged. */
function withAlpha(color: string, alpha: number): string {
  const c = parseHex(color);
  if (!c) return color;
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}${hex(Math.round(alpha * 255))}`;
}

/** The xterm theme for app tokens (`--bg`, `--fg`, `--accent`): a dark `--bg` picks the dark ANSI palette. */
export function themeFromTokens(tokens: { bg?: string; fg?: string; accent?: string }): ITheme {
  const lum = tokens.bg ? luminance(tokens.bg) : null;
  const mode: "light" | "dark" = lum !== null && lum < 0.18 ? "dark" : "light";
  const background = tokens.bg || PALETTE_BACKGROUND[mode];
  const foreground = tokens.fg || (mode === "dark" ? "#ececec" : "#1d1d1f");
  const accent = tokens.accent || (mode === "dark" ? "#60a5fa" : "#3b82f6");
  return {
    ...ANSI_PALETTES[mode],
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: withAlpha(accent, mode === "dark" ? 0.4 : 0.28),
    selectionInactiveBackground: withAlpha(accent, mode === "dark" ? 0.22 : 0.16),
  };
}

export function terminalTheme(): ITheme {
  return themeFromTokens({ bg: cssVar("--bg"), fg: cssVar("--fg"), accent: cssVar("--accent") });
}

/** Calls `onChange` when the app theme (data-theme) or the system colour scheme changes. */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** `prefix` (ASCII) followed by `bytes`, as one write. */
export function concat(prefix: string, bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + bytes.length);
  for (let i = 0; i < prefix.length; i++) out[i] = prefix.charCodeAt(i);
  out.set(bytes, prefix.length);
  return out;
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
