// Person-key writes of Settings → 用户 (cutex `person-identity`). The only endpoint is a full-replace
// `PUT /v2/users/{id}/person-keys`, so two quick changes built from the same (stale) listing would drop
// one: changes are serialized per host + user, and each builds its body from a fresh `GET /v2/users`
// (the listing the page holds only when that read fails).
import type { PersonKeyInput, PersonKeysResult, UserRecord, UsersList, UsersResult } from "../../../../shared/users";

export interface PersonKeysApi {
  users(): Promise<UsersList | null>;
  putUserPersonKeys(userId: string, personKeys: PersonKeyInput[]): Promise<UsersResult<PersonKeysResult>>;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Change one user's person keys: `change` gets the user's latest record and returns the new list.
 * `scope` keeps hosts apart (the host id); `fallback` = the page's record of that user.
 */
export function changePersonKeys(api: PersonKeysApi, scope: string, userId: string, fallback: Pick<UserRecord, "personKeys">, change: (user: Pick<UserRecord, "personKeys">) => PersonKeyInput[]): Promise<UsersResult<PersonKeysResult>> {
  const key = `${scope}|${userId}`;
  const before = queues.get(key) ?? Promise.resolve();
  const step = before.then(async () => {
    const fresh = await api.users().catch(() => null);
    const user = fresh?.users.find((u) => u.id === userId) ?? fallback;
    return api.putUserPersonKeys(userId, change(user));
  });
  const tail = step.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return step;
}
