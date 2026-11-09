// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({ ...(await original<object>()), useTargetHostId: () => "local" }));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { active: "local", hosts: [{ id: "local", label: "Local" }] }, daemon: { kind: "disconnected" } };
  return { useApp: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
import { Section, SettingsEffectCard, SettingsGroup, SettingsPage, SettingRow, ListRow, LinkRow } from "../src/renderer/src/components/settings/Form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const chips = (element: Element) => [...element.querySelectorAll("button[data-settings-agents]")].map(button => button.getAttribute("data-settings-agents"));
const scopes = (element: Element) => [...element.querySelectorAll("[data-effect-scope-marker]")].map(marker => marker.getAttribute("data-effect-scope-marker"));
const row = (label: string) => [...host.querySelectorAll("[data-setting-row]")].find(element => element.textContent?.includes(label))!;
const card = (title: string) => [...host.querySelectorAll("section")].find(element => element.querySelector("h3")?.textContent === title)!;
const field = (label: string, agents: import("../src/renderer/src/lib/settingsNav").SettingsAgents, source: import("../src/renderer/src/lib/settingsNav").SettingsSource = "host") => h(SettingRow, { key: label, label, agents, source });
const section = (title: string, children: React.ReactNode) => h(Section, { key: title, title, children });
const page = (children: React.ReactNode, pageId?: string) => h(SettingsPage, { page: pageId, children });
const render = (node: React.ReactNode) => act(() => root.render(node));

it("uses uniform card summaries in a mixed page and row icons only inside mixed cards", () => {
  render(page([
    section("Uniform", [field("Model", "next"), field("API key", "next")]),
    section("Mixed", [field("Display", "none"), field("Search", "offNowOnNext")]),
  ]));
  expect(chips(host.querySelector("[data-settings-header]")!)).toEqual(["mixed"]);
  expect(chips(card("Uniform"))).toEqual(["next"]);
  expect(card("Uniform").querySelector('[data-timing-presentation="header"]')).not.toBeNull();
  expect(chips(row("Model"))).toEqual([]); expect(chips(row("API key"))).toEqual([]);
  expect(chips(card("Mixed"))).toEqual(["offNowOnNext"]);
  expect(card("Mixed").querySelector('[data-timing-presentation="header"]')).toBeNull();
  expect(row("Search").getAttribute("data-effect-timing")).toBe("offNowOnNext");
  const marker = row("Search").querySelector("button[data-settings-agents]")!;
  expect(marker.textContent).toBe("");
  expect(marker.querySelector("svg")?.getAttribute("width")).toBe("14");
});

it("states both uniform page axes once and suppresses all lower markers", () => {
  render(page([section("A", field("First", "next")), section("B", field("Second", "next"))]));
  expect(chips(host)).toEqual(["next"]); expect(scopes(host)).toEqual(["host:local"]);
  expect(host.querySelectorAll("section [data-settings-agents], section [data-effect-scope-marker]")).toHaveLength(0);
});

it("places timing and source independently from explicit row declarations", () => {
  render(page([
    section("Timing uniform", [field("Local runtime", "next", "local"), field("Host runtime", "next", "host")]),
    section("Source uniform", [field("Display", "none", "codex"), field("Call", "now", "codex")]),
  ]));
  expect(chips(card("Timing uniform"))).toEqual(["next"]);
  expect(scopes(card("Timing uniform"))).toEqual(["local", "host:local"]);
  expect(chips(row("Local runtime"))).toEqual([]);
  expect(row("Local runtime").getAttribute("data-effect-source")).toBe("local");
  expect(scopes(card("Source uniform"))).toEqual(["codex:local"]);
  expect(scopes(row("Display"))).toEqual([]);
  expect(chips(card("Source uniform"))).toEqual(["now"]);
  expect(host.querySelector("[data-settings-scope]")?.getAttribute("data-settings-scope")).toBe("mixed");
});

it("recomputes both axes after conditional mount, declaration changes and unmount", () => {
  const tree = (exception?: boolean) => page(section("Rows", [field("Display", "none", "local"),
    exception !== undefined && field("Behavior", exception ? "next" : "none", exception ? "host" : "local"),
  ]));
  render(tree(false)); expect(chips(host)).toEqual([]); expect(scopes(host)).toEqual(["local"]);
  render(tree(true)); expect(chips(host)).toEqual(["mixed", "next"]); expect(scopes(host)).toEqual(["mixed", "local", "host:local"]);
  render(tree()); expect(chips(host)).toEqual([]); expect(scopes(host)).toEqual(["local"]);
  expect(row("Behavior")).toBeUndefined();
});

it("summarizes nested cards at the highest uniform ancestor without repeats", () => {
  render(page([
    section("Outer uniform", [field("Outer", "next"), section("Inner", field("Nested", "next"))]),
    section("Other", field("Other field", "none", "local")),
  ]));
  expect(chips(card("Outer uniform"))).toEqual(["next"]); expect(scopes(card("Outer uniform"))).toEqual(["host:local"]);
  expect(chips(card("Inner"))).toEqual([]); expect(scopes(card("Inner"))).toEqual([]); expect(chips(row("Nested"))).toEqual([]);
  render(page(section("Outer mixed", [field("Outer", "none", "local"), section("Inner", field("Nested", "next", "host"))])));
  expect(chips(row("Outer"))).toEqual([]);
  expect(chips(card("Inner"))).toEqual(["next"]); expect(scopes(card("Inner"))).toEqual(["host:local"]);
  expect(chips(row("Nested"))).toEqual([]);
});

it("registers a custom SettingsGroup as one logical control", () => {
  render(page(section("Custom", [
    h(SettingsGroup, { key: "matrix", agents: "none", source: "local", children: "Delivery matrix" }),
    field("Runtime", "next", "host"),
  ])));
  const group = row("Delivery matrix");
  expect(group.getAttribute("data-effect-timing")).toBe("none"); expect(group.getAttribute("data-effect-source")).toBe("local");
  expect(chips(group)).toEqual([]); expect(scopes(group)).toEqual(["local"]); expect(chips(row("Runtime"))).toEqual(["next"]);
});

it("includes logical controls in card actions when computing and placing both summaries", () => {
  render(page([
    h(Section, { key: "runtime", title: "Runtime actions",
      actions: h(SettingsGroup, { agents: "now", source: "host", children: "Action setting" }),
      children: field("Body setting", "next", "host") }),
    section("Display", field("Appearance", "none", "local")),
  ]));
  expect(chips(host.querySelector("[data-settings-header]")!)).toEqual(["mixed"]);
  expect(chips(card("Runtime actions"))).toEqual(["now", "next"]);
  expect(card("Runtime actions").querySelector('[data-timing-presentation="header"]')).toBeNull();
  expect(chips(row("Action setting"))).toEqual(["now"]);
  expect(chips(row("Body setting"))).toEqual(["next"]);
  expect(scopes(card("Runtime actions"))).toEqual(["host:local"]);
  expect(scopes(row("Action setting"))).toEqual([]);
  expect(scopes(row("Body setting"))).toEqual([]);
});

it("applies normal timing aggregation to Profile while keeping its common scope baseline", () => {
  render(page(section("Runtime", [field("Model", "next"), field("Effort", "next")]), "profiles"));
  expect(host.querySelector("[data-effect-exemption]")?.getAttribute("data-effect-exemption")).toBe("profiles");
  expect(chips(host.querySelector("[data-settings-header]")!)).toEqual(["next"]);
  expect(chips(row("Model"))).toEqual([]); expect(chips(row("Effort"))).toEqual([]);
  expect(host.querySelector('section [data-timing-presentation="header"]')).toBeNull(); expect(scopes(host)).toEqual(["host:local"]);
});

it("treats an unknown timing declaration as mixed while preserving known row icons", () => {
  // Intentionally emulate an unreviewed legacy row despite the required TypeScript declaration.
  render(page(section("Partial", [field("Known", "none", "local"), field("Unknown", undefined as never, "local")])));
  expect(chips(host.querySelector("[data-settings-header]")!)).toEqual(["mixed"]);
  expect(chips(row("Known"))).toEqual([]); expect(chips(row("Unknown"))).toEqual([]); expect(scopes(host)).toEqual(["local"]);
});

it("reveals the full row timing explanation on hover/click and dismisses with Escape", () => {
  render(section("Mixed", [field("Search", "offNowOnNext"), field("Label", "none")]));
  const button = row("Search").querySelector<HTMLButtonElement>("button[data-settings-agents]")!;
  // The explanation is portaled (fixed, above every row's markers): found through the chip's aria-controls.
  const note = () => document.getElementById(button.getAttribute("aria-controls")!);
  act(() => void button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(note()?.textContent).toContain("settings.scope.agents.offNowOnNext.body");
  expect(row("Search").contains(note())).toBe(false);
  act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(note()).toBeNull();
  act(() => button.click()); expect(button.getAttribute("aria-expanded")).toBe("true");
});

it("the row explanation sits above the next row's markers (portaled) and stays open when clicked inside", () => {
  // Owner 2026-10-25: 计划清单's 「下次启动生效」 popover had the next row's (内置网页搜索) icon on top of it — each row's
  // marker strip is its own stacking context, so an in-row popover could never rise above a later row.
  render(section("Tools", [field("Plan", "next"), field("Search", "none")]));
  const button = row("Plan").querySelector<HTMLButtonElement>("button[data-settings-agents]")!;
  const note = () => document.getElementById(button.getAttribute("aria-controls")!);
  act(() => button.click());
  expect(note()!.parentElement).toBe(document.body);
  expect(note()!.className).toContain("fixed z-[161]");
  // A click inside the (portaled) popover keeps it open.
  act(() => void note()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(note()).not.toBeNull();
  // A click elsewhere closes it.
  act(() => void document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(note()).toBeNull();
});

it("distinguishes creation-only timing from next-start timing inside a mixed card", () => {
  render(section("Runtime", [field("Automatic Profile choice", "newAgents"), field("Model", "next")]));
  const marker = row("Automatic Profile choice").querySelector<HTMLButtonElement>("button[data-settings-agents]")!;
  expect(marker.getAttribute("aria-label")).toBe("settings.scope.agents.newAgents");
  act(() => marker.click()); expect(document.getElementById(marker.getAttribute("aria-controls")!)?.textContent).toContain("settings.scope.agents.newAgents.body");
  expect(marker.querySelector('[data-timing-badge]')?.getAttribute("width")).toBe("8");
});

it("applies the same highest uniform rule to an existing dashboard card", () => {
  render(page([
    h(SettingsEffectCard, { key: "custom", children: h("section", { children: [h("h3", { key: "title" }, "Prices"), field("Price", "none", "host"), field("Source", "none", "host")] }) }),
    section("Runtime", field("Model", "next", "host")),
  ]));
  const custom = host.querySelector("section")!;
  expect(chips(host.querySelector("[data-settings-header]")!)).toEqual(["mixed"]);
  expect(chips(custom.querySelector("[data-effect-card-summary]")!)).toEqual([]);
  expect(chips(row("Price"))).toEqual([]);
});

it("registers entity rows without adding layout wrappers or losing sibling borders", () => {
  render(page(section("Entities", ["A", "B"].map(title => h(SettingsGroup, { key: title, agents: "none", source: "local", children: h(ListRow, { title }) })))));
  const entities = [...host.querySelectorAll("[data-setting-row]")];
  expect(entities).toHaveLength(2);
  expect(entities[0]!.parentElement).toBe(entities[1]!.parentElement);
  expect(entities[0]!.tagName).toBe("DIV");
  expect(entities[0]!.nextElementSibling).toBe(entities[1]);
  expect(entities[0]!.className).toContain("last:border-b-0");
  expect(chips(entities[0]!)).toEqual([]);
  expect(host.querySelector("[data-effect-markers]")).toBeNull();
});

it("keeps the Profile common host once and labels only differing local scope", () => {
  render(page([
    section("Host", [field("Name", "none", "host"), field("Model", "next", "host")]),
    section("Local", field("Claim", "now", "local")),
  ], "profiles"));
  expect(scopes(host.querySelector("[data-settings-header]")!)).toEqual(["host:local"]);
  expect(scopes(card("Host"))).toEqual([]);
  expect(scopes(card("Local").querySelector("[data-effect-card-summary]")!)).toEqual(["local"]);
  expect(scopes(row("Claim"))).toEqual([]);
  expect(chips(row("Name"))).toEqual([]);
});


it("read-only summary values and quota results never render or contribute markers", () => {
  render(page([
    section("Summary", h(SettingsGroup, { agents: "next", source: "host", readOnly: true, children: "GLM-5.3 · high · 256K" })),
    section("Results", h(SettingRow, { label: "Current quota", agents: "none", source: "host", readOnly: true, children: "73%" })),
    section("Editable", field("Model editor", "next", "host")),
  ], "profiles"));
  expect(chips(card("Summary"))).toEqual([]); expect(scopes(card("Summary"))).toEqual([]);
  expect(chips(row("Current quota"))).toEqual([]); expect(scopes(row("Current quota"))).toEqual([]);
  expect(chips(host)).toEqual(["next"]); expect(scopes(host)).toEqual(["host:local"]);
});

it("Profile uses one timing per uniform editable card and row markers only in mixed cards", () => {
  render(page([
    section("Appearance", [field("Avatar", "none"), field("Greeting", "none")]),
    section("Quota reader", [field("Reader", "none"), field("Refresh", "none")]),
    section("Mixed runtime", [field("Model", "next"), field("Admission", "now")]),
  ], "profiles"));
  expect(chips(host.querySelector("[data-settings-header]")!)).toEqual(["mixed"]);
  expect(chips(card("Appearance"))).toEqual([]); expect(chips(row("Avatar"))).toEqual([]);
  expect(chips(card("Quota reader"))).toEqual([]); expect(chips(row("Reader"))).toEqual([]);
  expect(chips(row("Model"))).toEqual(["next"]); expect(chips(row("Admission"))).toEqual(["now"]);
  expect(scopes(host)).toEqual(["host:local"]);
});


it("navigation-only untitled cards have no effects, and titled read-only info keeps scope only", () => {
  render(page([
    section("", h(LinkRow, { label: "My devices", link: "View Devices", onClick: () => {}, agents: "none", source: "local" })),
    section("Diagnostics", h(SettingRow, { label: "Host ID", agents: "none", source: "host", readOnly: true, children: "HOST-A" })),
  ]));
  expect(chips(host)).toEqual([]);
  expect(scopes(host)).toEqual(["host:local"]);
  expect(host.querySelector("section")!.querySelector("[data-effect-card-summary]")).toBeNull();
  expect(host.querySelector("section")!.querySelector("h3")).toBeNull();
});

it("card summary markers share the title row and never float above an untitled card", () => {
  render(page([section("Display", field("Look", "none", "local")), section("Runtime", field("Model", "next", "host"))]));
  const marker = card("Display").querySelector("[data-effect-card-summary]")!;
  expect(marker.parentElement).toBe(card("Display").querySelector("h3")!.parentElement);
  render(page([section("", field("Untitled", "none", "local")), section("Runtime", field("Model", "next", "host"))]));
  expect(host.querySelector("section")!.querySelector("[data-effect-card-summary]")).toBeNull();
  expect(chips(row("Untitled"))).toEqual([]);
});


it("keeps list-row markers beside rich flex titles instead of below them", () => {
  render(page(section("Mixed entities", [
    h(SettingsGroup, { key: "entity", agents: "none", source: "local", children: h(ListRow, { title: h("span", { className: "flex" }, "Module title", h("span", null, "Built in")) }) }),
    field("Other timing", "next", "host"),
  ])));
  const title = host.querySelector("[data-list-row-title]")!;
  expect(title.classList.contains("flex")).toBe(true);
  expect(title.children[0]!.textContent).toBe("Module titleBuilt in");
  expect(title.querySelector("[data-effect-markers]")!.parentElement).toBe(title);
});


it("custom groups put their effect beside a nested card title without an orphan marker", () => {
  render(page([
    h(SettingsGroup, { key: "custom", agents: "next", source: "host", children: h(Section, { title: "Custom editor", children: "Custom fields" }) }),
    section("Display", field("Look", "none", "local")),
  ]));
  const custom = card("Custom editor");
  const marker = custom.querySelector("[data-effect-markers]")!;
  expect(marker.parentElement).toBe(custom.querySelector("h3")!.parentElement);
  expect(custom.parentElement!.querySelectorAll("[data-effect-markers]")).toHaveLength(1);
});
