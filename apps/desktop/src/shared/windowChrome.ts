// The Windows caption buttons (— □ ×) over the window bar (docs/design/029-caption-buttons.md). They are drawn by
// Electron's Window Controls Overlay; since Electron 44 its fill may be fully transparent (electron#51017) and the
// hover / press tint then comes from the theme, not from the fill (electron#48568). The window bar is transparent
// (the desktop background or the window colour shows through), so the overlay's fill is always transparent and
// only the symbols take the theme's foreground colour — over the window bar's own frost of the window colour
// (styles.css `[data-window-titlebar]`), the same ground the bar's own icons are read on. Pure; tested
// (test/windowChrome.test.ts). Shared by main (validation, the first fill) and the renderer (the colours sent).

/** The overlay's fill: transparent — whatever the window bar shows at that spot shows through. */
export const CAPTION_FILL = "#00000000";

/** A colour main accepts for the overlay: `#rrggbb` or `#rrggbbaa` (nothing else reaches setTitleBarOverlay). */
export function isOverlayColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value);
}

/** A symbol colour: opaque `#rrggbb` only (a translucent symbol would vanish over a busy wallpaper). */
export function isSymbolColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * A CSS colour as the renderer reads it (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()`) → opaque `#rrggbb`;
 * null when it cannot be read (the caller then keeps the theme default).
 */
export function toHex6(css: string): string | null {
  const s = css.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${[...m[1]!].map((c) => c + c).join("")}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v))))).map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  return null;
}

/** Relative luminance of `#rrggbb` (0 black – 1 white). */
export function luminance(hex6: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex6.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

const LIGHT = "#e5e5e5";
const DARK = "#333333";

/** WCAG contrast ratio of two `#rrggbb` colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * What the renderer sends for the caption buttons: the transparent fill, and the symbols in the theme's foreground
 * (`fg`) — readable over the bar's frost of the window colour (`win`). When `fg` cannot be read, or is
 * too close to `win` to read (contrast under 3:1), the symbols are whichever of near-black / near-white reads
 * better over the window colour.
 */
export function captionColors(i: { fg: string; win: string }): { color: string; symbolColor: string } {
  const win = toHex6(i.win);
  const fg = toHex6(i.fg);
  if (!win) return { color: CAPTION_FILL, symbolColor: fg ?? "#e5e5e5" };
  // The fallback: whichever of near-black / near-white reads better over the window colour.
  const fallback = contrast(LIGHT, win) >= contrast(DARK, win) ? LIGHT : DARK;
  if (!fg) return { color: CAPTION_FILL, symbolColor: fallback };
  return { color: CAPTION_FILL, symbolColor: contrast(fg, win) >= 3 ? fg : fallback };
}

/** The overlay main sets before the page reports its theme: transparent, symbols by the OS theme. */
export function initialCaption(darkOs: boolean): { color: string; symbolColor: string } {
  return { color: CAPTION_FILL, symbolColor: darkOs ? "#e5e5e5" : "#333333" };
}
