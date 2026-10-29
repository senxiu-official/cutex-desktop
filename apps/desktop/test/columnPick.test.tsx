// @vitest-environment jsdom
// Ctrl/⌘ + click with every column taken (design 039): the columns light up as click targets, the one clicked shows the
// agent, Esc / a click outside cancels (components/ColumnPickLayer, lib/columnPick).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ replaced: [] as [string, string, string | undefined][] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/workspaces", () => ({ replaceWith: (hostId: string, key: string, paneId?: string) => void fx.replaced.push([hostId, key, paneId]) }));
vi.stubGlobal("navigator", { ...globalThis.navigator, language: "zh-CN" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ColumnPickLayer } = await import("../src/renderer/src/components/ColumnPickLayer");
const { I18nProvider } = await import("../src/renderer/src/i18n");
const { cancelColumnPick, startColumnPick, useColumnPick } = await import("../src/renderer/src/lib/columnPick");
const { usePanes } = await import("../src/renderer/src/lib/paneStore");
const { defaultLayout, openBeside } = await import("../src/renderer/src/lib/paneLayout");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  fx.replaced = [];
  const layout = openBeside(defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "A" }), { hostId: "local", sessionId: "B" }, 10);
  usePanes.setState({ layout, scope: "host:local", restore: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  // The two columns as the work area draws them.
  for (const id of ["main", "c2"]) {
    const el = document.createElement("section");
    el.setAttribute("data-conv-pane", id);
    host.appendChild(el);
  }
  const sub = document.createElement("div");
  document.body.appendChild(sub);
  root = createRoot(sub);
  act(() => root.render(h(I18nProvider, null, h(ColumnPickLayer))));
});
afterEach(() => {
  act(() => root.unmount());
  cancelColumnPick();
  host.remove();
});

const zones = () => [...document.querySelectorAll<HTMLButtonElement>("[data-column-pick]")];

it("draws nothing until a pick starts; then one target per column; clicking one replaces that column", () => {
  expect(zones()).toHaveLength(0);
  act(() => startColumnPick({ hostId: "local", key: "C" }));
  expect(zones().map((z) => z.getAttribute("data-column-pick"))).toEqual(["main", "c2"]);
  act(() => zones()[1]!.click());
  expect(fx.replaced).toEqual([["local", "C", "c2"]]);
  expect(useColumnPick.getState().pick).toBeNull();
  expect(zones()).toHaveLength(0);
});

it("Esc and a click outside cancel without replacing anything", () => {
  act(() => startColumnPick({ hostId: "local", key: "C" }));
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true })));
  expect(useColumnPick.getState().pick).toBeNull();
  act(() => startColumnPick({ hostId: "local", key: "C" }));
  act(() => void document.querySelector("[data-column-pick-shield]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(useColumnPick.getState().pick).toBeNull();
  expect(fx.replaced).toEqual([]);
});
