// @vitest-environment jsdom
// Services ↔ their agents (lib/serviceLink, components/ServiceLinks; canvas principles §7, owner 2026-10-21;
// prototype .claude/preview-workspaces.html #service). Covered: the service pane's 「打开 <owner>」 (when it shows,
// click = side by side, ▾ = 投影 / 替换, a drag source), the conversation header's 「N 个服务」 list (在 Shelf 中打开
// → this conversation's Shelf, linked; 已在 Shelf · 定位), the link badge, 断开 (stays where it is, not a shared
// page, pinned to the tray, undo) and 「和它的智能体一起打开」.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  openRef: vi.fn(async () => true),
  drag: vi.fn(),
  reveal: vi.fn(() => ({ status: "revealed" })),
}));

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});
vi.mock("../src/renderer/src/lib/workspaces", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openRef: fx.openRef,
  startWorkspaceDrag: fx.drag,
}));
vi.mock("../src/renderer/src/lib/sideServices", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sideReveal: fx.reveal,
  sideShowsHost: () => true,
}));

import type { ServiceView, SidebarSnapshot } from "../src/shared/ipc";
import type { ItemId } from "../src/renderer/src/modules/types";
import { services as appServices } from "../src/renderer/src/modules/app";
import { useApp } from "../src/renderer/src/store";
import { I18nProvider } from "../src/renderer/src/i18n";
import { applyOpen, findPage, locate, moveToNewPage, place, placeSpec, shelvesOf, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import * as side from "../src/renderer/src/lib/sideLayoutStore";
import { setTrayPins, type TrayPinRef } from "../src/renderer/src/lib/trayPins";
import { undoShelfToast, useShelfToast, dismissShelfToast } from "../src/renderer/src/lib/shelves";
import {
  openFromHeader,
  openServiceInShelf,
  readWithAgent,
  serviceOwner,
  servicePaneLook,
  servicePanes,
  serviceSlugOf,
  servicesToOpen,
  setWithAgent,
  startServiceWithAgent,
  unlinkServicePane,
  useServiceWithAgent,
  withServiceLink,
} from "../src/renderer/src/lib/serviceLink";
import { parseBrowserParams, restoreBrowser, initBrowser } from "../src/renderer/src/modules/browser/browserState";
import { AgentServices, ServicePaneLink } from "../src/renderer/src/components/ServiceLinks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, name: string) => ({ cutexSessionId: id, displayName: name, formalAgentName: name, avatar: null, lifecycle: "active", runtime: { status: "online" }, native: { threadId: null } });
const SIDEBAR = { active: [session("reader", "reader"), session("director", "cutex-director")], retired: [], hostRows: {}, projects: null } as unknown as SidebarSnapshot;
const svc = (slug: string, displayName: string, owner: string | null, health: ServiceView["health"] = "reachable", port = 8080) => ({ slug, displayName, ownerCutexSessionId: owner, health, port }) as unknown as ServiceView;
const SERVICES = [svc("tingshu", "听书", "reader"), svc("lab", "Lab", "reader", "stopped", 8090), svc("orphan", "Orphan", null), svc("gone", "Gone", "nobody")];

let clock = 100;
/** A service tab put into the live Shelf the way services.side.open does (place → applyOpen), on its own page. */
function putService(slug: string, linked?: string): string {
  let id = "";
  side.updateLayout((l) => {
    const input = { kind: "browser.tab" as ItemId, binding: { kind: "host" as const, hostId: "local" }, key: null, state: { url: `cutex:service/${slug}/`, title: slug, tabKey: "k", ...(linked ? { linked } : {}) } as never, v: 1, pinned: true };
    const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "browser" }));
    const applied = applyOpen(l, decision, input, ++clock, { reveal: true, home: "browser" });
    id = applied.instanceId;
    const right = shelvesOf(applied.layout)[0];
    return right ? moveToNewPage(applied.layout, { instance: id }, right.id, ++clock) : applied.layout;
  });
  return id;
}

describe("pure rules", () => {
  it("a service tab's address → its slug (anything else: none)", () => {
    expect(serviceSlugOf("cutex:service/tingshu/")).toBe("tingshu");
    expect(serviceSlugOf("cutex:service/tingshu/player?ch=12")).toBe("tingshu");
    expect(serviceSlugOf("cutex:service/tingshu")).toBe("tingshu");
    expect(serviceSlugOf("https://example.com/")).toBeNull();
    expect(serviceSlugOf(null)).toBeNull();
  });

  it("the owner is the service's agent while it is still one of the host's agents", () => {
    expect(serviceOwner(SERVICES, SIDEBAR, "tingshu")?.sessionId).toBe("reader");
    expect(serviceOwner(SERVICES, SIDEBAR, "orphan")).toBeNull();
    expect(serviceOwner(SERVICES, SIDEBAR, "gone")).toBeNull();
    expect(serviceOwner(SERVICES, SIDEBAR, "unknown")).toBeNull();
  });

  it("「打开 <owner>」 shows unless there is no owner (or it is gone) or this is the owner's own Shelf; a linked pane shows the link", () => {
    expect(servicePaneLook({ linked: null, owner: "reader", shelfOf: "director" })).toEqual({ kind: "owner", sessionId: "reader" });
    expect(servicePaneLook({ linked: null, owner: null, shelfOf: "director" })).toEqual({ kind: "none" });
    expect(servicePaneLook({ linked: null, owner: "reader", shelfOf: "reader" })).toEqual({ kind: "none" });
    expect(servicePaneLook({ linked: "reader", owner: "reader", shelfOf: "reader" })).toEqual({ kind: "linked", sessionId: "reader" });
  });

  it("the link lives in the browser tab's state: only on a service address, kept on restore, dropped from a plain page", () => {
    expect(parseBrowserParams({ url: "cutex:service/tingshu/", linked: "reader" })).toEqual({ url: "cutex:service/tingshu/", linked: "reader" });
    expect(parseBrowserParams({ url: "https://example.com/", linked: "reader" })).toEqual({ url: "https://example.com/" });
    expect(parseBrowserParams({ url: "cutex:service/tingshu/", linked: "bad id\n" })).toEqual({ url: "cutex:service/tingshu/" });
    expect(initBrowser({ url: "cutex:service/tingshu/", linked: "reader" }, null).linked).toBe("reader");
    const tabKey = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(restoreBrowser({ url: "cutex:service/tingshu/", title: "听书", tabKey, linked: "reader" }, 1)).toMatchObject({ linked: "reader", tabKey });
    expect(restoreBrowser({ url: "https://example.com/", title: "x", tabKey, linked: "reader" }, 1)?.linked).toBeUndefined();
  });

  it("servicePanes finds a service's tabs (host + slug) with their link; withServiceLink sets / removes it in place", () => {
    const layout = {
      instances: {
        a: { kind: "browser.tab", binding: { kind: "host", hostId: "local" }, key: null, state: { url: "cutex:service/tingshu/", linked: "reader" }, v: 1, pinned: true, lastActiveAt: 1 },
        b: { kind: "browser.tab", binding: { kind: "host", hostId: "other" }, key: null, state: { url: "cutex:service/tingshu/" }, v: 1, pinned: true, lastActiveAt: 1 },
        c: { kind: "browser.tab", binding: { kind: "host", hostId: "local" }, key: null, state: { url: "https://x.dev/" }, v: 1, pinned: true, lastActiveAt: 1 },
      },
    } as unknown as SideLayout;
    expect(servicePanes(layout, "local", "tingshu")).toEqual([{ id: "a", linked: "reader" }]);
    const off = withServiceLink(layout, "a", null);
    expect(servicePanes(off, "local", "tingshu")).toEqual([{ id: "a", linked: null }]);
    expect((off.instances.a!.state as Record<string, unknown>).url).toBe("cutex:service/tingshu/");
    expect(withServiceLink(off, "a", null)).toBe(off);
    expect(withServiceLink(layout, "zz", null)).toBe(layout);
  });

  it("和它的智能体一起打开: only the agent's services with the option on that are not in its Shelf yet", () => {
    const on = readWithAgent({ "local\ntingshu": true, "local\nlab": false, junk: true });
    expect(on).toEqual({ "local\ntingshu": true });
    const empty = { instances: {} } as unknown as SideLayout;
    expect(servicesToOpen(SERVICES, on, empty, "local", "reader")).toEqual(["tingshu"]);
    expect(servicesToOpen(SERVICES, {}, empty, "local", "reader")).toEqual([]);
    expect(servicesToOpen(SERVICES, on, empty, "local", "director")).toEqual([]);
    const there = { instances: { a: { kind: "browser.tab", binding: { kind: "host", hostId: "local" }, state: { url: "cutex:service/tingshu/" } } } } as unknown as SideLayout;
    expect(servicesToOpen(SERVICES, on, there, "local", "reader")).toEqual([]);
  });
});

// ── The store: a Shelf per conversation ──────────────────────────────────────────────────────────

let stop: () => void = () => {};
beforeAll(() => {
  useApp.setState({ hosts: null, selectedId: "reader", selectedHost: "local", sidebar: SIDEBAR, services: SERVICES, byHost: {} as never });
  stop = side.startSideStore(() => () => {});
});

const pinned: TrayPinRef[] = [];
const pins = {
  isPinned: (r: TrayPinRef) => pinned.some((p) => p.kind === r.kind && p.key === r.key && p.hostId === r.hostId),
  pin: vi.fn(async (r: TrayPinRef) => {
    pinned.push(r);
    return true;
  }),
  unpin: vi.fn(async (r: TrayPinRef) => {
    const i = pinned.findIndex((p) => p.key === r.key);
    if (i >= 0) pinned.splice(i, 1);
    return true;
  }),
};

/** services.side.open for the browser tab: puts it into the live Shelf like the real one. */
const sideOpen = vi.fn((kind: string, params: unknown) => {
  const p = params as { url: string; linked?: string };
  const slug = serviceSlugOf(p.url)!;
  const id = putService(slug, p.linked);
  return { status: "opened", instanceId: id, where: "card", pageId: null, reused: false } as never;
});

beforeEach(() => {
  pinned.length = 0;
  pins.pin.mockClear();
  pins.unpin.mockClear();
  setTrayPins(pins);
  fx.openRef.mockClear();
  fx.drag.mockClear();
  fx.reveal.mockClear();
  sideOpen.mockClear();
  vi.spyOn(appServices.side, "open").mockImplementation(sideOpen as never);
  useServiceWithAgent.setState({ on: {} });
  dismissShelfToast();
});

describe("断开 and opening into this conversation's Shelf", () => {
  it("在 Shelf 中打开 from the header: into this conversation's Shelf, linked to its agent; there already = 定位", () => {
    useApp.setState({ selectedId: "reader" });
    const before = servicePanes(side.useSide.getState().layout, "local", "tingshu").length;
    expect(openFromHeader("nope", "local", "reader", SERVICES[0]!)).toBe(before ? "located" : "opened");
    const panes = servicePanes(side.useSide.getState().layout, "local", "tingshu");
    expect(panes).toHaveLength(1);
    if (!before) {
      expect(sideOpen).toHaveBeenCalledWith("browser.tab", { url: "cutex:service/tingshu/", linked: "reader" }, expect.objectContaining({ binding: { kind: "host", hostId: "local" } }));
      expect(panes[0]!.linked).toBe("reader");
    }
    sideOpen.mockClear();
    expect(openFromHeader("nope", "local", "reader", SERVICES[0]!)).toBe("located");
    expect(sideOpen).not.toHaveBeenCalled();
    expect(fx.reveal).toHaveBeenCalledWith({ instanceId: panes[0]!.id });
  });

  it("断开: the link goes, the pane stays exactly where it is (not a shared page), the service is pinned; 撤销 undoes both", async () => {
    useApp.setState({ selectedId: "reader" });
    const id = servicePanes(side.useSide.getState().layout, "local", "tingshu")[0]?.id ?? putService("tingshu", "reader");
    side.updateLayout((l) => withServiceLink(l, id, "reader"));
    const where = locate(side.useSide.getState().layout, id)!;
    const pageBefore = side.useSide.getState().layout.pages.map((p) => p.id);
    await unlinkServicePane(id, "local", "tingshu", "听书");
    const after = side.useSide.getState().layout;
    expect(servicePanes(after, "local", "tingshu")).toEqual([{ id, linked: null }]);
    const now = locate(after, id)!;
    expect([now.page.id, now.card.id, now.card.tabs.indexOf(id)]).toEqual([where.page.id, where.card.id, where.card.tabs.indexOf(id)]);
    expect(findPage(after, now.page.id)?.shared).toBeFalsy();
    expect(after.pages.map((p) => p.id)).toEqual(pageBefore);
    expect(pins.pin).toHaveBeenCalledWith({ hostId: "local", kind: "service", key: "tingshu", title: "听书" });
    expect(useShelfToast.getState().toast?.text).toMatch(/听书/);
    undoShelfToast();
    await Promise.resolve();
    expect(servicePanes(side.useSide.getState().layout, "local", "tingshu")).toEqual([{ id, linked: "reader" }]);
    expect(pins.unpin).toHaveBeenCalledTimes(1);
    expect(pinned).toHaveLength(0);
  });

  it("断开 of an already pinned service: no second pin, the undo leaves the pin alone", async () => {
    const id = servicePanes(side.useSide.getState().layout, "local", "tingshu")[0]!.id;
    side.updateLayout((l) => withServiceLink(l, id, "reader"));
    pinned.push({ hostId: "local", kind: "service", key: "tingshu" });
    await unlinkServicePane(id, "local", "tingshu", "听书");
    expect(pins.pin).not.toHaveBeenCalled();
    undoShelfToast();
    expect(pins.unpin).not.toHaveBeenCalled();
  });

  it("unlinked, it is not in another conversation's Shelf; opened there (from the tray) it goes into that Shelf", () => {
    useApp.setState({ selectedId: "reader" });
    const id = servicePanes(side.useSide.getState().layout, "local", "tingshu")[0]!.id;
    side.updateLayout((l) => withServiceLink(l, id, null));
    useApp.setState({ selectedId: "director" });
    expect(side.liveConversation()).toBe("local|director");
    expect(servicePanes(side.useSide.getState().layout, "local", "tingshu")).toEqual([]);
    expect(openServiceInShelf("local", "tingshu")).toBe("opened");
    const there = servicePanes(side.useSide.getState().layout, "local", "tingshu");
    expect(there).toHaveLength(1);
    expect(there[0]!.linked).toBeNull();
    // reader's own Shelf still has its own pane
    useApp.setState({ selectedId: "reader" });
    expect(servicePanes(side.useSide.getState().layout, "local", "tingshu").map((p) => p.id)).toEqual([id]);
  });

  it("和它的智能体一起打开: the owner's workspace opening opens the service in its Shelf (linked) unless it is there; off = nothing", async () => {
    const off = startServiceWithAgent();
    try {
      useApp.setState({ selectedId: "director" });
      await new Promise((r) => setTimeout(r, 5));
      expect(sideOpen).not.toHaveBeenCalled();
      // lab (stopped) is reader's too: on for it only
      setWithAgent("local", "lab", true);
      useApp.setState({ selectedId: "reader" });
      await new Promise((r) => setTimeout(r, 5));
      expect(sideOpen).toHaveBeenCalledTimes(1);
      expect(sideOpen).toHaveBeenCalledWith("browser.tab", { url: "cutex:service/lab/", linked: "reader" }, expect.objectContaining({ focus: false }));
      // already there: not again
      useApp.setState({ selectedId: "director" });
      await new Promise((r) => setTimeout(r, 5));
      useApp.setState({ selectedId: "reader" });
      await new Promise((r) => setTimeout(r, 5));
      expect(sideOpen).toHaveBeenCalledTimes(1);
      // the option is kept per service
      expect(useServiceWithAgent.getState().on).toEqual({ "local\nlab": true });
      setWithAgent("local", "lab", false);
      expect(useServiceWithAgent.getState().on).toEqual({});
    } finally {
      off();
    }
  });
});

// ── Rendered ─────────────────────────────────────────────────────────────────────────────────────

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.querySelectorAll("[data-agent-services]").forEach((e) => e.remove());
});
async function render(node: ReactNode) {
  await act(async () => root.render(h(I18nProvider, null, node)));
}

describe("the service pane's 「打开 <owner>」", () => {
  it("in another conversation's Shelf: 「打开 reader」; click = side by side, a press starts a workspace drag", async () => {
    useApp.setState({ selectedId: "director" });
    await render(h(ServicePaneLink, { hostId: "local", instanceId: "x", url: "cutex:service/tingshu/", linked: null }));
    const btn = container.querySelector<HTMLButtonElement>("[data-service-open-owner]")!;
    expect(btn.textContent).toContain("reader");
    expect(container.querySelector("[data-service-link]")?.getAttribute("data-service-owner")).toBe("reader");
    act(() => void btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
    expect(fx.drag).toHaveBeenCalledWith({ kind: "agent", hostId: "local", key: "reader", title: "reader" }, expect.anything());
    act(() => btn.click());
    expect(fx.openRef).toHaveBeenCalledWith({ kind: "agent", hostId: "local", key: "reader", title: "reader" }, "beside");
  });

  it("▾ offers 投影到这个 Shelf and 替换 (the workspace's agent named)", async () => {
    useApp.setState({ selectedId: "director" });
    const { useOverlayState } = await import("../src/renderer/src/lib/contextMenu");
    let menu: ReturnType<typeof useOverlayState>["menu"] = null;
    function Probe() {
      menu = useOverlayState().menu;
      return null;
    }
    await render([h(ServicePaneLink, { key: "l", hostId: "local", instanceId: "x", url: "cutex:service/tingshu/", linked: null }), h(Probe, { key: "p" })]);
    act(() => container.querySelector<HTMLButtonElement>("[data-service-owner-menu]")!.click());
    const items = (menu as unknown as { items: ({ label: string; onSelect(): void } | "separator")[] }).items.filter((i): i is { label: string; onSelect(): void } => i !== "separator");
    const labels = items.map((i) => i.label);
    expect(labels.some((l) => /cutex-director/.test(l))).toBe(true);
    items[1]!.onSelect();
    expect(fx.openRef).toHaveBeenLastCalledWith(expect.objectContaining({ key: "reader" }), "project");
    items[2]!.onSelect();
    expect(fx.openRef).toHaveBeenLastCalledWith(expect.objectContaining({ key: "reader" }), "replace");
  });

  it("hidden: no owner, the owner gone, the owner's own Shelf, not a service", async () => {
    useApp.setState({ selectedId: "director" });
    await render([
      h(ServicePaneLink, { key: "1", hostId: "local", instanceId: "x", url: "cutex:service/orphan/", linked: null }),
      h(ServicePaneLink, { key: "2", hostId: "local", instanceId: "y", url: "cutex:service/gone/", linked: null }),
      h(ServicePaneLink, { key: "3", hostId: "local", instanceId: "z", url: "https://example.com/", linked: null }),
    ]);
    expect(container.querySelector("[data-service-link]")).toBeNull();
    useApp.setState({ selectedId: "reader" });
    await render(h(ServicePaneLink, { hostId: "local", instanceId: "x", url: "cutex:service/tingshu/", linked: null }));
    expect(container.querySelector("[data-service-link]")).toBeNull();
  });

  it("a linked pane: the agent's avatar badge + 断开 (no 「打开」)", async () => {
    useApp.setState({ selectedId: "reader" });
    await render(h(ServicePaneLink, { hostId: "local", instanceId: "x", url: "cutex:service/tingshu/", linked: "reader" }));
    expect(container.querySelector("[data-service-link]")?.getAttribute("data-service-linked")).toBe("reader");
    expect(container.querySelector("[data-service-link-badge] [data-avatar], [data-service-link-badge] *")).not.toBeNull();
    expect(container.querySelector("[data-service-unlink]")).not.toBeNull();
    expect(container.querySelector("[data-service-open-owner]")).toBeNull();
  });
});

describe("the conversation header's 「N 个服务」", () => {
  it("lists the agent's services with a health dot; 在 Shelf 中打开 or 已在 Shelf · 定位; the with-agent box", async () => {
    useApp.setState({ selectedId: "reader" });
    await render(h(AgentServices, { paneId: "main", hostId: "local", sessionId: "reader", agentName: "reader" }));
    const btn = container.querySelector<HTMLButtonElement>('[data-conv-item="network"]')!;
    expect(btn.textContent).toMatch(/2/);
    act(() => btn.click());
    const pop = document.querySelector("[data-agent-services='reader']")!;
    expect(pop).not.toBeNull();
    const rows = [...pop.querySelectorAll("[data-agent-service]")].map((r) => r.getAttribute("data-agent-service"));
    expect([...rows].sort()).toEqual(["lab", "tingshu"]);
    // tingshu is in reader's Shelf already (the tests above): 定位; lab has no pane yet unless it opened with the agent
    const open = (slug: string) => pop.querySelector(`[data-agent-service="${slug}"] [data-agent-service-open]`)!.getAttribute("data-agent-service-open");
    expect(open("tingshu")).toBe("locate");
    const box = pop.querySelector<HTMLInputElement>('[data-agent-service-with="tingshu"]')!;
    expect(box.checked).toBe(false);
    act(() => box.click());
    expect(useServiceWithAgent.getState().on).toEqual({ "local\ntingshu": true });
  });

  it("在 Shelf 中打开 opens the service linked to this conversation's agent", async () => {
    useApp.setState({ selectedId: "director", services: [...SERVICES, svc("board", "Board", "director")] });
    await render(h(AgentServices, { paneId: "main", hostId: "local", sessionId: "director", agentName: "cutex-director" }));
    act(() => container.querySelector<HTMLButtonElement>('[data-conv-item="network"]')!.click());
    const pop = document.querySelector("[data-agent-services='director']")!;
    const b = pop.querySelector<HTMLButtonElement>('[data-agent-service="board"] [data-agent-service-open]')!;
    expect(b.getAttribute("data-agent-service-open")).toBe("open");
    act(() => b.click());
    expect(sideOpen).toHaveBeenCalledWith("browser.tab", { url: "cutex:service/board/", linked: "director" }, expect.anything());
    expect(servicePanes(side.useSide.getState().layout, "local", "board")[0]?.linked).toBe("director");
    useApp.setState({ services: SERVICES });
  });

  it("compact services retain the accessible label, Globe, health and working popover", async () => {
    await render(h(AgentServices, { paneId: "main", hostId: "local", sessionId: "reader", agentName: "reader", compact: true }));
    const button = container.querySelector<HTMLButtonElement>('[data-conv-item="network"]')!;
    expect(button.textContent).toBe("2");
    expect(button.getAttribute("aria-label")).toMatch(/2/);
    expect(button.querySelector("svg.lucide-server")).not.toBeNull();
    expect(button.querySelector("[data-svc-health]")).not.toBeNull();
    act(() => button.click());
    expect(document.querySelectorAll('[data-agent-services="reader"] [data-agent-service]')).toHaveLength(2);
  });

  // Owner 2026-10-25: 16 services ran off the bottom of the window (lib/servicesPopover).
  const many = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? ({ ...svc("st", "Static", "director", "reachable", 0), runtime: "static" } as ServiceView) : svc(`m${i}`, `M ${i}`, "director", "reachable", 9000 + i)));
  const view = (w: number, hgt: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: hgt });
  };
  const openMany = async (n: number) => {
    useApp.setState({ selectedId: "director", services: [...SERVICES, ...many(n)] });
    await render(h(AgentServices, { paneId: "main", hostId: "local", sessionId: "director", agentName: "cutex-director" }));
    act(() => container.querySelector<HTMLButtonElement>('[data-conv-item="network"]')!.click());
    return document.querySelector<HTMLElement>("[data-agent-services='director']")!;
  };

  it("many services in a wide window: capped height, two columns, paged (‹ 1/2 ›, PageUp / PageDown)", async () => {
    view(1440, 700);
    const pop = await openMany(40);
    expect(pop.dataset.servicesColumns).toBe("2");
    expect(parseFloat(pop.style.maxHeight)).toBeLessThanOrEqual(700 - 8);
    expect(pop.querySelector("[data-agent-services-list]")!.className).toMatch(/overflow-y-auto/);
    const first = pop.querySelectorAll("[data-agent-service]").length;
    expect(first).toBeLessThan(40);
    expect(pop.dataset.servicesPage).toBe(`1/${Math.ceil(40 / first)}`);
    // The compact row: 和它的智能体一起打开 is an icon toggle with a tooltip.
    const toggle = pop.querySelector<HTMLButtonElement>('[data-agent-service-with="m1"]')!;
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.title).not.toBe("");
    act(() => toggle.click());
    expect(useServiceWithAgent.getState().on["local\nm1"]).toBe(true);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", cancelable: true })));
    expect(pop.dataset.servicesPage).toBe(`2/${Math.ceil(40 / first)}`);
    expect(pop.querySelector('[data-agent-service="m1"]')).toBeNull();
    act(() => pop.querySelector<HTMLButtonElement>("[data-services-prev]")!.click());
    expect(pop.dataset.servicesPage).toBe(`1/${Math.ceil(40 / first)}`);
    expect(pop.querySelector<HTMLButtonElement>("[data-services-prev]")!.disabled).toBe(true);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", cancelable: true })));
    expect(pop.dataset.servicesPage).toBe(`1/${Math.ceil(40 / first)}`);
  });

  it("a narrow window: one column of every service, scrolling under the fixed header", async () => {
    view(500, 600);
    const pop = await openMany(16);
    expect(pop.dataset.servicesColumns).toBe("1");
    expect(pop.dataset.servicesPage).toBeUndefined();
    expect(pop.querySelector("[data-agent-services-pager]")).toBeNull();
    expect(pop.querySelectorAll("[data-agent-service]")).toHaveLength(16);
    expect(parseFloat(pop.style.maxHeight)).toBeLessThanOrEqual(600 - 8);
    expect(parseFloat(pop.style.width)).toBeLessThanOrEqual(500 - 16);
  });

  it("a static service's status has no dangling 「 · :」", async () => {
    view(1024, 768);
    const pop = await openMany(3);
    const status = (slug: string) => pop.querySelector(`[data-agent-service="${slug}"] [data-agent-service-status]`)!.textContent;
    expect(status("st")).not.toMatch(/:\s*$|· :/);
    expect(status("st")).not.toContain(":");
    expect(status("m1")).toMatch(/· :9001$/);
    useApp.setState({ services: SERVICES });
  });

  it("an agent without services: nothing", async () => {
    await render(h(AgentServices, { paneId: "main", hostId: "local", sessionId: "solo", agentName: "x" }));
    expect(container.querySelector('[data-conv-item="network"]')).toBeNull();
  });
});

afterAll(() => stop());
