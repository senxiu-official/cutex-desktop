import { afterEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePluginManifest } from "@cutex-desktop/plugin-sandbox";
import { PluginManager } from "../src/renderer/src/modules/plugins/manager";
import { PluginRuntime } from "../src/renderer/src/modules/plugins/runtime";
import type { AppModule, AppModuleHost } from "../src/renderer/src/modules/slots";
import type { PluginCatalog } from "../src/shared/plugins";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { pluginDefinition } = await import("../src/renderer/src/modules/plugins/definition");

const raw = (id = "desk-note", extra = {}) => ({ apiVersion: 1, id, name: id, version: "1.0.0", entry: "index.html", capabilities: ["views", "entries", "settings"], contributes: { "main.page": [{ id: `${id}.main`, title: id }], "nav.primary": [{ id: `${id}.open`, title: id, page: `${id}.main` }] }, ...extra });
const catalog = (id = "desk-note", extra = {}, fingerprint = "a".repeat(64)): PluginCatalog => ({ plugins: [{ manifest: raw(id, extra), fingerprint }], errors: [] });
const hosts: AppModuleHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.dispose(); });

function fixture(read: () => Promise<PluginCatalog> = async () => catalog()) {
  let host: AppModuleHost;
  const runtimes: PluginRuntime[] = [];
  const storage = new Map<string, string>();
  const contribute = vi.fn();
  const manager = new PluginManager({ catalog: read, host: () => host, definition: (runtime) => { runtimes.push(runtime); return pluginDefinition(runtime); }, contributeManagement: contribute });
  const modules: AppModule[] = [{ id: "plugins", titleKey: "plugins.title", activate: (context) => manager.activate(context) }];
  host = createModuleHost({ modules, slots: SLOT_SPECS, host: { id: "A", kind: "local", features: new Set() }, storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }, services: () => stubServices(), log: () => {} });
  hosts.push(host);
  const ready = async () => { await host.idle(); await new Promise((resolve) => setTimeout(resolve, 5)); await manager.idle(); await host.idle(); };
  return { host, manager, runtimes, storage, contribute, ready };
}

describe("trusted desktop plugin adapter", () => {
  it("catalog loading never blocks activation and permissions are not granted automatically", async () => {
    let release!: (value: PluginCatalog) => void;
    const read = vi.fn(() => new Promise<PluginCatalog>((resolve) => { release = resolve; }));
    const f = fixture(read);
    await f.host.idle();
    expect(f.host.statuses().get("plugins")?.state.kind).toBe("active");
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(f.host.snapshot("main.page")).toEqual([]);
    release(catalog()); await f.manager.idle();
    expect(f.manager.snapshot().plugins[0]?.permissions).toEqual([]);
    expect(f.host.modules.map((module) => module.id)).toEqual(["plugins"]);
    expect(f.contribute).toHaveBeenCalledOnce();
  });

  it("granting views and entries creates one namespaced module and keeps required false", async () => {
    const f = fixture(); await f.ready();
    await f.manager.setPermissions("desk-note", ["views"]);
    expect(f.host.snapshot("main.page").map((row) => row.item.id)).toEqual(["external-desk-note.main"]);
    expect(f.host.snapshot("nav.primary")).toEqual([]);
    await f.manager.setPermissions("desk-note", ["views", "entries"]);
    expect(f.host.snapshot("nav.primary").map((row) => [row.item.id, row.item.title])).toEqual([["external-desk-note.open", "desk-note"]]);
    const definition = f.host.modules.find((module) => module.id === "external-desk-note")!;
    expect(definition.required).toBe(false);
    expect(definition.displayName).toBe("desk-note");
    await expect(f.manager.setPermissions("desk-note", ["agents.read"])).rejects.toThrow("not requested");
  });

  it("revoke closes frames synchronously, removes contributions and preserves isolated settings", async () => {
    const f = fixture(); await f.ready();
    await f.manager.setPermissions("desk-note", ["views", "settings"]);
    const runtime = f.runtimes.at(-1)!; const scope = runtime.snapshot()!;
    const dispose = vi.fn(); runtime.track(scope, dispose);
    scope.context.prefs.set("note", "owned note");
    const removed = f.manager.setPermissions("desk-note", []);
    expect(dispose).toHaveBeenCalledOnce(); expect(scope.signal.aborted).toBe(true);
    await removed;
    expect(f.host.snapshot("main.page")).toEqual([]);
    await f.manager.setPermissions("desk-note", ["views", "settings"]);
    expect(f.runtimes.at(-1)!.snapshot()!.context.prefs.get("note", "")).toBe("owned note");
    expect(f.host.prefs("plugins").get("note", null)).toBeNull();
  });

  it("a consent that cannot be saved grants nothing new, still revokes, and is reported", async () => {
    const f = fixture(); await f.ready();
    await f.manager.setPermissions("desk-note", ["views", "entries"]);
    const runtime = f.runtimes.at(-1)!; const dispose = vi.fn(); runtime.track(runtime.snapshot()!, dispose);
    f.storage.set = () => { throw new Error("quota exceeded"); };
    await expect(f.manager.setPermissions("desk-note", ["views", "entries", "settings"])).rejects.toThrow("quota exceeded");
    expect(f.manager.snapshot().plugins[0]!.permissions).toEqual(["views", "entries"]);
    expect(dispose).toHaveBeenCalledOnce();
    await expect(f.manager.setPermissions("desk-note", ["views"])).rejects.toThrow("quota exceeded");
    expect(f.manager.snapshot().plugins[0]!.permissions).toEqual(["views"]);
    expect(f.host.snapshot("nav.primary")).toEqual([]);
  });

  it("refresh preserves an off preference; the explicit Grant and enable action restores it", async () => {
    const f = fixture(); await f.ready(); await f.manager.setPermissions("desk-note", ["views"]);
    await f.host.setEnabled("external-desk-note", false);
    await f.manager.refresh();
    expect(f.host.isEnabled("external-desk-note")).toBe(false);
    expect(f.host.snapshot("main.page")).toEqual([]);
    await f.manager.setPermissions("desk-note", ["views"]);
    expect(f.host.isEnabled("external-desk-note")).toBe(true);
    expect(f.host.snapshot("main.page")).toHaveLength(1);
  });

  it("catalog errors remain visible and can be retried without creating external modules", async () => {
    const f = fixture(async () => { throw new Error("catalog denied"); }); await f.ready();
    expect(f.manager.snapshot().errors).toEqual([{ id: "catalog", message: "catalog denied" }]);
    expect(f.contribute).toHaveBeenCalledOnce();
    expect(f.host.modules).toHaveLength(1);
  });

  it("a fast revoke cannot be overwritten by a queued older grant", async () => {
    const f = fixture(); await f.ready();
    const granting = f.manager.setPermissions("desk-note", ["views", "entries"]);
    const revoking = f.manager.setPermissions("desk-note", []);
    await Promise.all([granting, revoking]);
    expect(f.host.snapshot("main.page")).toEqual([]);
    expect(f.runtimes).toHaveLength(0);
    expect(f.manager.snapshot().plugins[0]?.permissions).toEqual([]);
  });

  it("changed plugin bytes invalidate prior grants and dispose every previous frame", async () => {
    let content = catalog(); const f = fixture(async () => content); await f.ready();
    await f.manager.setPermissions("desk-note", ["views", "entries"]);
    const previous = f.runtimes.at(-1)!.snapshot()!;
    content = catalog("desk-note", {}, "b".repeat(64));
    await f.manager.refresh();
    expect(previous.signal.aborted).toBe(true);
    expect(f.manager.snapshot().plugins[0]).toMatchObject({ permissions: [], changed: true });
    expect(f.host.snapshot("main.page")).toEqual([]);
  });

  it("manifest requirements use actual host capability/kind and external dependency gates", async () => {
    const f = fixture(async () => catalog("desk-note", { requires: { hosts: "local", cutexCapabilities: ["job-service"] }, dependencies: ["helper"] }));
    await f.ready(); await f.manager.setPermissions("desk-note", ["views", "entries"]);
    expect(f.host.snapshot("main.page")).toEqual([]);
    expect(f.host.statuses().get("external-desk-note")?.state).toMatchObject({ kind: "failed" });
    await f.host.addModules([{ id: "external-helper", titleKey: "plugins.externalTitle", defaultEnabled: false }]);
    expect(f.host.statuses().get("external-desk-note")?.state).toMatchObject({ kind: "unavailable", missing: { capabilities: ["job-service"], modules: ["external-helper"] } });
    const definition = f.host.modules.find((module) => module.id === "external-desk-note")!;
    // v1.5: a plugin frame lives on one host, the focus (requires.focusHost).
    expect(definition.requires).toEqual({ focusHost: true, capabilities: ["job-service"], modules: ["plugins", "external-helper"], hostKinds: ["local"] });
  });

  it("host A→B→A invalidates scopes without resurrecting the old iframe lifetime", async () => {
    const f = fixture(); await f.ready(); await f.manager.setPermissions("desk-note", ["views"]);
    const original = f.runtimes.at(-1)!; const scope = original.snapshot()!; const dispose = vi.fn(); original.track(scope, dispose);
    await f.host.setHost({ id: "B", kind: "ssh", features: new Set() }); await f.ready();
    expect(scope.signal.aborted).toBe(true); expect(dispose).toHaveBeenCalledOnce();
    await f.host.setHost({ id: "A", kind: "local", features: new Set() }); await f.ready();
    expect(original.current(scope)).toBe(false);
    expect(f.runtimes.at(-1)!.snapshot()?.context.host.id).toBe("A");
    expect(f.host.snapshot("main.page").map((row) => row.item.id)).toEqual(["external-desk-note.main"]);
  });

  it("disabling plugins revokes frames and late catalog results cannot register modules", async () => {
    let release!: (value: PluginCatalog) => void;
    const read = vi.fn(() => new Promise<PluginCatalog>((resolve) => { release = resolve; }));
    const f = fixture(read); await f.host.idle(); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await f.host.setEnabled("plugins", false); release(catalog()); await f.manager.idle();
    expect(f.manager.snapshot().plugins).toEqual([]);
    expect(f.host.modules.map((module) => module.id)).toEqual(["plugins"]);
  });

  it("unknown capabilities and reserved schema fields remain explicit catalog refusals", async () => {
    const unsupported = catalog("desk-note", { capabilities: ["views", "daemon.sessions"] });
    const f = fixture(async () => unsupported); await f.ready();
    expect(f.manager.snapshot().plugins).toEqual([]);
    expect(f.manager.snapshot().errors[0]?.message).toContain("Unsupported plugin capability");
    expect(f.host.modules).toHaveLength(1);
    expect(() => parsePluginManifest(raw("desk-note", { trusted: true }))).toThrow("Unsupported manifest field");
  });

  it("checked-in examples declare only supported isolated surfaces and permissions", () => {
    for (const id of ["desk-note", "nci-board"]) {
      const dir = resolve(__dirname, `../../../examples/plugins/${id}`);
      const manifest = parsePluginManifest(JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")));
      expect(manifest.id).toBe(id);
      expect(manifest.contributes["main.page"]).toHaveLength(1);
      expect(manifest.contributes["nav.primary"]).toHaveLength(1);
      const code = readFileSync(`${dir}/${manifest.script}`, "utf8");
      expect(code).not.toMatch(/window\.cutex|fetch\(|localStorage|document\.cookie|parent\./);
    }
  });
});
