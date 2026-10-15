// Settings → 你 → 你在各主机上 (pure; unit-tested in test/personIdentity.test.ts): what this desktop
// is on one configured host — its role (the `user` block of that host's `/v2/capabilities`, lib/hostAccess),
// whether it may send, and which projects it sees (owner / grant "all": every project; otherwise the
// granted projects that host's sidebar shows).
import type { HostClaimView } from "../../../shared/personIdentity";
import { canSend, USERS_FEATURE, type UserAccess } from "../../../shared/users";
import { syncIssue, type IdentitySyncStatus, type SyncIssueKey } from "./identityPublish";

export type MyRole =
  /** not connected / capabilities not read yet. */
  | "unknown"
  /** cutex without `users`: no users at all, this connection is the owner as before. */
  | "older"
  | "owner"
  | "member"
  | "pending";

export interface MyAccessRow {
  role: MyRole;
  /** member: your name on that host — the one you set (users-self-profile), else the owner's label (as the banner). */
  userName: string | null;
  /** null: not applicable (unknown / pending). */
  send: boolean | null;
  /** "all", the names of the visible granted projects, or null (unknown / pending). */
  projects: "all" | string[] | null;
  /** Standalone agents in the grant (members). */
  standalone: number;
}

/**
 * One host's row. `features` is the store's set for that host (a non-owner connection already lacks
 * the owner-only `users`, so `older` is read only on an owner connection); `projects`: the host's
 * sidebar projects (id + name, active ones).
 */
export function myAccessRow(input: {
  connected: boolean;
  access: UserAccess & { known: boolean };
  features: ReadonlySet<string>;
  featuresKnown: boolean;
  projects: readonly { id: string; name: string }[] | null;
}): MyAccessRow {
  const { access, features } = input;
  const none: MyAccessRow = { role: "unknown", userName: null, send: null, projects: null, standalone: 0 };
  if (!input.connected || !input.featuresKnown || !access.known) return none;
  if (access.isOwner) {
    return { role: features.has(USERS_FEATURE) ? "owner" : "older", userName: null, send: true, projects: "all", standalone: 0 };
  }
  if (access.pending) return { ...none, role: "pending" };
  const grant = access.grant;
  const granted = grant?.projects ?? [];
  const projects = granted === "all" ? "all" : (input.projects ?? []).filter((p) => granted.includes(p.id)).map((p) => p.name);
  return { role: "member", userName: memberName(access), send: canSend(access), projects, standalone: grant?.standaloneAgents.length ?? 0 };
}

/** A member's name on a host: what they set themselves, else the owner's label for them, else the id. */
export function memberName(access: Pick<UserAccess, "name" | "userId"> & { displayName?: string | null }): string | null {
  return access.displayName?.trim() || access.name?.trim() || access.userId;
}

/** The first `max` names and how many more are folded away. */
export function foldNames(names: readonly string[], max = 5, open = false): { shown: string[]; more: number } {
  if (open || names.length <= max) return { shown: [...names], more: 0 };
  return { shown: names.slice(0, max), more: names.length - max };
}

/**
 * Line 3 of a 你在各主机上 row: what this desktop is on that host. `root`: the root credential (this
 * machine's own cutex: 这台电脑就是这台主机); `token`: a paired token's name; `tell`: a pending device —
 * the name the owner sees in their 待分配 list (请告诉主人：这台设备叫…). The name comes from cutex C1
 * (`ownToken`, any role) or, on an owner connection, the host's `/v2/users` token with this desktop's
 * token id (`listed`). null: nothing known (disconnected, or a member / pending device on a host without C1).
 */
export type DeviceLine = { kind: "root" } | { kind: "token"; name: string } | { kind: "tell"; name: string } | null;

export function myDeviceLine<T>(input: {
  role: MyRole;
  /** This machine's own host (connected with the root credential when it has no token id). */
  local: boolean;
  /** hosts.json token id of this desktop on the host (null: root credential / not paired). */
  tokenId: string | null | undefined;
  /** C1 `user.token`: undefined = not reported, null = root credential. */
  ownToken: T | null | undefined;
  /** The owner's listing entry for `tokenId`. */
  listed: T | null | undefined;
  nameOf(token: T): string;
}): DeviceLine {
  if (input.role === "unknown") return null;
  if (input.ownToken === null || (input.ownToken === undefined && !input.tokenId && input.local)) return { kind: "root" };
  const token = input.ownToken ?? input.listed ?? null;
  const name = token ? input.nameOf(token).trim() : "";
  if (!name) return null;
  return input.role === "pending" ? { kind: "tell", name } : { kind: "token", name };
}

export type HostIssueKey = SyncIssueKey | "me.access.issue.claimFailed" | "me.access.issue.selfUnknown";

/**
 * The right column of a 你在各主机上 row: at most one exception, in priority order (sync failed, claim
 * failed, this host does not know your identity yet — owner connections, with 记住 —, changed from
 * another computer, an older host, syncing). Nothing when all is well; a successful claim is a moment
 * (a toast), not a state.
 */
export function hostIssue(input: { sync: IdentitySyncStatus | undefined; claim: Pick<HostClaimView, "state" | "error"> | undefined; selfUnknown: boolean; /** A cutex without users (role `older`): no owner-given name to fall back on. */ noUsers?: boolean }): { key: HostIssueKey; tone: "danger" | "warn" | "subtle"; error?: string; remember?: boolean } | null {
  const sync = syncIssue(input.sync);
  if (sync?.key === "me.access.issue.syncFailed") return sync;
  if (input.claim?.state === "failed") return { key: "me.access.issue.claimFailed", tone: "danger", error: input.claim.error ?? undefined };
  if (input.selfUnknown) return { key: "me.access.issue.selfUnknown", tone: "warn", remember: true };
  if (input.noUsers && sync?.key === "me.access.issue.unsupported") return null;
  return sync;
}

/**
 * Claims that just happened (docs/research/identity-settings-review-20261015.md §4.1.2): a host that
 * recognised this desktop and bound its pending device to your user (`autoBound`), or remembered your
 * key as its owner's (`ownerKeyAdded`). Moments, shown once as a toast, not as a row state.
 */
export function claimTransitions(before: Readonly<Record<string, HostClaimView>>, after: Readonly<Record<string, HostClaimView>>): { hostId: string; outcome: "autoBound" | "ownerKeyAdded"; userId: string | null }[] {
  const out: { hostId: string; outcome: "autoBound" | "ownerKeyAdded"; userId: string | null }[] = [];
  for (const [hostId, next] of Object.entries(after)) {
    if (next.state !== "claimed" || (next.outcome !== "autoBound" && next.outcome !== "ownerKeyAdded")) continue;
    const prev = before[hostId];
    if (prev?.state === "claimed" && prev.at === next.at && prev.outcome === next.outcome) continue;
    out.push({ hostId, outcome: next.outcome, userId: next.userId ?? null });
  }
  return out;
}
