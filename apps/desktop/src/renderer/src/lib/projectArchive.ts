// 归档项目 + 主管 (owner 2026-10-11: "归档项目的时候连着director一起归档"). Desktop orchestration over
// existing daemon calls only: the project mutation `archive` / `restore` and the session retire /
// restore the agent menu and Settings → 归档 use (lib/menus.tsx `retireAgent` / `restoreArchived`).
//
// Archive: the project first; once that succeeded and the owner kept 「同时归档主管」 checked, the
// Director is retired. A failed retire never rolls the project back: a notice says the project is
// archived but the Director is not, with a retry. Other members stay as they are.
//
// Restore: restoring an archived agent whose project is archived restores the project first
// (lib/archivedAgent.ts). When that project's Director is archived too (and is not the agent being
// restored) the owner is offered 「同时恢复主管」. cutex keeps an archived project's Director in its
// summary (`director_cutex_session_id`); the id remembered at archive time (prefs `projectDirectors`,
// device-local, keyed by hostKey(hostId, projectId)) is the fallback; unknown → no option.
//
// Every call goes to the project's host (multi-host: not the focus host).
import type { SessionResource } from "@cutex-desktop/protocol";
import type { MessageKey } from "../i18n";
import { hostApi, sidebarOf, useApp, viewHostOf } from "../store";
import { confirmDialog, promptDialog, type DialogCheck } from "./contextMenu";
import { ownedServicesNote, restoreArchived, retireAgent } from "./menus";
import { archivedProjectOf } from "./archivedAgent";
import { getUiPrefs, setProjectDirector } from "./prefs";
import { hostKey } from "./hostKeys";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The 「同时归档主管」 box: checked by default, with the agent menu's archive warnings below it. */
export function directorArchiveCheck(director: SessionResource, t: T, hostId: string): DialogCheck {
  const detail = [director.runtime.activeTurnId ? t("projects.archiveDirectorBusy") : "", ownedServicesNote(director.cutexSessionId, t, hostId), t("projects.archiveOthersStay")].filter(Boolean).join("\n");
  return { label: t("projects.archiveWithDirector", { name: director.displayName }), detail, checked: true };
}

export interface ArchiveConfirm {
  /** Archive the project. */
  ok: boolean;
  /** The typed name did not match (nothing archived). */
  mismatch: boolean;
  /** Retire the Director afterwards. */
  withDirector: boolean;
}

/** The archive confirmation: a plain confirm for an empty project, else type its name; plus the Director box. */
export async function confirmProjectArchive(o: { displayName: string; memberCount: number; director: SessionResource | null; hostId: string; t: T }): Promise<ArchiveConfirm> {
  const { t } = o;
  const check = o.director ? directorArchiveCheck(o.director, t, o.hostId) : undefined;
  if (o.memberCount === 0) {
    const ok = await confirmDialog(t("projects.archiveConfirm", { name: o.displayName }), true, undefined, check);
    return { ok, mismatch: false, withDirector: ok && !!check?.checked };
  }
  const typed = await promptDialog(t("projects.archiveTypeName", { name: o.displayName, n: o.memberCount }), "", { placeholder: o.displayName, check });
  if (typed === null) return { ok: false, mismatch: false, withDirector: false };
  if (typed.trim() !== o.displayName) return { ok: false, mismatch: true, withDirector: false };
  return { ok: true, mismatch: false, withDirector: !!check?.checked };
}

/**
 * Archive `projectId` on `hostId`, then (withDirector) its Director. Throws only when the project
 * mutation fails (nothing else happened then). Returns whether the Director ended up archived
 * (false: not asked, already gone, or the owner gave up retrying).
 */
export async function archiveProject(o: {
  hostId: string;
  projectId: string;
  displayName: string;
  expected: { authorityEpoch: number; projectRevision: number };
  directorId: string | null;
  withDirector: boolean;
  t: T;
}): Promise<boolean> {
  await hostApi(o.hostId).projectMutation(o.projectId, o.expected, { kind: "archive" });
  const directorId = o.withDirector ? o.directorId : null;
  if (directorId) setProjectDirector(o.hostId, o.projectId, directorId);
  await useApp.getState().refreshHostSidebar(o.hostId);
  if (!directorId) return false;
  return retireProjectDirector(o.hostId, directorId, o.displayName, o.t);
}

/** Retire the Director (fresh resource each try); on failure offer a retry, never undo the project. */
export async function retireProjectDirector(hostId: string, directorId: string, projectName: string, t: T): Promise<boolean> {
  for (;;) {
    const director = sidebarOf(useApp.getState(), hostId)?.active.find((s) => s.cutexSessionId === directorId);
    if (!director) return false;
    try {
      await retireAgent(director, t, hostId);
      return true;
    } catch (e) {
      const retry = await confirmDialog(t("projects.archiveDirectorFailed", { project: projectName, name: director.displayName, error: errorText(e) }), false, { ok: t("projects.archiveDirectorRetry"), cancel: t("projects.archiveDirectorLater") });
      if (!retry) return false;
      await useApp.getState().refreshHostSidebar(hostId);
    }
  }
}

export interface ArchivedDirector {
  project: { id: string; name: string };
  director: SessionResource;
}

/**
 * The archived Director of `session`'s archived project, other than `session` itself (null: the
 * project is not archived, no Director is known, it is `session`, or it is not archived).
 */
export function archivedDirectorOf(session: SessionResource, hostId: string): ArchivedDirector | null {
  const sidebar = sidebarOf(useApp.getState(), hostId);
  const project = archivedProjectOf(session, sidebar?.projects);
  if (!project) return null;
  const summary = sidebar?.projects?.archived_projects?.find((p) => p.project_id === project.id);
  const directorId = summary?.director_cutex_session_id || getUiPrefs().projectDirectors[hostKey(hostId, project.id)] || null;
  if (!directorId || directorId === session.cutexSessionId) return null;
  const director = sidebar?.retired.find((s) => s.cutexSessionId === directorId);
  return director ? { project: { id: project.id, name: project.name }, director } : null;
}

/**
 * Restore an archived agent with its archived project (restoreArchived), offering 「同时恢复主管」
 * when that project's Director is archived too. false: cancelled.
 */
export async function restoreWithDirector(session: SessionResource, t: T, hostId = viewHostOf(session.cutexSessionId)): Promise<boolean> {
  const found = archivedDirectorOf(session, hostId);
  const own = archivedProjectOf(session, sidebarOf(useApp.getState(), hostId)?.projects);
  if (!found) {
    await restoreArchived(session, true, hostId);
    // Restoring the Director itself brings its project back: the remembered id is no longer needed.
    if (own && getUiPrefs().projectDirectors[hostKey(hostId, own.id)] === session.cutexSessionId) setProjectDirector(hostId, own.id, null);
    return true;
  }
  const check: DialogCheck = { label: t("archive.restoreDirector", { name: found.director.displayName }), checked: true };
  const ok = await confirmDialog(t("archive.restoreProjectConfirm", { name: session.displayName, project: found.project.name }), false, { ok: t("archive.row.restore"), cancel: t("dialog.cancel") }, check);
  if (!ok) return false;
  await restoreArchived(session, true, hostId);
  if (!check.checked) return true;
  await restoreArchived(found.director, false, hostId);
  setProjectDirector(hostId, found.project.id, null);
  return true;
}
