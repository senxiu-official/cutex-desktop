// Pure helpers of Settings → 用户 (no React / store): grant summaries, the grant editor's draft, what
// the target host offers to grant, and refusal texts.
import type { ProjectSummary, SessionResource } from "@cutex-desktop/protocol";
import type { SidebarSnapshot } from "../../../../shared/ipc";
import { clientTokenName } from "../../lib/deviceNames";
export { selfKeyUnknown, withPersonKey } from "../../lib/personKeys";
import { shownUserName, type PersonKeyInput, type UserTokenRecord, type UserGrant, type UserRecord, type UsersList, type UsersRefusal, type UsersResult } from "../../../../shared/users";

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
  const byName = (a: GrantChoice, b: GrantChoice) => a.name.localeCompare(b.name);
  return { projects: projects.sort(byName), standalone: standalone.sort(byName) };
}

/** Ids a grant names that the host no longer lists (kept on save: they may come back). */
export function unknownIds(ids: readonly string[], choices: readonly GrantChoice[]): string[] {
  const known = new Set(choices.map((c) => c.id));
  return ids.filter((id) => !known.has(id));
}

export function sameGrant(a: UserGrant, b: UserGrant): boolean {
  const list = (v: UserGrant["projects"]) => (v === "all" ? "all" : [...v].sort().join("\n"));
  return list(a.projects) === list(b.projects) && [...a.standaloneAgents].sort().join("\n") === [...b.standaloneAgents].sort().join("\n") && a.send === b.send;
}

/** The grant draft after the saved grant changed from `base` to `saved`: an untouched draft follows it. */
export function rebaseGrantDraft(draft: UserGrant, base: UserGrant, saved: UserGrant): UserGrant {
  return sameGrant(draft, base) ? saved : draft;
}

/**
 * 全部项目 on / off. On remembers the project list it replaces; off restores it, so ids the checklist
 * does not show (archived / unknown projects) are not erased by a round trip.
 */
export function toggleAllProjects(draft: UserGrant, on: boolean, kept: readonly string[]): { draft: UserGrant; kept: string[] } {
  if (on) return { draft: { ...draft, projects: "all" }, kept: draft.projects === "all" ? [...kept] : [...draft.projects] };
  return { draft: { ...draft, projects: draft.projects === "all" ? [...kept] : draft.projects }, kept: [...kept] };
}

export function toggleId(list: readonly string[], id: string, on: boolean): string[] {
  return on ? (list.includes(id) ? [...list] : [...list, id]) : list.filter((x) => x !== id);
}

// ---------- 项目页 → 可见用户 (one project, every non-owner user) ----------

/** How a user sees one project: through `"all"` (changed only in Settings → 用户), named in the grant, or not. */
export type ProjectAccess = "all" | "granted" | "none";

export function projectAccess(grant: UserGrant | null, projectId: string): ProjectAccess {
  const projects = (grant ?? EMPTY_GRANT).projects;
  if (projects === "all") return "all";
  return projects.includes(projectId) ? "granted" : "none";
}

/**
 * A user's whole grant (the PATCH body: one record per user) with `projectId` added (`on`) or removed.
 * `"all"` stays `"all"`; standalone agents, send and any other field stay as they are.
 */
export function grantWithProject(grant: UserGrant | null, projectId: string, on: boolean): UserGrant {
  const g = grant ?? EMPTY_GRANT;
  if (g.projects === "all") return { ...g, standaloneAgents: [...g.standaloneAgents] };
  return { ...g, projects: toggleId(g.projects, projectId, on), standaloneAgents: [...g.standaloneAgents] };
}

/**
 * The grant to show for a user: a write's reply (`fresh`, with the revision it produced) until the
 * listing has caught up with that revision, else the listing's. Keeps a quick second toggle from
 * starting from a listing read before the first write.
 */
export function shownGrant(user: Pick<UserRecord, "id" | "grant">, listRevision: number, fresh: ReadonlyMap<string, { grant: UserGrant | null; revision: number }>): UserGrant | null {
  const reply = fresh.get(user.id);
  return reply && reply.revision > listRevision ? reply.grant : user.grant;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** "全部项目 · 1 个独立智能体 · 可发消息" — what a user's grant amounts to. */
export function grantSummary(grant: UserGrant | null, t: T): string {
  const g = grant ?? EMPTY_GRANT;
  const parts: string[] = [];
  if (g.projects === "all") parts.push(t("users.summary.all"));
  else if (g.projects.length) parts.push(t("users.summary.projects", { n: g.projects.length }));
  if (g.standaloneAgents.length) parts.push(t("users.summary.standalone", { n: g.standaloneAgents.length }));
  if (!parts.length) return t("users.summary.nothing");
  parts.push(t(g.send ? "users.summary.send" : "users.summary.readOnly"));
  return parts.join(" · ");
}

/** Tokens / peers bound to each user, and the pending tokens. */
export function bindingsOf(list: UsersList): { tokens: Map<string, UsersList["tokens"]>; peers: Map<string, UsersList["peers"]>; pending: UsersList["tokens"] } {
  const tokens = new Map<string, UsersList["tokens"]>();
  const peers = new Map<string, UsersList["peers"]>();
  const pending: UsersList["tokens"] = [];
  for (const token of list.tokens) {
    if (token.pending || !token.userId) pending.push(token);
    else tokens.set(token.userId, [...(tokens.get(token.userId) ?? []), token]);
  }
  for (const peer of list.peers) peers.set(peer.userId, [...(peers.get(peer.userId) ?? []), peer]);
  return { tokens, peers, pending };
}

// ---------- 设备 (one flat list of the host's devices; docs/research/identity-settings-review-20261015.md §4.2) ----------

/** The 设备 filter: every device, one user's, or the unassigned ones. */
export type DeviceFilter = { kind: "all" } | { kind: "pending" } | { kind: "user"; userId: string };

/** A device is unassigned (待分配) while pending or bound to nobody. */
export const isUnassigned = (token: Pick<UserTokenRecord, "pending" | "userId">): boolean => token.pending || !token.userId;

/**
 * The 设备 rows: filtered, then unassigned first, this desktop (`ownTokenId`) next, then the most
 * recently used (never used last), then by token id for a stable order.
 */
export function deviceRows<T extends Pick<UserTokenRecord, "tokenId" | "pending" | "userId" | "lastUsedAt">>(tokens: readonly T[], filter: DeviceFilter, ownTokenId: string | null | undefined): T[] {
  const shown = tokens.filter((t) => (filter.kind === "all" ? true : filter.kind === "pending" ? isUnassigned(t) : !isUnassigned(t) && t.userId === filter.userId));
  const used = (t: T) => (t.lastUsedAt ? Date.parse(t.lastUsedAt) : NaN);
  const rank = (t: T) => (isUnassigned(t) ? 0 : t.tokenId === ownTokenId ? 1 : 2);
  return [...shown].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    const ua = used(a);
    const ub = used(b);
    if (Number.isFinite(ua) !== Number.isFinite(ub)) return Number.isFinite(ua) ? -1 : 1;
    if (Number.isFinite(ua) && ua !== ub) return ub - ua;
    return a.tokenId.localeCompare(b.tokenId);
  });
}

/** Owner first, then by the name shown (their own display name, else the owner's label). */
export function sortedUsers(users: readonly UserRecord[]): UserRecord[] {
  return [...users].sort((a, b) => (a.isOwner !== b.isOwner ? (a.isOwner ? -1 : 1) : shownUserName(a).localeCompare(shownUserName(b))));
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

/**
 * A device's display name (lib/deviceNames): the owner-given name, the paired device name, a friendly
 * reading of a `desktop-…` label (「mhs-087278 上的 Cutex」), else the raw label.
 */
export function deviceName(token: { ownerName?: string | null; deviceName?: string | null; label: string; tokenId: string }, t: T): string {
  return clientTokenName(token, (key, vars) => t(key, vars));
}

// ---------- person identity (cutex `person-identity`; docs/research/person-identity-p2-20261014.md §5) ----------

/** Which user each person key belongs to (a key belongs to at most one user). */
export function personKeyOwners(users: readonly UserRecord[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const user of users) for (const key of user.personKeys ?? []) owners.set(key.publicKey, user.id);
  return owners;
}

/**
 * The identity a token presented, against its binding: `none` (nothing presented / older host),
 * `matches` (a key of the token's own user), `unknown` (no user has it: 「记到此用户」 offers it),
 * `other` (another user's key — the binding is unchanged). `changed`: the device presented a
 * different key before (cutex `person.previousPublicKey`: 「这台设备出示的身份变了」).
 * `displayName`: the name the device sent with its claim; `fingerprint`: cutex's, when it sent one.
 */
export type TokenPersonKind = "none" | "matches" | "unknown" | "other";

export interface TokenPersonView {
  kind: TokenPersonKind;
  publicKey: string | null;
  ownerId: string | null;
  fingerprint: string | null;
  displayName: string | null;
  changed: boolean;
}

export function tokenPerson(list: Pick<UsersList, "users" | "tokenPersons">, token: Pick<UserTokenRecord, "tokenId" | "userId" | "person">, owners = personKeyOwners(list.users)): TokenPersonView {
  const person = token.person ?? null;
  const publicKey = person?.publicKey ?? list.tokenPersons?.[token.tokenId] ?? null;
  const none: TokenPersonView = { kind: "none", publicKey: null, ownerId: null, fingerprint: null, displayName: null, changed: false };
  if (!publicKey) return none;
  const extra = {
    fingerprint: person?.fingerprint || null,
    displayName: person?.displayName?.trim() || null,
    changed: !!person?.previousPublicKey && person.previousPublicKey !== publicKey,
  };
  // cutex says who holds the key (`person.userId`); an older listing only has the users' keys.
  const ownerId = (person && person.userId !== undefined ? person.userId : owners.get(publicKey)) ?? null;
  if (!ownerId) return { kind: "unknown", publicKey, ownerId: null, ...extra };
  return { kind: ownerId === token.userId ? "matches" : "other", publicKey, ownerId, ...extra };
}

/** Unknown keys presented by a user's devices (each once): what 「记到此用户」 offers on that user. */
export function unknownKeysOf(list: Pick<UsersList, "users" | "tokens" | "tokenPersons">, userId: string): { publicKey: string; tokenIds: string[] }[] {
  const owners = personKeyOwners(list.users);
  const out = new Map<string, string[]>();
  for (const token of list.tokens) {
    if (token.userId !== userId || token.pending) continue;
    const p = tokenPerson(list, token, owners);
    if (p.kind === "unknown") out.set(p.publicKey!, [...(out.get(p.publicKey!) ?? []), token.tokenId]);
  }
  return [...out].map(([publicKey, tokenIds]) => ({ publicKey, tokenIds }));
}

/** A user's person keys as a PUT body without `publicKey`. */
export function withoutPersonKey(user: Pick<UserRecord, "personKeys">, publicKey: string): PersonKeyInput[] {
  return (user.personKeys ?? []).filter((k) => k.publicKey !== publicKey).map((k) => ({ publicKey: k.publicKey, ...(k.label ? { label: k.label } : {}) }));
}

// ---------- 新建用户并分配 (pending device card; docs/research/person-identity-p2-20261014.md §5) ----------

/** Longest user name cutex takes (`name`, 1–64 characters). */
export const USER_NAME_MAX = 64;

/** The new user's default name: the name the device claimed with its identity, else the device name. */
export function newUserDefaultName(list: Pick<UsersList, "users" | "tokenPersons">, token: Pick<UserTokenRecord, "tokenId" | "userId" | "person" | "deviceName" | "ownerName" | "label">, t: T): string {
  const claimed = tokenPerson(list, token).displayName;
  return (claimed || deviceName(token, t)).trim().slice(0, USER_NAME_MAX);
}

/** The key 「记住这个人」 puts on the new user: an unknown presented key, when the box is on (else null). */
export function rememberKeyFor(list: Pick<UsersList, "users" | "tokenPersons">, token: Pick<UserTokenRecord, "tokenId" | "userId" | "person">, remember: boolean): string | null {
  const person = tokenPerson(list, token);
  return remember && person.kind === "unknown" ? person.publicKey : null;
}

/** The users calls the flow needs (DaemonApi's, refusals as values). */
export interface CreateAndAssignApi {
  createUser(request: { name: string; grant: UserGrant }): Promise<UsersResult<{ user: Pick<UserRecord, "id"> }>>;
  bindUserToken(tokenId: string, userId: string): Promise<UsersResult<unknown>>;
  putUserPersonKeys(userId: string, personKeys: PersonKeyInput[]): Promise<UsersResult<unknown>>;
}

/**
 * 新建用户并分配: create a user (no grant yet), bind the pending token to it, and with
 * `rememberKey` put that key on the new user. `write` runs one call and reports a refusal (UsersPage's
 * useUsersWrite: null = refused / failed). Returns the new user's id once it exists (also when a later
 * step was refused: the user stays, the device can be assigned to it by hand), null when not created.
 */
export async function createUserAndAssign(
  api: CreateAndAssignApi,
  write: <V>(run: () => Promise<UsersResult<V>>) => Promise<V | null>,
  input: { name: string; tokenId: string; rememberKey: string | null },
): Promise<{ userId: string | null; bound: boolean; remembered: boolean }> {
  const name = input.name.trim().slice(0, USER_NAME_MAX);
  if (!name) return { userId: null, bound: false, remembered: false };
  const created = await write(() => api.createUser({ name, grant: EMPTY_GRANT }));
  if (!created) return { userId: null, bound: false, remembered: false };
  const userId = created.user.id;
  const bound = (await write(() => api.bindUserToken(input.tokenId, userId))) !== null;
  if (!bound || !input.rememberKey) return { userId, bound, remembered: false };
  // A brand-new user has no keys yet: the PUT body is just this one.
  const remembered = (await write(() => api.putUserPersonKeys(userId, [{ publicKey: input.rememberKey! }]))) !== null;
  return { userId, bound, remembered };
}
