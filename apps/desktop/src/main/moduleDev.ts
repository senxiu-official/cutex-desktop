// Developer mode for modules (docs/desktop-modules.md §30.5). Main decides everything: the switch and each folder go through
// its own native dialogs, it reads the folder's dist/ and serves only that build's files, from memory, as
// cutex-module://dev/<id>/<rev>/<file>. The build tool writes dist/pack.json last, so a change of that file means a whole
// build is there. A build that cannot be read keeps the last good one loaded.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { isPackModuleId, LIMITS, MODULE_PACK_SCHEME, packCompat, parsePackVersion } from "../shared/modulePacks";
import type { DevModuleView, ModuleDevView } from "../shared/moduleDev";
import { cleanDialogText } from "./localModulePrompts";

export const MODULE_DEV_HOST = "dev";
const POLL_MS = 400;

export interface ModuleDevPrompts {
  confirmEnable(): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  confirmFolder(folder: string): Promise<boolean>;
}

export interface ModuleDevOptions {
  file: string;
  appModuleApi: string;
  /** Ids a folder may not use: the modules built into the app. */
  reservedIds: readonly string[];
  /** Started with LOCAL_SAFE_START_ARG. */
  skip?: boolean;
  /** A dev build: folder modules reading beyond the public API load, tagged (§30.4). */
  internal?: boolean;
  prompts: ModuleDevPrompts;
  onChange?(view: ModuleDevView): void;
  pollMs?: number;
}

interface Loaded {
  id: string;
  version: string;
  moduleApi: string;
  rev: number;
  hash: string;
  styles: string[];
  host: Record<string, string[]>;
  files: Map<string, Buffer>;
}

interface Folder {
  folder: string;
  stamp: number | null;
  loaded: Loaded | null;
  error: Fault | null;
  /** The renderer could not run this rev. */
  loadError: { rev: number; error: string } | null;
}

/** A reason the app words itself: the text for logs and tests, the message key for Settings. */
class DevFault extends Error {
  constructor(
    message: string,
    readonly key: string,
    readonly vars: Record<string, string> = {},
  ) {
    super(message);
  }
}
interface Fault {
  text: string;
  key?: string;
  vars?: Record<string, string>;
}
const faultOf = (error: unknown): Fault => (error instanceof DevFault ? { text: error.message, key: error.key, vars: error.vars } : { text: error instanceof Error ? error.message : String(error) });

/** Reads a build, all or nothing. */
export function readDevBuild(folder: string, appModuleApi: string, reservedIds: readonly string[]): Omit<Loaded, "rev"> {
  const dist = join(folder, "dist");
  const read = (name: string) => {
    const data = readFileSync(join(dist, name));
    if (data.length > LIMITS.fileBytes) throw new Error(`dist/${name} is too large`);
    return data;
  };
  const manifestBytes = read("pack.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
  if (!isPackModuleId(manifest.id)) throw new Error(`dist/pack.json: bad id ${JSON.stringify(manifest.id)}`);
  if (reservedIds.includes(manifest.id)) throw new DevFault(`the id ${manifest.id} belongs to a module built into the app`, "modules.dev.err.builtIn", { id: manifest.id });
  if (!parsePackVersion(manifest.version)) throw new Error("dist/pack.json: bad version");
  if (typeof manifest.moduleApi !== "string") throw new Error("dist/pack.json: no moduleApi");
  const compat = packCompat(manifest.moduleApi, appModuleApi);
  if (compat !== "ok") {
    const vars = { range: manifest.moduleApi, app: appModuleApi };
    throw compat === "needsNewerApp" ? new DevFault(`it needs a newer app: moduleApi ${manifest.moduleApi}, this app has ${appModuleApi}`, "modules.dev.err.newerApp", vars) : new DevFault(`it needs updating: moduleApi ${manifest.moduleApi}, this app has ${appModuleApi}`, "modules.dev.err.needsUpdate", vars);
  }
  if (manifest.entry !== "index.js") throw new Error("dist/pack.json: the entry must be index.js");
  const styles = manifest.styles as unknown;
  if (!Array.isArray(styles) || styles.some((s) => s !== "index.css")) throw new Error("dist/pack.json: bad styles");
  const host = manifest.host as Record<string, string[]>;
  if (!host || typeof host !== "object" || Array.isArray(host)) throw new Error("dist/pack.json: bad host list");
  const files = new Map<string, Buffer>([["index.js", read("index.js")]]);
  for (const name of styles as string[]) files.set(name, read(name));
  const hash = createHash("sha256");
  for (const [name, data] of [...files, ["pack.json", manifestBytes] as const]) hash.update(name).update(data);
  return { id: manifest.id, version: manifest.version as string, moduleApi: manifest.moduleApi, hash: hash.digest("hex"), styles: styles as string[], host, files };
}

export class ModuleDevService {
  private enabled = false;
  private folders: Folder[] = [];
  private nextRev = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly opts: ModuleDevOptions) {
    try {
      const saved = JSON.parse(readFileSync(opts.file, "utf8")) as { enabled?: unknown; folders?: unknown };
      this.enabled = saved.enabled === true;
      if (Array.isArray(saved.folders)) this.folders = saved.folders.filter((f): f is string => typeof f === "string").map((folder) => ({ folder, stamp: null, loaded: null, error: null, loadError: null }));
    } catch {
      // no file yet, or unreadable: off
    }
    this.follow();
  }

  private running(): boolean {
    return this.enabled && !this.opts.skip;
  }

  private save(): void {
    mkdirSync(dirname(this.opts.file), { recursive: true });
    const tmp = `${this.opts.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ enabled: this.enabled, folders: this.folders.map((f) => f.folder) }, null, 2));
    renameSync(tmp, this.opts.file);
  }

  private follow(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.running()) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? POLL_MS);
    this.timer.unref?.();
  }

  /** Looks at each folder's dist/pack.json; reads a build when it changed. */
  poll(): void {
    let changed = false;
    for (const f of this.folders) {
      let stamp: number | null = null;
      try {
        stamp = statSync(join(f.folder, "dist", "pack.json")).mtimeMs;
      } catch {
        // not built yet
      }
      if (stamp === f.stamp) continue;
      f.stamp = stamp;
      if (stamp === null) {
        if (!f.loaded && !f.error) continue;
        f.error = { text: "no build in dist/ (run cutex-module build)", key: "modules.dev.err.noBuild" };
        changed = true;
        continue;
      }
      changed = this.read(f) || changed;
    }
    if (changed) this.opts.onChange?.(this.view());
  }

  private read(f: Folder): boolean {
    try {
      const build = readDevBuild(f.folder, this.opts.appModuleApi, this.opts.reservedIds);
      const other = this.folders.find((o) => o !== f && o.loaded?.id === build.id);
      if (other) throw new DevFault(`the id ${build.id} is already loaded from ${other.folder}`, "modules.dev.err.sameId", { id: build.id, folder: other.folder });
      f.error = null;
      if (f.loaded?.hash !== build.hash) {
        f.loaded = { ...build, rev: this.nextRev++ };
        f.loadError = null;
      }
      return true;
    } catch (error) {
      f.error = faultOf(error);
      return true;
    }
  }

  /** Ids of the builds loaded from folders now (module data, §30.6). */
  ids(): string[] {
    return this.running() ? this.folders.flatMap((f) => (f.loaded ? [f.loaded.id] : [])) : [];
  }

  view(): ModuleDevView {
    const running = this.running();
    return {
      enabled: this.enabled,
      internal: !!this.opts.internal,
      skipped: !!this.opts.skip,
      modules: this.folders.map((f): DevModuleView => {
        const l = running ? f.loaded : null;
        const loadError = f.loadError && f.loadError.rev === l?.rev ? f.loadError.error : null;
        return {
          folder: f.folder,
          id: l?.id ?? null,
          version: l?.version ?? null,
          moduleApi: l?.moduleApi ?? null,
          rev: l?.rev ?? 0,
          entry: l ? `${MODULE_PACK_SCHEME}://${MODULE_DEV_HOST}/${l.id}/${l.rev}/index.js` : null,
          styles: l ? l.styles.map((s) => `${MODULE_PACK_SCHEME}://${MODULE_DEV_HOST}/${l.id}/${l.rev}/${s}`) : [],
          host: l?.host ?? {},
          error: loadError ?? f.error?.text ?? null,
          ...(!loadError && f.error?.key ? { errorKey: f.error.key, errorVars: f.error.vars ?? {} } : {}),
        };
      }),
    };
  }

  async setEnabled(enabled: boolean): Promise<ModuleDevView> {
    if (enabled && !this.enabled && !(await this.opts.prompts.confirmEnable())) return this.view();
    this.enabled = enabled;
    this.save();
    this.follow();
    return this.changed();
  }

  async addFolder(): Promise<ModuleDevView> {
    if (!this.running() || this.busy) return this.view();
    this.busy = true;
    try {
      const folder = await this.opts.prompts.pickFolder();
      if (!folder || this.folders.some((f) => f.folder === folder)) return this.view();
      if (!(await this.opts.prompts.confirmFolder(folder))) return this.view();
      this.folders.push({ folder, stamp: null, loaded: null, error: null, loadError: null });
      this.save();
      this.poll();
      return this.changed();
    } finally {
      this.busy = false;
    }
  }

  removeFolder(folder: string): ModuleDevView {
    const next = this.folders.filter((f) => f.folder !== folder);
    if (next.length !== this.folders.length) {
      this.folders = next;
      this.save();
    }
    return this.changed();
  }

  /** The renderer's result of loading a rev. Only says why it did not run; never loads anything. */
  report(folder: string, rev: number, error: string | null): ModuleDevView {
    const f = this.folders.find((o) => o.folder === folder);
    if (f && f.loaded?.rev === rev) f.loadError = error === null ? null : { rev, error };
    return this.changed();
  }

  private changed(): ModuleDevView {
    const view = this.view();
    this.opts.onChange?.(view);
    return view;
  }

  /** The cutex-module:// handler for the `dev` host: a file of a build this service holds; 404 for anything else. */
  respond(request: Request): Response {
    const notFound = () => new Response("not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    if (request.method !== "GET" || !this.running()) return notFound();
    const url = new URL(request.url);
    const [id, rev, name, ...rest] = url.pathname.split("/").filter(Boolean);
    if (url.search || rest.length || !id || !rev || !name) return notFound();
    const loaded = this.folders.find((f) => f.loaded?.id === id && String(f.loaded.rev) === rev)?.loaded;
    const data = loaded?.files.get(name);
    if (!data) return notFound();
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Main's own dialogs. Nothing here comes from the renderer. */
export function moduleDevPrompts(window: () => BrowserWindow | null, locale: () => string): ModuleDevPrompts {
  const zh = () => locale().startsWith("zh");
  const power = () => (zh()
    ? "从文件夹加载的模块没有签名，会以 Cutex 本身的权限运行：能看到你在应用里能看到的所有内容，能以你的名义给智能体发消息，能在已连接的主机上运行命令。文件夹里的内容一变，就会自动换上新的。只加载你自己写的或信任的代码。"
    : "A module loaded from a folder is not signed and runs with Cutex's own permissions: it can see everything you can see in the app, send messages to agents as you, and run commands on connected hosts. When the folder changes, the new code loads by itself. Only load code you wrote or trust.");
  const ask = async (title: string, message: string, detail: string, yes: string) => {
    const options = { type: "warning" as const, title, message, detail, buttons: [zh() ? "取消" : "Cancel", yes], defaultId: 0, cancelId: 0, noLink: true };
    const win = window();
    return (await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))).response === 1;
  };
  return {
    confirmEnable: () => ask(zh() ? "模块开发者模式" : "Module developer mode", zh() ? "打开模块开发者模式？" : "Turn on module developer mode?", power(), zh() ? "打开" : "Turn on"),
    async pickFolder() {
      const options = { title: zh() ? "选择模块文件夹" : "Choose a module folder", properties: ["openDirectory" as const] };
      const win = window();
      const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    confirmFolder: (folder) => ask(zh() ? "从文件夹加载模块" : "Load a module from a folder", zh() ? "加载这个文件夹里的模块？" : "Load the module in this folder?", `${cleanDialogText(folder, 200)}\n\n${power()}`, zh() ? "加载" : "Load"),
  };
}
