// A collapsed sidebar project (sidebar v2): one row (badge, name, needs-you / running counts, last
// activity). Hovering shows a flyout beside the sidebar listing its agents (no reflow); a click pins
// it open until a click outside, Esc, or another click on the row. The same flyout previews a project
// the user folded with its icon (Sidebar `Group`); lib/projectFlyout has the rule and the state.
import { BellOff, Star, User } from "lucide-react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { projectMenu } from "../lib/projectMenus";
import { useProjectMuted } from "../lib/notificationLevelsStore";
import { hoverOpensFlyout, isCollapsedRow, useFlyoutGate, useProjectFlyout, type ProjectFlyoutState } from "../lib/projectFlyout";
import { onlineCount, rowKey } from "../lib/sidebar";
import { ProjectBadge } from "./ProjectBadge";
import { NEUTRAL_GROUP, projectBlockLook } from "../lib/projectSeparation";
import type { GroupLayout } from "../lib/sidebarLayout";
import { relativeTime } from "../lib/sidebarView";
import { rootFor } from "../lib/workspace";
import { useSidebarHosts } from "../lib/scopedSidebarView";
import { useUiPrefs } from "../lib/prefs";
import { groupRemark } from "../lib/projectRemarks";
import { groupIcon } from "../lib/projectIcons";
import { sidebarMark } from "../lib/hostScope";
import { sidebarOf, useApp } from "../store";
import { HostMark } from "./HostMark";
import { ProjectIcon } from "./ProjectIcon";
import { AgentRowButton, OfflineRow, PinnedRows } from "./AgentRows";
import { ScriptText } from "./ScriptText";

const FLYOUT_WIDTH = 288;
/** An agent row of the flyout list (its own inner buttons, e.g. row actions, keep it open). */
const FLYOUT_AGENT = "[role=button], button";

export function CollapsedProject({ layout }: { layout: GroupLayout }) {
  const { t } = useI18n();
  const { group } = layout;
  const title = group.kind === "project" ? group.name : t("sidebar.independent");
  const sidebar = useApp((s) => sidebarOf(s, group.hostId));
  const hosts = useSidebarHosts();
  // Project mutes are the focus host's notification levels (other hosts: not shown yet).
  const muted = useProjectMuted(group.id) && (!group.hostId || group.hostId === hosts?.focus);
  const look = sidebarMark(hosts, group.hostId);
  const root = group.kind === "project" ? rootFor(sidebar, { kind: "project", id: group.id }) : null;
  const prefs = useUiPrefs();
  const remark = groupRemark(prefs.projectRemarks, group, hosts?.focus ?? "local");
  const { dragging } = useFlyoutGate();
  const fly = useProjectFlyout({ available: !dragging, hoverEnabled: hoverOpensFlyout({ collapsed: isCollapsedRow(layout, false), hoverPreview: prefs.projectHoverPreview, dragging }), delay: prefs.projectHoverDelay });
  const hint = t(prefs.projectHoverPreview ? "sidebar.flyoutPin" : "sidebar.flyoutPinClick");
  const block = projectBlockLook(prefs.projectSeparation, group.kind === "project" ? group.color : NEUTRAL_GROUP);

  return (
    <>
    <div ref={fly.rowRef} {...fly.hover} className={block.rowClassName || undefined} style={block.style} onContextMenu={contextMenu(() => projectMenu(group, root, true, null, t))}>
      <button
        onClick={() => fly.setPinned(!fly.pinned)}
        onKeyDown={fly.onKeyDown}
        title={[remark && t("remark.withText", { text: remark }), root, hint].filter(Boolean).join("\n")}
        aria-expanded={fly.open}
        aria-haspopup="dialog"
        data-highlight={fly.open || layout.hasSelected ? "" : undefined}
        className={`group/fold flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left ${fly.open || layout.hasSelected ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
      >
        {/* The icon stands where the chevron was (chevron while pointing at it), as in an expanded header. */}
        <ProjectIcon source={group.kind === "project" ? { color: group.color, badge: group.badge || title.slice(0, 1), icon: groupIcon(prefs.projectIcons, group, hosts?.focus ?? "local") } : { glyph: User }} toggle={fly.open ? "open" : "closed"} />
        <span className="min-w-0 truncate text-xs font-semibold text-muted"><ScriptText text={title} /></span>
        {look && <HostMark host={look} className="shrink-0" />}
        {muted && <BellOff size={10} className="shrink-0 text-subtle" />}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px]">
          {layout.needsYouCount > 0 && <span className="font-semibold text-warn">{t("sidebar.needsYouCount", { count: layout.needsYouCount })}</span>}
          {layout.runningCount > 0 && <span className="text-accent">{t("sidebar.runningCount", { count: layout.runningCount })}</span>}
          <span className="text-subtle">{relativeTime(layout.lastActivity)}</span>
        </span>
      </button>
      <ProjectFlyoutPanel layout={layout} fly={fly} />
    </div>
    {/* Pins stay listed under the one row (never folded away; outside the hover area). */}
    <PinnedRows rows={layout.full} className="pl-1" />
    </>
  );
}

/**
 * The flyout itself (portal beside the sidebar, aligned with the row): header (badge, name, host
 * mark, star, online count), 本机备注 (the directory is a tooltip on the name), then the agents as the expanded group lists them
 * (Director / needs-you first, running, online idle, then 离线 N). Opening an agent closes it.
 */
export function ProjectFlyoutPanel({ layout, fly }: { layout: GroupLayout; fly: ProjectFlyoutState }) {
  const { t } = useI18n();
  const { group } = layout;
  const title = group.kind === "project" ? group.name : t("sidebar.independent");
  const sidebar = useApp((s) => sidebarOf(s, group.hostId));
  const hosts = useSidebarHosts();
  const look = sidebarMark(hosts, group.hostId);
  const root = group.kind === "project" ? rootFor(sidebar, { kind: "project", id: group.id }) : null;
  const remark = groupRemark(useUiPrefs().projectRemarks, group, hosts?.focus ?? "local");
  const icon = groupIcon(useUiPrefs().projectIcons, group, hosts?.focus ?? "local");
  const { rect } = fly;
  if (!fly.open || !rect) return null;
  // The sidebar's right edge (the flyout sits beside it, aligned with the row; kept inside the window).
  const aside = fly.rowRef.current?.closest("aside")?.getBoundingClientRect();
  const left = Math.max(4, Math.min((aside?.right ?? rect.right) + 4, window.innerWidth - FLYOUT_WIDTH - 8));
  // Rows in the lower part of the window open the flyout upwards (bottom-aligned with the row).
  const place = rect.top > window.innerHeight * 0.55 ? { bottom: Math.max(8, window.innerHeight - rect.bottom - 6) } : { top: Math.max(8, rect.top - 6) };
  const all = [...layout.full, ...layout.running, ...layout.idle];

  return createPortal(
    <div
      ref={fly.flyRef}
      {...fly.flyHover}
      role="dialog"
      aria-label={title}
      data-project-flyout=""
      // Opening an agent from the list is the end of the preview.
      onClick={(e) => (e.target as HTMLElement).closest(FLYOUT_AGENT)?.parentElement?.hasAttribute("data-flyout-list") && fly.close()}
      style={{ left, width: FLYOUT_WIDTH, ...place }}
      className="fixed z-40 flex max-h-[min(70vh,520px)] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        {group.kind === "project" && <ProjectBadge icon={icon} badge={group.badge || title.slice(0, 1)} color={group.color} />}
        {/* The directory is only a tooltip here (no path line in the sidebar or its flyout). */}
        <span className="min-w-0 truncate text-[13px] font-semibold" title={root ?? undefined}><ScriptText text={title} /></span>
        {look && <HostMark host={look} className="shrink-0" />}
        {layout.starred && <Star size={10} className="shrink-0 fill-warn text-warn" aria-label={t("sidebar.starred")} />}
        <span className="ml-auto shrink-0 text-[10px] text-subtle">{onlineCount(group) > 0 ? t("sidebar.online", { count: onlineCount(group) }) : t("sidebar.noAgentsOnline")}</span>
      </div>
      {remark && (
        <div className="truncate px-2.5 pt-1 text-[11px] text-subtle" data-project-remark="" title={`${remark}\n${t("remark.tooltip")}`}>
          <ScriptText text={remark} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1" data-flyout-list="">
        {all.map((row) => (
          <AgentRowButton key={rowKey(row)} row={row} />
        ))}
        {layout.offline.length > 0 && (
          <div className="flex items-center gap-2 px-1.5 pt-1 pb-0.5 text-[10.5px] text-subtle">
            <span className="shrink-0">{t("sidebar.offlineCount", { count: layout.offline.length })}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        {layout.offline.map((row) => (
          <OfflineRow key={rowKey(row)} row={row} />
        ))}
      </div>
    </div>,
    document.body,
  );
}
