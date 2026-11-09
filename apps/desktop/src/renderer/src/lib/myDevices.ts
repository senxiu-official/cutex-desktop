// Settings → 你 → 我的设备: your devices across the hosts you own (pure; test/settingsSubPages.test.ts).
// Hosts do not share a device identity, so a row is one device only when the name and platform match
// and no host has that pair twice; when in doubt the rows stay apart.
import type { UserTokenRecord } from "../../../shared/users";

export interface HostDevices {
  hostId: string;
  hostLabel: string;
  /** This desktop's own token on that host: never merged, never revoked from here. */
  ownTokenId: string | null;
  tokens: readonly UserTokenRecord[];
}

export interface MyDeviceRow {
  key: string;
  name: string;
  /** Runs this desktop on at least one of its hosts. */
  own: boolean;
  on: { hostId: string; hostLabel: string; tokenId: string }[];
}

export function mergeMyDevices(hosts: readonly HostDevices[], nameOf: (token: UserTokenRecord) => string): MyDeviceRow[] {
  const pairOf = (token: UserTokenRecord) => `${nameOf(token).trim().toLowerCase()}\n${token.platform ?? ""}`;
  const twice = new Set<string>();
  for (const host of hosts) {
    const seen = new Set<string>();
    for (const token of host.tokens) {
      const pair = pairOf(token);
      if (seen.has(pair)) twice.add(pair);
      seen.add(pair);
    }
  }
  const rows = new Map<string, MyDeviceRow>();
  for (const host of hosts) {
    for (const token of host.tokens) {
      const own = token.tokenId === host.ownTokenId;
      const pair = pairOf(token);
      const key = own || twice.has(pair) ? token.tokenId : pair;
      const row = rows.get(key) ?? { key, name: nameOf(token), own, on: [] };
      row.on.push({ hostId: host.hostId, hostLabel: host.hostLabel, tokenId: token.tokenId });
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
}
