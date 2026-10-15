// The page buttons' two places (docs/desktop-modules.md §18.3, owner 2026-10-12 方案 A): with the column
// open, a horizontal tab row at its top (components/side/SideTabStrip.tsx) carrying the page actions at
// its right end; with the column closed, the vertical lane (SideLane.tsx) with pills only. Which one is
// shown when is sideFrame's `strip` / `lane` (test/sideFrame.test.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import { applyOpen, emptyLayout, moveInstance, place, placeSpec, type SideLayout } from "../src/renderer/src/lib/sideLayout";

// Server rendering reads a zustand store's initial state; read the live state instead (set below).
vi.mock("zustand", async (importOriginal) => {
  const real = await importOriginal<typeof import("zustand")>();
  type Init = import("zustand").StateCreator<unknown>;
  const wrap = (init: Init) => {
    const store = real.create(init);
    return Object.assign((select: (s: unknown) => unknown = (s) => s) => select(store.getState()), store);
  };
  return { ...real, create: (init?: Init) => (init ? wrap(init) : wrap) };
});
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ closeWarnings: () => [], closeSideInstances: async () => {}, sideReveal: () => {} }));
const registry = new Map([["terminal.pty", { moduleId: "terminal", item: { titleKey: "terminal", icon: () => createElement("svg"), placement: { home: "workspace" } } }]]);
const view = { hostId: "local", sessionId: "A", workspaceKey: "w1", available: () => true };
vi.mock("../src/renderer/src/lib/sideComponents", () => ({
  sideRegistry: () => registry,
  useSideRegistry: () => registry,
  sideViewNow: () => view,
  useSideView: () => view,
  specFrom: () => placeSpec({ home: "workspace" }),
}));
vi.mock("../src/renderer/src/lib/refActions", () => ({ refActionEntries: () => [] }));

const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { SideTabStrip } = await import("../src/renderer/src/components/side/SideTabStrip");
const { SideLane } = await import("../src/renderer/src/components/side/SideLane");

const BINDING: SideBinding = { kind: "agent", hostId: "local", sessionId: "A" };
let clock = 1000;
function open(layout: SideLayout, key: string): { layout: SideLayout; id: string } {
  const spec = placeSpec({ home: "workspace" });
  const decision = place(layout, { kind: "terminal.pty", binding: BINDING, key, transient: false, activePage: layout.activePage, columnOpen: layout.open }, spec, () => 800);
  const applied = applyOpen(layout, decision, { kind: "terminal.pty", binding: BINDING, key, state: null, v: 1, pinned: false }, ++clock, { reveal: true, home: "workspace" });
  return { layout: applied.layout, id: applied.instanceId };
}

let layout: SideLayout;
beforeAll(() => {
  const a = open(emptyLayout(), "t1");
  const b = open(a.layout, "t2");
  layout = { ...moveInstance(b.layout, b.id, { newPage: true }, ++clock, () => 800), open: true };
  useSide.setState({ layout });
});

const strip = () => renderToStaticMarkup(createElement(SideTabStrip, { pages: layout.pages, registry: registry as never, ctx: view }));
const lane = (open = false, actions = false) => renderToStaticMarkup(createElement(SideLane, { pages: layout.pages, open, actions, registry: registry as never, ctx: view }));
const count = (html: string, attr: string) => html.split(attr).length - 1;

describe("the page tab row (column open)", () => {
  it("is a horizontal tab list: one pill per page, grip + one icon per card, then +", () => {
    expect(layout.pages).toHaveLength(2);
    const html = strip();
    expect(html).toContain("data-side-strip");
    expect(html).toContain('aria-orientation="horizontal"');
    expect(html).not.toContain("data-side-lane=");
    expect(count(html, "data-side-pill=")).toBe(2);
    expect(count(html, "data-side-pill-grip=")).toBe(2);
    expect(count(html, "data-side-pill-card=")).toBe(2);
    expect(html).toContain("data-side-tail");
    // The pill in view is the selected tab.
    expect(count(html, 'aria-selected="true"')).toBe(1);
  });

  it("carries the page actions at its right end: ⤢ ⛶ ⋯ and 收起侧栏, after the tabs, hover-only", () => {
    const html = strip();
    const actions = html.indexOf("data-side-page-actions");
    expect(actions).toBeGreaterThan(html.lastIndexOf("data-side-pill="));
    expect(html.indexOf('data-side-page-mode="maximised"')).toBeGreaterThan(actions);
    expect(html.indexOf('data-side-page-mode="fullscreen"')).toBeGreaterThan(actions);
    expect(html.indexOf('aria-label="side.pageMenu"')).toBeGreaterThan(actions);
    // 收起侧栏 is last.
    expect(html.indexOf("data-side-lane-collapse")).toBeGreaterThan(html.indexOf('aria-label="side.pageMenu"'));
    expect(html).toContain("group-hover/strip:opacity-100");
  });
});

describe("the vertical lane (column closed, 仅标签页)", () => {
  it("is pills only: no page actions, no 收起侧栏", () => {
    const html = lane();
    expect(html).toContain("data-side-lane");
    expect(html).toContain('aria-orientation="vertical"');
    expect(count(html, "data-side-pill=")).toBe(2);
    expect(html).not.toContain("data-side-page-actions");
    expect(html).not.toContain("data-side-lane-collapse");
    expect(html).not.toContain("data-side-strip");
  });
});

describe("the vertical lane with 竖条 + 标签页 (owner 2026-10-14)", () => {
  it("beside the open column: the pills from the top, then ⤢ ⛶ ⋯, then 收起侧栏 at the bottom; hover-only, no tab row", () => {
    const html = lane(true, true);
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).not.toContain("data-side-strip");
    const collapse = html.indexOf("data-side-lane-collapse");
    const actions = html.indexOf("data-side-page-actions");
    // No reserved gap above the pills (owner 2026-10-14): the actions come after the last pill.
    expect(actions).toBeGreaterThan(html.lastIndexOf("data-side-pill="));
    expect(html.indexOf('data-side-page-mode="maximised"')).toBeGreaterThan(actions);
    expect(collapse).toBeGreaterThan(html.indexOf('aria-label="side.pageMenu"'));
    expect(count(html, "data-side-pill=")).toBe(2);
    expect(count(html, 'aria-selected="true"')).toBe(1);
    expect(html).toContain("group-hover/lane:opacity-100");
  });

  it("closed: the action slots stay reserved (blank) so the pills do not jump", () => {
    const html = lane(false, true);
    expect(html).toContain("data-side-page-actions");
    expect(html).not.toContain("data-side-lane-collapse");
    expect(html).not.toContain("data-side-page-mode");
    expect(html).not.toContain('aria-label="side.pageMenu"');
    expect(count(html, "data-side-pill=")).toBe(2);
  });
});
