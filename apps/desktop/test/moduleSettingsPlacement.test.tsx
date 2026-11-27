// @vitest-environment jsdom
// Module settings placement (docs/desktop-modules.md §5.1; owner 2026-11-27, slim audit #4 / #8): NCI and the desk pet
// are detail pages under 模块 (no nav row), opened from 「设置」 on their module row; a module's row offers 「设置」
// only while its settings contribute (on, page available); old page ids still land; the old status capsule is off on
// new installs and its card stays after the status table.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stubServices } from "./serviceStub";

const opened: unknown[][] = [];
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { createModuleHost } = await import("../src/renderer/src/modules/host");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { MOCK_NEW_FEATURES } = await import("../src/renderer/src/dev/mockFeatures");
const { settingsNavGroups, settingsNavPage, settingsTab } = await import("../src/renderer/src/lib/settingsNav");
const { moduleSettingsRoute } = await import("../src/renderer/src/modules/moduleSettingsRoute");
const deskPet = (await import("../src/renderer/src/modules/desk-pet/index")).default;
const capsule = MODULES.find((m) => m.id === "status-capsule")!;

function memoryStorage(enabled: Record<string, boolean> = {}) {
  const data = new Map<string, string>([["cutex-desktop.modules", JSON.stringify({ v: 1, enabled, place: {} })]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

async function hostWith(enabled: Record<string, boolean>, features: Iterable<string> = MOCK_NEW_FEATURES) {
  const host = createModuleHost({ modules: [...MODULES, deskPet], slots: SLOT_SPECS, host: { id: "local", kind: "local", features: new Set(features) }, storage: memoryStorage(enabled), services: () => stubServices(), log: () => {} });
  await host.idle();
  return host;
}

describe("NCI and the desk pet live under 模块", () => {
  it("no nav row; the nav marks 模块 while they show; old ids open the same pages", async () => {
    const host = await hostWith({ nci: true, jobs: true, "desk-pet": true });
    const pages = host.snapshot("settings.page").filter((e) => e.mode === "show");
    const nav = settingsNavGroups(pages).flatMap((g) => g.entries.map((e) => e.item.page));
    for (const page of ["nci", "desk-pet"]) {
      expect(pages.some((e) => e.item.page === page), page).toBe(true);
      expect(nav, page).not.toContain(page);
      expect(settingsNavPage(pages, page)).toBe("modules");
      expect(settingsTab({ tab: page })).toBe(page);
    }
    // Settings search (details included) still finds them while they are on.
    expect(settingsNavGroups(pages, true).flatMap((g) => g.entries.map((e) => e.item.page))).toEqual(expect.arrayContaining(["nci", "desk-pet"]));
  });

  it("「设置」 on a row: its page, else its first card; nothing while off or without the host capability", async () => {
    const on = await hostWith({ nci: true, jobs: true, "desk-pet": true, "input-refinement": true });
    const route = (h: Awaited<ReturnType<typeof hostWith>>, id: string) => moduleSettingsRoute(id, h.snapshot("settings.page"), h.snapshot("settings.section"));
    expect(route(on, "nci")).toEqual({ page: "nci" });
    expect(route(on, "desk-pet")).toEqual({ page: "desk-pet" });
    expect(route(on, "whatsapp")).toBeNull();
    expect(route(on, "input-refinement")).toMatchObject({ page: expect.any(String) });
    const off = await hostWith({ nci: false, "desk-pet": false });
    expect(route(off, "nci")).toBeNull();
    expect(route(off, "desk-pet")).toBeNull();
    // A disabled module's settings are out of search too (no slot entries at all).
    expect(off.snapshot("settings.page").some((e) => e.item.page === "nci" || e.item.page === "desk-pet")).toBe(false);
    const noMail = await hostWith({ nci: true, jobs: true }, []);
    expect(route(noMail, "nci")).toBeNull();
  });
});

describe("the module row's 「设置」 button", () => {
  let root: Root, box: HTMLDivElement;
  beforeEach(() => { box = document.body.appendChild(document.createElement("div")); root = createRoot(box); opened.length = 0; });
  afterEach(() => { act(() => root.unmount()); box.remove(); });

  it("opens the module's page through openSettings", async () => {
    vi.resetModules();
    vi.doMock("../src/renderer/src/modules/react", () => ({
      useSlot: (slot: string) => slot === "settings.page" ? [{ moduleId: "nci", mode: "show", item: { page: "nci" } }] : [{ moduleId: "x", mode: "show", item: { id: "x.card", page: "conversation", titleKey: "k" } }],
    }));
    vi.doMock("../src/renderer/src/store", () => ({ useApp: (sel: (s: unknown) => unknown) => sel({ openSettings: (...a: unknown[]) => opened.push(a) }) }));
    const { ModuleSettingsButton } = await import("../src/renderer/src/modules/shell/ModulePacks");
    const { I18nProvider } = await import("../src/renderer/src/i18n");
    await act(async () => root.render(h(I18nProvider, null, h("div", null, h(ModuleSettingsButton, { moduleId: "nci", name: "NCI" }), h(ModuleSettingsButton, { moduleId: "x", name: "X" }), h(ModuleSettingsButton, { moduleId: "gone", name: "Gone" })))));
    const buttons = [...box.querySelectorAll<HTMLElement>("[data-module-settings] button")];
    expect(buttons).toHaveLength(2);
    act(() => buttons[0]!.click());
    act(() => buttons[1]!.click());
    expect(opened).toEqual([["nci", undefined], ["conversation", { anchor: "x.card" }]]);
    vi.doUnmock("../src/renderer/src/modules/react");
    vi.doUnmock("../src/renderer/src/store");
  });
});

describe("the old status capsule", () => {
  it("is off by default (existing installs keep it through modules/defaultFlips) and its settings are its module page", async () => {
    expect(capsule.defaultEnabled).toBe(false);
    const { DEFAULT_FLIPS } = await import("../src/renderer/src/modules/defaultFlips");
    expect(DEFAULT_FLIPS.find((f) => f.id === "status-capsule")).toMatchObject({ previousDefault: true, orSavedChoices: true });
    // Its settings are its own module page under 模块 (owner 2026-11-28), not a section of a 状态显示 page.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/renderer/src/modules/status-capsule/index.ts"), "utf8");
    expect(src).toMatch(/"settings\.page": \[\{ id: "status-capsule\.page", page: CAPSULE_SETTINGS_PAGE,[^\n]*navParent: "modules"/);
    expect(src).not.toContain('"settings.section"');
  });
});
