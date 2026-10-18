// @vitest-environment jsdom
// A `tabRow: "always"` side card (the browser, docs/desktop-modules.md §18.4): the tab row shows even
// with one tab, with a ＋ after the last tab that opens a new tab of THIS card (same page, same
// binding). Other kinds keep the old header: a single instance shows its title, no tab row, no ＋.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { Globe } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SideComponentItem } from "../src/renderer/src/modules/slots";

const env = vi.hoisted(() => ({
  registry: new Map<string, { moduleId: string; item: Partial<SideComponentItem> }>(),
  opened: [] as unknown[][],
}));

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({
  openSide: (...args: unknown[]) => { env.opened.push(args); return { status: "opened" }; },
  toggleSideColumn: () => {},
}));
vi.mock("../src/renderer/src/lib/sideComponents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sideRegistry: () => env.registry,
}));

const { SideCardView } = await import("../src/renderer/src/components/side/SideCard");
const { cardNewTabParams } = await import("../src/renderer/src/lib/sideMenus");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { emptyLayout } = await import("../src/renderer/src/lib/sideLayout");
type Layout = ReturnType<typeof emptyLayout>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = { kind: "host" as const, hostId: "host-b" };

function item(extra: Partial<SideComponentItem> = {}): SideComponentItem {
  return {
    titleKey: "browser.title",
    icon: Globe,
    instances: "multi",
    defaultBinding: "host",
    placement: { home: "browser" },
    parseParams: (p) => p,
    init: (p) => p,
    useTab: () => ({ title: "" }),
    Body: () => null,
    launcher: { order: 700, pin: "default", params: () => ({ url: "about:blank" }) },
    ...extra,
  } as SideComponentItem;
}

function layoutWith(tabs: string[], active: string): Layout {
  const layout = emptyLayout();
  layout.open = true;
  layout.activePage = "p1";
  layout.pages = [{ id: "p1", groups: ["browser"], cards: [{ id: "c1", kind: "browser.tab", tabs, active, size: 1, collapsed: false }] }];
  for (const [n, id] of tabs.entries()) layout.instances[id] = { kind: "browser.tab", binding: HOST, key: null, state: { url: "about:blank" }, v: 1, pinned: true, lastActiveAt: n };
  return layout;
}

function render(entry: SideComponentItem, tabs: string[]): HTMLDivElement {
  const layout = layoutWith(tabs, tabs[0]!);
  env.registry = new Map([["browser.tab", { moduleId: "browser", item: entry }]]);
  useSide.setState({ scope: "host:host-b", layout, mode: null, revealed: {}, tabInfo: Object.fromEntries(tabs.map((id) => [id, { title: `page ${id}` }])), flash: null, focusedCard: null });
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  act(() => root.render(h(SideCardView, { page: layout.pages[0]!, card: layout.pages[0]!.cards[0]!, entry: { moduleId: "browser", item: entry } as never,
    tabs, shown: tabs[0]!, height: null, folded: false, single: true, edge: false, currentWidth: () => 400 })));
  return el;
}

beforeEach(() => {
  env.opened = [];
  document.body.innerHTML = "";
});

describe("side card tab row", () => {
  it("shows a one-tab row and a ＋ for a tabRow: always kind", () => {
    const el = render(item({ tabRow: "always" }), ["i1"]);
    expect(el.querySelectorAll("[role=tablist] [role=tab]")).toHaveLength(1);
    expect(el.querySelector("[role=tab]")!.textContent).toContain("page i1");
    expect(el.querySelector("[data-side-new-tab]")!.getAttribute("aria-label")).toBe("side.newTab");
  });

  it("＋ opens the launcher's new params as a tab of this card's page with the shown tab's binding", () => {
    const el = render(item({ tabRow: "always" }), ["i1", "i2"]);
    act(() => (el.querySelector("[data-side-new-tab]") as HTMLButtonElement).click());
    expect(env.opened).toEqual([["browser.tab", { url: "about:blank" }, { page: "p1", binding: HOST, focus: true, reveal: true }]]);
    // The shown tab was touched first, so placement's "most recently used card of the kind" is this card.
    const { instances } = useSide.getState().layout;
    expect(instances.i1!.lastActiveAt).toBeGreaterThan(instances.i2!.lastActiveAt);
  });

  it("keeps the title header (no tab row, no ＋) for other kinds with one instance", () => {
    const el = render(item(), ["i1"]);
    expect(el.querySelector("[role=tablist]")).toBeNull();
    expect(el.querySelector("[data-side-new-tab]")).toBeNull();
    expect(el.textContent).toContain("page i1");
  });

  it("other kinds with several instances get the tab row but no ＋", () => {
    const el = render(item(), ["i1", "i2"]);
    expect(el.querySelectorAll("[role=tab]")).toHaveLength(2);
    expect(el.querySelector("[data-side-new-tab]")).toBeNull();
  });

  it("offers ＋ only for multi kinds with launcher params (newParams first)", () => {
    expect(cardNewTabParams(item({ tabRow: "always" }))).toEqual({ url: "about:blank" });
    expect(cardNewTabParams(item({ tabRow: "always", launcher: { order: 1, pin: "default", params: () => ({ a: 1 }), newParams: () => ({ b: 2 }) } }))).toEqual({ b: 2 });
    expect(cardNewTabParams(item({ tabRow: "always", launcher: { order: 1, pin: "default", params: () => null } }))).toBeNull();
    expect(cardNewTabParams(item({ tabRow: "always", launcher: undefined }))).toBeNull();
    expect(cardNewTabParams(item({ tabRow: "always", instances: "singleton" }))).toBeNull();
    expect(cardNewTabParams(item())).toBeNull();
  });
});
