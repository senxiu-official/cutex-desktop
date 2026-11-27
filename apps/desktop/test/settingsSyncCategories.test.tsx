// @vitest-environment jsdom
// Settings sync (design 056 §12): the app's categories read / write the real settings stores, and Settings → 你 →
// 设置同步 shows the switches, the 本机设置 / 同步设置 comparison and the module download prompt.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ modules: [] as { id: string; required?: boolean }[], on: new Set<string>(), enable: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/app", async (original) => ({
  ...(await original<object>()),
  appModules: () => ({ modules: fx.modules, isEnabled: (id: string) => fx.on.has(id), setEnabled: (id: string, v: boolean) => { fx.enable(id, v); if (v) fx.on.add(id); else fx.on.delete(id); return Promise.resolve(); } }),
}));

const cats = await import("../src/renderer/src/lib/settingsSync/categories");
const { getUiPrefs } = await import("../src/renderer/src/lib/prefs");
const { getOnboarding } = await import("../src/renderer/src/lib/onboarding");
const { getGuides } = await import("../src/renderer/src/lib/guides");
const { mainWorkspaceSets } = await import("../src/renderer/src/lib/workspaceSets");
const { registerSyncCategory, syncCategories } = await import("../src/renderer/src/lib/settingsSync/registry");
const { useSettingsSync, pageSynced } = await import("../src/renderer/src/lib/settingsSync/view");
const { I18nProvider } = await import("../src/renderer/src/i18n");
const { SettingsSyncSection } = await import("../src/renderer/src/components/settings/SettingsSync");
const run = await import("../src/renderer/src/lib/settingsSync/run");

const A = `ci-${"a".repeat(32)}`;
const ctx = { hosts: [{ id: "local", instanceId: A, label: "EVA", online: true, supported: true, eligible: true }] };

describe("built-in categories", () => {
  it("on by default: appearance, terms and language, modules, sidebar display and layout, guides seen; off: screen and device ones", () => {
    expect(cats.BUILT_IN_SYNC_CATEGORIES.filter((c) => c.defaultOn).map((c) => c.id)).toEqual(["appearance", "terms-language", "modules", "sidebar-display", "sidebar-layout", "onboarding"]);
    expect(cats.BUILT_IN_SYNC_CATEGORIES.filter((c) => !c.defaultOn).map((c) => c.id)).toEqual(["scale", "workspace-sets", "shelf-template"]);
  });

  it("module switches: required and missing modules are left alone, never downloaded", () => {
    fx.modules = [{ id: "shell", required: true }, { id: "jobs" }, { id: "browser" }];
    fx.on = new Set(["browser"]);
    expect(cats.modulesCategory.read(ctx)).toEqual({ jobs: false, browser: true });
    cats.modulesCategory.write({ jobs: true, shell: false, "desk-pet": true }, ctx);
    expect(fx.enable.mock.calls).toEqual([["jobs", true]]);
    expect(cats.missingSyncedModules({ "desk-pet": true, jobs: true, nci: false })).toEqual(["desk-pet"]);
  });

  it("sidebar display: takes values of the same type only, never widths", () => {
    const before = getUiPrefs().systemRows;
    cats.sidebarDisplayCategory.write({ systemRows: 7, titleTwoLines: !getUiPrefs().titleTwoLines, sidebarWidth: 999 }, ctx);
    expect(getUiPrefs().systemRows).toBe(before);
    expect(Object.keys(cats.sidebarDisplayCategory.read(ctx))).not.toContain("sidebarWidth");
    expect(cats.sidebarDisplayCategory.read(ctx).titleTwoLines).toBe(getUiPrefs().titleTwoLines);
  });

  it("guides seen only grow", () => {
    cats.onboardingCategory.write({ doneRevision: 99, lastWhatsNew: "0.9.0", guidesSeen: ["tip.tray"], guidesAsked: true }, ctx);
    cats.onboardingCategory.write({ doneRevision: 1, guidesSeen: [], guidesAsked: false }, ctx);
    expect(getOnboarding()).toMatchObject({ doneRevision: 99, lastWhatsNew: "0.9.0" });
    expect(getGuides()).toMatchObject({ seen: ["tip.tray"], asked: true });
  });

  it("workspace sets store hosts by their portable id and drop agents of hosts this device lacks", () => {
    cats.workspaceSetsCategory.write({ sets: [{ id: "w1", at: 5, members: [{ host: A, id: "s1" }, { host: `ci-${"b".repeat(32)}`, id: "s2" }] }] }, ctx);
    expect(mainWorkspaceSets()).toEqual([{ id: "w1", at: 5, members: [{ hostId: "local", sessionId: "s1" }] }]);
    expect(cats.workspaceSetsCategory.read(ctx)).toEqual({ sets: [{ id: "w1", at: 5, members: [{ host: A, id: "s1" }] }] });
  });
});

describe("Settings → 你 → 设置同步", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { cats.registerBuiltInSyncCategories(); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const state = (over: Partial<ReturnType<typeof useSettingsSync.getState>> = {}) => useSettingsSync.setState({
    status: "synced", memoryHost: { instanceId: A, label: "EVA" }, lastSync: Date.UTC(2026, 10, 26, 6, 0), pending: 0, error: null, ask: [],
    categories: {
      appearance: { on: true, adopted: false, local: { theme: "light", accent: "blue" }, synced: { theme: "dark", accent: "indigo" }, differs: true },
      modules: { on: true, adopted: true, local: { jobs: true }, synced: { jobs: true, "desk-pet": true }, differs: false },
      scale: { on: false, adopted: false, local: { zoom: 1 }, synced: null, differs: false },
    },
    ...over,
  }, true);

  it("lists every category with its switch, compares where this computer differs, and offers 下载 for a missing module", async () => {
    fx.modules = [{ id: "jobs" }];
    state();
    await act(async () => root.render(h(I18nProvider, null, h(SettingsSyncSection))));
    const ids = [...host.querySelectorAll<HTMLElement>("[data-sync-category]")].map((e) => e.dataset.syncCategory);
    expect(ids).toEqual(syncCategories().map((c) => c.id));
    const compare = host.querySelector<HTMLElement>('[data-sync-compare="appearance"]')!;
    expect(compare.querySelector('[data-sync-side="local"]')!.textContent).toMatch(/浅色|Light/);
    expect(compare.querySelector('[data-sync-side="synced"]')!.textContent).toMatch(/深色|Dark/);
    expect(host.querySelector('[data-sync-compare="modules"]')).toBeNull();
    expect(host.querySelector("[data-sync-modules-missing]")!.textContent).toContain("desk-pet");
    const fake = { useSynced: vi.fn(), pushLocal: vi.fn(), setOn: vi.fn() };
    vi.spyOn(run, "settingsSync").mockReturnValue(fake as never);
    const [useSynced, push] = [...compare.querySelectorAll("button")];
    act(() => useSynced!.click()); act(() => push!.click());
    expect(fake.useSynced).toHaveBeenCalledWith("appearance");
    expect(fake.pushLocal).toHaveBeenCalledWith("appearance");
    expect(host.querySelector("[data-sync-status]")!.textContent).toMatch(/上次同步|Last synced/);
  });

  it("without a memory host: says so, switches disabled", async () => {
    state({ status: "noHost", memoryHost: null });
    await act(async () => root.render(h(I18nProvider, null, h(SettingsSyncSection))));
    expect(host.querySelector("[data-sync-status]")!.getAttribute("data-sync-status")).toBe("noHost");
    expect([...host.querySelectorAll<HTMLButtonElement>("[data-sync-categories] [role=switch]")].every((b) => b.disabled)).toBe(true);
  });

  it("「已同步」 only on pages of categories this computer follows", () => {
    state({ categories: { appearance: { on: true, adopted: true, local: {}, synced: {}, differs: false }, scale: { on: false, adopted: false, local: {}, synced: null, differs: false } } });
    const s = useSettingsSync.getState();
    expect(pageSynced(s, "appearance")).toBe(true);
    expect(pageSynced(s, "conversation")).toBe(false);
    expect(pageSynced({ ...s, status: "unsupported" }, "appearance")).toBe(false);
  });

  it("a feature's category (e.g. 快捷键方案) shows up without changing the card", async () => {
    const off = registerSyncCategory({ id: "keybindings", order: 250, titleKey: "shell.shortcuts", hintKey: "settingsSync.hint", defaultOn: true, pages: ["shortcuts"], read: () => ({}), write: () => {}, summary: () => "" });
    state();
    await act(async () => root.render(h(I18nProvider, null, h(SettingsSyncSection))));
    expect(host.querySelector('[data-sync-category="keybindings"]')).not.toBeNull();
    off();
  });
});
