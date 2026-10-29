// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserLoginOrigin, openOwnerLoginCopy } from "../src/renderer/src/modules/browser/loginHint";
import { createBrowserCache } from "../src/renderer/src/modules/browser/browserCache";
import type { BrowserTabView } from "../src/shared/browser";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { BrowserLoginPoolPill, BrowserLoginWarning } from "../src/renderer/src/modules/browser/BrowserLoginHint";

const key = "00000000-0000-4000-8000-000000000001";
const host = document.createElement("div"); document.body.append(host);
const root = createRoot(host);
afterEach(() => { act(() => root.render(null)); });
const flush = () => act(async () => { await Promise.resolve(); });
const button = (text: string) => [...document.querySelectorAll("button")].find(b => b.textContent === text)!;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe("main-reported login origin", () => {
  it("matches only the exact current http(s) origin, never guesses from a URL path", () => {
    expect(browserLoginOrigin("https://a.test/login?password=x", undefined)).toBeNull();
    expect(browserLoginOrigin("https://a.test/login", "https://b.test")).toBeNull();
    expect(browserLoginOrigin("https://a.test:444/login", "https://a.test")).toBeNull();
    expect(browserLoginOrigin("about:blank", "null")).toBeNull();
    expect(browserLoginOrigin("garbage", "https://a.test")).toBeNull();
    expect(browserLoginOrigin("https://a.test/account#signin", "https://a.test")).toBe("https://a.test");
  });
  it("caches the main hint only for matching agent-pool pages and clears it after dismissal", () => {
    const cache = createBrowserCache();
    const view: BrowserTabView = { hostId: "target", tabKey: key, guestId: "guest", pageGeneration: 1, url: "https://a.test/login", title: "Login",
      loading: false, canGoBack: false, canGoForward: false, status: "attached", pool: "agent", loginOrigin: "https://a.test" };
    cache.update(view); expect(cache.get("target", key)?.loginOrigin).toBe("https://a.test");
    cache.update({ ...view, loginOrigin: null }); expect(cache.get("target", key)?.loginOrigin).toBeNull();
    cache.update({ ...view, pool: "owner" }); expect(cache.get("target", key)?.loginOrigin).toBeNull();
    cache.update({ ...view, url: "https://b.test/" }); expect(cache.get("target", key)?.loginOrigin).toBeNull();
    expect(cache.get("other-host", key)).toBeUndefined();
  });
});

describe("fresh owner tab handoff", () => {
  function setup() {
    return { reserve: vi.fn(async () => ({ tabKey: key, url: "https://a.test/login" })), close: vi.fn(async () => {}), current: vi.fn(() => true),
      open: vi.fn(() => ({ status: "opened" as const, instanceId: "copy", where: "card" as const, pageId: "source-page", reused: false })) };
  }
  it("uses the main-minted owner identity and safe metadata, leaving exact URL retention to main", async () => {
    const f = setup(); await openOwnerLoginCopy(f);
    expect(f.reserve).toHaveBeenCalledOnce();
    expect(f.open).toHaveBeenCalledExactlyOnceWith({ tabKey: key, url: "https://a.test/login", ownerTab: true });
    expect(f.close).not.toHaveBeenCalled();
  });
  it("makes no request from a stale host or source page", async () => {
    const f = setup(); f.current.mockReturnValue(false);
    await expect(openOwnerLoginCopy(f)).rejects.toThrow("stale_browser");
    expect(f.reserve).not.toHaveBeenCalled();
  });
  it("closes only its reserved copy when the host or page changes during the request", async () => {
    const f = setup(), wait = deferred<{ tabKey: string; url: string }>(); f.reserve.mockReturnValue(wait.promise);
    const result = openOwnerLoginCopy(f); f.current.mockReturnValue(false); wait.resolve({ tabKey: key, url: "https://a.test/login" });
    await expect(result).rejects.toThrow("stale_browser");
    expect(f.open).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledExactlyOnceWith(key);
  });
  it("closes a copy which cannot be shown instead of leaking an owner reservation", async () => {
    const f = setup();
    await expect(openOwnerLoginCopy({ ...f, open: () => ({ status: "unavailable", reason: "host-offline" }) })).rejects.toThrow("browser_unavailable");
    expect(f.close).toHaveBeenCalledExactlyOnceWith(key);
  });
  it("refuses malformed identities and unsafe metadata without touching an arbitrary key", async () => {
    const f = setup(); f.reserve.mockResolvedValue({ tabKey: "not-minted", url: "https://a.test/" });
    await expect(openOwnerLoginCopy(f)).rejects.toThrow("invalid_browser_identity");
    expect(f.open).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled();
    f.reserve.mockResolvedValue({ tabKey: key, url: "javascript:alert(1)" });
    await expect(openOwnerLoginCopy(f)).rejects.toThrow(); expect(f.close).toHaveBeenCalledExactlyOnceWith(key);
  });
});

describe("quiet pool label and triggered warning", () => {
  it("starts as a quiet pill; opens an explanation and its owner action only on request", async () => {
    const openOwner = vi.fn(async () => {});
    act(() => root.render(<BrowserLoginPoolPill disabled={false} openOwner={openOwner} />));
    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(openOwner).not.toHaveBeenCalled();
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    act(() => trigger.click());
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("browser.login.poolHint");
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    act(() => button("browser.login.openOwner").click()); await flush();
    expect(openOwner).toHaveBeenCalledOnce(); expect(document.querySelector("[role=dialog]")).toBeNull();
  });
  it("supports Escape with focus return and outside-click dismissal", () => {
    act(() => root.render(<BrowserLoginPoolPill disabled={false} openOwner={vi.fn(async () => {})} />));
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    act(() => trigger.click());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector("[role=dialog]")).toBeNull(); expect(document.activeElement).toBe(trigger);
    act(() => trigger.click()); act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
  it("displays a retryable failure rather than silently closing a failed owner copy", async () => {
    const openOwner = vi.fn(async () => { throw Error("offline"); });
    act(() => root.render(<BrowserLoginPoolPill disabled={false} openOwner={openOwner} />));
    act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    act(() => button("browser.login.openOwner").click()); await flush();
    expect(document.querySelector("[role=alert]")?.textContent).toBe("browser.login.failed");
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
  });
  it("dismisses through main, stays until an authoritative update, and prevents duplicate actions", async () => {
    const wait = deferred<void>(), dismiss = vi.fn(() => wait.promise), openOwner = vi.fn(async () => {});
    act(() => root.render(<BrowserLoginWarning disabled={false} dismiss={dismiss} openOwner={openOwner} />));
    expect(host.querySelector("[role=status]")?.textContent).toContain("browser.login.warning");
    act(() => { button("browser.login.dismiss").click(); button("browser.login.dismiss").click(); });
    expect(dismiss).toHaveBeenCalledOnce(); expect(openOwner).not.toHaveBeenCalled();
    expect(button("browser.login.openOwner").disabled).toBe(true);
    wait.resolve(); await flush();
    expect(host.querySelector("[data-browser-login-warning]")).not.toBeNull();
    act(() => button("browser.login.openOwner").click()); await flush(); expect(openOwner).toHaveBeenCalledOnce();
  });
  it("does not call either action while the tab is unavailable", () => {
    const dismiss = vi.fn(async () => {}), openOwner = vi.fn(async () => {});
    act(() => root.render(<BrowserLoginWarning disabled dismiss={dismiss} openOwner={openOwner} />));
    act(() => { button("browser.login.dismiss").click(); button("browser.login.openOwner").click(); });
    expect(dismiss).not.toHaveBeenCalled(); expect(openOwner).not.toHaveBeenCalled();
  });
});
