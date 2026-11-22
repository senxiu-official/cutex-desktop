import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse, resolve, sep } from "node:path";
import { LOCAL_HOST_ID } from "../shared/hosts";
import { fileOpenKind, isAbsoluteFilePath, type FileOpenKind } from "../shared/localFiles";

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
  const kind: FileOpenKind | null = info.isFile() ? fileOpenKind(path, resolved, process.platform, info.mode) : null;
  return { path: resolved, info, kind, canOpen: kind === "document" };
}

export async function validatedLocalFilePath(path: unknown): Promise<string> {
  return (await inspectLocalFile(path)).path;
}

/** `runnable`: a script or program that 打开 refuses; 运行… may run it after main's own dialog. */
export async function localFileOpenInfo(hostId: unknown, path: unknown): Promise<{ canOpen: boolean; runnable?: "script" | "program" }> {
  if (hostId !== LOCAL_HOST_ID) throw new Error("remote host files are not on this machine");
  try {
    const file = await inspectLocalFile(path);
    return file.kind === "script" || file.kind === "program" ? { canOpen: false, runnable: file.kind } : { canOpen: file.canOpen };
  } catch { return { canOpen: false }; }
}

/**
 * What a file 运行… confirmed is: its identity (volume + file id; Windows file ids need bigint), size, times and
 * the SHA-256 of its contents, streamed (any size: a large installer is hashed, never refused or skipped). A
 * same-length rewrite with restored times, or an atomic replace, differs; a change while hashing refuses.
 */
async function runFingerprint(path: string, signal?: AbortSignal): Promise<string> {
  const info = await fs.stat(path, { bigint: true });
  const hash = createHash("sha256");
  // Windows refuses to replace or delete a file while any handle has it open, so the owner (or an editor) could not
  // save the script while it is being hashed: one handle, open only for the read, closed (awaited) on every path —
  // done, read error, or the dialog cancelled (`signal`) — before this returns.
  signal?.throwIfAborted();
  const handle = await fs.open(path, "r");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) hash.update(chunk as Buffer);
  } finally { await handle.close(); }
  const after = await fs.stat(path, { bigint: true });
  const id = (x: typeof info) => [x.dev, x.ino, x.size, x.mtimeNs, x.ctimeNs].join(":");
  if (id(after) !== id(info)) throw new Error("the file changed while it was being checked; nothing was run");
  return `${id(info)}:${hash.digest("hex")}`;
}

/** What main's run dialog names (the full real path and the type); true only on the owner's explicit 运行. */
export type ConfirmRun = (file: { path: string; kind: "script" | "program" }) => Promise<boolean>;

/**
 * reveal / open / run of a local file. `open` opens documents only. `run` (a script or program) asks the owner first in
 * main's own native dialog (`confirmRun`; the renderer cannot answer or skip it), then checks the file again: one that
 * changed while the dialog was open (another target, type, file identity, size, time or contents —
 * runFingerprint) is not run.
 */
export async function localFileAction(hostId: unknown, path: unknown, action: unknown, shell: { showItemInFolder(path: string): void; openPath(path: string): Promise<string> }, confirmRun?: ConfirmRun): Promise<void> {
  if (hostId !== LOCAL_HOST_ID) throw new Error("remote host files are not on this machine");
  if (action !== "reveal" && action !== "open" && action !== "run") throw new Error("unknown local file action");
  const file = await inspectLocalFile(path);
  if (action === "reveal") return shell.showItemInFolder(file.path);
  if (action === "open") {
    if (!file.canOpen) throw new Error("executable files, scripts and application shortcuts cannot be opened");
  } else {
    if (file.kind !== "script" && file.kind !== "program") throw new Error("only a script or program can be run; open other files instead");
    if (!confirmRun) throw new Error("running files is unavailable here");
    // The fingerprint of the file as the dialog opens is hashed while the dialog is up, so a large installer does
    // not delay it; its result (or its refusal) is awaited before anything runs.
    // Cancelled (or the dialog failing): the read stops, and its handle is closed before this returns.
    const stop = new AbortController();
    const hashing = runFingerprint(file.path, stop.signal);
    hashing.catch(() => {});
    let ok = false;
    try { ok = await confirmRun({ path: file.path, kind: file.kind }); } finally {
      if (!ok) { stop.abort(); await hashing.catch(() => {}); }
    }
    if (!ok) return;
    const confirmed = await hashing;
    const again = await inspectLocalFile(path);
    if (again.path !== file.path || again.kind !== file.kind || (await runFingerprint(again.path)) !== confirmed) {
      throw new Error("the file changed while the dialog was open; nothing was run");
    }
  }
  const error = await shell.openPath(file.path);
  if (error) throw new Error(error);
}
