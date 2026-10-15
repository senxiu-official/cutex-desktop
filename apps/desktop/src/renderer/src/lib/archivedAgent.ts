// Archived (retired) agents: read-only history, and restoring them in the right order.
//
// cutex serves an archived session's stored thread through `GET /v2/sessions/{id}/history`
// (capability offline-history; the read-only offline reader also opens retired sessions), while
// `/bootstrap` and the event feed only know active sessions. So an archived agent is shown from the
// history endpoint alone, without a subscription, and is reloaded when it is archived or restored
// while selected (lifecycleFlip).
//
// Restore: `cutex/session/restore` does not look at the agent's project. When that project is
// archived too, the restored agent would sit in an archived project, so the project is restored
// first (project mutation `restore`), then the agent.
import type { ProjectsResponse, SessionResource } from "@cutex-desktop/protocol";

/** The parts of a sidebar snapshot these helpers read. */
interface Lifecycles {
  active: readonly SessionResource[];
  retired: readonly SessionResource[];
}

export function isArchived(session: Pick<SessionResource, "lifecycle"> | null | undefined): boolean {
  return session?.lifecycle === "retired";
}

/**
 * The selected agent moved between active and archived from one snapshot to the next: "archived"
 * (now only in `retired`), "restored" (now only in `active`); null when unchanged, unknown or gone.
 */
export function lifecycleFlip(before: Lifecycles | null | undefined, after: Lifecycles, id: string | null): "archived" | "restored" | null {
  if (!id || !before) return null;
  const was = before.retired.some((s) => s.cutexSessionId === id) ? "retired" : before.active.some((s) => s.cutexSessionId === id) ? "active" : null;
  const now = after.retired.some((s) => s.cutexSessionId === id) ? "retired" : after.active.some((s) => s.cutexSessionId === id) ? "active" : null;
  if (!was || !now || was === now) return null;
  return now === "retired" ? "archived" : "restored";
}

export interface ArchivedProject {
  id: string;
  name: string;
  /** CAS for the project `restore` mutation. */
  expected: { authorityEpoch: number; projectRevision: number };
}

/** cutex annotates archived sessions with their project (`projectId`, `projectName`; absent = unknown). */
export function projectOfArchived(session: SessionResource): { id: string; name: string | null } | null {
  const s = session as SessionResource & { projectId?: string | null; projectName?: string | null };
  return s.projectId ? { id: s.projectId, name: s.projectName ?? null } : null;
}

/** The agent's project when that project is archived too (it then has to be restored first). */
export function archivedProjectOf(session: SessionResource, projects: ProjectsResponse | null | undefined): ArchivedProject | null {
  const own = projectOfArchived(session);
  if (!own) return null;
  const p = (projects?.archived_projects ?? []).find((x) => x.project_id === own.id);
  if (!p) return null;
  return { id: p.project_id, name: p.presentation.display_name || own.name || p.project_id, expected: { authorityEpoch: p.authority_epoch, projectRevision: p.project_revision ?? 0 } };
}
