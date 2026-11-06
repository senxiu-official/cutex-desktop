// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { applyOpen, emptyLayout, locate, place, placeSpec, type SideLayout } from "../src/renderer/src/lib/sideLayout";

const fx = vi.hoisted(() => ({ body: vi.fn(() => null), services: [
  { slug: "books", displayName: "Books" },
  { slug: "hidden", displayName: "Hidden", hidden: true },
  { slug: "archived", displayName: "Archived", archived: true },
] }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async original => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/serviceLinkView", () => ({ useHostServices: () => fx.services }));
vi.mock("../src/renderer/src/modules/browser/BrowserBody", () => ({ BrowserBody: fx.body }));
import browser from "../src/renderer/src/modules/browser";
import { BROWSER_TAB, SERVICE_TAB, initBrowser } from "../src/renderer/src/modules/browser/browserState";
import { ServiceBody } from "../src/renderer/src/modules/browser/ServiceBody";
import { AppWindow } from "lucide-react";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { browserTabInstance, openPopupTab, revealBrowserTab } from "../src/renderer/src/modules/browser/popupOpen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const entries = browser.contributes!["side.component"]!;
const service = entries.find(e => e.id === SERVICE_TAB)!;
const web = entries.find(e => e.id === BROWSER_TAB)!;

function open(layout: SideLayout, kind: typeof service, url: string) {
  const params = kind.parseParams({ url })!;
  const input = { kind: kind.id, binding: { kind: "host" as const, hostId: "local" }, key: null, state: kind.init(params, null), v: 1, pinned: true };
  return applyOpen(layout, place(layout, { ...input, transient: false, activePage: layout.activePage, columnOpen: true }, placeSpec(kind.placement)), input, 1, { reveal: true });
}

describe("the separate service Shelf kind", () => {
  it("uses the single application icon and has a source-picker launcher", () => {
    expect(service.icon).toBe(AppWindow);
    expect(service.titleKey).toBe("browser.service.title");
    expect(service.launcher!.params()).toEqual({ url: "about:blank" });
    expect(service.tabRow).toBe("always");
    expect(web.Body).toBe(fx.body);
  });

  it("keeps normal websites on their browser page and reuses one separate page for services", () => {
    const website = open(emptyLayout(), web, "https://example.com/");
    const first = open(website.layout, service, "cutex:service/books/");
    const second = open(first.layout, service, "cutex:service/weather/");
    expect(first.pageId).not.toBe(website.pageId);
    expect(second.pageId).toBe(first.pageId);
    expect(second.layout.pages).toHaveLength(2);
    expect(locate(second.layout, first.instanceId)!.card.tabs).toEqual([first.instanceId, second.instanceId]);
    expect(second.layout.instances[website.instanceId]!.kind).toBe(BROWSER_TAB);
  });

  it("opens a chosen service in the blank service tab without mounting a blank browser guest", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const setState = vi.fn();
    const state = initBrowser({ url: "about:blank" }, null);
    fx.body.mockClear();
    act(() => root.render(h(ServiceBody, { hostId: "local", instance: { id: "service-picker", state }, setState } as never)));
    expect(fx.body).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Books"]);
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ url: "cutex:service/books/", tabKey: state.tabKey }));
    act(() => root.unmount());
    container.remove();
  });

  it("finds service guests for reveal events and keeps their ordinary external popups in the browser kind", () => {
    const opened = open(emptyLayout(), service, "cutex:service/books/");
    const instance = opened.layout.instances[opened.instanceId]!;
    const key = (instance.state as { tabKey: string }).tabKey;
    useSide.setState({ layout: opened.layout, peers: {} });
    expect(browserTabInstance("local", key)).toBe(opened.instanceId);
    const reveal = vi.fn(() => ({ status: "revealed", instanceId: opened.instanceId, pageId: opened.pageId }));
    const list = (kind: string) => kind === SERVICE_TAB ? [{ id: opened.instanceId, ...instance }] : [];
    expect(revealBrowserTab({ hostId: "local", tabKey: key }, { list, reveal } as never)).toMatchObject({ instanceId: opened.instanceId });
    const popup = vi.fn(() => ({ status: "opened" }));
    openPopupTab({ hostId: "local", tabKey: key, pool: "owner", newTabUrl: "https://example.com/" }, popup as never);
    expect(popup).toHaveBeenCalledWith(BROWSER_TAB, { url: "https://example.com/" }, expect.anything());
    useSide.setState({ layout: emptyLayout() });
  });
});
