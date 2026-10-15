// The sidebar's identity button (bottom left) — pure parts, unit-tested in test/identity.test.ts.
// Who this desktop is on the focus host: the owner (also any cutex without `users`), a member (a
// cutex user with a grant) or a pending device (docs/research/user-isolation-p1-20261014.md §9).
// Name and picture are this desktop's 「你」 (lib/identityPrefs), published to hosts with cutex
// `users-self-profile` (lib/identitySync); on an older host a member's name is cutex's.
import type { UserAccess } from "../../../shared/users";

export type IdentityRole = "owner" | "member" | "pending";

/** The role of a connection's access (`userAccessOf`: an older cutex = the owner). */
export function identityRole(access: Pick<UserAccess, "isOwner" | "pending">): IdentityRole {
  return access.isOwner ? "owner" : access.pending ? "pending" : "member";
}

export type RoleWordKey = "identity.role.owner" | "identity.role.memberSend" | "identity.role.memberReadOnly" | "identity.role.readOnly" | "identity.role.pending";

/**
 * The role in words (docs/research/identity-settings-review-20261015.md §4.4; the same words as
 * Settings → 你): `line` under the name in the menu header — 主人 / 用户 · 可发消息 / 用户 · 只读 /
 * 等主人分配 — and the button's `suffix`, only for a connection that is not a full one (只读, 等主人分配).
 */
export function roleWords(access: Pick<UserAccess, "isOwner" | "pending" | "grant">): { line: RoleWordKey; suffix: RoleWordKey | null } {
  if (access.isOwner) return { line: "identity.role.owner", suffix: null };
  if (access.pending) return { line: "identity.role.pending", suffix: "identity.role.pending" };
  return access.grant?.send === true ? { line: "identity.role.memberSend", suffix: null } : { line: "identity.role.memberReadOnly", suffix: "identity.role.readOnly" };
}

/**
 * The name shown. On a host with cutex `users-self-profile` (`selfProfile`) your identity is the one
 * you set on this desktop and publish there: the 「你的名字」 pref, else the display name the host has
 * for you (published from another desktop of yours), else — a member — the host's name for you, else
 * the OS account name. On an older host: the owner's pref / OS name; a member's cutex user name (that
 * is how that host knows you). A pending device (no cutex name yet) falls back to the local name.
 * null: nothing known (the caller shows a generic 「你」).
 */
export function identityName(
  access: Pick<UserAccess, "isOwner" | "name"> & { displayName?: string | null },
  localName: string | null | undefined,
  osUserName: string | null | undefined,
  selfProfile = false,
): string | null {
  const local = localName?.trim() || null;
  const os = osUserName?.trim() || null;
  if (selfProfile) return local || access.displayName?.trim() || (access.isOwner ? null : access.name?.trim()) || os;
  if (access.isOwner) return local || os;
  return access.name?.trim() || local || os;
}

const SEPARATOR = /[\s._\-@]+/u;
const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Up to two initials: the first letter of the first and last word ("Mia Katharina Ross" → MR,
 * "alex-kim" → AK, "sam" → S); a CJK name gives its first character ("李" for 李明). "?" when
 * there is no letter or digit.
 */
export function identityInitials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(SEPARATOR).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return "?";
  const first = [...words[0]!].find((c) => /[\p{L}\p{N}]/u.test(c))!;
  if (WIDE.test(first)) return first;
  const last = words.length > 1 ? [...words[words.length - 1]!].find((c) => /[\p{L}\p{N}]/u.test(c) && !WIDE.test(c)) : undefined;
  return (first + (last ?? "")).toUpperCase();
}

/**
 * The identity menu's 用量 ▸ rows: profiles with quota gauges (list order), the ones that answered
 * without any (one quiet 「未开启」 line), and whether answers are still missing.
 */
export function splitUsage<G>(profiles: readonly string[], quotas: Readonly<Record<string, readonly G[] | undefined>>): { withQuota: string[]; without: string[]; waiting: boolean } {
  const withQuota = profiles.filter((p) => (quotas[p]?.length ?? 0) > 0);
  const without = profiles.filter((p) => quotas[p] !== undefined && quotas[p]!.length === 0);
  return { withQuota, without, waiting: profiles.some((p) => quotas[p] === undefined) };
}
