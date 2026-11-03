import { PROJECT_PALETTE } from "./projectCreate";
import { projectColor } from "./sidebar";

/** Extra project colours, shared by creation and icon editing; the six daemon tokens stay first. */
export const PROJECT_EXTRA_COLORS = [
  "#6E56CF", "#8B5CF6", "#F76B15", "#0D9488", "#D6409F", "#A87956",
  "#64748B", "#4F46E5", "#84CC16", "#E11D48", "#0EA5E9", "#FFFFFF",
] as const;

export function projectHex(value: string): string | null {
  const hex = value.trim();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
}

/** Selection follows the actual rendered colour, including stored uppercase RGB values. */
export function sameProjectColor(value: string, swatch: string): boolean {
  return projectColor(value).toLowerCase() === projectColor(swatch).toLowerCase();
}

export function customProjectColor(value: string): string | null {
  const hex = projectHex(value);
  return hex && ![...PROJECT_PALETTE, ...PROJECT_EXTRA_COLORS].some(c => sameProjectColor(hex, c)) ? hex : null;
}
