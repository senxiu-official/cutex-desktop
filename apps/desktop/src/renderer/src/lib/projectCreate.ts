// Creating a cutex project (DESIGN §4.18). cutex with `project-optional-director` creates a project
// with an optional Director and its directory in one `create_project` mutation; older cutex needs a
// Director (an agent outside every project) and a separate `set_workspace_root`.
import type { ProjectsResponse } from "@cutex-desktop/protocol";
import type { DesktopApi, SidebarSnapshot } from "../../../shared/ipc";

/** cutex feature: projects exist without a Director (create_project / assign_director / clear_director). */
export const OPTIONAL_DIRECTOR_FEATURE = "project-optional-director";
/** cutex feature: create_project {create_workspace_root: true} creates a missing directory on the host. */
export const CREATE_ROOT_FEATURE = "project-create-workspace-root";

export const PROJECT_PALETTE = ["cyan", "blue", "green", "magenta", "yellow", "red"] as const;

/** cutex project ids: lowercase ascii, digits and dashes. */
export function slugifyProjectId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || `project-${Math.random().toString(36).slice(2, 8)}`;
}

/** Badge shown when the user typed none: the first two characters of the name. */
export function autoBadge(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

/** Agents that can become a Director: active, managed, and in no project. */
export function independentAgents(sidebar: SidebarSnapshot | null): { value: string; label: string }[] {
  const managed = sidebar?.projects?.available_agents;
  const free = (id: string) => !sidebar?.hostRows[id]?.projectId;
  return (sidebar?.active ?? [])
    .filter((s) => s.lifecycle !== "retired" && free(s.cutexSessionId))
    .filter((s) => !managed || managed.some((a) => a.cutex_session_id === s.cutexSessionId && !a.current_project_id))
    .map((s) => ({ value: s.cutexSessionId, label: s.displayName }));
}

/** Agents a Director can be assigned from: this project's members, or agents in no project. */
export function directorCandidates(sidebar: SidebarSnapshot | null, projectId: string): { id: string; name: string; joins: boolean }[] {
  return (sidebar?.active ?? [])
    .filter((s) => s.lifecycle !== "retired")
    .map((s) => ({ s, project: sidebar?.hostRows[s.cutexSessionId]?.projectId ?? null }))
    .filter(({ project }) => project === null || project === projectId)
    .map(({ s, project }) => ({ id: s.cutexSessionId, name: s.displayName, joins: project === null }))
    // Members first, then agents that would join.
    .sort((a, b) => Number(a.joins) - Number(b.joins));
}

export interface NewProjectSpec {
  id: string;
  presentation: { display_name: string; badge_label: string; color: string };
  /** Absolute directory, or null. */
  workspaceRoot: string | null;
  /** An agent in no project, or null (only with the optional-Director feature). */
  director: string | null;
  /** cutex creates a missing `workspaceRoot` (CREATE_ROOT_FEATURE; ignored without a directory). */
  createDirectory?: boolean;
}

/** The project exists, but its directory could not be set (older cutex: a second mutation). */
export class ProjectDirectoryError extends Error {
  constructor(readonly projectId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

/** Creates the project; on older cutex (no `optionalDirector`) a Director is required. */
export async function createProject(api: Pick<DesktopApi, "projectMutation">, spec: NewProjectSpec, optionalDirector: boolean): Promise<void> {
  const fresh = { authorityEpoch: 0, projectRevision: 0 };
  if (optionalDirector) {
    const create = spec.createDirectory && spec.workspaceRoot ? { create_workspace_root: true } : {};
    await api.projectMutation(spec.id, fresh, { kind: "create_project", presentation: spec.presentation, workspace_root: spec.workspaceRoot, director_cutex_session_id: spec.director, ...create });
    return;
  }
  if (!spec.director) throw new Error("director_required");
  await api.projectMutation(spec.id, fresh, { kind: "create", director_cutex_session_id: spec.director, presentation: spec.presentation });
  if (!spec.workspaceRoot) return;
  try {
    // A fresh project: authority epoch 1, revision 1.
    await api.projectMutation(spec.id, { authorityEpoch: 1, projectRevision: 1 }, { kind: "set_workspace_root", workspace_root: spec.workspaceRoot });
  } catch (e) {
    throw new ProjectDirectoryError(spec.id, e);
  }
}

// ---------- 「新项目…」 in the new-agent form: reuse / refuse an existing id, single flight ----------

/** cutex `create_project` refusal for an id that exists (also a removed project's tombstone):
 *  409 `conflict` with message "conflict: project_id_already_used". */
export function isProjectIdTakenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("project_id_already_used");
}

/** What to do with a new project's id on this host (`collection` = its project list). */
export type ExistingProjectChoice =
  | { kind: "create" }
  /** An empty project (no members, no Director) with the same display name: select it instead. */
  | { kind: "reuse"; projectId: string }
  /** The id is used by something else (members, another name, archived): ask for another name. */
  | { kind: "taken"; projectId: string };

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function existingProjectChoice(collection: ProjectsResponse | null | undefined, projectId: string, displayName: string): ExistingProjectChoice {
  const active = collection?.projects.find((p) => p.project_id === projectId);
  if (active) {
    const empty = active.active_member_count === 0 && !active.director_cutex_session_id && (active.lifecycle ?? "active") === "active";
    return empty && sameName(active.presentation.display_name, displayName) ? { kind: "reuse", projectId } : { kind: "taken", projectId };
  }
  if (collection?.archived_projects?.some((p) => p.project_id === projectId)) return { kind: "taken", projectId };
  return { kind: "create" };
}

/** The id is used on this host; `message` is cutex's text when it refused the create. */
export class ProjectNameTakenError extends Error {
  constructor(readonly projectId: string) {
    super(`project_id_already_used: ${projectId}`);
    this.name = "ProjectNameTakenError";
  }
}

export interface EnsureProjectDeps {
  /** The host's project list, freshly read (null: unknown / unsupported). */
  listProjects(): Promise<ProjectsResponse | null>;
  /** cutex `create_project`. */
  create(spec: NewProjectSpec): Promise<void>;
}

/** `created`: this call made it; `reused`: an empty project of the same name was already there. */
export interface EnsuredProject {
  projectId: string;
  outcome: "created" | "reused";
}

const inFlight = new Map<string, Promise<EnsuredProject>>();

/**
 * The project of 「新项目…」: reuses an empty same-name project, refuses an id used by another one,
 * else creates it. One call per host + id at a time: a second submit while the first is still
 * running (another form, a double submit) waits for the first instead of creating again. After a
 * failed or ambiguous create (duplicate, 503, transport error) the list is read again: a project that
 * did land is used, not created twice.
 */
export function ensureNewProject(deps: EnsureProjectDeps, hostId: string, spec: NewProjectSpec): Promise<EnsuredProject> {
  const key = `${hostId}\u0000${spec.id}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = (async (): Promise<EnsuredProject> => {
    const name = spec.presentation.display_name;
    const before = existingProjectChoice(await deps.listProjects(), spec.id, name);
    if (before.kind === "reuse") return { projectId: spec.id, outcome: "reused" };
    if (before.kind === "taken") throw new ProjectNameTakenError(spec.id);
    try {
      await deps.create(spec);
      return { projectId: spec.id, outcome: "created" };
    } catch (error) {
      const after = await deps.listProjects().then((c) => existingProjectChoice(c, spec.id, name), () => null);
      // The create landed although the reply said otherwise (or another submit made it meanwhile).
      if (after?.kind === "reuse") return { projectId: spec.id, outcome: isProjectIdTakenError(error) ? "reused" : "created" };
      if (after?.kind === "taken" || isProjectIdTakenError(error)) throw new ProjectNameTakenError(spec.id);
      throw error;
    }
  })();
  inFlight.set(key, run);
  void run.then(() => inFlight.delete(key), () => inFlight.delete(key));
  return run;
}

/** A project of the same name (or id) on another connected host: offer to switch there. */
export function sameProjectElsewhere(hosts: readonly { hostId: string; projects: ProjectsResponse | null | undefined }[], targetHost: string, name: string): { hostId: string; projectId: string; displayName: string } | null {
  if (!name.trim()) return null;
  const id = slugifyProjectId(name);
  for (const host of hosts) {
    if (host.hostId === targetHost) continue;
    const hit = host.projects?.projects.find((p) => sameName(p.presentation.display_name, name) || p.project_id === id);
    if (hit) return { hostId: host.hostId, projectId: hit.project_id, displayName: hit.presentation.display_name || hit.project_id };
  }
  return null;
}
