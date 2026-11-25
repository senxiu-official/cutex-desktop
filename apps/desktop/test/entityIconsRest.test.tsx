// @vitest-environment jsdom
// Entity icons, second pass (owner 2026-11-25): selects that name projects / agents / Profiles are the searchable
// picker with icons (components/EntitySelect, keeping a select's keys); names in running text carry an inline icon
// (EntityMention via lib/textNodes); long lists mount their icons in steps (lib/useStagger); the board window draws
// the project's own icon (shared/boardModel badge + icon, components/ProjectBadgeView).
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@cutex-desktop/protocol";
import { EntitySelect } from "../src/renderer/src/components/EntitySelect";
import { SearchablePickerBody } from "../src/renderer/src/components/SearchablePicker";
import { ProjectBadgeView } from "../src/renderer/src/components/ProjectBadgeView";
import { tNodes } from "../src/renderer/src/lib/textNodes";
import { EAGER_ICONS, ICON_CHUNK, useStaggeredCount } from "../src/renderer/src/lib/useStagger";
import type { EntitySelectOption } from "../src/renderer/src/lib/entityIcon";
import { buildBoard, type BoardHostInput } from "../src/shared/boardModel";
import { demoBoardProjects } from "../src/main/boardDemo";

// The icon itself (agent looks, Profile pictures) is covered elsewhere; here it is a marked span.
vi.mock("../src/renderer/src/components/EntityIcon", () => import("./helpers/entityIconStub"));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ locale: "en", t: (k: string) => k }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

const OPTIONS: EntitySelectOption[] = [
  { value: "", label: "Choose…" },
  { value: "a", label: "Alice", entity: { kind: "agent", id: "a", name: "Alice" } },
  { value: "aria", label: "Aria", entity: { kind: "agent", id: "aria", name: "Aria" } },
  { value: "b", label: "Bob", entity: { kind: "agent", id: "b", name: "Bob" }, disabled: true },
  { value: "c", label: "Cara", entity: { kind: "agent", id: "c", name: "Cara" } },
];

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return h("form", null, h(EntitySelect, { value, options: OPTIONS, label: "Member", testId: "member", onChange: (v: string) => { setValue(v); onChange?.(v); } }));
}
const trigger = () => host.querySelector<HTMLButtonElement>("[data-testid=member]")!;
const rows = () => [...document.querySelectorAll<HTMLButtonElement>("[role=option][data-value]")];
const key = (k: string, init: KeyboardEventInit = {}) => act(() => { trigger().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init })); });

describe("EntitySelect", () => {
  it("is a select-only combobox in the form (no submit): named by the field, its value the chosen option's icon and label", () => {
    act(() => root.render(h(Harness, { initial: "a" })));
    const b = trigger();
    expect(b.type).toBe("button");
    expect(b.getAttribute("role")).toBe("combobox");
    expect(b.getAttribute("aria-label")).toBe("Member");
    expect(b.getAttribute("aria-haspopup")).toBe("listbox");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.dataset.value).toBe("a");
    expect(b.textContent).toBe("Alice");
    expect(b.querySelector("[data-entity-icon=agent]")?.getAttribute("data-entity-id")).toBe("a");
  });

  it("closed-trigger keys step like a native select and skip disabled options", () => {
    const changes: string[] = [];
    act(() => root.render(h(Harness, { initial: "aria", onChange: (v) => changes.push(v) })));
    key("ArrowDown");
    expect(trigger().dataset.value).toBe("c"); // Bob is disabled
    key("ArrowDown");
    expect(trigger().dataset.value).toBe("c"); // stays at the end
    key("Home");
    expect(trigger().dataset.value).toBe("");
    key("End");
    expect(trigger().dataset.value).toBe("c");
    key("ArrowLeft");
    expect(trigger().dataset.value).toBe("aria");
    expect(changes).toEqual(["c", "", "c", "aria"]);
    expect(rows()).toHaveLength(0); // none of them opened the list
  });

  it("type-ahead: a prefix within the window, a repeated letter cycles", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    act(() => root.render(h(Harness)));
    key("a");
    expect(trigger().dataset.value).toBe("a");
    now += 100; key("r");
    expect(trigger().dataset.value).toBe("aria"); // "ar"
    now += 2000; key("a");
    expect(trigger().dataset.value).toBe("a"); // new prefix, cycles past Aria to Alice
    now += 100; key("a");
    expect(trigger().dataset.value).toBe("aria");
    now += 2000; key("b");
    expect(trigger().dataset.value).toBe("aria"); // only a disabled match: unchanged
  });

  it("Alt+↓ opens the list on the current option; picking closes it, changes the value and refocuses the trigger", () => {
    const changes: string[] = [];
    act(() => root.render(h(Harness, { initial: "a", onChange: (v) => changes.push(v) })));
    key("ArrowDown", { altKey: true });
    expect(rows().map((r) => r.dataset.value)).toEqual(["", "a", "aria", "b", "c"]);
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => r.dataset.value)).toEqual(["a"]);
    expect(rows().find((r) => r.dataset.value === "b")!.disabled).toBe(true);
    expect(rows().find((r) => r.dataset.value === "c")!.querySelector("[data-entity-icon=agent]")).not.toBeNull();
    act(() => rows().find((r) => r.dataset.value === "c")!.click());
    expect(changes).toEqual(["c"]);
    expect(rows()).toHaveLength(0);
    expect(trigger().dataset.value).toBe("c");
    expect(document.activeElement).toBe(trigger());
  });

  it("picking the current option again is not a change", () => {
    const onChange = vi.fn();
    act(() => root.render(h(Harness, { initial: "a", onChange })));
    act(() => trigger().click());
    act(() => rows().find((r) => r.dataset.value === "a")!.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled: does not open or step", () => {
    act(() => root.render(h(EntitySelect, { value: "a", options: OPTIONS, label: "Member", testId: "member", disabled: true, onChange: () => { throw new Error("changed"); } })));
    expect(trigger().disabled).toBe(true);
    act(() => trigger().click());
    expect(rows()).toHaveLength(0);
  });
});

describe("EntitySelect boundaries (review of 5a29fcb0)", () => {
  const open = () => { key("ArrowDown", { altKey: true }); return document.querySelector<HTMLInputElement>("input[data-menu-search]")!; };
  const escape = (el: Element) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  it("Escape returns focus to the select trigger", () => {
    act(() => root.render(h(Harness, { initial: "a" })));
    const search = open();
    expect(document.activeElement).toBe(search);
    escape(search);
    expect(rows()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });
  it("Escape from the picker does not reach a surrounding dialog form", () => {
    const closeDialog = vi.fn();
    act(() => root.render(h("form", { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") closeDialog(); } }, h(EntitySelect, {
      value: "a", options: OPTIONS, label: "Member", testId: "member", onChange() {},
    }))));
    const search = open();
    escape(search);
    expect(closeDialog).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
    // Closed, Escape is the dialog's again (as on a native select).
    escape(trigger());
    expect(closeDialog).toHaveBeenCalledOnce();
  });
  it("Escape on an option row (focus moved off the search field) also closes only the popup", () => {
    const closeDialog = vi.fn();
    act(() => root.render(h("form", { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") closeDialog(); } }, h(EntitySelect, {
      value: "a", options: OPTIONS, label: "Member", testId: "member", onChange() {},
    }))));
    open();
    const row = rows().find((r) => r.dataset.value === "c")!;
    act(() => row.focus());
    escape(row);
    expect(closeDialog).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
  });
  it("inside an open native <dialog> (where the Popover's own Escape handler stands down) the picker still closes, the dialog stays", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const cancel = vi.fn(() => dialog.removeAttribute("open"));
    dialog.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented) cancel(); });
    host.append(dialog);
    const inner = createRoot(dialog);
    act(() => inner.render(h(EntitySelect, { value: "a", options: OPTIONS, label: "Member", testId: "member", onChange() {} })));
    act(() => dialog.querySelector<HTMLButtonElement>("[data-testid=member]")!.click());
    const search = document.querySelector<HTMLInputElement>("input[data-menu-search]")!;
    escape(search);
    expect(cancel).not.toHaveBeenCalled();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(rows()).toHaveLength(0);
    expect(document.activeElement).toBe(dialog.querySelector("[data-testid=member]"));
    act(() => inner.unmount());
  });
  it("the selectable popup owns its options through a listbox", () => {
    act(() => root.render(h(Harness, { initial: "a" })));
    open();
    expect(rows()).not.toHaveLength(0);
    for (const option of rows()) expect(option.closest('[role="listbox"]')).not.toBeNull();
  });
  it("ARIA: trigger controls the listbox; the search field is the editable combobox naming the active option", () => {
    act(() => root.render(h(Harness, { initial: "a" })));
    const search = open();
    const listbox = document.querySelector<HTMLElement>("[role=listbox]")!;
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(listbox.id);
    expect(search.getAttribute("role")).toBe("combobox");
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(search.getAttribute("aria-autocomplete")).toBe("list");
    expect(search.getAttribute("aria-controls")).toBe(listbox.id);
    expect(search.getAttribute("aria-activedescendant")).toBe(rows().find((r) => r.dataset.value === "a")!.id);
    act(() => { search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(search.getAttribute("aria-activedescendant")).toBe(rows().find((r) => r.dataset.value === "aria")!.id);
    // The chosen value stays the selected option while the active one moves.
    expect(rows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => r.dataset.value)).toEqual(["a"]);
    expect(rows().find((r) => r.dataset.value === "b")!.getAttribute("aria-disabled")).toBe("true");
    expect(listbox.getAttribute("aria-label")).toBe("Member");
  });
  it("a long popup eagerly mounts only the first icon chunk and cancels its pending frame on close", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    const options = Array.from({ length: 200 }, (_, i) => ({ value: String(i), label: `Member ${i}`, entity: { kind: "agent" as const, id: String(i), name: `Member ${i}` } }));
    act(() => root.render(h(EntitySelect, { value: "199", options, label: "Member", testId: "member", onChange() {} })));
    open();
    expect(rows()).toHaveLength(200);
    expect(document.querySelectorAll("[data-popover] [data-entity-icon]")).toHaveLength(EAGER_ICONS);
    expect(vi.getTimerCount()).toBe(1);
    act(() => trigger().click());
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("SearchableSelect and flyouts", () => {
  it("SearchableSelect: the same combobox; Escape closes only its popup and refocuses it", async () => {
    const { SearchableSelect } = await import("../src/renderer/src/components/SearchablePicker");
    const closeDialog = vi.fn();
    act(() => root.render(h("form", { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") closeDialog(); } },
      h(SearchableSelect, { value: "x", label: "Agent", placeholder: "Search", emptyLabel: "None", onChange() {}, options: [{ value: "x", label: "X", group: "" }, { value: "y", label: "Y", group: "" }] }))));
    const b = host.querySelector<HTMLButtonElement>("button[role=combobox]")!;
    expect(b.getAttribute("aria-haspopup")).toBe("listbox");
    act(() => b.click());
    expect(b.getAttribute("aria-controls")).toBe(document.querySelector("[role=listbox]")!.id);
    act(() => { document.querySelector("input[data-menu-search]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(closeDialog).not.toHaveBeenCalled();
    expect(document.querySelector("[role=listbox]")).toBeNull();
    expect(document.activeElement).toBe(b);
  });
  it("a body without onDismiss (a context-menu flyout) leaves Escape to its menu", () => {
    const menuEscape = vi.fn();
    act(() => root.render(h("div", { onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Escape") menuEscape(); } },
      h(SearchablePickerBody, { label: "Agents", placeholder: "Search", emptyLabel: "None", onPick: () => {}, options: [{ value: "x", label: "X", group: "" }] }))));
    act(() => { host.querySelector("input[data-menu-search]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(menuEscape).toHaveBeenCalledOnce();
  });
});

describe("picker group header", () => {
  it("a group naming a project shows its icon before the header; other groups stay text", () => {
    act(() => root.render(h(SearchablePickerBody, {
      label: "Agents", placeholder: "Search", emptyLabel: "None", onPick: () => {},
      options: [
        { value: "x", label: "X", group: "Waveline", groupEntity: { kind: "project", id: "p1", hostId: "local" } },
        { value: "y", label: "Y", group: "独立" },
      ],
    })));
    // Listbox groups, labelled by their headers.
    const groups = [...host.querySelectorAll<HTMLElement>("[role=listbox] > [role=group]")];
    expect(groups.map((g) => host.querySelector(`#${CSS.escape(g.getAttribute("aria-labelledby")!)}`)?.textContent)).toEqual(["Waveline", "独立"]);
    expect(groups.map((g) => [...g.querySelectorAll("[role=option]")].map((o) => o.getAttribute("data-value")))).toEqual([["x"], ["y"]]);
    const headers = [...host.querySelectorAll("[data-entity-mention]")];
    expect(headers).toHaveLength(1);
    expect(headers[0]!.textContent).toBe("Waveline");
    expect(headers[0]!.querySelector("[data-entity-icon=project]")?.getAttribute("data-entity-id")).toBe("p1");
    expect(host.textContent).toContain("独立");
  });
});

describe("tNodes", () => {
  const t = (key: string, vars?: Record<string, string | number>) => key === "k" ? `由 ${vars!.name} 发起（${vars!.n} 次）` : `${key} ${JSON.stringify(vars)}`;
  it("formats strings as usual and puts nodes in their slots", () => {
    const out = tNodes(t as never, "k" as never, { name: h("b", null, "eva"), n: 2 });
    expect(renderToStaticMarkup(h("p", null, out))).toBe("<p>由 <b>eva</b> 发起（2 次）</p>");
    expect(tNodes(t as never, "k" as never, { name: "eva", n: 2 })).toBe("由 eva 发起（2 次）");
  });
  it("a translator that JSON-encodes its variables (a test double) keeps the slot", () => {
    const out = tNodes(t as never, "other" as never, { name: h("b", null, "eva") });
    expect(renderToStaticMarkup(h("p", null, out))).toContain("<b>eva</b>");
  });
});

describe("EntityMention", () => {
  it("no entity: only the text; an entity: icon box sized to the text, kept with the name", async () => {
    const { EntityMention } = await vi.importActual<typeof import("../src/renderer/src/components/EntityIcon")>("../src/renderer/src/components/EntityIcon");
    expect(renderToStaticMarkup(h(EntityMention, { entity: null, children: "eva" }))).toBe("eva");
    const html = renderToStaticMarkup(h(EntityMention, { entity: { kind: "project", id: "p1", hostId: "local", badge: "W", color: "blue" }, children: "Waveline" }));
    expect(html).toMatch(/^<span data-entity-mention="project" class="whitespace-nowrap[^"]*"><span class="[^"]*h-\[0\.9em\][^"]*align-middle[^"]*">/);
    expect(html).toContain("Waveline");
  });
});

describe("useStaggeredCount", () => {
  function List({ total, enabled = true }: { total: number; enabled?: boolean }): ReactNode {
    const n = useStaggeredCount(total, enabled);
    return h("i", { "data-n": Math.min(n, total) });
  }
  const shown = () => Number(host.querySelector("i")!.getAttribute("data-n"));
  it("the first rows at once, then a chunk per frame until all; disabled stays at the first rows", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    act(() => root.render(h(List, { total: 200 })));
    expect(shown()).toBe(EAGER_ICONS);
    act(() => vi.advanceTimersToNextFrame());
    expect(shown()).toBe(EAGER_ICONS + ICON_CHUNK);
    for (let i = 0; i < 5; i++) act(() => vi.advanceTimersToNextFrame());
    expect(shown()).toBe(200);
    expect(vi.getTimerCount()).toBe(0); // done: no frame left scheduled
    act(() => root.render(h(List, { total: 200, enabled: false, key: "off" })));
    act(() => vi.advanceTimersToNextFrame());
    expect(shown()).toBe(EAGER_ICONS);
  });
  it("a short list schedules nothing", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    act(() => root.render(h(List, { total: 12 })));
    expect(shown()).toBe(12);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("board window project icon", () => {
  const summary = (id: string, presentation: ProjectSummary["presentation"]): ProjectSummary => ({ project_id: id, authority_epoch: 1, director_cutex_session_id: null, presentation, active_member_count: 0, lifecycle: "active" });
  const input = (projects: ProjectSummary[]): BoardHostInput => ({
    hostId: "eva", label: "EVA", state: "connected", readAt: 0, features: null,
    sidebar: { active: [], retired: [], projects: { schema: "x", projects }, hostRows: {} },
    openAsks: [], closedAsks: [], notifications: [], approvals: [], services: [], quotaOut: [],
  });
  it("carries the badge (label, else the name's first letter) and the host-stored icon", () => {
    const board = buildBoard([input([
      summary("p1", { display_name: "Waveline", badge_label: "WV", color: "green", icon: { kind: "emoji", value: "🌊" } }),
      summary("p2", { display_name: "storm", badge_label: "", color: "cyan" }),
    ])], 0);
    const byName = new Map(board.map((p) => [p.name, p]));
    expect(byName.get("Waveline")).toMatchObject({ badge: "WV", icon: { kind: "emoji", value: "🌊" } });
    expect(byName.get("storm")).toMatchObject({ badge: "s", icon: null });
    expect(demoBoardProjects().find((p) => p.name === "STORM II 美术")?.icon).toEqual({ kind: "icon", value: "palette" });
  });
  it("ProjectBadgeView draws without the app's prefs: emoji, lucide icon, or the letters in the project tone", () => {
    expect(renderToStaticMarkup(h(ProjectBadgeView, { icon: { kind: "emoji", value: "🌊" }, badge: "W", hex: "#22c55e" }))).toContain("🌊");
    expect(renderToStaticMarkup(h(ProjectBadgeView, { icon: { kind: "icon", value: "palette" }, badge: "S", hex: "#06b6d4" }))).toContain("<svg");
    const letters = renderToStaticMarkup(h(ProjectBadgeView, { badge: "cu", hex: "#3b82f6", line: true }));
    expect(letters).toContain(">cu<");
    expect(letters).toContain('data-icon-style="line"');
    expect(letters).toContain("--project-icon-color:#3b82f6");
  });
});

describe("settings Select", () => {
  it("options naming entities make it the picker (named, reports the change); plain options keep the native select", async () => {
    const { Select } = await import("../src/renderer/src/components/settings/Form");
    const onChange = vi.fn();
    act(() => root.render(h(Select, { value: "a", label: "Default Profile", onChange, options: [{ value: "a", label: "Alpha", entity: { kind: "profile", ref: "a" } }, { value: "b", label: "Beta", entity: { kind: "profile", ref: "b" } }] })));
    const b = host.querySelector<HTMLButtonElement>("[data-entity-select]")!;
    expect(host.querySelector("select")).toBeNull();
    expect(b.getAttribute("aria-label")).toBe("Default Profile");
    expect(b.querySelector("[data-entity-icon=profile]")?.getAttribute("data-entity-id")).toBe("a");
    act(() => { b.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
    act(() => root.render(h(Select, { value: "a", label: "Mode", onChange, options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] })));
    expect(host.querySelector("[data-entity-select]")).toBeNull();
    expect(host.querySelector("select")?.getAttribute("aria-label")).toBe("Mode");
  });
});
