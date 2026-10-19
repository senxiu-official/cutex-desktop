// Hooks and helpers shared by the users module's sections (UsersPage, DevicesSection, PeersSection).
import { useState } from "react";
import { shownUserName, USER_OWN_TOKEN_FEATURE, type UserRecord, type UsersList } from "../../../../shared/users";
import { useI18n } from "../../i18n";
import { CLIENT_TOKEN_RENAME_FEATURE } from "../../lib/deviceNames";
import { useHostAccess } from "../../lib/hostAccess";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import type { useUsersWrite } from "./hooks";
import { sortedUsers } from "./model";

export type Write = ReturnType<typeof useUsersWrite>;

/** The value of the user selects' 待分配 option. */
export const PENDING = "__pending__";

/** The i18n `t` as model.ts helpers take it. */
export function useT() {
  const { t } = useI18n();
  return (key: string, vars?: Record<string, string | number>) => t(key as never, vars);
}

/** Users as select options (owner first, by the name shown). */
export function userOptions(users: readonly UserRecord[]) {
  return sortedUsers(users).map((u) => ({ value: u.id, label: shownUserName(u) }));
}

/** A user id's shown name in this listing (person_key_in_use refusals). */
export const nameIn = (list: UsersList) => (userId: string) => {
  const user = list.users.find((u) => u.id === userId);
  return user ? shownUserName(user) : userId;
};

/** Remove a device (`DELETE /v2/client-tokens/{id}`): it disconnects and has to pair again. */
export function useRevoke(write: Write) {
  const api = useTargetApi();
  return (tokenId: string, report: (text: string) => void) =>
    write(async () => {
      await api.revokeClientToken(tokenId);
      return { ok: true as const, value: null };
    }, report);
}

/**
 * cutex `client-token-rename`: which device row is being renamed, and the save (`PATCH
 * /v2/client-tokens/{id}`; null clears). `can` is false on an older host (no pencil).
 */
export function useRename(write: Write) {
  const api = useTargetApi();
  const can = useTargetFeatures().has(CLIENT_TOKEN_RENAME_FEATURE);
  const [editing, setEditing] = useState<string | null>(null);
  const save = async (tokenId: string, name: string | null, report: (text: string) => void) =>
    (await write(async () => {
      await api.renameClientToken(tokenId, name);
      return { ok: true as const, value: true };
    }, report)) === true;
  return { can, editing, setEditing, save };
}

/** DOM anchors of the 用户 page's flat lists (settings search, the attention strip, 可见用户 links). */
export const USERS_ANCHOR = "users-list";
export const DEVICES_ANCHOR = "users-devices";
export const PEERS_ANCHOR = "users-peers";

/** The target host's authenticated token; an explicit null means root, not a device. */
export function useOwnTokenId(): string | null {
  const hostId = useTargetHostId();
  const access = useHostAccess(hostId);
  const reportsToken = useTargetFeatures().has(USER_OWN_TOKEN_FEATURE);
  const pairedToken = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.tokenId);
  // Direct/dev hosts have no stored pairing token. Modern hosts report it themselves;
  // never replace a root/null (or missing modern reply) with stale pairing metadata.
  if (reportsToken || access.token !== undefined) return access.token?.id ?? null;
  return pairedToken ?? null; // Older SSH hosts: keep their explicitly paired token.
}

/** Settings → 接入 → 配对设备. */
export function openPairing() {
  useApp.getState().openSettings("users", { anchor: "remote-access.pairing" });
}
