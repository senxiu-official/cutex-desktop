import { UserLayoutOfflineItems, UserLayoutStatus } from "./UserLayoutMemory";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { BellOff, ChevronRight, CircleCheck, LayoutDashboard, MessageSquare, Power, Settings2, Star, TriangleAlert, User, type LucideIcon } from "lucide-react";
import { SidebarLoadProgress } from "./SidebarLoadProgress";
import { useI18n } from "../i18n";
import { groupKey, moveProject, orderGroups, rowKey, shownName, type AgentRow, type SidebarGroup } from "../lib/sidebar";
import { DROP_TINT, dropTint } from "../lib/dropTint";
import { useSidebarCollapsed, useSidebarEdge } from "../lib/windowSidebar";
import { useWindowKey } from "../lib/windowScope";
import { hostListKeys, setHostListKeys, toggleOfflineFoldOpen, toggleRestOpen, toggleProjectFolded, updateSections, useUiPrefs, type RunningAgents as RunningAgentsMode } from "../lib/prefs";
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
import { compareRecent, lastSeen } from "../lib/offlineAgents";
import { sidebarOf, useApp } from "../store";
import { contextMenu } from "../lib/contextMenu";
import { noteCustomizeOpener } from "../lib/customize";
import { sidebarMenuTail } from "../lib/customizeMenu";
import { hostStopIdleEntries } from "../lib/stopIdle";
import { agentMenu } from "../lib/menus";
import { projectMenu } from "../lib/projectMenus";
import { rootFor } from "../lib/workspace";
import { AttentionContext, useAttentionSource } from "../lib/attentionView";
import { activityTimesFor, activityTimesOf } from "../lib/sessionsMeta";
import { useNameOrderKey } from "../lib/rosterOrder";
import { foldRows, layoutSidebar, nextRosterChange, type GroupLayout, type LayoutContext } from "../lib/sidebarLayout";
import { holdLayout, placementOf, useRosterPresence } from "../lib/rosterFreeze";
import { openProjectViewPane, useProjectViewAvailable } from "../lib/sidebarProjectView";
import { computeFresh, markAgentOpened, publishFresh, useFreshAgents } from "../lib/freshAgents";
import { NEUTRAL_GROUP, projectBlockLook } from "../lib/projectSeparation";
import { useProjectMuted } from "../lib/notificationLevelsStore";
import { services } from "../modules/app";
import { ItemBoundary } from "../modules/Outlet";
import { LocalBadge } from "../modules/LocalBadge";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, NavArea, NavItem } from "../modules/slots";
import { StatusAvatar } from "./AgentStatus";
import { ProjectIcon } from "./ProjectIcon";
import { RestoreBanner } from "./RestoreBanner";
import { AgentRowButton, OfflineRow, PinnedRows } from "./AgentRows";
import { toggleOpenedProject, useOpenedProject } from "../lib/openedProjects";
import { relativeTime } from "../lib/sidebarView";
import { folderLook, folderStyle, OLDER_FOLDER_LOOK, type FolderLook } from "../lib/folderLook";
import { UpdateButton } from "./UpdateButton";
import { IdentityButton } from "./IdentityMenu";
import { middleOpen } from "./SidebarNav";
import { SidebarPeek } from "./SidebarPeek";
import { NowSection, NowSplitter } from "./SidebarNowAll";
import { AllRowsCompact } from "../lib/allRowsCompact";
import { runNav, useNavActive } from "../lib/navEntries";
import { PaneResizer } from "./PaneResizer";
import { newInstanceKey, openModifiers } from "../lib/openModifiers";
import { ScriptText } from "./ScriptText";
import { useHostAccess } from "../lib/hostAccess";
import { realAgentName } from "../lib/agentAlias";
import { dataFlags, useSizeFlags, widthBelow } from "../lib/sizeFlags";
import { InfoMark } from "./InfoMark";
import { share } from "../lib/structuralShare";

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

/** Offline agents the Projects page lists before 还有 N 个 › (the rest in its 智能体 tab). */
const OFFLINE_LIST = 5;

/**
 * Offline agents on the Projects page: a divider (离线 N ── 全部 ›), the newest OFFLINE_LIST as compact
 * rows (the open agent and pins too), then 还有 N 个 ›. `onAll` opens the full list. The sidebar has
 * no offline section any more (design 060 B: 最近 / 其余 list online and offline agents together).
 */
export function OfflineSection({ rows, searching, onAll }: { rows: AgentRow[]; searching: boolean; onAll?: () => void; hostId?: string }) {
  const { t } = useI18n();
  // Last-activity times to the minute (lib/sessionsMeta), of these rows only: not re-sorted on every streamed token,
  // nor re-rendered when an online agent's activity changes.
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const activity = useApp(useCallback((s: ReturnType<typeof useApp.getState>) => activityTimesFor(activityTimesOf(s.activity), ids), [ids]));
  const selectedId = useApp((s) => (s.view.kind === "conversation" ? s.selectedId : null));
  const { shown, hidden } = useMemo(() => {
    const sorted = [...rows].sort(compareRecent((r) => lastSeen(r, activity[r.id])));
    if (searching) return { shown: sorted, hidden: 0 };
    const shown = sorted.filter((r, i) => i < OFFLINE_LIST || r.pinned || r.id === selectedId);
    return { shown, hidden: sorted.length - shown.length };
  }, [rows, activity, searching, selectedId]);
  if (rows.length === 0) return null;
  return (
    <div className="mt-0.5">
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-0.5 text-caption/[inherit] text-subtle">
        <span className="shrink-0">{t("sidebar.offlineCount", { count: rows.length })}</span>
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
      {hidden > 0 && onAll && (
        // The same 「+N」 fold as 「最近 +N」 / 「其余 +N」 (owner 2026-11-05); it opens the full list.
        <button onClick={onAll} data-offline-fold="" className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-[3px] text-left text-meta/[inherit] text-subtle hover:bg-surface-2/60 hover:text-foreground">
          <ChevronRight size={11} className="shrink-0" />
          <span className="shrink-0">{t("sidebar.moreOffline", { count: hidden })}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Running agents that need nothing (Settings → 侧栏 → 运行中智能体): compact rows (★) or the older
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
      <span className="shrink-0 text-caption/[inherit] text-subtle">{t("sidebar.runningRow")}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2 py-0.5">
        {rows.map((row) => (
          <button
            key={rowKey(row)}
            data-tip={row.name}
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

/** A compact roster row: offline agents dimmed (grey avatar), the others the compact agent row. */
function CompactRow({ row }: { row: AgentRow }) {
  return row.status === "offline" ? <OfflineRow row={row} /> : <AgentRowButton row={row} compact />;
}

/** The open agent as a host key (rows of the focus host may carry no host). */
function useSelectedKey(): { focus: string; selected: string | null } {
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const selected = useApp((s) => (s.view.kind === "conversation" && s.selectedId ? hostKey(s.selectedHost ?? focus, s.selectedId) : null));
  return { focus, selected };
}

/** A group's recently worked agents (lib/sidebarLayout `recent`: capped, in the roster order) as compact rows. */
function RecentRows({ rows }: { rows: AgentRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <CompactRow key={rowKey(row)} row={row} />
      ))}
    </>
  );
}

/** A fold lists at least this many rows before it shows its filter field. */
const REST_FILTER_FROM = 8;

/**
 * 「› 在线空闲 +N」 / 「› 离线 +N」 (lib/sidebarLayout `idle` / `offline`: every agent of the group not listed,
 * by name), expanded per group in `restOpen` / `offlineFoldOpen`. Expanded, the agents are listed in place,
 * with a filter field (by name) when there are many. Collapsed, the open agent stays listed under it
 * (opening never hides a row). Nothing when empty.
 */
function AgentFold({ kind, groupId, hostId, rows }: { kind: "idle" | "offline"; groupId: string; hostId?: string; rows: AgentRow[] }) {
  const { t } = useI18n();
  const prefs = useUiPrefs();
  const { focus, selected } = useSelectedKey();
  const list = kind === "idle" ? "restOpen" : "offlineFoldOpen";
  const open = hostId ? hostListKeys(list, [hostId]).includes(hostKey(hostId, groupId)) : prefs[list].includes(groupId);
  const [filter, setFilter] = useState("");
  if (rows.length === 0) return null;
  const isSelected = (r: AgentRow) => hostKey(r.hostId ?? focus, r.id) === selected;
  const shown = foldRows(rows, { open, filter, keep: isSelected, nameOf: shownName });
  const filterLabel = t("sidebar.restFilter", { count: rows.length });
  return (
    <div data-agent-fold={kind}>
      <button
        onClick={() => {
          setFilter("");
          (kind === "idle" ? toggleRestOpen : toggleOfflineFoldOpen)(groupId, hostId);
        }}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-[3px] text-left text-meta/[inherit] text-subtle hover:bg-surface-2/60 hover:text-foreground"
      >
        <ChevronRight size={11} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="shrink-0">{t(kind === "idle" ? "sidebar.idleFold" : "sidebar.offlineFold", { count: rows.length })}</span>
      </button>
      {open && rows.length >= REST_FILTER_FROM && (
        <div className="py-0.5 pr-1 pl-5">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape" || !filter) return;
              e.stopPropagation();
              setFilter("");
            }}
            placeholder={filterLabel}
            aria-label={filterLabel}
            data-rest-filter=""
            className="h-6 w-full rounded-ctl border border-border bg-background px-2 text-meta outline-none placeholder:text-subtle focus:border-accent"
          />
        </div>
      )}
      {shown.map((row) => (
        <CompactRow key={rowKey(row)} row={row} />
      ))}
      {open && filter.trim() !== "" && shown.length === 0 && <p className="py-0.5 pl-5 text-caption/[inherit] text-subtle">{t("sidebar.restNoMatch")}</p>}
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

/**
 * `dragKey`: null = not draggable; `dragging`: this group is the one being dragged. `collapse`: a one-row
 * project opened in place (OneRowProject): its header click goes back to one row instead of folding.
 */
const Group = memo(function Group({ layout, dragKey, dragging: dragged, searching, collapse }: { layout: GroupLayout; dragKey: string | null; dragging: boolean; searching: boolean; collapse?: () => void }) {
  const { t } = useI18n();
  const { group } = layout;
  const hosts = useSidebarHosts();
  const own = !group.hostId || group.hostId === hosts?.focus;
  const [userOpen, toggleUserOpen] = useGroupOpen(group.id, own ? undefined : group.hostId);
  const open = collapse ? true : userOpen;
  const toggleOpen = collapse ?? toggleUserOpen;
  const title = group.kind === "project" ? group.name : t("sidebar.independent");
  const sidebar = useApp((s) => sidebarOf(s, group.hostId));
  // Project mutes are the focus host's notification levels (other hosts: not shown yet).
  const muted = useProjectMuted(group.id) && own;
  const root = group.kind === "project" ? rootFor(sidebar, { kind: "project", id: group.id }) : null;
  const look = sidebarMark(hosts, group.hostId);
  const state = hosts?.stateOf(group.hostId) ?? "live";
  const prefs = useUiPrefs();
  const remark = groupRemark(prefs.projectRemarks, group, hosts?.focus ?? "local");
  const drag = useContext(ProjectDragContext);
  const dropLine = useDropAt(drag, dragKey);
  const dropAt = dragKey && !dragged ? dropLine : null;
  const block = projectBlockLook(prefs.projectSeparation, group.kind === "project" ? group.color : NEUTRAL_GROUP);
  const projectView = useProjectViewAvailable();
  const standalone = group.kind === "independent";
  return (
    <section data-roster-kind={standalone ? "system" : "project"} className={`relative ${block.className} ${dragged ? "opacity-40" : ""} ${state === "offline" ? "opacity-50 grayscale" : ""}`} style={block.style} data-project-block={block.style ? prefs.projectSeparation : undefined} data-folded={open ? undefined : ""} data-group-key={groupKey(group)}>
      {dropAt && <div className={`pointer-events-none absolute right-1 left-1 h-0.5 rounded bg-accent ${dropAt === "before" ? "-top-1" : "-bottom-1"}`} />}
      <div
        // Folded with the open agent inside: highlighted like a collapsed row.
        className={`group/header flex items-center rounded-md ${!open && layout.hasSelected ? "bg-surface-2" : ""} ${block.headerClassName}`}
        data-highlight={!open && layout.hasSelected ? "" : undefined}
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
          onClick={() => { if (state === "offline") useApp.getState().notify(t("sidebar.hostRowOffline", { host: look?.label ?? group.hostId ?? "" })); toggleOpen(); }}
          aria-expanded={open}
          data-tip={[t(open ? "fold.collapse" : "fold.unfold"), root].filter(Boolean).join("\n")}
          data-standalone-header={standalone ? "" : undefined}
          data-system-row={standalone ? "" : undefined}
          data-highlight={standalone && !open && layout.hasSelected ? "" : undefined}
          className={standalone ? STANDALONE_HEADER : "group/fold flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left"}
        >
          {/* The group icon is its fold toggle (chevron on hover / focus). */}
          {standalone ? (
            <StandaloneTitle icon={User} title={title} open={open} />
          ) : (
            <>
              <ProjectIcon source={group.kind === "project" ? { color: group.color, badge: group.badge || title.slice(0, 1), icon: groupIcon(prefs.projectIcons, group, hosts?.focus ?? "local") } : { glyph: User }} toggle={open ? "open" : "closed"} />
              <span className="truncate text-xs font-semibold text-muted"><ScriptText text={title} /></span>
            </>
          )}
          {look && <HostMark host={look} className={standalone ? "min-w-6 shrink" : "shrink-0"} />}
          {layout.starred && <Star size={10} className="shrink-0 fill-warn text-warn" aria-label={t("sidebar.starred")} />}
          {muted && <BellOff size={10} className="shrink-0 text-subtle" />}
          {standalone && <SystemLine />}
          {state === "live" ? (
            // Always shown (design 060 §10.6: who runs and who is online is what the roster is asked most).
            <GroupCounts running={layout.runningCount} online={layout.onlineCount} needs={layout.needsYouCount} />
          ) : (
            <span className="ml-auto" />
          )}
        </button>
        {state !== "live" && look && <HostStatusAction look={look} state={state} />}
        {group.kind === "project" && projectView && (
          <button
            onClick={() => openProjectViewPane(group.hostId ?? hosts?.focus ?? "local", group.id)}
            data-tip={t("sidebar.openProjectView")}
            aria-label={t("sidebar.openProjectView")}
            data-open-project-view=""
            className="hidden rounded p-0.5 text-subtle group-focus-within/header:block group-hover/header:block hover:bg-surface-2 hover:text-foreground"
          >
            <LayoutDashboard size={13} />
          </button>
        )}
        {group.kind === "project" && (
          <button onClick={() => services.ui.openPage("projects.page", { project: group.id, tab: "settings", ...(own ? {} : { host: group.hostId! }) })} data-tip={t("nav.projectSettings")} aria-label={t("nav.projectSettings")} className="mr-1 hidden rounded p-0.5 text-subtle group-hover/header:block hover:bg-surface-2 hover:text-foreground">
            <Settings2 size={13} />
          </button>
        )}
      </div>
      {/* Folded by its header: pins stay listed (never folded away). */}
      {!open && <PinnedRows rows={layout.big} className={block.bodyClassName} />}
      {open && remark && (
        // 本机备注 under the header. The project directory is never a sidebar line (owner 2026-10-14: it
        // only shifted the list when a project got selected): it stays in the header / remark tooltips
        // and on the project page.
        <div className={`truncate pr-1.5 pb-0.5 pl-6 text-caption/[inherit] text-subtle ${block.metaClassName}`} data-project-remark="" data-tip={[remark, t("remark.tooltip"), root].filter(Boolean).join("\n")}>
          <ScriptText text={remark} />
        </div>
      )}
      {open && (
        <div className={block.bodyClassName}>
          {/* Listed (big rows: Director, pins, needs-you / error, running; quiet running ones compact; then recently worked, capped), then the two folds. */}
          {layout.big.map((row) => (
            <AgentRowButton key={rowKey(row)} row={row} />
          ))}
          <RunningAgents rows={layout.running} mode={prefs.runningAgents} />
          <RecentRows rows={layout.recent} />
          <AgentFold kind="idle" groupId={group.id} hostId={own ? undefined : group.hostId} rows={layout.idle} />
          <AgentFold kind="offline" groupId={group.id} hostId={own ? undefined : group.hostId} rows={layout.offline} />
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
    <section data-roster-kind="system">
      <button onClick={toggleOpen} className="flex w-full min-w-0 items-center gap-1.5 px-1.5 py-1 text-left">
        <span className="inline-block w-2.5 text-caption/[inherit] text-subtle">{open ? "▾" : "▸"}</span>
        <span className="truncate text-xs font-semibold text-muted">{t("sidebar.otherProjects")}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-caption/[inherit]">
          {needs > 0 && <span className="font-semibold text-warn">{t("sidebar.needsYouCount", { count: needs })}</span>}
          {running > 0 && <span className="text-accent">{t("sidebar.runningCount", { count: running })}</span>}
          <span className="text-subtle">{layouts.length}</span>
        </span>
      </button>
      {open && (
        <div className="pl-1" data-roster-body="" style={{ "--band-extra": "4px" } as CSSProperties}>
          {layouts.map((l) => (
            <OneRowProject key={groupKey(l.group)} layout={l} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * A project header's counts (design 060 B, always shown): 「● 2 运行 · 7 在线 · ⚠ 1」. Running in the
 * accent colour, needs-you in the warning colour (the words in the tooltip).
 */
function GroupCounts({ running, online, needs }: { running: number; online: number; needs: number }) {
  const { t } = useI18n();
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 text-caption/[inherit] text-subtle tabular-nums" data-group-counts="">
      {running > 0 && (
        <>
          <span className="flex items-center gap-1 text-accent" data-tip={t("sidebar.runningCount", { count: running })}>
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {t("sidebar.runningShort", { count: running })}
          </span>
          <span aria-hidden>·</span>
        </>
      )}
      <span>{t("sidebar.online", { count: online })}</span>
      {needs > 0 && (
        <span className="ml-0.5 flex items-center gap-0.5 font-semibold text-warn" data-tip={t("sidebar.needsYouCount", { count: needs })} data-group-needs="">
          <TriangleAlert size={10} />
          {needs}
        </span>
      )}
    </span>
  );
}

/** Folded folder totals: compact (icon + number, the words in the tooltip) so the name keeps its room. */
function FolderTotals({ needsYou, updates = 0, running }: { needsYou: number; updates?: number; running: number }) {
  const { t } = useI18n();
  return (
    <>
      {needsYou > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 font-semibold text-warn" data-tip={t("sidebar.needsYouCount", { count: needsYou })}>
          <TriangleAlert size={10} />
          {needsYou}
        </span>
      )}
      {updates > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-muted" data-tip={`${t("section.updatesCount", { count: updates })} · ${t("section.updatesHint")}`}>
          <CircleCheck size={10} />
          {updates}
        </span>
      )}
      {running > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-accent" data-tip={t("sidebar.runningCount", { count: running })}>
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {running}
        </span>
      )}
    </>
  );
}

/**
 * A folder's header row, the parent level of the projects under it (owner 2026-11-05): it starts a little
 * left of a project's icon (outdented, never clipped: the roster keeps its padding), the folder's icon
 * (lib/folderLook; the chevron while pointing at it), the name in the folder's colour as strong as a project
 * name, the project count, then a thick line in the same colour; folded, the totals after it. Owner folders
 * and the automatic 「更早的项目」 share it.
 */
function FolderHeader({ look, name, count, open, onToggle, title, totals, system = false }: { look: FolderLook; name: string; count: number; open: boolean; onToggle(): void; title: string; totals?: ReactNode; system?: boolean }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      data-tip={title}
      data-folder-header=""
      data-system-row={system ? "" : undefined}
      className="group/fold -ml-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md py-1 pr-1.5 pl-0.5 text-left text-caption/[inherit] whitespace-nowrap text-subtle hover:bg-surface-2/60"
    >
      <span className="folder-ink relative flex h-5 w-[18px] shrink-0 items-center justify-center">
        <look.icon size={14} strokeWidth={2.2} aria-hidden className="group-hover/fold:invisible group-focus-visible/fold:invisible" />
        <span aria-hidden className="invisible absolute inset-0 flex items-center justify-center group-hover/fold:visible group-focus-visible/fold:visible">
          <ChevronRight size={13} strokeWidth={2.4} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
      </span>
      <span className="folder-ink min-w-[2.5em] truncate text-ui/[inherit] font-semibold" data-folder-name="">
        <ScriptText text={name} />
      </span>
      {/* Only a folder's count sits beside its name; a system row's is right-aligned like the other rows' meta. */}
      {!system && <span className="shrink-0 tabular-nums">{count}</span>}
      {system ? <SystemLine /> : <span className="folder-line h-[3px] min-w-2 flex-1 rounded-full" />}
      {system && <span className="shrink-0 tabular-nums">{count}</span>}
      {!open && totals}
    </button>
  );
}

/**
 * A standalone row on the folder level that is not a folder (owner 2026-11-06): the independent group (独立
 * 智能体, one per host) and quick chats. Same left edge, icon box and name type as FolderHeader, so it never
 * reads as the child of the folder above it; what only a folder has is left out: its colour, the count beside
 * the name and the thick line. Neutral colours; the meta (host chip, counts, time) stays right-aligned.
 */
const STANDALONE_HEADER = "group/fold -ml-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md py-1 pr-1.5 pl-0.5 text-left text-caption/[inherit] whitespace-nowrap text-subtle hover:bg-surface-2/60";
/**
 * A system row's trailing line (styles.css `.system-line`): 虚线 draws it thin, grey and dashed where a folder has its thick
 * coloured one; 灰底条 hides it (the row sits on a grey band instead). Either way it keeps the meta right-aligned.
 */
function SystemLine() {
  return <span className="system-line min-w-2 flex-1" aria-hidden />;
}

function StandaloneTitle({ icon: Icon, title, open }: { icon: LucideIcon; title: string; open: boolean }) {
  return (
    <>
      <span className="relative flex h-5 w-[18px] shrink-0 items-center justify-center text-muted">
        <Icon size={14} strokeWidth={2.2} aria-hidden className="group-hover/fold:invisible group-focus-visible/fold:invisible" />
        <span aria-hidden className="invisible absolute inset-0 flex items-center justify-center group-hover/fold:visible group-focus-visible/fold:visible">
          <ChevronRight size={13} strokeWidth={2.4} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
      </span>
      <span className="min-w-[2.5em] shrink-[0.2] truncate text-ui/[inherit] font-semibold text-muted" data-standalone-name="">
        <ScriptText text={title} />
      </span>
    </>
  );
}

/**
 * 「更早的项目」 (design 060 §5.4): projects quiet for the 更早的项目 setting, as an automatic folder that
 * looks like the owner's (FolderHeader; lib/folderLook OLDER_FOLDER_LOOK): one row each, folded by default (open per
 * list in `restOpen` under `foldId`). Not renameable or deletable, its members derived; nothing goes into
 * `sidebarSections`, so an owner folder of the same name is a different folder. Starring a project brings it
 * back up. Totals of what runs or wants the owner stay on the header (nothing under it should, by the rule,
 * but a held layout may lag).
 */
function OlderProjects({ layouts, foldId, nested = false }: { layouts: GroupLayout[]; foldId: string; nested?: boolean }) {
  const { t } = useI18n();
  const prefs = useUiPrefs();
  const open = prefs.restOpen.includes(foldId);
  if (layouts.length === 0) return null;
  const needs = layouts.reduce((n, l) => n + l.needsYouCount, 0);
  const running = layouts.reduce((n, l) => n + l.runningCount, 0);
  const days = prefs.olderProjectsAfter === "off" ? 0 : prefs.olderProjectsAfter;
  const look = OLDER_FOLDER_LOOK;
  return (
    <section data-roster-kind={nested ? "project" : "system"} data-folded={open ? undefined : ""} data-older-projects="" style={folderStyle(look)}>
      <div className="flex items-center rounded-md">
        <FolderHeader system={!nested} look={look} name={t("sidebar.olderProjects")} count={layouts.length} open={open} onToggle={() => toggleRestOpen(foldId)} title={t("sidebar.olderProjectsHint", { days })} totals={<FolderTotals needsYou={needs} running={running} />} />
      </div>
      {open && (
        <div className="pl-2" data-roster-body="" style={{ "--band-extra": "4px" } as CSSProperties}>
          {layouts.map((l) => (
            <OneRowProject key={groupKey(l.group)} layout={l} />
          ))}
        </div>
      )}
    </section>
  );
}

/** The 「更早的项目」 fold key of the main list, or of a folder (lib/sidebarSections). */
const olderFoldId = (section?: string) => (section ? `__older__:${section}` : "__older__");

/**
 * A project shown as one row (no agent online, 其他项目, 更早的项目): badge, name, needs-you / running counts,
 * last activity. A click opens it in place as the full group with the same three segments as every other
 * project (lib/openedProjects, this run only); its header click folds it back. Nothing opens on hover
 * (owner 2026-11-05: the old flyout is gone). Pins stay listed under the row.
 */
function OneRowProject({ layout, dragKey = null, dragging = false }: { layout: GroupLayout; dragKey?: string | null; dragging?: boolean }) {
  const { t } = useI18n();
  const { group } = layout;
  const key = groupKey(group);
  const opened = useOpenedProject(key);
  const title = group.kind === "project" ? group.name : t("sidebar.independent");
  const sidebar = useApp((s) => sidebarOf(s, group.hostId));
  const hosts = useSidebarHosts();
  // Project mutes are the focus host's notification levels (other hosts: not shown yet).
  const muted = useProjectMuted(group.id) && (!group.hostId || group.hostId === hosts?.focus);
  const look = sidebarMark(hosts, group.hostId);
  const root = group.kind === "project" ? rootFor(sidebar, { kind: "project", id: group.id }) : null;
  const prefs = useUiPrefs();
  const remark = groupRemark(prefs.projectRemarks, group, hosts?.focus ?? "local");
  const block = projectBlockLook(prefs.projectSeparation, group.kind === "project" ? group.color : NEUTRAL_GROUP);
  if (opened) return <Group layout={{ ...layout, mode: "full" }} dragKey={dragKey} dragging={dragging} searching={false} collapse={() => toggleOpenedProject(key)} />;
  const standalone = group.kind === "independent";
  return (
    <div data-roster-kind={standalone ? "system" : "project"} data-folded="">
      <div className={block.rowClassName || undefined} style={block.style} data-group-key={key} data-one-row="" onContextMenu={contextMenu(() => projectMenu(group, root, true, null, t))}>
        <button
          onClick={() => toggleOpenedProject(key)}
          data-tip={[remark && t("remark.withText", { text: remark }), root, t("fold.unfold")].filter(Boolean).join("\n")}
          aria-expanded={false}
          data-highlight={layout.hasSelected ? "" : undefined}
          data-standalone-header={standalone ? "" : undefined}
          data-system-row={standalone ? "" : undefined}
          className={standalone ? `${STANDALONE_HEADER} w-full ${layout.hasSelected ? "bg-surface-2" : ""}` : `group/fold flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left ${layout.hasSelected ? "bg-surface-2" : "hover:bg-surface-2/60"}`}
        >
          {/* The icon stands where the chevron was (chevron while pointing at it), as in an expanded header. */}
          {standalone ? (
            <StandaloneTitle icon={User} title={title} open={false} />
          ) : (
            <>
              <ProjectIcon source={group.kind === "project" ? { color: group.color, badge: group.badge || title.slice(0, 1), icon: groupIcon(prefs.projectIcons, group, hosts?.focus ?? "local") } : { glyph: User }} toggle="closed" />
              <span className="min-w-0 truncate text-xs font-semibold text-muted"><ScriptText text={title} /></span>
            </>
          )}
          {look && <HostMark host={look} className={standalone ? "min-w-6 shrink" : "shrink-0"} />}
          {muted && <BellOff size={10} className="shrink-0 text-subtle" />}
          {standalone && <SystemLine />}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-caption/[inherit]">
            {layout.needsYouCount > 0 && <span className="font-semibold text-warn">{t("sidebar.needsYouCount", { count: layout.needsYouCount })}</span>}
            {layout.runningCount > 0 && <span className="text-accent">{t("sidebar.runningCount", { count: layout.runningCount })}</span>}
            <span className="text-subtle">{relativeTime(layout.lastActivity)}</span>
          </span>
        </button>
      </div>
      <PinnedRows rows={layout.big} className="pl-1" />
    </div>
  );
}

/** One project of a laid-out list: its one-row form or the full group. */
const LaidOutProject = memo(function LaidOutProject({ layout, dragKey, dragging, searching }: { layout: GroupLayout; dragKey: string | null; dragging: boolean; searching: boolean }) {
  return layout.mode === "collapsed" ? <OneRowProject layout={layout} dragKey={dragKey} dragging={dragging} /> : <Group layout={layout} dragKey={dragKey} dragging={dragging} searching={searching} />;
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
 * An owner folder (lib/sidebarSections) over its projects, read as the parent level (FolderHeader; folded:
 * needs-you / new results / running totals). Open, its projects are nested by indent only (owner 2026-11-05:
 * no rule beside them, the projects draw their own lines). Searching lists every match regardless of the fold.
 */
function ProjectSection({ section, layouts, older, visible, searching, dragged, drop }: { section: SidebarSection; layouts: GroupLayout[]; older: GroupLayout[]; visible: readonly string[]; searching: boolean; dragged: string | null; drop: SectionDrop }) {
  const { t } = useI18n();
  const { sectionCollapsedShows } = useUiPrefs();
  const folded = section.collapsed && !searching;
  const sum = summarizeSection([...layouts, ...older]);
  const shown = visibleInSection(layouts, section.collapsed, searching, sectionCollapsedShows);
  const updates = sum.attention - sum.needsYou;
  const look = folderLook(section.id, section.look);
  return (
    <section data-roster-kind="folder" data-sidebar-section={section.id} style={folderStyle(look)}>
      <div
        data-section-drop-over={drop.over || undefined}
        className={`flex items-center rounded-md ${drop.over ? `ring-1 ring-accent/50 ${DROP_TINT}` : ""}`}
        style={drop.over ? dropTint("var(--accent)", 10) : undefined}
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
        <FolderHeader
          look={look}
          name={section.name}
          count={sum.projects}
          open={!folded}
          onToggle={() => updateSections((list) => setSectionCollapsed(list, section.id, !section.collapsed))}
          title={t("section.projectsHint", { count: sum.projects })}
          totals={<FolderTotals needsYou={sum.needsYou} updates={updates} running={sum.running} />}
        />
      </div>
      {(shown.length > 0 || (!folded && older.length > 0)) && (
        <div className={folded ? "" : "pl-2"} data-roster-body="">
          {shown.map((l) => (
            <LaidOutProject key={groupKey(l.group)} layout={l} dragKey={folded ? null : dragKeyOf(l.group, searching)} dragging={dragged === groupKey(l.group)} searching={searching} />
          ))}
          {/* Quiet projects of the folder fold inside it (design 060 §4: no folder is special). */}
          {!folded && older.length > 0 && <OlderProjects layouts={older} foldId={olderFoldId(section.id)} nested />}
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
    <section data-roster-kind="system" className={`relative ${block.className}`} style={block.style} data-project-block={block.style ? prefs.projectSeparation : undefined} data-folded={open ? undefined : ""} data-group-key="__chats__">
      <div className={`flex items-center rounded-md ${block.headerClassName}`}>
        <button
          onClick={toggleOpen}
          aria-expanded={open}
          data-tip={t(open ? "fold.collapse" : "fold.unfold")}
          data-standalone-header=""
          data-system-row=""
          className={`${STANDALONE_HEADER} w-full`}
        >
          <StandaloneTitle icon={MessageSquare} title={t("sidebar.chats")} open={open} />
          <SystemLine />
          {/* Right-aligned like the other rows' meta; only a folder's count sits beside its name. */}
          <span className="ml-auto text-caption/[inherit] text-subtle tabular-nums">{rows.length}</span>
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
  if (state === "loading") return <span className="mr-1 shrink-0 text-caption/[inherit] text-subtle">{t("sidebar.hostLoading")}</span>;
  return (
    <span className="mr-1 flex shrink-0 items-center gap-1 text-caption/[inherit] text-subtle">
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
    <section data-roster-kind="system" className="opacity-70">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <span className="inline-block w-2.5" />
        <HostMark host={look} className="shrink-0" />
        <span className="ml-auto" />
        <HostStatusAction look={look} state={state} />
      </div>
      {state === "live" && <p className="pl-6 text-caption/[inherit] text-subtle">{t("sidebar.hostNoRows")}</p>}
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
      onClick={(e) => runNav(item, openModifiers(e))}
      {...middleOpen(() => runNav(item, openModifiers({ ctrlKey: false, metaKey: false, shiftKey: false, button: 1 })))}
      data-tip={[label, badge?.title].filter(Boolean).join("\n")}
      aria-label={label}
      className={`relative flex shrink-0 items-center rounded p-1.5 hover:bg-surface-2 hover:text-foreground disabled:opacity-50 ${active ? "bg-surface-2 text-foreground" : ""}`}
    >
      <Icon size={14} />
      <LocalBadge moduleId={entry.moduleId} />
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
  const attentionSource = useAttentionSource(attention);
  const selectedKey = useApp((s) => (s.view.kind === "conversation" && s.selectedId ? hostKey(s.selectedHost ?? s.hosts?.active ?? "local", s.selectedId) : null));
  const [query, setQuery] = useState("");
  const prefs = useUiPrefs();
  const hostIds = scope.ids;
  // Re-read on every prefs change (useUiPrefs re-renders): host-keyed lists over the scope's hosts.
  const projectOrder = useMemo(() => hostListKeys("projectOrder", hostIds), [prefs, hostIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const starredKeys = useMemo(() => new Set(hostListKeys("starredProjects", hostIds)), [prefs, hostIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dragged, setDragged] = useState<string | null>(null);
  const dropStore = useMemo(createDropStore, []);
  const searching = query.trim() !== "";
  // Not the whole `activity` (a streamed token refreshes it every frame; perf baseline H1): last-activity
  // times to the minute for the layout (idle fold, offline order), the preview texts only while searching.
  const times = useApp((s) => activityTimesOf(s.activity));
  const activity = useApp((s) => (searching ? s.activity : null));
  const hostsCtx = useMemo<SidebarHosts>(() => ({ marks: scope.showHostMarks, localMarks: prefs.hostMarkLocal, focus: scope.focus, look: (id) => scope.host(id ?? scope.focus), stateOf: scoped.stateOf }), [scope, scoped.stateOf, prefs.hostMarkLocal]);
  // Hosts of the scope with nothing to list (not reached yet this run): a header with their status.
  const hostOnly = scoped.hosts.filter((h) => !h.hasRows && (scope.multi || h.state !== "live"));
  // Activity previews are the focus host's (other hosts' rows search by name).
  const own = (r: AgentRow) => !r.hostId || r.hostId === scope.focus;
  const previewOf = (r: AgentRow) => (own(r) ? activity?.[r.id] : undefined);

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
  // The roster's clock: advanced when a row leaves 最近 or a project turns quiet enough for 「更早的项目」
  // (lib/sidebarLayout nextRosterChange), so they move by themselves. A stale clock (rows changed since)
  // is caught up at once: their crossing is already past.
  const lastOfRow = (r: AgentRow) => lastSeen(r, own(r) ? times[r.id] : undefined);
  const [foldNow, setFoldNow] = useState(() => Date.now());
  const nextFold = useMemo(() => nextRosterChange(model.groups, foldNow, lastOfRow, prefs.olderProjectsAfter), [model.groups, times, foldNow, scope.focus, prefs.olderProjectsAfter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (nextFold === null) return;
    const timer = setTimeout(() => setFoldNow(Date.now()), Math.max(0, nextFold - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [nextFold]);
  // The name order (Settings → Appearance; lib/rosterOrder) is read while laying out: lay out again when it changes.
  const nameKey = useNameOrderKey();
  const layoutCtx = useMemo<LayoutContext>(
    () => ({
      signalOf: (key) => attention.signals.get(key),
      selectedId: selectedKey,
      starred: starredKeys,
      prefs: { grouping: prefs.projectGrouping, noOnline: prefs.noOnlineProjects, running: prefs.runningAgents, olderAfter: prefs.olderProjectsAfter },
      searching,
      lastOf: lastOfRow,
      now: foldNow,
      isFresh: (key) => fresh.keys.has(key) || key === openedFresh,
    }),
    [fresh, openedFresh, attention.signals, selectedKey, starredKeys, prefs.projectGrouping, prefs.noOnlineProjects, prefs.runningAgents, prefs.olderProjectsAfter, searching, times, foldNow, nameKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Sections (pure UI prefs, lib/sidebarSections): their projects leave the main list and render
  // under the section's header, laid out by the same rules.
  const sections = prefs.sidebarSections;
  const split = useMemo(() => splitBySection(groups, sections, scope.focus), [groups, sections, scope.focus]);
  // The same layout objects while a group's layout reads the same (lib/structuralShare; perf §9): an agent's
  // status change re-renders its own group, not every project of the sidebar.
  const freshLayout = useMemo(() => layoutSidebar(split.rest, layoutCtx), [split, layoutCtx]);
  // Only sections with a member in this scope (searching: with a match) show.
  const freshSections = useMemo(
    () =>
      sections.flatMap((section) => {
        const own = split.bySection.get(section.id);
        return own?.length ? [{ section, layout: layoutSidebar(own, layoutCtx) }] : [];
      }),
    [sections, split, layoutCtx],
  );
  // Held still while the owner is in the list (lib/rosterFreeze, design 060 §4): the places are taken when
  // the pointer / keyboard focus comes in, everything settles when it leaves.
  // What the owner does here (star, drag, a setting, a folder, searching) takes effect at once.
  const presence = useRosterPresence();
  const ownerKey = JSON.stringify([[...starredKeys], projectOrder, sections, prefs.projectGrouping, prefs.noOnlineProjects, prefs.runningAgents, prefs.olderProjectsAfter, nameKey]);
  const holding = presence.inside && !searching;
  const snapshot = () => ({ key: ownerKey, main: placementOf(freshLayout), sections: new Map(freshSections.map((x) => [x.section.id, placementOf(x.layout)])) });
  const [held, setHeld] = useState<ReturnType<typeof snapshot> | null>(null);
  useEffect(() => {
    if (!holding) setHeld(null);
    else if (held?.key !== ownerKey) setHeld(snapshot());
  }, [holding, ownerKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const hold = holding && held?.key === ownerKey ? held : null;
  const shown = useMemo(() => {
    if (!hold) return { main: freshLayout, sections: freshSections };
    const sectionsHeld = freshSections.map((x) => {
      const placed = hold.sections.get(x.section.id);
      return placed ? { section: x.section, layout: holdLayout(placed, x.layout) } : x;
    });
    return { main: holdLayout(hold.main, freshLayout), sections: sectionsHeld };
  }, [hold, freshLayout, freshSections]);
  // The same layout objects while a group's layout reads the same (lib/structuralShare; perf §9): an agent's
  // status change re-renders its own group, not every project of the sidebar.
  const sharedLayout = useRef<unknown>(null);
  const layout = useMemo(() => (sharedLayout.current = share(sharedLayout.current, shown.main)), [shown]);
  const sharedSections = useRef<unknown>(null);
  const sectionLayouts = useMemo(
    () => (sharedSections.current = share(sharedSections.current, shown.sections.map(({ section, layout: l }) => ({ section, layouts: [...l.main, ...l.others], older: l.older })))),
    [shown],
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
  // users: a pending device sees nothing on its focus host until the host owner assigns it.
  const focusAccess = useHostAccess(useApp((s) => s.hosts?.active ?? "local"));
  // Collapsed (Ctrl/⌘+B, the logo): fully hidden with the left-edge pop-out (owner 2026-10-28; §24.13 hides it
  // automatically while two workspaces are short of width, §24.16 while a pane is full screen). This window's own
  // collapse (multi-window P3, lib/windowSidebar useSidebarCollapsed; the main window: the prefs).
  const collapsed = useSidebarCollapsed();
  // The width edge is drawn (not while hidden): a column against the sidebar leaves the gap to it (components/side/SideArea).
  const edgeStore = useSidebarEdge.of(useWindowKey());
  useLayoutEffect(() => {
    edgeStore.setState({ shown: !collapsed });
    return () => edgeStore.setState({ shown: false });
  }, [edgeStore, collapsed]);
  const searchRef = useRef<HTMLInputElement>(null);

  // 侧栏布局 (design 040 §4): 花名册, or 现在 / 全部 (components/SidebarNowAll; 「全部」 = this roster in compact rows).
  const nowAll = prefs.sidebarLayout === "now-all";
  // The 「现在」 height while its divider is dragged (stored on release).
  const [liveNow, setLiveNow] = useState<number | null>(null);
  const nowHeight = liveNow ?? prefs.sidebarNowHeight;
  const searchField = (placeholder: string, className: string) => (
    <input ref={searchRef} data-sidebar-search="" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={className} />
  );
  // Ctrl / middle click on a row opens it beside the current one (design 040 §2.1: the how-to is this ⓘ, not each row's tip).
  const besideInfo = <InfoMark text={t("pane.openBesideHint", { key: newInstanceKey() })} className="order-last" />;
  // The full sidebar's body: docked when expanded, the popped overlay while hidden (components/SidebarPeek).
  const full = (
    <>
        {nowAll ? (
          <>
            {/* 「现在」 (the abnormal-shutdown notice under its header), the divider, then 「全部」's header with the filter. */}
            <NowSection attention={attention} focus={scope.focus} height={nowHeight} notice={<RestoreBanner compact />} />
            <NowSplitter height={nowHeight} onLive={setLiveNow} />
            <div data-sidebar-all="" className="flex shrink-0 items-center gap-1.5 px-2.5 pt-1 pb-1">
              <span className="text-meta font-semibold text-muted">{t("sidebar.all")}</span>
              <span className="text-caption text-subtle tabular-nums">{attention.rows.length}</span>
              {besideInfo}
              {searchField(t("sidebar.all.filter"), "ml-1 h-6 min-w-0 flex-1 rounded-ctl border border-border bg-background px-2 text-meta outline-none placeholder:text-subtle focus:border-accent")}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 p-2">
              {searchField(t("sidebar.search"), "min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1 text-ui/[inherit] outline-none placeholder:text-subtle focus:border-accent")}
              {besideInfo}
            </div>
            {/* The abnormal-shutdown notice (dismissable); the entries are in the window bar (sidebar v5, design 040 §4.1). */}
            <RestoreBanner compact />
          </>
        )}
        <AllRowsCompact.Provider value={nowAll}>
        <ProjectDragContext.Provider value={projectDrag}>
        {/* The list's empty area: a menu with only 调整左侧栏… (rows and headers have their own menus). */}
        {/* IM-style rows (消息预览 on): a wider avatar column, shared by every row variant so names line up. */}
        <nav data-sidebar-roster={nowAll ? "all" : "roster"} data-system-rows={prefs.systemRows} data-separation={prefs.projectSeparation} data-roster-held={hold ? "" : undefined} {...presence.bind} className="flex-1 overflow-y-auto px-1.5 pt-1 pb-2" style={prefs.rowPreview === "off" && !nowAll ? undefined : ({ "--avatar-col": nowAll ? "20px" : "32px" } as CSSProperties)} onContextMenu={contextMenu(() => [...hostStopIdleEntries(t, <Power size={14} />), ...sidebarMenuTail(t)])}>
          <SidebarLoadProgress />
          {groups.length === 0 && chats.length === 0 && hostOnly.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-subtle">{focusAccess.pending ? t("users.access.pendingEmpty") : t("sidebar.empty")}</p>
          ) : (
            <>
              {layout.main.filter((l) => !trailing(l)).map((l) => (
                <LaidOutProject key={groupKey(l.group)} layout={l} dragKey={dragKeyOf(l.group, searching)} dragging={dragged === groupKey(l.group)} searching={searching} />
              ))}
              <OtherProjects layouts={layout.others} />
              {sectionLayouts.map(({ section, layouts, older }) => (
                <ProjectSection
                  key={section.id}
                  section={section}
                  layouts={layouts}
                  older={older}
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
              {/* Projects quiet for the 更早的项目 setting, at the bottom (design 060 §4). */}
              <OlderProjects layouts={layout.older} foldId={olderFoldId()} />
              {chats.length > 0 && <ChatsGroup rows={chats} />}
              {!searching && hostOnly.map((h) => <HostOnlyHeader key={h.look.id} look={h.look} state={h.state} />)}
            </>
          )}
        </nav>
        </ProjectDragContext.Provider>
        </AllRowsCompact.Provider>
        <UserLayoutOfflineItems />
        <UserLayoutStatus />
        <SidebarFooter />
    </>
  );

  return (
    <SidebarHostsContext.Provider value={hostsCtx}>
    <AttentionContext.Provider value={attentionSource}>
      {/* Collapsed: nothing in the layout at all — the edge hint, the hot zone and the popped overlay
          (components/SidebarPeek) draw outside the flow, so no pane's width moves. */}
      {collapsed && <SidebarPeek>{full}</SidebarPeek>}
      {/* 在主界面调整: the region the 调整左侧栏 panel adjusts (a faint outline while it is open, styles.css; no layout
          change); a right-click / press inside is remembered as the entry the focus returns to. */}
      {!collapsed && (
      <aside
        // Tips go beside the sidebar (design 040 §2.1): a project row's path never covers the rows it just opened.
        data-tip-beside=""
        data-resizable-pane
        data-customize-region="sidebar"
        tabIndex={-1}
        onContextMenuCapture={(e) => noteCustomizeOpener((e.target as Element).closest(FOCUSABLE) ?? e.currentTarget)}
        onPointerDownCapture={(e) => noteCustomizeOpener((e.target as Element).closest(FOCUSABLE) ?? e.currentTarget)}
        data-sidebar-mode="open"
        // A rounded card like the conversation / Shelf cards (styles.css .sidebar-card), 8 px from the window
        // edge and from the next card; min-width lives in the width (max()).
        className="sidebar-card relative flex h-full max-w-[calc(100%-360px)] w-[max(180px,var(--sidebar-w,16rem))] shrink-0 flex-col outline-none"
      >
        <PaneResizer field="sidebarWidth" edge="right" />
        {full}
      </aside>
      )}
    </AttentionContext.Provider>
    </SidebarHostsContext.Provider>
  );
}
