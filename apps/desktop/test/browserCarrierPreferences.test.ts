import { describe, expect, it, vi } from "vitest";
import { BrowserCarrierPreferencesStore } from "../src/main/browser/carrierPreferences";
import { createBrowserChannel, parseBrowserRequest } from "../src/main/browser/channel";
import { browserBridge } from "../src/preload/browser";
import { BROWSER_CHANNEL } from "../src/shared/browser";
import { DEFAULT_BROWSER_CARRIER_FRAME_RATE } from "../src/shared/browserCarrier";

describe("main-owned 「后台网页帧率」", () => {
  it("defaults to 15, persists 30, reloads it and falls back to 15 on bad data", () => {
    let text = "bad json";
    const io = { read: () => text, write: vi.fn((_path: string, next: string) => { text = next; }) };
    const store = new BrowserCarrierPreferencesStore("carrier.json", io);
    expect(store.get()).toEqual({ frameRate: DEFAULT_BROWSER_CARRIER_FRAME_RATE });
    expect(store.set(30)).toEqual({ frameRate: 30 });
    expect(JSON.parse(text)).toEqual({ frameRate: 30 });
    expect(new BrowserCarrierPreferencesStore("carrier.json", io).get()).toEqual({ frameRate: 30 });
    expect(new BrowserCarrierPreferencesStore("carrier.json", { read: () => '{"frameRate":60}', write: () => {} }).get()).toEqual({ frameRate: 15 });
    const count = io.write.mock.calls.length;
    expect(() => store.set(60 as 30)).toThrow("invalid_browser_request"); expect(io.write).toHaveBeenCalledTimes(count);
  });
  it("does not acknowledge a rate when persistence fails", () => {
    const store = new BrowserCarrierPreferencesStore("carrier.json", { read: () => '{"frameRate":30}', write: () => { throw Error("disk"); } });
    expect(store.get().frameRate).toBe(30); expect(() => store.set(15)).toThrow("disk"); expect(store.get().frameRate).toBe(30);
  });
  it.each([60, 0, "30", null, 30.5, {}, true])("rejects frame rate %j at IPC", frameRate => {
    expect(() => parseBrowserRequest({ op: "carrierFrameRate", frameRate })).toThrow("invalid_browser_request");
  });
  it("requires the app sender, works while the module is disabled and needs no host", async () => {
    const store = new BrowserCarrierPreferencesStore(null), execute = vi.fn();
    const channel = createBrowserChannel({ isAppSender: (sender: string) => sender === "app", isEnabled: () => false, getHosts: () => null, setEnabled: () => {}, execute,
      carrierFrameRate: frameRate => frameRate === undefined ? store.get() : store.set(frameRate) });
    await expect(channel("guest", { op: "carrierFrameRate", frameRate: 30 }, null)).rejects.toThrow("untrusted_sender");
    await expect(channel("app", { op: "carrierFrameRate", frameRate: 30 }, null)).resolves.toEqual({ frameRate: 30 });
    await expect(channel("app", { op: "carrierFrameRate" }, null)).resolves.toEqual({ frameRate: 30 });
    expect(execute).not.toHaveBeenCalled();
    expect(() => parseBrowserRequest({ op: "carrierFrameRate", frameRate: 30, hostId: "x" })).toThrow();
  });
  it("preload sends only the typed request with no host binding", async () => {
    const invoke = vi.fn(async () => ({ frameRate: 15 }));
    const bridge = browserBridge({ invoke, binding: () => null, subscribe: () => () => {} });
    await bridge.carrierFrameRate(); await bridge.carrierFrameRate(30);
    expect(invoke.mock.calls).toEqual([[BROWSER_CHANNEL, { op: "carrierFrameRate" }, null], [BROWSER_CHANNEL, { op: "carrierFrameRate", frameRate: 30 }, null]]);
  });
});
