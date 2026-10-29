// @vitest-environment jsdom
// Pages are their own panes (owner 2026-10-21; docs/desktop-modules.md §24.4, §26.4): a `main.page` (no Aside)
// opens as its own pane in the focused conversation's Shelf — the page's icon and breadcrumb in the pane's
// header — and the conversation column keeps its conversation (`view` stays). Sidebar entries (runNav), ⌘K
// (services.panes.open "page:<id>"), links / deep links (services.ui.openPage with params) all go there; a page
// already open shows the new params. 页面打开位置 = 占用对话列: the page shows over the conversation column with its
// own page header (components/PageHeader, never the agent's), × / Esc go back to the conversation, ⋯ moves it
// into the Shelf. A full-window page (an Aside) never becomes a pane. The conversation header has no page part.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageParams } from "../src/renderer/src/modules/types";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const env = vi.hoisted(() => ({ rendered: [] as string[] }));
function DemoIcon() {
  return null;
}
function DemoPage({ params }: { params: PageParams }) {
  env.rendered.push(params.item ?? "");
  return h("main", { "data-demo-page": params.item ?? "" }, `demo ${params.item ?? ""}`);
}
const PAGES = [
  { mode: "show", moduleId: "demo", item: { id: "demo.page", Page: DemoPage, useTitle: (p: PageParams) => [{ text: "Demo" }, ...(p.item ? [{ text: p.item }] : [])] } },
  { mode: "show", moduleId: "demo", item: { id: "demo.full", Page: () => null, Aside: () => null, useTitle: () => [{ text: "Full" }] } },
];
const NAV = [{ mode: "show", moduleId: "demo", item: { id: "demo.nav", icon: DemoIcon, titleKey: "pane.page", target: { page: "demo.page", params: { item: "nav" } } } }];
vi.mock("../src/renderer/src/modules/app", async () => {
  const { useApp } = await import("../src/renderer/src/store");
  return {
    appModules: () => ({
      subscribe: () => () => {},
      snapshot: (slot: string) => (slot === "main.page" ? PAGES : slot === "nav.primary" ? NAV : []),
      statuses: () => new Map(),
      modules: [],
      isEnabled: () => true,
    }),
    services: { ui: { openPage: (page: string, params?: PageParams) => useApp.getState().openPage(page as never, params) } },
  };
});
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/renderer/src/modules/react")>();
  return {
    ...real,
    useSlot: (slot: string) => (slot === "main.page" ? PAGES : slot === "nav.primary" ? NAV : []),
    usePageOf: (target: { page: string; params: PageParams } | null) => (target ? { page: target.page, params: target.params, entry: PAGES.find((p) => p.item.id === target.page), waiting: false } : null),
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useApp } = await import("../src/renderer/src/store");
const { setAppearance } = await import("../src/renderer/src/lib/appearance");
const { DEFAULT_APPEARANCE } = await import("../src/renderer/src/lib/appearanceModel");
const { emptyLayout, locate } = await import("../src/renderer/src/lib/sideLayout");
const { useSide } = await import("../src/renderer/src/lib/sideLayoutStore");
const { sideRegistry, sideViewNow } = await import("../src/renderer/src/lib/sideComponents");
const { openPageInShelf, panesOpen } = await import("../src/renderer/src/lib/paneServices");
const { runNav } = await import("../src/renderer/src/lib/navEntries");
const { kindsOnScreen, pageInShelfShown } = await import("../src/renderer/src/lib/pageOpener");
const { runEscChain } = await import("../src/renderer/src/lib/escLayers");
const { PageHeader } = await import("../src/renderer/src/components/PageHeader");
const { useOverlayState } = await import("../src/renderer/src/lib/contextMenu");
const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");

const KIND = "page:demo.page";
const pageInstances = () => Object.entries(useSide.getState().layout.instances).filter(([, i]) => i.kind === KIND);

beforeEach(() => {
  env.rendered = [];
  setAppearance({ pageOpen: DEFAULT_APPEARANCE.pageOpen }, false);
  useApp.setState({ view: { kind: "conversation" }, selectedId: null, selectedHost: null });
  useSide.setState({ scope: "host:local", layout: emptyLayout(), mode: null, revealed: {}, tabInfo: {}, flash: null, focusedCard: null });
});

describe("a page is its own pane in the Shelf (default)", () => {
  it("the default place is the Shelf", () => {
    expect(DEFAULT_APPEARANCE.pageOpen).toBe("shelf");
  });

  it("openPage puts it in the focused conversation's Shelf; the conversation column keeps the conversation; new params reuse it", () => {
    useApp.getState().openPage("demo.page", { item: "profileCedar" });
    expect(useApp.getState().view).toEqual({ kind: "conversation" });
    expect(pageInstances()).toHaveLength(1);
    const [id, inst] = pageInstances()[0]!;
    expect(inst.state).toEqual({ item: "profileCedar" });
    expect(inst.binding.kind).toBe("host");
    expect(locate(useSide.getState().layout, id)).not.toBeNull();
    expect(useSide.getState().layout.open).toBe(true);
    // A deep link with other params: the same pane (single instance) shows them.
    useApp.getState().openPage("demo.page", { item: "other" });
    expect(pageInstances()).toHaveLength(1);
    expect(pageInstances()[0]![1].state).toEqual({ item: "other" });
    expect(kindsOnScreen(useSide.getState().layout, sideViewNow()).has(KIND)).toBe(true);
    // On screen in the Shelf counts as looking at it (an approvals page there: no alert).
    expect(pageInShelfShown("demo.page")).toBe(true);
    expect(pageInShelfShown("demo.full")).toBe(false);
  });

  it("the pane kind has the sidebar entry's icon and name, and the breadcrumb as its title", () => {
    const entry = sideRegistry().get(KIND)!;
    expect(entry.moduleId).toBe("demo");
    expect(entry.item.icon).toBe(DemoIcon);
    expect(entry.item.titleKey).toBe("pane.page");
    expect(entry.item.instances).toBe("singleton");
    expect(entry.item.persist).toBe(false);
    let title = "";
    function Probe() {
      title = entry.item.useTab({ instance: { id: "x", kind: KIND as never, binding: { kind: "host", hostId: "local" }, state: { item: "profileCedar" }, pinned: true }, sessionId: null, hostId: "local" } as never).title;
      return null;
    }
    const div = document.createElement("div");
    const root = createRoot(div);
    act(() => root.render(h(Probe)));
    expect(title).toBe("Demo › profileCedar");
    // Its Body draws the page with the instance's params.
    const Body = entry.item.Body;
    act(() => root.render(h(Body, { instance: { id: "x", kind: KIND, binding: { kind: "host", hostId: "local" }, state: { item: "profileCedar" }, pinned: true } } as never)));
    expect(div.querySelector("[data-page-pane='demo.page'] [data-demo-page='profileCedar']")).not.toBeNull();
    act(() => root.unmount());
    // A full-window page (an Aside) is no pane kind and never goes into a Shelf.
    expect(sideRegistry().has("page:demo.full" as never)).toBe(false);
    expect(openPageInShelf("demo.full" as never, {})).toBeNull();
  });

  it("sidebar entries (runNav) and ⌘K (services.panes.open page:<id>, deep link params) follow it", () => {
    runNav(NAV[0]!.item as never);
    expect(pageInstances()[0]![1].state).toEqual({ item: "nav" });
    const r = panesOpen(KIND, { item: "palette" });
    expect(r.status).toBe("opened");
    if (r.status !== "opened") return;
    expect(r.instanceId).toBe(pageInstances()[0]![0]);
    expect(r.paneId).toBe(locate(useSide.getState().layout, r.instanceId!)!.card.id);
    expect(pageInstances()[0]![1].state).toEqual({ item: "palette" });
    expect(useApp.getState().view.kind).toBe("conversation");
  });
});

describe("页面打开位置 = 占用对话列", () => {
  let root: Root | null = null;
  let div: HTMLDivElement;
  beforeEach(() => {
    setAppearance({ pageOpen: "column" }, false);
    div = document.createElement("div");
    document.body.append(div);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    div.remove();
  });

  it("the page shows over the column (view), not in the Shelf; ⌘K and links too", () => {
    useApp.getState().openPage("demo.page", { item: "p1" });
    expect(useApp.getState().view).toEqual({ kind: "page", page: "demo.page", params: { item: "p1" } });
    expect(pageInstances()).toHaveLength(0);
    const r = panesOpen(KIND, { item: "p2" });
    expect(r.status === "opened" && r.instanceId).toBe(null);
    expect(useApp.getState().view).toEqual({ kind: "page", page: "demo.page", params: { item: "p2" } });
  });

  it("its own page header (icon, breadcrumb, 放大 / × / ⋯); × goes back to the conversation", () => {
    useApp.getState().openPage("demo.page", { item: "p1" });
    root = createRoot(div);
    act(() => root!.render(h(PageHeader, { paneId: "main", page: { page: "demo.page", params: { item: "p1" } }, focused: true, maxed: false, framed: false } as never)));
    const header = div.querySelector<HTMLElement>("[data-page-header='demo.page']")!;
    expect(header).not.toBeNull();
    expect(header.querySelector("[data-page-crumbs]")!.textContent).toBe("Demop1");
    expect(header.querySelector("[data-pane-max]")).not.toBeNull();
    expect(header.querySelector("[data-pane-more]")).not.toBeNull();
    // Never the agent's header.
    expect(div.querySelector("[data-conv-header]")).toBeNull();
    act(() => header.querySelector<HTMLElement>("[data-page-close]")!.click());
    expect(useApp.getState().view).toEqual({ kind: "conversation" });
  });

  it("Esc closes the page over the column (not while typing)", () => {
    useApp.getState().openPage("demo.page", { item: "p1" });
    const input = document.createElement("input");
    div.append(input);
    expect(runEscChain(new KeyboardEvent("keydown", { key: "Escape" }), false)).toBe("close-page");
    expect(useApp.getState().view.kind).toBe("conversation");
    useApp.getState().openPage("demo.page", { item: "p1" });
    const typing = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    input.dispatchEvent(typing);
    expect(runEscChain(typing, false)).not.toBe("close-page");
    expect(useApp.getState().view.kind).toBe("page");
  });

  it("⋯ 在 Shelf 中打开 moves the page into the Shelf", () => {
    useApp.getState().openPage("demo.page", { item: "p1" });
    let menu: ReturnType<typeof useOverlayState>["menu"] = null;
    function MenuProbe() {
      menu = useOverlayState().menu;
      return null;
    }
    root = createRoot(div);
    act(() => root!.render(h("div", null, h(PageHeader, { paneId: "main", page: { page: "demo.page", params: { item: "p1" } }, focused: true, maxed: false, framed: false } as never), h(MenuProbe))));
    act(() => div.querySelector<HTMLElement>("[data-pane-more]")!.click());
    const item = (menu as ReturnType<typeof useOverlayState>["menu"])?.items.find((i) => i !== "separator" && i.label === "pageHeader.openInShelf");
    expect(item).toBeTruthy();
    act(() => void (item as { onSelect(): void }).onSelect());
    expect(useApp.getState().view.kind).toBe("conversation");
    expect(pageInstances()[0]![1].state).toEqual({ item: "p1" });
  });
});

describe("the conversation header has no page part (§26)", () => {
  it("no breadcrumb / page × in components/ConversationHeader; the window bar shows a breadcrumb only for a full-window page", () => {
    const src = (rel: string) => readFileSync(join(__dirname, "../src/renderer/src", rel), "utf8");
    expect(src("components/ConversationHeader.tsx")).not.toMatch(/data-pane-page|PageName|closePanePage|usePageOf/);
    expect(src("components/TitleBar.tsx")).toMatch(/\{fullWindow && \(\s*<div data-window-bar="page"/);
  });
});

describe("新建{{agent}} takes the conversation column (design 038, owner 2026-10-23)", () => {
  it("like 新工作 it covers the focused column whatever 页面打开位置 says; nothing goes into the Shelf", async () => {
    const { NEW_AGENT_PAGE, DRAFT_CHAT_PAGE, isColumnPage } = await import("../src/renderer/src/store");
    expect(isColumnPage(NEW_AGENT_PAGE)).toBe(true);
    expect(isColumnPage(DRAFT_CHAT_PAGE)).toBe(true);
    expect(isColumnPage("demo.page")).toBe(false);
    act(() => useApp.getState().openPage(NEW_AGENT_PAGE));
    expect(useApp.getState().view).toEqual({ kind: "page", page: NEW_AGENT_PAGE, params: {} });
    expect(Object.values(useSide.getState().layout.instances).filter((i) => i.kind === `page:${NEW_AGENT_PAGE}`)).toHaveLength(0);
  });
});
