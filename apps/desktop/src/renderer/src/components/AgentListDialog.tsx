// 全部 agent dialog for one sidebar group (a project or 独立 agent): opened from the sidebar's
// 离线 divider / 还有 N 个 / the project header menu. The list itself is AgentList.
import { useEffect, useMemo, useRef } from "react";
import { ChevronDown, X } from "lucide-react";
import { useI18n } from "../i18n";
import { INDEPENDENT_GROUP, type AgentListTab } from "../lib/agentList";
import { closeAgentList, openAgentList, useAgentListDialog } from "../lib/agentListDialog";
import { openMenuFrom, useOverlayState, type MenuEntry } from "../lib/contextMenu";
import { useTrackOverlay } from "../lib/openOverlays";
import { orderGroups } from "../lib/sidebar";
import { projectIcon, type ProjectIconChoice } from "../lib/projectIcons";
import { useUiPrefs } from "../lib/prefs";
import { useSidebarModel } from "../lib/sidebarView";
import { sidebarOf, useApp } from "../store";
import { TargetHostContext } from "../lib/targetHost";
import { useHostScope } from "../lib/useHostScope";
import { HostMark } from "./HostMark";
import { ProjectBadge } from "./ProjectBadge";
import { AgentList } from "./AgentList";

interface GroupChoice {
  id: string;
  /** The group's host (the dialog lists every host of the scope; multi-host P1). */
  hostId: string;
  name: string;
  badge: string | null;
  color: string | null;
  icon: ProjectIconChoice | null;
  offline: number;
}

function Badge({ g }: { g: GroupChoice }) {
  if (!g.color) return null;
  return <ProjectBadge icon={g.icon} badge={g.badge || g.name.slice(0, 1)} color={g.color} />;
}

function Dialog({ groupId, tab, hostId }: { groupId: string; tab: AgentListTab; hostId: string }) {
  const { t } = useI18n();
  // The dialog's own host (TargetHostContext below): its rows and offline counts.
  const model = useSidebarModel();
  const scope = useHostScope();
  const hostsState = useApp((s) => s.hosts);
  const sidebar = useApp((s) => s.sidebar);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  const projectOrder = useUiPrefs().projectOrder;
  const icons = useUiPrefs().projectIcons;
  const overlay = useOverlayState();
  const overlayOpen = useRef(false);
  overlayOpen.current = !!(overlay.menu || overlay.dialog);
  useTrackOverlay(true);

  // Esc closes — unless a menu / confirmation above the dialog takes it. Capture phase: runs
  // before those overlays' own handlers close themselves, and keeps Esc from the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || overlayOpen.current) return;
      e.preventDefault();
      e.stopPropagation();
      closeAgentList();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Per host of the scope (switcher order): every project (also one whose agents are all archived) in
  // sidebar order, then 独立 agent. Offline counts are the dialog host's (its model).
  const groups = useMemo<GroupChoice[]>(() => {
    const source = { hosts: hostsState, sidebar, byHost, features };
    const offline = new Map(model.groups.map((g) => [g.id, g.offline.length]));
    const hostIds = scope.hostsInScope.map((h) => h.id);
    if (!hostIds.includes(hostId)) hostIds.unshift(hostId);
    return hostIds.flatMap((host) => {
      const own = host === hostId;
      const snapshot = sidebarOf(source, host);
      if (!snapshot && !own) return [];
      const count = (id: string) => (own ? (offline.get(id) ?? 0) : 0);
      const listed = own ? orderGroups(model.groups, projectOrder).filter((g) => g.kind === "project") : [];
      const ids = [...listed.map((g) => g.id), ...(snapshot?.projects?.projects ?? []).map((p) => p.project_id).filter((id) => !listed.some((g) => g.id === id))];
      const projects = ids.map((id) => {
        const p = snapshot?.projects?.projects.find((x) => x.project_id === id);
        const g = own ? model.groups.find((x) => x.id === id) : undefined;
        return {
          id,
          hostId: host,
          name: p?.presentation.display_name || (g?.kind === "project" ? g.name : id),
          badge: p?.presentation.badge_label ?? (g?.kind === "project" ? g.badge : null),
          color: p?.presentation.color ?? (g?.kind === "project" ? g.color : "blue"),
          icon: projectIcon(icons, host, id),
          offline: count(id),
        };
      });
      return [...projects, { id: INDEPENDENT_GROUP, hostId: host, name: t("sidebar.independent"), badge: null, color: null, icon: null, offline: count(INDEPENDENT_GROUP) }];
    });
  }, [model.groups, projectOrder, icons, hostsState, sidebar, byHost, features, scope.hostsInScope, hostId, t]);
  const current = groups.find((g) => g.id === groupId && g.hostId === hostId) ?? { id: groupId, hostId, name: groupId, badge: null, color: null, icon: null, offline: 0 };
  const marks = scope.showHostMarks;
  const look = (id: string) => scope.host(id);
  const choice = (g: GroupChoice): MenuEntry => ({
    label: g.name,
    icon: <Badge g={g} />,
    hint: g.id === groupId && g.hostId === hostId ? "✓" : g.offline ? String(g.offline) : undefined,
    onSelect: () => openAgentList(g.id, "offline", g.hostId === scope.focus ? undefined : g.hostId),
  });
  // Several hosts: one labelled section per host (its mark + name), else the plain list.
  const menu = (): MenuEntry[] =>
    marks
      ? [...new Set(groups.map((g) => g.hostId))].flatMap((host, i) => [
          i > 0 && "separator",
          { label: look(host)?.label ?? host, icon: look(host) ? <HostMark host={look(host)!} dotOnly /> : undefined, note: true, disabled: true, onSelect: () => {} },
          ...groups.filter((g) => g.hostId === host).map(choice),
        ])
      : groups.map(choice);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-[7vh]" onMouseDown={(e) => e.target === e.currentTarget && closeAgentList()}>
      <div role="dialog" aria-modal aria-label={t("agents.title")} className="flex h-[min(82vh,46rem)] w-[52rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <AgentList
          groupId={groupId}
          initialTab={tab}
          variant="dialog"
          autoFocus
          onOpened={closeAgentList}
          renderHeader={(tabs) => (
            <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
              <button
                title={t("agents.switchGroup")}
                onClick={(e) =>
                  openMenuFrom(e.currentTarget, menu())
                }
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-2"
              >
                {marks && look(hostId) && <HostMark host={look(hostId)!} dotOnly />}
                <Badge g={current} />
                <span className="truncate text-sm font-semibold">{current.name}</span>
                <span className="shrink-0 text-xs text-subtle">· {t("agents.title")}</span>
                <ChevronDown size={14} className="shrink-0 text-subtle" />
              </button>
              {tabs}
              <button title={t("agents.close")} onClick={closeAgentList} className="ml-auto shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
                <X size={16} />
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}

export function AgentListDialog() {
  const state = useAgentListDialog();
  // A new group starts a fresh list (selection, progress, filters).
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const hostId = state?.hostId ?? focus;
  if (!state) return null;
  // The list acts on the group's host (lib/targetHost: its sidebar, api, agent menu, open in place).
  return (
    <TargetHostContext.Provider value={hostId}>
      <Dialog key={`${hostId}|${state.groupId}`} groupId={state.groupId} tab={state.tab} hostId={hostId} />
    </TargetHostContext.Provider>
  );
}
