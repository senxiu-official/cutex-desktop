// A sidebar group's icon: a project's chosen icon / letter tile (components/ProjectBadge, size sm =
// an 18px tile; 独立智能体 / 工作 get a lucide glyph), resolved from prefs `projectIcons` by the
// caller. It sits in a fixed 18px slot at the left of the group header (where the fold chevron used
// to be), so the 标题行 rail can align with its centre whatever the icon kind. Inside a fold toggle (`toggle`),
// pointing at the icon itself (its 18 x 20 px slot, group `group/icon`) or keyboard focus on the
// toggle (`group/fold` :focus-visible) swaps the icon for the chevron.
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import type { ProjectIconChoice } from "../lib/projectIcons";
import { ProjectBadge } from "./ProjectBadge";

export type GroupIconSource = { badge: string; color: string; icon?: ProjectIconChoice | null } | { glyph: LucideIcon };

export function ProjectIcon({ source, toggle }: { source: GroupIconSource; toggle?: "open" | "closed" }) {
  const Chevron = toggle === "open" ? ChevronDown : ChevronRight;
  const hides = toggle ? "group-hover/icon:invisible group-focus-visible/fold:invisible" : "";
  return (
    <span data-project-icon="" className="group/icon relative flex h-5 w-[18px] shrink-0 items-center justify-center">
      {"glyph" in source ? (
        <source.glyph size={14} strokeWidth={2.2} className={`text-muted ${hides}`} aria-hidden />
      ) : (
        <ProjectBadge icon={source.icon} badge={source.badge} color={source.color} size="sm" className={hides} />
      )}
      {toggle && (
        <span aria-hidden className="invisible absolute inset-0 flex items-center justify-center text-muted group-hover/icon:visible group-focus-visible/fold:visible">
          <Chevron size={13} strokeWidth={2.4} />
        </span>
      )}
    </span>
  );
}
