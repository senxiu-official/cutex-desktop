// Signed module packs, build + end to end (docs/desktop-modules.md §23.10): the pack builder (host
// externals, refusals, determinism), the index generator (merge, conflicts, serial), and the whole path
// build → sign with the TEST key → serve from a loopback fixture → main's check / download / verify /
// store → cutex-module:// → import → the real module host swaps the pack in.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import type { KeyValueStorage } from "../src/renderer/src/modules/types";
import type { ModulePacksBridge, ModulePacksView } from "../src/shared/modulePacks";
import { APP_DIR, buildPack, packableModules, readHostTable, type BuiltPack } from "../scripts/module-packs/build.mjs";
import { makeIndex } from "../scripts/module-packs/index.mjs";
import { signMinisig } from "../scripts/module-packs/minisign.mjs";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { ModulePackService, modulePackSource, readTar } = await import("../src/main/modulePacks");
const { nodeTransport } = await import("../src/main/updateTransport");
const { parseIndexPack, parseModuleIndex } = await import("../src/shared/modulePacks");
const { checkHostImports, PACK_HOST_MODULES } = await import("../src/renderer/src/modules/packHost");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createPackLoader, packRuntime } = await import("../src/renderer/src/modules/packs");
const { MODULES } = await import("../src/renderer/src/modules/registry");

const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");
const GH = "https://github.com/senxiu-official/cutex-desktop/releases/download/modules-release";
const tmp = mkdtempSync(join(tmpdir(), "cutex-pack-build-test-"));
let pilot: BuiltPack;

beforeAll(async () => {
  pilot = await buildPack("claude-science", join(tmp, "a"), { logLevel: "silent" });
}, 120_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("pack builder", () => {
  it("reads exactly the host table the app provides", () => {
    const table = readHostTable();
    const specs = [...table.bare, ...table.files.values()].sort();
    expect(specs).toEqual(Object.keys(PACK_HOST_MODULES).sort());
  });

  it("the pilot is the only packable module in v1", () => {
    expect(packableModules()).toEqual(["claude-science"]);
  });

  it("builds the pilot as one ES module that reads shared code from the host only", () => {
    const { entry, files } = pilot;
    expect(files.map((f) => f.path)).toEqual(["index.js", "pack.json"]);
    const js = files.find((f) => f.path === "index.js")!.data.toString("utf8");
    expect(js).not.toMatch(/^\s*import[\s{*]/m);
    expect(js).not.toMatch(/\bimport\(/);
    expect(js).toContain("__CUTEX_MODULE_HOST__");
    // No second React: no React internals are bundled.
    expect(js).not.toMatch(/__CLIENT_INTERNALS_DO_NOT_USE|react\.production|ReactCurrentDispatcher/);
    expect(entry.host["react"]).toContain("useState");
    expect(entry.host["@cutex-desktop/app/store"]).toEqual(["useApp"]);
    expect(entry.host["@cutex-desktop/app/modules/slots"]).toEqual(["defineModule"]);
    // Every recorded name exists in this app's host table.
    expect(checkHostImports(entry.host)).toEqual([]);
    const manifest = JSON.parse(files.find((f) => f.path === "pack.json")!.data.toString("utf8"));
    expect(manifest).toEqual({ id: "claude-science", version: entry.version, moduleApi: entry.moduleApi, entry: "index.js", styles: [], host: entry.host });
    expect(entry.title?.en).toBe("Claude Science");
    // The index entry passes the app's strict parser once it has a URL.
    expect(parseIndexPack({ ...entry, archive: { ...entry.archive, url: `${GH}/${entry.archive.name}` } }, () => true).id).toBe("claude-science");
    // The archive holds exactly those files, byte for byte.
    const tar = readTar(gunzipSync(readFileSync(pilot.archivePath)));
    expect([...tar.keys()].sort()).toEqual(["index.js", "pack.json"]);
    for (const f of entry.files) expect(sha(tar.get(f.path)!)).toBe(f.sha256);
  });

  it("is deterministic", async () => {
    const again = await buildPack("claude-science", join(tmp, "b"), { logLevel: "silent" });
    expect(again.entry.archive.sha256).toBe(pilot.entry.archive.sha256);
    expect(readFileSync(again.archivePath).equals(readFileSync(pilot.archivePath))).toBe(true);
  }, 120_000);

  it("refuses app files the host does not provide, other modules and a second React", async () => {
    const src = join(APP_DIR, "src/renderer/src");
    const mod = (name: string, body: string) => {
      const dir = join(tmp, "mods", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "pack.json"), JSON.stringify({ version: "1.0.0", moduleApi: "^1.16" }));
      writeFileSync(join(dir, "index.ts"), body);
      return dir;
    };
    const defineOk = `import { defineModule } from ${JSON.stringify(join(src, "modules/slots"))};\n`;
    const cases: [string, string, RegExp][] = [
      ["registry", `${defineOk}import { MODULES } from ${JSON.stringify(join(src, "modules/registry"))};\nexport default defineModule({ id: "zz", titleKey: String(MODULES.length) } as never);`, /modules\/registry\.ts: outside modules\/zz\/ and not provided/],
      ["other-module", `${defineOk}import nci from ${JSON.stringify(join(src, "modules/nci/index.ts"))};\nexport default defineModule({ id: "zz", titleKey: String(nci) } as never);`, /modules\/nci\/index\.ts: outside/],
      ["dev", `${defineOk}import * as m from ${JSON.stringify(join(src, "dev/mockFeatures.ts"))};\nexport default defineModule({ id: "zz", titleKey: String(m) } as never);`, /dev\/mockFeatures\.ts: outside/],
      ["react-dom-client", `${defineOk}import { createRoot } from "react-dom/client";\nexport default defineModule({ id: "zz", titleKey: String(createRoot) } as never);`, /only the host.s react/],
    ];
    for (const [name, body, error] of cases) {
      await expect(buildPack("zz", join(tmp, "out-refused"), { moduleDir: mod(name, body), logLevel: "silent" }), name).rejects.toThrow(error);
    }
    const tooNew = mod("too-new", `${defineOk}export default defineModule({ id: "zz", titleKey: "zz.title" } as never);`);
    writeFileSync(join(tooNew, "pack.json"), JSON.stringify({ version: "1.0.0", moduleApi: "^1.99" }));
    await expect(buildPack("zz", join(tmp, "out-refused"), { moduleDir: tooNew, logLevel: "silent" })).rejects.toThrow(/does not accept this source's MODULE_API_VERSION/);
  }, 120_000);
});

describe("index generator", () => {
  it("merges the previous index, keeps published entries, refuses changed bytes for a published version", async () => {
    const first = await makeIndex({ packsDir: join(tmp, "a"), baseUrl: GH, now: 1_800_000_000 });
    expect(first.added).toHaveLength(1);
    expect(first.index.packs[0]!.archive.url).toBe(`${GH}/claude-science-${pilot.entry.version}.tar.gz`);
    expect(parseModuleIndex(first.index, () => true).serial).toBe(1_800_000_000);
    // Rebuilt identical: nothing new; serial still moves forward even with an earlier clock.
    const second = await makeIndex({ packsDir: join(tmp, "b"), baseUrl: GH, previous: first.index, now: 1_700_000_000 });
    expect(second.added).toEqual([]);
    expect(second.index.serial).toBe(1_800_000_001);
    expect(second.index.packs).toEqual(first.index.packs);
    // Different bytes under a published version: stop.
    const changed = await buildPack("claude-science", join(tmp, "c"), { styles: true, logLevel: "silent" });
    expect(changed.files.map((f) => f.path)).toEqual(["index.css", "index.js", "pack.json"]);
    expect(readTar(gunzipSync(readFileSync(changed.archivePath))).get("index.css")!.toString("utf8")).toMatch(/^@layer properties|@layer cutex-pack\{/);
    await expect(makeIndex({ packsDir: join(tmp, "c"), baseUrl: GH, previous: first.index })).rejects.toThrow(/already published with different contents/);
    // Archive URLs only on GitHub's download hosts (or a loopback fixture).
    await expect(makeIndex({ packsDir: join(tmp, "a"), baseUrl: "https://example.com/m" })).rejects.toThrow(/archive url not allowed/);
  }, 120_000);
});

describe("end to end: build → sign (test key) → serve → download → verify → load", () => {
  let server: Server;
  let base: string;
  const served = new Map<string, Buffer>();
  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = served.get(req.url ?? "");
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Length": String(body.length), "Content-Type": "application/octet-stream" }).end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("installs the signed pilot and swaps it into the real module host", async () => {
    const { index } = await makeIndex({ packsDir: join(tmp, "a"), baseUrl: `${base}/r` });
    const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
    served.set("/r/modules.json", bytes);
    served.set("/r/modules.json.minisig", Buffer.from(signMinisig(bytes, "modules.json")));
    served.set(`/r/${pilot.entry.archive.name}`, readFileSync(pilot.archivePath));

    // An unpackaged app (dev / test): trusts the test key and the loopback index.
    const env = { CUTEX_DESKTOP_MODULES_INDEX: `${base}/r/modules.json` };
    const root = join(tmp, "userData", "modules");
    const service = new ModulePackService({ root, source: modulePackSource({ releasePage: null, packaged: false, env }), transport: nodeTransport(), appModuleApi: "1.16" });
    const checked = await service.check();
    expect(checked.check).toBeNull();
    expect(checked.index?.packs.map((p) => `${p.id}@${p.version}:${p.compat}`)).toEqual([`claude-science@${pilot.entry.version}:ok`]);
    const view = await service.install({ id: "claude-science" });
    expect(view.lastError).toBeNull();
    expect(view.installed.map((p) => p.id)).toEqual(["claude-science"]);
    const installed = view.installed[0]!;

    // A packaged app never trusts the test key: the same index does not verify.
    const packaged = new ModulePackService({ root: join(tmp, "packaged"), source: { ...modulePackSource({ releasePage: null, packaged: true }), indexUrl: `${base}/r/modules.json`, signatureUrl: `${base}/r/modules.json.minisig`, extraOrigins: [base] }, transport: nodeTransport(), appModuleApi: "1.16" });
    expect((await packaged.check()).check).toMatchObject({ kind: "invalid", error: expect.stringMatching(/signature does not verify: signed with an unknown key/) });

    // After a restart the store is verified again and served through cutex-module://.
    const restarted = new ModulePackService({ root, source: modulePackSource({ releasePage: null, packaged: false, env }), transport: nodeTransport(), appModuleApi: "1.16" });
    expect(restarted.view().installed.map((p) => p.entry)).toEqual([installed.entry]);
    const res = restarted.respond(new Request(installed.entry));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    const js = Buffer.from(await res.arrayBuffer());
    expect(js.equals(pilot.files.find((f) => f.path === "index.js")!.data)).toBe(true);

    // The renderer: real module host with the bundled pilot, pack loader with the served bytes.
    const entryFile = join(tmp, "served-entry.mjs");
    writeFileSync(entryFile, js);
    const data = new Map<string, string>();
    const storage: KeyValueStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const host = createModuleHost({ modules: MODULES, slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set<string>() }, storage, services: () => stubServices(), log() {} });
    await host.idle();
    const bundledDef = host.modules.find((m) => m.id === "claude-science");
    expect(bundledDef).toBeDefined();
    const listeners = new Set<(v: ModulePacksView) => void>();
    const bridge: ModulePacksBridge = { state: async () => restarted.view(), check: async () => restarted.view(), install: async () => restarted.view(), remove: async () => restarted.view(), onState: (l) => (listeners.add(l), () => listeners.delete(l)) };
    const imported: string[] = [];
    const loader = createPackLoader({
      host,
      bundled: MODULES,
      // The bundled copy is older than the pack in this test (in the app a pack only wins when newer).
      bundledVersions: { "claude-science": "0.9.0" },
      bridge,
      importEntry: async (url) => {
        imported.push(url);
        return import(/* @vite-ignore */ pathToFileURL(entryFile).href);
      },
    });
    try {
      await loader.start();
      await loader.idle();
      expect(imported).toEqual([installed.entry]);
      expect(packRuntime().decisions["claude-science"]).toEqual({ use: true, version: pilot.entry.version });
      expect(packRuntime().active["claude-science"]).toBe(pilot.entry.version);
      const swapped = host.modules.find((m) => m.id === "claude-science")!;
      expect(swapped).not.toBe(bundledDef);
      expect(swapped.contributes?.["main.page"]?.[0]?.id).toBe("claude-science.page");
      expect(host.statuses().get("claude-science")?.state.kind).not.toBe("failed");
    } finally {
      loader.dispose();
      await host.dispose();
    }
  }, 120_000);
});
