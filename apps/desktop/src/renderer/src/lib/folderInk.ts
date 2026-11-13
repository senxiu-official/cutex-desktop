// The ink of a folder colour the palette does not hold (外观… custom colours and the extra swatches, owner 2026-11-06).
// The palette's own colours keep the CSS rule (styles.css `.folder-ink`: the colour mixed 24% toward black in light
// themes, 12% toward white in dark ones). Any other colour starts from the same mix and goes further toward black /
// white, in the same oklab space, until the name reads at least 4.5:1 on every sidebar background of that theme
// family (all light / all dark palettes, card and surface). A very light pick in light themes or a very dark one in
// dark themes is therefore drawn darker / lighter rather than refused; the dialog's preview shows that result.
import { contrastRatio, hexRgb, type Rgb } from "./workSurface";

/** The sidebar backgrounds (`--bg`, `--surface`) of every palette, per theme family (styles.css). */
export const SIDEBAR_BACKGROUNDS = {
  light: ["#ffffff", "#f6f6f7", "#faf9f5", "#f3f1ea", "#f8f8f7", "#f1f1ef"],
  dark: ["#161616", "#1c1c1d", "#212120", "#272726", "#252524", "#2b2b2a", "#262624", "#2c2c2a", "#262423", "#2c2a29", "#000000", "#0b0b0c"],
} as const;
/** A little over 4.5:1, so rounding in the browser's own colour mixing never lands under it. */
export const INK_TARGET = 4.6;

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
type Lab = [number, number, number];
function toLab(c: Rgb): Lab {
  const [r, g, b] = c.map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function toRgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return rgb.map((v) => Math.min(1, Math.max(0, gam(v)))) as unknown as Rgb;
}
/** `c` mixed with `toward` in oklab, `amount` of the latter (CSS `color-mix(in oklab, c (1-amount), toward)`). */
function mix(c: Rgb, toward: Rgb, amount: number): Rgb {
  const x = toLab(c);
  const y = toLab(toward);
  return toRgb(x.map((v, i) => v * (1 - amount) + y[i]! * amount) as Lab);
}
const hex = (c: Rgb) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

/** The lowest contrast of `ink` on the theme family's sidebar backgrounds. */
export function worstContrast(ink: string, theme: "light" | "dark"): number {
  return Math.min(...SIDEBAR_BACKGROUNDS[theme].map((bg) => contrastRatio(hexRgb(ink), hexRgb(bg))));
}

/** `a` (#RRGGBB) mixed with `b` in oklab, `amount` of `b` (CSS `color-mix(in oklab, a (1-amount), b)`), as #rrggbb. */
export function mixHex(a: string, b: string, amount: number): string {
  return hex(mix(hexRgb(a), hexRgb(b), amount));
}

/** `color` from `start` further toward black (light) / white (dark) until it reads INK_TARGET on every one of `backgrounds`. */
export function readableInk(color: string, theme: "light" | "dark", start: number, backgrounds: readonly string[]): string {
  const c = hexRgb(color);
  const toward: Rgb = theme === "light" ? [0, 0, 0] : [1, 1, 1];
  for (let amount = start; amount < 1; amount += 0.02) {
    const ink = hex(mix(c, toward, amount));
    if (Math.min(...backgrounds.map((bg) => contrastRatio(hexRgb(ink), hexRgb(bg)))) >= INK_TARGET) return ink;
  }
  return hex(toward);
}

/** The ink of `color` (#RRGGBB) for light and dark themes. */
export function folderInks(color: string): { light: string; dark: string } {
  return { light: readableInk(color, "light", 0.24, SIDEBAR_BACKGROUNDS.light), dark: readableInk(color, "dark", 0.12, SIDEBAR_BACKGROUNDS.dark) };
}
