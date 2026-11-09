// Developer mode, renderer side (docs/desktop-modules.md §30.5): each new build swaps in through the real module host; a
// build that does not run leaves the last one that did; the reason goes back to main.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubServices } from "./serviceStub";
import type { AppModule, AppModuleHost } from "../src/renderer/src/modules/slots";
import type { DevModuleView, ModuleDevBridge, ModuleDevView } from "../src/shared/moduleDev";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { createDevModuleLoader } = await import("../src/renderer/src/modules/devModules");
const { translate } = await import("../src/renderer/src/i18n");
const publicApiWords = translate("modules.dev.err.publicApi", { list: "" }).slice(0, 4);

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
  const loader = createDevModuleLoader({ host, bridge, importEntry, setStyles: (_folder, urls) => styles.push([...urls]) });
  return { host, reports, styles, importEntry, loader, push: (view: ModuleDevView) => push(view) };
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
