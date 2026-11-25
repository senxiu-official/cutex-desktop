import { lstatSync, readdirSync, type Stats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { browserIdentityPartition, DEFAULT_BROWSER_IDENTITY_ID, isBrowserIdentityId } from "../../../shared/browserIdentity";

export function browserIdentityHostId(value: unknown): value is string {
  return typeof value === "string" && /^(?:local|(?:ssh|dev)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,127})$/.test(value);
}

export function parseIdentityPartition(partition: string): { identityId: string; hostId: string } | undefined {
  const named = /^persist:browser-id-([a-f0-9]{8}|[a-f0-9]{32})-(.+)$/.exec(partition);
  const identityId = named?.[1] ?? DEFAULT_BROWSER_IDENTITY_ID;
  const hostId = named?.[2] ?? (partition.startsWith("persist:browser-") ? partition.slice(16) : "");
  if (browserIdentityHostId(hostId) && browserIdentityPartition(identityId, hostId) === partition) return { identityId, hostId };
}

export function partitionDirectory(sessionData: string, identityId: string, hostId: string): string {
  return join(sessionData, "Partitions", browserIdentityPartition(identityId, hostId).slice("persist:".length));
}

export function diskEntry(path: string): Stats | undefined {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) throw Error("browser_identity_storage_unavailable");
    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function partitionInventory(sessionData: string): { identityId: string; hostId: string }[] {
  const root = join(sessionData, "Partitions");
  if (!diskEntry(sessionData)?.isDirectory() || !diskEntry(root)?.isDirectory()) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const identity = entry.isDirectory() && parseIdentityPartition(`persist:${entry.name}`);
    return identity ? [identity] : [];
  });
}

export function historyDirectory(userData: string, identityId: string): string {
  if (!isBrowserIdentityId(identityId)) throw Error("invalid_browser_identity");
  return join(userData, "browser-history", identityId);
}

/** Ignore junctions/symlinks and files which disappear during Chromium's cache maintenance. */
export async function partitionBytes(path: string): Promise<number> {
  let size = 0;
  const directories = [path];
  while (directories.length) {
    const current = directories.pop()!;
    const info = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
    if (!info || !info.isDirectory() || info.isSymbolicLink()) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = join(current, entry.name);
      if (entry.isDirectory()) directories.push(child);
      else if (entry.isFile()) {
        const details = await lstat(child).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        if (details?.isFile()) size += details.size;
      }
    }
  }
  return size;
}
