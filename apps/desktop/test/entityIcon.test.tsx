// @vitest-environment jsdom
// Entity icons everywhere (owner 2026-11-24): the shared slot that lines up names after text / symbol icons, the
// pickers drawing the icon of the agent / project / Profile each row names, and the deferred icons of long pickers.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EntityIcon } from "../src/renderer/src/components/EntityIcon";
import { SearchablePickerBody, SearchableSelect, type SearchablePickerOption } from "../src/renderer/src/components/SearchablePicker";
import { entityIconSlot, type EntityRef } from "../src/renderer/src/lib/entityIcon";
import { projectBadgeWidth } from "../src/renderer/src/lib/projectBadgeSize";
import { agentPickerOptions } from "../src/renderer/src/lib/agentPickerOptions";
import { domainEntity } from "../src/renderer/src/lib/securityPicker";
import { hostKey } from "../src/renderer/src/lib/hostKeys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const project = (id: string, badge: string): EntityRef => ({ kind: "project", id, hostId: "local", badge, color: "blue" });
const NO_ICONS = {};

describe("entityIconSlot", () => {
  it("is the icon box when every badge fits, and the widest text badge otherwise", () => {
    expect(entityIconSlot([project("a", "CD"), { kind: "agent", id: "s1", name: "Alice" }, null], NO_ICONS)).toBe(16);
    const wide = entityIconSlot([project("a", "CD"), project("b", "MAST"), project("c", "音声")], NO_ICONS, 22);
    expect(wide).toBe(Math.max(projectBadgeWidth(null, "MAST", "lg"), projectBadgeWidth(null, "音声", "lg")));
    expect(wide).toBeGreaterThan(22);
  });

  it("counts the chosen icon over the daemon badge: a symbol icon keeps the plain box", () => {
    const icons = { [hostKey("local", "b")]: { kind: "icon" as const, value: "book" } };
    expect(entityIconSlot([project("b", "MAST")], icons)).toBe(16);
    expect(entityIconSlot([project("b", "MAST")], NO_ICONS)).toBeGreaterThan(16);
  });
});

describe("EntityIcon", () => {
  it("draws each kind in a box of the slot width, centred on the line", () => {
    act(() => root.render(h("div", null,
      h(EntityIcon, { entity: project("a", "CD"), slot: 30 }),
      h(EntityIcon, { entity: project("b", "MAST"), slot: 30 }),
      h(EntityIcon, { entity: { kind: "agent", id: "s1", name: "Alice" }, slot: 30 }),
    )));
    const boxes = [...host.querySelectorAll<HTMLElement>("[data-entity-icon]")];
    expect(boxes.map((b) => b.dataset.entityIcon)).toEqual(["project", "project", "agent"]);
    expect(new Set(boxes.map((b) => b.style.width))).toEqual(new Set(["30px"]));
    expect(new Set(boxes.map((b) => b.style.height))).toEqual(new Set(["16px"]));
    expect(boxes.every((b) => b.className.includes("items-center") && b.className.includes("justify-center"))).toBe(true);
  });
});

describe("SearchablePicker with entities", () => {
  const options: SearchablePickerOption[] = [
    { value: "p1", label: "cutex-desktop", group: "项目", entity: project("p1", "CD") },
    { value: "p2", label: "scale-runtime", group: "项目", entity: project("p2", "MAST") },
    { value: "none", label: "No icon", group: "项目" },
    { value: "s1", label: "Alice", group: "独立", entity: { kind: "agent", id: "s1", name: "Alice" } },
  ];

  it("gives every row the same icon slot (a blank one for a row without an entity), so labels line up", () => {
    act(() => root.render(h(SearchablePickerBody, { options, onPick: () => {}, placeholder: "搜索", emptyLabel: "无" })));
    const rows = [...host.querySelectorAll<HTMLButtonElement>("[role=option]")];
    const slots = rows.map((r) => (r.querySelector("span > span:first-child") as HTMLElement).style.width);
    const width = `${entityIconSlot(options.map((o) => o.entity), NO_ICONS)}px`;
    expect(slots).toEqual([width, width, width, width]);
    expect(rows.map((r) => r.querySelector("[data-entity-icon]")?.getAttribute("data-entity-icon") ?? null)).toEqual(["project", "project", null, "agent"]);
  });

  it("stays text-only when no option names an entity", () => {
    act(() => root.render(h(SearchablePickerBody, { options: options.map(({ entity: _e, ...o }) => o), onPick: () => {}, placeholder: "搜索", emptyLabel: "无" })));
    expect(host.querySelectorAll("[data-entity-icon]").length).toBe(0);
    expect(host.querySelector("[role=option] > span")?.className).toContain("block truncate");
  });

  it("mounts the first rows' icons with the list and the rest over the next frames", async () => {
    const many: SearchablePickerOption[] = Array.from({ length: 150 }, (_, i) => ({ value: `s${i}`, label: `Agent ${i}`, group: "", entity: { kind: "agent", id: `s${i}`, name: `Agent ${i}` } }));
    act(() => root.render(h(SearchablePickerBody, { options: many, onPick: () => {}, placeholder: "搜索", emptyLabel: "无" })));
    expect(host.querySelectorAll("[data-entity-icon]").length).toBe(40);
    for (let i = 0; i < 4; i++) await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    expect(host.querySelectorAll("[data-entity-icon]").length).toBe(150);
  });

  it("shows the selected option's icon in the trigger", () => {
    act(() => root.render(h(SearchableSelect, { value: "p2", options, onChange: () => {}, placeholder: "选择", emptyLabel: "无", label: "项目" })));
    expect(host.querySelector("button [data-entity-icon=project]")).not.toBeNull();
  });
});

describe("option builders name their entity", () => {
  it("agentPickerOptions: every row carries its agent (the session id behind a host-qualified value)", () => {
    const options = agentPickerOptions([
      { value: "hostb\nb1", sessionId: "b1", name: "Beta", projectId: null, projectName: null, archived: false, searchText: "Beta" },
      { value: "a1", name: "Alpha", projectId: "p", projectName: "P", archived: false, searchText: "Alpha" },
    ], { top: "当前与最近", independent: "独立", archived: "已归档", chats: "快速对话" }, { top: ["a1"] });
    expect(options.map((o) => o.entity)).toEqual([{ kind: "agent", id: "a1", name: "Alpha" }, { kind: "agent", id: "b1", name: "Beta" }]);
  });

  it("domainEntity: a project keeps its badge and colour; an independent agent is its avatar", () => {
    expect(domainEntity("project", "kks", "kks", "local", { badge_label: "MAST", color: "red", display_name: "kks" })).toEqual({ kind: "project", id: "kks", hostId: "local", badge: "MAST", color: "red" });
    expect(domainEntity("project", "kks", "Kakashi", "local", { badge_label: null, color: "red", display_name: "Kakashi" })).toEqual(expect.objectContaining({ badge: "K" }));
    expect(domainEntity("agent", "s1", "Alice", "local")).toEqual({ kind: "agent", id: "s1", name: "Alice" });
  });
});
