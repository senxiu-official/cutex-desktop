// cutex `client-token-rename` in the preview: the owner-given names of client / device tokens. The
// token lists live in two module mocks (modules/users/mock.ts: users' devices; modules/remote-access/
// mock.ts: 接入 → paired devices), but one bridge method renames (`renameClientToken`, served by the
// remote-access mock), so each list registers here (through MockCore `clientTokenNames`) and a rename reaches whichever list has the token.
// Validation like cutex: trimmed, 1..=60 characters, no control characters; null / blank clears.

export interface MockTokenList {
  /** Set or clear the name of `tokenId`; false when this list has no such token. */
  rename(tokenId: string, ownerName: string | null): boolean;
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
