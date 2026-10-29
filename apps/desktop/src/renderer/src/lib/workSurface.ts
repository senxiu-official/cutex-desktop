// The window's cards over the desktop background (owner 2026-10-21; docs/desktop-modules.md §25.4): pure
// rules for the single conversation column's width, whether the panes fill the work area (→ 贴边显示, edge to
// edge — its own switch since 2026-10-21, apart from 铺满窗口's widths) and the 亚克力 card material (its backdrop filter and the contrast it keeps).
// styles.css mirrors the constants (`--acrylic-filter`, `.shell-card`); components/side/SideArea applies the
// width; lib/appearance stores the settings. Shell code: names no feature.

export type CardMaterial = "opaque" | "acrylic";
/** 单个对话的默认宽度: the reading width, the whole work area, or a percentage of it. */
export type SingleWidthMode = "reading" | "full" | "custom";

/** The conversation card's own border, both sides (px): the reading column fills the card exactly. */
export const CARD_CHROME = 2;
/** The narrowest a single conversation column gets (unless the work area itself is narrower). */
export const SINGLE_MIN_W = 400;
/** Within this many px of the free room the column counts as filling it (no slivers of desktop). */
export const FILL_SLACK = 24;
/** 亚克力 opacity range / default, percent of the card colour over the blurred desktop. */
export const ACRYLIC_RANGE = [70, 95] as const;
export const ACRYLIC_DEFAULT = 82;
/** 自定义百分比 range / default, percent of the work area. */
export const SINGLE_PCT_RANGE = [30, 100] as const;
export const SINGLE_PCT_DEFAULT = 70;

export interface SingleColumnInput {
  /** The work area's width (the row holding the Shelves and the column), px. */
  area: number;
  /** What the Shelves beside it leave, px. */
  free: number;
  /** appearance.readingWidth (0 = full width). */
  readingWidth: number;
  mode: SingleWidthMode;
  /** 自定义百分比 (of `area`). */
  pct: number;
  /** A width dragged at the column's edges (0 = none): wins over the mode. */
  dragged: number;
  /** Within FILL_SLACK of the room it fills it (default); false: a drag left the group where it is — it keeps its width. */
  snap?: boolean;
}

/**
 * The single conversation column's width (px), or null: it fills the room the Shelves leave. The reading
 * width + the card's border by default, so the text fills the card; centred in the work area (CSS auto
 * margins); never wider than the room, never narrower than SINGLE_MIN_W while the room has it.
 */
export function singleColumnWidth(i: SingleColumnInput): number | null {
  const free = Math.max(0, i.free);
  if (free <= 0) return null;
  let want: number | null;
  if (i.dragged > 0) want = i.dragged;
  else if (i.mode === "full") want = null;
  else if (i.mode === "custom") want = Math.round((Math.max(0, i.area) * Math.min(100, Math.max(1, i.pct))) / 100);
  else want = i.readingWidth > 0 ? i.readingWidth + CARD_CHROME : null;
  if (want === null) return null;
  const w = Math.round(Math.min(free, Math.max(Math.min(SINGLE_MIN_W, free), want)));
  return i.snap !== false && w >= free - FILL_SLACK ? null : w;
}

/** The width a drag at one edge of the centred column asks for (both edges move: twice the pointer's way). */
export function draggedWidth(start: number, dx: number, edge: "left" | "right", free: number): number {
  const w = start + 2 * (edge === "right" ? dx : -dx);
  return Math.round(Math.max(Math.min(SINGLE_MIN_W, free), Math.min(free, w)));
}

export interface EdgeInput {
  /** The 贴边显示 setting (appearance.edgeToEdge; was part of 窗格铺满时占满整个窗口 / 铺满窗口). */
  setting: boolean;
  /** The desktop's own content is on screen (nothing in front of it). */
  deskOn: boolean;
  /** The panes do not fill the work area (a column by content, the desktop beside it). */
  narrowColumn: boolean;
}

/** Edge to edge now: the setting is on and the panes cover the whole work area. */
export function edgeToEdge(i: EdgeInput): boolean {
  return i.setting && !i.deskOn && !i.narrowColumn;
}

// ── 桌面亮度 (owner 2026-10-21): how bright the desktop is in each state ──────────────────────────────────

/** The desktop's state for 桌面亮度: nothing in front / a conversation or page open / the panes fill the screen. */
export type DeskState = "empty" | "open" | "full";
/** 桌面亮度 range / defaults, percent (100 = as drawn). */
export const DESK_BRIGHTNESS_RANGE = [0, 100] as const;
export const DESK_BRIGHTNESS_DEFAULT: Record<DeskState, number> = { empty: 100, open: 80, full: 60 };

export interface DeskStateInput {
  /** Something covers the whole work row: the Settings Shelf maximised, a full-window page. */
  covered: boolean;
  /** The desktop's own content is on screen (no pane in front). */
  deskOn: boolean;
  /** The panes fill the work area: a maximised / full-screen panel, 铺满窗口, a single column at full width. */
  filled: boolean;
}

/** Which of the three 桌面亮度 values applies now (pure; components/side/SideArea publishes it on <html>). */
export function deskState(i: DeskStateInput): DeskState {
  if (i.covered) return "full";
  if (i.deskOn) return "empty";
  return i.filled ? "full" : "open";
}

/** The CSS for a 桌面亮度 value: the black veil's opacity over the background, the content's filter ("none" at 100 %). */
export function deskDim(percent: number): { veil: string; filter: string } {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  return { veil: String((100 - p) / 100), filter: p >= 100 ? "none" : `brightness(${p / 100})` };
}

// ── 亚克力: the card colour at `alpha` over the desktop, seen through the backdrop filter ───────────────

export type Rgb = readonly [number, number, number];
export type Theme = "light" | "dark";

/**
 * The backdrop filter per theme (styles.css `--acrylic-filter`): blur, then the backdrop's contrast is
 * squeezed toward light (light theme) / dark (dark theme) so text keeps its contrast over any picture.
 */
export const ACRYLIC_FILTER: Record<Theme, { blur: number; saturate: number; contrast: number; brightness: number }> = {
  light: { blur: 30, saturate: 2.2, contrast: 0.32, brightness: 1.6 },
  dark: { blur: 30, saturate: 2.2, contrast: 0.32, brightness: 0.45 },
};

export function acrylicFilterCss(theme: Theme): string {
  const f = ACRYLIC_FILTER[theme];
  return `blur(${f.blur}px) saturate(${f.saturate}) contrast(${f.contrast}) brightness(${f.brightness})`;
}

export const hexRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Rgb;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c: Rgb) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);

/** WCAG contrast ratio of two colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A flat backdrop colour through the theme's filter (the CSS filter functions, blur aside). */
export function filtered(c: Rgb, theme: Theme): Rgb {
  const { saturate: s, contrast, brightness } = ACRYLIC_FILTER[theme];
  const [r, g, b] = c;
  const sat: Rgb = [
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
  ];
  return sat.map((v) => clamp01(((clamp01(v) - 0.5) * contrast + 0.5) * brightness)) as unknown as Rgb;
}

/** The card's colour as seen: `bg` at `alpha` (0–1) over the filtered backdrop. */
export function acrylicSurface(bg: Rgb, backdrop: Rgb, alpha: number, theme: Theme): Rgb {
  const f = filtered(backdrop, theme);
  return bg.map((v, i) => alpha * v + (1 - alpha) * f[i]!) as unknown as Rgb;
}

/** The lowest contrast of `fg` on the card over each backdrop (worst case: flat black / white / primaries). */
export function worstAcrylicContrast(fg: Rgb, bg: Rgb, alpha: number, theme: Theme, backdrops: readonly Rgb[]): number {
  return Math.min(...backdrops.map((b) => contrastRatio(fg, acrylicSurface(bg, b, alpha, theme))));
}
