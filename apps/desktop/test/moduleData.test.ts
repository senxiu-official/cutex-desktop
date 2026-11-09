// A module's own data folder and the native file pick / save, main side (docs/desktop-modules.md §30.6): paths stay inside
// the folder (no `..`, links, device names, hard links), the limits, unknown modules, the dialogs' answers, and removal
// of a local module asking about its data.
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleDataService, type ModuleDataPrompts } from "../src/main/moduleData";
import { ModulePackService } from "../src/main/modulePacks";
import { parsePublicKey } from "../src/main/minisign";
import type { Transport } from "../src/main/updateTransport";
import { cleanSuggestedName, moduleDataErrorCode, parseDataPath, parseModuleDataRequest } from "../src/shared/moduleData";
import { MODULE_PACK_TEST_PUBLIC_KEY } from "../src/shared/modulePacks";
import { moduleDataFor, moduleFilesFor } from "../src/renderer/src/lib/moduleData";
import { writeTarGz } from "../scripts/module-packs/tar.mjs";

vi.mock("electron", () => ({ dialog: {} }));

let base: string;
let root: string;
let outside: string;
let prompts: ModuleDataPrompts & { picked: string | null; saveTo: string | null; clearYes: boolean };

function service(limits?: ConstructorParameters<typeof ModuleDataService>[0]["limits"]) {
  return new ModuleDataService({ root, known: (id) => id === "notes" || id === "other", prompts, limits });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (error) {
    return moduleDataErrorCode((error as Error).message) ?? (error as Error).message;
  }
};
const text = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "cutex-module-data-"));
  root = join(base, "module-data");
  outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "secret");
  prompts = {
    picked: null,
    saveTo: null,
    clearYes: true,
    pickFile: vi.fn(async () => prompts.picked),
    saveFile: vi.fn(async () => prompts.saveTo),
    confirmClear: vi.fn(async () => prompts.clearYes),
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("paths", () => {
  it("takes plain relative paths and refuses everything that could leave the folder or name a device", () => {
    expect(parseDataPath("notes/today.json")).toEqual(["notes", "today.json"]);
    expect(parseDataPath("a b/_c-d.e")).toEqual(["a b", "_c-d.e"]);
    expect(parseDataPath("", true)).toEqual([]);
    for (const bad of ["", "..", "../x", "a/../b", "./a", "/a", "a/", "a//b", "C:/x", "C:x", "a\\b", ".hidden", ".tmp-1", "a.", "a ", "con", "NUL.txt", "com1", "lpt9.log", "aux", "a:b", "a*b", "a\u0000b", "é", "x".repeat(129), Array(9).fill("a").join("/")]) {
      expect(parseDataPath(bad), bad).toBeNull();
    }
    expect(cleanSuggestedName("C:\\Users\\x\\report.md")).toBe("report.md");
    expect(cleanSuggestedName("../../nul")).toBeNull();
  });

  it("requests are exact: a known op, a module id, a path, bytes", () => {
    expect(parseModuleDataRequest({ op: "write", id: "notes", path: "a.txt", data: text("x") }).op).toBe("write");
    expect(parseModuleDataRequest({ op: "list", id: "notes", path: "" })).toEqual({ op: "list", id: "notes", path: "" });
    expect(() => parseModuleDataRequest({ op: "read", id: "notes", path: "" })).toThrow(/invalid/);
    expect(() => parseModuleDataRequest({ op: "read", id: "Notes", path: "a" })).toThrow(/invalid/);
    expect(() => parseModuleDataRequest({ op: "read", id: "notes", path: "a", root: "C:/" })).toThrow(/invalid/);
    expect(() => parseModuleDataRequest({ op: "write", id: "notes", path: "a", data: "text" })).toThrow(/invalid/);
    expect(() => parseModuleDataRequest({ op: "pick", id: "notes", filters: [{ name: "x", extensions: ["../exe"] }] })).toThrow(/invalid/);
    expect(() => parseModuleDataRequest({ op: "pick", id: "notes", filters: [], path: "C:/" })).toThrow(/invalid/);
    expect(parseModuleDataRequest({ op: "save", id: "notes", data: text("x"), suggestedName: "C:/a/b.md", filters: [] })).toMatchObject({ suggestedName: "b.md" });
    expect(() => parseModuleDataRequest({ op: "nope", id: "notes" })).toThrow(/invalid/);
  });
});

describe("the folder", () => {
  it("writes, reads, lists, removes, and stays in userData/module-data/<id>", async () => {
    const s = service();
    expect(await s.read("notes", "a.txt")).toBeNull();
    expect(await s.list("notes", "")).toEqual([]);
    await s.write("notes", "dir/sub/a.txt", text("hello"));
    expect(readFileSync(join(root, "notes", "dir", "sub", "a.txt"), "utf8")).toBe("hello");
    expect(new TextDecoder().decode((await s.read("notes", "dir/sub/a.txt"))!)).toBe("hello");
    await s.write("notes", "dir/sub/a.txt", text("hi"));
    expect(readFileSync(join(root, "notes", "dir", "sub", "a.txt"), "utf8")).toBe("hi");
    expect((await s.list("notes", "")).map((e) => [e.name, e.kind])).toEqual([["dir", "folder"]]);
    expect((await s.list("notes", "dir/sub"))[0]).toMatchObject({ name: "a.txt", kind: "file", size: 2 });
    expect(await code(s.list("notes", "nope"))).toBe("not_found");
    expect(await code(s.read("notes", "dir"))).toBe("invalid");
    expect(await code(s.write("notes", "dir", text("x")))).toBe("invalid");
    expect(await code(s.write("notes", "dir/sub/a.txt/b", text("x")))).toBe("invalid");
    expect(await s.usage("notes")).toMatchObject({ used: 2 });
    await s.remove("notes", "dir");
    await s.remove("notes", "dir");
    expect(await s.list("notes", "")).toEqual([]);
    // One module never sees another's files.
    await s.write("other", "a.txt", text("o"));
    expect(await s.read("notes", "a.txt")).toBeNull();
  });

  it("refuses modules it does not know and paths that try to leave", async () => {
    const s = service();
    expect(await code(s.write("stranger", "a.txt", text("x")))).toBe("unknown_module");
    expect(await code(s.read("notes", "../outside/secret.txt"))).toBe("invalid");
    expect(await code(s.read("notes", "nul"))).toBe("invalid");
    expect(await code(s.pick("stranger", []))).toBe("unknown_module");
  });

  it("never goes through a link or junction, and never writes a file with other names", async () => {
    const s = service();
    await s.write("notes", "keep.txt", text("k"));
    symlinkSync(outside, join(root, "notes", "door"), "junction");
    expect(await code(s.read("notes", "door/secret.txt"))).toBe("invalid");
    expect(await code(s.write("notes", "door/new.txt", text("x")))).toBe("invalid");
    expect(existsSync(join(outside, "new.txt"))).toBe(false);
    expect(await code(s.list("notes", "door"))).toBe("invalid");
    expect((await s.list("notes", "")).map((e) => e.name)).toEqual(["keep.txt"]);
    await s.remove("notes", "door");
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
    linkSync(join(outside, "secret.txt"), join(root, "notes", "hard.txt"));
    expect(await code(s.write("notes", "hard.txt", text("x")))).toBe("invalid");
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("secret");
  });

  it("refuses a module folder that is itself a junction", async () => {
    mkdirSync(root);
    symlinkSync(outside, join(root, "notes"), "junction");
    const s = service();
    expect(await code(s.write("notes", "a.txt", text("x")))).toBe("invalid");
    expect(existsSync(join(outside, "a.txt"))).toBe(false);
    expect(s.folders()).toEqual([]);
  });

  it("keeps to the limits: one file, the whole folder, the number of entries", async () => {
    const s = service({ fileBytes: 10, moduleBytes: 25, entries: 4 });
    expect(await code(s.write("notes", "big", new Uint8Array(11)))).toBe("too_large");
    await s.write("notes", "a", new Uint8Array(10));
    await s.write("notes", "b", new Uint8Array(10));
    expect(await code(s.write("notes", "c", new Uint8Array(10)))).toBe("quota_exceeded");
    await s.write("notes", "a", new Uint8Array(5));
    await s.write("notes", "c", new Uint8Array(5));
    expect(await code(s.write("notes", "d/e", new Uint8Array(1)))).toBe("quota_exceeded");
    expect(await s.usage("notes")).toEqual({ used: 20, limit: 25, fileLimit: 10 });
  });
});

describe("pick and save", () => {
  it("gives the module the chosen file's bytes and name, never its path", async () => {
    const s = service({ fileBytes: 100 });
    prompts.picked = join(outside, "secret.txt");
    const file = await s.pick("notes", [{ name: "Text", extensions: ["txt"] }]);
    expect(file).toEqual({ name: "secret.txt", data: new Uint8Array(Buffer.from("secret")) });
    expect(JSON.stringify(file)).not.toContain(outside.replaceAll("\\", "\\\\"));
    expect(prompts.pickFile).toHaveBeenCalledWith("notes", [{ name: "Text", extensions: ["txt"] }]);
    prompts.picked = null;
    expect(await s.pick("notes", [])).toBeNull();
    writeFileSync(join(outside, "big.bin"), new Uint8Array(101));
    prompts.picked = join(outside, "big.bin");
    expect(await code(s.pick("notes", []))).toBe("too_large");
  });

  it("main writes the bytes where the owner chose; cancel writes nothing", async () => {
    const s = service();
    prompts.saveTo = join(outside, "out.md");
    expect(await s.save("notes", text("# hi"), "out.md", [])).toEqual({ name: "out.md" });
    expect(readFileSync(join(outside, "out.md"), "utf8")).toBe("# hi");
    expect(prompts.saveFile).toHaveBeenCalledWith("notes", "out.md", []);
    prompts.saveTo = null;
    expect(await s.save("notes", text("x"), null, [])).toBeNull();
  });

  it("one dialog at a time", async () => {
    let release!: (v: string | null) => void;
    prompts.pickFile = vi.fn(() => new Promise<string | null>((r) => (release = r)));
    const s = service();
    const first = s.pick("notes", []);
    expect(await code(s.pick("notes", []))).toBe("busy");
    release(null);
    expect(await first).toBeNull();
  });
});

describe("Settings and removal", () => {
  it("lists every module folder, known or not; deletes only after the owner's yes", async () => {
    const s = service();
    await s.write("notes", "a", text("abc"));
    mkdirSync(join(root, "gone-module"));
    writeFileSync(join(root, "gone-module", "x"), "12345");
    expect(s.folders()).toEqual([{ id: "gone-module", bytes: 5, known: false }, { id: "notes", bytes: 3, known: true }]);
    prompts.clearYes = false;
    expect(await s.clear("gone-module")).toBe(false);
    expect(existsSync(join(root, "gone-module", "x"))).toBe(true);
    prompts.clearYes = true;
    expect(await s.clear("gone-module")).toBe(true);
    expect(existsSync(join(root, "gone-module"))).toBe(false);
    expect(prompts.confirmClear).toHaveBeenLastCalledWith("gone-module", 5);
  });

  const source = { indexUrl: "https://github.com/o/r/releases/download/modules-release/modules.json", signatureUrl: "https://github.com/o/r/releases/download/modules-release/modules.json.minisig", extraOrigins: [], keys: [parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY)], testKey: true };
  const offline = (async () => ({ status: 404, header: () => null, body: (async function* () {})(), cancel: () => {} })) as unknown as Transport;

  async function installed(choice: "keep" | "delete" | null) {
    const packs = join(base, "modules");
    const file = join(base, "notes.tar.gz");
    const files = { "index.js": "export default {}", "pack.json": JSON.stringify({ id: "notes", version: "1.0.0", moduleApi: "^1.16", entry: "index.js", styles: [], host: {} }) };
    writeFileSync(file, writeTarGz(Object.entries(files).map(([path, data]) => ({ path, data }))));
    const data = service();
    await data.write("notes", "kept.json", text("{}"));
    const confirmRemove = vi.fn(async () => choice);
    const s = new ModulePackService({
      root: packs, source, transport: offline, appModuleApi: "1.30",
      local: {
        defaultAllowed: true, reservedIds: [],
        prompts: { pickFile: async () => file, confirmInstall: async () => true, confirmAllow: async () => true },
        data: { has: (id) => data.has(id), bytes: (id) => data.bytes(id), delete: (id) => data.delete(id), confirmRemove },
      },
    });
    expect((await s.installLocal()).installed.map((p) => p.id)).toEqual(["notes"]);
    return { s, confirmRemove, packs };
  }

  it("removing a local module asks main's own question about its data; cancel removes nothing", async () => {
    const { s, confirmRemove } = await installed(null);
    expect((await s.remove({ id: "notes" })).installed.map((p) => p.id)).toEqual(["notes"]);
    expect(confirmRemove).toHaveBeenCalledWith("notes", 2);
    expect(existsSync(join(root, "notes", "kept.json"))).toBe(true);
  });

  it("keep: the code goes, the data stays and shows as a folder without its module", async () => {
    const { s, packs } = await installed("keep");
    expect((await s.remove({ id: "notes" })).installed).toEqual([]);
    expect(existsSync(join(packs, "notes"))).toBe(false);
    expect(existsSync(join(root, "notes", "kept.json"))).toBe(true);
  });

  it("delete: the code and the data go", async () => {
    const { s } = await installed("delete");
    expect((await s.remove({ id: "notes" })).installed).toEqual([]);
    expect(existsSync(join(root, "notes"))).toBe(false);
  });
});

describe("the renderer side", () => {
  it("binds the module id, encodes text, and gives errors a code", async () => {
    const calls: unknown[][] = [];
    const bridge = {
      read: async (...a: unknown[]) => (calls.push(["read", ...a]), text("héllo")),
      write: async (...a: unknown[]) => void calls.push(["write", ...a]),
      remove: async () => {
        throw new Error("Error invoking remote method 'cutex-desktop:module-data': Error: invalid: \"..\" is not a path inside the module's folder");
      },
      list: async () => [],
      usage: async () => ({ used: 0, limit: 1, fileLimit: 1 }),
      pick: async () => ({ name: "a.txt", data: text("abc") }),
      save: async (...a: unknown[]) => (calls.push(["save", ...a]), { name: "b.txt" }),
      folders: async () => [],
      clear: async () => true,
    };
    const data = moduleDataFor("notes", () => bridge);
    expect(await data.readText("a")).toBe("héllo");
    await data.write("a", "é");
    expect(calls[1]).toEqual(["write", "notes", "a", text("é")]);
    const err = await data.remove("..").catch((e: Error & { code?: string }) => e);
    expect(err).toMatchObject({ code: "invalid", message: "invalid: \"..\" is not a path inside the module's folder" });
    const files = moduleFilesFor("notes", () => bridge);
    const picked = await files.pick();
    expect([picked?.name, picked?.size, picked?.text()]).toEqual(["a.txt", 3, "abc"]);
    expect(await files.save("x", { suggestedName: "b.txt", filters: [{ name: "Text", extensions: ["txt"] }] })).toEqual({ name: "b.txt" });
    expect(calls[2]).toEqual(["save", "notes", text("x"), "b.txt", [{ name: "Text", extensions: ["txt"] }]]);
    expect(await moduleDataFor("", () => bridge).read("a").catch((e: { code?: string }) => e.code)).toBe("unknown_module");
    expect(await moduleDataFor("notes", () => undefined).read("a").catch((e: { code?: string }) => e.code)).toBe("unavailable");
  });
});
