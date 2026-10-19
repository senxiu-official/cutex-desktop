// @vitest-environment jsdom
// Page scope (components/settings/Form SettingsPage; owner 2026-10-19, one rule): a page lives in one
// place, or — as soon as one card lives elsewhere (e.g. a host card on the local 输入区 page) — it is
// 混合设置 and every titled card shows where it lives. On a one-place page no card shows a place.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ state: { daemon: { kind: "disconnected" }, hosts: { active: "local", hosts: [{ id: "local", label: "HOST-A" }] } } as Record<string, unknown> }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));

const { Section, SettingsPage } = await import("../src/renderer/src/components/settings/Form");
const card = (title: string, source?: "local" | "host") => h(Section, { key: title, title, source, children: title });
const page = (...cards: ReturnType<typeof card>[]) => h(SettingsPage, { source: "local", children: cards });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const pageChip = () => container.querySelector("[data-settings-header] [data-settings-scope]")?.textContent ?? "";
const cardTags = () => [...container.querySelectorAll("section")].map((s) => s.querySelector("button")?.textContent ?? "");

describe("page scope: one place, or 混合设置 with every card tagged", () => {
  it("a card elsewhere makes the page 混合设置, and every card shows its place", () => {
    act(() => root.render(page(card("a"), card("b", "host"))));
    expect(pageChip()).toContain("settings.scope.mixedTag");
    expect(cardTags()).toEqual(["settings.scope.local.label", "settings.scope.host.label"]);
  });

  it("a one-place page: its place in the header, no card tagged (a card naming the page's place is no exception)", () => {
    act(() => root.render(page(card("a"), card("b", "local"))));
    expect(pageChip()).toContain("settings.scope.local.label");
    expect(cardTags()).toEqual(["", ""]);
  });
});
