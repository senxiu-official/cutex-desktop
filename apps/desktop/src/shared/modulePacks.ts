// Signed first-party module packs (docs/desktop-modules.md §23): the signed index format, its strict
// parser, pack versions and the narrow IPC between the renderer and main. Main downloads, verifies and
// stores packs (main/modulePacks.ts); the renderer only reads the resulting view and asks for
// check / install / remove — it never names a path, a URL or a key.
import { MODULE_API_VERSION, MODULE_ID_RE, moduleApiVerdict, parseModuleApiRange } from "@cutex-desktop/plugin-sdk";

export const MODULE_PACKS_CHANNEL = "cutex-desktop:module-packs";
/** The privileged scheme main serves verified pack files on (main window, main frame only). */
export const MODULE_PACK_SCHEME = "cutex-module";
/** The GitHub release that carries the index and the pack archives (never marked latest). */
export const MODULES_RELEASE_TAG = "modules-release";
/** Where the index lives when the install records no release page (dev runs, source installs). */
export const DEFAULT_MODULES_REPO = { owner: "senxiu-official", repo: "cutex-desktop" } as const;
export const MODULES_INDEX_FILE = "modules.json";
export const MODULES_INDEX_SIG = "modules.json.minisig";
/** The directory inside an installed version that holds the signed index it was installed from. */
export const SIGNED_DIR = ".signed";

export const LIMITS = {
  indexBytes: 1024 * 1024,
  indexEntries: 256,
  signatureBytes: 4096,
  filesPerPack: 64,
  fileBytes: 4 * 1024 * 1024,
  packBytes: 16 * 1024 * 1024,
  archiveBytes: 16 * 1024 * 1024,
  hostSpecifiers: 128,
  hostNames: 512,
} as const;

/**
 * The module-pack TEST key (minisign public key). Its secret half is derived from the public seed below
 * (scripts/module-packs/minisign.mjs), so anyone can sign with it: main trusts it only in an unpackaged
 * app (dev runs, tests), never in a packaged build (main/modulePacks.ts modulePackKeys).
 */
export const MODULE_PACK_TEST_SEED = "cutex-desktop module packs TEST KEY - never trusted by packaged builds";
export const MODULE_PACK_TEST_PUBLIC_KEY = "RWSxFHG77EVbTPRApyOxWU+lKJV+rrNlGuTaNnct7Ax9GnMEF80X7UKr";

/** A pack file path: lowercase-friendly relative segments, no dot-files, no `..`, no backslashes. */
export const PACK_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}){0,7}$/;
const VERSION_RE = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** A host specifier a pack may read from the host object (modules/packHost.ts lists the provided ones). */
export const HOST_SPECIFIER_RE = /^(?:react|react\/jsx-runtime|react-dom|react-dom\/client|zustand|@cutex-desktop\/app\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+){0,6})$/;
const HOST_NAME_RE = /^(?:\*|default|[A-Za-z_$][A-Za-z0-9_$]{0,127})$/;

/** Pack versions are `M.m.p`. */
export function parsePackVersion(text: unknown): [number, number, number] | null {
  if (typeof text !== "string") return null;
  const m = VERSION_RE.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0 / 0 / >0; malformed versions sort lowest. */
export function comparePackVersions(a: string, b: string): number {
  const x = parsePackVersion(a);
  const y = parsePackVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** A module id a pack may use: a plain module id, never the external plugin namespace. */
export function isPackModuleId(id: unknown): id is string {
  return typeof id === "string" && MODULE_ID_RE.test(id) && !id.startsWith("external-");
}

export type PackCompat = "ok" | "needsNewerApp" | "needsNewerModule";
export function packCompat(moduleApi: string, appModuleApi: string = MODULE_API_VERSION): PackCompat {
  return moduleApiVerdict(moduleApi, appModuleApi);
}

export interface ModulePackFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ModuleIndexPack {
  id: string;
  version: string;
  moduleApi: string;
  title?: Record<string, string>;
  description?: Record<string, string>;
  entry: string;
  styles: string[];
  /** Host specifier → the names the pack reads from it (`*` = the namespace itself). */
  host: Record<string, string[]>;
  files: ModulePackFile[];
  archive: { name: string; url: string; size: number; sha256: string };
}

export interface ModuleIndex {
  schema: 1;
  serial: number;
  generatedAt: string;
  packs: ModuleIndexPack[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isSize = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

function onlyKeys(o: Obj, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Error(`${where}: unknown field ${JSON.stringify(k)}`);
}

function texts(v: unknown, where: string): Record<string, string> | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) throw new Error(`${where} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) {
    if (!/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(k) || typeof t !== "string" || t.length > 2000) throw new Error(`${where}: bad entry ${JSON.stringify(k)}`);
    out[k] = t;
  }
  return out;
}

/** One index entry, strictly; throws with the reason. `urlAllowed`: where an archive may be downloaded from. */
export function parseIndexPack(raw: unknown, urlAllowed: (href: string) => boolean): ModuleIndexPack {
  if (!isObj(raw)) throw new Error("pack entry must be an object");
  const id = raw.id;
  if (!isPackModuleId(id)) throw new Error(`bad pack id ${JSON.stringify(id)}`);
  const where = `pack ${id}`;
  onlyKeys(raw, ["id", "version", "moduleApi", "title", "description", "entry", "styles", "host", "files", "archive"], where);
  if (!parsePackVersion(raw.version)) throw new Error(`${where}: bad version ${JSON.stringify(raw.version)}`);
  const version = raw.version as string;
  if (typeof raw.moduleApi !== "string" || !parseModuleApiRange(raw.moduleApi)) throw new Error(`${where}: bad moduleApi range`);
  if (!Array.isArray(raw.files) || raw.files.length === 0 || raw.files.length > LIMITS.filesPerPack) throw new Error(`${where}: bad file list`);
  const files: ModulePackFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of raw.files) {
    if (!isObj(f)) throw new Error(`${where}: bad file entry`);
    onlyKeys(f, ["path", "size", "sha256"], `${where} file`);
    if (typeof f.path !== "string" || !PACK_PATH_RE.test(f.path) || f.path.split("/").some((s) => s === "." || s === "..")) throw new Error(`${where}: bad file path ${JSON.stringify(f.path)}`);
    const key = f.path.toLowerCase();
    if (seen.has(key)) throw new Error(`${where}: duplicate file ${f.path}`);
    seen.add(key);
    if (!isSize(f.size, LIMITS.fileBytes)) throw new Error(`${where}: bad size of ${f.path}`);
    if (typeof f.sha256 !== "string" || !SHA256_RE.test(f.sha256)) throw new Error(`${where}: bad sha256 of ${f.path}`);
    total += f.size;
    files.push({ path: f.path, size: f.size, sha256: f.sha256 });
  }
  if (total > LIMITS.packBytes) throw new Error(`${where}: larger than ${LIMITS.packBytes} bytes`);
  const listed = new Set(files.map((f) => f.path));
  if (typeof raw.entry !== "string" || !listed.has(raw.entry) || !raw.entry.endsWith(".js")) throw new Error(`${where}: entry is not a listed .js file`);
  const styles = raw.styles ?? [];
  if (!Array.isArray(styles) || styles.length > 8 || styles.some((s) => typeof s !== "string" || !listed.has(s) || !s.endsWith(".css"))) throw new Error(`${where}: styles must be listed .css files`);
  if (!isObj(raw.host)) throw new Error(`${where}: host must be an object`);
  const host: Record<string, string[]> = {};
  const specs = Object.entries(raw.host);
  if (specs.length > LIMITS.hostSpecifiers) throw new Error(`${where}: too many host specifiers`);
  let names = 0;
  for (const [spec, list] of specs) {
    if (!HOST_SPECIFIER_RE.test(spec)) throw new Error(`${where}: bad host specifier ${JSON.stringify(spec)}`);
    if (!Array.isArray(list) || list.some((n) => typeof n !== "string" || !HOST_NAME_RE.test(n))) throw new Error(`${where}: bad host names for ${spec}`);
    names += list.length;
    host[spec] = [...(list as string[])];
  }
  if (names > LIMITS.hostNames) throw new Error(`${where}: too many host names`);
  const a = raw.archive;
  if (!isObj(a)) throw new Error(`${where}: archive must be an object`);
  onlyKeys(a, ["name", "url", "size", "sha256"], `${where} archive`);
  if (typeof a.name !== "string" || a.name !== `${id}-${version}.tar.gz`) throw new Error(`${where}: archive must be named ${id}-${version}.tar.gz`);
  if (typeof a.url !== "string" || !urlAllowed(a.url)) throw new Error(`${where}: archive url not allowed`);
  if (!isSize(a.size, LIMITS.archiveBytes) || a.size === 0) throw new Error(`${where}: bad archive size`);
  if (typeof a.sha256 !== "string" || !SHA256_RE.test(a.sha256)) throw new Error(`${where}: bad archive sha256`);
  const title = texts(raw.title, `${where} title`);
  const description = texts(raw.description, `${where} description`);
  return {
    id,
    version,
    moduleApi: raw.moduleApi,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    entry: raw.entry,
    styles: [...(styles as string[])],
    host,
    files,
    archive: { name: a.name, url: a.url, size: a.size, sha256: a.sha256 },
  };
}

/** The whole signed index (already signature-checked bytes, decoded); throws with the reason. */
export function parseModuleIndex(raw: unknown, urlAllowed: (href: string) => boolean): ModuleIndex {
  if (!isObj(raw)) throw new Error("index must be an object");
  onlyKeys(raw, ["schema", "serial", "generatedAt", "packs"], "index");
  if (raw.schema !== 1) throw new Error(`unknown index schema ${JSON.stringify(raw.schema)}`);
  if (typeof raw.serial !== "number" || !Number.isSafeInteger(raw.serial) || raw.serial < 1) throw new Error("bad index serial");
  if (typeof raw.generatedAt !== "string" || raw.generatedAt.length > 40) throw new Error("bad index generatedAt");
  if (!Array.isArray(raw.packs) || raw.packs.length > LIMITS.indexEntries) throw new Error("bad index pack list");
  const packs = raw.packs.map((p) => parseIndexPack(p, urlAllowed));
  const keys = new Set<string>();
  for (const p of packs) {
    const k = `${p.id}@${p.version}`;
    if (keys.has(k)) throw new Error(`index lists ${k} twice`);
    keys.add(k);
  }
  return { schema: 1, serial: raw.serial, generatedAt: raw.generatedAt, packs };
}

// ---- IPC ----

export type PackStep = "download" | "verify" | "unpack";

export interface InstalledPackView {
  id: string;
  version: string;
  moduleApi: string;
  compat: PackCompat;
  /** cutex-module:// URLs of the entry and the styles. */
  entry: string;
  styles: string[];
  host: Record<string, string[]>;
  title?: Record<string, string>;
  description?: Record<string, string>;
}

export interface AvailablePackView {
  id: string;
  version: string;
  moduleApi: string;
  compat: PackCompat;
  size: number;
  title?: Record<string, string>;
  description?: Record<string, string>;
}

export interface ModulePacksView {
  appModuleApi: string;
  /** An unpackaged app that also trusts the module-pack test key. */
  testKey: boolean;
  installed: InstalledPackView[];
  broken: { id: string; version: string; error: string }[];
  index: { serial: number; generatedAt: string; checkedAt: number; packs: AvailablePackView[] } | null;
  checking: boolean;
  check: { error: string; kind: "unreachable" | "noRelease" | "invalid" } | null;
  operation: { id: string; action: "install" | "remove"; version: string | null; step: PackStep | null } | null;
  /** The last failed operation; `retry` = the request that repeats it exactly (same version, same downgrade choice). */
  lastError: { id: string; action: "install" | "remove"; message: string; code: string | null; retry?: { version?: string; allowOlder?: true } } | null;
}

export type ModulePacksRequest =
  | { op: "state" }
  | { op: "check" }
  | { op: "install"; id: string; version?: string; allowOlder?: boolean }
  | { op: "remove"; id: string };

export interface ModulePacksBridge {
  state(): Promise<ModulePacksView>;
  check(): Promise<ModulePacksView>;
  install(input: { id: string; version?: string; allowOlder?: boolean }): Promise<ModulePacksView>;
  remove(input: { id: string }): Promise<ModulePacksView>;
  onState(listener: (view: ModulePacksView) => void): () => void;
}

/** Validates an IPC request from the renderer exactly (main side). */
export function parseModulePacksRequest(raw: unknown): ModulePacksRequest {
  if (!isObj(raw)) throw new Error("invalid module pack request");
  switch (raw.op) {
    case "state":
    case "check":
      if (Object.keys(raw).length !== 1) throw new Error("invalid module pack request");
      return { op: raw.op };
    case "install": {
      onlyKeys(raw, ["op", "id", "version", "allowOlder"], "module pack request");
      if (!isPackModuleId(raw.id)) throw new Error("invalid module pack request");
      if (raw.version !== undefined && !parsePackVersion(raw.version)) throw new Error("invalid module pack request");
      if (raw.allowOlder !== undefined && typeof raw.allowOlder !== "boolean") throw new Error("invalid module pack request");
      return { op: "install", id: raw.id, ...(raw.version !== undefined ? { version: raw.version as string } : {}), ...(raw.allowOlder ? { allowOlder: true } : {}) };
    }
    case "remove":
      onlyKeys(raw, ["op", "id"], "module pack request");
      if (!isPackModuleId(raw.id)) throw new Error("invalid module pack request");
      return { op: "remove", id: raw.id };
    default:
      throw new Error("invalid module pack request");
  }
}

/** The URL main serves a verified pack file on. */
export function packFileUrl(id: string, version: string, path: string): string {
  return `${MODULE_PACK_SCHEME}://pack/${id}/${version}/${path}`;
}
