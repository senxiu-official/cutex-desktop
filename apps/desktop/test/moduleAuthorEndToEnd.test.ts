// What a module author does, start to finish: the real `cutex-module new` + `pack` output, through the real install path
// (only the owner's native prompts are stubbed), its served entry run on the real module host. Keeps the command and the
// installer from disagreeing about what a pack is.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MODULE_API_VERSION } from "@cutex-desktop/plugin-sdk";
import { stubServices } from "./serviceStub";
import { ModulePackService } from "../src/main/modulePacks";
import { parsePublicKey } from "../src/main/minisign";
import { MODULE_PACK_TEST_PUBLIC_KEY, type InstalledPackView } from "../src/shared/modulePacks";
import { ModuleDataService } from "../src/main/moduleData";
import { parseModuleDataRequest, type ModuleDataBridge } from "../src/shared/moduleData";
import { moduleDataFor, moduleFilesFor } from "../src/renderer/src/lib/moduleData";

vi.mock("electron", () => ({ dialog: {} }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { validatePackEntry } = await import("../src/renderer/src/modules/packs");
const { checkPublicHostImports, installPackHost, usesExperimentalApi } = await import("../src/renderer/src/modules/packHost");

const BIN = resolve("../../packages/module-api/bin/cutex-module.mjs");
const PACKAGE = resolve(dirname(BIN), "..");
const BASE = "https://github.com/senxiu-official/cutex-desktop/releases/download/modules-release";

let tmp: string;
const links: string[] = [];

function start(name: string): string {
  const made = spawnSync(process.execPath, [BIN, "new", name], { cwd: tmp, encoding: "utf8" });
  expect(made.status, made.stderr).toBe(0);
  const dir = join(tmp, name);
  // What `npm install` gives the folder, without the network.
  const modules = join(dir, "node_modules");
  mkdirSync(join(modules, "@cutex-desktop"), { recursive: true });
  const link = (target: string, at: string) => {
    symlinkSync(target, join(modules, at), "junction");
    links.push(join(modules, at));
  };
  link(PACKAGE, "@cutex-desktop/module-api");
  link(resolve("node_modules/react"), "react");
  link(resolve("node_modules/lucide-react"), "lucide-react");
  return dir;
}

function pack(dir: string): string {
  const packed = spawnSync(process.execPath, [BIN, "pack"], { cwd: dir, encoding: "utf8" });
  expect(packed.status, packed.stderr).toBe(0);
  const manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")) as { id: string; version: string };
  return join(dir, "dist", `${manifest.id}-${manifest.version}.tar.gz`);
}

async function install(archive: string): Promise<{ service: ModulePackService; pack: InstalledPackView }> {
  const service = new ModulePackService({
    root: mkdtempSync(join(tmp, "root-")),
    source: { indexUrl: `${BASE}/modules.json`, signatureUrl: `${BASE}/modules.json.minisig`, extraOrigins: [], keys: [parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY)], testKey: true },
    transport: (async () => {
      throw new Error("no network here");
    }) as never,
    appModuleApi: MODULE_API_VERSION,
    local: {
      defaultAllowed: true,
      reservedIds: ["claude-science"],
      prompts: { pickFile: async () => archive, confirmInstall: async () => true, confirmAllow: async () => true },
    },
  });
  const view = await service.installLocal();
  expect(view.local.error).toBeFalsy();
  const installed = view.installed.find((p) => p.local);
  expect(installed).toBeTruthy();
  return { service, pack: installed! };
}

/** preload + main/index.ts for module data: every call through main's own request parser, errors as Electron words them. */
function ipcBridge(data: ModuleDataService): ModuleDataBridge {
  const invoke = async (raw: unknown): Promise<never> => {
    try {
      const r = parseModuleDataRequest(raw);
      switch (r.op) {
        case "read": return (await data.read(r.id, r.path)) as never;
        case "write": return (await data.write(r.id, r.path, r.data)) as never;
        case "remove": return (await data.remove(r.id, r.path)) as never;
        case "list": return (await data.list(r.id, r.path)) as never;
        case "usage": return (await data.usage(r.id)) as never;
        case "pick": return (await data.pick(r.id, r.filters)) as never;
        case "save": return (await data.save(r.id, r.data, r.suggestedName, r.filters)) as never;
        case "folders": return data.folders() as never;
        case "clear": return (await data.clear(r.id)) as never;
      }
    } catch (error) {
      throw new Error(`Error invoking remote method 'cutex-desktop:module-data': Error: ${(error as Error).message}`);
    }
  };
  return {
    read: (id, path) => invoke({ op: "read", id, path }),
    write: (id, path, bytes) => invoke({ op: "write", id, path, data: bytes }),
    remove: (id, path) => invoke({ op: "remove", id, path }),
    list: (id, path) => invoke({ op: "list", id, path }),
    usage: (id) => invoke({ op: "usage", id }),
    pick: (id, filters) => invoke({ op: "pick", id, filters }),
    save: (id, bytes, suggestedName, filters) => invoke({ op: "save", id, data: bytes, suggestedName, filters }),
    folders: () => invoke({ op: "folders" }),
    clear: (id) => invoke({ op: "clear", id }),
  };
}

/** The entry as main serves it, imported and put on a real module host. */
async function run(service: ModulePackService, pack: InstalledPackView, dataBridge?: ModuleDataBridge) {
  expect(checkPublicHostImports(pack.host)).toEqual([]);
  const served = service.respond(new Request(pack.entry));
  expect(served.status).toBe(200);
  const file = join(tmp, `served-${pack.id}.mjs`);
  writeFileSync(file, await served.text());
  installPackHost();
  const { module } = validatePackEntry(await import(/* @vite-ignore */ pathToFileURL(file).href), pack);
  const data = new Map<string, string>();
  const host = createModuleHost({ modules: [module], slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set<string>() }, storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }, services: () => stubServices(), ...(dataBridge ? { scopedServices: (scope: { id: string }) => ({ ...stubServices(), data: moduleDataFor(scope.id, () => dataBridge), files: moduleFilesFor(scope.id, () => dataBridge) }) } : {}), log() {} });
  await host.idle();
  return host;
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "cutex-module-e2e-"));
});
afterAll(() => {
  // The links first: they point at the checkout's own packages.
  for (const link of links) unlinkSync(link);
  rmSync(tmp, { recursive: true, force: true });
});

describe("a module from the template", () => {
  it("installs from its pack untouched and starts", async () => {
    const dir = start("from-template");
    const { service, pack: installed } = await install(pack(dir));
    expect(installed).toMatchObject({ id: "from-template", version: "0.1.0", local: true });
    expect(Object.keys(installed.host)).toContain("@cutex-desktop/module-api/ui");
    const host = await run(service, installed);
    expect(host.statuses().get("from-template")?.state.kind).toBe("active");
    await host.dispose();
  }, 120_000);

  it("installs with CSS and the experimental entry too", async () => {
    const dir = start("with-extras");
    writeFileSync(join(dir, "src/style.css"), ".with-extras-x { color: red; }\n");
    writeFileSync(
      join(dir, "src/index.tsx"),
      `import { defineModule } from "@cutex-desktop/module-api";
import { side } from "@cutex-desktop/module-api/experimental";
import "./style.css";
export const touched = typeof side;
export default defineModule({ id: "with-extras", titleKey: "with-extras.title" });
`,
    );
    const { service, pack: installed } = await install(pack(dir));
    expect(usesExperimentalApi(installed.host)).toBe(true);
    expect(installed.styles).toHaveLength(1);
    expect(await service.respond(new Request(installed.styles[0]!)).text()).toContain("with-extras-x");
    const host = await run(service, installed);
    expect(host.statuses().get("with-extras")?.state.kind).toBe("active");
    await host.dispose();
  }, 120_000);

  it("uses its own data folder and the owner's chosen files (v1.31)", async () => {
    const dir = start("with-files");
    writeFileSync(
      join(dir, "src/index.tsx"),
      `import { defineModule } from "@cutex-desktop/module-api";
export default defineModule({
  id: "with-files",
  titleKey: "with-files.title",
  async activate(ctx) {
    await ctx.services.data.write("notes/a.json", JSON.stringify({ n: 1 }));
    const back = await ctx.services.data.readText("notes/a.json");
    const picked = await ctx.services.files.pick({ filters: [{ name: "Text", extensions: ["txt"] }] });
    const saved = await ctx.services.files.save("copy: " + picked?.text(), { suggestedName: "../out.txt" });
    const escape = await ctx.services.data.read("../with-files-other/x").catch((e: { code?: string }) => e.code);
    const list = await ctx.services.data.list("notes");
    (globalThis as Record<string, unknown>).__withFiles = { back, picked: picked && { name: picked.name, size: picked.size }, saved, escape, list: list.map((e) => e.name), usage: (await ctx.services.data.usage()).used };
  },
});
`,
    );
    const { service, pack: installed } = await install(pack(dir));
    const root = join(tmp, "userData", "module-data");
    const chosen = join(tmp, "chosen.txt");
    const saveTo = join(tmp, "saved-here.txt");
    writeFileSync(chosen, "from the owner");
    const asked: unknown[] = [];
    const data = new ModuleDataService({
      root,
      known: (id) => service.installedIds().includes(id),
      prompts: { pickFile: async (...a) => (asked.push(["pick", ...a]), chosen), saveFile: async (...a) => (asked.push(["save", ...a]), saveTo), confirmClear: async () => false },
    });
    const host = await run(service, installed, ipcBridge(data));
    expect(host.statuses().get("with-files")?.state).toMatchObject({ kind: "active" });
    expect((globalThis as Record<string, unknown>).__withFiles).toEqual({ back: '{"n":1}', picked: { name: "chosen.txt", size: 14 }, saved: { name: "saved-here.txt" }, escape: "invalid", list: ["a.json"], usage: 7 });
    expect(readFileSync(join(root, "with-files", "notes", "a.json"), "utf8")).toBe('{"n":1}');
    expect(readFileSync(saveTo, "utf8")).toBe("copy: from the owner");
    // The dialogs were told which module asks; the module's suggested name lost its "../".
    expect(asked).toEqual([["pick", "with-files", [{ name: "Text", extensions: ["txt"] }]], ["save", "with-files", "out.txt", []]]);
    await host.dispose();
  }, 120_000);
});
