// Person keys on a host's `/v2/users` listing (cutex `person-identity`) — the parts both Settings → 你
// (core) and the users module need. Pure; unit-tested in test/personIdentity.test.ts.
import type { PersonKeyInput, UserRecord } from "../../../shared/users";

/**
 * This desktop's key is not known to the host yet (no user holds it): the 「这台主机还不认得你的身份」
 * exception on Settings → 你 (owner connections; 记住 puts it on the owner) and the owner row's offer on
 * 用户. false on a host without person-identity (no user lists keys) or without a key.
 */
export function selfKeyUnknown(users: readonly Pick<UserRecord, "personKeys">[], publicKey: string | null | undefined): boolean {
  if (!publicKey || !users.some((u) => u.personKeys !== undefined)) return false;
  return !users.some((u) => u.personKeys?.some((k) => k.publicKey === publicKey));
}

/** A user's person keys as a PUT body, plus `add` (kept once). */
export function withPersonKey(user: Pick<UserRecord, "personKeys">, add: PersonKeyInput): PersonKeyInput[] {
  const keys = (user.personKeys ?? []).map((k) => ({ publicKey: k.publicKey, ...(k.label ? { label: k.label } : {}) }));
  return keys.some((k) => k.publicKey === add.publicKey) ? keys : [...keys, add];
}
