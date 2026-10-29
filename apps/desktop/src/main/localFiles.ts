import fs from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { LOCAL_HOST_ID } from "../shared/hosts";
import { canOpenResolvedFile, isAbsoluteFilePath } from "../shared/localFiles";

function assertLocalPath(path: unknown): asserts path is string {
  if (!isAbsoluteFilePath(path) || !isAbsolute(path) || (process.platform === "win32" && (!/^[a-z]:[\\/]/i.test(path) || path.slice(2).includes(":")))) {
    throw new Error("an absolute local filesystem path is required; URLs are not allowed");
  }
}

/** Inspect link targets without traversing them, so a drive path cannot hide an SMB junction. */
async function checkWindowsLinks(full: string, depth = 0): Promise<void> {
  if (depth > 32) throw new Error("too many filesystem links");
  const root = parse(full).root;
  let prefix = root;
  for (const part of full.slice(root.length).split(sep).filter(Boolean)) {
    prefix = join(prefix, part);
    if (!(await fs.lstat(prefix)).isSymbolicLink()) continue;
    let target = await fs.readlink(prefix);
    // Windows returns this spelling for ordinary local directory junctions.
    // Input device paths are still rejected before any filesystem call.
    if (/^\\\\\?\\[a-z]:\\/i.test(target)) target = target.slice(4);
    if (target.startsWith("\\\\") || target.startsWith("//")) throw new Error("network and device link targets are not local files");
    const linked = resolve(dirname(prefix), target);
    assertLocalPath(linked);
    await checkWindowsLinks(linked, depth + 1);
  }
}

async function inspectLocalFile(path: unknown) {
  assertLocalPath(path);
  const full = normalize(path);
  if (process.platform === "win32") await checkWindowsLinks(full);
  const resolved = await fs.realpath(full);
  assertLocalPath(resolved);
  const info = await fs.stat(resolved);
  if (!info.isFile() && !info.isDirectory()) throw new Error("the path is not a file or folder");
  return { path: resolved, info, canOpen: info.isFile() && canOpenResolvedFile(path, resolved, process.platform, info.mode) };
}

export async function validatedLocalFilePath(path: unknown): Promise<string> {
  return (await inspectLocalFile(path)).path;
}

export async function localFileOpenInfo(hostId: unknown, path: unknown): Promise<{ canOpen: boolean }> {
  if (hostId !== LOCAL_HOST_ID) throw new Error("remote host files are not on this machine");
  try { return { canOpen: (await inspectLocalFile(path)).canOpen }; }
  catch { return { canOpen: false }; }
}

export async function localFileAction(hostId: unknown, path: unknown, action: unknown, shell: { showItemInFolder(path: string): void; openPath(path: string): Promise<string> }): Promise<void> {
  if (hostId !== LOCAL_HOST_ID) throw new Error("remote host files are not on this machine");
  if (action !== "reveal" && action !== "open") throw new Error("unknown local file action");
  const file = await inspectLocalFile(path);
  if (action === "reveal") shell.showItemInFolder(file.path);
  else {
    if (!file.canOpen) throw new Error("executable files, scripts and application shortcuts cannot be opened");
    const error = await shell.openPath(file.path);
    if (error) throw new Error(error);
  }
}
