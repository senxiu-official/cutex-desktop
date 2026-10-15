// Settings → Profile → 删除 refused with `profile_in_use`: cutex counts every session record that is
// configured on the profile or whose bound runtime was launched on it — archived ones too, and also
// records the desktop never lists (hidden sessions, temporary ones, other hosts: GET /v2/sessions
// leaves them out). Those can't be opened (select() would show an empty conversation), only deleted
// by id (cutex/session/delete resolves hidden ones too; its revision fence is optional).
// cutex `profile-delete-detach-archived`: only this host's agents count, and archived ones need not
// be deleted (an archived project member can't be: session_referenced) — DELETE ?archived=detach
// clears their profile (a restore uses the default profile) and deletes the profile.
import type { SessionResource } from "@cutex-desktop/protocol";
import type { CutexRefusal } from "../../../shared/ipc";
import type { MessageKey } from "../i18n";

export interface ProfileRef {
  id: string;
  name: string;
  /** Archived: from the desktop's lists when it has the agent, else cutex's `lifecycle`. */
  archived: boolean;
  /** The desktop's resource; null = not in its lists (can't be opened). */
  session: SessionResource | null;
}

/** cutex feature: DELETE /v2/profiles/{p}?archived=detach. */
export const PROFILE_DETACH_ARCHIVED_FEATURE = "profile-delete-detach-archived";

export interface DeleteProfileOptions {
  archived?: "detach";
}

type Lists = { active: readonly SessionResource[]; retired: readonly SessionResource[] } | null | undefined;

/**
 * The refusal's agents minus the ones deleted since (`gone`): in-use first, then archived; within
 * each, the ones the desktop lists first, then by name.
 */
export function profileRefs(refused: CutexRefusal["sessions"], lists: Lists, gone: ReadonlySet<string> = new Set()): ProfileRef[] {
  const active = new Map((lists?.active ?? []).map((s) => [s.cutexSessionId, s]));
  const retired = new Map((lists?.retired ?? []).map((s) => [s.cutexSessionId, s]));
  const refs = new Map<string, ProfileRef>();
  for (const r of refused ?? []) {
    const id = r.cutexSessionId;
    if (!id || gone.has(id) || refs.has(id)) continue;
    const session = active.get(id) ?? retired.get(id) ?? null;
    refs.set(id, { id, name: session?.displayName || r.displayName || id, archived: session ? retired.has(id) : r.lifecycle === "retired", session });
  }
  const rank = (r: ProfileRef) => (r.archived ? 2 : 0) + (r.session ? 0 : 1);
  return [...refs.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/**
 * The line above the rows: none left, archived among them, and whether agents can be deleted here.
 * With `canDetach` archived agents don't block: only archived left → they can be moved off with the
 * delete; active ones too → only those have to go.
 */
export function profileInUseMessage(refs: readonly ProfileRef[], canDelete: boolean, canDetach = false): MessageKey {
  if (refs.length === 0) return "settings.profile.refs.cleared";
  const archived = refs.some((r) => r.archived);
  if (canDetach && archived) return refs.every((r) => r.archived) ? "settings.profile.refs.onlyArchived" : "settings.profile.refs.activeDetach";
  if (!canDelete) return archived ? "settings.profile.refs.archivedNoDelete" : "settings.profile.refs.activeNoDelete";
  return archived ? "settings.profile.refs.archived" : "settings.profile.refs.active";
}

/** {n} in the line above the rows: with `canDetach` and active agents left, only those count. */
export function profileInUseCount(refs: readonly ProfileRef[], canDetach = false): number {
  return canDetach && refs.some((r) => !r.archived) ? refs.filter((r) => !r.archived).length : refs.length;
}

/** 删除 + move the archived ones to the default profile: offered when only archived agents are left. */
export function canDetachArchived(refs: readonly ProfileRef[], canDetach: boolean): boolean {
  return canDetach && refs.length > 0 && refs.every((r) => r.archived);
}

/** 删除这 N 个已归档的: offered for two or more archived agents, when the host can delete agents. */
export function bulkArchivedRefs(refs: readonly ProfileRef[], canDelete: boolean): ProfileRef[] {
  const archived = refs.filter((r) => r.archived);
  return canDelete && archived.length >= 2 ? archived : [];
}
