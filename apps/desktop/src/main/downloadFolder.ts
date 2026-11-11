// Where the downloads (main/remoteCopies) live: the app-managed userData/remote-copies by default, or a folder the
// owner picked in main's own dialog (Downloads page → 更改文件夹). The choice is kept in userData/download-folder.json.
// A move copies the whole store, opens it at the new place and only then deletes the old one.
import * as fs from "node:fs/promises";
import * as path from "node:path";

const FILE = "download-folder.json";
/** The folder made inside the one the owner picks, so the copies' own folders never mix with other files there. */
export const PICKED_SUBFOLDER = "Cutex Downloads";

export const defaultDownloadRoot = (userData: string): string => path.join(userData, "remote-copies");

export async function readDownloadRoot(userData: string): Promise<string> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(userData, FILE), "utf8")) as { root?: unknown };
    if (typeof raw.root === "string" && path.isAbsolute(raw.root)) return path.resolve(raw.root);
  } catch { /* missing or unreadable: the default */ }
  return defaultDownloadRoot(userData);
}

export async function writeDownloadRoot(userData: string, root: string): Promise<void> {
  const file = path.join(userData, FILE);
  if (path.resolve(root) === defaultDownloadRoot(userData)) { await fs.rm(file, { force: true }); return; }
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ version: 1, root: path.resolve(root) }), { mode: 0o600 });
  await fs.rename(tmp, file);
}

const inside = (child: string, parent: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The store's new folder for a folder the owner picked (or the default). Refuses a place inside / around the old one. */
export function targetRoot(picked: string, from: string, userData: string): string {
  const to = path.resolve(picked) === defaultDownloadRoot(userData) ? defaultDownloadRoot(userData) : path.join(path.resolve(picked), PICKED_SUBFOLDER);
  if (inside(to, from) || inside(from, to)) throw new Error("pick a folder outside the current download folder");
  return to;
}

/** Copy the store to `to` (missing or empty). The caller opens it there before `removeOldStore`. */
export async function copyStore(from: string, to: string): Promise<void> {
  try {
    if ((await fs.readdir(to)).length) throw new Error(`the folder is not empty: ${to}`);
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") { await fs.rm(to, { recursive: true, force: true }).catch(() => {}); throw e; }
    await fs.mkdir(to, { recursive: true }); // no store yet
  }
}

export async function removeOldStore(from: string): Promise<void> {
  await fs.rm(from, { recursive: true, force: true });
}
