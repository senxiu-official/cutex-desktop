// @vitest-environment jsdom
// Main refused an automatic top-level navigation into a private origin (BrowserTabView.blockedNavigation): the tab keeps
// its page and shows one quiet line; 仍然打开 (only when main allows it) hands main back the refusal id, never a URL.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserTabView } from "../src/shared/browser";
import type { HostsState } from "../src/shared/hosts";

const fakes = vi.hoisted(() => {
  const pending = () => new Promise<never>(() => {});
  const hostApi = { open: vi.fn(pending), close: vi.fn(async () => {}), list: vi.fn(async () => []), navigate: vi.fn(pending), back: vi.fn(pending), forward: vi.fn(pending),
    reload: vi.fn(pending), stop: vi.fn(pending), holdReady: vi.fn(async () => {}), releaseLease: vi.fn(async () => {}), setZoom: vi.fn(async () => {}),
    openBlockedNavigation: vi.fn(async (_tabKey: string, _id: string) => {}) };
  const browser = { setEnabled: vi.fn(async () => {}), forHost: vi.fn((_host: string) => hostApi), subscribe: vi.fn(() => () => {}) };
  return { hostApi, browser, state: { hosts: null as HostsState | null }, bridge: { browser: browser as typeof browser | undefined, api: { openExternal: vi.fn() } } };
});
vi.mock("../src/renderer/src/bridge", () => ({ bridge: fakes.bridge }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => vars ? `${key}(${Object.values(vars).join(",")})` : key }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useModulePref: (_id: string, _key: string, fallback: unknown) => [fallback, vi.fn()] }));
vi.mock("../src/renderer/src/store", () => ({
  sidebarOf: () => null,
  useApp: Object.assign((select: (state: typeof fakes.state) => unknown) => select(fakes.state), { getState: () => fakes.state, subscribe: () => () => {} }),
}));

import { browserCache, createBrowserCache } from "../src/renderer/src/modules/browser/browserCache";
import { browserActivation } from "../src/renderer/src/modules/browser/activation";
import { blockedNavigationHost, sanitizeBlockedNavigation } from "../src/renderer/src/modules/browser/blockedNavigation";
import { BrowserBlockedNavigation } from "../src/renderer/src/modules/browser/BrowserBlockedNavigation";
import { BrowserBody } from "../src/renderer/src/modules/browser/BrowserBody";
import { BROWSER_TAB, type BrowserState } from "../src/renderer/src/modules/browser/browserState";
import type { SideBodyProps } from "../src/renderer/src/modules/slots";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const blocked = { id: "refusal-1", url: "http://10.0.0.20:8123/lovelace/0?kiosk", canOpen: true };
const view = (over: Partial<BrowserTabView> = {}): BrowserTabView => ({ hostId: "ssh-other", guestId: "guest-1", tabKey: "instance-1", pageGeneration: 1, url: "http://localhost:8080/",
  title: "Page", loading: false, canGoBack: false, canGoForward: false, status: "attached", ...over });
const props = (): SideBodyProps<BrowserState> => ({ hostId: "ssh-other", sessionId: null, instance: { id: "scope-local-id", kind: BROWSER_TAB, binding: { kind: "host", hostId: "ssh-other" },
  state: { url: "http://localhost:8080/", title: "Page", tabKey: "instance-1" }, pinned: false }, setState: vi.fn(), visible: true, active: true, mode: "normal", where: "card", revealed: 0,
  close: vi.fn(), open: vi.fn(), keepMounted: vi.fn(() => false), held: false, keep: vi.fn() } as never);
const hosts = (): HostsState => ({ active: "local", hosts: [{ id: "local", conn: { epoch: "focus-epoch" } }, { id: "ssh-other", conn: { epoch: "epoch" } }] }) as never;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  fakes.state = { hosts: hosts() };
  browserCache.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const q = (selector: string) => container.querySelector<HTMLElement>(selector);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
function deferred() { let resolve!: () => void, reject!: (e: unknown) => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe("blocked navigation state", () => {
  it("an explicit null clears it, an absent field keeps it for the same guest, a new guest starts without", () => {
    const cache = createBrowserCache();
    cache.update(view({ blockedNavigation: blocked }));
    expect(cache.get("ssh-other", "instance-1")?.blockedNavigation).toEqual(blocked);
    cache.update(view({ pageGeneration: 2 }));
    expect(cache.get("ssh-other", "instance-1")?.blockedNavigation).toEqual(blocked);
    cache.update(view({ pageGeneration: 3, blockedNavigation: null }));
    expect(cache.get("ssh-other", "instance-1")?.blockedNavigation).toBeUndefined();
    cache.update(view({ pageGeneration: 4, blockedNavigation: blocked }));
    cache.update(view({ guestId: "guest-2", pageGeneration: 1 }));
    expect(cache.get("ssh-other", "instance-1")?.blockedNavigation).toBeUndefined();
  });
  it("drops malformed values and shows the host, the full URL as hover text", () => {
    expect(sanitizeBlockedNavigation({ id: "", url: "http://a/", canOpen: true })).toBeNull();
    expect(sanitizeBlockedNavigation({ id: "x".repeat(201), url: "http://a/", canOpen: true })).toBeNull();
    expect(sanitizeBlockedNavigation({ id: "a", url: "http://a/", canOpen: "yes" as never })?.canOpen).toBe(false);
    expect(blockedNavigationHost(blocked.url)).toBe("10.0.0.20:8123");
    expect(blockedNavigationHost("not a url")).toBe("not a url");
  });
});

describe("the in-tab notice", () => {
  it("shows over the kept page, offers 仍然打开 only when main allows it, and clears on null", () => {
    browserActivation.complete(browserActivation.begin());
    browserCache.update(view({ blockedNavigation: { ...blocked, canOpen: false } }));
    act(() => root.render(h(BrowserBody, props())));
    const notice = q("[data-browser-blocked-navigation]")!;
    expect(notice.getAttribute("data-browser-blocked-navigation")).toBe("refusal-1");
    expect(notice.textContent).toContain("browser.blockedNav.notice(10.0.0.20:8123)");
    expect(q("[data-browser-blocked-navigation-text]")!.title).toBe(blocked.url);
    expect(q("[data-browser-blocked-navigation-open]")).toBeNull();
    // The page stays: no failure overlay, no second red refusal row for the same block.
    expect(q("[data-browser-viewport]")!.style.visibility).toBe("visible");
    expect(container.textContent).not.toContain("browser.unavailable");
    act(() => browserCache.update(view({ pageGeneration: 2, blockedNavigation: blocked, error: "private_address_blocked" })));
    expect(q("[data-browser-blocked-navigation-open]")).not.toBeNull();
    expect(q("[data-browser-refusal]")).toBeNull();
    act(() => browserCache.update(view({ pageGeneration: 3, blockedNavigation: null })));
    expect(q("[data-browser-blocked-navigation]")).toBeNull();
  });

  it("仍然打开 calls main with the tab and the refusal id only", async () => {
    browserActivation.complete(browserActivation.begin());
    browserCache.update(view({ blockedNavigation: blocked }));
    act(() => root.render(h(BrowserBody, props())));
    act(() => q("[data-browser-blocked-navigation-open]")!.click());
    await flush();
    expect(fakes.browser.forHost).toHaveBeenCalledWith("ssh-other");
    expect(fakes.hostApi.openBlockedNavigation).toHaveBeenCalledTimes(1);
    expect(fakes.hostApi.openBlockedNavigation).toHaveBeenCalledWith("instance-1", "refusal-1");
  });

  it("× hides it here until the next refusal id", () => {
    browserActivation.complete(browserActivation.begin());
    browserCache.update(view({ blockedNavigation: blocked }));
    act(() => root.render(h(BrowserBody, props())));
    act(() => q("[data-browser-blocked-navigation-dismiss]")!.click());
    expect(q("[data-browser-blocked-navigation]")).toBeNull();
    act(() => browserCache.update(view({ pageGeneration: 2, blockedNavigation: blocked })));
    expect(q("[data-browser-blocked-navigation]")).toBeNull();
    act(() => browserCache.update(view({ pageGeneration: 3, blockedNavigation: { ...blocked, id: "refusal-2" } })));
    expect(q("[data-browser-blocked-navigation]")?.getAttribute("data-browser-blocked-navigation")).toBe("refusal-2");
    expect(fakes.hostApi.openBlockedNavigation).not.toHaveBeenCalled();
  });
});

describe("pending and failure", () => {
  it("shows a pending state while main works, ignores a second click, and an inline error when it rejects", async () => {
    const run = deferred();
    const open = vi.fn(() => run.promise);
    act(() => root.render(h(BrowserBlockedNavigation, { blocked, open, disabled: false })));
    const button = () => q("[data-browser-blocked-navigation-open]") as HTMLButtonElement;
    act(() => button().click());
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("browser.blockedNav.opening");
    act(() => button().click());
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => { run.reject(new Error("blocked_navigation_expired")); await run.promise.catch(() => {}); });
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("browser.blockedNav.open");
    expect(q("[data-browser-blocked-navigation-error]")?.getAttribute("role")).toBe("alert");
    expect(q("[data-browser-blocked-navigation-error]")?.textContent).toContain("browser.actionFailed");
    // A retry clears the error while it runs.
    const again = deferred();
    open.mockImplementationOnce(() => again.promise);
    act(() => button().click());
    expect(q("[data-browser-blocked-navigation-error]")).toBeNull();
    await act(async () => { again.resolve(); await again.promise; });
    expect(q("[data-browser-blocked-navigation-error]")).toBeNull();
  });

  it("a disabled notice (tab not ready) does not call main", () => {
    const open = vi.fn(async () => {});
    act(() => root.render(h(BrowserBlockedNavigation, { blocked, open, disabled: true })));
    act(() => (q("[data-browser-blocked-navigation-open]") as HTMLButtonElement).click());
    expect(open).not.toHaveBeenCalled();
  });
});

describe("desktop loopback retry (SSH host page linking to localhost)", () => {
  it("only `true` counts, in the sanitizer and the cache; anything else means absent", () => {
    expect(sanitizeBlockedNavigation({ ...blocked, desktopLoopback: true })?.desktopLoopback).toBe(true);
    for (const value of ["true", 1, false, null, {}] as never[]) {
      const clean = sanitizeBlockedNavigation({ ...blocked, desktopLoopback: value });
      expect(clean).not.toBeNull();
      expect("desktopLoopback" in clean!).toBe(false);
    }
    const cache = createBrowserCache();
    cache.update(view({ blockedNavigation: { ...blocked, desktopLoopback: "yes" as never } }));
    expect(cache.get("ssh-other", "instance-1")?.blockedNavigation).toEqual(blocked);
    cache.update(view({ pageGeneration: 2, blockedNavigation: { ...blocked, desktopLoopback: true } }));
    expect(cache.get("ssh-other", "instance-1")?.blockedNavigation).toEqual({ ...blocked, desktopLoopback: true });
  });

  it("the button says it opens on this computer, with a hover hint, and calls main the same way", async () => {
    const open = vi.fn(async () => {});
    act(() => root.render(h(BrowserBlockedNavigation, { blocked, open, disabled: false })));
    const button = () => q("[data-browser-blocked-navigation-open]") as HTMLButtonElement;
    expect(button().textContent).toBe("browser.blockedNav.open");
    expect(button().title).toBe(blocked.url);
    expect(button().hasAttribute("data-desktop-loopback")).toBe(false);
    act(() => root.render(h(BrowserBlockedNavigation, { blocked: { ...blocked, desktopLoopback: true }, open, disabled: false })));
    expect(button().textContent).toBe("browser.blockedNav.openDesktop");
    expect(button().title).toBe(`browser.blockedNav.desktopLoopbackHint(${blocked.url})`);
    act(() => button().click());
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("in a tab: the field switches the label and the bridge call stays (tabKey, id)", async () => {
    browserActivation.complete(browserActivation.begin());
    browserCache.update(view({ blockedNavigation: { ...blocked, desktopLoopback: true } }));
    act(() => root.render(h(BrowserBody, props())));
    expect(q("[data-browser-blocked-navigation-open]")!.textContent).toBe("browser.blockedNav.openDesktop");
    act(() => q("[data-browser-blocked-navigation-open]")!.click());
    await flush();
    expect(fakes.hostApi.openBlockedNavigation).toHaveBeenCalledWith("instance-1", "refusal-1");
    act(() => browserCache.update(view({ pageGeneration: 2, blockedNavigation: { ...blocked, id: "refusal-2" } })));
    expect(q("[data-browser-blocked-navigation-open]")!.textContent).toBe("browser.blockedNav.open");
  });
});
