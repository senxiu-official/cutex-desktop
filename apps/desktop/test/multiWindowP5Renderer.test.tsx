// @vitest-environment jsdom
// Multi-window P5, renderer side: a browser tab drawn in a desk window creates its <webview> from the desk's own
// document (so that desk embeds the guest and main knows the tab's window from the guest itself), and main's
// events about a tab (`new-tab` popups, `pressed`, `reveal`) act in the window that holds the tab.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserTabMount } from "../src/shared/browser";

const MOUNT: BrowserTabMount = { guestId: "guest-1", tabKey: "desk-tab", partition: "persist:browser-local", src: `about:blank#cutex-browser-attach=${"a".repeat(64)}` };
const fakes = vi.hoisted(() => ({ attached: [] as unknown[], listeners: new Set<(event: unknown) => void>(), ran: [] as [string, string][] }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: {}, apiFor: () => ({}), cleanIpcMessage: (m: string) => m, onEvent: () => () => {},
  bridge: { on: () => () => {}, api: { openExternal: vi.fn() }, browser: { forHost: () => ({ open: vi.fn(), close: vi.fn(async () => {}), holdReady: vi.fn(), releaseLease: vi.fn() }), setEnabled: vi.fn(async () => {}),
    subscribe: (listener: (event: unknown) => void) => { fakes.listeners.add(listener); return () => fakes.listeners.delete(listener); } } },
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useModulePref: (_id: string, _key: string, fallback: unknown) => [fallback, vi.fn()] }));
vi.mock("../src/renderer/src/modules/browser/tabs", async (importOriginal) => ({ ...(await importOriginal<object>()), useBrowserEnabled: () => true, useBrowserView: () => undefined }));
vi.mock("../src/renderer/src/modules/browser/hosts", async (importOriginal) => ({ ...(await importOriginal<object>()), useBrowserHostEpoch: () => "epoch-a", browserHostCurrent: () => true, watchBrowserHosts: () => () => {} }));
vi.mock("../src/renderer/src/modules/browser/activation", async (importOriginal) => ({ ...(await importOriginal<object>()), browserActivation: { get: () => true, begin: () => 1, complete: () => {}, end: () => false } }));
// runtime.ts's handlers of main's tab events record the window they run in (inBrowserTabWindow stays real).
vi.mock("../src/renderer/src/modules/browser/popupOpen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/renderer/src/modules/browser/popupOpen")>();
  const { currentWindow } = await import("../src/renderer/src/lib/windowScope");
  const record = (kind: string) => { fakes.ran.push([kind, currentWindow()]); return {} as never; };
  return { ...actual, openPopupTab: () => record("new-tab"), pressBrowserTab: () => record("pressed"), revealBrowserTab: () => record("reveal") };
});
// The guest lifecycle hands the mount straight to the body (main's reservation; no IPC here).
vi.mock("../src/renderer/src/modules/browser/guestLifecycle", () => ({
  guestLifecycle: {
    keepNext: vi.fn(),
    mount: (_host: string, _tab: string, _url: string, _api: unknown, attach: (mount: BrowserTabMount, confirm: (id: number) => Promise<void>) => void) => {
      attach(MOUNT, async () => {});
      fakes.attached.push(MOUNT);
      return () => {};
    },
    close: vi.fn(),
  },
}));

import { BrowserBody } from "../src/renderer/src/modules/browser/BrowserBody";
import { startBrowser } from "../src/renderer/src/modules/browser/runtime";
import type { ModuleContext } from "../src/renderer/src/modules/slots";
import { inBrowserTabWindow } from "../src/renderer/src/modules/browser/popupOpen";
import { BROWSER_TAB } from "../src/renderer/src/modules/browser/browserState";
import { emptyLayout } from "../src/renderer/src/lib/sideLayout";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { currentWindow, MAIN_WINDOW, resetWindowsForTest } from "../src/renderer/src/lib/windowScope";
import type { SideBodyProps } from "../src/renderer/src/modules/slots";
import type { BrowserState } from "../src/renderer/src/modules/browser/browserState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DESK = "d000000000005";
const tab = (tabKey: string) => ({ ...emptyLayout(), instances: { [`i-${tabKey}`]: { kind: BROWSER_TAB, binding: { kind: "host", hostId: "local" }, key: null, state: { tabKey, url: "https://example.com/" }, v: 1, pinned: true, at: 1 } } }) as never;

afterEach(() => {
  resetWindowsForTest();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("browser tabs in desk windows (renderer, P5)", () => {
  it("the <webview> is created from the desk's own document (that desk embeds the guest), never the main one", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const deskDoc = frame.contentDocument!;
    const root = deskDoc.createElement("div");
    deskDoc.body.append(root);
    const mainCreate = vi.spyOn(document, "createElement");
    const deskCreate = vi.spyOn(deskDoc, "createElement");
    const props: SideBodyProps<BrowserState> = { hostId: "local", sessionId: null, instance: { id: "inst-1", kind: BROWSER_TAB, binding: { kind: "host", hostId: "local" }, state: { url: "http://localhost:26180/", title: "", tabKey: "desk-tab" }, pinned: false },
      setState: vi.fn(), visible: true, active: true, mode: "normal", where: "card", revealed: 0, close: vi.fn(), open: vi.fn(), keepMounted: vi.fn(() => false), held: false, keep: vi.fn() } as SideBodyProps<BrowserState>;
    const app = createRoot(root);
    act(() => app.render(h(BrowserBody, props)));
    expect(fakes.attached).toHaveLength(1);
    const webview = deskDoc.querySelector("webview");
    expect(webview?.getAttribute("src")).toBe(MOUNT.src);
    expect(webview?.getAttribute("partition")).toBe("persist:browser-local");
    expect(deskCreate.mock.calls.some(([tag]) => tag === "webview")).toBe(true);
    expect(mainCreate.mock.calls.some(([tag]) => tag === "webview")).toBe(false);
    expect(document.querySelector("webview")).toBeNull();
    act(() => app.unmount());
  });

  it("main's events about a tab act in the window that holds it (a desk too); held nowhere: the current window", () => {
    useSide.of(DESK).setState({ layout: tab("desk-tab") });
    useSide.of(MAIN_WINDOW).setState({ layout: tab("main-tab") });
    expect(currentWindow()).toBe(MAIN_WINDOW);
    expect(inBrowserTabWindow("local", "desk-tab", () => currentWindow())).toBe(DESK);
    expect(inBrowserTabWindow("local", "main-tab", () => currentWindow())).toBe(MAIN_WINDOW);
    // Another host's tab with the same key is not this one.
    expect(inBrowserTabWindow("ssh-other", "desk-tab", () => currentWindow())).toBe(MAIN_WINDOW);
    expect(inBrowserTabWindow("local", "nobody", () => currentWindow())).toBe(MAIN_WINDOW);
    expect(inBrowserTabWindow("local", undefined, () => currentWindow())).toBe(MAIN_WINDOW);
  });

  it("startBrowser runs main's new-tab / pressed / reveal for a desk tab in that desk", async () => {
    useSide.of(DESK).setState({ layout: tab("desk-tab") });
    const controller = new AbortController();
    await startBrowser({ signal: controller.signal, services: { side: { open: vi.fn(), reveal: vi.fn(), list: vi.fn(() => []) }, ui: { notice: vi.fn() } } } as unknown as ModuleContext);
    const view = { hostId: "local", epoch: "epoch-a", guestId: "guest-1", tabKey: "desk-tab", pageGeneration: 1, url: "http://localhost:26180/", title: "", loading: false, canGoBack: false, canGoForward: false, status: "attached" };
    const emit = (event: object) => { for (const listener of fakes.listeners) listener(event); };
    fakes.ran.length = 0;
    emit({ ...view, kind: "new-tab", newTabUrl: "http://localhost:26180/next" });
    emit({ ...view, kind: "pressed" });
    emit({ ...view, pageGeneration: 2, kind: "reveal" });
    expect(currentWindow()).toBe(MAIN_WINDOW);
    expect(fakes.ran).toEqual([["new-tab", DESK], ["pressed", DESK], ["reveal", DESK]]);
    controller.abort();
  });
});
