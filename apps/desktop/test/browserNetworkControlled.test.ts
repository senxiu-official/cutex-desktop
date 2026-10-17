// 0.1.3 batch 3 at the session / popup boundary: form popups, agent popups, downloads, permissions.
import { EventEmitter } from "node:events";
import type { Session } from "electron";
import { describe, expect, it, vi } from "vitest";
import { BROWSER_POPUP_POST_LIMIT, browserPopupPost, createBrowserUrlPolicy, createBrowserWindowOpenHandler, installBrowserSessionPolicy, revokeBrowserSessionPolicy,
  type BrowserPopupPolicyOptions, type BrowserSessionPermissions } from "../src/main/browser/network";

const raw = (text: string) => ({ type: "rawData", bytes: Buffer.from(text) });
const policy = () => createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }), admitted: () => true });
function open(options: Partial<BrowserPopupPolicyOptions>, details: Record<string, unknown>) {
  const diagnostic = vi.fn();
  const handler = createBrowserWindowOpenHandler(() => ({ hostId: "local", webContentsId: 7, policy: policy(), ...options }), diagnostic);
  const result = handler({ url: "http://localhost:26180/submit", frameName: "_blank", features: "", disposition: "foreground-tab", referrer: { url: "", policy: "default" }, ...details } as never);
  return { result, diagnostic };
}

describe("popup form bodies", () => {
  it("accepts bounded in-memory form bodies and keeps the multipart boundary", () => {
    expect(browserPopupPost({ contentType: "application/x-www-form-urlencoded", data: [raw("a=1"), raw("&b=2")] }))
      .toEqual({ data: Buffer.from("a=1&b=2"), contentType: "application/x-www-form-urlencoded" });
    expect(browserPopupPost({ contentType: "multipart/form-data", boundary: "----WebKitFormBoundaryX1", data: [raw("--x")] })?.contentType)
      .toBe("multipart/form-data; boundary=----WebKitFormBoundaryX1");
  });
  it("refuses file references, oversized bodies, odd content types and header injection", () => {
    expect(browserPopupPost({ contentType: "multipart/form-data", boundary: "b", data: [{ type: "file", filePath: "/etc/passwd" }] })).toBeNull();
    expect(browserPopupPost({ contentType: "application/x-www-form-urlencoded", data: [{ type: "rawData", bytes: Buffer.alloc(BROWSER_POPUP_POST_LIMIT + 1) }] })).toBeNull();
    expect(browserPopupPost({ contentType: "application/json", data: [raw("{}")] })).toBeNull();
    expect(browserPopupPost({ contentType: "text/plain\r\nX-Evil: 1", data: [raw("x")] })).toBeNull();
    expect(browserPopupPost({ contentType: "multipart/form-data", boundary: "b\r\nX-Evil: 1", data: [raw("x")] })).toBeNull();
    expect(browserPopupPost({ contentType: "multipart/form-data", data: [raw("x")] })).toBeNull();
    expect(browserPopupPost({ data: [] })).toBeNull();
  });
});

describe("controlled new tabs", () => {
  it("an owner-clicked target=_blank POST forwards its body to the new tab instead of being denied", () => {
    const onNewTab = vi.fn();
    const { result } = open({ onNewTab, consumeOwnerGesture: () => true }, { postBody: { contentType: "application/x-www-form-urlencoded", data: [raw("q=1")] } });
    expect(result).toEqual({ action: "deny" }); // never a native window
    expect(onNewTab).toHaveBeenCalledWith({ hostId: "local", url: "http://localhost:26180/submit", post: { data: Buffer.from("q=1"), contentType: "application/x-www-form-urlencoded" } });
  });
  it("an unacceptable body is still refused before spending the owner's gesture", () => {
    const onNewTab = vi.fn(), consumeOwnerGesture = vi.fn(() => true);
    const { diagnostic } = open({ onNewTab, consumeOwnerGesture }, { postBody: { contentType: "multipart/form-data", boundary: "b", data: [{ type: "file", filePath: "/tmp/x" }] } });
    expect(diagnostic).toHaveBeenCalledWith("post_body"); expect(consumeOwnerGesture).not.toHaveBeenCalled(); expect(onNewTab).not.toHaveBeenCalled();
  });
  it("the leased agent's own click opens an agent-marked tab without touching the owner's gesture; rate limited", () => {
    const onNewTab = vi.fn(), consumeOwnerGesture = vi.fn(() => true);
    open({ onNewTab, consumeOwnerGesture, agentActing: () => true, consumeAgentPopup: () => true }, {});
    expect(onNewTab).toHaveBeenCalledWith({ hostId: "local", url: "http://localhost:26180/submit", agent: true });
    expect(consumeOwnerGesture).not.toHaveBeenCalled();
    const limited = open({ onNewTab, agentActing: () => true, consumeAgentPopup: () => false }, {});
    expect(limited.diagnostic).toHaveBeenCalledWith("agent_rate_limited"); expect(onNewTab).toHaveBeenCalledOnce();
  });
  it("the page policy still applies to every popup target", () => {
    const onNewTab = vi.fn();
    const { diagnostic } = open({ onNewTab, consumeOwnerGesture: () => true, policy: createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }), admitted: () => false }) }, {});
    expect(diagnostic).toHaveBeenCalledWith("policy_denied"); expect(onNewTab).not.toHaveBeenCalled();
  });
});

function sessionMock() {
  const emitter = new EventEmitter();
  const handlers: Record<string, any> = {};
  const session = Object.assign(emitter, {
    setPermissionRequestHandler: (fn: any) => { handlers.request = fn; }, setPermissionCheckHandler: (fn: any) => { handlers.check = fn; },
    setDevicePermissionHandler: (fn: any) => { handlers.device = fn; }, setCertificateVerifyProc: () => {}, setProxy: vi.fn(async () => {}),
    webRequest: { onBeforeRequest: () => {}, onHeadersReceived: () => {} } });
  const download = (contents: { id: number } | undefined) => {
    const event = { preventDefault: vi.fn() }, item = { cancel: vi.fn() };
    emitter.emit("will-download", event, item, contents);
    return event.preventDefault.mock.calls.length === 0 && item.cancel.mock.calls.length === 0;
  };
  return { session: session as unknown as Session, handlers, download };
}
const base = { partition: "persist:browser-local", registeredHostIds: ["local"], policy: policy(), acceptWebContents: (id: number) => id === 7 };

describe("session downloads", () => {
  it("only main's attribution lets a download reach the save dialog; anything else is cancelled", async () => {
    const mock = sessionMock(), download = vi.fn((id: number | undefined) => id === 7);
    const control = await installBrowserSessionPolicy(mock.session, { ...base, download });
    expect(mock.download({ id: 7 })).toBe(true);
    expect(mock.download({ id: 9 })).toBe(false);
    expect(mock.download(undefined)).toBe(false);
    download.mockImplementationOnce(() => { throw new Error("boom"); });
    expect(mock.download({ id: 7 })).toBe(false);
    control.dispose();
    expect(mock.download({ id: 7 })).toBe(false); // revoked registration: cancel again
  });
  it("a later window's registration decides, with a single listener", async () => {
    const mock = sessionMock();
    const first = await installBrowserSessionPolicy(mock.session, { ...base, download: () => true });
    revokeBrowserSessionPolicy(mock.session); first.dispose();
    await installBrowserSessionPolicy(mock.session, base); // no download option = cancel all
    expect(mock.download({ id: 7 })).toBe(false);
    expect(mock.session.listenerCount("will-download")).toBe(1);
  });
});

describe("session site permissions", () => {
  it("routes accepted guests to main's decision and denies devices, unknown contents and revoked sessions", async () => {
    const mock = sessionMock();
    let answer!: (value: boolean) => void;
    const permissions: BrowserSessionPermissions = { request: vi.fn(() => new Promise<boolean>(resolve => { answer = resolve; })), check: vi.fn(() => true) };
    const control = await installBrowserSessionPolicy(mock.session, { ...base, permissions });
    const callback = vi.fn();
    mock.handlers.request({ id: 7 }, "media", callback, { mediaTypes: ["video"], requestingUrl: "https://a.example/", securityOrigin: "x" });
    expect(permissions.request).toHaveBeenCalledWith(7, "media", { mediaTypes: ["video"], requestingUrl: "https://a.example/" });
    answer(true); await Promise.resolve(); await Promise.resolve();
    expect(callback).toHaveBeenCalledWith(true);
    const unknown = vi.fn(); mock.handlers.request({ id: 9 }, "media", unknown, {}); expect(unknown).toHaveBeenCalledWith(false);
    expect(mock.handlers.check({ id: 7 }, "media", "https://a.example", { mediaType: "video" })).toBe(true);
    expect(mock.handlers.check({ id: 9 }, "media", "https://a.example", {})).toBe(false);
    expect(mock.handlers.device()).toBe(false);
    const late = vi.fn(); mock.handlers.request({ id: 7 }, "geolocation", late, {});
    control.dispose(); answer(true); await Promise.resolve(); await Promise.resolve();
    expect(late).toHaveBeenCalledWith(false); // an answer after revocation never grants
    expect(mock.handlers.check({ id: 7 }, "media", "https://a.example", {})).toBe(false);
  });
});
