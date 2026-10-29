// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettingsSource } from "../src/renderer/src/lib/settingsNav";
import type { SettingsTab } from "../src/renderer/src/store";

const fx = vi.hoisted(() => ({ entry: null as null | { item: { page: SettingsTab; source: SettingsSource | null; hostPart?: boolean } } }));

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/modules/react", () => ({
  useSlot: (slot: string) => slot === "settings.page" && fx.entry ? [{ ...fx.entry, moduleId: "test", mode: "show", missing: [], waiting: false }] : [],
}));
vi.mock("../src/renderer/src/lib/settingsSearchView", () => ({ useSettingsReveal: () => {}, useSettingsSearchIndex: () => [], requestSettingsReveal: () => {} }));
vi.mock("../src/renderer/src/lib/settingsAllHosts", () => ({ useSettingsAllHosts: () => ({ on: false, offered: null, set: () => {} }) }));
vi.mock("../src/renderer/src/lib/settingsHost", async (original) => ({
  ...(await original<object>()),
  useSettingsHost: () => "remote",
  useSettingsTarget: () => ({ hostId: "remote", available: true }),
  setSettingsHost: () => {},
}));
vi.mock("../src/renderer/src/lib/hostPick", () => ({ hostPickerMode: () => "picker" }));
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ useHostAccess: () => ({ isOwner: true, pending: false }) }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostScope: () => ({ host: () => ({ label: "remote" }) }) }));
vi.mock("../src/renderer/src/store", () => {
  const state = { openSettings: () => {} };
  return { useApp: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
vi.mock("../src/renderer/src/components/HostPicker", () => ({ HostPicker: () => h("button", { "data-host-picker": "" }, "remote") }));
vi.mock("../src/renderer/src/components/SettingsHostFrame", () => ({ SettingsHostFrame: ({ children }: { children: ReactNode }) => children }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ ItemBoundary: ({ children }: { children: ReactNode }) => children }));
vi.mock("../src/renderer/src/components/Page", () => ({
  PageBody: ({ children }: { children: ReactNode }) => h("main", null, children),
  SUBNAV_ITEM: "", SUBNAV_OFF: "", SUBNAV_ON: "",
}));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  SettingsPage: ({ page, host, children }: { page: string; host?: ReactNode; children: ReactNode }) => h("section", { "data-page": page }, host, children),
  BackLink: () => null, EmptyState: () => null, Button: () => null, Section: () => null, TextLink: () => null,
}));

import { Settings } from "../src/renderer/src/components/Settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(page: SettingsTab, source: SettingsSource | null, hostPart?: boolean) {
  fx.entry = {
    item: {
      id: `test.${page}`, page, source, hostPart, group: "app", order: 100, icon: () => null,
      titleKey: "shell.general", hintKey: "shell.general.pageHint", Page: () => h("div", null, "content"),
    },
  } as typeof fx.entry;
  act(() => root.render(h(Settings, { params: { tab: page } })));
}

it.each(["general", "appearance", "about"] as const)("%s has no page-level host picker", (page) => {
  render(page, page === "general" ? "local" : null);
  expect(container.querySelector("[data-host-picker]")).toBeNull();
});

it("a host page keeps its page-level host picker", () => {
  render("profiles", "host");
  expect(container.querySelector("[data-host-picker]")).not.toBeNull();
});

it("a mixed page with a host part keeps its page-level host picker", () => {
  render("browser", null, true);
  expect(container.querySelector("[data-host-picker]")).not.toBeNull();
});
