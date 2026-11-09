// What a user may do on a host, in words and as choices: shared by Settings → 用户 (modules/users) and
// 配对设备 → 邀请他人 (pure; test/users.test.ts).
import type { ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../shared/ipc";
import { shownUserName, type UserGrant, type UserRecord, type UsersRefusal } from "../../../shared/users";
import { byNameThenId, compareNames } from "./rosterOrder";

type T = (key: string, vars?: Record<string, string | number>) => string;

export const EMPTY_GRANT: UserGrant = { projects: [], standaloneAgents: [], send: false };

export interface GrantChoice {
  id: string;
  name: string;
}

/** Projects and standalone agents of the target host that a grant can name (active ones, by name). */
export function grantChoices(sidebar: SidebarSnapshot | null): { projects: GrantChoice[]; standalone: GrantChoice[] } {
  const projects = (sidebar?.projects?.projects ?? [])
    .filter((p: ProjectSummary) => p.lifecycle !== "archived")
    .map((p) => ({ id: p.project_id, name: p.presentation?.display_name || p.project_id }));
  const rows = sidebar?.hostRows ?? {};
  const standalone = (sidebar?.active ?? [])
    .filter((s: SessionResource) => !rows[s.cutexSessionId]?.projectId)
    .map((s) => ({ id: s.cutexSessionId, name: s.displayName || s.cutexSessionId }));
  const byName = byNameThenId<GrantChoice>((c) => c.name, (c) => c.id);
  return { projects: projects.sort(byName), standalone: standalone.sort(byName) };
}

export function toggleId(list: readonly string[], id: string, on: boolean): string[] {
  return on ? (list.includes(id) ? [...list] : [...list, id]) : list.filter((x) => x !== id);
}

/** "全部项目 · 1 个独立智能体 · 可发消息" — what a user's grant amounts to. */
export function grantSummary(grant: UserGrant | null, t: T, projects?: readonly GrantChoice[]): string {
  const g = grant ?? EMPTY_GRANT;
  const sep = t("users.summary.sep");
  const what: string[] = [];
  if (g.projects === "all") what.push(t("users.summary.all"));
  else if (g.projects.length) {
    // A few known projects by name; many, or one the host no longer lists: the count.
    const names = g.projects.map((id) => projects?.find((p) => p.id === id)?.name);
    what.push(names.length <= 3 && names.every(Boolean) ? names.join(sep) : t("users.summary.projects", { n: g.projects.length }));
  }
  if (g.standaloneAgents.length) what.push(t("users.summary.standalone", { n: g.standaloneAgents.length }));
  if (!what.length) return t("users.summary.nothing");
  return [t("users.summary.sees", { what: what.join(sep) }), t(g.send ? "users.summary.send" : "users.summary.readOnly"), t("users.summary.noManage")].join(" · ");
}

/** Owner first, then by the name shown (their own display name, else the owner's label). */
export function sortedUsers(users: readonly UserRecord[]): UserRecord[] {
  return [...users].sort((a, b) => (a.isOwner !== b.isOwner ? (a.isOwner ? -1 : 1) : compareNames(shownUserName(a), shownUserName(b))));
}

/**
 * A refused users write in our words (`userName`: the user a delete was refused for; `nameOf`: a user
 * id's shown name, for person_key_in_use).
 */
export function refusalText(error: UsersRefusal, t: T, userName?: string, nameOf?: (userId: string) => string): string {
  if (error.code === "user_in_use" && userName !== undefined) return t("users.inUse", { name: userName, devices: error.tokens?.length ?? 0, peers: error.peers?.length ?? 0 });
  if (error.code === "person_key_in_use") return t("users.error.person_key_in_use", { name: error.userId ? (nameOf?.(error.userId) ?? error.userId) : "?" });
  const known = ["owner_required", "owner_immutable", "user_in_use", "user_not_found"];
  return known.includes(error.code) ? t(`users.error.${error.code}`) : t("users.error.other", { message: error.message || error.code });
}

/** Longest user name cutex takes (`name`, 1–64 characters). */
export const USER_NAME_MAX = 64;
