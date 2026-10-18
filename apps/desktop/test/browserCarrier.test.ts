import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateBrowserAttach } from "../src/main/browser/attachPolicy";

// Guard tests for the background carrier (owner option C, 2026-10-18): main's offscreen window of an
// agent-pool tab must get exactly the hardened webview guest preferences plus offscreen rendering,
// the agent partition only, its popup guard before any URL, and never a visible surface.
const electron = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class ContentsMock extends EventEmitter {
    destroyed = false;
    loads: string[] = [];
    setFrameRate = vi.fn();
    isDestroyed() { return this.destroyed; }
    close = vi.fn(() => { if (!this.destroyed) { this.destroyed = true; this.emit("destroyed"); } });
    loadURL = vi.fn(async (url: string) => { this.loads.push(url); });
  }
  class BrowserWindow extends EventEmitter {
    destroyed = false;
    readonly webContents = new ContentsMock();
    hide = vi.fn();
    constructor(readonly options: Record<string, any>) { super(); electron.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy = vi.fn(() => { if (!this.destroyed) { this.destroyed = true; this.emit("closed"); } });
  }
  return { BrowserWindow };
});
import { browserCarrierPreferences, BROWSER_CARRIER_FRAME_RATE, BROWSER_THUMBNAIL_INTERVAL_MS, createBrowserCarrier } from "../src/main/browser/carrier";

afterEach(() => { electron.windows.length = 0; vi.useRealTimers(); });

/** The exact preference bag main enforces for a webview guest of the same pool (attachPolicy). */
function webviewPreferences(partition: string): Record<string, unknown> {
  const prefs: Record<string, unknown> = { preload: "file:///forbidden.js", nodeIntegration: true, partition };
  const result = evaluateBrowserAttach({ moduleEnabled: true, popupGuardInstalled: true, registeredHostIds: ["local"], appWebContentsId: 1, senderWebContentsId: 1,
    reservation: { attachId: "a".repeat(64), hostId: "local", partition }, params: { partition, src: `about:blank#cutex-browser-attach=${"a".repeat(64)}` }, webPreferences: prefs });
  expect(result.allowed).toBe(true);
  return prefs;
}

describe("background carrier preferences", () => {
  it("are the webview guest hardening plus offscreen rendering, in the host's agent partition only", () => {
    const carrier = browserCarrierPreferences("local") as Record<string, unknown>;
    const webview = webviewPreferences("persist:browser-agent-local");
    // disablePopups is a <webview>-only switch; a window's popups go to setWindowOpenHandler (guarded).
    const { disablePopups: _popups, ...shared } = webview;
    expect(carrier).toEqual({ ...shared, offscreen: true, backgroundThrottling: false });
    expect(carrier.partition).toBe("persist:browser-agent-local");
    for (const key of ["preload", "nodeIntegration", "nodeIntegrationInWorker", "nodeIntegrationInSubFrames", "webviewTag", "plugins", "allowRunningInsecureContent"])
      expect(carrier[key] === undefined || carrier[key] === false).toBe(true);
    expect(carrier).not.toHaveProperty("preload");
    expect(carrier).toMatchObject({ sandbox: true, contextIsolation: true, webSecurity: true });
  });
  it("cannot be built for an owner partition or an unregistered host id", () => {
    expect(browserCarrierPreferences("ssh-box").partition).toBe("persist:browser-agent-ssh-box");
    for (const host of ["", "../x", "persist:browser-local", "local\n"]) expect(() => browserCarrierPreferences(host)).toThrow();
  });
});

describe("createBrowserCarrier", () => {
  it("creates a hidden, task-bar-less offscreen window, guards it before any URL and never shows it", () => {
    const guard = vi.fn();
    const carrier = createBrowserCarrier({ hostId: "local", viewport: { width: 1280, height: 720 }, guard });
    const window = electron.windows[0];
    expect(window.options).toMatchObject({ show: false, skipTaskbar: true, frame: false, fullscreenable: false, width: 1280, height: 720, useContentSize: true });
    expect(window.options.webPreferences).toEqual(browserCarrierPreferences("local"));
    expect(guard).toHaveBeenCalledExactlyOnceWith(carrier.guest);
    expect(carrier.guest.loadURL).not.toHaveBeenCalled();
    expect(carrier.guest.setFrameRate).toHaveBeenCalledWith(BROWSER_CARRIER_FRAME_RATE);
    window.emit("show");
    expect(window.hide).toHaveBeenCalledOnce();
  });
  it("a failing guard destroys the window at once", () => {
    expect(() => createBrowserCarrier({ hostId: "local", viewport: { width: 800, height: 600 }, guard: () => { throw new Error("guard failed"); } })).toThrow("guard failed");
    expect(electron.windows[0].destroyed).toBe(true);
    expect(electron.windows[0].webContents.destroyed).toBe(true);
  });
  it("closing the page destroys its window, and destroy is idempotent", () => {
    const carrier = createBrowserCarrier({ hostId: "local", viewport: { width: 800, height: 600 }, guard: () => {} });
    carrier.guest.close();
    expect(electron.windows[0].destroyed).toBe(true);
    carrier.destroy(); carrier.destroy();
    expect(electron.windows[0].destroy).toHaveBeenCalledOnce();
  });
  it("sends at most one bounded JPEG thumbnail per interval, only while wanted", () => {
    vi.useFakeTimers();
    let now = 10_000, wanted = true;
    const thumbnail = vi.fn();
    const carrier = createBrowserCarrier({ hostId: "local", viewport: { width: 800, height: 600 }, guard: () => {}, thumbnail, wanted: () => wanted, now: () => now });
    const image = (tag: string) => ({ getSize: () => ({ width: 960, height: 540 }), resize: vi.fn(() => ({ toJPEG: () => Buffer.from(tag) })), toJPEG: () => Buffer.from(tag) });
    carrier.guest.emit("paint", {}, {}, image("one"));
    carrier.guest.emit("paint", {}, {}, image("two"));
    vi.advanceTimersByTime(0);
    expect(thumbnail.mock.calls).toEqual([[`data:image/jpeg;base64,${Buffer.from("two").toString("base64")}`]]);
    now += 100; carrier.guest.emit("paint", {}, {}, image("three"));
    vi.advanceTimersByTime(BROWSER_THUMBNAIL_INTERVAL_MS - 200);
    expect(thumbnail).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(200);
    expect(thumbnail).toHaveBeenCalledTimes(2);
    wanted = false; now += 5_000; carrier.guest.emit("paint", {}, {}, image("hidden"));
    vi.advanceTimersByTime(5_000);
    expect(thumbnail).toHaveBeenCalledTimes(2);
  });
});
