// A module's own data folder and the native file pick / save (docs/desktop-modules.md §30.6). Main decides everything:
// the renderer names a module id and a relative path, never an absolute one; picked and saved files never leave main as
// paths. The id is the module host's (ctx.services is bound to it), which is not a security boundary: see §30.6.
import { MODULE_ID_RE } from "@cutex-desktop/plugin-sdk";

export const MODULE_DATA_CHANNEL = "cutex-desktop:module-data";
/** userData/<this>/<module id>/ */
export const MODULE_DATA_DIR = "module-data";

export const MODULE_DATA_LIMITS = {
  /** Everything in one module's folder. */
  moduleBytes: 64 * 1024 * 1024,
  /** One file read or written at a time; also a picked or saved file. */
  fileBytes: 16 * 1024 * 1024,
  /** Files and folders in one module's folder. */
  entries: 4096,
  pathChars: 512,
  depth: 8,
  filters: 16,
  extensionsPerFilter: 32,
} as const;

/** One part of a path: a letter, digit or `_` first; no trailing dot or space (Windows drops them). */
const SEGMENT_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9._ -]{0,126}[A-Za-z0-9_-])?$/;
/** Windows device names, with or without an extension (`nul.txt` is still NUL). */
const RESERVED_RE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?:\.|$)/i;
const EXTENSION_RE = /^[A-Za-z0-9]{1,16}$/;

export type ModuleDataErrorCode = "invalid" | "not_found" | "too_large" | "quota_exceeded" | "busy" | "unavailable" | "unknown_module";

/** The message main throws: `<code>: <text>` (Electron passes only the message across). */
export const moduleDataErrorCode = (message: string): ModuleDataErrorCode | null => {
  const m = /(?:^|: )(invalid|not_found|too_large|quota_exceeded|busy|unavailable|unknown_module): /.exec(message);
  return m ? (m[1] as ModuleDataErrorCode) : null;
};

/** A relative path inside a module's folder, as parts; null when it is not one. "" = the folder itself. */
export function parseDataPath(raw: unknown, allowRoot = false): string[] | null {
  if (typeof raw !== "string" || raw.length > MODULE_DATA_LIMITS.pathChars) return null;
  if (raw === "") return allowRoot ? [] : null;
  const parts = raw.split("/");
  if (parts.length > MODULE_DATA_LIMITS.depth) return null;
  for (const part of parts) if (!SEGMENT_RE.test(part) || RESERVED_RE.test(part)) return null;
  return parts;
}

export interface FileFilterInput {
  name: string;
  extensions: string[];
}

function parseFilters(raw: unknown): FileFilterInput[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MODULE_DATA_LIMITS.filters) return null;
  const out: FileFilterInput[] = [];
  for (const f of raw as unknown[]) {
    const r = f as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || Object.keys(r).sort().join(",") !== "extensions,name") return null;
    if (typeof r.name !== "string" || !Array.isArray(r.extensions) || r.extensions.length > MODULE_DATA_LIMITS.extensionsPerFilter) return null;
    if (!(r.extensions as unknown[]).every((e) => typeof e === "string" && (e === "*" || EXTENSION_RE.test(e)))) return null;
    out.push({ name: r.name.slice(0, 64), extensions: r.extensions as string[] });
  }
  return out;
}

/** A name for the save dialog to start with: a plain file name, nothing that says where. */
export function cleanSuggestedName(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const name = raw.split(/[\\/]/).pop() ?? "";
  return parseDataPath(name) ? name : null;
}

export interface ModuleDataEntryView {
  name: string;
  kind: "file" | "folder";
  size: number;
  modified: number;
}

export interface ModuleDataUsage {
  used: number;
  limit: number;
  fileLimit: number;
}

/** Settings → Modules → module data: every module folder there is, with or without its module. */
export interface ModuleDataFolderView {
  id: string;
  bytes: number;
  /** Main knows the module (built in, installed or loaded from a folder). */
  known: boolean;
}

export type ModuleDataRequest =
  | { op: "read"; id: string; path: string }
  | { op: "write"; id: string; path: string; data: Uint8Array }
  | { op: "remove"; id: string; path: string }
  | { op: "list"; id: string; path: string }
  | { op: "usage"; id: string }
  | { op: "pick"; id: string; filters: FileFilterInput[] }
  | { op: "save"; id: string; data: Uint8Array; suggestedName: string | null; filters: FileFilterInput[] }
  | { op: "folders" }
  | { op: "clear"; id: string };

export interface ModuleDataBridge {
  read(id: string, path: string): Promise<Uint8Array | null>;
  write(id: string, path: string, data: Uint8Array): Promise<void>;
  remove(id: string, path: string): Promise<void>;
  list(id: string, path: string): Promise<ModuleDataEntryView[]>;
  usage(id: string): Promise<ModuleDataUsage>;
  /** Main's open dialog; the bytes and the base name of the one file the owner chose, or null. */
  pick(id: string, filters: FileFilterInput[]): Promise<{ name: string; data: Uint8Array } | null>;
  /** Main's save dialog; main writes the bytes; the base name, or null when cancelled. */
  save(id: string, data: Uint8Array, suggestedName: string | null, filters: FileFilterInput[]): Promise<{ name: string } | null>;
  folders(): Promise<ModuleDataFolderView[]>;
  /** Main asks the owner in its own dialog first; true = deleted. */
  clear(id: string): Promise<boolean>;
}

const bytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;

export function parseModuleDataRequest(raw: unknown): ModuleDataRequest {
  const r = raw as Record<string, unknown> | null;
  const bad = (why = "request") => new Error(`invalid: bad module data ${why}`);
  if (!r || typeof r !== "object" || Array.isArray(r)) throw bad();
  const keys = Object.keys(r).sort().join(",");
  if (r.op === "folders") {
    if (keys !== "op") throw bad();
    return { op: "folders" };
  }
  if (typeof r.id !== "string" || !MODULE_ID_RE.test(r.id)) throw bad("id");
  const id = r.id;
  const path = (allowRoot = false) => {
    if (!parseDataPath(r.path, allowRoot)) throw bad(`path ${JSON.stringify(String(r.path).slice(0, 80))}`);
    return r.path as string;
  };
  switch (r.op) {
    case "read":
    case "remove":
      if (keys !== "id,op,path") throw bad();
      return { op: r.op, id, path: path() };
    case "list":
      if (keys !== "id,op,path") throw bad();
      return { op: "list", id, path: path(true) };
    case "write":
      if (keys !== "data,id,op,path" || !bytes(r.data)) throw bad();
      return { op: "write", id, path: path(), data: r.data };
    case "usage":
    case "clear":
      if (keys !== "id,op") throw bad();
      return { op: r.op, id };
    case "pick": {
      if (keys !== "filters,id,op") throw bad();
      const filters = parseFilters(r.filters);
      if (!filters) throw bad("filters");
      return { op: "pick", id, filters };
    }
    case "save": {
      if (keys !== "data,filters,id,op,suggestedName" || !bytes(r.data)) throw bad();
      const filters = parseFilters(r.filters);
      if (!filters) throw bad("filters");
      if (r.suggestedName !== null && typeof r.suggestedName !== "string") throw bad("name");
      return { op: "save", id, data: r.data, suggestedName: r.suggestedName === null ? null : cleanSuggestedName(r.suggestedName), filters };
    }
  }
  throw bad();
}
