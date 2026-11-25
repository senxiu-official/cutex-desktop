// ProjectBadge's boxes (components/ProjectBadge), outside the component file so lists can size an icon slot
// (lib/entityIcon entityIconSlot) without rendering.
import { clipToWidth, displayWidth } from "./badgeWidth";
import { projectLucideIcon, type ProjectIconChoice } from "./projectIcons";

// The three sizes in use: sm = the sidebar headers (fills the sidebar's 18px icon slot), md = inline
// labels, the title bar chip, the flyout header and pickers (fits a 16px text line, so those rows keep
// their height), lg = the projects page and the icon picker preview.
// Glyphs are 2/3 of the tile (line style: the box minus 4px, no tile around them); letters one size
// for one or two characters.
export const PROJECT_BADGE_SIZES = {
  sm: { box: 18, radius: 5, icon: 12, lineIcon: 14, text: 9, emoji: 11 },
  md: { box: 16, radius: 4.5, icon: 11, lineIcon: 12, text: 8.5, emoji: 10 },
  lg: { box: 22, radius: 6, icon: 14, lineIcon: 18, text: 10.5, emoji: 13 },
} as const;

export type ProjectBadgeSize = keyof typeof PROJECT_BADGE_SIZES;

/** The box width of a letter / text badge (a glyph or emoji badge is always the square box). */
export function projectBadgeBoxWidth(text: string, glyph: boolean, size: ProjectBadgeSize): number {
  const s = PROJECT_BADGE_SIZES[size];
  return !glyph && displayWidth(text) > 2 ? Math.ceil(displayWidth(text) * s.text * 0.65 + 6) : s.box;
}

/** The width ProjectBadge draws for this icon choice / badge at `size`. */
export function projectBadgeWidth(icon: ProjectIconChoice | null | undefined, badge: string, size: ProjectBadgeSize): number {
  const glyph = icon?.kind === "emoji" || (icon?.kind === "icon" && !!projectLucideIcon(icon.value));
  return projectBadgeBoxWidth(clipToWidth(icon?.kind === "text" ? icon.value : badge, 4), glyph, size);
}
