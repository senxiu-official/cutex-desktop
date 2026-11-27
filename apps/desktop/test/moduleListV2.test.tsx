// @vitest-environment jsdom
// Settings → 模块 v2 (owner 2026-11-26): groups by use in shared/moduleGroups order with 核心 folded last, each row's
// places and default, 一键设置 asking in place and undoable, and an optional module's 可选 · 随应用提供 chip.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ none: [] as never[], modules: [] as any[], on: new Set<string>(), enable: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({
    modules: fx.modules,
    isEnabled: (id: string) => fx.on.has(id),
    setEnabled: (id: string, v: boolean) => { fx.enable(id, v); if (v) fx.on.add(id); else fx.on.delete(id); return Promise.resolve(); },
    retry: vi.fn(), statuses: () => new Map(), subscribe: () => () => {}, snapshot: () => fx.none,
  }),
}));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useModuleStatuses: () => new Map() }));
vi.mock("../src/renderer/src/modules/packs", async (original) => ({ ...(await original<object>()), usePackRuntime: () => ({ view: null, active: {}, decisions: {}, bundled: {} }) }));
vi.mock("../src/renderer/src/modules/devModules", () => ({ useModuleDevView: () => null }));
vi.mock("../src/renderer/src/lib/update", () => ({ useUpdateStatus: () => ({ current: { version: "0.2.4" } }) }));
vi.mock("../src/renderer/src/modules/shell/DevModules", () => ({ DevModulesGroup: () => null }));
vi.mock("../src/renderer/src/modules/shell/ModuleData", () => ({ ModuleDataGroup: () => null }));
vi.mock("../src/renderer/src/modules/shell/ModulePacks", async (original) => ({ ...(await original<object>()), PackIndexHeader: () => null, LocalPacksGroup: () => null }));
import { I18nProvider } from "../src/renderer/src/i18n";
import { ModulesPage } from "../src/renderer/src/modules/shell/ModulesPage";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
const def = (id: string, extra: Record<string, unknown> = {}) => ({ id, displayName: id, titleKey: "modules.section.all", ...extra });
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
  fx.enable.mockClear();
  // Registry order on purpose not the list's: the list orders by shared/moduleGroups.
  fx.modules = [
    def("about", { required: true }),
    def("whatsapp", { defaultEnabled: false }),
    def("side-chat"),
    def("bookmarks", { defaultEnabled: false, contributes: { "side.component": [{}], "settings.section": [{}] } }),
    def("jobs", { contributes: { "nav.primary": [{}], "main.page": [{}] } }),
    def("delegations"),
    def("agent-bus"),
  ];
  fx.on = new Set(["side-chat", "jobs", "delegations", "agent-bus", "whatsapp"]);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(h(I18nProvider, null, h(ModulesPage))));
const groups = () => [...host.querySelectorAll<HTMLElement>("[data-module-group]")].map((g) => g.dataset.moduleGroup);
const rows = (group: string) => [...host.querySelectorAll(`[data-module-group=${group}] [id^="settings-module-"]`)].map((r) => r.id.replace("settings-module-", ""));
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const presetButton = (label: RegExp) => [...host.querySelectorAll<HTMLButtonElement>("[data-module-presets] button")].find((b) => label.test(b.textContent ?? ""))!;

it("lists groups by importance with 核心 folded last, most used first and optional modules at a group's end", async () => {
  await render();
  expect(groups()).toEqual(["work", "browse", "comms", "core"]);
  expect(rows("work")).toEqual(["delegations", "jobs"]);
  expect(rows("comms")).toEqual(["agent-bus", "side-chat", "whatsapp"]);
  expect(rows("core")).toEqual([]);
  click(host.querySelector("[data-module-group=core] > button"));
  expect(rows("core")).toEqual(["about"]);
  // A search opens every group.
  click(host.querySelector("[data-module-group=core] > button"));
  const search = host.querySelector<HTMLInputElement>("[data-module-toolbar] input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "about"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(rows("core")).toEqual(["about"]);
});

it("says where a module shows up, its default and that you changed it", async () => {
  fx.on.add("bookmarks");
  await render();
  const meta = host.querySelector('[id="settings-module-bookmarks"] [data-module-meta]')!;
  expect(meta.querySelector<HTMLElement>("[data-module-places]")!.dataset.modulePlaces).toBe("shelf settingsSection");
  expect(meta.textContent).toMatch(/Shelf 组件 · 设置里的一节|Shelf tab · Settings section/);
  expect(meta.querySelector<HTMLElement>("[data-module-default]")!.dataset.moduleDefault).toBe("off");
  expect(meta.querySelector("[data-module-changed]")).not.toBeNull();
  // Optional: default off (moduleMetadata), whatever the definition says; on = changed by you.
  expect(host.querySelector<HTMLElement>('[id="settings-module-whatsapp"] [data-module-default]')!.dataset.moduleDefault).toBe("off");
  expect(host.querySelector('[id="settings-module-jobs"] [data-module-places]')!.getAttribute("data-module-places")).toBe("nav page");
});

it("shows an optional built-in module as 可选 · 随应用提供 in place of 内置, with its switch", async () => {
  await render();
  const row = host.querySelector('[id="settings-module-whatsapp"]')!;
  expect(row.querySelector("[data-module-tag=bundled]")).toBeNull();
  expect(row.querySelector<HTMLElement>("[data-module-tag=optional]")!.dataset.moduleOptional).toBe("shipped");
  expect(row.querySelector("[role=switch]")).not.toBeNull();
});

it("asks before a preset, changes only what it said, leaves optional modules alone and can be undone", async () => {
  await render();
  click(presetButton(/精简|Lean/));
  expect(fx.enable).not.toHaveBeenCalled();
  const ask = host.querySelector<HTMLElement>("[data-module-preset-ask=lean]")!;
  // 精简 keeps delegations and agent-bus; it turns off side-chat and jobs; whatsapp (optional) stays on.
  expect(ask.textContent).toMatch(/开启 0 个，关闭 2 个|turn on 0, turn off 2/);
  click([...ask.querySelectorAll("button")].find((b) => /应用|Apply/.test(b.textContent ?? "")) ?? null);
  expect(fx.enable.mock.calls.sort()).toEqual([["jobs", false], ["side-chat", false]]);
  expect(fx.on.has("whatsapp")).toBe(true);
  await render();
  expect(presetButton(/精简|Lean/).getAttribute("aria-checked")).toBe("true");
  const note = host.querySelector<HTMLElement>("[data-module-preset-note=applied]")!;
  fx.enable.mockClear();
  click([...note.querySelectorAll("button")].find((b) => /撤销|Undo/.test(b.textContent ?? "")) ?? null);
  expect(fx.enable.mock.calls.sort()).toEqual([["jobs", true], ["side-chat", true]]);
  expect(host.querySelector("[data-module-preset-note=undone]")).not.toBeNull();
});

it("cancel changes nothing; a preset already in place says so", async () => {
  await render();
  click(presetButton(/推荐|Recommended/));
  expect(host.querySelector("[data-module-preset-ask=recommended]")!.textContent).toMatch(/已经是「推荐」|Already "Recommended"/);
  click(presetButton(/全部|Everything/));
  const ask = host.querySelector<HTMLElement>("[data-module-preset-ask=all]")!;
  click([...ask.querySelectorAll("button")].find((b) => /取消|Cancel/.test(b.textContent ?? "")) ?? null);
  expect(host.querySelector("[data-module-preset-ask]")).toBeNull();
  expect(fx.enable).not.toHaveBeenCalled();
});


it("lists a required module only in 核心: a 必需 one first, with a lock, why and the same 核心 tag (owner 2026-11-28)", async () => {
  fx.modules = [...fx.modules, def("projects", { required: true })];
  await render();
  expect(rows("work")).not.toContain("projects");
  click(host.querySelector("[data-module-group=core] > button"));
  expect(rows("core")).toEqual(["projects", "about"]);
  const row = host.querySelector('[id="settings-module-projects"]')!;
  expect(row.querySelector("[data-module-kept-on]")).not.toBeNull();
  expect(row.querySelector("[role=switch]")).toBeNull();
  expect(row.querySelector("[data-module-kept]")!.textContent).toMatch(/项目设置|Project settings/);
  expect(row.querySelector("[data-module-tag=core]")).not.toBeNull();
  expect(host.querySelectorAll('[id="settings-module-projects"]')).toHaveLength(1);
});

it("asks before turning off a module that modules on need, and turns on what a module needs", async () => {
  fx.modules = [...fx.modules, def("browser"), def("claude-science", { defaultEnabled: false, requires: { modules: ["browser"] } })];
  fx.modules = fx.modules.map((m) => (m.id === "whatsapp" ? { ...m, requires: { modules: ["browser"] } } : m));
  fx.on.add("browser");
  await render();
  expect(host.querySelector('[id="settings-module-browser"] [data-module-dependents]')!.textContent).toMatch(/WhatsApp|whatsapp/);
  const browserSwitch = host.querySelector<HTMLElement>('[id="settings-module-browser"] [role=switch]')!;
  click(browserSwitch);
  expect(fx.enable).not.toHaveBeenCalled();
  const ask = host.querySelector<HTMLElement>('[id="settings-module-browser"] [data-module-switch-note=askOff]')!;
  expect(ask.textContent).toMatch(/whatsapp/);
  click([...ask.querySelectorAll("button")].find((b) => /一起关掉|Turn all off/.test(b.textContent ?? "")) ?? null);
  expect(fx.enable.mock.calls.sort()).toEqual([["browser", false], ["whatsapp", false]]);
  fx.enable.mockClear();
  await render();
  click(host.querySelector('[id="settings-module-claude-science"] [role=switch]'));
  expect(fx.enable.mock.calls.sort()).toEqual([["browser", true], ["claude-science", true]]);
  expect(host.querySelector('[id="settings-module-claude-science"] [data-module-switch-note=turnedOn]')).not.toBeNull();
});

describe("child modules (owner 2026-11-26)", () => {
  const widget = (id: string) => def(id, { requires: { modules: ["home"] }, contributes: { "desktop.widget": [{}] } });
  beforeEach(() => {
    fx.modules = [...fx.modules, widget("world-clock"), def("home", { contributes: { "nav.primary": [{}], "desktop.widget": [{}] } }), widget("running-agents"), def("browser")];
    fx.modules = fx.modules.map((m) => (m.id === "whatsapp" ? { ...m, requires: { modules: ["browser"] } } : m));
    fx.on = new Set([...fx.on, "home", "world-clock", "running-agents", "browser"]);
  });

  it("lists a widget-only module indented under its parent, labelled 桌面小组件 without 出现在", async () => {
    await render();
    expect(rows("personal")).toEqual(["home", "running-agents", "world-clock"]);
    const clock = host.querySelector<HTMLElement>('[id="settings-module-world-clock"]')!;
    expect(clock.dataset.moduleChild).toBe("home");
    expect(clock.hasAttribute("data-module-nested")).toBe(true);
    expect(host.querySelector('[id="settings-module-home"]')!.hasAttribute("data-module-nested")).toBe(false);
    const label = clock.querySelector("[data-module-child-label]")!.textContent!;
    expect(label).toMatch(/^(桌面小组件|Desktop widget)$/);
    expect(clock.querySelector("[data-module-meta]")!.textContent).not.toMatch(/出现在|Shows up in/);
    // The parent does not show 被…依赖 for its own children; a real dependent still shows, in neutral grey.
    expect(host.querySelector('[id="settings-module-home"] [data-module-dependents]')).toBeNull();
    fx.on.add("whatsapp");
    await render();
    const dep = host.querySelector<HTMLElement>('[id="settings-module-browser"] [data-module-dependents]')!;
    expect(dep.textContent).toMatch(/whatsapp/);
    expect(dep.className).not.toMatch(/warn/);
  });

  it("greys a child whose parent is off, says to turn the parent on first and disables its switch", async () => {
    fx.on.delete("home");
    fx.on.delete("world-clock");
    await render();
    const clock = host.querySelector<HTMLElement>('[id="settings-module-world-clock"]')!;
    expect(clock.className).toMatch(/opacity-60/);
    expect(clock.querySelector("[data-module-needs-parent]")!.textContent).toMatch(/需要先开启home|Turn on home first/);
    expect(clock.querySelector<HTMLButtonElement>("[role=switch]")!.disabled).toBe(true);
    // Still on from before: it can be turned off.
    const agents = host.querySelector<HTMLElement>('[id="settings-module-running-agents"]')!;
    expect(agents.querySelector<HTMLButtonElement>("[role=switch]")!.disabled).toBe(false);
  });

  it("turning the parent off still asks to turn its children off together", async () => {
    await render();
    click(host.querySelector('[id="settings-module-home"] [role=switch]'));
    expect(fx.enable).not.toHaveBeenCalled();
    const ask = host.querySelector<HTMLElement>('[id="settings-module-home"] [data-module-switch-note=askOff]')!;
    click([...ask.querySelectorAll("button")].find((b) => /一起关掉|Turn all off/.test(b.textContent ?? "")) ?? null);
    expect(fx.enable.mock.calls.sort()).toEqual([["home", false], ["running-agents", false], ["world-clock", false]]);
  });
});
