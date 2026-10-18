import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrowserTabMount } from "../src/shared/browser";
import { restoreBrowser, safeBrowserThumbnail } from "../src/renderer/src/modules/browser/browserState";
import { createGuestLifecycle } from "../src/renderer/src/modules/browser/guestLifecycle";
import { browserThumbnails, createBrowserThumbnails } from "../src/renderer/src/modules/browser/thumbnails";
import { zhCN, en } from "../src/renderer/src/modules/browser/i18n";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, string>) => values ? `${key}:${JSON.stringify(values)}` : key }) }));
import { BrowserBackgroundView } from "../src/renderer/src/modules/browser/BrowserBackgroundView";

// Renderer side of the background carrier (owner option C, 2026-10-18).
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
const TAB = "12345678-1234-4234-8234-123456789abc";
const JPEG = `data:image/jpeg;base64,${Buffer.from("frame").toString("base64")}`;
const background = (): BrowserTabMount => ({ guestId: "browser-0123456789abcdef", tabKey: TAB, partition: "persist:browser-agent-local", pool: "agent", src: "", carrier: "background" });

describe("background carrier mounts", () => {
  it("needs no webview receipt: attach runs once and open is never called again", async () => {
    const lifecycle = createGuestLifecycle();
    const api = { open: vi.fn(async () => background()), close: vi.fn(async () => {}) };
    const attach = vi.fn((_mount: BrowserTabMount, confirm: (id: number) => Promise<void>) => { void confirm(7); });
    const release = lifecycle.mount("local", TAB, "http://localhost/", api, attach, vi.fn(), () => true, { agentOpened: true, carrier: "background" });
    await flush();
    expect(attach).toHaveBeenCalledOnce(); expect(api.open).toHaveBeenCalledExactlyOnceWith(TAB, "http://localhost/", undefined, { agentOpened: true, carrier: "background" });
    release(); await flush();
    expect(api.close).toHaveBeenCalledWith(TAB, { unmount: true });
  });
  it("a carrier switch remount keeps main's page exactly once (no close / unmount), later releases close again", async () => {
    const lifecycle = createGuestLifecycle();
    const api = { open: vi.fn(async () => background()), close: vi.fn(async () => {}) };
    const first = lifecycle.mount("local", TAB, "http://localhost/", api, vi.fn(), vi.fn());
    await flush();
    lifecycle.keepNext("local", TAB);
    first(); await flush();
    expect(api.close).not.toHaveBeenCalled();
    const second = lifecycle.mount("local", TAB, "http://localhost/", api, vi.fn(), vi.fn());
    await flush();
    second(); await flush();
    expect(api.close).toHaveBeenCalledOnce();
  });
});

describe("background tab state and thumbnails", () => {
  it("restores front only for agent-opened tabs", () => {
    expect(restoreBrowser({ url: "http://localhost/", title: "", tabKey: TAB, agentOpened: true, front: true }, 1)).toMatchObject({ agentOpened: true, front: true });
    expect(restoreBrowser({ url: "http://localhost/", title: "", tabKey: TAB, front: true }, 1)).not.toHaveProperty("front");
  });
  it("accepts only main's bounded JPEG data URL", () => {
    expect(safeBrowserThumbnail(JPEG)).toBe(JPEG);
    for (const value of ["https://example.com/a.jpg", "data:image/png;base64,AAAA", "data:image/jpeg;base64,<script>", `data:image/jpeg;base64,${"A".repeat(256 * 1024)}`, 5, null])
      expect(safeBrowserThumbnail(value)).toBeUndefined();
    const store = createBrowserThumbnails(), listener = vi.fn();
    store.subscribe(listener);
    expect(store.set("local", TAB, "https://example.com/a.jpg")).toBe(false);
    expect(store.set("local", TAB, JPEG)).toBe(true); expect(store.get("local", TAB)).toBe(JPEG);
    store.remove("local", TAB); expect(store.get("local", TAB)).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("the card shows the live picture and one bring-to-front control; during a hand-over both are disabled", () => {
    browserThumbnails.set("local", TAB, JPEG);
    const html = renderToStaticMarkup(createElement(BrowserBackgroundView, { hostId: "local", tabKey: TAB, title: "Page", handover: false, operating: true, agentName: "Reader", onFront: () => {} }));
    expect(html).toContain(`src="${JPEG}"`); expect(html).toContain("data-browser-front");
    expect(html).toContain('browser.background.statusAgent:{&quot;name&quot;:&quot;Reader&quot;}');
    const busy = renderToStaticMarkup(createElement(BrowserBackgroundView, { hostId: "local", tabKey: TAB, title: "Page", handover: true, operating: false, onFront: () => {} }));
    expect(busy).toContain("browser.background.handover"); expect((busy.match(/disabled=""/g) ?? []).length).toBe(2);
    browserThumbnails.clear();
    expect(renderToStaticMarkup(createElement(BrowserBackgroundView, { hostId: "local", tabKey: TAB, title: "Page", handover: false, operating: false, onFront: () => {} }))).toContain("browser.background.noThumbnail");
  });
  it("ships zh-CN and en strings for every background key", () => {
    const keys = ["send", "front", "thumbnailAlt", "noThumbnail", "handover", "statusAgent", "status"].map(key => `browser.background.${key}`);
    for (const key of keys) { expect(zhCN).toHaveProperty([key]); expect(en).toHaveProperty([key]); }
  });
});
