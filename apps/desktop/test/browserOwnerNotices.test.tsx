// @vitest-environment jsdom
// Main's one-click owner notices (BrowserTabView.ownerNotices): the tab shows one quiet line per kind; the action hands
// main back the notice id, never a URL, fingerprint or file name.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserOwnerNoticeView, BrowserTabView } from "../src/shared/browser";
import type { HostsState } from "../src/shared/hosts";

const fakes = vi.hoisted(() => {
  const pending = () => new Promise<never>(() => {});
  const hostApi = { open: vi.fn(pending), close: vi.fn(async () => {}), list: vi.fn(async () => []), navigate: vi.fn(pending), back: vi.fn(pending), forward: vi.fn(pending),
    reload: vi.fn(pending), stop: vi.fn(pending), holdReady: vi.fn(async () => {}), releaseLease: vi.fn(async () => {}), setZoom: vi.fn(async () => {}),
    openBlockedNavigation: vi.fn(async (_tabKey: string, _id: string) => {}), openOwnerNotice: vi.fn(async (_tabKey: string, _id: string) => {}) };
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
import { ownerNoticeHost, sanitizeOwnerNotices } from "../src/renderer/src/modules/browser/ownerNotices";
import { BrowserBody } from "../src/renderer/src/modules/browser/BrowserBody";
import { BROWSER_TAB, type BrowserState } from "../src/renderer/src/modules/browser/browserState";
import type { SideBodyProps } from "../src/renderer/src/modules/slots";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const certificate: BrowserOwnerNoticeView = { id: "cert-1", kind: "certificate", url: "https://10.0.0.1/cgi-bin/luci", detail: "AB:CD" };
const view = (over: Partial<BrowserTabView> = {}): BrowserTabView => ({ hostId: "local", guestId: "guest-1", tabKey: "instance-1", pageGeneration: 1, url: "https://10.0.0.1/",
  title: "Page", loading: false, canGoBack: false, canGoForward: false, status: "attached", ...over });
const props = (): SideBodyProps<BrowserState> => ({ hostId: "local", sessionId: null, instance: { id: "scope-local-id", kind: BROWSER_TAB, binding: { kind: "host", hostId: "local" },
  state: { url: "https://10.0.0.1/", title: "Page", tabKey: "instance-1" }, pinned: false }, setState: vi.fn(), visible: true, active: true, mode: "normal", where: "card", revealed: 0,
  close: vi.fn(), open: vi.fn(), keepMounted: vi.fn(() => false), held: false, keep: vi.fn() } as never);
const hosts = (): HostsState => ({ active: "local", hosts: [{ id: "local", conn: { epoch: "epoch" } }] }) as never;

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

describe("owner notice state", () => {
  it("null clears, absent keeps for the same guest, a new guest starts without", () => {
    const cache = createBrowserCache();
    cache.update(view({ ownerNotices: [certificate] }));
    expect(cache.get("local", "instance-1")?.ownerNotices).toEqual([certificate]);
    cache.update(view({ pageGeneration: 2 }));
    expect(cache.get("local", "instance-1")?.ownerNotices).toEqual([certificate]);
    cache.update(view({ pageGeneration: 3, ownerNotices: null }));
    expect(cache.get("local", "instance-1")?.ownerNotices).toBeUndefined();
    cache.update(view({ pageGeneration: 4, ownerNotices: [certificate] }));
    cache.update(view({ guestId: "guest-2", pageGeneration: 1 }));
    expect(cache.get("local", "instance-1")?.ownerNotices).toBeUndefined();
  });
  it("drops malformed entries and unknown kinds, keeps one per kind, strips control characters", () => {
    expect(sanitizeOwnerNotices([{ ...certificate, id: "" }, { ...certificate, kind: "script" as never }, { ...certificate, url: 5 as never }])).toEqual([]);
    expect(sanitizeOwnerNotices([certificate, { ...certificate, id: "cert-2" }])).toEqual([certificate]);
    expect(sanitizeOwnerNotices([{ ...certificate, detail: "a\u0000b", url: "https://x.lan/\u0007" }])).toEqual([{ ...certificate, detail: "ab", url: "https://x.lan/" }]);
    expect(sanitizeOwnerNotices([{ ...certificate, detail: "x".repeat(400) }])[0]).not.toHaveProperty("detail");
    expect(sanitizeOwnerNotices("nope" as never)).toEqual([]);
    expect(ownerNoticeHost(certificate.url)).toBe("10.0.0.1");
  });
});

describe("the certificate notice in a tab", () => {
  it("names the host, offers 仍然打开 and calls main with (tabKey, id) only", async () => {
    browserActivation.complete(browserActivation.begin());
    browserCache.update(view({ ownerNotices: [certificate] }));
    act(() => root.render(h(BrowserBody, props())));
    const notice = q("[data-browser-owner-notice]")!;
    expect(notice.getAttribute("data-browser-owner-notice")).toBe("certificate");
    expect(notice.textContent).toContain("browser.ownerNotice.certificate(10.0.0.1)");
    expect(q("[data-browser-owner-notice-open]")!.title).toContain("AB:CD");
    act(() => q("[data-browser-owner-notice-open]")!.click());
    await flush();
    expect(fakes.hostApi.openOwnerNotice).toHaveBeenCalledWith("instance-1", "cert-1");
  });
  it("× hides it until the next id; a rejected click shows the inline failure", async () => {
    browserActivation.complete(browserActivation.begin());
    browserCache.update(view({ ownerNotices: [certificate] }));
    act(() => root.render(h(BrowserBody, props())));
    act(() => q("[data-browser-owner-notice-dismiss]")!.click());
    expect(q("[data-browser-owner-notice]")).toBeNull();
    act(() => browserCache.update(view({ pageGeneration: 2, ownerNotices: [{ ...certificate, id: "cert-2" }] })));
    expect(q("[data-browser-owner-notice-id]")?.getAttribute("data-browser-owner-notice-id")).toBe("cert-2");
    fakes.hostApi.openOwnerNotice.mockRejectedValueOnce(new Error("permission_denied"));
    act(() => q("[data-browser-owner-notice-open]")!.click());
    await flush();
    expect(q("[data-browser-owner-notice-error]")?.getAttribute("role")).toBe("alert");
  });
});

describe("download and popup notices (B10)", () => {
  it("name the file / host with their own action and call main with (tabKey, id) only", async () => {
    browserActivation.complete(browserActivation.begin());
    const download: BrowserOwnerNoticeView = { id: "dl-1", kind: "download", url: "https://example.org/export/report.csv", detail: "report.csv" };
    const popup: BrowserOwnerNoticeView = { id: "pop-1", kind: "popup", url: "https://accounts.example.com/oauth" };
    browserCache.update(view({ ownerNotices: [popup, download, certificate] }));
    act(() => root.render(h(BrowserBody, props())));
    const rows = [...container.querySelectorAll<HTMLElement>("[data-browser-owner-notice]")];
    expect(rows.map(row => row.getAttribute("data-browser-owner-notice"))).toEqual(["certificate", "download", "popup"]);
    expect(rows[1]!.textContent).toContain("browser.ownerNotice.download(report.csv)");
    expect(rows[1]!.textContent).toContain("browser.ownerNotice.downloadOpen");
    expect(rows[2]!.textContent).toContain("browser.ownerNotice.popup(accounts.example.com)");
    expect(rows[2]!.textContent).toContain("browser.ownerNotice.popupOpen");
    act(() => rows[1]!.querySelector<HTMLElement>("[data-browser-owner-notice-open]")!.click());
    act(() => rows[2]!.querySelector<HTMLElement>("[data-browser-owner-notice-open]")!.click());
    await flush();
    expect(fakes.hostApi.openOwnerNotice.mock.calls).toEqual([["instance-1", "dl-1"], ["instance-1", "pop-1"]]);
  });
});
