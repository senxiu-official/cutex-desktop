// Developer mode, renderer side (docs/desktop-modules.md §30.5): each new build swaps in through the real module host; a
// build that does not run leaves the last one that did; the reason goes back to main.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import type { AppModule, AppModuleHost } from "../src/renderer/src/modules/slots";
import type { DevModuleView, ModuleDevBridge, ModuleDevView } from "../src/shared/moduleDev";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { createPackLoader } = await import("../src/renderer/src/modules/packs");
const { createDevModuleLoader } = await import("../src/renderer/src/modules/devModules");
const { translate } = await import("../src/renderer/src/i18n");
const publicApiWords = translate("modules.dev.err.publicApi", { list: "" }).slice(0, 4);

it("a deferred folder reload must not replace a pack installed while its import was pending", async () => {
  const holder = { id: "my-thing", titleKey: "core.title", displayName: "Original holder" } as unknown as AppModule;
  const t = setup({}, newHost([holder]));
  await t.loader.apply(viewOf(row(1)));
  expect(t.importEntry).not.toHaveBeenCalled();
  let release!: (value: unknown) => void;
  t.importEntry.mockImplementationOnce(() => new Promise(r => { release = r; }));
  await t.host.removeModule("my-thing");
  await vi.waitFor(() => expect(t.importEntry).toHaveBeenCalledTimes(1));
  const signed = build("Signed replacement", { displayName: "Signed replacement" });
  const pack = { id: "my-thing", version: "2.0.0", moduleApi: "^1.31", compat: "ok", entry: "cutex-module://my-thing/2.0.0/index.js", styles: [], host: {} };
  const packView = { appModuleApi: "1.31", installed: [pack], broken: [], index: null, operation: null, lastError: null, local: { allowed: true, internal: false, safeStart: null, held: [], error: null } } as any;
  const bridge = { onState: () => () => {}, state: async () => packView, localFailed: async () => packView } as any;
  const packs = createPackLoader({ host: t.host, bundled: [], bundledVersions: {}, bridge, importEntry: async () => signed });
  try {
    await packs.apply(packView);
    expect(t.host.modules.find(m => m.id === "my-thing")?.displayName).toBe("Signed replacement");
    release(build("Folder", { displayName: "Folder" }));
    await t.loader.idle();
    expect(t.host.modules.find(m => m.id === "my-thing")?.displayName).toBe("Signed replacement");
    expect(t.running.has("my-thing")).toBe(false);
  } finally { packs.dispose(); t.loader.dispose(); }
});

const hosts: AppModuleHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.dispose()));
});

function newHost(modules: AppModule[] = []): AppModuleHost {
  const data = new Map<string, string>();
  const host = createModuleHost({ modules, slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set<string>() }, storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }, services: () => stubServices(), log() {} });
  hosts.push(host);
  return host;
}

const FOLDER = "D:/work/my-thing";
const entry = (rev: number) => `cutex-module://dev/my-thing/${rev}/index.js`;
const row = (rev: number, over: Partial<DevModuleView> = {}): DevModuleView => ({ folder: FOLDER, id: "my-thing", version: "0.1.0", moduleApi: "^1.31", rev, entry: entry(rev), styles: [], host: { "@cutex-desktop/module-api": ["defineModule"] }, error: null, ...over });
const viewOf = (...modules: DevModuleView[]): ModuleDevView => ({ enabled: true, internal: false, skipped: false, modules });

function build(title: string, over: Partial<AppModule> = {}) {
  return {
    moduleApi: "^1.31",
    module: { id: "my-thing", titleKey: "my-thing.title", ...over } as AppModule,
    messages: { en: { "my-thing.title": title }, "zh-CN": { "my-thing.title": title } },
  };
}

function setup(entries: Record<string, unknown>, host = newHost()) {
  const reports: { rev: number; error: string | null }[] = [];
  const styles: string[][] = [];
  let push: (view: ModuleDevView) => void = () => {};
  const bridge: ModuleDevBridge = {
    state: async () => viewOf(),
    setEnabled: async () => viewOf(),
    addFolder: async () => viewOf(),
    removeFolder: async () => viewOf(),
    report: async (_folder, rev, error) => {
      reports.push({ rev, error });
      return viewOf();
    },
    onState: (listener) => {
      push = listener;
      return () => {};
    },
  };
  const importEntry = vi.fn(async (url: string) => {
    if (!(url in entries)) throw new Error(`cannot load ${url}`);
    return entries[url];
  });
  const running = new Map<string, { rev: number; version: string | null; host: Readonly<Record<string, readonly string[]>> }>();
  const loader = createDevModuleLoader({ host, bridge, importEntry, setStyles: (_folder, urls) => styles.push([...urls]), onRunning: (id, run) => (run ? running.set(id, run) : running.delete(id)) });
  return { host, reports, styles, importEntry, loader, running, push: (view: ModuleDevView) => push(view) };
}

describe("following a folder", () => {
  it("registers a build, then replaces it with the next without any restart", async () => {
    const t = setup({ [entry(1)]: build("One"), [entry(2)]: build("Two") });
    await t.loader.apply(viewOf(row(1)));
    expect(t.host.modules.map((m) => m.id)).toEqual(["my-thing"]);
    expect(translate("my-thing.title" as never)).toBe("One");
    await t.loader.apply(viewOf(row(2)));
    expect(t.host.modules.map((m) => m.id)).toEqual(["my-thing"]);
    expect(translate("my-thing.title" as never)).toBe("Two");
    expect(t.reports).toEqual([{ rev: 1, error: null }, { rev: 2, error: null }]);
    await t.loader.apply(viewOf(row(2)));
    expect(t.importEntry).toHaveBeenCalledTimes(2);
  });

  it("stops the old build's activate before the new one starts", async () => {
    const order: string[] = [];
    const def = (name: string) =>
      build(name, {
        activate(ctx) {
          order.push(`start ${name}`);
          ctx.signal.addEventListener("abort", () => order.push(`stop ${name}`));
        },
      });
    const t = setup({ [entry(1)]: def("a"), [entry(2)]: def("b") });
    await t.loader.apply(viewOf(row(1)));
    await t.loader.apply(viewOf(row(2)));
    expect(order).toEqual(["start a", "stop a", "start b"]);
  });

  it("goes back to the last build that ran when activate throws, and reports why", async () => {
    const broken = build("Broken", {
      activate() {
        throw new Error("boom at start");
      },
    });
    const t = setup({ [entry(1)]: build("Good"), [entry(2)]: broken });
    await t.loader.apply(viewOf(row(1)));
    await t.loader.apply(viewOf(row(2)));
    expect(t.host.statuses().get("my-thing")?.state.kind).not.toBe("failed");
    expect(translate("my-thing.title" as never)).toBe("Good");
    expect(t.reports.at(-1)?.rev).toBe(2);
    expect(t.reports.at(-1)?.error).toMatch(/boom at start/);
    // Not tried again until there is a new build.
    await t.loader.apply(viewOf(row(2)));
    expect(t.importEntry).toHaveBeenCalledTimes(2);
  });

  it("keeps the last build when the next one fails to import", async () => {
    const t = setup({ [entry(1)]: build("Good") });
    await t.loader.apply(viewOf(row(1)));
    await t.loader.apply(viewOf(row(2)));
    expect(t.host.modules.map((m) => m.id)).toEqual(["my-thing"]);
    expect(translate("my-thing.title" as never)).toBe("Good");
    expect(t.reports.at(-1)?.error).toMatch(/cannot load/);
  });

  it("refuses a build that reads what the public API does not have", async () => {
    const t = setup({ [entry(1)]: build("Good") });
    await t.loader.apply(viewOf(row(1, { host: { "@cutex-desktop/app/store": ["useStore"] } })));
    expect(t.importEntry).not.toHaveBeenCalled();
    expect(t.host.modules).toEqual([]);
    expect(t.reports[0]?.error).toContain(publicApiWords);
  });

  it("a dev build loads a folder module that reads the app's own files", async () => {
    const t = setup({ [entry(1)]: build("Good") });
    await t.loader.apply({ ...viewOf(row(1, { host: { "@cutex-desktop/app/store": ["useApp"] } })), internal: true });
    expect(t.importEntry).toHaveBeenCalled();
    expect(t.host.modules.map((m) => m.id)).toEqual(["my-thing"]);
    expect(t.reports.at(-1)?.error).toBeNull();
  });

  it("does not take the place of a module that is already there", async () => {
    const other = { id: "my-thing", titleKey: "core.title", displayName: "Installed copy" } as unknown as AppModule;
    const t = setup({ [entry(1)]: build("Mine") }, newHost([other]));
    await t.loader.apply(viewOf(row(1)));
    expect(t.host.modules).toEqual([other]);
    expect(t.reports[0]?.error).toContain("Installed copy");
  });

  it("loads the same build once the module holding its id is gone", async () => {
    const other = { id: "my-thing", titleKey: "core.title", displayName: "Installed copy" } as unknown as AppModule;
    const t = setup({ [entry(1)]: build("Mine") }, newHost([other]));
    await t.loader.apply(viewOf(row(1)));
    expect(t.importEntry).not.toHaveBeenCalled();
    await t.host.removeModule("my-thing");
    await vi.waitFor(() => expect(t.importEntry).toHaveBeenCalledTimes(1));
    await t.loader.idle();
    expect(translate("my-thing.title" as never)).toBe("Mine");
    expect(t.reports.at(-1)).toEqual({ rev: 1, error: null });
  });

  it("records for Settings the build actually running: not a failed newer one, not a folder whose id is taken", async () => {
    const broken = build("Broken", { activate() { throw new Error("boom"); } });
    const t = setup({ [entry(1)]: build("Good"), [entry(2)]: broken });
    await t.loader.apply({ ...viewOf(row(1, { version: "1.0.0", host: { "@cutex-desktop/app/store": ["useApp"] } })), internal: true });
    expect(t.running.get("my-thing")).toMatchObject({ rev: 1, version: "1.0.0", host: { "@cutex-desktop/app/store": ["useApp"] } });
    await t.loader.apply({ ...viewOf(row(2, { version: "2.0.0" })), internal: true });
    expect(t.running.get("my-thing")).toMatchObject({ rev: 1, version: "1.0.0" });
    await t.loader.apply(viewOf());
    expect(t.running.has("my-thing")).toBe(false);

    const other = { id: "my-thing", titleKey: "core.title", displayName: "Installed copy" } as unknown as AppModule;
    const taken = setup({ [entry(1)]: build("Mine") }, newHost([other]));
    await taken.loader.apply(viewOf(row(1)));
    expect(taken.running.size).toBe(0);
  });

  it("takes the module away, with its styles, when the folder goes or developer mode turns off", async () => {
    const t = setup({ [entry(1)]: build("One") });
    await t.loader.apply(viewOf(row(1, { styles: ["cutex-module://dev/my-thing/1/index.css"] })));
    expect(t.styles.at(-1)).toEqual(["cutex-module://dev/my-thing/1/index.css"]);
    await t.loader.apply({ enabled: false, internal: false, skipped: false, modules: [] });
    expect(t.host.modules).toEqual([]);
    expect(t.styles.at(-1)).toEqual([]);
    expect(translate("my-thing.title" as never)).toBe("my-thing.title");
  });

  it("follows what main sends", async () => {
    const t = setup({ [entry(1)]: build("One") });
    t.push(viewOf(row(1)));
    await t.loader.idle();
    expect(t.host.modules.map((m) => m.id)).toEqual(["my-thing"]);
  });
});

it("an installed pack replacing a folder module clears its old developer-running identity", async () => {
  const t = setup({ [entry(1)]: build("Folder", { displayName: "Folder build" }) });
  await t.loader.apply(viewOf(row(1, { version: "1.0.0" })));
  expect(t.running.get("my-thing")?.version).toBe("1.0.0");
  const signed = build("Signed replacement", { displayName: "Signed replacement" });
  const pack = { id: "my-thing", version: "2.0.0", moduleApi: "^1.31", compat: "ok", entry: "cutex-module://my-thing/2.0.0/index.js", styles: [], host: {} };
  const packView = { appModuleApi: "1.31", installed: [pack], broken: [], index: null, operation: null, lastError: null, local: { allowed: true, internal: false, safeStart: null, held: [], error: null } } as any;
  const bridge = { onState: () => () => {}, state: async () => packView, localFailed: async () => packView } as any;
  const packs = createPackLoader({ host: t.host, bundled: [], bundledVersions: {}, bridge, importEntry: async () => signed });
  try {
    await packs.apply(packView);
    expect(t.host.modules.find((m) => m.id === "my-thing")?.displayName).toBe("Signed replacement");
    expect(t.running.has("my-thing")).toBe(false);
  } finally { packs.dispose(); t.loader.dispose(); }
});

describe("who owns a folder module's id (Settings' record follows the host registry)", () => {
  const other = (name: string) => ({ id: "my-thing", titleKey: "core.title", displayName: name }) as unknown as AppModule;

  it("another owner takes the id: the claim ends, styles go; when the id is free again the folder build comes back", async () => {
    const t = setup({ [entry(1)]: build("Folder") });
    await t.loader.apply(viewOf(row(1, { version: "1.0.0", styles: ["cutex-module://dev/my-thing/1/index.css"] })));
    await t.host.removeModule("my-thing");
    await t.host.addModules([other("Pack")]);
    await t.loader.idle();
    expect(t.running.has("my-thing")).toBe(false);
    expect(t.styles.at(-1)).toEqual([]);
    expect(t.host.modules.map((m) => m.displayName)).toEqual(["Pack"]);
    expect(t.reports.at(-1)?.error).toContain("Pack");
    await t.host.removeModule("my-thing");
    await vi.waitFor(() => expect(t.running.get("my-thing")).toMatchObject({ rev: 1, version: "1.0.0" }));
    await t.loader.idle();
    expect(t.host.modules.map((m) => m.id)).toEqual(["my-thing"]);
  });

  it("removed behind the loader's back: no record of a build that is not there", async () => {
    const t = setup({ [entry(1)]: build("Folder") });
    await t.loader.apply(viewOf(row(1)));
    await t.host.removeModule("my-thing");
    expect(t.running.has("my-thing")).toBe(false);
  });

  it("the folder going away while another owner holds the id leaves that owner's module alone", async () => {
    const t = setup({ [entry(1)]: build("Folder") });
    await t.loader.apply(viewOf(row(1)));
    const pack = other("Pack");
    await t.host.removeModule("my-thing");
    await t.host.addModules([pack]);
    await t.loader.apply(viewOf());
    expect(t.host.modules).toEqual([pack]);
    expect(t.running.size).toBe(0);
  });

  it("turning the module off and on keeps the same build, so the record stays", async () => {
    const t = setup({ [entry(1)]: build("Folder") });
    await t.loader.apply(viewOf(row(1, { version: "1.0.0" })));
    await t.host.setEnabled("my-thing", false);
    await t.host.setEnabled("my-thing", true);
    await t.loader.idle();
    expect(t.running.get("my-thing")).toMatchObject({ rev: 1, version: "1.0.0" });
  });
});

it("a replacement build whose import is pending does not remove an owner that took the id meanwhile", async () => {
  const t = setup({ [entry(1)]: build("Folder one") });
  await t.loader.apply(viewOf(row(1, { version: "1.0.0" })));
  let release!: (value: unknown) => void;
  t.importEntry.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  const pending = t.loader.apply(viewOf(row(2, { version: "2.0.0" })));
  await vi.waitFor(() => expect(t.importEntry).toHaveBeenCalledTimes(2));
  const pack = { id: "my-thing", titleKey: "core.title", displayName: "Pack" } as unknown as AppModule;
  await t.host.removeModule("my-thing");
  await t.host.addModules([pack]);
  release(build("Folder two"));
  await pending;
  await t.loader.idle();
  expect(t.host.modules).toEqual([pack]);
  expect(t.running.has("my-thing")).toBe(false);
  expect(t.reports.at(-1)?.error).toContain("Pack");
});
