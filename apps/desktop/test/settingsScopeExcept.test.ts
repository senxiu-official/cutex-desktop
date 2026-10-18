// @vitest-environment jsdom
// Page scope chip (components/settings/Form SettingsPage): while a card on the page carries its own,
// different scope chip (e.g. a host card on the local 输入区 page), the page chip's explanation adds
// that the cards' tags win (owner 2026-10-18); without such a card it does not.
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

const pageChipNote = () => {
  const chip = container.querySelector<HTMLButtonElement>("[data-settings-header] [data-settings-scope] button")!;
  act(() => chip.click());
  return container.querySelector("[data-settings-header] [role=note]")?.textContent ?? "";
};

describe("page scope chip with cards tagged elsewhere", () => {
  it("adds that the cards' tags win while such a card is on the page", () => {
    act(() => root.render(page(card("a"), card("b", "host"))));
    expect(pageChipNote()).toContain("settings.scope.except");
  });

  it("says nothing more without one (a card with the page's own scope is no exception)", () => {
    act(() => root.render(page(card("a"), card("b", "local"))));
    expect(pageChipNote()).not.toContain("settings.scope.except");
  });
});
