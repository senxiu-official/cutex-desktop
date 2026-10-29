import { describe, expect, it } from "vitest";
import { BROWSER_ZOOM_STEPS, BrowserZoomStore, browserGuestMenu, browserOpenableImage, browserZoomKey, browserZoomShortcut,
  createBrowserWheelGate, nextBrowserZoom, WHEEL_GATE_MS } from "../src/main/browser/guestView";

describe("guest page zoom steps", () => {
  it("walks Chrome's own steps in and out, resets to 100 %, and clamps at both ends", () => {
    expect(nextBrowserZoom(1, "in")).toBe(1.1);
    expect(nextBrowserZoom(1, "out")).toBe(0.9);
    expect(nextBrowserZoom(1, "reset")).toBe(1);
    expect(nextBrowserZoom(BROWSER_ZOOM_STEPS.at(-1)!, "in")).toBe(3);
    expect(nextBrowserZoom(BROWSER_ZOOM_STEPS[0], "out")).toBe(0.33);
    expect(nextBrowserZoom(Number.NaN, "out")).toBe(1);
    // An off-step value (a legacy level) moves to the nearest step in that direction.
    expect(nextBrowserZoom(1.05, "in")).toBe(1.1);
    expect(nextBrowserZoom(1.05, "out")).toBe(1);
  });
});

describe("what a guest page's zoom is remembered by", () => {
  it("a service page by host + slug, a web page by site host; nothing for blank / data pages", () => {
    expect(browserZoomKey("local", "cutex:service/grafana/d/q")).toBe("service:local/grafana");
    expect(browserZoomKey("ssh-one", "http://docs.svc.localhost:26111/index", 26111)).toBe("service:ssh-one/docs");
    expect(browserZoomKey("local", "http://docs.svc.localhost/")).toBe("service:local/docs");
    expect(browserZoomKey("local", "https://Example.COM/path")).toBe("site:example.com");
    for (const raw of ["about:blank", "data:text/html,hi", "not a url", "file:///D:/x", "cutex:service/Bad_Slug/", "javascript:1"])
      expect(browserZoomKey("local", raw)).toBeNull();
  });
  it("a proxy port of another connection is not this host's service", () => {
    expect(browserZoomKey("local", "http://docs.svc.localhost:26112/")).toBe("site:docs.svc.localhost");
  });
});

describe("the owner's zoom keys in a guest's before-input-event", () => {
  const down = (patch: Record<string, unknown> = {}) => ({ type: "keyDown", ...patch });
  it("Ctrl+= / − / 0 (also numpad and +/_) zoom in, out and reset; Alt never zooms", () => {
    expect(browserZoomShortcut(down({ key: "=", control: true }))).toBe("in");
    expect(browserZoomShortcut(down({ key: "+", control: true }))).toBe("in");
    expect(browserZoomShortcut(down({ key: "-", control: true }))).toBe("out");
    expect(browserZoomShortcut(down({ key: "_", control: true }))).toBe("out");
    expect(browserZoomShortcut(down({ code: "NumpadAdd", control: true }))).toBe("in");
    expect(browserZoomShortcut(down({ code: "NumpadSubtract", control: true }))).toBe("out");
    expect(browserZoomShortcut(down({ key: "0", control: true }))).toBe("reset");
    for (const code of ["Digit0", "Numpad0"]) expect(browserZoomShortcut(down({ code, control: true }))).toBe("reset");
    expect(browserZoomShortcut(down({ key: "=", control: true, alt: true }))).toBeNull();
    expect(browserZoomShortcut(down({ key: "=", control: true, meta: true }))).toBeNull();
    expect(browserZoomShortcut(down({ key: "=" }))).toBeNull();
    expect(browserZoomShortcut({ type: "keyUp", key: "=", control: true })).toBeNull();
    expect(browserZoomShortcut({ type: "char", key: "=", control: true })).toBeNull();
  });
  it("macOS takes ⌘ without Ctrl, other platforms take Ctrl without ⌘", () => {
    expect(browserZoomShortcut(down({ key: "=", meta: true }), "darwin")).toBe("in");
    expect(browserZoomShortcut(down({ key: "=", meta: true, control: true }), "darwin")).toBeNull();
    expect(browserZoomShortcut(down({ key: "=", meta: true }), "win32")).toBeNull();
  });
});

describe("one zoom step per wheel gesture tick", () => {
  it("passes the first tick, blocks repeats inside the interval, then passes again", () => {
    let now = 1_000;
    const gate = createBrowserWheelGate(() => now, WHEEL_GATE_MS);
    expect(gate()).toBe(true);
    expect(gate()).toBe(false);
    now += WHEEL_GATE_MS - 1;
    expect(gate()).toBe(false);
    now += 1;
    expect(gate()).toBe(true);
  });
});

describe("browser zoom store (userData/browser-zoom.json)", () => {
  it("remembers per key, forgets 100 %, clamps and rejects unknown keys; unreadable data means 100 %", () => {
    const store = new BrowserZoomStore(null);
    expect(store.get("site:example.com")).toBe(1);
    expect(store.set("site:example.com", 1.1)).toBe(true);
    expect(store.set("site:example.com", 1.1)).toBe(false);
    expect(store.get("site:example.com")).toBe(1.1);
    expect(store.set("site:example.com", 1)).toBe(true); // 100 % forgets the key.
    expect(store.get("site:example.com")).toBe(1);
    expect(store.set("site:example.com", 99)).toBe(true);
    expect(store.get("site:example.com")).toBe(3);
    expect(store.set("not a key", 1.5)).toBe(false);
    expect(store.set("service:" + "x".repeat(300) + "/docs", 1.5)).toBe(false);
    const corrupt = new BrowserZoomStore("memory://corrupt", { read: () => "{oops", write: () => {} });
    expect(corrupt.get("site:example.com")).toBe(1);
  });
  it("persists as version 1 and reloads only well-formed in-range entries", () => {
    let written = "";
    const io = { read: () => written, write: (_path: string, text: string) => { written = text; } };
    const store = new BrowserZoomStore("memory://zoom", io);
    store.set("site:example.com", 1.25);
    store.set("service:local/docs", 0.67);
    const reloaded = new BrowserZoomStore("memory://zoom", io);
    expect(reloaded.get("site:example.com")).toBe(1.25);
    expect(reloaded.get("service:local/docs")).toBe(0.67);
    written = JSON.stringify({ version: 2, levels: { "site:example.com": 2 } });
    expect(new BrowserZoomStore("memory://zoom", io).get("site:example.com")).toBe(1);
    written = JSON.stringify({ version: 1, levels: { "site:example.com": 9, "service:ok-slug/x": "nope", "bad key": 2 } });
    const filtered = new BrowserZoomStore("memory://zoom", io);
    expect(filtered.get("site:example.com")).toBe(1);
    expect(filtered.get("service:ok-slug/x")).toBe(1);
  });
  it("keeps at most 500 keys, dropping the least recently changed", () => {
    const store = new BrowserZoomStore(null);
    for (let index = 0; index < 502; index++) store.set(`site:host-${index}.test`, 1.1);
    expect(store.get("site:host-0.test")).toBe(1);
    expect(store.get("site:host-1.test")).toBe(1);
    expect(store.get("site:host-2.test")).toBe(1.1);
    expect(store.get("site:host-501.test")).toBe(1.1);
  });
});

describe("the guest right-click menu", () => {
  const editFlags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: false, canSelectAll: true };
  const params = { mediaType: "image", srcURL: "https://example.test/pic.png", hasImageContents: true, isEditable: false, selectionText: "", editFlags };
  it("offers image actions for a web image, then edit actions in a field", () => {
    const items = browserGuestMenu({ ...params, isEditable: true }, "zh-CN");
    expect(items.map(item => "separator" in item ? "|" : `${item.action}:${item.enabled ? 1 : 0}`)).toEqual([
      "openImage:1", "copyImage:1", "saveImage:1", "|", "undo:1", "redo:0", "|", "cut:1", "copy:1", "paste:0", "selectAll:1",
    ]);
    expect((items[0] as { label: string }).label).toContain("图片");
  });
  it("a page's own data: / blob: image is copyable and savable but not a new-tab target", () => {
    for (const srcURL of ["data:image/png;base64,AA==", "blob:https://example.test/img"]) {
      const items = browserGuestMenu({ ...params, srcURL }, "en");
      expect(items.filter(item => !("separator" in item)).map(item => (item as { action: string }).action)).toEqual(["copyImage", "saveImage"]);
    }
    const broken = browserGuestMenu({ ...params, srcURL: "https://example.test/broken.png", hasImageContents: false }, "en");
    expect(broken.filter(item => !("separator" in item)).map(item => { const entry = item as { action: string; enabled: boolean }; return `${entry.action}:${entry.enabled ? 1 : 0}`; })).toEqual(["openImage:1", "copyImage:0", "saveImage:1"]);
  });
  it("a selection offers copy; a plain click offers nothing; credentials in an image URL are not a new tab", () => {
    const selection = browserGuestMenu({ ...params, mediaType: "none", srcURL: "", selectionText: "hello" }, "zh-CN");
    expect(selection.filter(item => !("separator" in item)).map(item => (item as { action: string }).action)).toEqual(["copy"]);
    expect(browserGuestMenu({ ...params, mediaType: "none", srcURL: "", selectionText: "" }, "zh-CN")).toEqual([]);
    expect(browserOpenableImage("https://user:pass@example.test/pic.png")).toBe(false);
    expect(browserOpenableImage("http://127.0.0.1:5173/logo.svg")).toBe(true);
  });
  it("labels follow the owner's locale variants", () => {
    expect((browserGuestMenu(params, "zh-CN")[0] as { label: string }).label).toBe("在新标签页中打开图片");
    expect((browserGuestMenu(params, "zh-Hant-CN")[0] as { label: string }).label).toBe("在新標籤頁中打開圖片");
    expect((browserGuestMenu(params, "zh-Hant-TW")[0] as { label: string }).label).toBe("在新分頁中開啟圖片");
    expect((browserGuestMenu(params, "en-AU")[0] as { label: string }).label).toBe("Open image in new tab");
  });
});
