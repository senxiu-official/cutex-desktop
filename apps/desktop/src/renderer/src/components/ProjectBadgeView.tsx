// ProjectBadge's drawing without the app's prefs or store (components/ProjectBadge reads the 项目图标样式 pref and the
// project colour, then draws this), so a window outside the app renderer (the 项目看板 board) draws the same icon.
import type { CSSProperties } from "react";
import { clipToWidth } from "../lib/badgeWidth";
import { PROJECT_BADGE_SIZES as SIZES, projectBadgeBoxWidth } from "../lib/projectBadgeSize";
import { projectLucideIcon, type ProjectIconChoice } from "../lib/projectIcons";

/** The glyph stroke in px at every size (lucide strokeWidth is in 24-unit viewBox space). */
const STROKE_PX = 1.15;

/** `hex`: the project colour resolved (#RRGGBB); `line`: the 线条 look (no tile). */
export function ProjectBadgeView({ icon, badge, hex, size = "md", className = "", line = false }: { icon?: ProjectIconChoice | null; badge: string; hex: string; size?: keyof typeof SIZES; className?: string; line?: boolean }) {
  const s = SIZES[size];
  const iconSize = line ? s.lineIcon : s.icon;
  // White (the picker's first swatch) has no tint to show on a light surface: it takes the
  // foreground colour instead (a grey tile with a dark glyph in light, a light one in dark).
  const tone = hex.toLowerCase() === "#ffffff" ? "var(--fg)" : hex;
  const Lucide = icon?.kind === "icon" ? projectLucideIcon(icon.value) : null;
  const emoji = icon?.kind === "emoji" ? icon.value : null;
  // Keep four display columns; wide labels grow horizontally without changing row height.
  const text = clipToWidth(icon?.kind === "text" ? icon.value : badge, 4);
  const boxWidth = projectBadgeBoxWidth(text, !!emoji || !!Lucide, size);
  return (
    <span
      data-project-badge=""
      data-icon-style={line ? "line" : "tint"}
      className={`project-icon ${line ? "project-icon-line " : ""}flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{ "--project-icon-color": tone, width: boxWidth, height: s.box, borderRadius: s.radius } as CSSProperties}
      aria-hidden
    >
      {emoji ? (
        <span className="leading-none" style={{ fontSize: s.emoji }}>
          {emoji}
        </span>
      ) : Lucide ? (
        <Lucide size={iconSize} strokeWidth={(STROKE_PX * 24) / iconSize} className="block" />
      ) : (
        // Centred by its line box (line-height 1), not the baseline; no tracking so 1 and 2 letters match.
        <span className="block font-bold leading-none tracking-normal whitespace-nowrap" style={{ fontSize: s.text }}>
          {text}
        </span>
      )}
    </span>
  );
}
