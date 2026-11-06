// Project services (cutex r267 `services-project-scope`; .claude/previews/project-services-proposal-20261028.md):
// a service's `ownerScope` says who manages it — `session` (absent on older hosts, and any value this
// desktop does not know): its registrant only; `project`: also the project's current Director. cutex
// decides who may manage; the desktop only shows the scope, sends the owner's switch and lists the
// 「认领候选」 of a project. Pure (no React / bridge), shared by the services page, the service menu and
// the project views.
import type { ProjectSummary } from "@cutex-desktop/protocol";
import type { ServicePatch, ServiceView, SidebarSnapshot } from "../../../shared/ipc";

export type ServiceScope = "session" | "project";

/** Missing (older hosts) or unknown = session: never widen who manages it. */
export function serviceScope(s: Pick<ServiceView, "ownerScope">): ServiceScope {
  return s.ownerScope === "project" ? "project" : "session";
}

/** Whether this view may run manage actions: only agent views carry `youMayManage`; the owner's list manages all. */
export function serviceMayManage(s: Pick<ServiceView, "youMayManage">): boolean {
  return s.youMayManage !== false;
}

/**
 * The owner's PATCH that switches a service's scope. To project: `projectId` only when the record has
 * none (cutex refuses a project service without one; `projectId` = the project the owner picked);
 * back to session: just the scope (cutex keeps the projectId for visibility). null = nothing to send.
 */
export function scopePatch(s: Pick<ServiceView, "ownerScope" | "projectId">, to: ServiceScope, projectId?: string | null): ServicePatch | null {
  if (serviceScope(s) === to) return null;
  if (to === "session") return { ownerScope: "session" };
  if (s.projectId) return { ownerScope: "project" };
  return projectId ? { ownerScope: "project", projectId } : null;
}

/** The project a registrant belongs to on that host (the default pick when a record has no projectId). */
export function registrantProject(s: Pick<ServiceView, "ownerCutexSessionId">, sidebar: SidebarSnapshot | null | undefined): string | null {
  const id = s.ownerCutexSessionId;
  return (id && sidebar?.hostRows?.[id]?.projectId) || null;
}

/** The projects a service without a projectId can be claimed into: the registrant's project first, then sidebar order. */
export function claimProjectChoices(s: Pick<ServiceView, "ownerCutexSessionId">, sidebar: SidebarSnapshot | null | undefined): { project: ProjectSummary; registrants: boolean }[] {
  const projects = sidebar?.projects?.projects ?? [];
  const own = registrantProject(s, sidebar);
  return [...projects]
    .sort((a, b) => Number(b.project_id === own) - Number(a.project_id === own))
    .map((project) => ({ project, registrants: project.project_id === own }));
}

/** Why a session service of a project is a claim candidate. */
export type ClaimReason = "formerDirector" | "archived" | "left" | "noRegistrant";

export interface ClaimCandidate {
  service: ServiceView;
  reason: ClaimReason;
}

/**
 * 认领候选 of one project: its own (`projectId`) session-scope services, not archived, whose registrant is
 * no longer someone who should hold it alone — cleared / unknown to the host, archived, no longer a member
 * of the project, or a former Director (`formerDirectors`: the old Directors of its finalized changes,
 * when known). The current Director's own services and those of current members are not candidates.
 */
export function claimCandidates(
  services: readonly ServiceView[] | null | undefined,
  projectId: string,
  sidebar: SidebarSnapshot | null | undefined,
  formerDirectors: ReadonlySet<string> = new Set(),
): ClaimCandidate[] {
  if (!sidebar) return [];
  const director = sidebar.projects?.projects.find((p) => p.project_id === projectId)?.director_cutex_session_id ?? null;
  const active = new Set(sidebar.active.map((s) => s.cutexSessionId));
  const retired = new Set(sidebar.retired.map((s) => s.cutexSessionId));
  const out: ClaimCandidate[] = [];
  for (const service of services ?? []) {
    if (service.projectId !== projectId || serviceScope(service) !== "session" || service.archived) continue;
    const id = service.ownerCutexSessionId;
    if (id && id === director) continue;
    // Not active while the archived agents are not read yet: archived or gone is not known.
    if (id && sidebar.archivedPending && !active.has(id)) continue;
    const reason: ClaimReason | null = !id
      ? "noRegistrant"
      : retired.has(id)
        ? "archived"
        : !active.has(id)
          ? (formerDirectors.has(id) ? "formerDirector" : "noRegistrant")
          : formerDirectors.has(id)
            ? "formerDirector"
            : sidebar.hostRows?.[id]?.projectId !== projectId
              ? "left"
              : null;
    if (reason) out.push({ service, reason });
  }
  return out.sort((a, b) => (a.service.displayName || a.service.slug).localeCompare(b.service.displayName || b.service.slug));
}

/** Old Directors of a project's settled changes (the 项目交接 notices), for {@link claimCandidates}. */
export function formerDirectorsOf(changes: readonly { state: string; oldDirector: string | null; newDirector: string | null }[] | null | undefined, current: string | null): Set<string> {
  const out = new Set<string>();
  for (const c of changes ?? []) if (c.state === "finalized" && c.oldDirector && c.oldDirector !== c.newDirector && c.oldDirector !== current) out.add(c.oldDirector);
  return out;
}

/** Host-feed method announcing a settled Director change (cutex methods schema `projectDirectorChanged`). */
export const DIRECTOR_CHANGED_EVENT = "cutex/project/directorChanged";

/** `cutex/project/directorChanged` params (open: other fields pass through). */
export interface ProjectDirectorChangedParams {
  schema?: "cutex/project-director-changed/v1";
  changeId?: string;
  projectId: string;
  /**
   * r267 `services-project-scope`: that project's project-scope services (the new Director manages them
   * now); null when cutex could not read its registry; absent on older hosts.
   */
  projectServiceCount?: number | null;
  [key: string]: unknown;
}

/** The project-service count of a directorChanged params object; null when absent, unknown (null) or malformed. */
export function directorChangedServiceCount(params: unknown): number | null {
  const n = (params as { projectServiceCount?: unknown } | null | undefined)?.projectServiceCount;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}
