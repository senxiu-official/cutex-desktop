/** Desktop-local visual feedback only: no page text, refs, selectors, input values or authority. */
export const DEFAULT_BROWSER_CURSOR_COLOR = "#7966db";
export const BROWSER_CURSOR_MOVE_MS = 160;
export type BrowserCursorKind = "click" | "hover" | "type" | "scroll";
export interface BrowserCursorCue {
  sequence: number;
  kind: BrowserCursorKind;
  phase: "move" | "dispatch";
  x: number; y: number;
  viewport: { width: number; height: number };
  rect?: { x: number; y: number; width: number; height: number };
}
export interface BrowserCursorView extends BrowserCursorCue { color: string }
export interface BrowserCursorPreferences { color: string }
export const isBrowserCursorColor = (color: unknown): color is string => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
/** Contrast with the chosen fill; a white/black cursor remains outlined on either page theme. */
export function browserCursorOutline(color: string): string {
  const c = isBrowserCursorColor(color) ? color : DEFAULT_BROWSER_CURSOR_COLOR;
  if (c.toLowerCase() === DEFAULT_BROWSER_CURSOR_COLOR) return "#ffffff";
  const rgb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722 > .179 ? "#151821" : "#ffffff";
}
export function browserCursorView(value: unknown): BrowserCursorView | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as BrowserCursorView, p = v.viewport;
  const number = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (!Number.isSafeInteger(v.sequence) || v.sequence < 1 || !["click", "hover", "type", "scroll"].includes(v.kind)
    || !["move", "dispatch"].includes(v.phase) || !isBrowserCursorColor(v.color) || !p
    || !number(p.width, 1, 16384) || !number(p.height, 1, 16384) || !number(v.x, 0, p.width) || !number(v.y, 0, p.height)) return;
  const rect = v.rect;
  if (rect && (!number(rect.x, 0, p.width) || !number(rect.y, 0, p.height) || !number(rect.width, 0, p.width - rect.x + .001) || !number(rect.height, 0, p.height - rect.y + .001))) return;
  return { sequence: v.sequence, kind: v.kind, phase: v.phase, x: v.x, y: v.y, viewport: { width: p.width, height: p.height }, color: v.color.toLowerCase(),
    ...(rect ? { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : {}) };
}
