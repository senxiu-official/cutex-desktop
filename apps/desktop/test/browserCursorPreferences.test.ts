import { describe, expect, it, vi } from "vitest";
import { BrowserCursorPreferencesStore } from "../src/main/browser/cursorPreferences";
import { createBrowserChannel, parseBrowserRequest } from "../src/main/browser/channel";
import { browserBridge } from "../src/preload/browser";
import { BROWSER_CHANNEL } from "../src/shared/browser";
import { browserCursorOutline, browserCursorView, DEFAULT_BROWSER_CURSOR_COLOR } from "../src/shared/browserCursor";

describe("main-owned browser cursor appearance", () => {
  it("defaults, persists a validated colour, reloads and resets without changing unrelated data", () => {
    let text = "bad json";
    const io = { read: () => text, write: vi.fn((_path: string, next: string) => { text = next; }) };
    const store = new BrowserCursorPreferencesStore("cursor.json", io);
    expect(store.get().color).toBe(DEFAULT_BROWSER_CURSOR_COLOR);
    expect(store.set("#ABCDEF")).toEqual({ color: "#abcdef" });
    expect(JSON.parse(text)).toEqual({ color: "#abcdef" });
    expect(new BrowserCursorPreferencesStore("cursor.json", io).get()).toEqual({ color: "#abcdef" });
    expect(store.set(null)).toEqual({ color: DEFAULT_BROWSER_CURSOR_COLOR });
    const count = io.write.mock.calls.length;
    expect(() => store.set("red")).toThrow("invalid_browser_request"); expect(io.write).toHaveBeenCalledTimes(count);
  });
  it("does not acknowledge a colour when persistence fails", () => {
    const store = new BrowserCursorPreferencesStore("cursor.json", { read: () => '{"color":"#123456"}', write: () => { throw Error("disk"); } });
    expect(store.get().color).toBe("#123456"); expect(() => store.set("#ffffff")).toThrow("disk"); expect(store.get().color).toBe("#123456");
  });
  it.each(["#fff", "red", "url(https://example.com)", "#123456;display:none", 0, {}, true])("rejects unsafe/partial colour %j at IPC", color => {
    expect(() => parseBrowserRequest({ op: "cursorColor", color })).toThrow("invalid_browser_request");
  });
  it("requires the app sender, allows read/reset while the module is disabled and needs no host capability", async () => {
    const store = new BrowserCursorPreferencesStore(null), execute = vi.fn();
    const channel = createBrowserChannel({ isAppSender: (sender: string) => sender === "app", isEnabled: () => false, getHosts: () => null, setEnabled: () => {}, execute,
      cursorColor: color => color === undefined ? store.get() : store.set(color) });
    await expect(channel("guest", { op: "cursorColor", color: "#ffffff" }, null)).rejects.toThrow("untrusted_sender");
    await expect(channel("app", { op: "cursorColor", color: "#000000" }, null)).resolves.toEqual({ color: "#000000" });
    await expect(channel("app", { op: "cursorColor", color: null }, null)).resolves.toEqual({ color: DEFAULT_BROWSER_CURSOR_COLOR });
    await expect(channel("app", { op: "cursorColor" }, null)).resolves.toEqual({ color: DEFAULT_BROWSER_CURSOR_COLOR });
    expect(execute).not.toHaveBeenCalled();
    expect(() => parseBrowserRequest({ op: "cursorColor", color: "#ffffff", script: "x" })).toThrow();
  });
  it("preload exposes only the typed appearance request with no host binding", async () => {
    const invoke = vi.fn(async () => ({ color: DEFAULT_BROWSER_CURSOR_COLOR }));
    const bridge = browserBridge({ invoke, binding: () => null, subscribe: () => () => {} });
    await bridge.cursorColor(); await bridge.cursorColor("#123456"); await bridge.cursorColor(null);
    expect(invoke.mock.calls).toEqual([[BROWSER_CHANNEL, { op: "cursorColor" }, null], [BROWSER_CHANNEL, { op: "cursorColor", color: "#123456" }, null], [BROWSER_CHANNEL, { op: "cursorColor", color: null }, null]]);
  });
});
describe("bounded visual-only projection", () => {
  const cue = { sequence: 1, kind: "type", phase: "dispatch", x: 20, y: 30, viewport: { width: 640, height: 360 }, rect: { x: 10, y: 10, width: 100, height: 40 }, color: "#7966db" };
  it("strips content, refs, selectors and unknown fields", () => {
    const projected = browserCursorView({ ...cue, text: "secret", ref: "private", selector: "#hidden", script: "x" });
    expect(projected).toEqual(cue); expect(JSON.stringify(projected)).not.toMatch(/secret|private|hidden|script/);
  });
  it.each([{ x: Infinity }, { x: -1 }, { y: 361 }, { color: "red" }, { sequence: 0 }, { kind: "evaluate" }, { phase: "other" }, { rect: { x: 600, y: 0, width: 50, height: 40 } }])("drops invalid or out-of-bounds cue %j", patch => {
    expect(browserCursorView({ ...cue, ...patch })).toBeUndefined();
  });
  it("outlines white against dark and black against light, with a single filled shape", () => {
    expect(browserCursorOutline("#ffffff")).toBe("#151821"); expect(browserCursorOutline("#000000")).toBe("#ffffff");
    expect(["#ffffff", "#151821"]).toContain(browserCursorOutline(DEFAULT_BROWSER_CURSOR_COLOR));
  });
});
