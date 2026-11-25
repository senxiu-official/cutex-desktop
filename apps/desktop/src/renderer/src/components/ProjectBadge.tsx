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
import type { PROJECT_BADGE_SIZES as SIZES } from "../lib/projectBadgeSize";
import { useUiPrefs, type ProjectIconStyle } from "../lib/prefs";
import { projectColor } from "../lib/sidebar";
import type { ProjectIconChoice } from "../lib/projectIcons";
import { ProjectBadgeView } from "./ProjectBadgeView";

/** `look` overrides the 项目图标样式 pref (e.g. a preview of the other style). */
export function ProjectBadge({ icon, badge, color, size = "md", className = "", look }: { icon?: ProjectIconChoice | null; badge: string; color: string; size?: keyof typeof SIZES; className?: string; look?: ProjectIconStyle }) {
  const pref = useUiPrefs().projectIconStyle;
  return <ProjectBadgeView icon={icon} badge={badge} hex={projectColor(color)} size={size} className={className} line={(look ?? pref) === "line"} />;
}
