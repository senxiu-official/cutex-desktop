import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserGuestKeyboardFocused, browserKeyboardFocusScript, browserVisibilityScript, ensureBrowserVisible } from "../src/main/browser/visibility";

const guestId = "browser-0123456789abcdef";
function fixture() {
  const inspect = vi.fn(async () => ({ width: 640, height: 360 }));
  const window = { isDestroyed: vi.fn(() => false), isVisible: vi.fn(() => true), isMinimized: vi.fn(() => false),
    webContents: { isDestroyed: vi.fn(() => false), executeJavaScriptInIsolatedWorld: inspect },
    focus: vi.fn(), show: vi.fn(), restore: vi.fn() };
  const reveal = vi.fn();
  return { inspect, window, reveal, options: { window: window as any, guestId, hiddenTarget: "reveal" as const, reveal } };
}
function dom() {
  const style = { display: "block", visibility: "visible", opacity: "1", contentVisibility: "visible", pointerEvents: "auto", overflowX: "visible", overflowY: "visible" };
  const rect = { left: 10, top: 10, right: 650, bottom: 370, width: 640, height: 360 };
  const card = { getAttribute: (name: string) => name === "data-browser-granted" ? "true" : null };
  const ancestor = { hidden: false, inert: false, parentElement: null, getAttribute: () => null, getBoundingClientRect: () => rect,
    hasAttribute: (name: string): boolean => name === "data-browser-viewport" };
  const guest = { isConnected: true, hidden: false, inert: false, parentElement: ancestor, getAttribute: () => guestId,
    closest: () => card, getBoundingClientRect: () => rect };
  const capture = { isConnected: true, hidden: false, inert: false, parentElement: ancestor.parentElement, childElementCount: 0,
    closest: () => card, getAttribute: (name: string): string | null => name === "data-browser-owner-capture" ? guestId : name === "data-browser-owner-ready" ? "true" : null, getBoundingClientRect: () => rect };
  const document = { visibilityState: "visible", querySelectorAll: (selector: string): any[] => selector.startsWith("webview") ? [guest] : [capture], elementFromPoint: (): any => capture };
  return { guest, capture, card, ancestor, rect, style, document, context: { document, innerWidth: 1000, innerHeight: 800, getComputedStyle: (_node?: unknown) => style } };
}
afterEach(() => vi.useRealTimers());
describe("main-owned browser visibility gate", () => {
  it("returns actual CSS card bounds without revealing or focusing", async () => {
    const f = fixture(); expect(await ensureBrowserVisible(f.options)).toEqual({ width: 640, height: 360 });
    expect(f.reveal).not.toHaveBeenCalled(); expect(f.window.focus).not.toHaveBeenCalled();
    expect(f.inspect).toHaveBeenCalledWith(1005, [{ code: browserVisibilityScript(guestId) }], false);
  });
  it.each(["isDestroyed", "isMinimized", "isVisible"] as const)("rejects native %s state before app inspection/reveal", async name => {
    const f = fixture(); f.window[name].mockReturnValue(name !== "isVisible");
    await expect(ensureBrowserVisible(f.options)).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.inspect).not.toHaveBeenCalled(); expect(f.reveal).not.toHaveBeenCalled();
    expect(f.window.show).not.toHaveBeenCalled(); expect(f.window.restore).not.toHaveBeenCalled();
  });
  it("rejects a hidden card without revealing in reject mode", async () => {
    const f = fixture(); f.inspect.mockResolvedValueOnce(false as any);
    await expect(ensureBrowserVisible({ ...f.options, hiddenTarget: "reject" })).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it("reveals only the existing card and rechecks before succeeding", async () => {
    const f = fixture(); f.inspect.mockResolvedValueOnce(false as any);
    await expect(ensureBrowserVisible(f.options)).resolves.toEqual({ width: 640, height: 360 });
    expect(f.reveal).toHaveBeenCalledOnce(); expect(f.inspect).toHaveBeenCalledTimes(2);
  });
  it("checks native visibility again after an awaited inspection", async () => {
    const f = fixture(); f.inspect.mockImplementationOnce(async () => { f.window.isVisible.mockReturnValue(false); return { width: 640, height: 360 }; });
    await expect(ensureBrowserVisible(f.options)).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it("bounds a permanently hidden reveal and cleans all timers", async () => {
    vi.useFakeTimers(); const f = fixture(); f.inspect.mockResolvedValue(false as any);
    const result = expect(ensureBrowserVisible(f.options)).rejects.toMatchObject({ code: "target_hidden" });
    await vi.advanceTimersByTimeAsync(1000); await result; expect(vi.getTimerCount()).toBe(0);
    expect(f.reveal).toHaveBeenCalledOnce();
  });
  it("bounds an unresponsive renderer and rejects non-boolean/non-bounds reports", async () => {
    vi.useFakeTimers(); const f = fixture(); f.inspect.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(ensureBrowserVisible(f.options)).rejects.toMatchObject({ code: "target_hidden" });
    await vi.advanceTimersByTimeAsync(1000); await result; expect(vi.getTimerCount()).toBe(0);
    f.inspect.mockResolvedValue(true as any);
    await expect(ensureBrowserVisible({ ...f.options, hiddenTarget: "reject" })).rejects.toMatchObject({ code: "target_hidden" });
  });
  it("fixed script matches exactly one connected webview and returns bounds", () => {
    const f = dom(); expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toEqual({ width: 640, height: 360 });
    f.document.querySelectorAll = () => [f.guest, f.guest];
    expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toBe(false);
  });
  it.each(["hidden", "inert"] as const)("checks ancestor %s", key => {
    const f = dom(); f.ancestor[key] = true; expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toBe(false);
  });
  it.each([["display", "none"], ["visibility", "hidden"], ["opacity", "0"], ["pointerEvents", "none"], ["contentVisibility", "hidden"]])("checks ancestor style %s=%s", (key, value) => {
    const f = dom(); (f.style as Record<string, string>)[key!] = value!;
    expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toBe(false);
  });
  it("refuses covered, detached, offscreen or wrong-identity elements", () => {
    for (const mutate of [(f: ReturnType<typeof dom>) => { f.document.elementFromPoint = () => ({} as any); },
      (f: ReturnType<typeof dom>) => { f.guest.isConnected = false; },
      (f: ReturnType<typeof dom>) => { f.rect.right = 1100; },
      (f: ReturnType<typeof dom>) => { f.guest.getAttribute = () => "different"; }]) {
      const f = dom(); mutate(f); expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toBe(false);
    }
  });
  it("does not interpolate unvalidated script or selectors", () => {
    expect(() => browserVisibilityScript('guest\"];alert(1);//')).toThrow();
  });
  it("accepts only the exact owner's capture layer as a non-occluding hit", () => {
    const f = dom();
    f.document.querySelectorAll = selector => selector.startsWith("webview") ? [f.guest] : [f.capture];
    f.document.elementFromPoint = () => f.capture;
    expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toEqual({ width: 640, height: 360 });
  });
  it.each(["different-guest", "duplicate", "wrong-parent", "wrong-card", "no-viewport", "partial", "child", "detached", "hidden", "inert", "transparent", "shell-overlay"])("rejects capture exception for %s", reason => {
    const f = dom();
    f.document.querySelectorAll = selector => selector.startsWith("webview") ? [f.guest] : [f.capture];
    f.document.elementFromPoint = () => f.capture;
    if (reason === "different-guest") f.capture.getAttribute = () => "another-guest";
    if (reason === "duplicate") f.document.querySelectorAll = selector => selector.startsWith("webview") ? [f.guest] : [f.capture, f.capture];
    if (reason === "wrong-parent") f.capture.parentElement = {} as any;
    if (reason === "wrong-card") f.capture.closest = () => ({ getAttribute: () => "true" });
    if (reason === "no-viewport") f.ancestor.hasAttribute = () => false;
    if (reason === "partial") f.capture.getBoundingClientRect = () => ({ ...f.rect, width: 600 });
    if (reason === "child") f.capture.childElementCount = 1;
    if (reason === "detached") f.capture.isConnected = false;
    if (reason === "hidden") f.capture.hidden = true;
    if (reason === "inert") f.capture.inert = true;
    if (reason === "transparent") f.context.getComputedStyle = node => node === f.capture ? { ...f.style, opacity: "0" } : f.style;
    if (reason === "shell-overlay") f.document.elementFromPoint = () => ({});
    expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toBe(false);
  });
  it.each(["missing", "not-ready", "not-granted", "bare-guest-hit", "one-bare-guest-hit"])("never returns actionable bounds when capture is %s", reason => {
    const f = dom();
    if (reason === "missing") { f.document.querySelectorAll = selector => selector.startsWith("webview") ? [f.guest] : []; f.document.elementFromPoint = () => f.guest; }
    if (reason === "not-ready") f.capture.getAttribute = name => name === "data-browser-owner-capture" ? guestId : null;
    if (reason === "not-granted") f.card.getAttribute = () => null;
    if (reason === "bare-guest-hit") f.document.elementFromPoint = () => f.guest;
    let hits = 0;
    if (reason === "one-bare-guest-hit") f.document.elementFromPoint = () => ++hits === 5 ? f.guest : f.capture;
    expect(runInNewContext(browserVisibilityScript(guestId), f.context)).toEqual({ capturePending: true });
  });
  it("waits for visible capture readiness in reject mode without revealing or retrying an action", async () => {
    vi.useFakeTimers(); const f = fixture(); f.inspect.mockResolvedValueOnce({ capturePending: true } as any);
    const result = ensureBrowserVisible({ ...f.options, hiddenTarget: "reject" });
    await vi.advanceTimersByTimeAsync(25); expect(await result).toEqual({ width: 640, height: 360 });
    expect(f.inspect).toHaveBeenCalledTimes(2); expect(f.reveal).not.toHaveBeenCalled();
  });
  it("fails closed when a visible guest never installs its capture listeners", async () => {
    vi.useFakeTimers(); const f = fixture(); f.inspect.mockResolvedValue({ capturePending: true } as any);
    const result = expect(ensureBrowserVisible(f.options)).rejects.toMatchObject({ code: "target_hidden" });
    await vi.advanceTimersByTimeAsync(1000); await result;
    expect(f.reveal).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["abort", "deadline"] as const)("never reveals after an awaited inspection passes its %s", async mode => {
    vi.useFakeTimers(); const f = fixture(), controller = new AbortController();
    let complete!: (value: any) => void;
    f.inspect.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const result = expect(ensureBrowserVisible({ ...f.options, signal: controller.signal, deadline: Date.now() + 20 }))
      .rejects.toMatchObject({ code: mode === "abort" ? "cancelled" : "deadline_exceeded" });
    if (mode === "abort") controller.abort(); else await vi.advanceTimersByTimeAsync(20);
    await result; complete(false); await vi.advanceTimersByTimeAsync(100);
    expect(f.reveal).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("app keyboard focus check for keyboard actions", () => {
  const run = (active: unknown, hasFocus = true) => runInNewContext(browserKeyboardFocusScript(guestId), { document: { activeElement: active, hasFocus: () => hasFocus } });
  const webview = (id: string) => ({ tagName: "WEBVIEW", getAttribute: (name: string) => name === "data-browser-guest" ? id : null });
  it("is true only for this exact focused guest in a focused app document", () => {
    expect(run(webview(guestId))).toBe(true);
    expect(run(webview(guestId), false)).toBe(false);
    expect(run(webview("browser-fedcba9876543210"))).toBe(false);
    expect(run({ tagName: "TEXTAREA", getAttribute: () => null })).toBe(false);
    expect(run({ tagName: "DIV", getAttribute: () => guestId })).toBe(false);
    expect(run(null)).toBe(false);
  });
  it("fails closed for hidden windows, bad ids and inspection errors", async () => {
    const f = fixture(); f.inspect.mockResolvedValue(true as any);
    expect(await browserGuestKeyboardFocused(f.window as any, guestId)).toBe(true);
    expect(f.inspect).toHaveBeenCalledWith(1005, [{ code: browserKeyboardFocusScript(guestId) }], false);
    expect(await browserGuestKeyboardFocused(f.window as any, "bad id")).toBe(false);
    f.inspect.mockRejectedValueOnce(new Error("gone")); expect(await browserGuestKeyboardFocused(f.window as any, guestId)).toBe(false);
    f.window.isMinimized.mockReturnValue(true); expect(await browserGuestKeyboardFocused(f.window as any, guestId)).toBe(false);
  });
});
