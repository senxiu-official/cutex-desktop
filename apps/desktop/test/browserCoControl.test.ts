import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { BROWSER_OWNER_TYPING_QUIET_MS, InAppProvider, type InAppProviderOptions } from "../src/main/browser/provider";
import { browserFocusRestoreScript } from "../src/main/browser/visibility";
import { runInNewContext } from "node:vm";
import cdpFixture from "../../../packages/browser-cdp/fixtures/cdp-shapes.json";

// 0.1.3 shared-tab co-control at the provider boundary (CDP mocked; real Electron: qa script).
const guestId = "browser-0123456789abcdef";
class DebuggerMock extends EventEmitter {
  attached = false;
  attach = vi.fn(() => { this.attached = true; });
  detach = vi.fn(() => { this.attached = false; this.emit("detach", {}, "detached"); });
  isAttached = () => this.attached;
  sendCommand = vi.fn(async (method: string, params: any = {}): Promise<any> => {
    if (method === "Page.getFrameTree") return cdpFixture.frameTree;
    if (method === "Accessibility.getFullAXTree") return cdpFixture.ax;
    if (method === "DOM.describeNode") return { node: { attributes: ["type", "text"] } };
    if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0 } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 400 };
    if (method === "DOM.resolveNode") return { object: { objectId: "input" } };
    if (method === "Runtime.evaluate") return { result: { objectId: "main-window" } };
    if (method === "Runtime.callFunctionOn") {
      const fn = params.functionDeclaration as string;
      if (fn.includes("getBoundingClientRect")) return { result: { value: { x: 70, y: 40 } } };
      if (fn.includes("const receipt =")) return { result: { objectId: "receipt" } };
      if (fn.includes("return this.read()")) return { result: { value: { seen: true, value: "" } } };
      if (fn.includes("focused:")) return { result: { value: { focused: true } } };
      if (fn.includes("function(mainWindow)")) return { result: { value: true } };
      return { result: { value: { ok: true } } };
    }
    return {};
  });
}
function fixture(extra: Partial<InAppProviderOptions> = {}) {
  let generation = 0, clock = Date.now();
  const debug = new DebuggerMock(), guest = { isDestroyed: () => false, debugger: debug };
  const ensureVisible = vi.fn(async () => ({ width: 640, height: 360 }));
  const keyboardFocused = vi.fn(async () => false), restoreFocus = vi.fn(async () => {});
  const provider = new InAppProvider({ getGuest: () => guest as any, ensureVisible, allowUrl: () => true, onChanged: () => {},
    nextPageGeneration: () => ++generation, keyboardFocused, restoreFocus, now: () => clock, ...extra });
  return { provider, debug, ensureVisible, keyboardFocused, restoreFocus, advance: (ms: number) => { clock += ms; } };
}
const ref = async (f: ReturnType<typeof fixture>) => (await f.provider.snapshot(guestId)).nodes.find(node => node.name === "Message")!.ref;

describe("shared tab co-control", () => {
  it("owner clicks, scrolls and typing never pause; they only make the agent read again", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    const first = await ref(f);
    f.provider.ownerActivity(guestId, "guest-pointer");
    expect(f.provider.controlView(guestId)?.state).toBe("granted");
    await expect(f.provider.act(guestId, first, "click")).rejects.toMatchObject({ code: "stale_ref" });
    const second = await ref(f);
    await expect(f.provider.act(guestId, second, "click")).resolves.toMatchObject({ status: "dispatched" });
    // Reads are never held back by owner input.
    f.provider.ownerActivity(guestId, "guest-keyboard");
    await expect(f.provider.snapshot(guestId)).resolves.toBeDefined();
    expect(f.provider.controlView(guestId)?.state).toBe("granted");
  });
  it("guest input inside the agent's own dispatch window is the agent's (refs stay valid)", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    const target = await ref(f);
    const original = f.debug.sendCommand.getMockImplementation()!;
    f.debug.sendCommand.mockImplementation(async (method: string, params?: any) => {
      if (method.startsWith("Input.")) f.provider.ownerActivity(guestId, "guest-pointer"); // the CDP click's own echo
      return original(method, params);
    });
    await f.provider.act(guestId, target, "click");
    f.debug.sendCommand.mockImplementation(original);
    f.provider.ownerActivity(guestId, "guest-pointer"); // within the grace window right after it
    await expect(f.provider.act(guestId, target, "click")).resolves.toMatchObject({ status: "dispatched" });
  });
  it("agent writes wait while the owner types (guest or app) and run after the quiet; reads do not wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const f = fixture(); await f.provider.grant(guestId);
      const target = await ref(f);
      f.provider.ownerActivity(undefined, "app-keyboard"); // composer typing, every granted tab
      expect(f.provider.ownerTyping(guestId)).toBe(true);
      await expect(f.provider.snapshot(guestId)).resolves.toBeDefined();
      const click = f.provider.act(guestId, (await f.provider.snapshot(guestId)).nodes.find(node => node.name === "Message")!.ref, "click", "", { deadline: Date.now() + 10_000 });
      let settled = false; void click.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(300); expect(settled).toBe(false);
      f.advance(BROWSER_OWNER_TYPING_QUIET_MS); await vi.advanceTimersByTimeAsync(BROWSER_OWNER_TYPING_QUIET_MS);
      await expect(click).resolves.toMatchObject({ status: "dispatched" });
      void target;
    } finally { vi.useRealTimers(); }
  });
  it("a write whose deadline ends inside the owner's typing answers busy (retry), never a pause", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    const target = await ref(f);
    f.provider.ownerActivity(guestId, "guest-keyboard");
    await expect(f.provider.act(guestId, target, "click", "", { deadline: Date.now() + 200 })).rejects.toMatchObject({ code: "busy" });
    expect(f.provider.controlView(guestId)?.state).toBe("granted");
  });
  it("an agent click that pulled app focus into the page hands it back; keyboard actions still need the page's focus", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    await f.provider.act(guestId, await ref(f), "click");
    expect(f.restoreFocus).toHaveBeenCalledExactlyOnceWith(guestId);
    // The owner had focus in the page already: nothing to hand back.
    f.keyboardFocused.mockResolvedValue(true); f.restoreFocus.mockClear();
    await f.provider.act(guestId, await ref(f), "click");
    expect(f.restoreFocus).not.toHaveBeenCalled();
    f.keyboardFocused.mockResolvedValue(false);
    await expect(f.provider.act(guestId, await ref(f), "fill", "x")).rejects.toMatchObject({ code: "unsupported_operation" });
  });
  it("explicit pause still stops everything until one-click resume (grant again)", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    f.provider.ownerTakeover(guestId, "owner-pause");
    expect(f.provider.controlView(guestId)?.state).toBe("paused");
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
  });
});

describe("main-owned focus restore script", () => {
  function app(activeGuest: string | null, back: { focus: ReturnType<typeof vi.fn> } | null) {
    const guest = { tagName: "WEBVIEW", getAttribute: (name: string) => name === "data-browser-guest" ? activeGuest : null, blur: vi.fn() };
    const document = { activeElement: activeGuest ? guest : {}, querySelectorAll: () => back ? [{ ...back, isConnected: true, getAttribute: () => guestId }] : [] };
    if (back) back.focus.mockImplementation(() => { document.activeElement = back; });
    return { guest, document };
  }
  it("returns focus to the marked element only when this guest holds it; otherwise blurs the page", () => {
    const back = { focus: vi.fn() }, a = app(guestId, back);
    expect(runInNewContext(browserFocusRestoreScript(guestId), { document: a.document })).toBe(true);
    expect(back.focus).toHaveBeenCalledWith({ preventScroll: true }); expect(a.guest.blur).not.toHaveBeenCalled();
    const b = app(guestId, null);
    runInNewContext(browserFocusRestoreScript(guestId), { document: b.document }); expect(b.guest.blur).toHaveBeenCalled();
    const c = app("another-guest-0123456789", back); back.focus.mockClear();
    expect(runInNewContext(browserFocusRestoreScript(guestId), { document: c.document })).toBe(false); expect(back.focus).not.toHaveBeenCalled();
    expect(() => browserFocusRestoreScript("x\"];alert(1)//")).toThrow();
  });
});

// Background carriers (owner option C, 2026-10-18): hand-over draining and focus isolation.
describe("background carrier hand-over at the provider", () => {
  it("drain waits for the running action, refuses new ones until released, never cancels the running one", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    const target = await ref(f);
    let open!: () => void; const gate = new Promise<void>(resolve => { open = resolve; });
    const original = f.debug.sendCommand.getMockImplementation()!;
    f.debug.sendCommand.mockImplementation(async (method: string, params?: any) => { if (method === "Input.dispatchMouseEvent") await gate; return original(method, params); });
    const running = f.provider.act(guestId, target, "click");
    await vi.waitFor(() => expect(f.debug.sendCommand.mock.calls.some(([method]) => method === "Input.dispatchMouseEvent")).toBe(true));
    let drained: (() => void) | undefined;
    const draining = f.provider.drain(guestId, Date.now() + 5_000).then(release => { drained = release; });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(drained).toBeUndefined();
    open(); await expect(running).resolves.toMatchObject({ status: "dispatched" });
    await draining; expect(drained).toBeTypeOf("function");
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "busy" });
    drained!();
    await expect(f.provider.snapshot(guestId)).resolves.toBeDefined();
  });
  it("drain gives up at its deadline with busy (and releases), and is a no-op without a grant", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    const target = await ref(f);
    const original = f.debug.sendCommand.getMockImplementation()!;
    f.debug.sendCommand.mockImplementation(async (method: string, params?: any) => method === "Input.dispatchMouseEvent" ? new Promise(() => {}) : original(method, params));
    void f.provider.act(guestId, target, "click").catch(() => {});
    await vi.waitFor(() => expect(f.debug.sendCommand.mock.calls.some(([method]) => method === "Input.dispatchMouseEvent")).toBe(true));
    await expect(f.provider.drain(guestId, Date.now() + 40)).rejects.toMatchObject({ code: "busy" });
    const other = fixture();
    await expect(other.provider.drain(guestId, Date.now() + 40)).resolves.toBeTypeOf("function");
  });
  it("owner typing in the app does not hold back writes on an isolated (background) guest", async () => {
    const f = fixture({ isolated: () => true }); await f.provider.grant(guestId);
    f.provider.ownerActivity(undefined, "app-keyboard");
    expect(f.provider.ownerTyping(guestId)).toBe(false);
    f.provider.ownerActivity(guestId, "guest-keyboard");
    expect(f.provider.ownerTyping(guestId)).toBe(true);
  });
});
