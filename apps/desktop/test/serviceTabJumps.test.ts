// @vitest-environment jsdom
// Service pages that "jumped to the browser" (owner report 2026-11-18; private repro svcjump):
// S1 a same-service popup opens as that service's tab beside its opener, and window.open's tab loads (main's own ticket
//    redirect in a fresh popup guest was refused: no owner receipt, initiator fallback about:blank = opaque origin);
// S3 the service's own raw loopback port goes back through the service; the address bar reads `?`, not `%3F`.
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { createBrowserUrlPolicy, hardenBrowserGuest } from "../src/main/browser/network";
import { BrowserServiceSession, parseBrowserServiceUrl, serviceTargetForRawPort } from "../src/main/browser/services";
import { openPopupTab } from "../src/renderer/src/modules/browser/popupOpen";
import { BROWSER_TAB, SERVICE_TAB, browserAddressText, browserAddressUrl } from "../src/renderer/src/modules/browser/browserState";

const PORT = 26111;
const policy = () => createBrowserUrlPolicy({ getHost: () => ({ kind: "local", serviceProxy: true, connectionPort: PORT }), admitted: () => false });
function freshPopupGuest() {
  const guest = new EventEmitter();
  // A popup tab's guest before its first document: about:blank (the initiator fallback is then opaque).
  Object.assign(guest, { id: 9, getURL: () => "about:blank", setWebRTCIPHandlingPolicy: vi.fn() });
  return { guest: guest as unknown as WebContents, emitter: guest };
}
const redirect = (url: string, initiator: { url: string } | null = null) => ({ url, isMainFrame: true, initiator, preventDefault: vi.fn() });

describe("S1: main's own service ticket redirect in a fresh popup tab", () => {
  it("is refused without the tab's own-service check (the cause of window.open's 网页加载失败)", () => {
    const { guest, emitter } = freshPopupGuest(), blocked = vi.fn();
    hardenBrowserGuest(guest, { hostId: "local", policy: policy(), ownerNavigation: () => false, onBlocked: blocked });
    const event = redirect(`http://docs.svc.localhost:${PORT}/sub`);
    emitter.emit("will-redirect", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(blocked).toHaveBeenCalledWith("redirect", event.url, true, "private_address_blocked");
  });
  it("passes when the redirect stays on the service this tab holds and the browser started the navigation", () => {
    const { guest, emitter } = freshPopupGuest(), blocked = vi.fn();
    const own = vi.fn((url: string) => parseBrowserServiceUrl(url, PORT)?.slug === "docs");
    hardenBrowserGuest(guest, { hostId: "local", policy: policy(), ownerNavigation: () => false, ownServiceRedirect: own, onBlocked: blocked });
    const event = redirect(`http://docs.svc.localhost:${PORT}/sub`);
    emitter.emit("will-redirect", event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(blocked).not.toHaveBeenCalled();
    // Another service, a page-initiated redirect, or a page navigation: unchanged rules.
    const other = redirect(`http://other.svc.localhost:${PORT}/`);
    emitter.emit("will-redirect", other);
    expect(other.preventDefault).toHaveBeenCalledOnce();
    const fromPage = redirect(`http://docs.svc.localhost:${PORT}/sub`, { url: "https://evil.example/" });
    emitter.emit("will-redirect", fromPage);
    expect(fromPage.preventDefault).toHaveBeenCalledOnce();
    const navigation = { ...redirect(`http://docs.svc.localhost:${PORT}/sub`), url: `http://docs.svc.localhost:${PORT}/sub` };
    emitter.emit("will-navigate", navigation);
    expect(navigation.preventDefault).toHaveBeenCalledOnce();
    expect(own).toHaveBeenCalledTimes(2); // only the two browser-started redirects asked
  });
});

describe("S1: a same-service popup opens as that service's tab", () => {
  const minted = "4f0bbfa0-1234-4abc-8def-0123456789ab";
  it("cutex:service/ popup → the service component with main's minted key", () => {
    const open = vi.fn(() => ({ status: "opened", instanceId: "new" }) as never);
    expect(openPopupTab({ hostId: "local", tabKey: "gone", pool: "owner", newTabUrl: "cutex:service/docs/sub", newTabKey: minted }, open)).not.toBeNull();
    expect(open).toHaveBeenCalledWith(SERVICE_TAB, { url: "cutex:service/docs/sub", tabKey: minted, ownerTab: true }, { binding: { kind: "host", hostId: "local" }, focus: false });
  });
  it("never without main's minted key; web popups unchanged", () => {
    const open = vi.fn(() => ({ status: "opened", instanceId: "new" }) as never);
    expect(openPopupTab({ hostId: "local", tabKey: "gone", pool: "owner", newTabUrl: "cutex:service/docs/sub" }, open)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    openPopupTab({ hostId: "local", tabKey: "gone", pool: "owner", newTabUrl: "https://example.com/", newTabKey: minted }, open);
    expect(open).toHaveBeenCalledWith(BROWSER_TAB, { url: "https://example.com/", tabKey: minted, ownerTab: true }, expect.anything());
  });
});

describe("S3: the service's own raw loopback port", () => {
  it("maps 127.0.0.1 / localhost / [::1] on the service's port back to that service; nothing else", () => {
    expect(serviceTargetForRawPort("http://127.0.0.1:8123/sub?from=redir", "docs", 8123)).toEqual({ slug: "docs", path: "/sub?from=redir" });
    expect(serviceTargetForRawPort("http://localhost:8123/", "docs", 8123)).toEqual({ slug: "docs", path: "/" });
    expect(serviceTargetForRawPort("http://[::1]:8123/a", "docs", 8123)).toEqual({ slug: "docs", path: "/a" });
    for (const url of ["http://127.0.0.1:8124/", "https://127.0.0.1:8123/", "http://10.0.0.2:8123/", "http://u:p@127.0.0.1:8123/", "http://127.0.0.1:8123/__cutex/auth", "http://127.0.0.1:8123//evil"])
      expect(serviceTargetForRawPort(url, "docs", 8123)).toBeNull();
    expect(serviceTargetForRawPort("http://127.0.0.1:8123/", "docs", undefined)).toBeNull();
    expect(serviceTargetForRawPort("http://127.0.0.1:9999/x", "docs", "any")).toEqual({ slug: "docs", path: "/x" });
    expect(serviceTargetForRawPort("http://example.com:9999/x", "docs", "any")).toBeNull();
  });
  it("main answers the navigation before the policy: the guest's own one is cancelled, no refusal notice", () => {
    const { guest, emitter } = freshPopupGuest(), blocked = vi.fn(), takeOver = vi.fn(() => true);
    hardenBrowserGuest(guest, { hostId: "local", policy: policy(), takeOver, onBlocked: blocked,
      ownServiceRedirect: (url: string) => parseBrowserServiceUrl(url, PORT)?.slug === "docs" });
    for (const kind of ["will-navigate", "will-redirect"]) {
      const event = redirect("http://127.0.0.1:8123/sub");
      emitter.emit(kind, event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    expect(takeOver.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["navigation", "redirect"]);
    expect(blocked).not.toHaveBeenCalled();
  });
  it("a service session asks its record for the port only when asked, once (no extra RPC on start)", async () => {
    const request = vi.fn(async (method: string, path: string) => path.endsWith("view-ticket")
      ? { hostLabel: "docs.svc.localhost", authPath: "/__cutex/auth?ticket=t&next=%2F" } : method === "GET" ? { service: { slug: "docs", port: 8123 } } : { leaseId: "l" });
    const session = new BrowserServiceSession({ client: { request: request as never }, target: { slug: "docs", path: "/" }, check: () => {}, connectionPort: () => PORT, lifetime: false, onError: () => {} });
    await session.start();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await session.upstreamPort()).toBe(8123);
    expect(await session.upstreamPort()).toBe(8123);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("GET", "/v2/services/docs");
    session.dispose();
  });
});

describe("service address text", () => {
  it("shows the query as ?a=b&c and turns typed text back into the ref key", () => {
    expect(browserAddressText("cutex:service/fix/sub%3Ffrom%3Dredir%26x")).toBe("cutex:service/fix/sub?from=redir&x");
    expect(browserAddressText("https://example.com/a%3Fb")).toBe("https://example.com/a%3Fb");
    expect(browserAddressUrl("cutex:service/fix/sub?from=redir&x")).toEqual({ url: "cutex:service/fix/sub%3Ffrom%3Dredir%26x" });
    expect(parseBrowserServiceUrl("cutex:service/fix/sub%3Ffrom%3Dredir%26x")).toEqual({ slug: "fix", path: "/sub?from=redir&x" });
  });
});
