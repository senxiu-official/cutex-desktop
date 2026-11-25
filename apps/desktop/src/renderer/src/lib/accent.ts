// Accent colour (Settings → 外观 → 强调色; desktop-local, owner 2026-11-25). One pick — a preset or a custom colour —
// becomes a light-theme and a dark-theme value, each readable as link text (WCAG AA 4.5:1) on that theme's page
// backgrounds. They land on <html> as --accent-light / --accent-dark (inline), and styles.css picks the one for the
// theme in effect, so 跟随系统 switches without script. The default (蓝) sets nothing: the stylesheet's fallbacks are
// blue's derived values (owner 2026-11-25: the default follows the same readable rule as every other pick).

/** Presets, in picker order. `seed` is the colour the owner sees in the swatch; light / dark are derived from it. */
export const ACCENT_PRESETS = [
  { id: "blue", seed: "#3b82f6" },
  { id: "indigo", seed: "#6366f1" },
  { id: "violet", seed: "#8b5cf6" },
  { id: "pink", seed: "#ec4899" },
  { id: "rose", seed: "#f43f5e" },
  { id: "orange", seed: "#f97316" },
  { id: "green", seed: "#16a34a" },
  { id: "teal", seed: "#14b8a6" },
] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number]["id"];
/** A preset id, or a custom colour as `#rrggbb`. */
export type AccentPref = AccentPreset | `#${string}`;

export const DEFAULT_ACCENT: AccentPreset = "blue";
/** The default's values: deriveAccent(blue's seed), written into styles.css / ownerAlert.css as the fallbacks (test/accent). */
export const DEFAULT_ACCENT_VALUES = { light: "#1861d2", dark: "#79acff", onLight: "#ffffff", onDark: "#0f1115" } as const;

const KEY = "cutex-desktop.accent";
/** AA for normal-size text. */
export const TEXT_CONTRAST = 4.5;
/**
 * Everything accent text can sit on, per theme: --bg, --surface, --surface-2, --raised (= --float, popovers), --win,
 * --bubble and --peer of every palette in styles.css (worst case wins). test/accent reads styles.css and fails when a
 * palette value is missing here.
 */
export const LIGHT_BACKGROUNDS = [
  "#ffffff", "#f6f6f7", "#ececee", "#f0f0f2", "#eef4ff", "#f1f1f3", "#faf9f5", "#f3f1ea", "#e8e5da", "#fffdf8", "#eeebe1",
  "#edf1f8", "#efede5", "#f8f8f7", "#f1f1ef", "#e6e6e3", "#fdfdfc", "#ebebe8", "#ececea",
] as const;
export const DARK_BACKGROUNDS = [
  "#161616", "#1c1c1d", "#262628", "#3a3a3e", "#1f2a3a", "#0e0e0f", "#212120", "#272726", "#313130", "#3d3d3b", "#2f2f2d",
  "#191918", "#252524", "#2b2b2a", "#353534", "#403f3e", "#333331", "#2a3140", "#1d1d1c", "#262624", "#2c2c2a", "#363633",
  "#40403c", "#353531", "#1f1e1c", "#262423", "#2c2a29", "#363332", "#403d3b", "#35312f", "#1f1d1c", "#000000", "#0b0b0c",
  "#18181a", "#26262a", "#161618",
] as const;
/** Text on an accent fill (buttons, checked boxes, count badges): white, or this when it reads better. */
export const ON_ACCENT_DARK = "#0f1115";

/** White or near-black, whichever reads better on `fill` (a pale accent gets dark text). */
export function onAccentFor(fill: string): string {
  return contrast("#ffffff", fill) >= contrast(ON_ACCENT_DARK, fill) ? "#ffffff" : ON_ACCENT_DARK;
}

type Rgb = [number, number, number];

export function parseHex(input: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** `#rrggbb` (lower case) for a valid colour, else null. */
export function normalizeHex(input: string): string | null {
  const c = parseHex(input);
  return c ? toHex(c) : null;
}

function toHex(c: Rgb): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio of two colours (1–21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** The lowest contrast of `color` against any of `backgrounds`. */
export function minContrast(color: string, backgrounds: readonly string[]): number {
  return Math.min(...backgrounds.map((b) => contrast(color, b)));
}

// OKLCH: lightness moves keep the hue and look even, unlike HSL.
type Lch = [number, number, number];

function toOklch(c: Rgb): Lch {
  const [r, g, b] = c.map(lin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** sRGB for an OKLCH colour, or null when it is outside sRGB. */
function fromOklch([L, C, h]: Lch): Rgb | null {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  if (rgb.some((v) => v < -0.0005 || v > 1.0005)) return null;
  return rgb.map((v) => unlin(Math.min(1, Math.max(0, v)))) as Rgb;
}

/** The colour at lightness `L` with the seed's hue, chroma reduced only as far as sRGB needs. */
function atLightness(L: number, C: number, h: number): string {
  for (let c = C; c >= 0; c -= 0.004) {
    const rgb = fromOklch([L, c, h]);
    if (rgb) return toHex(rgb);
  }
  return toHex(fromOklch([L, 0, h]) ?? [0, 0, 0]);
}

/** Moves lightness in `step` from `L` until the colour reads at `TEXT_CONTRAST` on every background. */
function untilReadable(L: number, C: number, h: number, step: number, backgrounds: readonly string[]): string {
  let color = atLightness(L, C, h);
  for (let x = L; x >= 0 && x <= 1; x += step) {
    color = atLightness(x, C, h);
    if (minContrast(color, backgrounds) >= TEXT_CONTRAST) return color;
  }
  return color;
}

/**
 * Light and dark values for one picked colour. Light: the colour itself, darkened until it reads on every light page
 * (so white text on it reads too). Dark: one step lighter (like Tailwind 500 → 400), lightened further until it reads
 * on every dark page. Text on a fill of either value is white or near-black, whichever reads better (onAccentFor).
 */
export type AccentValues = { light: string; dark: string; onLight: string; onDark: string };

export function deriveAccent(seed: string): AccentValues {
  const rgb = parseHex(seed) ?? parseHex(ACCENT_PRESETS[0].seed)!;
  const [L, C, h] = toOklch(rgb);
  const light = untilReadable(Math.min(L, 0.98), C, h, -0.005, LIGHT_BACKGROUNDS);
  // A pale pick is not lifted further toward white (it already reads); a dark one starts at least mid-light.
  const dark = untilReadable(Math.min(Math.max(L + 0.08, 0.55), Math.max(L, 0.8)), C, h, 0.005, DARK_BACKGROUNDS);
  return { light, dark, onLight: onAccentFor(light), onDark: onAccentFor(dark) };
}

export function isAccentPreset(v: string): v is AccentPreset {
  return ACCENT_PRESETS.some((p) => p.id === v);
}

/** The swatch colour for a pick: a preset's seed, or the custom colour. */
export function accentSeed(pref: AccentPref): string {
  return ACCENT_PRESETS.find((p) => p.id === pref)?.seed ?? normalizeHex(pref) ?? ACCENT_PRESETS[0].seed;
}

/** The values for a pick; the default's equal the stylesheet's fallbacks. */
export function accentValues(pref: AccentPref): AccentValues {
  return pref === DEFAULT_ACCENT ? { ...DEFAULT_ACCENT_VALUES } : deriveAccent(accentSeed(pref));
}

/** A stored value read back: a known preset or a valid colour; anything else is the default. */
export function parseAccentPref(raw: string | null | undefined): AccentPref {
  if (!raw) return DEFAULT_ACCENT;
  if (isAccentPreset(raw)) return raw;
  return (normalizeHex(raw) as AccentPref | null) ?? DEFAULT_ACCENT;
}

export function loadAccent(): AccentPref {
  try {
    return parseAccentPref(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_ACCENT;
  }
}

const VARS = ["--accent-light", "--accent-dark", "--on-accent-light", "--on-accent-dark"] as const;

/** Puts a pick on <html> (or `root`) without saving it: other windows and the start-up path. */
export function setAccentVars(pref: AccentPref, root: HTMLElement = document.documentElement): void {
  if (pref === DEFAULT_ACCENT) {
    for (const v of VARS) root.style.removeProperty(v);
    delete root.dataset.accent;
    return;
  }
  const { light, dark, onLight, onDark } = accentValues(pref);
  root.style.setProperty("--accent-light", light);
  root.style.setProperty("--accent-dark", dark);
  root.style.setProperty("--on-accent-light", onLight);
  root.style.setProperty("--on-accent-dark", onDark);
  // An attribute too, so observers that watch attributes (terminal theme) hear the change.
  root.dataset.accent = isAccentPreset(pref) ? pref : "custom";
}

let pendingWrite: { pref: AccentPref; timer: ReturnType<typeof setTimeout> } | null = null;

/** Writes a pending pick now (tests; otherwise it lands 150 ms after the last change). */
export function flushAccentWrite(): void {
  if (!pendingWrite) return;
  const { pref, timer } = pendingWrite;
  clearTimeout(timer);
  pendingWrite = null;
  try {
    if (pref === DEFAULT_ACCENT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // preference just won't persist
  }
}

/**
 * Applies a pick at once and saves it (Settings). Dragging the custom picker changes it many times a second, so the
 * write (and the other windows' `storage` events) waits until it has been still for 150 ms.
 */
export function applyAccent(pref: AccentPref): void {
  setAccentVars(pref);
  if (pendingWrite) clearTimeout(pendingWrite.timer);
  pendingWrite = { pref, timer: setTimeout(flushAccentWrite, 150) };
}

/** Other windows of this desktop (board, big alert) follow a change made in Settings. */
export function followStoredAccent(): () => void {
  setAccentVars(loadAccent());
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) setAccentVars(loadAccent());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
