// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ nav: [] as any[], registry: new Map<string, any>() }));
vi.mock("../src/renderer/src/i18n", async orig => ({ ...await orig<object>(), translate: (key: string) => key }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ snapshot: () => state.nav }) }));
vi.mock("../src/renderer/src/lib/sideComponents", async orig => ({ ...await orig<object>(), sideRegistry: () => state.registry }));
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ entryGateNow: (_host: string, entry: any) => ({ ok: !entry.hidden }) }));
import { launchable } from "../src/renderer/src/lib/sideMenus";

it("derives Shelf pages from the More registry, filters host gates/actions/Aside pages, and keeps the existing status entry once", () => {
  const Icon = () => null;
  const page = (id: string, extra = {}) => ({ moduleId: id, mode: "show", item: { id: `${id}.nav`, title: id, icon: Icon, target: { page: `${id}.page` }, ...extra } });
  state.nav = [page("fresh-extension"), page("delegations"), page("hidden"), page("settings"), page("action", { target: { run: () => {} } })];
  state.registry = new Map([
    ["page:fresh-extension.page", { item: { icon: Icon } }],
    ["page:delegations.page", { item: { icon: Icon } }],
    ["page:hidden.page", { item: { icon: Icon }, hidden: true }],
    // Aside pages never derive a side component, so settings has no registry entry.
    ["status:delegations.status", { moduleId: "delegations", item: { titleKey: "side.launcher.status", icon: Icon, instances: "singleton", launcher: { order: 1, pin: "never", params: () => ({}) } } }],
  ]);
  // Same visible label as the existing status entry, without naming that feature in shell code.
  state.nav[1].item.title = "side.launcher.status";
  expect(launchable()).toHaveLength(1);
  const all = launchable(true);
  expect(all.map(x => x.kind)).toEqual(["status:delegations.status", "page:fresh-extension.page"]);
  expect(all[1]).toMatchObject({ label: "fresh-extension", group: "page", params: {} });
  state.nav.push(page("later-module"));
  state.registry.set("page:later-module.page", { item: { icon: Icon } });
  expect(launchable(true).some(x => x.kind === "page:later-module.page")).toBe(true);
});
