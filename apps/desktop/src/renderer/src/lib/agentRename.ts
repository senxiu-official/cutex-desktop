// 自己的名字 rename in 编辑信息… (components/AgentOwnName.tsx): owner-only, cutex formal-agent-name-rename-v1.
// One request per attempt; an uncertain answer (no reply, 503) may only be sent again unchanged (same
// requestId, revision and name: cutex replays the stored outcome, never renames twice). A definitive refusal
// ends that request; stale_session_revision re-reads the session so 重试 sends a fresh one. On success the
// session resource is applied under the same host + session ID (tabs, Shelf, bookmarks stay) and the
// sidebar is read again; displayNameOverride is cutex's to keep, never touched here.
import type { SessionResource } from "@cutex-desktop/protocol";
import { canRenameFormal, formalNameProblem, restoreNameBlock, type RestoreNameBlock, type RenameTarget, type FormalRenameError, type FormalRenameRequest, type FormalRenameResult, type NameHistoryPage } from "../../../shared/agentRename";
import { translate } from "../i18n";
import { featuresOf, hostApi, sidebarOf, useApp } from "../store";

export { canRenameFormal };

export function renameOffered(host: string, session: RenameTarget): boolean {
  return canRenameFormal(featuresOf(useApp.getState(), host), session);
}

export function newRenameRequest(session: Pick<SessionResource, "revision">, name: string): FormalRenameRequest {
  return { requestId: `rename-${crypto.randomUUID()}`, expectedRevision: session.revision, name: name.trim() };
}

export { formalNameProblem };

export type RenameOutcome =
  | { ok: true; oldName: string; newName: string; session: SessionResource | null }
  | { ok: false; error: FormalRenameError; request: FormalRenameRequest; fresh: SessionResource | null };

/** Sends `request` (a new one, or the same one again after an uncertain answer). */
export async function sendRename(host: string, id: string, request: FormalRenameRequest): Promise<RenameOutcome> {
  const result: FormalRenameResult = await hostApi(host).renameFormalAgent(id, request);
  const app = useApp.getState();
  if (result.ok) {
    if (result.session && result.session.cutexSessionId === id) app.patchSessionResource(id, host, result.session);
    // A null session (hydration unavailable) or a replay describing a later state: read it again.
    await app.refreshHostSidebar(host).catch(() => undefined);
    return { ok: true, oldName: result.event.oldName, newName: result.event.newName, session: sessionOf(host, id) ?? result.session };
  }
  let fresh: SessionResource | null = null;
  if (result.error.code === "stale_session_revision" || result.error.code === "agent_name_unchanged") {
    await app.refreshHostSidebar(host).catch(() => undefined);
    fresh = sessionOf(host, id);
  }
  return { ok: false, error: result.error, request, fresh };
}

export function nameHistory(host: string, id: string, before: number | null): Promise<NameHistoryPage> {
  return hostApi(host).formalNameHistory(id, before);
}

export function sessionOf(host: string, id: string): SessionResource | null {
  const sidebar = sidebarOf(useApp.getState(), host);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === id) ?? null;
}

/** Shown names of the conflicting holders (IDs when they are not in this host's lists). */
export function holderNames(host: string, ids: readonly string[] | undefined): string[] {
  return (ids ?? []).map((id) => sessionOf(host, id)?.displayName || id);
}

/** Project display name of a history scope (the ID when the project is gone). */
export function scopeProjectName(host: string, projectId: string): string {
  const projects = sidebarOf(useApp.getState(), host)?.projects?.projects ?? [];
  return projects.find((x) => x.project_id === projectId)?.presentation.display_name || projectId;
}

/**
 * 恢复 refused because the agent's own name is another agent's now (shared/agentRename restoreNameBlock): the
 * plain-words message names whose it is; callers offer 改名… (编辑信息…), since an archived agent can be renamed.
 */
export class RestoreNameError extends Error {
  constructor(readonly host: string, readonly session: SessionResource, readonly block: RestoreNameBlock) {
    const names = holderNames(host, block.holderSessionIds);
    super(translate(block.code === "agent_name_reserved" ? "rename.restoreBlocked.reserved" : "rename.restoreBlocked.conflict", {
      name: session.formalAgentName?.trim() || session.displayName,
      holders: names.length ? translate("rename.holders", { names: names.join("、") }) : "",
    }));
    this.name = "RestoreNameError";
  }
}

/** The restore refusal as a RestoreNameError, or the error unchanged. */
export function restoreError(error: unknown, host: string, session: SessionResource): unknown {
  const block = restoreNameBlock(error);
  return block ? new RestoreNameError(host, session, block) : error;
}
