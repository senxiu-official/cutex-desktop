// Settings → 外观 → 启动页立绘 (shared/launchArt.ts): imported launcher artwork in `<userData>/launcher-art/`.
// Import reads only the exact LAUNCH_ART_FILES names of the folder the owner picked in main's own folder
// dialog (other names, sub-folders and path tricks never come into play: the names are constants), and
// accepts a file only when it is a regular file — not a symlink — of at most LAUNCH_ART_MAX_BYTES that
// starts with the PNG signature. A provider is imported only with both of its files; its copies replace
// that provider's earlier import (written to a temp name, then renamed). Reading the store back for the
// renderer applies the same checks, so a file swapped in by hand is never served unchecked.
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  isPng,
  LAUNCH_ART_FILES,
  LAUNCH_ART_MAX_BYTES,
  LAUNCH_ART_PROVIDERS,
  type LaunchArtImages,
  type LaunchArtImportResult,
  type LaunchArtProvider,
  type LaunchArtRefusal,
  type LaunchArtRequest,
  type LaunchArtState,
} from "../shared/launchArt";

type ReadResult = { kind: "ok"; bytes: Buffer } | { kind: "missing" } | { kind: "refused"; reason: LaunchArtRefusal };

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

/** One launcher image: a regular PNG file within the cap, read without following a symlink. */
export async function readLaunchArtFile(path: string, maxBytes = LAUNCH_ART_MAX_BYTES): Promise<ReadResult> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "refused", reason: "unreadable" };
  }
  if (info.isSymbolicLink()) return { kind: "refused", reason: "symlink" };
  if (!info.isFile()) return { kind: "refused", reason: "notFile" };
  if (info.size > maxBytes) return { kind: "refused", reason: "tooLarge" };
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  } catch {
    return { kind: "refused", reason: "unreadable" };
  }
  try {
    // The same file lstat saw (not replaced between the two calls).
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) return { kind: "refused", reason: "unreadable" };
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) return { kind: "refused", reason: "tooLarge" };
    const bytes = buffer.subarray(0, length);
    return isPng(bytes) ? { kind: "ok", bytes: Buffer.from(bytes) } : { kind: "refused", reason: "notPng" };
  } catch {
    return { kind: "refused", reason: "unreadable" };
  } finally {
    await handle.close().catch(() => {});
  }
}

export class LaunchArtStore {
  constructor(
    private readonly dir: string,
    private readonly maxBytes = LAUNCH_ART_MAX_BYTES,
  ) {}

  /** The imported art: complete, valid providers only, as data URLs. */
  async state(): Promise<LaunchArtState> {
    const imported: LaunchArtImages = {};
    for (const provider of LAUNCH_ART_PROVIDERS) {
      const files = LAUNCH_ART_FILES[provider];
      const [portrait, victory] = await Promise.all([readLaunchArtFile(join(this.dir, files.portrait), this.maxBytes), readLaunchArtFile(join(this.dir, files.victory), this.maxBytes)]);
      if (portrait.kind === "ok" && victory.kind === "ok") imported[provider] = { portrait: dataUrl(portrait.bytes), victory: dataUrl(victory.bytes) };
    }
    return { imported };
  }

  async importFrom(folder: string): Promise<Omit<LaunchArtImportResult, "canceled">> {
    if (typeof folder !== "string" || !isAbsolute(folder)) throw new Error("launch art: the folder must be an absolute path");
    const imported: LaunchArtProvider[] = [];
    const incomplete: LaunchArtProvider[] = [];
    const refused: LaunchArtImportResult["refused"] = [];
    const staged: { name: string; bytes: Buffer }[] = [];
    for (const provider of LAUNCH_ART_PROVIDERS) {
      const files = LAUNCH_ART_FILES[provider];
      const results = await Promise.all([files.portrait, files.victory].map(async (name) => ({ name, result: await readLaunchArtFile(join(folder, name), this.maxBytes) })));
      for (const { name, result } of results) if (result.kind === "refused") refused.push({ file: name, reason: result.reason });
      const ok = results.flatMap(({ name, result }) => (result.kind === "ok" ? [{ name, bytes: result.bytes }] : []));
      if (ok.length === 2) {
        staged.push(...ok);
        imported.push(provider);
      } else if (results.some(({ result }) => result.kind !== "missing")) incomplete.push(provider);
    }
    if (staged.length > 0) {
      await mkdir(this.dir, { recursive: true });
      for (const { name, bytes } of staged) {
        const temp = join(this.dir, `.${name}.${randomBytes(6).toString("hex")}.tmp`);
        await writeFile(temp, bytes, { flag: "wx" });
        await rename(temp, join(this.dir, name));
      }
    }
    return { imported, incomplete, refused, state: await this.state() };
  }

  /** Removes the launcher files (only those names) and the folder once it is empty. */
  async clear(): Promise<LaunchArtState> {
    for (const provider of LAUNCH_ART_PROVIDERS) {
      for (const name of [LAUNCH_ART_FILES[provider].portrait, LAUNCH_ART_FILES[provider].victory]) await rm(join(this.dir, name), { force: true });
    }
    await rmdir(this.dir).catch(() => {});
    return this.state();
  }
}

function dataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** The channel's ops; `pickFolder` is main's native folder dialog (null = cancelled). */
export async function handleLaunchArtRequest(store: LaunchArtStore, request: LaunchArtRequest, pickFolder: () => Promise<string | null>): Promise<LaunchArtState | LaunchArtImportResult> {
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== 1) throw new Error("unknown launch-art op");
  switch (request.op) {
    case "state":
      return store.state();
    case "import": {
      const folder = await pickFolder();
      if (folder === null) return { canceled: true, imported: [], incomplete: [], refused: [], state: await store.state() };
      return { canceled: false, ...(await store.importFrom(folder)) };
    }
    case "clear":
      return store.clear();
    default:
      throw new Error("unknown launch-art op");
  }
}
