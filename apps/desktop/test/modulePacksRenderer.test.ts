// Signed module packs, renderer side (docs/desktop-modules.md §23.6–§23.9): which pack takes effect, the
// host object and its import check, pack messages, and swapping a pack in / out of the real module host
// through dynamic registration with fallback to the bundled copy.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import type { AppModule, AppModuleHost } from "../src/renderer/src/modules/slots";
import type { KeyValueStorage } from "../src/renderer/src/modules/types";
import type { InstalledPackView, ModulePacksBridge, ModulePacksView } from "../src/shared/modulePacks";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { createPackLoader, packDecision, packRow, validatePackEntry } = await import("../src/renderer/src/modules/packs");
const { checkHostImports, installPackHost, PACK_HOST_MODULES } = await import("../src/renderer/src/modules/packHost");
const { BUNDLED_PACK_VERSIONS } = await import("../src/renderer/src/modules/packVersions");
const { registerModuleMessages, translate, unregisterModuleMessages } = await import("../src/renderer/src/i18n");
const React = await import("react");

const hosts: AppModuleHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.dispose()));
});

function storage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const Page = () => null;
function def(version: string, extra: Partial<AppModule> = {}): AppModule {
  return {
    id: "pilot",
    titleKey: "pilot.title" as AppModule["titleKey"],
    contributes: { "main.page": [{ id: `pilot.page${version.replaceAll(".", "")}` as `${string}.${string}`, Page, useTitle: () => version }] },
    ...extra,
  } as AppModule;
}

function pack(version: string, extra: Partial<InstalledPackView> = {}): InstalledPackView {
  return { id: "pilot", version, moduleApi: "^1.16", compat: "ok", entry: `cutex-module://pack/pilot/${version}/index.js`, styles: [], host: { react: ["useState"] }, ...extra };
}

function view(installed: InstalledPackView[], extra: Partial<ModulePacksView> = {}): ModulePacksView {
  return { appModuleApi: "1.16", testKey: true, installed, broken: [], index: null, checking: false, check: null, operation: null, lastError: null, ...extra };
}

function fakeBridge(initial: ModulePacksView): ModulePacksBridge & { push(v: ModulePacksView): void } {
  const listeners = new Set<(v: ModulePacksView) => void>();
  return {
    state: async () => initial,
    check: async () => initial,
    install: async () => initial,
    remove: async () => initial,
    onState: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    push: (v) => listeners.forEach((l) => l(v)),
  };
}

async function setup(entries: Record<string, unknown>, initial: ModulePacksView, bundledVersion = "1.0.0") {
  const bundled = def("1.0.0", { defaultEnabled: true });
  const host = createModuleHost({ modules: [bundled], slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set<string>() }, storage: storage(), services: () => stubServices(), log() {} });
  hosts.push(host);
  await host.idle();
  const bridge = fakeBridge(initial);
  const imported: string[] = [];
  const loader = createPackLoader({
    host,
    bundled: [bundled],
    bundledVersions: { pilot: bundledVersion },
    bridge,
    importEntry: async (url) => {
      imported.push(url);
      const e = entries[url];
      if (e instanceof Error) throw e;
      return e;
    },
  });
  await loader.start();
  await loader.idle();
  return { host, bundled, bridge, loader, imported, pageIds: () => host.snapshot("main.page").map((r) => r.item.id) };
}

describe("packDecision", () => {
  it("uses only a compatible pack strictly newer than the bundled copy, with every host import present", () => {
    expect(packDecision(pack("1.1.0"), "1.0.0")).toEqual({ use: true });
    expect(packDecision(pack("1.0.0"), "1.0.0")).toMatchObject({ use: false, reason: "notNewer" });
    expect(packDecision(pack("0.9.0"), "1.0.0")).toMatchObject({ use: false, reason: "notNewer" });
    expect(packDecision(pack("0.1.0"), undefined)).toEqual({ use: true });
    expect(packDecision(pack("9.0.0"), null)).toMatchObject({ use: false, reason: "notPackable" });
    expect(packDecision(pack("1.1.0", { moduleApi: "^1.17", compat: "needsNewerApp" }), "1.0.0")).toMatchObject({ reason: "needsNewerApp" });
    expect(packDecision(pack("1.1.0", { moduleApi: "~1.10", compat: "needsNewerModule" }), "1.0.0")).toMatchObject({ reason: "needsNewerModule" });
    // main said ok but this renderer's API disagrees (defence in depth).
    expect(packDecision(pack("1.1.0", { moduleApi: "^2.0" }), "1.0.0")).toMatchObject({ reason: "needsNewerApp" });
    expect(packDecision(pack("1.1.0"), "1.0.0", { missingHost: ["@cutex-desktop/app/lib/gone"] })).toMatchObject({ reason: "needsNewerApp", detail: "@cutex-desktop/app/lib/gone" });
    expect(packDecision(pack("1.1.0"), "1.0.0", { failed: "boom" })).toMatchObject({ reason: "failed", detail: "boom" });
  });
});

describe("host object", () => {
  it("provides the app's own React and app files, and checks a pack's import list", () => {
    const target: Record<string, unknown> = {};
    const host = installPackHost(target);
    expect(installPackHost(target)).toBe(host);
    expect(host.apiVersion).toBe("1.16");
    expect(host.get("react").useState).toBe(React.useState);
    expect(() => host.get("fs")).toThrow(/not provided/);
    expect(() => host.get("__proto__")).toThrow(/not provided/);
    expect(checkHostImports({ react: ["useState", "default"], "@cutex-desktop/app/store": ["useApp"], "@cutex-desktop/app/i18n": ["*"] })).toEqual([]);
    expect(checkHostImports({ react: ["useNothing"], "@cutex-desktop/app/lib/gone": ["x"] })).toEqual(["react#useNothing", "@cutex-desktop/app/lib/gone"]);
    expect(Object.keys(PACK_HOST_MODULES).some((k) => /dev\/|registry|modules\/(?!slots|react)/.test(k))).toBe(false);
  });

  it("the pilot is packable", () => {
    expect(BUNDLED_PACK_VERSIONS["claude-science"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("pack messages", () => {
  it("override the bundled text for the module's own keys only, and go away again", () => {
    const key = "claude-science.title" as Parameters<typeof translate>[0];
    const before = translate(key);
    registerModuleMessages("claude-science", { en: { "claude-science.title": "Pack title" }, "zh-CN": { "claude-science.title": "包标题" } });
    expect(["Pack title", "包标题"]).toContain(translate(key));
    unregisterModuleMessages("claude-science");
    expect(translate(key)).toBe(before);
    expect(() => registerModuleMessages("claude-science", { en: { "shell.title": "x" } })).toThrow(/not its own/);
    expect(() => registerModuleMessages("claude-science", { xx: { "claude-science.x": "x" } })).toThrow(/unknown locale/);
  });
});

describe("validatePackEntry", () => {
  it("refuses entries that do not match their signed index entry", () => {
    const p = pack("1.1.0");
    expect(validatePackEntry({ moduleApi: "^1.16", module: def("1.1.0") }, p).module.id).toBe("pilot");
    expect(() => validatePackEntry(null, p)).toThrow();
    expect(() => validatePackEntry({ moduleApi: "^1.17", module: def("1.1.0") }, p)).toThrow(/moduleApi/);
    expect(() => validatePackEntry({ moduleApi: "^1.16", module: { ...def("1.1.0"), id: "shell" } }, p)).toThrow(/module id/);
    expect(() => validatePackEntry({ moduleApi: "^1.16", module: { ...def("1.1.0"), required: true } }, p)).toThrow(/required/);
    expect(() => validatePackEntry({ moduleApi: "^1.16", module: def("1.1.0"), messages: "x" }, p)).toThrow(/messages/);
  });
});

describe("loading through the module host (§15)", () => {
  it("replaces the bundled copy with a newer pack, and restores it when the pack is removed", async () => {
    const p = pack("1.1.0");
    const { host, bundled, bridge, loader, pageIds } = await setup({ [p.entry]: { moduleApi: "^1.16", module: def("1.1.0", { defaultEnabled: true }), messages: { en: { "pilot.title": "Pilot pack" } } } }, view([p]));
    expect(pageIds()).toEqual(["pilot.page110"]);
    expect(host.modules.find((m) => m.id === "pilot")).not.toBe(bundled);
    expect(host.statuses().get("pilot")?.state.kind).toBe("active");
    bridge.push(view([]));
    await loader.idle();
    expect(host.modules.find((m) => m.id === "pilot")).toBe(bundled);
    expect(pageIds()).toEqual(["pilot.page100"]);
  });

  it("keeps the bundled copy when the pack is not newer, misses a host import, or fails to import / validate", async () => {
    const same = pack("1.0.0");
    expect((await setup({ [same.entry]: { moduleApi: "^1.16", module: def("1.0.0") } }, view([same]))).imported).toEqual([]);
    const missing = pack("1.1.0", { host: { "@cutex-desktop/app/lib/gone": ["x"] } });
    const m = await setup({}, view([missing]));
    expect(m.imported).toEqual([]);
    expect(m.pageIds()).toEqual(["pilot.page100"]);
    const bad = pack("1.2.0");
    const b = await setup({ [bad.entry]: new Error("SyntaxError in pack") }, view([bad]));
    expect(b.pageIds()).toEqual(["pilot.page100"]);
    const { packRuntime } = await import("../src/renderer/src/modules/packs");
    expect(packRuntime().decisions.pilot).toMatchObject({ use: false, reason: "failed", detail: "SyntaxError in pack" });
    const wrong = pack("1.3.0");
    const w = await setup({ [wrong.entry]: { moduleApi: "^1.16", module: { ...def("1.3.0"), id: "other" } } }, view([wrong]));
    expect(w.pageIds()).toEqual(["pilot.page100"]);
  });

  it("falls back to the bundled copy when the pack's activation fails, now or later", async () => {
    const p = pack("1.1.0");
    const failing = def("1.1.0", { defaultEnabled: true, activate: () => { throw new Error("activate boom"); } });
    const now = await setup({ [p.entry]: { moduleApi: "^1.16", module: failing } }, view([p]));
    expect(now.pageIds()).toEqual(["pilot.page100"]);
    expect(now.host.statuses().get("pilot")?.state.kind).toBe("active");

    // Off by default: loads fine, fails once the owner turns it on → bundled copy.
    const later = def("1.1.0", { defaultEnabled: false, activate: () => { throw new Error("later boom"); } });
    const s = await setup({ [p.entry]: { moduleApi: "^1.16", module: later } }, view([p]));
    expect(s.pageIds()).toEqual([]);
    expect(s.host.modules.find((m) => m.id === "pilot")).toBe(later);
    await s.host.setEnabled("pilot", true);
    await s.host.idle();
    await vi.waitFor(async () => {
      await s.loader.idle();
      expect(s.host.modules.find((m) => m.id === "pilot")).toBe(s.bundled);
    });
  });

  it("switches to a newer pack version while running", async () => {
    const a = pack("1.1.0");
    const b = pack("1.2.0");
    const s = await setup({ [a.entry]: { moduleApi: "^1.16", module: def("1.1.0", { defaultEnabled: true }) }, [b.entry]: { moduleApi: "^1.16", module: def("1.2.0", { defaultEnabled: true }) } }, view([a]));
    expect(s.pageIds()).toEqual(["pilot.page110"]);
    s.bridge.push(view([b]));
    await s.loader.idle();
    expect(s.pageIds()).toEqual(["pilot.page120"]);
  });
});

describe("Settings rows", () => {
  const rt = (installed: InstalledPackView[], packs: { version: string; compat?: "ok" | "needsNewerApp" }[], active: Record<string, string> = {}) => ({
    view: view(installed, { index: { serial: 1, generatedAt: "x", checkedAt: 0, packs: packs.map((p) => ({ id: "pilot", version: p.version, moduleApi: "^1.16", compat: p.compat ?? "ok", size: 10 })) } }),
    active,
    decisions: {},
    bundled: { pilot: "1.0.0" },
  });
  it("offers an update above the bundled / installed version, other versions, never an incompatible one", () => {
    expect(packRow("pilot", rt([], [{ version: "1.1.0" }, { version: "0.9.0" }]), true, "1.0.0")).toMatchObject({ offer: { kind: "update", version: "1.1.0" }, others: [{ version: "0.9.0", older: true }] });
    expect(packRow("pilot", rt([], [{ version: "1.0.0" }]), true, "1.0.0").offer).toBeNull();
    expect(packRow("pilot", rt([], [{ version: "2.0.0", compat: "needsNewerApp" }]), true, "1.0.0").offer).toBeNull();
    expect(packRow("pilot", rt([pack("1.1.0")], [{ version: "1.1.0" }, { version: "1.2.0" }, { version: "1.0.5" }], { pilot: "1.1.0" }), true, "1.0.0")).toMatchObject({
      activeVersion: "1.1.0",
      offer: { kind: "update", version: "1.2.0" },
      others: [{ version: "1.0.5", older: true }],
    });
    expect(packRow("pilot", rt([], [{ version: "0.1.0" }]), false, null).offer).toEqual({ kind: "download", version: "0.1.0" });
    expect(packRow("pilot", rt([], [{ version: "2.0.0" }]), true, null).offer).toBeNull();
  });
});
