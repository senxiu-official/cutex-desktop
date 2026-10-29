// @vitest-environment jsdom
// Owner 2026-10-23 (fix/0.2-rail-what-you-see): the capsule shows what you'll see when you open it.
// 1. A page made by placement: a pane with nothing for the current agent is neither drawn nor counted in the capsule's
//    icon, name and tooltip (no 「N 个窗格…是空的」 line).
// 2. A page the owner made (kept) or a shared (pinned) one: the empty pane stays as its slot and counts; an icon the
//    owner chose wins.
// 3. Root cause of the owner's screenshot: a follow-the-agent pane (file tree, changes) carried the host it was opened
//    on, so a Shelf copied from the default layout — or one of another host's conversation — held a file tree hidden
//    here (「别处 1 个」). Follow panes now follow the conversation's own host: repaired on load (idempotent, logged),
//    and on every copy / move.
// 4. Pin (owner 2026-10-23): a page's scope works like pinning to the tray — 固定到所有工作区 / 取消固定 in the page
//    menu and a quiet outline pin on the capsule (on hover when unpinned).
// 5. Owner 2026-10-25: a pinned page keeps its kind icon (浏览器 = globe…) with the pin corner always shown (it is
//    also 取消固定); the Shelf's top-left shows the pin while a pinned page (one pane or a group) is in view — no
//    single agent's Shelf. A click there still collapses / expands.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILES = "test.files";
const CHANGES = "test.changes";
const BROWSER = "test.browser";
const icon = (name: string) => () => h("i", { "data-icon": name });
const pass = { parseParams: (p: unknown) => p ?? {}, init: (p: unknown) => p, Body: () => null, useTab: () => ({ title: "" }) };
const SIDE = [
  { mode: "show", moduleId: "test", item: { ...pass, id: FILES, titleKey: "t.files", icon: icon("files"), instances: "singleton", defaultBinding: "follow", placement: { home: "workspace" } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: CHANGES, titleKey: "t.changes", icon: icon("changes"), instances: "singleton", defaultBinding: "follow", placement: { home: "workspace" } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: BROWSER, titleKey: "t.browser", icon: icon("browser"), instances: "multi", defaultBinding: "agent", placement: { home: "browser" } } },
];
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: (slot: string) => (slot === "side.component" ? SIDE : NONE), statuses: () => new Map(), modules: [] }),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, pageAsShown, place, placeSpec, shelvesOf, type SideLayout, type SideViewContext } from "../src/renderer/src/lib/sideLayout";
import { fromTemplate, rebindFollow, renumber } from "../src/renderer/src/lib/convShelves";
import { pageLabel } from "../src/renderer/src/lib/sideActions";
import { pageMenu, togglePagePin } from "../src/renderer/src/lib/shelfMenus";
import { defaultLayout } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { liveConversation, peekConvShelf, resetConvShelves, startSideStore, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { writeConvShelf, writeShelfTemplate } from "../src/renderer/src/lib/paneFile";
import { useApp } from "../src/renderer/src/store";

const { ShelfAvatar, ShelfRail } = await import("../src/renderer/src/components/side/ShelfRail");

let clock = 100;
const follow = (hostId = "local"): SideBinding => ({ kind: "follow", hostId });
const agent = (sessionId: string, hostId = "local"): SideBinding => ({ kind: "agent", hostId, sessionId });
function open(l: SideLayout, kind: string, binding: SideBinding, page?: string): SideLayout {
  const input = { kind: kind as ItemId, binding, key: null, state: {} as never, v: 1, pinned: true };
  const decision = place(l, { ...input, transient: false, page, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "workspace" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "workspace" }).layout;
}
const ctxOf = (hostId: string, sessionId: string): SideViewContext => ({ hostId, sessionId, workspaceKey: null, available: () => true });
const eva = ctxOf("local", "eva");
const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, avatar: null, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;

/** One page: Eva's browser, and a file tree another host's follow binding hides here (the owner's screenshot). */
function screenshotPage(): SideLayout {
  let l = open(emptyLayout(), BROWSER, agent("eva"));
  l = open(l, FILES, follow("remote"), l.pages[0]!.id);
  return l;
}

let root: Root | null = null;
let container: HTMLElement;
function renderRail(layout: SideLayout, ctx: SideViewContext) {
  useSide.setState({ layout });
  const shelf = shelvesOf(layout)[0]!;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(h(ShelfRail, { shelf, pages: layout.pages.filter((p) => p.shelf === shelf.id), shown: layout.pages[0]!.id, ctx })));
  return container.querySelector<HTMLElement>(`[data-shelf-page="${layout.pages[0]!.id}"]`)!;
}

let stop: () => void = () => {};
beforeEach(() => {
  localStorage.clear();
  resetConvShelves();
  useApp.setState({
    selectedId: "eva",
    selectedHost: null,
    hosts: null,
    sidebar: { active: [session("eva", "Eva"), session("bob", "Bob")], retired: [], hostRows: {}, projects: null } as never,
  } as never);
  useSide.setState({ scope: "host:local", layout: emptyLayout(), mode: null, narrow: false, liveWidth: {}, tabInfo: {}, focusedCard: null, revealed: {}, flash: null, peers: {} });
  usePanes.setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "eva" }) });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  stop();
  stop = () => {};
  vi.restoreAllMocks();
});

describe("1. a page made by placement: the capsule is what opens", () => {
  it("leaves the hidden pane out of the icon, name and capsule", () => {
    const l = screenshotPage();
    const page = l.pages[0]!;
    expect(page.cards.map((c) => c.kind).sort()).toEqual([BROWSER, FILES].sort());
    const seen = pageAsShown(l, page, eva);
    expect(seen.cards.map((c) => c.kind)).toEqual([BROWSER]);
    expect(pageLabel(seen)).toBe(pageLabel({ ...page, cards: page.cards.filter((c) => c.kind === BROWSER) }));
    expect(pageLabel(page)).toContain("·");

    const button = renderRail(l, eva);
    // One pane: a single icon (no capsule), the browser's.
    expect(button.hasAttribute("data-shelf-capsule")).toBe(false);
    expect([...button.querySelectorAll("[data-icon]")].map((e) => e.getAttribute("data-icon"))).toEqual(["browser"]);
    expect(button.getAttribute("aria-label")).toBe(pageLabel(seen));
    const tip = button.getAttribute("title")!;
    expect(tip).not.toContain("partlyEmpty");
    expect(tip).not.toContain("hiddenTip");
    expect(tip).not.toContain(pageLabel(page));
  });
});

describe("2. a page the owner made or pinned: the empty slot shows and counts", () => {
  it("kept: both panes in the capsule, the name counts the slot, the tooltip says it is empty", () => {
    let l = screenshotPage();
    l = { ...l, pages: l.pages.map((p) => ({ ...p, kept: true })) };
    const page = l.pages[0]!;
    expect(pageAsShown(l, page, eva)).toBe(page);
    const button = renderRail(l, eva);
    expect(button.hasAttribute("data-shelf-capsule")).toBe(true);
    expect([...button.querySelectorAll("[data-icon]")].map((e) => e.getAttribute("data-icon")).sort()).toEqual(["browser", "files"]);
    // 「有 1 个窗格对这个…是空的」 / "1 pane(s) empty for this …" (lib/hiddenPageNames emptySlotsTip).
    expect(button.getAttribute("title")).toMatch(/empty|空的/);
  });

  it("an icon the owner chose wins over the panes'", () => {
    let l = screenshotPage();
    l = { ...l, pages: l.pages.map((p) => ({ ...p, icon: "globe" as never })) };
    const seen = pageAsShown(l, l.pages[0]!, eva);
    expect(seen.icon).toBe("globe");
  });
});

describe("3. follow-the-agent panes follow the conversation's own host", () => {
  it("rebindFollow: only follow bindings of another host change; idempotent", () => {
    let l = open(emptyLayout(), FILES, follow("remote"));
    l = open(l, BROWSER, agent("bob", "remote"));
    const once = rebindFollow(l, "local");
    expect(once.count).toBe(1);
    const files = Object.values(once.layout.instances).find((i) => i.kind === FILES)!;
    expect(files.binding).toEqual(follow("local"));
    const browser = Object.values(once.layout.instances).find((i) => i.kind === BROWSER)!;
    expect(browser.binding).toEqual(agent("bob", "remote"));
    const twice = rebindFollow(once.layout, "local");
    expect(twice.count).toBe(0);
    expect(twice.layout).toBe(once.layout);
  });

  it("a stored Shelf with another host's file tree is repaired on load (logged once), then shows it", () => {
    stop = startSideStore(() => () => {});
    let own = open(emptyLayout(), FILES, follow("remote"));
    own = open(own, BROWSER, agent("eva"), own.pages[0]!.id);
    own = renumber(own, 600).layout;
    writeConvShelf("host:local", "local|eva", own, { open: true }, null);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    switchConversation("local|eva");
    expect(liveConversation()).toBe("local|eva");
    const live = useSide.getState().layout;
    const files = Object.values(live.instances).find((i) => i.kind === FILES)!;
    expect(files.binding).toEqual(follow("local"));
    expect(pageAsShown(live, live.pages[0]!, eva).cards.map((c) => c.kind).sort()).toEqual([BROWSER, FILES].sort());
    expect(info.mock.calls.filter((c) => String(c[0]).includes("follow its own host"))).toHaveLength(1);
    // Away and back: nothing more to repair.
    switchConversation("local|bob");
    switchConversation("local|eva");
    expect(info.mock.calls.filter((c) => String(c[0]).includes("follow its own host"))).toHaveLength(1);
  });

  it("a new conversation of another host copies the default layout's file tree onto its own host", () => {
    stop = startSideStore(() => () => {});
    const template = open(emptyLayout(), FILES, follow("local"));
    expect(fromTemplate(template, 900).instances).not.toEqual({});
    writeShelfTemplate("host:local", template);
    const copy = peekConvShelf("remote|zed")!;
    const files = Object.values(copy.instances).find((i) => i.kind === FILES)!;
    expect(files.binding).toEqual(follow("remote"));
  });
});

describe("4. pin a page to every conversation", () => {
  it("the page menu says 固定到所有工作区 / 取消固定 and toggles shared", () => {
    stop = startSideStore(() => () => {});
    switchConversation("local|eva");
    useSide.setState({ layout: screenshotPage() });
    const id = useSide.getState().layout.pages[0]!.id;
    const labels = () => pageMenu(id).flatMap((e) => (typeof e === "object" && e && "label" in e ? [String(e.label)] : []));
    expect(labels()).toContain("Pin to all workspaces");
    togglePagePin(id);
    expect(useSide.getState().layout.pages[0]!.shared).toBe(true);
    expect(labels()).toContain("Unpin");
    togglePagePin(id);
    expect(useSide.getState().layout.pages[0]!.shared).toBeFalsy();
  });

  it("the capsule's pin: shown when pinned, on hover otherwise; a click toggles", () => {
    stop = startSideStore(() => () => {});
    switchConversation("local|eva");
    const l = screenshotPage();
    renderRail(l, eva);
    const pin = () => container.querySelector<HTMLButtonElement>("[data-shelf-page-pin]")!;
    expect(pin().getAttribute("aria-pressed")).toBe("false");
    expect(pin().className).toContain("opacity-0");
    expect(pin().className).toContain("group-hover/page:opacity-100");
    act(() => pin().click());
    expect(useSide.getState().layout.pages[0]!.shared).toBe(true);
    // The rail gets its pages from the live layout (SideArea): drawn again with it.
    const next = useSide.getState().layout;
    const shelf = shelvesOf(next)[0]!;
    act(() => root!.render(h(ShelfRail, { shelf, pages: next.pages.filter((p) => p.shelf === shelf.id), shown: next.pages[0]!.id, ctx: eva })));
    expect(pin().getAttribute("aria-pressed")).toBe("true");
    expect(pin().className).toContain("opacity-100");
    expect(pin().hasAttribute("data-shelf-page-shared")).toBe(true);
  });
});

describe("5. a pinned page keeps its kind icon; the Shelf top-left shows the pin", () => {
  it("the Rail: a pinned one-pane page draws its pane's icon and the pin corner, always", () => {
    let l = open(emptyLayout(), BROWSER, agent("eva"));
    l = { ...l, pages: l.pages.map((p) => ({ ...p, shared: true })) };
    const button = renderRail(l, eva);
    expect(button.querySelector("[data-icon=browser]")).not.toBeNull();
    expect(button.querySelector(".lucide-pin")).toBeNull();
    expect(container.querySelector("[data-shelf-page-count]")).toBeNull();
    const pin = container.querySelector<HTMLButtonElement>("[data-shelf-page-pin]")!;
    expect(pin.className).toContain("opacity-100");
    expect(pin.className).not.toContain("opacity-0");
  });

  function renderAvatar(pinned: boolean, owner: { hostId: string; sessionId: string } | null = null) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(h(ShelfAvatar, { shelfId: "s1", owner, collapsed: false, side: "right", pinned })));
    return container.querySelector<HTMLButtonElement>("[data-shelf-avatar]")!;
  }

  it("the Shelf top-left: a pinned page in view shows the pin (not the toggle icon); the tip says pinned", () => {
    const b = renderAvatar(true);
    expect(b.querySelector("[data-shelf-avatar-pinned]")).not.toBeNull();
    expect(b.querySelector(".lucide-panel-right-close")).toBeNull();
    expect(b.title).toContain("Pinned page");
  });

  it("not pinned and no agent: the Shelf toggle icon; an agent: its avatar", () => {
    let b = renderAvatar(false);
    expect(b.querySelector("[data-shelf-avatar-pinned]")).toBeNull();
    expect(b.querySelector(".lucide-panel-right-close")).not.toBeNull();
    act(() => root!.unmount());
    container.remove();
    b = renderAvatar(false, { hostId: "local", sessionId: "eva" });
    expect(b.querySelector("[data-shelf-avatar-pinned]")).toBeNull();
    expect(b.querySelector(".lucide-panel-right-close")).toBeNull();
  });
});
