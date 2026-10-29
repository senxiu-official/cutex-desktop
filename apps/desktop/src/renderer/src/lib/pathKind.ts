// Is a path a folder? Asked of the daemon (AGENTS.md principle 2), never guessed from the name: a
// workspace path through fs/dir (400 not_a_directory for a file), a host path through the folder
// browser's /v2/fs/dirs. Openers of paths whose kind they do not know (file links, tool rows, the
// turn summary) ask first, so a folder opens in the 文件 tree instead of a preview of an error.
import type { DaemonApi, WorkspaceScope } from "../../../shared/ipc";
import { onHostSwitch } from "./hostSwitch";
import { scopeKey } from "./workspace";

/** How long an answer is reused (a path rarely turns from a file into a folder). */
const TTL_MS = 30_000;
const cache = new Map<string, { dir: boolean; at: number }>();
onHostSwitch(() => cache.clear());

/** A daemon read refused because the path is a folder (`not_a_file: path is not a regular file`). */
export function isNotAFileError(error: unknown): boolean {
  return /(?:^|[^a-z_])not_a_file\b/.test(error instanceof Error ? error.message : String(error));
}

async function ask(key: string, probe: () => Promise<boolean>): Promise<boolean> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dir;
  let dir: boolean;
  try {
    dir = await probe();
  } catch (error) {
    // not_a_directory = a file. Anything else (missing, offline, old cutex): not known to be a
    // folder, so it opens as a file and the preview says what is wrong.
    if (!/(?:^|[^a-z_])not_a_directory\b/.test(error instanceof Error ? error.message : String(error))) return false;
    dir = false;
  }
  cache.set(key, { dir, at: Date.now() });
  return dir;
}

/** A workspace-relative path of `scope` on `hostId` is a folder (fs/dir lists it). */
export function isWorkspaceDir(api: DaemonApi, hostId: string, scope: WorkspaceScope, path: string): Promise<boolean> {
  return ask(`${hostId}|${scopeKey(scope)}|${path}`, () => api.fsDir(scope, path).then(() => true));
}

/** An absolute path on `hostId` is a folder (/v2/fs/dirs lists it; null = cutex without the route). */
export function isHostDir(api: DaemonApi, hostId: string, path: string): Promise<boolean> {
  return ask(`${hostId}|host|${path}`, () => api.browseDirs(path).then((d) => d !== null));
}

/** Tests. */
export function clearPathKindCache(): void {
  cache.clear();
}
