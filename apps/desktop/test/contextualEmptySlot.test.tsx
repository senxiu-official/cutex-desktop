// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ automatic: true, peer: null as unknown, open: vi.fn(), layout: { instances: {}, pages: [] } }));
vi.mock("../src/renderer/src/lib/paneKinds", () => ({ isContextualPane: () => fx.automatic }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({ openSide: (...args: unknown[]) => fx.open(...args) }));
vi.mock("../src/renderer/src/lib/sideMenus", () => ({ launchable: () => [], launch: vi.fn() }));
vi.mock("../src/renderer/src/lib/shelfSource", () => ({ useShelfLayout: () => fx.layout }));
vi.mock("../src/renderer/src/lib/shelfSourceContext", () => ({ useShelfPeer: () => fx.peer }));
vi.mock("../src/renderer/src/lib/hiddenPage", () => ({ slotInfo: () => ({ owners: [] }) }));
vi.mock("../src/renderer/src/lib/hiddenPageNames", () => ({ useOwnerNames: () => [] }));
vi.mock("../src/renderer/src/lib/sideLayoutStore", () => ({ updateLayout: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ useApp: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { EmptySlot } from "../src/renderer/src/components/side/EmptySlot";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { fx.open.mockClear(); fx.layout.instances = {}; fx.automatic = true; fx.peer = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const props = { page: { id: "p", shared: true }, card: { id: "c", kind: "example.view", tabs: ["old"], active: "old" }, entry: { item: { titleKey: "title", icon: () => null } }, ctx: { hostId: "remote", sessionId: "agent" }, height: null } as never;
it("opens an unbound pinned slot without a click, including singleton pages without a launcher", () => {
  act(() => root.render(h(EmptySlot, props)));
  expect(fx.open).toHaveBeenCalledExactlyOnceWith("example.view", {}, { page: "p", focus: false, reveal: false });
  act(() => root.render(h(EmptySlot, props)));
  expect(fx.open).toHaveBeenCalledTimes(1);
});
it("retains manual placeholders for agent/workspace-bound tools", () => {
  fx.automatic = false;
  act(() => root.render(h(EmptySlot, props)));
  expect(fx.open).not.toHaveBeenCalled();
});
it("does not open a background peer context or a folded slot", () => {
  fx.peer = { hostId: "elsewhere" };
  act(() => root.render(h(EmptySlot, props)));
  expect(fx.open).not.toHaveBeenCalled();
  fx.peer = null;
  act(() => root.render(h(EmptySlot, { ...props as object, folded: true } as never)));
  expect(fx.open).not.toHaveBeenCalled();
});

it("single-instance pages without launchers preserve their saved page parameters", () => {
  fx.layout.instances = { old: { state: { project: "alpha", tab: "details" } } };
  act(() => root.render(h(EmptySlot, props)));
  expect(fx.open).toHaveBeenCalledWith("example.view", { project: "alpha", tab: "details" }, { page: "p", focus: false, reveal: false });
});
