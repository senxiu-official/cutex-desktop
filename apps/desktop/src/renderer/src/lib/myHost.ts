// Who this desktop is on one host, for Settings → 你 (你在各主机上) and Settings → 用户 (你在这台主机上):
// the access row (lib/myAccess), the last known row of a disconnected host (lib/hostAccess), what this
// desktop is there (cutex C1 `user.token`, else the owner's `/v2/users` listing) and that listing itself
// (owner connections: identity keys, token names). React hooks; the pure parts live in lib/myAccess.
import { useEffect, useState } from "react";
import { USERS_FEATURE, type UsersList } from "../../../shared/users";
import { bridge } from "../bridge";
import { useI18n } from "../i18n";
import { clientTokenName, type NamedToken } from "./deviceNames";
import { lastAccessOf, rememberAccess, useHostAccess } from "./hostAccess";
import { myAccessRow, myDeviceLine, type DeviceLine, type MyAccessRow } from "./myAccess";
import { useHostData, useHostScope } from "./useHostScope";

const apiOf = (hostId: string) => (bridge.apiFor ? bridge.apiFor(hostId) : bridge.api);

/** The owner's `/v2/users` listing of a host (token names, identity keys); null until read / not the owner. */
export function useOwnerListing(hostId: string, read: boolean): { list: UsersList | null; reload(): void } {
  const [list, setList] = useState<UsersList | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setList(null);
    if (!read) return;
    let live = true;
    apiOf(hostId)
      .users()
      .then(
        (r) => live && setList(r),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [hostId, read, tick]);
  useEffect(() => {
    if (!read || typeof bridge.on !== "function") return;
    return bridge.on("accessChanged", ({ hostId: from }) => from === hostId && setTick((n) => n + 1));
  }, [hostId, read]);
  return { list, reload: () => setTick((n) => n + 1) };
}

export interface MyHost {
  connected: boolean;
  /** The row now (role `unknown` while not connected). */
  live: MyAccessRow;
  /** The row to show: the last known one of a disconnected host, else `live`. */
  row: MyAccessRow;
  /** `row` is the last known one. */
  stale: boolean;
  device: DeviceLine;
  /** An owner connection to a cutex with users (the listing is read). */
  ownerConn: boolean;
  owner: { list: UsersList | null; reload(): void };
}

/** This desktop on `hostId`. */
export function useMyHost(hostId: string): MyHost {
  const { t } = useI18n();
  const access = useHostAccess(hostId);
  const data = useHostData(hostId);
  const look = useHostScope().host(hostId);
  const connected = data?.daemon.kind === "connected";
  const projects = (data?.sidebar?.projects?.projects ?? []).filter((p) => p.lifecycle !== "archived").map((p) => ({ id: p.project_id, name: p.presentation?.display_name || p.project_id }));
  const live = myAccessRow({ connected, access, features: data?.features ?? new Set(), featuresKnown: data?.featuresKnown ?? false, projects });
  const liveKey = JSON.stringify(live);
  useEffect(() => {
    if (live.role !== "unknown") rememberAccess(hostId, live);
  }, [hostId, liveKey]); // eslint-disable-line react-hooks/exhaustive-deps -- compared by value
  const last = live.role === "unknown" ? lastAccessOf<MyAccessRow>(hostId) : null;
  const ownerConn = connected && live.role === "owner" && (data?.features.has(USERS_FEATURE) ?? false);
  const owner = useOwnerListing(hostId, ownerConn);
  const tokenId = look?.view.tokenId ?? null;
  const listed = tokenId ? (owner.list?.tokens.find((x) => x.tokenId === tokenId) ?? null) : null;
  const own = access.token;
  const device = myDeviceLine<NamedToken>({
    role: live.role,
    local: look?.local ?? hostId === "local",
    tokenId,
    ownToken: own ? { tokenId: own.id, label: own.label, deviceName: own.deviceName, ownerName: own.ownerName } : own,
    listed,
    nameOf: (token) => clientTokenName(token, t),
  });
  return { connected, live, row: last ?? live, stale: !!last, device, ownerConn, owner };
}
