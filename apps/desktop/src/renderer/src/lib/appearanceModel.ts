// Settings → 外观 model (pure): fields, ranges, parsing and the CSS variables they become.
// lib/appearance.ts stores and applies it.
import { cssString, FALLBACK_FONT_VARIABLES, type FontVariables } from "./fontFaces";

export type Density = "compact" | "standard" | "comfortable";

export interface Appearance {
  /** Whole-window zoom, percent (Electron zoom factor). */
  zoom: number;
  /** Latin UI font family ("" = built-in stack). */
  uiFont: string;
  /** Font restricted to CJK characters ("" = built-in CJK stack). */
  cjkFont: string;
  /** Conversation text font ("" = same as the UI). */
  chatFont: string;
  /** Conversation CJK font ("" = the UI CJK font). */
  chatCjkFont: string;
  /** Conversation text size, px. */
  chatFontSize: number;
  monoFont: string;
  monoFontSize: number;
  /** Sidebar width, px (also set by dragging its edge). */
  sidebarWidth: number;
  /** Right side pane (files / changes / preview) width, px; set by dragging its left edge. */
  sidePaneWidth: number;
  /** Conversation column max width, px (0 = full width). */
  readingWidth: number;
  density: Density;
  /** Status capsule scale, percent. */
  capsuleScale: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  zoom: 100,
  uiFont: "",
  cjkFont: "",
  chatFont: "",
  chatCjkFont: "",
  chatFontSize: 14,
  monoFont: "",
  monoFontSize: 13,
  sidebarWidth: 256,
  sidePaneWidth: 420,
  readingWidth: 768,
  density: "standard",
  capsuleScale: 100,
};

/** Allowed ranges (wide on purpose: 4K at 100% scaling and a laptop at 200% both need to fit). */
export const RANGES = {
  zoom: [50, 250],
  chatFontSize: [11, 28],
  monoFontSize: [10, 24],
  sidebarWidth: [180, 640],
  sidePaneWidth: [260, 1600],
  readingWidth: [480, 2400],
  capsuleScale: [70, 300],
} as const satisfies Partial<Record<keyof Appearance, readonly [number, number]>>;

const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

export function parseAppearance(raw: unknown): Appearance {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    zoom: clamp(v.zoom, RANGES.zoom, DEFAULT_APPEARANCE.zoom),
    uiFont: str(v.uiFont),
    cjkFont: str(v.cjkFont),
    chatFont: str(v.chatFont),
    chatCjkFont: str(v.chatCjkFont),
    chatFontSize: clamp(v.chatFontSize, RANGES.chatFontSize, DEFAULT_APPEARANCE.chatFontSize),
    monoFont: str(v.monoFont),
    monoFontSize: clamp(v.monoFontSize, RANGES.monoFontSize, DEFAULT_APPEARANCE.monoFontSize),
    sidebarWidth: clamp(v.sidebarWidth, RANGES.sidebarWidth, DEFAULT_APPEARANCE.sidebarWidth),
    sidePaneWidth: clamp(v.sidePaneWidth, RANGES.sidePaneWidth, DEFAULT_APPEARANCE.sidePaneWidth),
    readingWidth: v.readingWidth === 0 ? 0 : clamp(v.readingWidth, RANGES.readingWidth, DEFAULT_APPEARANCE.readingWidth),
    density: v.density === "compact" || v.density === "comfortable" ? v.density : "standard",
    capsuleScale: clamp(v.capsuleScale, RANGES.capsuleScale, DEFAULT_APPEARANCE.capsuleScale),
  };
}

/** A CSS font-family list: the chosen families first, then the built-in stack. */
export function fontStack(families: string[], base: string): string {
  const quoted = families.filter(Boolean).map((f) => (/^[\w-]+$/.test(f) && !/^\d/.test(f) ? f : cssString(f)));
  return [...quoted, base].join(", ");
}

/** CSS variables for an appearance (tested; applyAppearance writes them on <html>). */
export function appearanceVars(a: Appearance, fonts: FontVariables = FALLBACK_FONT_VARIABLES): Record<string, string> {
  return {
    ...fonts,
    "--chat-font-size": `${a.chatFontSize}px`,
    "--mono-font-size": `${a.monoFontSize}px`,
    "--sidebar-w": `${a.sidebarWidth}px`,
    "--sidepane-w": `${a.sidePaneWidth}px`,
    "--reading-w": a.readingWidth === 0 ? "none" : `${a.readingWidth}px`,
    "--capsule-scale": String(a.capsuleScale / 100),
  };
}

/** Room the conversation column always keeps when a pane is dragged wider, px. */
export const MIN_CONVERSATION_W = 360;

/**
 * Width for a dragged pane: within its range, and never so wide that the rest of its row (`room` =
 * the row's width, pane included) drops below MIN_CONVERSATION_W. The range minimum wins when the
 * window is too narrow for both.
 */
export function clampPaneWidth(width: number, [lo, hi]: readonly [number, number], room = Number.POSITIVE_INFINITY): number {
  const max = Math.min(hi, room - MIN_CONVERSATION_W);
  return Math.round(Math.max(lo, Math.min(max, width)));
}
