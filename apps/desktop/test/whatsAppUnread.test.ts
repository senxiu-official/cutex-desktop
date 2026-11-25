import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { parseBrowserRequest } from "../src/main/browser/channel";
import { WhatsAppObserver } from "../src/main/browser/whatsAppObserver";
import { isWhatsAppWeb, parseWhatsAppSnapshot, READ_WHATSAPP_UNREAD, WhatsAppUnread, type WhatsAppSnapshot } from "../src/main/browser/whatsAppUnread";

vi.mock("electron", () => ({ safeStorage: {} }));

const ready = (total: number, rows: WhatsAppSnapshot["rows"] = []): WhatsAppSnapshot => ({ state: "ready", total, rows });
const link: WhatsAppSnapshot = { state: "link", total: null, rows: [] };
const unknown: WhatsAppSnapshot = { state: "unknown", total: null, rows: [] };
const alice = (count: number) => ({ key: "fixture-chat-a", count, name: "Test contact", preview: "Synthetic preview" });

describe("WhatsApp unread DOM adapter", () => {
  it("reads bounded synthetic chat badges and refuses an unapproved origin", () => {
    const markup = `<title>(3) WhatsApp</title><main id="pane-side"><div role="row" data-id="fixture-chat-a">
      <div data-testid="cell-frame-title"><span title="Test contact"></span></div>
      <div data-testid="last-msg-text"><span title="Synthetic preview"></span></div>
      <span data-testid="icon-unread-count">3</span>
    </div></main>`;
    const official = new JSDOM(markup, { url: "https://web.whatsapp.com/", runScripts: "outside-only" });
    const unrelated = new JSDOM(markup, { url: "https://web.whatsapp.com.invalid/", runScripts: "outside-only" });
    try {
      expect(parseWhatsAppSnapshot(official.window.eval(READ_WHATSAPP_UNREAD))).toEqual(ready(3, [alice(3)]));
      expect(unrelated.window.eval(READ_WHATSAPP_UNREAD)).toBeNull();
      expect(isWhatsAppWeb("https://user:pass@web.whatsapp.com/")).toBe(false);
    } finally { official.window.close(); unrelated.window.close(); }
  });

  it("recognizes the public linking UI by a structural button without reading the QR", () => {
    const window = new JSDOM(`<title>WhatsApp</title><button>使用电话号码登录</button><canvas data-qr="synthetic-invite"></canvas>`,
      { url: "https://web.whatsapp.com/", runScripts: "outside-only" }).window;
    try { expect(parseWhatsAppSnapshot(window.eval(READ_WHATSAPP_UNREAD))).toEqual(link); }
    finally { window.close(); }
  });

  it("admits only owner-shaped watcher calls without arbitrary page scripts or publisher tokens", () => {
    const request = { op: "setWhatsAppWatch", tabKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", enabled: true, preview: false };
    expect(parseBrowserRequest(request)).toEqual(request);
    expect(() => parseBrowserRequest({ ...request, code: "synthetic" })).toThrow("invalid_browser_request");
    expect(() => parseBrowserRequest({ ...request, token: "synthetic" })).toThrow("invalid_browser_request");
    const unbind = { op: "unbindWhatsAppWatch", tabKey: request.tabKey };
    expect(parseBrowserRequest(unbind)).toEqual(unbind);
    expect(() => parseBrowserRequest({ ...unbind, preview: true })).toThrow("invalid_browser_request");
  });
});

describe("WhatsApp observation policy", () => {
  it("seeds existing unread quietly and announces only new increments", () => {
    const linked = vi.fn(), state = new WhatsAppUnread(false, linked);
    expect(state.observe(ready(2, [alice(2)]), 0, false)).toBeNull();
    expect(state.observe(ready(2, [alice(2)]), 10_000, false)).toBeNull();
    expect(linked).toHaveBeenCalledTimes(1);
    expect(state.observe(ready(3, [alice(3)]), 20_000, false)).toMatchObject({ kind: "unread", count: 1, name: "Test contact", preview: "Synthetic preview" });
    expect(state.observe(ready(3, [alice(3)]), 30_000, false)).toBeNull();
    expect(state.observe(ready(4, [alice(4)]), 40_000, true)).toBeNull();
    expect(state.observe(ready(4, [alice(4)]), 50_000, false)).toBeNull();
  });

  it("reports a stable logged-out state once despite QR changes, then silently rebases", () => {
    const state = new WhatsAppUnread(true, vi.fn());
    state.observe(ready(2), 0, false);
    state.observe(ready(2), 10_000, false);
    expect(state.observe(link, 20_000, false)).toBeNull();
    expect(state.observe(link, 30_000, false)).toMatchObject({ kind: "link" });
    expect(state.observe(unknown, 40_000, false)).toBeNull();
    expect(state.observe(link, 41_000, false)).toBeNull();
    expect(state.observe(link, 51_000, false)).toBeNull();
    expect(state.observe(ready(9), 61_000, false)).toBeNull();
    expect(state.observe(ready(9), 71_000, false)).toBeNull();
    expect(state.observe(ready(10), 81_000, false)).toMatchObject({ kind: "unread", count: 1, name: "" });
  });

  it("falls back to the title when the chat list cannot be recognized at startup", () => {
    const linked = vi.fn(), state = new WhatsAppUnread(false, linked);
    expect(state.observe({ ...unknown, total: 4 }, 0, false)).toBeNull();
    expect(state.observe({ ...unknown, total: 4 }, 10_000, false)).toBeNull();
    expect(linked).toHaveBeenCalledTimes(1);
    expect(state.observe({ ...unknown, total: 6 }, 20_000, false)).toMatchObject({ kind: "unread", count: 2, name: "" });
    expect(state.observe(ready(6, [alice(6)]), 30_000, false)).toBeNull();
    expect(state.observe(ready(6, [alice(6)]), 40_000, false)).toBeNull();
  });

  it("announces title deltas once as title-only and ready samples alternate", () => {
    const state = new WhatsAppUnread(false, vi.fn());
    const title = (total: number): WhatsAppSnapshot => ({ ...unknown, total });
    state.observe(ready(2, [alice(2)]), 0, false);
    state.observe(ready(2, [alice(2)]), 10_000, false);
    expect(state.observe(title(3), 20_000, false)).toMatchObject({ kind: "unread", count: 1, name: "" });
    expect(state.observe(ready(3, [alice(3)]), 30_000, false)).toBeNull();
    expect(state.observe(title(5), 40_000, false)).toMatchObject({ kind: "unread", count: 2, name: "" });
    expect(state.observe(ready(5, [alice(5)]), 50_000, false)).toBeNull();
    expect(state.observe(ready(5, [alice(5)]), 60_000, false)).toBeNull();
    expect(state.observe(ready(6, [alice(6)]), 70_000, false)).toMatchObject({ kind: "unread", count: 1, name: "Test contact" });
    expect(state.observe(title(6), 80_000, false)).toBeNull();
  });
});

describe("WhatsApp tab binding", () => {
  const hostId = "fixture", tabKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const anotherTab = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it.each(["retire", "unbind"] as const)("persists release after %s of the exact bound tab", operation => {
    const userData = mkdtempSync(join(tmpdir(), "cutex-whatsapp-"));
    const options = { userData, hasTab: () => true, source: () => null, client: () => null, locale: () => "en" };
    try {
      writeFileSync(join(userData, "whatsapp-observer.json"), JSON.stringify({
        version: 1, hostId, tabKey, enabled: true, linked: true, preview: true, credential: "",
      }));
      const observer = new WhatsAppObserver(options);
      observer.tick(Date.now()); // A temporarily unmounted guest still has its tab.
      observer[operation](hostId, anotherTab);
      expect(observer.view(hostId).tabKey).toBe(tabKey);
      observer[operation](hostId, tabKey);
      expect(observer.view(hostId)).toMatchObject({ tabKey: null, enabled: false, linked: false });
      expect(new WhatsAppObserver(options).view(hostId).tabKey).toBeNull();
    } finally { rmSync(userData, { recursive: true, force: true }); }
  });
});
