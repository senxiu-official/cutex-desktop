// cutex `client-token-rename` in the preview: the owner-given names of client / device tokens. The
// token lists live in two module mocks (modules/users/mock.ts: users' devices; modules/remote-access/
// mock.ts: 接入 → paired devices), but one bridge method renames (`renameClientToken`, served by the
// remote-access mock), so each list registers here (through MockCore `clientTokenNames`) and a rename reaches whichever list has the token.
// Validation like cutex: trimmed, 1..=60 characters, no control characters; null / blank clears.

export interface MockTokenList {
  /** Set or clear the name of `tokenId`; false when this list has no such token. */
  rename(tokenId: string, ownerName: string | null): boolean;
  /** device-scope: set the token's scope; false when this list has no such token. */
  setScope?(tokenId: string, scope: "full" | "chat" | "read"): boolean;
  /** The token was revoked: drop it (and anything that refers to it); false when this list has no such token. */
  revoke?(tokenId: string): boolean;
}

const lists: MockTokenList[] = [];

export function registerMockTokenList(list: MockTokenList): void {
  lists.push(list);
}

/** `PATCH /v2/client-tokens/{id}` `{name}` → `{tokenId, ownerName}`; throws like the client on 400 / 404. */
export function renameMockToken(tokenId: string, name: string | null): { tokenId: string; ownerName: string | null } {
  const ownerName = name?.trim() || null;
  if (ownerName && ([...ownerName].length > 60 || /[\u0000-\u001f\u007f-\u009f]/.test(ownerName))) throw new Error("invalid_client_token_name: name: at most 60 characters, no control characters");
  let found = false;
  for (const list of lists) found = list.rename(tokenId, ownerName) || found;
  if (!found) throw new Error("client_token_not_found: no client token with this id");
  return { tokenId, ownerName };
}

// device-scope / owner-device-notice (cutex 21123b6): a scope change and a revoke reach every list too
// (`updateClientToken` / `revokeClientToken` are served by the remote-access mock; the users mock keeps
// its token list and the new owner devices in step through these).

/** `PATCH /v2/client-tokens/{id}` `{scope}`: sets the scope wherever the token is; false = no list has it. */
export function scopeMockToken(tokenId: string, scope: "full" | "chat" | "read"): boolean {
  let found = false;
  for (const list of lists) found = list.setScope?.(tokenId, scope) || found;
  return found;
}

/** `DELETE /v2/client-tokens/{id}`: tells every list the token is gone; false = no list had it (404). */
export function revokeMockToken(tokenId: string): boolean {
  let found = false;
  for (const list of lists) found = list.revoke?.(tokenId) || found;
  return found;
}
