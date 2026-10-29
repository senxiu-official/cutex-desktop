import type { ProfileItem, UsageReport } from "../../../../shared/ipc";
import { seriesName as baseSeriesName } from "../../lib/usage";

export interface IdentityProfile {
  hostId: string; label: string; name: string; signature: string | null;
  accountKey?: string | null; secretId?: string | null; profileId?: string | null;
  /** An old ledger ID must not inherit a replacement profile's current account. */
  isolated?: boolean;
}
export interface ProfileIdentity<T extends IdentityProfile = IdentityProfile> {
  id: string; name: string; label: string; split: boolean;
  accountKey: string | null; secretId: string | null; members: T[];
}
export const normalizedProfileName = (name: string) => name.trim().toLowerCase();
export function profileSignature(p: Pick<ProfileItem, "cliKind" | "provider" | "modelProvider" | "baseUrl"> | null | undefined): string | null {
  if (!p) return null;
  return [p.cliKind, (p.modelProvider ?? p.provider ?? "").toLowerCase(), (p.baseUrl ?? "").trim().replace(/\/+$/, "").toLowerCase()].join("|");
}
export function identityProfile(hostId: string, label: string, profile: ProfileItem): IdentityProfile {
  return { hostId, label, name: profile.name, profileId: profile.id, signature: profileSignature(profile), accountKey: profile.link?.accountKey, secretId: profile.link?.secretId };
}
export function accountIdentity(p: IdentityProfile): string | null {
  if (!p.accountKey) return null;
  // Incomplete link metadata is confined to its host, never treated as legacy proof.
  return JSON.stringify(["account", p.secretId || ["host", p.hostId], p.accountKey]);
}
export const profileRef = (p: Pick<IdentityProfile, "hostId" | "name" | "profileId">) => JSON.stringify([p.hostId, p.name, p.profileId ?? null]);

/** Index known accounts first, so legacy names cannot bridge two conflicting accounts. */
export function groupProfiles<T extends IdentityProfile>(profiles: readonly T[], splitLegacySignatures = true): ProfileIdentity<T>[] {
  type Group = { id: string; members: T[]; first: number; accountKey: string | null; secretId: string | null };
  const known = new Map<string, Group>(); const aliases = new Map<string, Set<string>>(); const legacy = new Map<string, Group[]>(); const isolated: Group[] = [];
  profiles.forEach((p, index) => {
    const key = accountIdentity(p); if (!key || p.isolated) return;
    let group = known.get(key);
    if (!group) { group = { id: key, members: [], first: index, accountKey: p.accountKey!, secretId: p.secretId ?? null }; known.set(key, group); }
    group.members.push(p);
    const name = normalizedProfileName(p.name); const ids = aliases.get(name) ?? new Set<string>(); ids.add(key); aliases.set(name, ids);
  });
  profiles.forEach((p, index) => {
    if (accountIdentity(p) && !p.isolated) return;
    if (p.isolated) { const id = JSON.stringify(["historical", p.hostId, p.profileId, p.name]); let group = isolated.find((g) => g.id === id); if (!group) { group = { id, members: [], first: index, accountKey: null, secretId: null }; isolated.push(group); } group.members.push(p); return; }
    const name = normalizedProfileName(p.name);
    const candidates = [...(aliases.get(name) ?? [])].map((id) => known.get(id)!).filter((g) => p.signature === null || g.members.some((m) => accountIdentity(m) === g.id && m.signature === p.signature) || g.members.filter((m) => accountIdentity(m) === g.id).every((m) => m.signature === null));
    if (candidates.length === 1) { candidates[0]!.members.push(p); candidates[0]!.first = Math.min(candidates[0]!.first, index); return; }
    const groups = legacy.get(name) ?? []; legacy.set(name, groups);
    const group = !splitLegacySignatures || p.signature === null ? groups[0] : groups.find((g) => g.members.some((m) => m.signature === p.signature) || g.members.every((m) => m.signature === null));
    if (group) group.members.push(p);
    else groups.push({ id: JSON.stringify(["legacy", name, groups.length]), members: [p], first: index, accountKey: null, secretId: null });
  });
  const position = new Map(profiles.map((p, index) => [p, index]));
  const groups = [...known.values(), ...[...legacy.values()].flat(), ...isolated].sort((a, b) => a.first - b.first);
  const spelling = new Map<string, string>(); profiles.forEach((p) => { const key = normalizedProfileName(p.name); if (!spelling.has(key)) spelling.set(key, p.name.trim()); });
  const out = groups.map((group) => {
    group.members.sort((a, b) => position.get(a)! - position.get(b)!);
    const name = spelling.get(normalizedProfileName(group.members[0]!.name))!;
    return { ...group, name, label: name, split: false };
  });
  out.forEach((group) => { group.split = out.some((other) => other !== group && normalizedProfileName(other.name) === normalizedProfileName(group.name)); if (group.split) group.label = `${group.name} · ${[...new Set(group.members.map((p) => p.label))].join(", ")}`; });
  return out;
}

export type ProfileUsageKey = UsageReport["rows"][number]["key"] & { profileGroup?: string; host?: string; hostId?: string };
/** Profile series use account IDs; labels stay separate so display-name collisions cannot merge data. */
export function usageSeriesName(key: ProfileUsageKey, split: string): string {
  return split === "profile" && key.profileGroup ? key.profileGroup : baseSeriesName(key, split);
}
