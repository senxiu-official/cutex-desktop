import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { BellOff, Check, ChevronRight, CircleCheck, MessageSquare, Settings2, Star, TriangleAlert, User } from "lucide-react";
import { useI18n } from "../i18n";
import { groupKey, moveProject, orderGroups, rowKey, type AgentRow, type SidebarGroup } from "../lib/sidebar";
import { hostListKeys, setHostListKeys, toggleIdleOpen, toggleOfflineOpen, toggleProjectFolded, updateSections, useUiPrefs, type RunningAgents as RunningAgentsMode } from "../lib/prefs";
import { groupRemark, searchGroups } from "../lib/projectRemarks";
import { groupIcon } from "../lib/projectIcons";
import { assignSection, memberKey, sectionOf, setSectionCollapsed, splitBySection, summarizeSection, visibleInSection, type SidebarSection } from "../lib/sidebarSections";
import { sectionMenu } from "../lib/sectionMenus";
import { hostKey } from "../lib/hostKeys";
import { SidebarHostsContext, useScopedAttention, useScopedSidebar, useSidebarHosts, type HostSidebarState, type SidebarHosts } from "../lib/scopedSidebarView";
import { sidebarMark, type HostLook } from "../lib/hostScope";
import { setHostConnected } from "../lib/useHostScope";
import { api } from "../bridge";
import { HostMark } from "./HostMark";
import { lastSeen, offlineSlice } from "../lib/offlineAgents";
import { openAgentList } from "../lib/agentListDialog";
import { sidebarOf, useApp } from "../store";
import { contextMenu } from "../lib/contextMenu";
import { noteCustomizeOpener } from "../lib/customize";
import { customizeSidebarItem } from "../lib/customizeMenu";
import { agentMenu } from "../lib/menus";
import { projectMenu } from "../lib/projectMenus";
import { rootFor } from "../lib/workspace";
import { AttentionContext } from "../lib/attentionView";
import { foldLabel, layoutSidebar, nextIdleFold, type GroupLayout, type LayoutContext } from "../lib/sidebarLayout";
import { computeFresh, markAgentOpened, publishFresh, useFreshAgents } from "../lib/freshAgents";
import { NEUTRAL_GROUP, projectBlockLook } from "../lib/projectSeparation";
import { useProjectMuted } from "../lib/notificationLevelsStore";
import { services } from "../modules/app";
import { ItemBoundary } from "../modules/Outlet";
import { isExternalModuleId } from "../modules/external";
import { ExternalBadge } from "../modules/ExternalBadge";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, NavArea, NavItem } from "../modules/slots";
import { StatusAvatar } from "./AgentStatus";
import { ProjectIcon } from "./ProjectIcon";
import { RestoreBanner } from "./RestoreBanner";
import { AgentRowButton, OfflineRow, PinnedRows } from "./AgentRows";
import { CollapsedProject, ProjectFlyoutPanel } from "./ProjectFlyout";
import { FlyoutGateContext, hoverOpensFlyout, isCollapsedRow, useFlyoutGate, useProjectFlyout } from "../lib/projectFlyout";
import { UpdateButton } from "./UpdateButton";
import { IdentityButton } from "./IdentityMenu";
import { TopNav } from "./SidebarNav";
import { runNav, useNavActive } from "../lib/navEntries";
import { PaneResizer } from "./PaneResizer";
import { ScriptText } from "./ScriptText";
import { useHostAccess } from "../lib/hostAccess";
import { realAgentName } from "../lib/agentAlias";
import { dataFlags, useSizeFlags, widthBelow } from "../lib/sizeFlags";

/** Footer narrower than 12rem (content box): the identity button shows only its avatar. */
const FOOTER_SIZES = { tight: widthBelow(12) } as const;

/**
 * Identity (its menu) on the left; the update button and the footer entries (⚙ 设置: one click, also
 * Ctrl+,) as icons. `data-tight` (lib/sizeFlags, `group-data-[tight]/footer:`) instead of a CSS size
 * container: the footer re-renders together with the rest of the sidebar.
 */
function SidebarFooter() {
  const [ref, flags] = useSizeFlags(FOOTER_SIZES);
  return (
    <footer ref={ref} {...dataFlags(flags)} className="group/footer flex items-center gap-1 border-t border-border px-2 py-1.5 text-xs text-muted">
      <IdentityButton />
      <UpdateButton />
      <PrimaryNav area="footer" />
    </footer>
  );
}

/**
 * Offline agents under a group: a divider (离线 N ── 全部 ›), the newest K as compact rows
 * (Settings → 外观), then 还有 N 个 ›. `onAll` opens the full list (dialog / project tab).
 * With `foldId` the 离线 N header folds the list (collapsed by default, remembered per group in
 * `offlineOpen`); collapsed, only the open agent stays listed. Searching lists every match.
 */
export function OfflineSection({ rows, searching, onAll, foldId, hostId }: { rows: AgentRow[]; searching: boolean; onAll?: () => void; foldId?: string; hostId?: string }) {
  const { t } = useI18n();
  const prefs = useUiPrefs();
  const { offlineAgents: limit } = prefs;
  const activity = useApp((s) => s.activity);
  const selectedId = useApp((s) => (s.view.kind === "conversation" ? s.selectedId : null));
  // A group of another host (multi-host sidebar) keeps its fold under that host's key.
  const expanded = foldId === undefined || (hostId ? hostListKeys("offlineOpen", [hostId]).includes(hostKey(hostId, foldId)) : prefs.offlineOpen.includes(foldId));
  const { shown, hidden } = useMemo(() => {
    if (!expanded && !searching) return { shown: rows.filter((r) => r.id === selectedId), hidden: 0 };
    return offlineSlice(rows, limit, (r) => lastSeen(r, activity[r.id]?.at), { searching, keep: (r) => limit !== 0 && (r.pinned || r.id === selectedId) });
  }, [rows, limit, activity, searching, selectedId, expanded]);
  if (rows.length === 0) return null;
  const count = t("sidebar.offlineCount", { count: rows.length });
  return (
    <div className="mt-0.5">
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-0.5 text-[10.5px] text-subtle">
        {foldId === undefined ? (
          <span className="shrink-0">{count}</span>
        ) : (
          <button
            onClick={() => toggleOfflineOpen(foldId, hostId)}
            aria-expanded={expanded || searching}
            className="-ml-0.5 flex shrink-0 items-center gap-0.5 rounded pr-0.5 hover:text-foreground"
          >
            <ChevronRight size={11} className={`transition-transform ${expanded || searching ? "rotate-90" : ""}`} />
            {count}
          </button>
        )}
        <span className="h-px min-w-2 flex-1 bg-border" />
        {onAll && (
          <button onClick={onAll} className="shrink-0 rounded px-0.5 hover:text-foreground">
            {t("sidebar.allAgents")} ›
          </button>
        )}
      </div>
      {shown.map((row) => (
        <OfflineRow key={rowKey(row)} row={row} />
      ))}
      {hidden > 0 && (
        <button onClick={onAll ?? (() => foldId !== undefined && toggleOfflineOpen(foldId, hostId))} className="flex w-full items-center rounded-md py-0.5 pr-1.5 pl-9 text-left text-[11px] text-subtle hover:bg-surface-2/60 hover:text-foreground">
          {t("sidebar.moreOffline", { count: hidden })} ›
        </button>
      )}
    </div>
  );
}

/**
 * Running agents that need nothing (Settings → 外观 → 运行中智能体): compact rows (★) or the older
 * 运行中 + avatars row (ring; hover = name, click = open). 「完整显示」 lists them as full rows
 * (lib/sidebarLayout), so they never reach here.
 */
function RunningAgents({ rows, mode }: { rows: AgentRow[]; mode: RunningAgentsMode }) {
  const { t } = useI18n();
  const select = useApp((s) => s.select);
  const selectedId = useApp((s) => s.selectedId);
  const hosts = useSidebarHosts();
  if (rows.length === 0) return null;
  if (mode !== "avatars") return <>{rows.map((row) => <AgentRowButton key={rowKey(row)} row={row} compact />)}</>;
  return (
    <div className="flex items-center gap-2 px-1.5 py-1">
      <span className="shrink-0 text-[11px] text-subtle">{t("sidebar.runningRow")}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2 py-0.5">
        {rows.map((row) => (
          <button
            key={rowKey(row)}
            title={row.name}
            aria-label={row.name}
            disabled={hosts?.stateOf(row.hostId) === "offline"}
            onClick={() => void select(row.id, row.hostId)}
            onContextMenu={contextMenu(() => agentMenu(row.session, t, row.hostId))}
            // The open agent stays here (opening never moves a row): ringed.
            className={`rounded-full ${row.id === selectedId ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""}`}
            aria-current={row.id === selectedId ? "true" : undefined}
          >
            <StatusAvatar name={row.name} initial={row.initial} color={row.color} avatar={row.session.avatar} seed={row.session.cutexSessionId} size={20} signal="running" />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 「› N 个空闲」: folded online idle agents (expanded per group in `idleOpen`). Collapsed, the header
 * shows their overlapping avatars; expanded, only the chevron and count, with the agents below as
 * compact rows. The open agent stays in the fold (lib/sidebarLayout `idleSelected`): collapsed, the
 * header is highlighted with its avatar first (ringed) and its name; expanded, its own row shows as
 * selected. Agents with a finished turn not seen yet stay in it too (`done`): a ✓ on their avatar
 * (shown before the others) and 「· N 完成」 on the header (lib/sidebarLayout `foldLabel`).
 */
function IdleFold({ groupId, hostId, rows, selected, done }: { groupId: string; hostId?: string; rows: AgentRow[]; selected: string | null; done: readonly string[] }) {
  const { t } = useI18n();
  const prefs = useUiPrefs();
  const open = hostId ? hostListKeys("idleOpen", [hostId]).includes(hostKey(hostId, groupId)) : prefs.idleOpen.includes(groupId);
  if (rows.length === 0) return null;
  const current = selected === null ? null : (rows.find((r) => rowKey(r) === selected) ?? null);
  const marked = !open && current !== null;
  const isDone = (r: AgentRow) => done.includes(rowKey(r));
  const rest = rows.filter((r) => r !== current);
  const avatars = [...(current ? [current] : []), ...rest.filter(isDone), ...rest.filter((r) => !isDone(r))];
  const label = foldLabel(rows.length, done.length);
  return (
    <div>
      <button
        onClick={() => toggleIdleOpen(groupId, hostId)}
        aria-expanded={open}
        title={marked ? t("sidebar.idleHasOpen", { name: current.name }) : undefined}
        data-row-selectable=""
        data-row-selected={marked ? "" : undefined}
        className={`flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-[3px] text-left text-[11.5px] ${marked ? "bg-background text-foreground shadow-[var(--card-shadow)]" : "text-subtle hover:bg-surface-2/60 hover:text-foreground"}`}
      >
        <ChevronRight size={11} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {!open && (
          <span data-idle-stack="" className="flex shrink-0 -space-x-1.5">
            {avatars.slice(0, 4).map((r) => (
              <span key={rowKey(r)} data-idle-open={marked && r === current ? "" : undefined} className={`relative flex rounded-full ${marked && r === current ? "z-10 ring-[1.5px] ring-accent ring-offset-1 ring-offset-background" : isDone(r) ? "z-[5]" : ""}`}>
                <StatusAvatar name={r.name} initial={r.initial} color={r.color} avatar={r.session.avatar} seed={r.session.cutexSessionId} size={14} signal="idle" />
                {isDone(r) && (
                  <span data-idle-done="" className="absolute -right-1 -bottom-1 flex size-[9px] items-center justify-center rounded-full bg-accent text-background ring-1 ring-background" aria-label={t("agentStatus.done")}>
                    <Check size={7} strokeWidth={4} />
                  </span>
                )}
              </span>
            ))}
          </span>
        )}
        <span className={`${open ? "" : "ml-1 "}shrink-0`}>
          {label.idle > 0 && t("sidebar.idleCount", { count: label.idle })}
          {label.idle > 0 && label.done > 0 && " · "}
          {label.done > 0 && t("sidebar.idleDoneCount", { count: label.done })}
        </span>
        {marked && (
          <span className="min-w-0 truncate">
            · <ScriptText text={current.name} />
          </span>
        )}
      </button>
      {open && rows.map((row) => <AgentRowButton key={rowKey(row)} row={row} compact />)}
    </div>
  );
}

interface DropTarget {
  id: string;
  after: boolean;
}

/**
 * Project drag-to-reorder, stable for the sidebar's life. dragover fires continuously, so the
 * drop target lives outside React state: only the headers whose drop line changes re-render,
 * not the whole sidebar with every agent row.
 */
interface ProjectDrag {
  start(key: string): void;
  over(key: string, after: boolean): void;
  drop(): void;
  end(): void;
  subscribe(listener: () => void): () => void;
  target(): DropTarget | null;
}

const ProjectDragContext = createContext<ProjectDrag | null>(null);

function createDropStore() {
  let target: DropTarget | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => target,
    set(next: DropTarget | null) {
      if (next === target || (next && target && next.id === target.id && next.after === target.after)) return;
      target = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const noSubscribe = () => () => {};

/** Drop indicator on a project header: line above / below, or none. */
function useDropAt(drag: ProjectDrag | null, key: string | null): "before" | "after" | null {
  return useSyncExternalStore(drag?.subscribe ?? noSubscribe, () => {
    const t = drag?.target();
    return t && key && t.id === key ? (t.after ? "after" : "before") : null;
  });
}

/** A group's drag key: projects only, and not while a search filters the list (the order would be partial). */
function dragKeyOf(g: SidebarGroup, searching: boolean): string | null {
  return g.kind === "project" && !searching ? groupKey(g) : null;
}

/**
 * A sidebar group folded by its header (`foldedProjects`, remembered so it stays folded when the
 * sidebar remounts, e.g. back from 设置); `hostId` undefined = the focus host.
 */
function useGroupOpen(groupId: string, hostId?: string): [boolean, () => void] {
  const prefs = useUiPrefs();
  const folded = hostId ? hostListKeys("foldedProjects", [hostId]).includes(hostKey(hostId, groupId)) : prefs.foldedProjects.includes(groupId);
  return [!folded, () => toggleProjectFolded(groupId, hostId)];
}

/** `dragKey`: null = not draggable; `dragging`: this group is the one being dragged. */
const Group = memo(function Group({ layout, dragKey, dragging: dragged, searching }: { layout: GroupLayout; dragKey: string | null; dragging: boolean; searching: boolean }) {
  const { t } = useI18n();
  const { group } = layout;
  const hosts = useSidebarHosts();
  const own = !group.hostId || group.hostId === hosts?.focus;
  const [open, toggleOpen] = useGroupOpen(group.id, own ? undefined : group.hostId);
  const title = group.kind === "project" ? group.name : t("sidebar.independent");
  const sidebar = useApp((s) => sidebarOf(s, group.hostId));
  // Project mutes are the focus host's notification levels (other hosts: not shown yet).
  const muted = useProjectMuted(group.id) && own;
  const root = group.kind === "project" ? rootFor(sidebar, { kind: "project", id: group.id }) : null;
  const look = sidebarMark(hosts, group.hostId);
  const state = hosts?.stateOf(group.hostId) ?? "live";
  const prefs = useUiPrefs();
  const remark = groupRemark(prefs.projectRemarks, group, hosts?.focus ?? "local");
  // Folded by the user: hovering the header previews its agents, like an auto-collapsed row (lib/projectFlyout).
  const { dragging } = useFlyoutGate();
  const drag = useContext(ProjectDragContext);
  const dropLine = useDropAt(drag, dragKey);
  const dropAt = dragKey && !dragged ? dropLine : null;
  const block = projectBlockLook(prefs.projectSeparation, group.kind === "project" ? group.color : NEUTRAL_GROUP);
  const fly = useProjectFlyout({ available: !open && !dragging, hoverEnabled: hoverOpensFlyout({ collapsed: isCollapsedRow(layout, !open), hoverPreview: prefs.projectHoverPreview, dragging }), delay: prefs.projectHoverDelay });
  return (
    <section className={`relative ${open ? block.gapClassName : block.foldedGapClassName} ${block.className} ${dragged ? "opacity-40" : ""}`} style={block.style} data-project-block={block.style ? prefs.projectSeparation : undefined} data-folded={open ? undefined : ""}>
      {dropAt && <div className={`pointer-events-none absolute right-1 left-1 h-0.5 rounded bg-accent ${dropAt === "before" ? "-top-1" : "-bottom-1"}`} />}
      <div
        ref={fly.rowRef}
        {...fly.hover}
        // Folded with the open agent inside (or previewing): highlighted like a collapsed row.
        className={`group/header flex items-center rounded-md ${fly.open || (!open && layout.hasSelected) ? "bg-surface-2" : ""} ${block.headerClassName}`}
        data-highlight={fly.open || (!open && layout.hasSelected) ? "" : undefined}
        draggable={!!dragKey}
        onDragStart={(e) => {
          if (!drag || !dragKey) return;
          e.dataTransfer.effectAllowed = "move";
          drag.start(dragKey);
        }}
        onDragOver={(e) => {
          if (!drag || !dragKey) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          drag.over(dragKey, e.clientY > box.top + box.height / 2);
        }}
        onDrop={(e) => {
          e.preventDefault();
          drag?.drop();
        }}
        onDragEnd={() => drag?.end()}
        onContextMenu={contextMenu(() => projectMenu(group, root, !open, toggleOpen, t))}
      >
        <button
          onClick={toggleOpen}
          onKeyDown={fly.onKeyDown}
          aria-expanded={open}
          title={[t(open ? "fold.collapse" : "fold.unfold"), root].filter(Boolean).join("\n")}
          className="group/fold flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left"
        >
          {/* The group icon is its fold toggle (chevron on hover / focus). */}
          <ProjectIcon source={group.kind === "project" ? { color: group.color, badge: group.badge || title.slice(0, 1), icon: groupIcon(prefs.projectIcons, group, hosts?.focus ?? "local") } : { glyph: User }} toggle={open ? "open" : "closed"} />
          <span className="truncate text-xs font-semibold text-muted"><ScriptText text={title} /></span>
          {look && <HostMark host={look} className="shrink-0" />}
          {layout.starred && <Star size={10} className="shrink-0 fill-warn text-warn" aria-label={t("sidebar.starred")} />}
          {muted && <BellOff size={10} className="shrink-0 text-subtle" />}
          {state === "live" ? (
            // Metadata on demand (quiet pass): the counts show on hover / keyboard focus, and while the open agent is in this group.
            // Hidden they take no width (display none, not opacity), so a narrow sidebar does not truncate the name for them.
            <span className={`ml-auto shrink-0 text-[10px] text-subtle ${layout.hasSelected ? "" : "hidden group-hover/header:inline group-focus-within/header:inline"}`} data-group-counts="">
              {layout.runningCount > 0 && <span>{t("sidebar.runningShort", { count: layout.runningCount })} · </span>}
              {t("sidebar.online", { count: group.online.length })}
            </span>
          ) : (
            <span className="ml-auto" />
          )}
        </button>
        {state !== "live" && look && <HostStatusAction look={look} state={state} />}
        {group.kind === "project" && (
          <button onClick={() => services.ui.openPage("projects.page", { project: group.id, tab: "settings", ...(own ? {} : { host: group.hostId! }) })} title={t("nav.projectSettings")} className="mr-1 hidden rounded p-0.5 text-subtle group-hover/header:block hover:bg-surface-2 hover:text-foreground">
            <Settings2 size={13} />
          </button>
        )}
      </div>
      {!open && <ProjectFlyoutPanel layout={layout} fly={fly} />}
      {/* Folded by its header: pins stay listed (never folded away). */}
      {!open && <PinnedRows rows={layout.full} className={block.bodyClassName} />}
      {open && remark && (
        // 本机备注 under the header. The project directory is never a sidebar line (owner 2026-10-14: it
        // only shifted the list when a project got selected): it stays in the header / remark tooltips
        // and on the project page.
        <div className={`truncate pr-1.5 pb-0.5 pl-6 text-[11px] text-subtle ${block.metaClassName}`} data-project-remark="" title={[remark, t("remark.tooltip"), root].filter(Boolean).join("\n")}>
          <ScriptText text={remark} />
        </div>
      )}
      {open && (
        <div className={block.bodyClassName}>
          {layout.full.map((row) => (
            <AgentRowButton key={rowKey(row)} row={row} />
          ))}
          <RunningAgents rows={layout.running} mode={prefs.runningAgents} />
          <IdleFold groupId={group.id} hostId={own ? undefined : group.hostId} rows={layout.idle} selected={layout.idleSelected} done={layout.idleDone} />
          {/* While searching, every offline match is listed. The full list dialog opens on the group's host. */}
          <OfflineSection rows={layout.offline} searching={searching} onAll={() => openAgentList(group.id, "offline", own ? undefined : group.hostId)} foldId={group.id} hostId={own ? undefined : group.hostId} />
        </div>
      )}
    </section>
  );
});

/** 星标展开: every unstarred project one row under 其他项目 (running / needs-you totals on the header). */
function OtherProjects({ layouts }: { layouts: GroupLayout[] }) {
  const { t } = useI18n();
  const [open, toggleOpen] = useGroupOpen("__other__");
  if (layouts.length === 0) return null;
  const running = layouts.reduce((n, l) => n + l.runningCount, 0);
  const needs = layouts.reduce((n, l) => n + l.needsYouCount, 0);
  return (
    <section className="mb-1.5">
      <button onClick={toggleOpen} className="flex w-full min-w-0 items-center gap-1.5 px-1.5 py-1 text-left">
        <span className="inline-block w-2.5 text-[10px] text-subtle">{open ? "▾" : "▸"}</span>
        <span className="truncate text-xs font-semibold text-muted">{t("sidebar.otherProjects")}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px]">
          {needs > 0 && <span className="font-semibold text-warn">{t("sidebar.needsYouCount", { count: needs })}</span>}
          {running > 0 && <span className="text-accent">{t("sidebar.runningCount", { count: running })}</span>}
          <span className="text-subtle">{layouts.length}</span>
        </span>
      </button>
      {open && (
        <div className="pl-1" style={{ "--band-extra": "4px" } as CSSProperties}>
          {layouts.map((l) => (
            <CollapsedProject key={groupKey(l.group)} layout={l} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One project of a laid-out list: its one-row form or the full group. */
const LaidOutProject = memo(function LaidOutProject({ layout, dragKey, dragging, searching }: { layout: GroupLayout; dragKey: string | null; dragging: boolean; searching: boolean }) {
  return layout.mode === "collapsed" ? <CollapsedProject layout={layout} /> : <Group layout={layout} dragKey={dragKey} dragging={dragging} searching={searching} />;
});

interface SectionDrop {
  /** A project is being dragged (the header takes drops). */
  active: boolean;
  over: boolean;
  onDragOver(): void;
  onDragLeave(): void;
  onDrop(): void;
}

/**
 * A sidebar project section (lib/sidebarSections): a divider-like header (fold chevron, name,
 * project count; folded: needs-you / new results / running totals) over its projects. Searching
 * lists every match regardless of the fold.
 */
function ProjectSection({ section, layouts, visible, searching, dragged, drop }: { section: SidebarSection; layouts: GroupLayout[]; visible: readonly string[]; searching: boolean; dragged: string | null; drop: SectionDrop }) {
  const { t } = useI18n();
  const { sectionCollapsedShows } = useUiPrefs();
  const folded = section.collapsed && !searching;
  const sum = summarizeSection(layouts);
  const shown = visibleInSection(layouts, section.collapsed, searching, sectionCollapsedShows);
  const updates = sum.attention - sum.needsYou;
  return (
    <section className="mt-1 mb-1.5" data-sidebar-section={section.id}>
      <div
        className={`flex items-center rounded-md ${drop.over ? "bg-accent/10 ring-1 ring-accent/50" : ""}`}
        onContextMenu={contextMenu(() => sectionMenu(section, visible, t))}
        onDragOver={(e) => {
          if (!drop.active) return;
          e.preventDefault();
          drop.onDragOver();
        }}
        onDragLeave={() => drop.onDragLeave()}
        onDrop={(e) => {
          e.preventDefault();
          drop.onDrop();
        }}
      >
        <button
          onClick={() => updateSections((list) => setSectionCollapsed(list, section.id, !section.collapsed))}
          aria-expanded={!folded}
          title={t("section.projectsHint", { count: sum.projects })}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-1.5 py-1 text-left text-[10.5px] whitespace-nowrap text-subtle hover:text-foreground"
        >
          <ChevronRight size={11} className={`shrink-0 transition-transform ${folded ? "" : "rotate-90"}`} />
          <span className={`min-w-[2.5em] truncate font-semibold tracking-wide ${folded && sum.hasSelected ? "text-foreground" : ""}`}>
            <ScriptText text={section.name} />
          </span>
          <span className="shrink-0 tabular-nums opacity-70">{sum.projects}</span>
          <span className="h-px min-w-1 flex-1 bg-border" />
          {/* Folded: compact totals (icon + number, the words in the tooltip) so the name keeps its room. */}
          {folded && sum.needsYou > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 font-semibold text-warn" title={t("sidebar.needsYouCount", { count: sum.needsYou })}>
              <TriangleAlert size={10} />
              {sum.needsYou}
            </span>
          )}
          {folded && updates > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-muted" title={`${t("section.updatesCount", { count: updates })} · ${t("section.updatesHint")}`}>
              <CircleCheck size={10} />
              {updates}
            </span>
          )}
          {folded && sum.running > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-accent" title={t("sidebar.runningCount", { count: sum.running })}>
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {sum.running}
            </span>
          )}
        </button>
      </div>
      {shown.length > 0 && (
        <div className={folded ? "" : "mt-0.5"}>
          {shown.map((l) => (
            <LaidOutProject key={groupKey(l.group)} layout={l} dragKey={folded ? null : dragKeyOf(l.group, searching)} dragging={dragged === groupKey(l.group)} searching={searching} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Quick chats (human-create-session): one flat, foldable list, newest first. */
function ChatsGroup({ rows }: { rows: AgentRow[] }) {
  const { t } = useI18n();
  const [open, toggleOpen] = useGroupOpen("__chats__");
  const prefs = useUiPrefs();
  // A section header like 独立智能体: the project header treatment in the neutral colour.
  const block = projectBlockLook(prefs.projectSeparation, NEUTRAL_GROUP);
  return (
    <section className={`relative ${open ? block.gapClassName : block.foldedGapClassName} ${block.className}`} style={block.style} data-project-block={block.style ? prefs.projectSeparation : undefined} data-folded={open ? undefined : ""}>
      <div className={`flex items-center rounded-md ${block.headerClassName}`}>
        <button
          onClick={toggleOpen}
          aria-expanded={open}
          title={t(open ? "fold.collapse" : "fold.unfold")}
          className="group/fold flex h-7 w-full min-w-0 items-center gap-1.5 px-1.5 text-left"
        >
          <ProjectIcon source={{ glyph: MessageSquare }} toggle={open ? "open" : "closed"} />
          <span className="truncate text-xs font-semibold text-muted">{t("sidebar.chats")}</span>
          <span className="ml-auto text-[10px] text-subtle">{rows.length}</span>
        </button>
      </div>
      {open ? (
        <div className={block.bodyClassName}>
          {rows.map((row) => (
            <AgentRowButton key={rowKey(row)} row={row} />
          ))}
        </div>
      ) : (
        <PinnedRows rows={rows} className={block.bodyClassName} />
      )}
    </section>
  );
}

/** 「离线 · 重连」 / 「未连接 · 连接」 on a header of a host that is not live (RFC §8.5): click = (re)connect that host. */
function HostStatusAction({ look, state }: { look: HostLook; state: HostSidebarState }) {
  const { t } = useI18n();
  const disconnected = !look.connected;
  if (state === "loading") return <span className="mr-1 shrink-0 text-[10px] text-subtle">{t("sidebar.hostLoading")}</span>;
  return (
    <span className="mr-1 flex shrink-0 items-center gap-1 text-[10px] text-subtle">
      {t(disconnected ? "sidebar.hostDisconnected" : "sidebar.hostOffline")} ·
      <button
        onClick={() => void (disconnected ? setHostConnected(look.id, true) : api.reconnectHost(look.id).catch(() => {}))}
        className="rounded px-0.5 text-accent hover:underline"
      >
        {t(disconnected ? "sidebar.hostConnect" : "sidebar.hostReconnect")}
      </button>
    </span>
  );
}

/** A host of the scope without rows (never reached this run): its mark, status and 连接 / 重连 (RFC §8.5). */
function HostOnlyHeader({ look, state }: { look: HostLook; state: HostSidebarState }) {
  const { t } = useI18n();
  return (
    <section className="mb-1.5 opacity-70">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <span className="inline-block w-2.5" />
        <HostMark host={look} className="shrink-0" />
        <span className="ml-auto" />
        <HostStatusAction look={look} state={state} />
      </div>
      {state === "live" && <p className="pl-6 text-[10.5px] text-subtle">{t("sidebar.hostNoRows")}</p>}
    </section>
  );
}

/** A footer entry (⚙ 设置): compact, red-dot badge. */
function FooterEntry({ entry }: { entry: AppSlotEntry<"nav.primary"> }) {
  const { t } = useI18n();
  const { item } = entry;
  const active = useNavActive(item);
  const badge = item.useBadge?.() ?? null;
  const disabled = entry.mode !== "show";
  const Icon = item.icon;
  // An icon next to the identity button; the name is the tooltip.
  const label = item.title ?? t(item.useTitleKey?.() ?? item.titleKey);
  return (
    <button
      disabled={disabled}
      onClick={() => runNav(item)}
      title={badge?.title ? `${label}\n${badge.title}` : label}
      aria-label={label}
      className={`relative flex shrink-0 items-center rounded p-1.5 hover:bg-surface-2 hover:text-foreground disabled:opacity-50 ${active ? "bg-surface-2 text-foreground" : ""}`}
    >
      <Icon size={14} />
      {isExternalModuleId(entry.moduleId) && <ExternalBadge />}
      {badge?.dot && <span className="absolute top-1 right-0.5 h-1.5 w-1.5 rounded-full bg-danger" />}
    </button>
  );
}

/** The `nav.primary` entries of one area, each in its own error boundary. */
function PrimaryNav({ area }: { area: NavArea }) {
  const entries = useSlot("nav.primary").filter((e) => (e.item.area ?? "top") === area);
  return (
    <>
      {entries.map((e) => (
        <ItemBoundary key={e.item.id} moduleId={e.moduleId}>
          <FooterEntry entry={e} />
        </ItemBoundary>
      ))}
    </>
  );
}

/** What a right-click / press in the sidebar can return the focus to (lib/customize opener). */
const FOCUSABLE = "button, a[href], input, [tabindex]:not([tabindex='-1'])";

export function Sidebar() {
  const { t } = useI18n();
  // Every host of the view scope, merged (multi-host RFC §8; one host = today's sidebar). Rows and
  // groups carry their host and are matched by host keys (prefs, selection, attention).
  const scoped = useScopedSidebar();
  const { model, scope } = scoped;
  const attention = useScopedAttention(model, scope);
  const activity = useApp((s) => s.activity);
  const selectedKey = useApp((s) => (s.view.kind === "conversation" && s.selectedId ? hostKey(s.selectedHost ?? s.hosts?.active ?? "local", s.selectedId) : null));
  const [query, setQuery] = useState("");
  const prefs = useUiPrefs();
  const hostIds = scope.ids;
  // Re-read on every prefs change (useUiPrefs re-renders): host-keyed lists over the scope's hosts.
  const projectOrder = useMemo(() => hostListKeys("projectOrder", hostIds), [prefs, hostIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const starredKeys = useMemo(() => new Set(hostListKeys("starredProjects", hostIds)), [prefs, hostIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const idleUnfolded = useMemo(() => new Set(hostListKeys("idleUnfolded", hostIds)), [prefs, hostIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dragged, setDragged] = useState<string | null>(null);
  const dropStore = useMemo(createDropStore, []);
  const searching = query.trim() !== "";
  const hostsCtx = useMemo<SidebarHosts>(() => ({ marks: scope.showHostMarks, localMarks: prefs.hostMarkLocal, focus: scope.focus, look: (id) => scope.host(id ?? scope.focus), stateOf: scoped.stateOf }), [scope, scoped.stateOf, prefs.hostMarkLocal]);
  // Hosts of the scope with nothing to list (not reached yet this run): a header with their status.
  const hostOnly = scoped.hosts.filter((h) => !h.hasRows && (scope.multi || h.state !== "live"));
  // Activity previews are the focus host's (other hosts' rows search by name).
  const previewOf = (r: AgentRow) => (!r.hostId || r.hostId === scope.focus ? activity[r.id] : undefined);

  const groups = useMemo(() => {
    const ordered = orderGroups(model.groups, projectOrder);
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    const match = (r: AgentRow) =>
      r.name.toLowerCase().includes(q) || realAgentName(r.session).toLowerCase().includes(q) || (previewOf(r)?.text.toLowerCase().includes(q) ?? false);
    // A project whose 本机备注 matches is listed whole.
    return searchGroups(ordered, q, match, (g) => groupRemark(prefs.projectRemarks, g, scope.focus));
  }, [model.groups, projectOrder, query, activity, prefs.projectRemarks, scope.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Freshly created agents not opened yet (lib/freshAgents): full rows with a 「新」 marker.
  // Opening clears it (the marker goes), but the row keeps its place while it stays open: the list
  // does not reshuffle under the click; it folds once the owner moves on.
  const [openedFresh, setOpenedFresh] = useState<string | null>(null);
  useEffect(() => {
    setOpenedFresh(selectedKey && useFreshAgents.getState().keys.has(selectedKey) ? selectedKey : null);
    markAgentOpened(selectedKey);
  }, [selectedKey]);
  const openedVersion = useFreshAgents((s) => s.openedVersion);
  const [freshTick, setFreshTick] = useState(0);
  const fresh = useMemo(() => {
    const rows = model.groups.flatMap((g) => [...g.online, ...g.offline]).map((r) => ({ key: rowKey(r), hostId: r.hostId, createdAt: r.session.createdAt }));
    return computeFresh(rows);
  }, [model.groups, openedVersion, freshTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => publishFresh(fresh.keys), [fresh]);
  useEffect(() => {
    if (fresh.nextChange === null) return;
    const timer = setTimeout(() => setFreshTick((n) => n + 1), Math.max(0, fresh.nextChange - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [fresh]);
  // The idle fold's clock: advanced when an online agent's last activity turns IDLE_FOLD_AFTER_MS
  // old (lib/sidebarLayout nextIdleFold), so a row moves into 「N 个空闲」 by itself. A stale clock
  // (rows changed since) is caught up at once: their crossing is already past.
  const lastOfRow = (r: AgentRow) => lastSeen(r, previewOf(r)?.at);
  const [foldNow, setFoldNow] = useState(() => Date.now());
  const nextFold = useMemo(() => nextIdleFold(model.groups, foldNow, lastOfRow), [model.groups, activity, foldNow, scope.focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nextFold === null) return;
    const timer = setTimeout(() => setFoldNow(Date.now()), Math.max(0, nextFold - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [nextFold]);
  const layoutCtx = useMemo<LayoutContext>(
    () => ({
      signalOf: (key) => attention.signals.get(key),
      selectedId: selectedKey,
      starred: starredKeys,
      prefs: { grouping: prefs.projectGrouping, noOnline: prefs.noOnlineProjects, running: prefs.runningAgents, foldIdle: prefs.foldIdleAgents },
      searching,
      idleUnfolded,
      lastOf: lastOfRow,
      now: foldNow,
      isFresh: (key) => fresh.keys.has(key) || key === openedFresh,
    }),
    [fresh, openedFresh, attention.signals, selectedKey, starredKeys, idleUnfolded, prefs.projectGrouping, prefs.noOnlineProjects, prefs.runningAgents, prefs.foldIdleAgents, searching, activity, foldNow], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Sections (pure UI prefs, lib/sidebarSections): their projects leave the main list and render
  // under the section's header, laid out by the same rules.
  const sections = prefs.sidebarSections;
  const split = useMemo(() => splitBySection(groups, sections, scope.focus), [groups, sections, scope.focus]);
  const layout = useMemo(() => layoutSidebar(split.rest, layoutCtx), [split, layoutCtx]);
  // Only sections with a member in this scope (searching: with a match) show.
  const sectionLayouts = useMemo(
    () =>
      sections.flatMap((section) => {
        const own = split.bySection.get(section.id);
        if (!own?.length) return [];
        const l = layoutSidebar(own, layoutCtx);
        return [{ section, layouts: [...l.main, ...l.others] }];
      }),
    [sections, split, layoutCtx],
  );
  const visibleSections = useMemo(() => sectionLayouts.map((x) => x.section.id), [sectionLayouts]);
  const trailing = (l: GroupLayout) => l.group.kind === "independent" && !l.starred;
  const [sectionOver, setSectionOver] = useState<string | null>(null);
  /** A shown project's section member key, from its group key (drag state). */
  const memberOf = (key: string): string | null => {
    const g = groups.find((x) => groupKey(x) === key);
    return g && g.kind === "project" ? memberKey(g, scope.focus) : null;
  };

  // Drag order is kept by group key (lib/hostKeys), so projects of several hosts order together.
  const dropProject = () => {
    const target = dropStore.get();
    if (!dragged || !target) return;
    // Dropped beside a project: it joins that project's section (or the main list).
    const from = memberOf(dragged);
    const to = memberOf(target.id);
    if (from && to) {
      const section = sectionOf(sections, to)?.id ?? null;
      if ((sectionOf(sections, from)?.id ?? null) !== section) updateSections((list) => assignSection(list, from, section));
    }
    const shown = groups.filter((x) => x.kind === "project").map(groupKey);
    const next = moveProject(shown, dragged, target.id, target.after);
    // Keep projects that are hidden right now (no agents) where they were in the saved order.
    setHostListKeys("projectOrder", hostIds, [...next, ...projectOrder.filter((id) => !shown.includes(id))]);
  };
  const dropRef = useRef(dropProject);
  useEffect(() => {
    dropRef.current = dropProject;
  });
  const projectDrag = useMemo<ProjectDrag>(() => {
    const end = () => {
      setDragged(null);
      dropStore.set(null);
    };
    return {
      start: (key) => setDragged(key),
      over: (key, after) => dropStore.set({ id: key, after }),
      drop: () => {
        dropRef.current();
        end();
      },
      end,
      subscribe: dropStore.subscribe,
      target: dropStore.get,
    };
  }, [dropStore]);
  const chats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return model.chats;
    return model.chats.filter((r) => r.name.toLowerCase().includes(q) || realAgentName(r.session).toLowerCase().includes(q) || (previewOf(r)?.text.toLowerCase().includes(q) ?? false));
  }, [model.chats, query, activity]); // eslint-disable-line react-hooks/exhaustive-deps
  // No project flyout pops up (and an open one closes) while a project is dragged.
  const flyGate = useMemo(() => ({ dragging: dragged !== null }), [dragged]);
  // users: a pending device sees nothing on its focus host until the host owner assigns it.
  const focusAccess = useHostAccess(useApp((s) => s.hosts?.active ?? "local"));

  return (
    <SidebarHostsContext.Provider value={hostsCtx}>
    <AttentionContext.Provider value={attention}>
      {/* 在主界面调整: the region the 调整左侧栏 panel adjusts (a faint outline while it is open, styles.css; no layout
          change); a right-click / press inside is remembered as the entry the focus returns to. */}
      <aside
        data-resizable-pane
        data-customize-region="sidebar"
        tabIndex={-1}
        onContextMenuCapture={(e) => noteCustomizeOpener((e.target as Element).closest(FOCUSABLE) ?? e.currentTarget)}
        onPointerDownCapture={(e) => noteCustomizeOpener((e.target as Element).closest(FOCUSABLE) ?? e.currentTarget)}
        className="relative flex h-full w-[var(--sidebar-w,16rem)] max-w-[calc(100%-360px)] min-w-[180px] shrink-0 flex-col bg-transparent outline-none"
      >
        <PaneResizer field="sidebarWidth" edge="right" />
        <RestoreBanner compact />
        <div className="p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("sidebar.search")}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1 text-[13px] outline-none placeholder:text-subtle focus:border-accent"
          />
        </div>
        <div className="px-1.5 pb-1.5">
          <TopNav />
        </div>
        <FlyoutGateContext.Provider value={flyGate}>
        <ProjectDragContext.Provider value={projectDrag}>
        {/* The list's empty area: a menu with only 调整左侧栏… (rows and headers have their own menus). */}
        <nav className="flex-1 overflow-y-auto px-1.5 pt-1 pb-2" onContextMenu={contextMenu(() => [customizeSidebarItem(t)])}>
          {groups.length === 0 && chats.length === 0 && hostOnly.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-subtle">{focusAccess.pending ? t("users.access.pendingEmpty") : t("sidebar.empty")}</p>
          ) : (
            <>
              {layout.main.filter((l) => !trailing(l)).map((l) => (
                <LaidOutProject key={groupKey(l.group)} layout={l} dragKey={dragKeyOf(l.group, searching)} dragging={dragged === groupKey(l.group)} searching={searching} />
              ))}
              <OtherProjects layouts={layout.others} />
              {sectionLayouts.map(({ section, layouts }) => (
                <ProjectSection
                  key={section.id}
                  section={section}
                  layouts={layouts}
                  visible={visibleSections}
                  searching={searching}
                  dragged={dragged}
                  drop={{
                    active: dragged !== null,
                    over: sectionOver === section.id,
                    onDragOver: () => setSectionOver(section.id),
                    onDragLeave: () => setSectionOver((o) => (o === section.id ? null : o)),
                    onDrop: () => {
                      const from = dragged ? memberOf(dragged) : null;
                      if (from) updateSections((list) => assignSection(list, from, section.id));
                      setSectionOver(null);
                      projectDrag.end();
                    },
                  }}
                />
              ))}
              {/* 独立智能体 (unless starred) stays below the projects, sections included. */}
              {layout.main.filter(trailing).map((l) => (
                <LaidOutProject key={groupKey(l.group)} layout={l} dragKey={null} dragging={false} searching={searching} />
              ))}
              {chats.length > 0 && <ChatsGroup rows={chats} />}
              {!searching && hostOnly.map((h) => <HostOnlyHeader key={h.look.id} look={h.look} state={h.state} />)}
            </>
          )}
        </nav>
        </ProjectDragContext.Provider>
        </FlyoutGateContext.Provider>
        <SidebarFooter />
      </aside>
    </AttentionContext.Provider>
    </SidebarHostsContext.Provider>
  );
}
