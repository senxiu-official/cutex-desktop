// Signed first-party module packs, main process side (docs/desktop-modules.md §23.4–§23.5).
//
// check   : download modules.json + .minisig from the modules-release GitHub release, verify the minisign
//           signature with the embedded release keys (+ the test key in an unpackaged app), parse it
//           strictly, refuse an index older (serial) than one already seen.
// install : download the pack archive, check its sha256, unpack it in memory (strict tar: regular files
//           only, exactly the listed files, each size + sha256), write it to a staging dir with the signed
//           index next to it (.signed/), rename it to <root>/<id>/<version> (atomic on one volume), then
//           point state.json at it. A version below the installed one needs the owner's explicit choice.
// start   : every installed version is verified again (signature of its stored index, exact file set,
//           sha256 of every file) before anything is served; leftovers of an interrupted install go.
// serve   : cutex-module://pack/<id>/<version>/<path> — only files of a verified pack, hashed again on
//           every read.
// The renderer never names a path, URL or key: it asks for state / check / install / remove (by id).
import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { download } from "./binaryUpdate";
import { parsePublicKey, releaseKeyring, verifyData, type MinisignPublicKey } from "./minisign";
import { ProxyAuthError, type Transport, type TransportResponse } from "./updateTransport";
import { downloadUrlAllowed, githubRepoOf, GITHUB_WEB } from "../shared/binaryUpdate";
import {
  comparePackVersions,
  DEFAULT_MODULES_REPO,
  isPackModuleId,
  LIMITS,
  MODULE_PACK_SCHEME,
  MODULE_PACK_TEST_PUBLIC_KEY,
  MODULES_INDEX_FILE,
  MODULES_RELEASE_TAG,
  PACK_PATH_RE,
  packCompat,
  packFileUrl,
  parseModuleIndex,
  parsePackVersion,
  SIGNED_DIR,
  type InstalledPackView,
  type ModuleIndex,
  type ModuleIndexPack,
  type ModulePacksView,
  type PackStep,
} from "../shared/modulePacks";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "cutex-desktop-modules";
const STATE_FILE = "state.json";

export interface ModulePackSource {
  indexUrl: string;
  signatureUrl: string;
  /** Origins allowed besides GitHub's download hosts (dev / test runs only: a loopback fixture). */
  extraOrigins: string[];
  keys: MinisignPublicKey[];
  testKey: boolean;
}

/**
 * Where the index comes from and which keys sign it. The repo is the one the install's release page
 * names (as for binary updates), else the public desktop repo. The test key and a loopback index
 * (CUTEX_DESKTOP_MODULES_INDEX=http://127.0.0.1:<port>/…/modules.json) only in an unpackaged app.
 */
export function modulePackSource(opts: { releasePage: string | null; packaged: boolean; env?: NodeJS.ProcessEnv }): ModulePackSource {
  const repo = githubRepoOf(opts.releasePage) ?? DEFAULT_MODULES_REPO;
  const base = `${GITHUB_WEB}/${repo.owner}/${repo.repo}/releases/download/${MODULES_RELEASE_TAG}`;
  const source: ModulePackSource = { indexUrl: `${base}/${MODULES_INDEX_FILE}`, signatureUrl: `${base}/${MODULES_INDEX_FILE}.minisig`, extraOrigins: [], keys: [...releaseKeyring()], testKey: false };
  if (!opts.packaged) {
    source.keys.push(parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY));
    source.testKey = true;
    const local = opts.env?.CUTEX_DESKTOP_MODULES_INDEX;
    if (local && /^http:\/\/127\.0\.0\.1:\d{1,5}\/(?:[A-Za-z0-9._-]+\/)*modules\.json$/.test(local)) {
      Object.assign(source, { indexUrl: local, signatureUrl: `${local}.minisig`, extraOrigins: [new URL(local).origin] });
    }
  }
  return source;
}

/**
 * Whether a cutex-module:// request may load (main's onBeforeRequest): only a script or stylesheet of the
 * app window's main frame — never a plugin / agent-page subframe, a worker, fetch / XHR or another window.
 */
export function modulePackRequestAllowed(
  request: { webContentsId?: number; frame?: unknown; resourceType: string },
  main: { id: number; mainFrame: unknown } | null,
): boolean {
  return !!main && request.webContentsId === main.id && !!request.frame && request.frame === main.mainFrame && (request.resourceType === "script" || request.resourceType === "stylesheet");
}

export class PackError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class FetchError extends Error {
  constructor(
    readonly kind: "unreachable" | "noRelease" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

// ---- strict tar (ustar) reader ----

function cstr(b: Buffer, start: number, len: number): string {
  const s = b.subarray(start, start + len);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? len : end).toString("utf8");
}

function octal(b: Buffer, start: number, len: number): number {
  const t = cstr(b, start, len).trim();
  if (!/^[0-7]{1,12}$/.test(t)) throw new Error("bad tar number");
  return parseInt(t, 8);
}

/**
 * The regular files of an (uncompressed) ustar archive. Anything else — links, directories, devices, pax /
 * GNU extension headers, bad checksums, unsafe or duplicate paths, trailing data — is refused.
 */
export function readTar(buf: Buffer, maxFiles: number = LIMITS.filesPerPack): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const lower = new Set<string>();
  let off = 0;
  for (;;) {
    if (off + 512 > buf.length) throw new Error("truncated tar archive");
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]!;
    if (octal(h, 148, 8) !== sum) throw new Error("bad tar header checksum");
    const magic = h.subarray(257, 263).toString("latin1");
    if (magic !== "ustar\0" && magic !== "ustar ") throw new Error("not a ustar archive");
    const type = h[156];
    if (type !== 0x30 && type !== 0) throw new Error(`tar entry type ${JSON.stringify(String.fromCharCode(type!))} refused (regular files only)`);
    const prefix = magic === "ustar\0" ? cstr(h, 345, 155) : "";
    const name = cstr(h, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    if (!PACK_PATH_RE.test(path) || path.split("/").some((s) => s === "." || s === "..")) throw new Error(`unsafe tar path ${JSON.stringify(path)}`);
    if (lower.has(path.toLowerCase())) throw new Error(`duplicate tar entry ${path}`);
    lower.add(path.toLowerCase());
    if (out.size >= maxFiles) throw new Error("too many files in the archive");
    const size = octal(h, 124, 12);
    if (size > LIMITS.fileBytes) throw new Error(`${path} is too large`);
    off += 512;
    if (off + size > buf.length) throw new Error("truncated tar archive");
    out.set(path, Buffer.from(buf.subarray(off, off + size)));
    off += Math.ceil(size / 512) * 512;
  }
  for (let i = off; i < buf.length; i++) if (buf[i] !== 0) throw new Error("data after the end of the tar archive");
  return out;
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// ---- the service ----

interface PackState {
  v: 1;
  serial: number;
  active: Record<string, string>;
}

interface Verified {
  pack: ModuleIndexPack;
  dir: string;
}

interface CheckedIndex {
  index: ModuleIndex;
  bytes: Buffer;
  signature: string;
  checkedAt: number;
}

export interface ModulePackServiceOptions {
  /** userData/modules */
  root: string;
  source: ModulePackSource;
  transport: Transport;
  appModuleApi: string;
  onChange?: (view: ModulePacksView) => void;
  log?: (text: string) => void;
  now?: () => number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ModulePackService {
  private loaded = false;
  private state: PackState = { v: 1, serial: 0, active: {} };
  private readonly verified = new Map<string, Verified>();
  private broken: { id: string; version: string; error: string }[] = [];
  private checked: CheckedIndex | null = null;
  private checkError: ModulePacksView["check"] = null;
  private checking: Promise<ModulePacksView> | null = null;
  private operation: ModulePacksView["operation"] = null;
  private lastError: ModulePacksView["lastError"] = null;

  constructor(private readonly opts: ModulePackServiceOptions) {}

  // ---- start-up verification ----

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const root = this.opts.root;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      return;
    }
    for (const name of names) if (/^\.(download|staging|trash)-/.test(name)) rmSync(join(root, name), { recursive: true, force: true });
    this.state = this.readState();
    for (const id of names) {
      if (!isPackModuleId(id)) continue;
      const idDir = join(root, id);
      if (!isPlainDir(idDir)) continue;
      const good: Verified[] = [];
      const bad: { id: string; version: string; error: string }[] = [];
      for (const version of safeList(idDir)) {
        const dir = join(idDir, version);
        if (!parsePackVersion(version)) {
          rmSync(dir, { recursive: true, force: true });
          continue;
        }
        try {
          good.push({ pack: this.verifyInstalled(dir, id, version), dir });
        } catch (error) {
          bad.push({ id, version, error: errorText(error) });
          this.opts.log?.(`module pack ${id} ${version} failed verification: ${errorText(error)}`);
        }
      }
      const wanted = this.state.active[id];
      const current = good.find((g) => g.pack.version === wanted) ?? good.sort((a, b) => comparePackVersions(b.pack.version, a.pack.version))[0];
      if (current) {
        this.verified.set(id, current);
        for (const v of safeList(idDir)) if (v !== current.pack.version) rmSync(join(idDir, v), { recursive: true, force: true });
      } else {
        this.broken.push(...bad);
      }
    }
  }

  /** Verifies one installed version dir; returns its index entry or throws with the reason. */
  private verifyInstalled(dir: string, id: string, version: string): ModuleIndexPack {
    if (!isPlainDir(dir)) throw new Error("not a directory");
    const signed = join(dir, SIGNED_DIR);
    const bytes = readCapped(join(signed, MODULES_INDEX_FILE), LIMITS.indexBytes);
    const signature = readCapped(join(signed, `${MODULES_INDEX_FILE}.minisig`), LIMITS.signatureBytes).toString("utf8");
    verifyData(bytes, signature, this.opts.source.keys, MODULES_INDEX_FILE);
    const index = parseModuleIndex(JSON.parse(bytes.toString("utf8")), () => true);
    const pack = index.packs.find((p) => p.id === id && p.version === version);
    if (!pack) throw new Error(`its signed index does not list ${id} ${version}`);
    const present = listFiles(dir).filter((p) => p !== SIGNED_DIR && !p.startsWith(`${SIGNED_DIR}/`));
    const listed = new Map(pack.files.map((f) => [f.path, f]));
    for (const p of present) if (!listed.has(p)) throw new Error(`unexpected file ${p}`);
    for (const f of pack.files) {
      const data = readCapped(join(dir, ...f.path.split("/")), LIMITS.fileBytes);
      if (data.length !== f.size || sha256(data) !== f.sha256) throw new Error(`${f.path} does not match its signed hash`);
    }
    return pack;
  }

  private readState(): PackState {
    try {
      const raw = JSON.parse(readFileSync(join(this.opts.root, STATE_FILE), "utf8")) as Partial<PackState>;
      const active: Record<string, string> = {};
      if (raw && typeof raw.active === "object" && raw.active) for (const [k, v] of Object.entries(raw.active)) if (isPackModuleId(k) && parsePackVersion(v)) active[k] = v as string;
      return { v: 1, serial: typeof raw.serial === "number" && Number.isSafeInteger(raw.serial) && raw.serial > 0 ? raw.serial : 0, active };
    } catch {
      return { v: 1, serial: 0, active: {} };
    }
  }

  private writeState(): void {
    mkdirSync(this.opts.root, { recursive: true });
    const tmp = join(this.opts.root, `.state-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, join(this.opts.root, STATE_FILE));
  }

  // ---- view ----

  view(): ModulePacksView {
    this.load();
    const api = this.opts.appModuleApi;
    const installed: InstalledPackView[] = [...this.verified.values()]
      .map(({ pack }) => ({
        id: pack.id,
        version: pack.version,
        moduleApi: pack.moduleApi,
        compat: packCompat(pack.moduleApi, api),
        entry: packFileUrl(pack.id, pack.version, pack.entry),
        styles: pack.styles.map((s) => packFileUrl(pack.id, pack.version, s)),
        host: pack.host,
        ...(pack.title ? { title: pack.title } : {}),
        ...(pack.description ? { description: pack.description } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const c = this.checked;
    return {
      appModuleApi: api,
      testKey: this.opts.source.testKey,
      installed,
      broken: [...this.broken],
      index: c
        ? {
            serial: c.index.serial,
            generatedAt: c.index.generatedAt,
            checkedAt: c.checkedAt,
            packs: c.index.packs.map((p) => ({ id: p.id, version: p.version, moduleApi: p.moduleApi, compat: packCompat(p.moduleApi, api), size: p.archive.size, ...(p.title ? { title: p.title } : {}), ...(p.description ? { description: p.description } : {}) })),
          }
        : null,
      checking: !!this.checking,
      check: this.checkError,
      operation: this.operation,
      lastError: this.lastError,
    };
  }

  private emit(): void {
    this.opts.onChange?.(this.view());
  }

  // ---- check ----

  check(): Promise<ModulePacksView> {
    this.load();
    this.checking ??= this.runCheck().finally(() => {
      this.checking = null;
      this.emit();
    });
    this.emit();
    return this.checking;
  }

  private async runCheck(): Promise<ModulePacksView> {
    const { source } = this.opts;
    try {
      const bytes = await fetchCapped(this.opts.transport, source.indexUrl, LIMITS.indexBytes, source.extraOrigins);
      const signature = (await fetchCapped(this.opts.transport, source.signatureUrl, LIMITS.signatureBytes, source.extraOrigins)).toString("utf8");
      try {
        verifyData(bytes, signature, source.keys, MODULES_INDEX_FILE);
      } catch (error) {
        throw new FetchError("invalid", `the module index signature does not verify: ${errorText(error)}`);
      }
      let index: ModuleIndex;
      try {
        index = parseModuleIndex(JSON.parse(bytes.toString("utf8")), (href) => downloadUrlAllowed(href, source.extraOrigins));
      } catch (error) {
        throw new FetchError("invalid", `the module index is not valid: ${errorText(error)}`);
      }
      if (index.serial < this.state.serial) throw new FetchError("invalid", `the module index is older (serial ${index.serial}) than one already seen (${this.state.serial})`);
      if (index.serial > this.state.serial) {
        this.state.serial = index.serial;
        this.writeState();
      }
      this.checked = { index, bytes, signature, checkedAt: (this.opts.now ?? Date.now)() };
      this.checkError = null;
    } catch (error) {
      this.checkError = error instanceof FetchError ? { kind: error.kind, error: error.message } : { kind: "unreachable", error: errorText(error) };
      this.opts.log?.(`module index check failed: ${this.checkError.error}`);
    }
    return this.view();
  }

  // ---- install / remove ----

  async install(req: { id: string; version?: string; allowOlder?: boolean }): Promise<ModulePacksView> {
    this.load();
    if (this.operation) throw new PackError("busy", `busy with ${this.operation.id}`);
    const id = req.id;
    this.operation = { id, action: "install", version: req.version ?? null, step: null };
    this.lastError = null;
    this.emit();
    const root = this.opts.root;
    const tag = `${id}-${req.version ?? "latest"}-${process.pid}-${randomBytes(4).toString("hex")}`;
    const downloadPath = join(root, `.download-${tag}`);
    const staging = join(root, `.staging-${tag}`);
    const trash = join(root, `.trash-${tag}`);
    try {
      if (!this.checked && !this.checking) await this.check();
      else if (this.checking) await this.checking;
      const checked = this.checked;
      if (!checked) throw new PackError("no_index", this.checkError?.error ?? "the module index is not available");
      const candidates = checked.index.packs.filter((p) => p.id === id);
      if (!candidates.length) throw new PackError("not_in_index", `${id} is not in the module index`);
      const pack = req.version
        ? candidates.find((p) => p.version === req.version)
        : candidates.filter((p) => packCompat(p.moduleApi, this.opts.appModuleApi) === "ok").sort((a, b) => comparePackVersions(b.version, a.version))[0];
      if (!pack) throw new PackError(req.version ? "not_in_index" : "incompatible", req.version ? `${id} ${req.version} is not in the module index` : `no version of ${id} works with this app`);
      const compat = packCompat(pack.moduleApi, this.opts.appModuleApi);
      if (compat !== "ok") throw new PackError("incompatible", `${id} ${pack.version} ${compat === "needsNewerApp" ? "needs a newer app" : "is too old for this app"}`);
      const current = this.verified.get(id);
      if (current && comparePackVersions(pack.version, current.pack.version) < 0 && !req.allowOlder) {
        throw new PackError("downgrade_refused", `${id} ${pack.version} is older than the installed ${current.pack.version}`);
      }
      this.step({ id, action: "install", version: pack.version, step: "download" });
      mkdirSync(root, { recursive: true });
      try {
        await download(this.opts.transport, pack.archive.url, downloadPath, { max: LIMITS.archiveBytes, size: pack.archive.size, extraOrigins: this.opts.source.extraOrigins });
      } catch (error) {
        throw new PackError("download_failed", errorText(error));
      }

      this.step({ id, action: "install", version: pack.version, step: "verify" });
      let files: Map<string, Buffer>;
      try {
        const archive = readFileSync(downloadPath);
        if (archive.length !== pack.archive.size || sha256(archive) !== pack.archive.sha256) throw new Error(`${pack.archive.name} does not match the signed sha256`);
        files = readTar(gunzipSync(archive, { maxOutputLength: LIMITS.packBytes + 512 * (LIMITS.filesPerPack + 4) }));
        const listed = new Map(pack.files.map((f) => [f.path, f]));
        for (const path of files.keys()) if (!listed.has(path)) throw new Error(`the archive has an unlisted file ${path}`);
        for (const f of pack.files) {
          const data = files.get(f.path);
          if (!data) throw new Error(`the archive lacks ${f.path}`);
          if (data.length !== f.size || sha256(data) !== f.sha256) throw new Error(`${f.path} does not match the signed sha256`);
        }
      } catch (error) {
        throw new PackError("verify_failed", errorText(error));
      } finally {
        rmSync(downloadPath, { force: true });
      }

      this.step({ id, action: "install", version: pack.version, step: "unpack" });
      const idDir = join(root, id);
      const target = join(idDir, pack.version);
      let movedOld = false;
      let placed = false;
      try {
        mkdirSync(staging);
        for (const [path, data] of files) {
          const parts = path.split("/");
          if (parts.length > 1) mkdirSync(join(staging, ...parts.slice(0, -1)), { recursive: true });
          writeFileSync(join(staging, ...parts), data, { flag: "wx" });
        }
        mkdirSync(join(staging, SIGNED_DIR));
        writeFileSync(join(staging, SIGNED_DIR, MODULES_INDEX_FILE), checked.bytes, { flag: "wx" });
        writeFileSync(join(staging, SIGNED_DIR, `${MODULES_INDEX_FILE}.minisig`), checked.signature, { flag: "wx" });
        mkdirSync(idDir, { recursive: true });
        if (exists(target)) {
          renameSync(target, trash);
          movedOld = true;
        }
        renameSync(staging, target);
        placed = true;
        const verified = this.verifyInstalled(target, id, pack.version);
        rmSync(trash, { recursive: true, force: true });
        this.verified.set(id, { pack: verified, dir: target });
        this.broken = this.broken.filter((b) => b.id !== id);
        this.state.active[id] = pack.version;
        this.writeState();
        for (const v of safeList(idDir)) if (v !== pack.version) rmSync(join(idDir, v), { recursive: true, force: true });
      } catch (error) {
        // Put back whatever was there before (a reinstall of the same version).
        if (placed) rmSync(target, { recursive: true, force: true });
        if (movedOld && !exists(target)) renameSync(trash, target);
        throw new PackError("unpack_failed", errorText(error));
      }
      this.opts.log?.(`module pack ${id} ${pack.version} installed`);
    } catch (error) {
      this.lastError = {
        id,
        action: "install",
        message: errorText(error),
        code: error instanceof PackError ? error.code : null,
        retry: { ...(req.version ? { version: req.version } : {}), ...(req.allowOlder ? { allowOlder: true as const } : {}) },
      };
      this.opts.log?.(`module pack ${id} install failed: ${errorText(error)}`);
    } finally {
      rmSync(downloadPath, { force: true });
      rmSync(staging, { recursive: true, force: true });
      rmSync(trash, { recursive: true, force: true });
      this.operation = null;
      this.emit();
    }
    return this.view();
  }

  private step(op: NonNullable<ModulePacksView["operation"]> & { step: PackStep }): void {
    this.operation = op;
    this.emit();
  }

  async remove(req: { id: string }): Promise<ModulePacksView> {
    this.load();
    if (this.operation) throw new PackError("busy", `busy with ${this.operation.id}`);
    const id = req.id;
    try {
      rmSync(join(this.opts.root, id), { recursive: true, force: true });
      this.verified.delete(id);
      this.broken = this.broken.filter((b) => b.id !== id);
      delete this.state.active[id];
      this.writeState();
      if (this.lastError?.id === id) this.lastError = null;
    } catch (error) {
      this.lastError = { id, action: "remove", message: errorText(error), code: null };
    }
    this.emit();
    return this.view();
  }

  // ---- protocol ----

  /** The cutex-module:// handler: a verified pack's file, hashed again; 404 for anything else. */
  respond(request: Request): Response {
    this.load();
    const notFound = () => new Response("not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    if (request.method !== "GET") return notFound();
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    if (url.protocol !== `${MODULE_PACK_SCHEME}:` || url.hostname !== "pack" || url.search || url.username || url.port) return notFound();
    const parts = url.pathname.split("/").filter(Boolean).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return "";
      }
    });
    const [id, version, ...rest] = parts;
    const path = rest.join("/");
    const entry = id ? this.verified.get(id) : undefined;
    if (!entry || entry.pack.version !== version) return notFound();
    const file = entry.pack.files.find((f) => f.path === path);
    if (!file || !(path.endsWith(".js") || path.endsWith(".css"))) return notFound();
    let data: Buffer;
    try {
      data = readCapped(join(entry.dir, ...path.split("/")), LIMITS.fileBytes);
    } catch {
      return notFound();
    }
    if (data.length !== file.size || sha256(data) !== file.sha256) {
      this.verified.delete(entry.pack.id);
      this.broken.push({ id: entry.pack.id, version: entry.pack.version, error: `${path} changed after it was verified` });
      this.opts.log?.(`module pack ${entry.pack.id} ${entry.pack.version}: ${path} changed after it was verified`);
      this.emit();
      return notFound();
    }
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": path.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}

// ---- small fs / network helpers ----

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isPlainDir(path: string): boolean {
  try {
    const s = lstatSync(path);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Every regular file under `dir` as a `/` path; symlinks and other entries are refused. */
function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`${rel} is a symbolic link`);
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
    else throw new Error(`${rel} is not a regular file`);
  }
  return out;
}

function readCapped(path: string, max: number): Buffer {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error(`${path} is not a regular file`);
  if (s.size > max) throw new Error(`${path} is larger than ${max} bytes`);
  return readFileSync(path);
}

/** GET a small file into memory, following redirects to allowed hosts only; classified errors. */
async function fetchCapped(transport: Transport, url: string, max: number, extraOrigins: readonly string[]): Promise<Buffer> {
  let href = url;
  for (let hop = 0; ; hop++) {
    if (!downloadUrlAllowed(href, extraOrigins)) throw new FetchError("invalid", `refusing to download from ${new URL(href).origin}`);
    let res: TransportResponse;
    try {
      res = await transport(href, { headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      throw new FetchError("unreachable", error instanceof ProxyAuthError ? error.message : `cannot reach ${new URL(href).host}: ${errorText(error)}`);
    }
    if (res.status >= 300 && res.status < 400) {
      res.cancel();
      const location = res.header("location");
      if (!location || hop >= MAX_REDIRECTS) throw new FetchError("unreachable", "bad redirect");
      href = new URL(location, href).href;
      continue;
    }
    if (res.status === 404) {
      res.cancel();
      throw new FetchError("noRelease", "no module index is published yet");
    }
    if (res.status < 200 || res.status >= 300) {
      res.cancel();
      throw new FetchError("unreachable", `${new URL(href).host} answered ${res.status}`);
    }
    const chunks: Uint8Array[] = [];
    let n = 0;
    try {
      for await (const chunk of res.body) {
        n += chunk.length;
        if (n > max) {
          res.cancel();
          throw new FetchError("invalid", `${url.split("/").pop()} is larger than ${max} bytes`);
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof FetchError) throw error;
      throw new FetchError("unreachable", `reading ${url.split("/").pop()} failed: ${errorText(error)}`);
    }
    return Buffer.concat(chunks);
  }
}
