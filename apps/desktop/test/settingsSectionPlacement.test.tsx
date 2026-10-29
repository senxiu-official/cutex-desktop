// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ accounts: true, imports: true }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/settingsGateView", () => ({ useSettingsGateTarget: () => null }));
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ capabilitiesOf: () => [] }));
vi.mock("../src/renderer/src/modules/react", () => ({
  useSlot: () => [
    ...(env.accounts ? [{ moduleId: "accounts", mode: "show", missing: [], waiting: false, item: { id: "accounts.list", page: "profiles", Section: Accounts } }] : []),
    ...(env.imports ? [{ moduleId: "imports", mode: "show", missing: [], waiting: false, item: { id: "imports.ccSwitch", page: "profiles", Section: Imports } }] : []),
  ],
}));
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ reportError: vi.fn() }), services: {} }));
import { SettingsSections } from "../src/renderer/src/modules/Outlet";
function Imports() { return h("section", { "data-import": "" }, "Import"); }
function Accounts() { return h("section", { "data-accounts": "" }, "Accounts"); }
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { env.accounts = true; env.imports = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(h(SettingsSections, { page: "profiles" })));
it("places import once as its own sibling section after accounts", () => {
  render(); expect(host.querySelectorAll("[data-import]")).toHaveLength(1);
  expect(host.querySelector("[data-accounts] [data-import]")).toBeNull();
  const sections = [...host.querySelectorAll("section")];
  expect(sections.map(section => section.textContent)).toEqual(["Accounts", "Import"]);
  expect(sections[0]!.parentElement!.nextElementSibling).toBe(sections[1]!.parentElement);
});
it("keeps import available when the separate accounts module is off", () => {
  env.accounts = false; render(); expect(host.querySelectorAll("[data-import]")).toHaveLength(1);
  expect(host.querySelector("[data-accounts]")).toBeNull();
});
it("keeps the import module gate independent", () => {
  env.imports = false; render(); expect(host.querySelector("[data-import]")).toBeNull();
  expect(host.querySelector("[data-accounts]")).not.toBeNull();
});
