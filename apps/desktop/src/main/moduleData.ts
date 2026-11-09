// A module's own data folder, userData/module-data/<id>/, and the native file pick / save (docs/desktop-modules.md §30.6).
// The renderer names an id and a relative path; main checks both, stays inside the folder (no links, no `..`, no device
// names), keeps to the limits and answers with bytes. Picked and saved files are read and written here: their paths never
// leave main. Nothing here deletes a module's data unless the owner said so in main's own dialog.
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { basename, join, sep } from "node:path";
import { MODULE_ID_RE } from "@cutex-desktop/plugin-sdk";
import { MODULE_DATA_LIMITS, parseDataPath, type FileFilterInput, type ModuleDataEntryView, type ModuleDataErrorCode, type ModuleDataFolderView, type ModuleDataUsage } from "../shared/moduleData";

export class ModuleDataError extends Error {
  constructor(readonly code: ModuleDataErrorCode, message: string) {
    super(`${code}: ${message}`);
  }
}

/** Main's own dialogs (main/moduleDataPrompts.ts). A path comes back only from the owner's choice. */
export interface ModuleDataPrompts {
  pickFile(id: string, filters: FileFilterInput[]): Promise<string | null>;
  saveFile(id: string, suggestedName: string | null, filters: FileFilterInput[]): Promise<string | null>;
  /** Deleting a module's data from Settings. */
  confirmClear(id: string, bytes: number): Promise<boolean>;
}

export interface ModuleDataOptions {
  /** userData/module-data */
  root: string;
  /** A module main knows: built in, installed, or loaded from a folder. Others get `unknown_module`. */
  known(id: string): boolean;
  prompts: ModuleDataPrompts;
  limits?: Partial<Record<keyof typeof MODULE_DATA_LIMITS, number>>;
}

const TEMP_PREFIX = ".tmp-";

export class ModuleDataService {
  private readonly limits: Record<keyof typeof MODULE_DATA_LIMITS, number>;
  private readonly queues = new Map<string, Promise<unknown>>();
  private dialog = false;

  constructor(private readonly opts: ModuleDataOptions) {
    this.limits = { ...MODULE_DATA_LIMITS, ...opts.limits };
  }

  // ---- the module's own calls ----

  read(id: string, path: string): Promise<Uint8Array | null> {
    return this.queue(id, () => {
      const target = this.resolve(id, path, false);
      const st = lstatOrNull(target);
      if (!st) return null;
      this.plainFile(st, path);
      if (st.size > this.limits.fileBytes) throw new ModuleDataError("too_large", `${path} is larger than ${this.limits.fileBytes} bytes`);
      return new Uint8Array(readFileSync(target));
    });
  }

  write(id: string, path: string, data: Uint8Array): Promise<void> {
    return this.queue(id, () => {
      if (data.byteLength > this.limits.fileBytes) throw new ModuleDataError("too_large", `a file can hold ${this.limits.fileBytes} bytes`);
      const parts = this.parts(path, false);
      const dir = this.folder(id, true);
      // Folders on the way: made here if missing, never a link or a file.
      let parent = dir;
      for (const part of parts.slice(0, -1)) {
        parent = join(parent, part);
        const st = lstatOrNull(parent);
        if (!st) continue;
        if (st.isSymbolicLink()) throw new ModuleDataError("invalid", `${path} goes through a link`);
        if (!st.isDirectory()) throw new ModuleDataError("invalid", `${path} goes through a file`);
      }
      const target = join(dir, ...parts);
      const old = lstatOrNull(target);
      if (old) this.plainFile(old, path);
      const usage = this.measure(dir);
      const created = parts.slice(0, -1).reduce((n, _p, i) => n + (lstatOrNull(join(dir, ...parts.slice(0, i + 1))) ? 0 : 1), old ? 0 : 1);
      if (usage.entries + created > this.limits.entries) throw new ModuleDataError("quota_exceeded", `a module's folder can hold ${this.limits.entries} files and folders`);
      if (usage.bytes - (old?.size ?? 0) + data.byteLength > this.limits.moduleBytes) {
        throw new ModuleDataError("quota_exceeded", `a module's folder can hold ${this.limits.moduleBytes} bytes; ${usage.bytes} are used`);
      }
      mkdirSync(join(dir, ...parts.slice(0, -1)), { recursive: true });
      this.inside(dir, join(dir, ...parts.slice(0, -1)), path);
      const temp = join(dir, ...parts.slice(0, -1), `${TEMP_PREFIX}${randomBytes(6).toString("hex")}`);
      try {
        writeFileSync(temp, data, { flag: "wx" });
        renameSync(temp, target);
      } catch (error) {
        rmSync(temp, { force: true });
        throw error;
      }
    });
  }

  remove(id: string, path: string): Promise<void> {
    return this.queue(id, () => {
      const target = this.resolve(id, path, false, true);
      const st = lstatOrNull(target);
      if (!st) return;
      // rmSync takes a link away without following it.
      rmSync(target, { recursive: st.isDirectory() && !st.isSymbolicLink(), force: true });
    });
  }

  list(id: string, path: string): Promise<ModuleDataEntryView[]> {
    return this.queue(id, () => {
      const target = this.resolve(id, path, true);
      const st = lstatOrNull(target);
      if (!st) {
        if (path === "") return [];
        throw new ModuleDataError("not_found", `there is no folder ${path}`);
      }
      if (!st.isDirectory() || st.isSymbolicLink()) throw new ModuleDataError("invalid", `${path} is not a folder`);
      const out: ModuleDataEntryView[] = [];
      for (const name of readdirSync(target).sort()) {
        if (!parseDataPath(name)) continue;
        const e = lstatOrNull(join(target, name));
        if (!e || e.isSymbolicLink()) continue;
        if (e.isDirectory()) out.push({ name, kind: "folder", size: 0, modified: e.mtimeMs });
        else if (e.isFile()) out.push({ name, kind: "file", size: e.size, modified: e.mtimeMs });
      }
      return out;
    });
  }

  usage(id: string): Promise<ModuleDataUsage> {
    return this.queue(id, () => {
      const dir = this.folder(id, false);
      return { used: dir ? this.measure(dir).bytes : 0, limit: this.limits.moduleBytes, fileLimit: this.limits.fileBytes };
    });
  }

  /** Main's open dialog. The module gets the chosen file's bytes and base name, nothing else. */
  async pick(id: string, filters: FileFilterInput[]): Promise<{ name: string; data: Uint8Array } | null> {
    this.knownOrThrow(id);
    const path = await this.withDialog(() => this.opts.prompts.pickFile(id, filters));
    if (!path) return null;
    const st = statSync(path);
    if (!st.isFile()) throw new ModuleDataError("invalid", "that is not a file");
    if (st.size > this.limits.fileBytes) throw new ModuleDataError("too_large", `a picked file can be ${this.limits.fileBytes} bytes at most`);
    return { name: basename(path), data: new Uint8Array(readFileSync(path)) };
  }

  /** Main's save dialog; main writes the bytes where the owner chose. */
  async save(id: string, data: Uint8Array, suggestedName: string | null, filters: FileFilterInput[]): Promise<{ name: string } | null> {
    this.knownOrThrow(id);
    if (data.byteLength > this.limits.fileBytes) throw new ModuleDataError("too_large", `a saved file can be ${this.limits.fileBytes} bytes at most`);
    const path = await this.withDialog(() => this.opts.prompts.saveFile(id, suggestedName, filters));
    if (!path) return null;
    writeFileSync(path, data);
    return { name: basename(path) };
  }

  // ---- Settings and removal ----

  /** Every module folder, known module or not, with its size. */
  folders(): ModuleDataFolderView[] {
    let names: string[] = [];
    try {
      names = readdirSync(this.opts.root);
    } catch {
      return [];
    }
    const out: ModuleDataFolderView[] = [];
    for (const id of names.sort()) {
      if (!MODULE_ID_RE.test(id)) continue;
      const st = lstatOrNull(join(this.opts.root, id));
      if (!st || !st.isDirectory() || st.isSymbolicLink()) continue;
      out.push({ id, bytes: this.measure(join(this.opts.root, id)).bytes, known: this.opts.known(id) });
    }
    return out;
  }

  /** Bytes in a module's folder; 0 when there is none. */
  bytes(id: string): number {
    if (!MODULE_ID_RE.test(id)) return 0;
    const st = lstatOrNull(join(this.opts.root, id));
    return st && st.isDirectory() && !st.isSymbolicLink() ? this.measure(join(this.opts.root, id)).bytes : 0;
  }

  /** Whether a module has a folder at all (an empty one counts: the owner still decides). */
  has(id: string): boolean {
    if (!MODULE_ID_RE.test(id)) return false;
    const st = lstatOrNull(join(this.opts.root, id));
    return !!st && st.isDirectory() && !st.isSymbolicLink();
  }

  /** Deletes a module's folder. Callers ask the owner first (clear, or the removal dialog). */
  delete(id: string): Promise<void> {
    if (!MODULE_ID_RE.test(id)) return Promise.resolve();
    return this.queue(id, () => {
      const dir = join(this.opts.root, id);
      const st = lstatOrNull(dir);
      if (st) rmSync(dir, { recursive: st.isDirectory() && !st.isSymbolicLink(), force: true });
    }, true);
  }

  /** Settings → Modules → Module data → Delete: main's own dialog, then the folder goes. */
  async clear(id: string): Promise<boolean> {
    if (!this.has(id)) return false;
    const yes = await this.withDialog(() => this.opts.prompts.confirmClear(id, this.bytes(id)));
    if (!yes) return false;
    await this.delete(id);
    return true;
  }

  // ---- helpers ----

  private queue<T>(id: string, run: () => T, anyId = false): Promise<T> {
    if (!anyId) {
      try {
        this.knownOrThrow(id);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    const tail = next.catch(() => {});
    this.queues.set(id, tail);
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    });
    return next;
  }

  private knownOrThrow(id: string): void {
    if (!MODULE_ID_RE.test(id) || !this.opts.known(id)) throw new ModuleDataError("unknown_module", `${id} is not a module this app runs`);
  }

  private async withDialog<T>(run: () => Promise<T>): Promise<T> {
    if (this.dialog) throw new ModuleDataError("busy", "another file dialog is open");
    this.dialog = true;
    try {
      return await run();
    } finally {
      this.dialog = false;
    }
  }

  private parts(path: string, allowRoot: boolean): string[] {
    const parts = parseDataPath(path, allowRoot);
    if (!parts) throw new ModuleDataError("invalid", `${JSON.stringify(path.slice(0, 80))} is not a path inside the module's folder`);
    return parts;
  }

  /** The module's folder; made when `create`. Never a link, and really under the root. */
  private folder(id: string, create: true): string;
  private folder(id: string, create: false): string | null;
  private folder(id: string, create: boolean): string | null {
    const root = this.opts.root;
    for (const dir of [root, join(root, id)]) {
      const st = lstatOrNull(dir);
      if (!st) {
        if (!create) return null;
        // The root is main's own path, so its parents may be made too; the module folder only under it.
        mkdirSync(dir, { recursive: dir === root });
        continue;
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw new ModuleDataError("invalid", "the module data folder is a link or a file");
    }
    const dir = join(root, id);
    this.inside(realpathSync(root), dir, id);
    return dir;
  }

  /** `path` (resolved) is `dir` or under it, links resolved. */
  private inside(dir: string, path: string, label: string): void {
    const base = realpathSync(dir);
    const real = realpathSync(path);
    if (real !== base && !real.startsWith(base.endsWith(sep) ? base : base + sep)) throw new ModuleDataError("invalid", `${label} is outside the module's folder`);
  }

  /** The target of a path; every part on the way that exists must be a plain folder, the last not a link unless `lastMayBeLink` (removing one). */
  private resolve(id: string, path: string, allowRoot: boolean, lastMayBeLink = false): string {
    const parts = this.parts(path, allowRoot);
    const dir = this.folder(id, false);
    if (!dir) return join(this.opts.root, id, ...parts);
    let at = dir;
    for (const [i, part] of parts.entries()) {
      at = join(at, part);
      const st = lstatOrNull(at);
      if (!st) return join(dir, ...parts);
      if (st.isSymbolicLink() && !(lastMayBeLink && i === parts.length - 1)) throw new ModuleDataError("invalid", `${path} is or goes through a link`);
      if (i < parts.length - 1 && !st.isDirectory()) throw new ModuleDataError("not_found", `${path}: ${parts.slice(0, i + 1).join("/")} is a file`);
    }
    return at;
  }

  private plainFile(st: Stats, path: string): void {
    if (st.isSymbolicLink()) throw new ModuleDataError("invalid", `${path} is a link`);
    if (!st.isFile()) throw new ModuleDataError("invalid", `${path} is a folder`);
    // A hard link would let a write reach a file outside the folder.
    if (st.nlink > 1) throw new ModuleDataError("invalid", `${path} has other names (hard links)`);
  }

  /** Bytes and entries under a folder, links counted but never followed; stops counting past the entry limit. */
  private measure(dir: string): { bytes: number; entries: number } {
    let bytes = 0;
    let entries = 0;
    const stack = [dir];
    while (stack.length && entries <= this.limits.entries) {
      const at = stack.pop()!;
      let names: string[];
      try {
        names = readdirSync(at);
      } catch {
        continue;
      }
      for (const name of names) {
        const st = lstatOrNull(join(at, name));
        if (!st) continue;
        entries += 1;
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) stack.push(join(at, name));
        else bytes += st.size;
      }
    }
    return { bytes, entries };
  }
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
