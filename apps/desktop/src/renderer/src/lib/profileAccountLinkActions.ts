import { apiFor } from "../bridge";
import { accountLinkHostAllowed, accountLinkHostReady, captureAccountLinkAction, refreshAccountProfiles, type LinkedProfileRef } from "./profileAccountLinks";

export interface AccountLinkChange { ref: LinkedProfileRef; before: string | null; after: string | null; isCurrent(): boolean }
export interface AccountLinkResult { changes: AccountLinkChange[]; failed: LinkedProfileRef[] }
export function newManualAccountLink(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `m-${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}
function previousLink(value: { accountLink?: string | null }): string | null {
  if (!Object.prototype.hasOwnProperty.call(value, "accountLink") || (value.accountLink !== null && (typeof value.accountLink !== "string" || !/^(none|m-[a-zA-Z0-9_-]{22})$/.test(value.accountLink)))) throw new Error("Profile link state unavailable; refresh this host before linking");
  return value.accountLink ?? null;
}
/** Read all undo states before any mutation; never silently retry a cross-host write. */
export async function changeAccountLinks(refs: readonly LinkedProfileRef[], value: string | null): Promise<AccountLinkResult> {
  if (!refs.length || refs.length > 100 || new Set(refs.map((r) => `${r.hostId}/${r.profile.id}`)).size !== refs.length) throw new Error("Invalid linked profile selection");
  if (refs.some((ref) => !accountLinkHostAllowed(ref.hostId))) throw new Error("Profile link host unavailable");
  const family = refs[0]!.profile.providerFamily;
  if (value?.startsWith("m-") && (!family || refs.some((ref) => ref.profile.providerFamily !== family))) throw new Error("Profile provider families differ");
  if (value?.startsWith("m-") && refs.some((ref) => !accountLinkHostReady(ref.hostId))) throw new Error("Account link settings have not synchronised");
  const fences = refs.map((ref) => captureAccountLinkAction(ref.hostId));
  const before = await Promise.all(refs.map(async (ref, index) => {
    const value = previousLink(await apiFor(ref.hostId).getProfile(ref.profile.id));
    if (!fences[index]!()) throw new Error("Profile link connection changed");
    return value;
  }));
  const result: AccountLinkResult = { changes: [], failed: [] };
  for (const [index, ref] of refs.entries()) {
    try {
      if (!fences[index]!()) throw new Error("Host disconnected or replaced");
      if (value?.startsWith("m-") && !accountLinkHostReady(ref.hostId)) throw new Error("Account link settings changed");
      await apiFor(ref.hostId).patchProfile(ref.profile.id, { accountLink: value });
      if (!fences[index]!()) throw new Error("Profile link outcome needs refresh");
      result.changes.push({ ref, before: before[index]!, after: value, isCurrent: fences[index]! });
    } catch { result.failed.push(ref); }
  }
  await refreshAccountProfiles().catch(() => {});
  return result;
}
/** Exact previous values, fenced against a newer owner edit; no name/config/credential changes. */
export async function undoAccountLinks(changes: readonly AccountLinkChange[]): Promise<AccountLinkResult> {
  const result: AccountLinkResult = { changes: [], failed: [] };
  for (const change of changes) {
    const { ref } = change;
    try {
      if (!change.isCurrent()) throw new Error("Host unavailable or replaced");
      const current = previousLink(await apiFor(ref.hostId).getProfile(ref.profile.id));
      if (!change.isCurrent() || current !== change.after) throw new Error("Profile link changed after this operation");
      await apiFor(ref.hostId).patchProfile(ref.profile.id, { accountLink: change.before });
      if (!change.isCurrent()) throw new Error("Profile link outcome needs refresh");
      result.changes.push({ ref, before: change.after, after: change.before, isCurrent: change.isCurrent });
    } catch { result.failed.push(ref); }
  }
  await refreshAccountProfiles().catch(() => {});
  return result;
}
