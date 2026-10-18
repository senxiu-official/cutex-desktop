import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrowserEvent, BrowserTabMount, BrowserTabView } from "../src/shared/browser";
import { DEFAULT_BROWSER_CONTROL_SETTINGS, normalizeBrowserControlSettings } from "../src/shared/browser";
import type { HostsState } from "../src/shared/hosts";
import type { AppModuleContext, SideBodyProps } from "../src/renderer/src/modules/slots";
import type { Json } from "../src/renderer/src/modules/types";
import { BROWSER_TAB, browserError, browserErrorKey, browserExternalUrl, browserNavigationUrl, browserRef, browserTitle, initBrowser, MAX_BROWSER_INPUT, parseBrowserParams, restoreBrowser, safeBrowserFavicon, safeBrowserUrl, type BrowserState } from "../src/renderer/src/modules/browser/browserState";
import { browserCache, browserCacheKey, createBrowserCache } from "../src/renderer/src/modules/browser/browserCache";
import { createGuestLifecycle } from "../src/renderer/src/modules/browser/guestLifecycle";
import { browserActivation, createBrowserActivation } from "../src/renderer/src/modules/browser/activation";
import { afterBrowserHostsDelivered, browserHostCurrent, browserHostEpoch, changedBrowserHosts } from "../src/renderer/src/modules/browser/hosts";
import { zhCN, en } from "../src/renderer/src/modules/browser/i18n";

const fakes = vi.hoisted(() => {
  const listeners = new Set<(event: BrowserEvent) => void>();
  const hostApi = { open: vi.fn(), close: vi.fn(), list: vi.fn(), navigate: vi.fn(), grantAgent: vi.fn(), back: vi.fn(), forward: vi.fn(), reload: vi.fn(), stop: vi.fn() };
  const browser = { setEnabled: vi.fn(async (_enabled: boolean) => {}), forHost: vi.fn(() => hostApi), subscribe: vi.fn((listener: (event: BrowserEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }) };
  const storeListeners = new Set<(state: { hosts: HostsState | null }, previous: { hosts: HostsState | null }) => void>();
  return { listeners, storeListeners, features: new Set<string>(), pref: undefined as Json | undefined, savePref: vi.fn(), state: { hosts: null as HostsState | null }, hostApi, browser, bridge: { browser: browser as typeof browser | undefined, api: { openExternal: vi.fn() } } };
});
vi.mock("../src/renderer/src/bridge", () => ({ bridge: fakes.bridge }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useModulePref: (_id: string, _key: string, fallback: Json) => [fakes.pref ?? fallback, fakes.savePref] }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "local", useTargetFeatures: () => fakes.features }));
// The page's 本设备 / 主机 parts (components/SettingsHostFrame, tested in settingsHostScope.test.tsx): plain wrappers here.
vi.mock("../src/renderer/src/components/SettingsHostFrame", async () => {
  const { createElement: h } = await import("react");
  const part = (name: string) => ({ title, children }: { title: string; children: unknown }) => h("div", { "data-settings-part": name }, title, children as never);
  return { SettingsDevicePart: part("device"), SettingsHostPart: part("host") };
});
vi.mock("../src/renderer/src/store", () => ({
  sidebarOf: () => null,
  useApp: Object.assign((select: (state: typeof fakes.state) => unknown) => select(fakes.state), {
    getState: () => fakes.state,
    subscribe: (listener: (state: typeof fakes.state, previous: typeof fakes.state) => void) => {
      fakes.storeListeners.add(listener);
      return () => { fakes.storeListeners.delete(listener); };
    },
  }),
}));
import browserModule from "../src/renderer/src/modules/browser";
import { BrowserBody } from "../src/renderer/src/modules/browser/BrowserBody";
import { BrowserControlBanner, BrowserControlHeader } from "../src/renderer/src/modules/browser/BrowserControls";
import { BrowserSettings } from "../src/renderer/src/modules/browser/BrowserSettings";
import { useBrowserControlSettings } from "../src/renderer/src/modules/browser/controlSettings";
import { startBrowser } from "../src/renderer/src/modules/browser/runtime";
import { useBrowserTab } from "../src/renderer/src/modules/browser/tabs";
import { BrowserProfileTools } from "../src/renderer/src/components/settings/ProfileBrowserTools";
import { BrowserHostSettings } from "../src/renderer/src/modules/browser/BrowserHostSettings";

const view = (over: Partial<BrowserTabView> = {}): BrowserTabView => ({ hostId: "ssh-other", guestId: "guest-1", tabKey: "instance-1", pageGeneration: 1, url: "http://localhost:8080/", title: "Page", loading: false, canGoBack: false, canGoForward: false, status: "attached", ...over });
const mount = (tabKey = "instance-1"): BrowserTabMount => ({ guestId: "guest-1", tabKey, partition: "persist:browser-ssh-other", src: `about:blank#cutex-browser-attach=${"a".repeat(64)}` });
const props = (over: Partial<SideBodyProps<BrowserState>> = {}): SideBodyProps<BrowserState> => ({ hostId: "ssh-other", sessionId: null, instance: { id: "scope-local-id", kind: BROWSER_TAB, binding: { kind: "host", hostId: "ssh-other" }, state: { url: "about:blank", title: "Saved title", tabKey: "instance-1" }, pinned: false }, setState: vi.fn(), visible: true, active: true, mode: "normal", where: "card", revealed: 0, close: vi.fn(), open: vi.fn(), keepMounted: vi.fn(() => false), held: false, keep: vi.fn(), ...over });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const hosts = (entries: [string, string | null][], active = "local"): HostsState => ({ active, hosts: entries.map(([id, epoch]) => ({ id, conn: { epoch } })) }) as HostsState;
function setHosts(next: HostsState | null) {
  const previous = fakes.state;
  fakes.state = { hosts: next };
  for (const listener of fakes.storeListeners) listener(fakes.state, previous);
}

beforeEach(() => {
  vi.clearAllMocks(); fakes.listeners.clear(); fakes.storeListeners.clear(); fakes.bridge.browser = fakes.browser; browserCache.clear();
  fakes.pref = undefined;
  fakes.features.clear();
  browserActivation.begin();
  fakes.state = { hosts: hosts([["local", "focus-epoch"], ["ssh-other", "epoch"]]) };
});

describe("browser URL syntax, state and references", () => {
  it("module off: the profile row has no toggle, only the hint and 打开 模块 (same activation gate as browser settings)", () => {
    fakes.features.add("browser-relay-v1"); const token = browserActivation.begin();
    const off = renderToStaticMarkup(createElement(BrowserProfileTools, { profile: "test" }));
    expect(off).toContain("browser.profile.moduleOff");
    expect(off).toContain("modules.openModules");
    expect(off).not.toContain("role=\"switch\"");
    expect(renderToStaticMarkup(createElement(BrowserHostSettings))).toContain("browser.host.unavailable");
    browserActivation.complete(token);
    expect(renderToStaticMarkup(createElement(BrowserProfileTools, { profile: "test" }))).toContain("role=\"switch\"");
    expect(renderToStaticMarkup(createElement(BrowserHostSettings))).not.toContain("browser.host.unavailable");
    browserActivation.end(token);
    expect(renderToStaticMarkup(createElement(BrowserProfileTools, { profile: "test" }))).toBe(off);
    expect(renderToStaticMarkup(createElement(BrowserHostSettings))).toContain("browser.host.unavailable");
  });
  it("normalizes http(s) but does not make a renderer-side permission decision", () => {
    expect(browserNavigationUrl(" HTTPS://Example.COM:443/a/../page?q=1#anchor ")).toBe("https://example.com/page?q=1#anchor");
    expect(browserNavigationUrl("http://[::1]:8080/")).toBe("http://[::1]:8080/");
    expect(browserNavigationUrl("about:blank")).toBe("about:blank");
    expect(browserNavigationUrl("cutex:service/docs/index%3Fpage%3D2")).toBe("cutex:service/docs/index%3Fpage%3D2");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///C:/x", "blob:http://localhost/id", "about:blank#cutex-browser-attach=secret", "about:srcdoc", "https://u:p@localhost/", "http:\\localhost", "http://local\nhost/", "https://localhost/\u0000", "localhost:3000", "cutex:service/../x", "cutex:service/docs/%ZZ", "cutex:service/docs/space here"])("rejects an invalid navigation: %s", (url) => {
    expect(browserNavigationUrl(url)).toBeNull();
  });

  it("removes userinfo, sensitive query names, duplicates and fragments before persisting", () => {
    expect(safeBrowserUrl("https://user:secret@EXAMPLE.com:443/a?tab=2&token=a&token=b&accessToken=c&api.key=d&X-Amz-Signature=e&%74icket=f&authorization=g&password=h#access_token=x")).toBe("https://example.com/a?tab=2");
    expect(safeBrowserUrl("https://localhost/?page=2&monkey=ok&view=all")).toBe("https://localhost/?page=2&monkey=ok&view=all");
  });

  it("normalizes service refs by decoding once and keeps that operation idempotent", () => {
    const raw = "cutex:service/docs/hello%2520world%3Fpage%3D2%26token%3Dsecret%23fragment";
    const safe = "cutex:service/docs/hello%2520world%3Fpage%3D2";
    expect(safeBrowserUrl(raw)).toBe(safe);
    expect(safeBrowserUrl(safe)).toBe(safe);
    expect(safeBrowserUrl("cutex:service/docs//evil.example/x")).toBeNull();
    expect(safeBrowserUrl("cutex:service/docs/%00")).toBeNull();
    expect(safeBrowserUrl("cutex:service/docs")).toBe("cutex:service/docs");
  });

  it("restores v1 URL/title and random tab identity, never capability fields", () => {
    expect(parseBrowserParams({ url: "https://u:p@localhost/?token=x", guestId: "not-state" })).toEqual({ url: "https://localhost/" });
    expect(restoreBrowser({ url: "http://localhost/", title: "Saved", guestId: "opaque", leaseId: "secret", partition: "bad" }, 1)).toEqual({ url: "http://localhost/", title: "Saved", tabKey: expect.any(String) });
    expect(restoreBrowser({ url: "http://localhost/", title: "Saved" }, 2)).toBeNull();
    const badParams: Json[] = [null, [], {}, "url", { url: 1 }, { url: "javascript:alert(1)" }];
    for (const bad of badParams) expect(parseBrowserParams(bad)).toBeNull();
    const tabKey = crypto.randomUUID();
    expect(initBrowser({ url: "about:blank" }, { url: "about:blank", title: "Kept", tabKey })).toEqual({ url: "about:blank", title: "Kept", tabKey });
    expect(initBrowser({ url: "about:blank" }, { url: "http://localhost/", title: "Old", tabKey })).toEqual({ url: "about:blank", title: "", tabKey });
  });

  it("new cards get independent keys, restore preserves valid keys, refs never copy them", () => {
    const first = initBrowser({ url: "about:blank" }, null), second = initBrowser({ url: "about:blank" }, null);
    expect(first.tabKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.tabKey).not.toBe(second.tabKey);
    expect(first.newOwner).toBe(true);
    const { newOwner: _ignored, ...restored } = first;
    expect(restoreBrowser(first, 1)).toEqual(restored);
    expect(restoreBrowser({ ...first, newOwner: true }, 1)).not.toHaveProperty("newOwner");
    expect(restoreBrowser({ ...first, tabKey: "scope-local-id" }, 1)?.tabKey).not.toBe("scope-local-id");
    expect(browserRef(first)?.params).toEqual({ url: "about:blank" });
    expect(initBrowser(parseBrowserParams({ ...first })!, null).tabKey).not.toBe(first.tabKey);
  });

  it("bounds JSON under 4 KiB, reference keys at 2000 units and titles at 200", () => {
    const state = restoreBrowser({ url: `http://localhost/${"a".repeat(1980)}`, title: "\"🚀".repeat(500) }, 1)!;
    expect(state.url.length).toBeLessThanOrEqual(2000);
    expect(state.title.length).toBeLessThanOrEqual(200);
    expect(Buffer.byteLength(JSON.stringify(state))).toBeLessThanOrEqual(4096);
    expect(safeBrowserUrl(`http://localhost/${"a".repeat(2000)}`)).toBeNull();
    expect(browserNavigationUrl("x".repeat(MAX_BROWSER_INPUT + 1))).toBeNull();
    expect(browserTitle("a".repeat(199) + "🚀")).toHaveLength(199);
  });

  it("references share a credential-free normalized URL key and reopen params", () => {
    const ref = browserRef({ url: "HTTP://localhost:80/a/../?token=private#frag", title: "Page\nTitle", tabKey: crypto.randomUUID() });
    expect(ref).toEqual({ key: "http://localhost/", title: "Page Title", params: { url: "http://localhost/" } });
    expect(parseBrowserParams(ref!.params)).toEqual({ url: "http://localhost/" });
    expect(browserRef({ url: "file:///private", title: "Bad", tabKey: crypto.randomUUID() })).toBeNull();
  });

  it("system-open permits only redacted http(s), never blank, service or custom schemes", () => {
    expect(browserExternalUrl("https://localhost/?token=private&p=1")).toBe("https://localhost/?p=1");
    for (const url of ["about:blank", "cutex:service/docs/", "mailto:me@example.com", "javascript:1"]) expect(browserExternalUrl(url)).toBeNull();
  });

  it("favicons are bounded inert raster data, not app-session URL fetches or SVG", () => {
    expect(safeBrowserFavicon("data:image/png;base64,AA==")).toBe("data:image/png;base64,AA==");
    for (const bad of [undefined, "https://site/favicon.ico", "data:image/svg+xml;base64,AA==", "data:text/html;base64,AA==", "data:image/png;base64,AA==\n", `data:image/png;base64,${"A".repeat(128 * 1024)}`]) expect(safeBrowserFavicon(bad)).toBeUndefined();
  });

  it("IPC errors are bounded plain text and cannot repeat URL credentials", () => {
    expect(browserError(new Error("Error invoking remote method 'browser': Error: Blocked https://u:p@localhost/?token=x&page=1"))).toBe("Blocked https://localhost/?page=1");
    expect(browserError("x".repeat(500))).toHaveLength(400);
    expect(browserErrorKey(new Error("external_pages_unavailable"))).toBe("browser.externalUnavailable");
    expect(browserErrorKey("service_proxy_required")).toBe("browser.serviceProxyRequired");
    expect(browserErrorKey("other")).toBe("browser.error.unknown");
  });
});

describe("browser passive metadata cache", () => {
  it("separates identical instance ids on different hosts and retains immutable snapshots", () => {
    const cache = createBrowserCache();
    const source = view();
    cache.update(source);
    cache.update(view({ hostId: "local", title: "Other" }));
    source.title = "Mutated";
    expect(cache.get("ssh-other", "instance-1")?.title).toBe("Page");
    expect(cache.get("local", "instance-1")?.title).toBe("Other");
    expect(Object.isFrozen(cache.get("local", "instance-1"))).toBe(true);
    expect(browserCacheKey("a|b", "c") === browserCacheKey("a", "b|c")).toBe(false);
  });

  it("keeps a tab's site-permission prompt state for display only, bounded", () => {
    const cache = createBrowserCache();
    cache.update(view({ sitePermission: { state: "waiting", origin: "https://cam.example", permissions: ["camera", "microphone"] } }));
    expect(cache.get("ssh-other", "instance-1")?.sitePermission).toEqual({ state: "waiting", origin: "https://cam.example", permissions: ["camera", "microphone"] });
    cache.update(view({ sitePermission: { state: "bogus" as "waiting", origin: "https://cam.example", permissions: [] } }));
    expect(cache.get("ssh-other", "instance-1")?.sitePermission).toBeUndefined();
  });

  it("drops stale page generations without refetching or rolling back metadata", () => {
    const cache = createBrowserCache();
    const listener = vi.fn();
    const off = cache.subscribe(listener);
    cache.update(view({ pageGeneration: 3, title: "New" }));
    expect(cache.update(view({ pageGeneration: 2, title: "Old" }))).toBe(false);
    expect(cache.get("ssh-other", "instance-1")?.title).toBe("New");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    cache.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("sanitizes metadata and retains invalidation until the UI instance is actually removed", () => {
    const cache = createBrowserCache();
    cache.update(view({ url: "http://u:p@localhost/?ticket=x", favicon: "https://localhost/favicon" }));
    expect(cache.get("ssh-other", "instance-1")).toMatchObject({ url: "http://localhost/", favicon: undefined });
    cache.update(view({ status: "closed" }));
    expect(cache.get("ssh-other", "instance-1")?.status).toBe("closed");
    cache.remove("ssh-other", "instance-1");
    expect(cache.get("ssh-other", "instance-1")).toBeUndefined();
  });
});

describe("I2b explicit browser controls", () => {
  it("keeps a do-not-sign-in banner for isolated tabs without any agent grant, including after navigation", () => {
    browserCache.update(view({ pool: "agent", error: undefined }));
    const html = renderToStaticMarkup(createElement(BrowserBody, props()));
    expect(html).toContain("data-browser-isolated-warning"); expect(html).toContain("browser.origins.doNotSignIn");
    browserCache.update(view({ pool: "agent", url: "http://localhost/next", pageGeneration: 2 }));
    expect(renderToStaticMarkup(createElement(BrowserBody, props()))).toContain("browser.origins.doNotSignIn");
    browserCache.update(view({ pool: "owner", pageGeneration: 3 }));
    expect(renderToStaticMarkup(createElement(BrowserBody, props()))).not.toContain("data-browser-isolated-warning");
    expect(zhCN["browser.origins.doNotSignIn"]).toContain("不要在此登录"); expect(en["browser.origins.doNotSignIn"]).toContain("Do not sign in here");
  });
  const controls = { hostId: "ssh-other", tabKey: "instance-1" };
  const granted = { grantee: "Agent", state: "granted", operating: false } as const;
  function enable() { browserActivation.complete(browserActivation.begin()); }

  it("offers product agent controls independently of the developer flag and reads without IPC", () => {
    browserCache.update(view({ control: granted }));
    expect(renderToStaticMarkup(createElement(BrowserControlHeader, controls))).toContain("data-browser-agent-select");
    expect(renderToStaticMarkup(createElement(BrowserControlBanner, controls))).toBe("");
    browserCache.update(view());
    expect(renderToStaticMarkup(createElement(BrowserControlHeader, controls))).toContain("browser.owner.grant");
    expect(renderToStaticMarkup(createElement(BrowserControlBanner, controls))).toBe("");
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
  });

  it("shows the login warning and revoke in both granted and paused UI; only paused offers resume", () => {
    enable();
    const lease = { leaseId: "lease-1", sessionId: "agent-1", agentName: "Test agent", state: "active", origin: "owner" } as const;
    browserCache.update(view({ control: granted, lease }));
    const header = renderToStaticMarkup(createElement(BrowserControlHeader, controls));
    const banner = renderToStaticMarkup(createElement(BrowserControlBanner, controls));
    expect(header).toContain("browser.owner.revoke");
    expect(banner).toContain("browser.owner.revoke");
    expect(banner).toContain("browser.owner.loginOwner");
    expect(banner).toContain("browser.owner.granted");
    expect(banner.includes("browser.owner.resume")).toBe(false);
    browserCache.update(view({ control: { ...granted, state: "paused" }, lease }));
    const paused = renderToStaticMarkup(createElement(BrowserControlBanner, controls));
    expect(paused).toContain("browser.owner.paused");
    expect(paused).toContain("browser.owner.resume");
    expect(paused).toContain("browser.owner.revoke");
    expect(fakes.hostApi.grantAgent).toHaveBeenCalledTimes(0);
  });

  it("preserves immutable control metadata and derives outline/tab busy solely from main", () => {
    const control = { ...granted, operating: true };
    browserCache.update(view({ control }));
    control.operating = false;
    expect(browserCache.get("ssh-other", "instance-1")?.control?.operating).toBe(true);
    expect(Object.isFrozen(browserCache.get("ssh-other", "instance-1")?.control)).toBe(true);
    function Busy() { return createElement("span", null, String(useBrowserTab(props()).busy)); }
    expect(renderToStaticMarkup(createElement(Busy))).toContain("true");
    const html = renderToStaticMarkup(createElement(BrowserBody, props({ visible: false, revealed: 99 })));
    expect(html).toContain('data-browser-operating="true"');
    expect(html).toContain("ring-inset");
    browserCache.update(view({ control: granted }));
    expect(renderToStaticMarkup(createElement(Busy))).toContain("undefined");
    expect(renderToStaticMarkup(createElement(BrowserBody, props())).includes("data-browser-operating")).toBe(false);
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
    expect(fakes.hostApi.grantAgent).toHaveBeenCalledTimes(0);
  });

  it("normalizes persisted settings and exposes a searchable, module-owned section", () => {
    expect(normalizeBrowserControlSettings(null)).toEqual({ hiddenTarget: "reveal", viewport: { width: 1280, height: 720 }, idleDetachSeconds: 30 });
    expect(normalizeBrowserControlSettings({ hiddenTarget: "reject", viewport: { width: 320, height: 2160 }, idleDetachSeconds: 600 })).toEqual({ hiddenTarget: "reject", viewport: { width: 320, height: 2160 }, idleDetachSeconds: 600 });
    expect(normalizeBrowserControlSettings({ hiddenTarget: "focus", viewport: { width: 319, height: Infinity }, idleDetachSeconds: 4 })).toEqual(DEFAULT_BROWSER_CONTROL_SETTINGS);
    const section = browserModule.contributes!["settings.page"]![0]!;
    expect(section.id).toBe("browser.settings");
    expect(section.keywords).toEqual(expect.arrayContaining(["browser.hiddenTarget", "browser.viewportWidth", "browser.viewportHeight", "browser.idleDetach"]));
    const html = renderToStaticMarkup(createElement(BrowserSettings));
    for (const label of ["browser.hiddenTarget", "browser.viewportWidth", "browser.viewportHeight", "browser.idleDetach", "browser.owner.settingsHint"]) expect(html).toContain(label);
    // This device's rows come first, the host's permissions in their own part after them.
    expect(html.indexOf("browser.part.device")).toBeLessThan(html.indexOf("browser.hiddenTarget"));
    expect(html.indexOf("browser.idleDetach")).toBeLessThan(html.indexOf("browser.part.host"));
    expect(html.indexOf("browser.part.host")).toBeLessThan(html.indexOf("browser.host.settings"));
    expect(fakes.hostApi.grantAgent).toHaveBeenCalledTimes(0);
    expect(fakes.savePref).toHaveBeenCalledTimes(0);
  });

  it("settings persist only normalized preferences and never auto-grant/resume", () => {
    fakes.pref = { hiddenTarget: "reject", viewport: { width: 1440, height: 900 }, idleDetachSeconds: 15, grant: true, guestId: "not-a-pref" };
    function Probe() {
      const [settings, save] = useBrowserControlSettings();
      save(settings);
      return createElement("span", null, JSON.stringify(settings));
    }
    expect(renderToStaticMarkup(createElement(Probe))).toContain("1440");
    expect(fakes.savePref).toHaveBeenCalledWith({ hiddenTarget: "reject", viewport: { width: 1440, height: 900 }, idleDetachSeconds: 15 });
    expect(fakes.hostApi.grantAgent).toHaveBeenCalledTimes(0);
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
  });

  it("reveal targets only the existing exact host-bound instance in the current scope", async () => {
    const controller = new AbortController(), open = vi.fn(), reveal = vi.fn(), list = vi.fn(() => [props().instance]);
    await startBrowser({ signal: controller.signal, services: { side: { open, reveal, list } } } as unknown as AppModuleContext);
    const event: BrowserEvent = { ...view(), epoch: "epoch", kind: "reveal" };
    const emit = (next: BrowserEvent) => { for (const listener of fakes.listeners) listener(next); };
    emit(event);
    expect(list).toHaveBeenCalledWith(BROWSER_TAB);
    expect(reveal).toHaveBeenCalledWith({ instanceId: "scope-local-id" });
    list.mockReturnValue([]); emit(event);
    list.mockReturnValue([props({ instance: { ...props().instance, binding: { kind: "host", hostId: "local" } } }).instance]); emit(event);
    list.mockReturnValue([props().instance]); emit({ ...event, epoch: "old" }); emit({ ...event, pageGeneration: 0 }); emit({ ...event, tabKey: "missing" });
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(0);
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
    controller.abort();
  });

  it("redacts sig/jwt/bearer/otp query words without swallowing unrelated substrings", () => {
    expect(safeBrowserUrl("http://localhost/?sig=a&jwt=b&bearer=c&otp=d&X-Sig=e&auth_jwt=f&BEARER=g&otp-code=h&signal=ok&design=ok&jwtish=ok&bearerish=ok&totp=ok"))
      .toBe("http://localhost/?signal=ok&design=ok&jwtish=ok&bearerish=ok&totp=ok");
    expect(safeBrowserUrl("cutex:service/docs/page%3Fsig%3Dx%26jwt%3Dy%26tab%3D2")).toBe("cutex:service/docs/page%3Ftab%3D2");
  });
});

describe("guest mount lifecycle", () => {
  it("same-host epoch replacement serializes teardown and remount even without a closed event", async () => {
    const lifecycle = createGuestLifecycle();
    let epoch = "old";
    let finish!: (value: BrowserTabMount) => void;
    const first = new Promise<BrowserTabMount>((resolve) => { finish = resolve; });
    const calls: string[] = [];
    const api = { open: vi.fn(async () => { calls.push(`open:${epoch}`); return calls.length === 1 ? first : mount(); }), close: vi.fn(async () => { calls.push(`close:${epoch}`); }) };
    const oldAttach = vi.fn(), newAttach = vi.fn(), failed = vi.fn();
    const releaseOld = lifecycle.mount("ssh-other", "instance-1", "about:blank", api, oldAttach, failed, () => epoch === "old");
    await flush();
    epoch = "new";
    releaseOld();
    const releaseNew = lifecycle.mount("ssh-other", "instance-1", "about:blank", api, newAttach, failed, () => epoch === "new");
    finish(mount());
    await flush();
    expect(calls).toEqual(["open:old", "close:new", "open:new"]);
    expect(oldAttach).toHaveBeenCalledTimes(0);
    expect(newAttach).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(0);
    releaseNew();
    await flush();
  });

  it("host delivery finishes before mount IPC, and a removed connection never falls back", async () => {
    const lifecycle = createGuestLifecycle();
    let delivering = true;
    const api = { open: vi.fn(async () => { expect(delivering).toBe(false); return mount(); }), close: vi.fn(async () => {}) };
    const release = lifecycle.mount("ssh-other", "instance-1", "about:blank", api, vi.fn(), vi.fn(), () => browserHostCurrent("ssh-other", "epoch"));
    expect(api.open).toHaveBeenCalledTimes(0);
    setHosts(hosts([["local", "focus-epoch"]]));
    delivering = false;
    await flush();
    expect(api.open).toHaveBeenCalledTimes(0);
    release();
    await flush();
    expect(api.close).toHaveBeenCalledWith("instance-1", { unmount: true });
    const events = ["delivery"];
    const work = afterBrowserHostsDelivered().then(() => { events.push("ipc"); });
    events.push("delivered");
    await work;
    expect(events).toEqual(["delivery", "delivered", "ipc"]);
  });

  it("a pending dom-ready receipt from a replaced connection is ignored", async () => {
    const lifecycle = createGuestLifecycle();
    const api = { open: vi.fn(async () => mount()), close: vi.fn(async () => {}) };
    let confirm!: (id: number) => Promise<void>;
    const release = lifecycle.mount("ssh-other", "instance-1", "about:blank", api, (_mount, callback) => { confirm = callback; }, vi.fn(), () => browserHostCurrent("ssh-other", "epoch"));
    await flush();
    setHosts(hosts([["local", "focus-epoch"], ["ssh-other", "replacement"]]));
    await confirm(123);
    expect(api.open).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it("serializes slow open → unmount → replacement open without attaching the stale result", async () => {
    const lifecycle = createGuestLifecycle();
    let resolveFirst!: (value: BrowserTabMount) => void;
    const first = new Promise<BrowserTabMount>((resolve) => { resolveFirst = resolve; });
    const calls: string[] = [];
    const api = { open: vi.fn(async () => { calls.push("open"); return calls.length === 1 ? first : mount(); }), close: vi.fn(async () => { calls.push("unmount"); }) };
    const attachFirst = vi.fn();
    const attachSecond = vi.fn();
    const failed = vi.fn();
    const release = lifecycle.mount("ssh-other", "instance-1", "about:blank", api, attachFirst, failed);
    await flush();
    release();
    const releaseSecond = lifecycle.mount("ssh-other", "instance-1", "about:blank", api, attachSecond, failed);
    resolveFirst(mount());
    await flush();
    expect(calls).toEqual(["open", "unmount", "open"]);
    expect(attachFirst).toHaveBeenCalledTimes(0);
    expect(attachSecond).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(0);
    expect(api.close).toHaveBeenCalledWith("instance-1", { unmount: true });
    releaseSecond();
    await flush();
  });

  it("a synchronously cancelled mount does not even open; cleanup is idempotent", async () => {
    const api = { open: vi.fn(async () => mount()), close: vi.fn(async () => {}) };
    const release = createGuestLifecycle().mount("h", "i", "about:blank", api, vi.fn(), vi.fn());
    release(); release();
    await flush();
    expect(api.open).toHaveBeenCalledTimes(0);
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it("confirms the actual blank guest once using the original reservation, never a page URL", async () => {
    const lifecycle = createGuestLifecycle();
    const api = { open: vi.fn(async () => mount()), close: vi.fn(async () => {}) };
    let confirm!: (id: number) => Promise<void>;
    const release = lifecycle.mount("h", "instance-1", "http://localhost:8080/", api, (_mount, callback) => { confirm = callback; }, vi.fn());
    await flush();
    await confirm(123);
    await confirm(456);
    expect(api.open).toHaveBeenCalledTimes(2);
    expect(api.open).toHaveBeenLastCalledWith("instance-1", "http://localhost:8080/", { src: mount().src, webContentsId: 123 });
    release();
    await flush();
  });

  it("a dom-ready arriving after unmount cannot confirm a detached guest", async () => {
    const lifecycle = createGuestLifecycle();
    const api = { open: vi.fn(async () => mount()), close: vi.fn(async () => {}) };
    let confirm!: (id: number) => Promise<void>;
    const release = lifecycle.mount("h", "i", "about:blank", api, (_mount, callback) => { confirm = callback; }, vi.fn());
    await flush();
    release();
    await confirm(123);
    await flush();
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it("invalid owner-UI receipts fail closed before IPC", async () => {
    const lifecycle = createGuestLifecycle();
    const api = { open: vi.fn(async () => mount()), close: vi.fn(async () => {}) };
    const failed = vi.fn();
    let confirm!: (id: number) => Promise<void>;
    const release = lifecycle.mount("h", "i", "about:blank", api, (_mount, callback) => { confirm = callback; }, failed);
    await flush();
    await confirm(Number.NaN);
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    release();
    await flush();
  });

  it("actual close retires the instance, and a late open cannot attach it", async () => {
    const lifecycle = createGuestLifecycle();
    let resolve!: (value: BrowserTabMount) => void;
    const api = { open: vi.fn(() => new Promise<BrowserTabMount>((yes) => { resolve = yes; })), close: vi.fn(async () => {}) };
    const attach = vi.fn();
    lifecycle.mount("h", "i", "about:blank", api, attach, vi.fn());
    await flush();
    const close = lifecycle.close("h", "i", api);
    resolve(mount("i"));
    await close;
    lifecycle.mount("h", "i", "about:blank", api, attach, vi.fn());
    await flush();
    expect(api.close).toHaveBeenCalledWith("i");
    expect(attach).toHaveBeenCalledTimes(0);
    expect(api.open).toHaveBeenCalledTimes(1);
  });

  it("a failure cannot wedge the per-instance queue and unrelated hosts do not wait", async () => {
    const lifecycle = createGuestLifecycle();
    const failed = vi.fn();
    const api = { open: vi.fn(async () => { throw new Error("rejected"); }), close: vi.fn(async () => {}) };
    const release = lifecycle.mount("h", "i", "about:blank", api, vi.fn(), failed);
    const other = { open: vi.fn(async () => mount()), close: vi.fn(async () => {}) };
    const attached = vi.fn();
    const releaseOther = lifecycle.mount("other", "i", "about:blank", other, attached, failed);
    await flush();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(attached).toHaveBeenCalledTimes(1);
    release(); releaseOther();
    await flush();
    expect(api.close).toHaveBeenCalledTimes(1);
  });
});

describe("I2a module integration", () => {
  it("connection identity follows only the bound host, not focus or unrelated metadata", () => {
    const before = hosts([["local", "focus-epoch"], ["ssh-other", "epoch"]]);
    const focusChanged = hosts([["local", "focus-epoch"], ["ssh-other", "epoch"]], "ssh-other");
    expect(changedBrowserHosts(before, focusChanged)).toEqual([]);
    expect(browserHostEpoch(focusChanged, "ssh-other")).toBe("epoch");
    expect(browserHostEpoch(focusChanged, "missing")).toBeNull();
    expect(browserHostEpoch(focusChanged, null)).toBeNull();
    expect(changedBrowserHosts(before, hosts([["local", "focus-epoch"], ["ssh-other", "new"]]))).toEqual(["ssh-other"]);
    expect(changedBrowserHosts(before, hosts([["local", "focus-epoch"]]))).toEqual(["ssh-other"]);
  });

  it("hostsState clears old-epoch metadata even when the closed browserEvent was dropped", async () => {
    const controller = new AbortController();
    const open = vi.fn();
    await startBrowser({ signal: controller.signal, services: { side: { open } } } as unknown as AppModuleContext);
    browserCache.update(view({ loading: true }));
    browserCache.update(view({ hostId: "local", title: "Other host" }));
    setHosts(hosts([["local", "focus-epoch"], ["ssh-other", "replacement"]]));
    expect(browserCache.get("ssh-other", "instance-1")).toBeUndefined();
    expect(browserCache.get("local", "instance-1")?.title).toBe("Other host");
    for (const listener of fakes.listeners) listener({ ...view(), epoch: "epoch", kind: "new-tab", newTabUrl: "http://localhost/old" });
    expect(browserCache.get("ssh-other", "instance-1")).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(0);
    for (const listener of fakes.listeners) listener({ ...view({ guestId: "replacement-guest", pageGeneration: 0 }), epoch: "replacement", kind: "changed" });
    expect(browserCache.get("ssh-other", "instance-1")?.guestId).toBe("replacement-guest");
    setHosts(hosts([["local", "focus-epoch"]]));
    expect(browserCache.get("ssh-other", "instance-1")).toBeUndefined();
    expect(fakes.hostApi.open).toHaveBeenCalledTimes(0);
    expect(fakes.hostApi.list).toHaveBeenCalledTimes(0);
    controller.abort();
    expect(fakes.storeListeners.size).toBe(0);
  });

  it("popup diagnostics never disturb the owner's cache, busy state or side layout", async () => {
    const controller = new AbortController();
    const open = vi.fn();
    await startBrowser({ signal: controller.signal, services: { side: { open } } } as unknown as AppModuleContext);
    browserCache.update(view());
    const previous = browserCache.get("ssh-other", "instance-1");
    for (const listener of fakes.listeners) listener({ ...view({ title: "Do not display", loading: true, error: "Do not show" }), epoch: "epoch", kind: "diagnostic", popupDiscardReason: "no_owner_gesture", newTabUrl: "http://localhost/rejected" });
    expect(browserCache.get("ssh-other", "instance-1")).toBe(previous);
    expect(browserCache.get("ssh-other", "instance-1")?.loading).toBe(false);
    expect(browserCache.get("ssh-other", "instance-1")?.error).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(0);
    expect(fakes.hostApi.open).toHaveBeenCalledTimes(0);
    controller.abort();
  });

  it("a removed bound host hides stale guest content and disables its controls", () => {
    browserCache.update(view({ loading: true }));
    setHosts(hosts([["local", "focus-epoch"]]));
    const html = renderToStaticMarkup(createElement(BrowserBody, props()));
    expect(html).toContain("browser.noHost");
    expect(html).toContain("visibility:hidden");
    expect(html.includes("browser.starting")).toBe(false);
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
  });

  it("the local mount gate cannot enable after its activation was cancelled or replaced", () => {
    const gate = createBrowserActivation();
    const first = gate.begin();
    expect(gate.get()).toBe(false);
    const second = gate.begin();
    gate.complete(first);
    expect(gate.get()).toBe(false);
    gate.complete(second);
    expect(gate.get()).toBe(true);
    expect(gate.end(first)).toBe(false);
    expect(gate.get()).toBe(true);
    gate.end(second);
    gate.complete(second);
    expect(gate.get()).toBe(false);
  });

  it("waits for main enable acknowledgement and revokes immediately if disposed while waiting", async () => {
    let finish!: () => void;
    fakes.browser.setEnabled.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const context = { signal: controller.signal, services: { side: { open: vi.fn() } } } as unknown as AppModuleContext;
    const activation = startBrowser(context);
    expect(browserActivation.get()).toBe(false);
    expect(fakes.browser.subscribe).toHaveBeenCalledTimes(0);
    controller.abort();
    expect(fakes.browser.setEnabled).toHaveBeenLastCalledWith(false);
    finish();
    await activation;
    expect(browserActivation.get()).toBe(false);
    expect(fakes.browser.subscribe).toHaveBeenCalledTimes(0);
  });

  it("is default-off, host-bound, multi-instance, hidden keepAlive and in the browser page group", () => {
    const component = browserModule.contributes!["side.component"]![0]!;
    expect(browserModule.id).toBe("browser");
    expect(browserModule.defaultEnabled ?? true).toBe(true);
    expect(component).toMatchObject({ id: "browser.tab", instances: "multi", defaultBinding: "host", keepAlive: "hidden", placement: { home: "browser" }, tabRow: "always" });
    expect(component.launcher!.params()).toEqual({ url: "about:blank" });
    expect(component.peekable).toBeUndefined();
    expect(component.dedupeKey).toBeUndefined();
    expect(component.fromRef!({ url: "file:///private" })).toBeNull();
  });

  it("useTab is a read-only cache consumer even when no Body is mounted", () => {
    function Probe() { return createElement("span", null, useBrowserTab(props()).title); }
    expect(renderToStaticMarkup(createElement(Probe))).toContain("Saved title");
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
    expect(fakes.browser.subscribe).toHaveBeenCalledTimes(0);
    expect(fakes.hostApi.open).toHaveBeenCalledTimes(0);
    expect(fakes.hostApi.list).toHaveBeenCalledTimes(0);
  });

  it("preview has an inert placeholder without a real webview", () => {
    fakes.bridge.browser = undefined;
    const html = renderToStaticMarkup(createElement(BrowserBody, props()));
    expect(html).toContain("browser.preview");
    expect(html.includes("<webview")).toBe(false);
    expect(fakes.hostApi.open).toHaveBeenCalledTimes(0);
  });

  it("renders cached crash and loading states without replacing the webview host", () => {
    browserCache.update(view({ status: "crashed", error: "blocked", url: "http://localhost/" }));
    const crash = renderToStaticMarkup(createElement(BrowserBody, props()));
    expect(crash).toContain("browser.crashed");
    expect(crash).toContain("data-browser-viewport");
    expect(crash).toContain("visibility:hidden");
    browserCache.update(view({ loading: true, canGoBack: true }));
    const loading = renderToStaticMarkup(createElement(BrowserBody, props({ visible: false })));
    expect(loading).toContain("browser.loading");
    expect(loading).toContain("browser.stop");
    expect(loading).toContain("data-browser-viewport");
    expect(fakes.hostApi.open).toHaveBeenCalledTimes(0);
  });

  it("tab metadata reads the resolved host, not another host with the same instance id", () => {
    browserCache.update(view({ hostId: "local", title: "Wrong" }));
    browserCache.update(view({ title: "Correct", loading: true }));
    function Probe() { const tab = useBrowserTab(props()); return createElement("span", null, `${tab.title}:${String(tab.busy)}`); }
    expect(renderToStaticMarkup(createElement(Probe))).toContain("Correct:true");
    expect(fakes.browser.forHost).toHaveBeenCalledTimes(0);
  });

  it("long live URLs remain visible, with an explicit warning that they cannot be persisted", () => {
    const url = `http://localhost/${"a".repeat(2100)}`;
    browserCache.update(view({ url }));
    expect(browserCache.get("ssh-other", "instance-1")?.url).toBe(url);
    const html = renderToStaticMarkup(createElement(BrowserBody, props()));
    expect(html).toContain(url);
    expect(html).toContain("browser.longUrl");
    expect(html.includes("browser.blank")).toBe(false);
  });

  it("events open gesture-approved child tabs in the event host, with no host focus lookup", async () => {
    const controller = new AbortController();
    const open = vi.fn();
    const context = { signal: controller.signal, services: { side: { open } } } as unknown as AppModuleContext;
    await startBrowser(context);
    expect(fakes.browser.setEnabled).toHaveBeenCalledWith(true);
    expect(browserActivation.get()).toBe(true);
    const event: BrowserEvent = { ...view(), epoch: "epoch", kind: "new-tab", newTabUrl: "http://localhost:8080/new" };
    for (const listener of fakes.listeners) listener(event);
    expect(open).toHaveBeenCalledWith("browser.tab", { url: "http://localhost:8080/new" }, { binding: { kind: "host", hostId: "ssh-other" }, focus: false });
    expect(browserCache.get("ssh-other", "instance-1")?.title).toBe("Page");
    for (const listener of fakes.listeners) listener({ ...event, newTabUrl: "javascript:alert(1)" });
    expect(open).toHaveBeenCalledTimes(1);
    // 0.1.3: main mints the owner tab's key (it holds the exact URL / form body for it).
    const key = "0b9c7c58-35a8-4d0e-9c1e-3c0f5d3a1e2f";
    for (const listener of fakes.listeners) listener({ ...event, newTabUrl: "http://localhost:8080/post", newTabKey: key });
    expect(open).toHaveBeenLastCalledWith("browser.tab", { url: "http://localhost:8080/post", tabKey: key, ownerTab: true }, { binding: { kind: "host", hostId: "ssh-other" }, focus: false });
    controller.abort();
    expect(fakes.browser.setEnabled).toHaveBeenLastCalledWith(false);
    expect(browserActivation.get()).toBe(false);
    expect(fakes.listeners.size).toBe(0);
    expect(browserCache.get("ssh-other", "instance-1")).toBeUndefined();
  });

  it("ignores stale new-tab events and cannot subscribe after module disposal", async () => {
    const controller = new AbortController();
    const open = vi.fn();
    const context = { signal: controller.signal, services: { side: { open } } } as unknown as AppModuleContext;
    await startBrowser(context);
    browserCache.update(view({ pageGeneration: 5 }));
    for (const listener of fakes.listeners) listener({ ...view(), epoch: "epoch", kind: "new-tab", newTabUrl: "http://localhost/" });
    expect(open).toHaveBeenCalledTimes(0);
    controller.abort();
    await startBrowser(context);
    expect(fakes.listeners.size).toBe(0);
  });

  it("close delegates to the instance binding's host, never the focus host", async () => {
    fakes.hostApi.close.mockResolvedValue(undefined);
    const component = browserModule.contributes!["side.component"]![0]!;
    expect(await component.onClose!(props().instance)).toBe(true);
    expect(fakes.browser.forHost).toHaveBeenCalledWith("ssh-other");
    expect(fakes.hostApi.close).toHaveBeenCalledWith("instance-1");
  });

  it("has matching English and Chinese translation keys", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(en).every((key) => key.startsWith("browser."))).toBe(true);
  });
});
