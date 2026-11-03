// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
import { FormFields, Section, SettingRow, SettingsGroup, TextInput } from "../src/renderer/src/components/settings/Form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (node: ReactNode) => act(() => root.render(node));
const row = (label: string, source: "host" | "local" = "host") => h(SettingRow, { label, agents: "next", source, hint: "Keep this explanation", children: h(TextInput, { value: "draft", onChange: () => {} }) });
const form = (node: ReactNode) => h(FormFields, { children: node });
const card = (node: ReactNode) => h(Section, { title: "Basics", children: node });

it("keeps automatic scope/effect badges in real settings by default", () => {
  render(row("Real setting"));
  expect(host.querySelector("[data-effect-markers='row']")).not.toBeNull();
  expect(host.querySelector("[data-settings-agents='next']")).not.toBeNull();
  expect(host.querySelector("[data-form-field]")).toBeNull();
});

it("suppresses mixed per-row badges and section summaries in a one-shot form, retaining labels and hints", () => {
  render(form(card(h("div", null, row("Host draft"), row("Desktop draft", "local")))));
  expect(host.querySelectorAll("[data-form-field]")).toHaveLength(2);
  expect(host.querySelector("[data-effect-markers]")).toBeNull();
  expect(host.querySelector("[data-settings-agents]")).toBeNull();
  expect(host.textContent).toContain("Keep this explanation");
  expect(host.textContent).not.toContain("settings.scope.");
  const input = host.querySelector("input")!;
  expect(document.getElementById(input.getAttribute("aria-labelledby")!)?.textContent).toBe("Host draft");
  expect(host.querySelector("[data-form-field]")?.textContent).toContain("Keep this explanation");
});

it("also suppresses SettingsGroup markers used by custom creation steps", () => {
  render(form(card(h(SettingsGroup, { agents: "newAgents", source: "host", children: ({ attributes, marker }) => h("div", attributes, marker, h("button", null, "Choose provider")) }))));
  expect(host.querySelector("button")?.textContent).toBe("Choose provider");
  expect(host.querySelector("[data-effect-markers]")).toBeNull();
  expect(host.querySelector("[data-settings-agents]")).toBeNull();
});

it("does not let creation fields change a neighbouring settings card's scope/timing summary", () => {
  render(card(h("div", null,
    h(SettingRow, { label: "Persistent local", agents: "now", source: "local", children: "value" }),
    form(row("New host object")),
  )));
  expect(host.querySelector("[data-settings-agents='now']")).not.toBeNull();
  expect(host.querySelector("[data-settings-agents='next']")).toBeNull();
  expect(host.querySelector("[data-form-field] [data-effect-markers]")).toBeNull();
});

it("uses a single label/control column and constrains draft inputs without adding a DOM form", () => {
  render(form(row("A long creation label")));
  const field = host.querySelector<HTMLElement>("[data-form-field]")!;
  expect(field.className).toContain("grid-cols-[minmax(0,1fr)]");
  expect(field.className).not.toContain("minmax(9rem,1fr)");
  expect(field.lastElementChild?.className).toContain("max-w-full");
  expect(host.querySelector("form")).toBeNull();
});

it("restores ordinary settings presentation when the form is removed", () => {
  render(form(card(row("Draft"))));
  expect(host.querySelector("[data-settings-agents]")).toBeNull();
  render(card(row("Actual setting")));
  expect(host.querySelector("[data-settings-agents='next']")).not.toBeNull();
  expect(host.querySelector("[data-form-field]")).toBeNull();
});
