// The 项目 page's rows (projectTable.ts) from what the app already has: each host's sidebar (the merged scoped model,
// as the sidebar draws it) and its attention signals (需要你), plus cutex's own figures where the host offers them.
import { useMemo } from "react";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { featuresOf, useApp } from "../../store";
import { hostKey } from "../../lib/hostKeys";
import { useScopedAttention, useScopedSidebar } from "../../lib/scopedSidebarView";
import type { AgentRow, ProjectGroup } from "../../lib/sidebar";
import { PROJECT_TABLE_SUMMARY_FEATURE, projectFacts, type HostRows, type ProjectFacts } from "./projectTable";

/** A project of one host (active or archived). */
export interface HostProjectRef {
  hostId: string;
  project: ProjectSummary;
  archived: boolean;
}

export function useProjectFacts(projects: readonly HostProjectRef[]): ProjectFacts[] {
  const scoped = useScopedSidebar();
  const attention = useScopedAttention(scoped.model, scoped.scope);
  const byHost = useApp((s) => s.byHost);
  const features = useApp((s) => s.features);
  const hostsState = useApp((s) => s.hosts);
  return useMemo(() => {
    const rowsOf = new Map<string, HostRows>();
    const hostRows = (hostId: string): HostRows => {
      const have = rowsOf.get(hostId);
      if (have) return have;
      const host = scoped.hosts.find((h) => h.look.id === hostId);
      const byProject = new Map<string, { online: readonly AgentRow[]; offline: readonly AgentRow[] }>();
      for (const g of scoped.model.groups) if (g.kind === "project" && (g.hostId ?? scoped.scope.focus) === hostId) byProject.set((g as ProjectGroup).id, { online: g.online, offline: g.offline });
      const rows: HostRows = {
        // Counted only from a reachable host's rows: an unreachable host's last rows are history, not its figures.
        known: !!host && host.state !== "offline" && host.hasRows,
        reachable: !!host && host.state !== "offline",
        byProject,
        needsYou: (row) => attention.signals.get(row.key ?? hostKey(hostId, row.id)) === "needsYou",
        summaryFields: featuresOf({ hosts: hostsState, sidebar: null, byHost, features }, hostId).has(PROJECT_TABLE_SUMMARY_FEATURE),
      };
      rowsOf.set(hostId, rows);
      return rows;
    };
    return projects.map((p) => projectFacts(p.hostId, hostKey(p.hostId, p.project.project_id), p.project, p.archived, hostRows(p.hostId)));
  }, [projects, scoped, attention, byHost, features, hostsState]);
}
