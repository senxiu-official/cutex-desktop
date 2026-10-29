// @vitest-environment jsdom
// Scope markers summarize explicit rows at the highest uniform page/card/row, including host identity.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TargetHostContext } from "../src/renderer/src/lib/targetHost";

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

const { Section, SettingsPage, SettingRow, PartSource, SettingsGroup } = await import("../src/renderer/src/components/settings/Form");

const card = (title: string, source: "local" | "host" = "local") => h(Section, { key: title, title, children: h(SettingRow, { label: title, agents: "none", source }) });
const page = (...cards: React.ReactNode[]) => h(SettingsPage, { children: cards });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const scopes = (element: Element) => [...element.querySelectorAll("[data-effect-scope-marker]")].map(marker => marker.getAttribute("data-effect-scope-marker"));
const pageScope = () => container.querySelector("[data-settings-scope]")?.getAttribute("data-settings-scope");
const row = (label: string) => [...container.querySelectorAll("[data-setting-row]")].find(element => element.textContent?.startsWith(label))!;
const render = (node: React.ReactNode) => act(() => root.render(node));

describe("source declarations use the highest uniform page/card/row", () => {
  it("labels every uniform card on a mixed page, including local cards", () => {
    render(page(card("Local"), card("Host", "host")));
    expect(pageScope()).toBe("mixed");
    expect(scopes(container)).toEqual(["mixed", "local", "host:local"]);
    expect(scopes(row("Local"))).toEqual([]); expect(scopes(row("Host"))).toEqual([]);
  });
  it("states a one-place page once", () => {
    render(page(card("A"), card("B")));
    expect(pageScope()).toBe("local"); expect(scopes(container)).toEqual(["local"]);
  });
  it("derives the page scope from actual host rows", () => {
    render(page(card("A", "host"), card("B", "host")));
    expect(pageScope()).toBe("host:local"); expect(scopes(container)).toEqual(["host:local"]);
  });
  it("keeps mixed-card declarations on rows instead of declaring a card baseline", () => {
    render(page(h(Section, { title: "Mixed", children: [
      h(SettingRow, { key: "host", label: "Host colour", agents: "none", source: "host" }),
      h(SettingRow, { key: "local", label: "Local style", agents: "none", source: "local" }),
    ] })));
    expect(pageScope()).toBe("mixed");
    expect(scopes(container)).toEqual(["mixed", "host:local", "local"]);
    expect(scopes(row("Host colour"))).toEqual(["host:local"]); expect(scopes(row("Local style"))).toEqual(["local"]);
    expect(container.querySelector("section [data-effect-card-summary] [data-effect-scope-marker]")).toBeNull();
  });
});

it("states a uniform host scope only on the outer card containing a headless host part", () => {
  render(page(card("Local"), h(Section, { title: "Host outer", children: h(PartSource, { children:
    h(Section, { title: "Host inner", children: h(SettingRow, { label: "Remote value", agents: "none", source: "host" }) }) }) })));
  expect(scopes(container)).toEqual(["mixed", "local", "host:local"]);
  const inner = [...container.querySelectorAll("section")].find(section => section.querySelector("h3")?.textContent === "Host inner")!;
  expect(scopes(inner)).toEqual([]);
});

it("distinguishes an all-hosts logical row and omits a target-host picker", () => {
  render(page(card("Local"), h(Section, { title: "Bulk", picker: h("button", {}, "Target picker"), children:
    h(SettingsGroup, { agents: "none", source: "host", allHosts: true, children: "Apply on all connected hosts" }) })));
  expect(pageScope()).toBe("mixed");
  expect(scopes(container)).toEqual(["mixed", "local", "allHosts"]);
  expect(container.textContent).not.toContain("Target picker");
  expect(row("Apply on all connected hosts").getAttribute("data-effect-all-hosts")).toBe("true");
});

it("keeps identical source types on different target hosts distinct", () => {
  const hostCard = (hostId: string) => h(TargetHostContext.Provider, { key: hostId, value: hostId,
    children: card(hostId, "host") });
  render(page(hostCard("host-a"), hostCard("host-b")));
  expect(pageScope()).toBe("mixed");
  expect(scopes(container)).toEqual(["mixed", "host:host-a", "host:host-b"]);
  expect(row("host-a").getAttribute("data-effect-host")).toBe("host-a");
  expect(row("host-b").getAttribute("data-effect-host")).toBe("host-b");
  expect(scopes(row("host-a"))).toEqual([]);
  expect(scopes(row("host-b"))).toEqual([]);
});

it("declares a composite row scope explicitly and stays stable across fresh array values", () => {
  const render = () => act(() => root.render(h(SettingsPage, { children: h(Section, { title: "Project identity", children: h(SettingRow, { label: "Name and icon", agents: "none", source: ["host", "local"] }) }) })));
  render(); render();
  const marker = container.querySelector('[data-settings-header] [data-effect-scope-marker]');
  expect(marker?.getAttribute("data-effect-scope-marker")).toBe("host:local|local");
  expect(marker?.textContent).toContain("settings.scope.host.label");
  expect(marker?.textContent).toContain("settings.scope.local.label");
  expect(container.querySelector("[data-setting-row] [data-effect-scope-marker]")).toBeNull();
});