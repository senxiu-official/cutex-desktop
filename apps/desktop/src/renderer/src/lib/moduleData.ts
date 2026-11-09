// `ctx.services.data` and `ctx.services.files` (docs/desktop-modules.md §30.6): thin calls to main, bound to the module id
// the host made the context for. Main checks the id, the path and the limits; this file only turns bytes and errors into
// what the public API promises.
import type { ModuleData, ModuleFiles, PickedFile } from "@cutex-desktop/module-api";
import { moduleDataErrorCode, type FileFilterInput, type ModuleDataBridge } from "../../../shared/moduleData";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** An Error with `code`, from main's `<code>: <text>` (Electron puts its own words in front). */
function moduleError(error: unknown): Error {
  const text = error instanceof Error ? error.message : String(error);
  const code = moduleDataErrorCode(text);
  if (!code) return error instanceof Error ? error : new Error(text);
  const out = new Error(text.slice(text.indexOf(`${code}: `))) as Error & { code: string };
  out.code = code;
  return out;
}

function unavailable(): Error {
  return Object.assign(new Error("unavailable: module data needs the desktop app"), { code: "unavailable" });
}

async function call<T>(id: string, bridge: () => ModuleDataBridge | undefined, run: (b: ModuleDataBridge) => Promise<T>): Promise<T> {
  if (!id) throw Object.assign(new Error("unknown_module: data and files belong to a module: use ctx.services in activate"), { code: "unknown_module" });
  const b = bridge();
  if (!b) throw unavailable();
  try {
    return await run(b);
  } catch (error) {
    throw moduleError(error);
  }
}

const toBytes = (data: string | Uint8Array): Uint8Array => {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  throw Object.assign(new TypeError("invalid: data must be a string or a Uint8Array"), { code: "invalid" });
};

const toFilters = (filters: readonly { name: string; extensions: readonly string[] }[] | undefined): FileFilterInput[] =>
  (filters ?? []).map((f) => ({ name: String(f.name), extensions: [...f.extensions].map(String) }));

export function moduleDataFor(id: string, bridge: () => ModuleDataBridge | undefined): ModuleData {
  return {
    read: (path) => call(id, bridge, (b) => b.read(id, path)),
    readText: (path) => call(id, bridge, async (b) => {
      const data = await b.read(id, path);
      return data === null ? null : decoder.decode(data);
    }),
    write: (path, data) => call(id, bridge, (b) => b.write(id, path, toBytes(data))),
    remove: (path) => call(id, bridge, (b) => b.remove(id, path)),
    list: (folder = "") => call(id, bridge, (b) => b.list(id, folder)),
    usage: () => call(id, bridge, (b) => b.usage(id)),
  };
}

export function moduleFilesFor(id: string, bridge: () => ModuleDataBridge | undefined): ModuleFiles {
  return {
    pick: (options) => call(id, bridge, async (b) => {
      const file = await b.pick(id, toFilters(options?.filters));
      if (!file) return null;
      const data = file.data;
      return { name: file.name, size: data.byteLength, data, text: () => decoder.decode(data) } satisfies PickedFile;
    }),
    save: (data, options) => call(id, bridge, (b) => b.save(id, toBytes(data), options?.suggestedName ?? null, toFilters(options?.filters))),
  };
}
