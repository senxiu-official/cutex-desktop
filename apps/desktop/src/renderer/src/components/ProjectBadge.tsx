// A project's icon everywhere — sidebar headers, collapsed rows, hover cards, the projects page,
// title bar chip, project pickers: the chosen emoji, lucide icon or custom text, or the daemon's
// letter badge as the fallback. One component so every surface shows the same thing (the picker
// writes prefs `projectIcons`, lib/projectIcons; the colour comes from cutex presentation).
//
// Look (2026-10-14, Settings → 外观 → 项目图标样式, prefs `projectIconStyle`): 淡底色 (tint, default)
// = a soft tint tile — a fixed square in the project colour at a low strength with the glyph /
// letters in the project colour itself; 线条 (line) = the same glyph / letters with no tile, in the
// same box (a slightly larger glyph fills it), so the name column does not move between styles
// (`.project-icon` / `.project-icon-line` in styles.css; colour tuning per theme shared by both). Every kind sits in the same box: one glyph size, one stroke, one letter size for 1–2
// letters, centred on the line box, so glyph and letter icons line up and the text column after the
// icon never moves.
import type { CSSProperties } from "react";
import { useUiPrefs, type ProjectIconStyle } from "../lib/prefs";
import { projectColor } from "../lib/sidebar";
import { projectLucideIcon, type ProjectIconChoice } from "../lib/projectIcons";

// The three sizes in use: sm = the sidebar headers (fills the sidebar's 18px icon slot), md = inline
// labels, the title bar chip, the flyout header and pickers (fits a 16px text line, so those rows keep
// their height), lg = the projects page and the icon picker preview.
// Glyphs are 2/3 of the tile (line style: the box minus 4px, no tile around them); letters one size
// for one or two characters.
const SIZES = {
  sm: { box: 18, radius: 5, icon: 12, lineIcon: 14, text: 9, emoji: 11 },
  md: { box: 16, radius: 4.5, icon: 11, lineIcon: 12, text: 8.5, emoji: 10 },
  lg: { box: 22, radius: 6, icon: 14, lineIcon: 18, text: 10.5, emoji: 13 },
} as const;

/** The glyph stroke in px at every size (lucide strokeWidth is in 24-unit viewBox space). */
const STROKE_PX = 1.15;

/** `look` overrides the 项目图标样式 pref (e.g. a preview of the other style). */
export function ProjectBadge({ icon, badge, color, size = "md", className = "", look }: { icon?: ProjectIconChoice | null; badge: string; color: string; size?: keyof typeof SIZES; className?: string; look?: ProjectIconStyle }) {
  const pref = useUiPrefs().projectIconStyle;
  const line = (look ?? pref) === "line";
  const s = SIZES[size];
  const iconSize = line ? s.lineIcon : s.icon;
  const hex = projectColor(color);
  // White (the picker's first swatch) has no tint to show on a light surface: it takes the
  // foreground colour instead (a grey tile with a dark glyph in light, a light one in dark).
  const tone = hex.toLowerCase() === "#ffffff" ? "var(--fg)" : hex;
  const Lucide = icon?.kind === "icon" ? projectLucideIcon(icon.value) : null;
  const emoji = icon?.kind === "emoji" ? icon.value : null;
  // The tile holds two characters at most (custom text is 1–2; a daemon badge label may have up to 4).
  const text = [...(icon?.kind === "text" ? icon.value : badge)].slice(0, 2).join("");
  return (
    <span
      data-project-badge=""
      data-icon-style={line ? "line" : "tint"}
      className={`project-icon ${line ? "project-icon-line " : ""}flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{ "--project-icon-color": tone, width: s.box, height: s.box, borderRadius: s.radius } as CSSProperties}
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
