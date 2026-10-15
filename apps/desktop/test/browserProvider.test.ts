import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InAppProvider, type BrowserOwnerTakeoverSource, type InAppProviderOptions, type BrowserNavigationGuard } from "../src/main/browser/provider";
import { BROWSER_OWNER_INPUT_KINDS, DEFAULT_BROWSER_CONTROL_SETTINGS } from "../src/shared/browser";
import cdpFixture from "../../../packages/browser-cdp/fixtures/cdp-shapes.json";

const guestId = "browser-0123456789abcdef";
const takeoverSources: BrowserOwnerTakeoverSource[] = [...BROWSER_OWNER_INPUT_KINDS, "guest-keyboard"];
function png() {
  const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(1280, 16); bytes.writeUInt32BE(720, 20);
  return bytes.toString("base64");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
class DebuggerMock extends EventEmitter {
  attached = false;
  seen = false;
  value = "before";
  handler?: (method: string, params: any) => unknown;
  attach = vi.fn(() => { this.attached = true; });
  detach = vi.fn(() => { this.attached = false; this.emit("detach", {}, "detached"); });
  isAttached = () => this.attached;
  sendCommand = vi.fn(async (method: string, params: any = {}): Promise<any> => {
    const result = this.handler?.(method, params);
    if (result !== undefined) return result;
    if (method === "Page.getFrameTree") return cdpFixture.frameTree;
    if (method === "Accessibility.getFullAXTree") return cdpFixture.ax;
    if (method === "DOM.describeNode") return { node: { attributes: ["type", "text"] } };
    if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0 } };
    if (method === "Page.createIsolatedWorld") return { executionContextId: 400 };
    if (method === "DOM.resolveNode") return { object: { objectId: "input" } };
    if (method === "Runtime.evaluate") return { result: { objectId: "main-window" } };
    if (method === "Page.captureScreenshot") return { data: png() };
    if (method.startsWith("Input.")) { this.seen = true; if (method === "Input.insertText") this.value = params.text; return {}; }
    if (method === "Runtime.callFunctionOn") {
      const fn = params.functionDeclaration as string;
      if (fn.includes("getBoundingClientRect")) return { result: { value: { x: 70, y: 40 } } };
      if (fn.includes("const receipt =")) { this.seen = false; return { result: { objectId: "receipt" } }; }
      if (fn.includes("return this.read()")) return { result: { value: { seen: this.seen, value: this.value } } };
      if (fn.includes("focused:")) return { result: { value: { focused: true } } };
      if (fn.includes("function(mainWindow)")) return { result: { value: true } };
      return { result: { value: { ok: true } } };
    }
    return {};
  });
}
function fixture(extra: Partial<Pick<InAppProviderOptions, "prepareNavigation" | "keyboardFocused">> = {}) {
  let generation = 0;
  const debug = new DebuggerMock();
  const guest = { isDestroyed: vi.fn(() => false), debugger: debug, focus: vi.fn() };
  const getGuest = vi.fn(() => guest as any);
  const ensureVisible = vi.fn(async () => ({ width: 640, height: 360 }));
  const allowUrl = vi.fn(() => true), onChanged = vi.fn();
  const provider = new InAppProvider({ getGuest, ensureVisible, allowUrl, onChanged, nextPageGeneration: () => ++generation, ...extra });
  return { provider, guest, debug, getGuest, ensureVisible, allowUrl, onChanged };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 500 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
async function target(f: ReturnType<typeof fixture>) {
  return (await f.provider.snapshot(guestId)).nodes.find(node => node.name === "Message")!.ref;
}
afterEach(() => vi.useRealTimers());
describe("main-only in-app browser provider", () => {
  it("runs private navigation preparation only after visibility and serializes it with all actions", async () => {
    const pending = deferred<{ url: string; cancel(): void }>(), cancel = vi.fn(), prepareNavigation = vi.fn(() => pending.promise);
    const f = fixture({ prepareNavigation }); await f.provider.grant(guestId);
    const navigation = f.provider.navigate(guestId, "http://docs.svc.localhost:26111/");
    await until(() => prepareNavigation.mock.calls.length === 1);
    expect(f.ensureVisible.mock.invocationCallOrder.at(-1)!).toBeLessThan(prepareNavigation.mock.invocationCallOrder[0]!);
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "busy" });
    expect(f.debug.sendCommand.mock.calls.some(([method]) => method === "Page.navigate")).toBe(false);
    const visibilityChecks = f.ensureVisible.mock.calls.length;
    pending.resolve({ url: "http://docs.svc.localhost:26111/__cutex/auth?ticket=dummy", cancel });
    const result = await navigation;
    expect(f.ensureVisible.mock.calls.length).toBeGreaterThan(visibilityChecks);
    expect(f.debug.sendCommand).toHaveBeenCalledWith("Page.navigate", { url: "http://docs.svc.localhost:26111/__cutex/auth?ticket=dummy" });
    expect(JSON.stringify(result)).not.toContain("ticket"); expect(cancel).not.toHaveBeenCalled(); f.provider.dispose();
  });
  it("cannot bootstrap a hidden target and cancels preparation if it becomes hidden before dispatch", async () => {
    const cancel = vi.fn(), prepareNavigation = vi.fn(async () => ({ url: "http://localhost/next", cancel }));
    const f = fixture({ prepareNavigation }); await f.provider.grant(guestId);
    f.ensureVisible.mockRejectedValueOnce(Object.assign(Error(), { code: "target_hidden" }));
    await expect(f.provider.navigate(guestId, "http://localhost/next")).rejects.toMatchObject({ code: "target_hidden" });
    expect(prepareNavigation).not.toHaveBeenCalled();
    prepareNavigation.mockImplementationOnce(async () => {
      f.ensureVisible.mockRejectedValueOnce(Object.assign(Error(), { code: "target_hidden" }));
      return { url: "http://localhost/next", cancel };
    });
    await expect(f.provider.navigate(guestId, "http://localhost/next")).rejects.toMatchObject({ code: "target_hidden" });
    expect(cancel).toHaveBeenCalledOnce(); expect(f.debug.sendCommand.mock.calls.some(([method]) => method === "Page.navigate")).toBe(false);
    f.provider.dispose();
  });
  it.each(["cancel", "deadline", "release"])("%s cannot dispatch a late service ticket or replay preparation", async mode => {
    vi.useFakeTimers(); const pending = deferred<{ url: string; cancel(): void }>(), cancel = vi.fn();
    let guard!: BrowserNavigationGuard;
    const prepareNavigation = vi.fn((_id: string, _url: string, value: BrowserNavigationGuard) => { guard = value; guard.markEffect(); return pending.promise; });
    const f = fixture({ prepareNavigation }); await f.provider.grant(guestId);
    const abort = new AbortController(), navigation = f.provider.navigate(guestId, "http://docs.svc.localhost:26111/", { signal: abort.signal, deadline: Date.now() + 100 });
    const rejected = expect(navigation).rejects.toMatchObject({ code: "outcome_unknown" });
    await until(() => prepareNavigation.mock.calls.length === 1);
    if (mode === "cancel") abort.abort();
    if (mode === "deadline") await vi.advanceTimersByTimeAsync(101);
    if (mode === "release") f.provider.release(guestId);
    if (mode !== "release") await rejected;
    expect(() => guard.check()).toThrow();
    pending.resolve({ url: "http://docs.svc.localhost:26111/__cutex/auth?ticket=dummy", cancel });
    await rejected; await until(() => cancel.mock.calls.length === 1);
    expect(prepareNavigation).toHaveBeenCalledOnce(); expect(f.debug.sendCommand.mock.calls.some(([method]) => method === "Page.navigate")).toBe(false);
    f.provider.dispose(); await vi.advanceTimersByTimeAsync(0);
  });
  it("requires an explicit grant, valid settings, and an admitted live guest", async () => {
    const f = fixture();
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    await expect(f.provider.grant(guestId, { ...DEFAULT_BROWSER_CONTROL_SETTINGS, viewport: { width: 0, height: 720 } })).rejects.toMatchObject({ code: "invalid_request" });
    f.guest.isDestroyed.mockReturnValue(true);
    await expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "target_closed" });
    expect(f.debug.attach).not.toHaveBeenCalled();
  });
  it("fits the configured DPR1 viewport and clears it before release detach without focusing", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    expect(f.debug.sendCommand).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, scale: .5 });
    expect(f.provider.controlView(guestId)).toEqual({ grantee: "Agent", state: "granted", operating: false });
    f.provider.release(guestId);
    expect(f.provider.hasGrant(guestId)).toBe(false);
    await until(() => !f.debug.attached);
    expect(f.debug.sendCommand).toHaveBeenCalledWith("Emulation.clearDeviceMetricsOverride");
    expect(f.debug.sendCommand.mock.invocationCallOrder.at(-1)!).toBeLessThan(f.debug.detach.mock.invocationCallOrder[0]!);
    expect(f.guest.focus).not.toHaveBeenCalled();
  });
  it("checks visibility before attaching or applying any override", async () => {
    const f = fixture(); f.ensureVisible.mockRejectedValueOnce(Object.assign(new Error(), { code: "target_hidden" }));
    await expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.debug.attach).not.toHaveBeenCalled(); expect(f.debug.sendCommand).not.toHaveBeenCalled();
    expect(f.provider.hasGrant(guestId)).toBe(false);
  });
  it("cannot finish a grant released during visibility preflight", async () => {
    const f = fixture(), visible = deferred<{ width: number; height: number }>();
    f.ensureVisible.mockImplementationOnce(() => visible.promise);
    const result = expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    await until(() => f.ensureVisible.mock.calls.length === 1);
    f.provider.release(guestId); visible.resolve({ width: 640, height: 360 }); await result;
    expect(f.debug.attach).not.toHaveBeenCalled();
  });
  it.each(takeoverSources)("%s takeover pauses an idle grant once without forwarding input", async source => {
    vi.useFakeTimers(); const f = fixture(); await f.provider.grant(guestId);
    const changes = f.onChanged.mock.calls.length, guestLookups = f.getGuest.mock.calls.length;
    expect(f.provider.ownerTakeover(guestId, source)).toBeUndefined();
    expect(f.provider.controlView(guestId)).toEqual({ grantee: "Agent", state: "paused", operating: false });
    expect(f.provider.hasGrant(guestId)).toBe(true);
    for (const repeated of takeoverSources) f.provider.ownerTakeover(guestId, repeated);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.onChanged).toHaveBeenCalledTimes(changes + 1);
    expect(f.getGuest).toHaveBeenCalledTimes(guestLookups);
    expect(f.debug.sendCommand.mock.calls.filter(([method]) => method === "Emulation.clearDeviceMetricsOverride")).toHaveLength(1);
    expect(f.debug.detach).toHaveBeenCalledTimes(1);
    expect(f.debug.sendCommand.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    f.provider.dispose();
  });
  it("silently ignores unknown, never-granted, released and disposed takeover targets", async () => {
    const f = fixture();
    for (const source of takeoverSources) {
      f.provider.ownerTakeover("unknown-guest", source);
      f.provider.ownerTakeover(guestId, source);
    }
    expect(f.getGuest).not.toHaveBeenCalled(); expect(f.ensureVisible).not.toHaveBeenCalled();
    expect(f.debug.attach).not.toHaveBeenCalled(); expect(f.debug.sendCommand).not.toHaveBeenCalled();
    expect(f.onChanged).not.toHaveBeenCalled(); expect(f.provider.hasGrant(guestId)).toBe(false);
    await f.provider.grant(guestId); f.provider.release(guestId); await until(() => !f.debug.attached);
    const changes = f.onChanged.mock.calls.length, commands = f.debug.sendCommand.mock.calls.length;
    for (const source of takeoverSources) f.provider.ownerTakeover(guestId, source);
    f.provider.dispose();
    for (const source of takeoverSources) f.provider.ownerTakeover(guestId, source);
    expect(f.onChanged).toHaveBeenCalledTimes(changes); expect(f.debug.sendCommand).toHaveBeenCalledTimes(commands);
    expect(f.debug.detach).toHaveBeenCalledTimes(1); expect(f.provider.controlView(guestId)).toBeUndefined();
  });
  it("revokes before reentrant cleanup callbacks and does not require a current host fence", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    f.getGuest.mockReturnValue(undefined);
    const changes = f.onChanged.mock.calls.length;
    f.debug.handler = method => {
      if (method === "Emulation.clearDeviceMetricsOverride") {
        expect(f.provider.controlView(guestId)?.state).toBe("paused");
        f.provider.ownerTakeover(guestId, "wheel");
      }
    };
    f.provider.ownerTakeover(guestId, "pointerdown"); await until(() => !f.debug.attached);
    expect(f.onChanged).toHaveBeenCalledTimes(changes + 1);
    expect(f.debug.sendCommand.mock.calls.filter(([method]) => method === "Emulation.clearDeviceMetricsOverride")).toHaveLength(1);
    expect(f.debug.detach).toHaveBeenCalledTimes(1); f.provider.dispose();
  });
  it("takeover during grant visibility preflight cannot attach after a late visibility reply", async () => {
    const f = fixture(), visible = deferred<{ width: number; height: number }>();
    f.ensureVisible.mockImplementationOnce(() => visible.promise);
    const result = expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    await until(() => f.ensureVisible.mock.calls.length === 1);
    f.provider.ownerTakeover(guestId, "touchstart");
    visible.resolve({ width: 640, height: 360 }); await result;
    expect(f.provider.controlView(guestId)?.state).toBe("paused");
    expect(f.debug.attach).not.toHaveBeenCalled(); expect(f.debug.sendCommand).not.toHaveBeenCalled();
    f.provider.dispose();
  });
  it("takeover during grant setup leaves a paused grant, not late authority", async () => {
    const f = fixture(), metrics = deferred<unknown>();
    f.debug.handler = method => method === "Emulation.setDeviceMetricsOverride" ? metrics.promise : undefined;
    const result = expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    await until(() => f.debug.sendCommand.mock.calls.some(([method]) => method === "Emulation.setDeviceMetricsOverride"));
    f.provider.ownerTakeover(guestId, "keydown"); metrics.resolve({}); await result;
    expect(f.provider.controlView(guestId)?.state).toBe("paused");
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    f.provider.dispose();
  });
  it.each(takeoverSources)("%s pauses even while operating and preserves outcome_unknown after possible input", async source => {
    const f = fixture(); await f.provider.grant(guestId); const ref = await target(f);
    const input = deferred<unknown>();
    f.debug.handler = method => method === "Input.dispatchMouseEvent" ? input.promise : undefined;
    const result = expect(f.provider.act(guestId, ref, "click")).rejects.toMatchObject({ code: "outcome_unknown" });
    await until(() => f.debug.sendCommand.mock.calls.some(([method]) => method === "Input.dispatchMouseEvent"));
    expect(f.provider.controlView(guestId)?.operating).toBe(true);
    f.provider.ownerTakeover(guestId, source); await result; input.resolve({});
    expect(f.provider.controlView(guestId)).toMatchObject({ state: "paused", operating: false });
    expect(f.debug.sendCommand.mock.calls.filter(([method]) => method === "Input.dispatchMouseEvent")).toHaveLength(1);
    f.debug.handler = undefined;
    await f.provider.grant(guestId);
    await expect(f.provider.act(guestId, ref, "click")).rejects.toMatchObject({ code: "stale_ref" });
    f.provider.dispose();
  });
  it("keeps operating indication for five seconds after completion, then clears it", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.provider.grant(guestId); await target(f);
    expect(f.provider.controlView(guestId)?.operating).toBe(true);
    await vi.advanceTimersByTimeAsync(4999); expect(f.provider.controlView(guestId)?.operating).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(f.provider.controlView(guestId)?.operating).toBe(false);
    f.provider.dispose(); await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("idle detaches after thirty seconds and lazy reattach invalidates old refs", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.provider.grant(guestId); const ref = await target(f);
    await vi.advanceTimersByTimeAsync(29_999); expect(f.debug.attached).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(f.debug.attached).toBe(false); expect(f.provider.hasGrant(guestId)).toBe(true);
    await expect(f.provider.act(guestId, ref, "click")).rejects.toMatchObject({ code: "stale_ref" });
    expect(f.debug.attach).toHaveBeenCalledTimes(2);
    expect(f.debug.sendCommand.mock.calls.filter(([method]) => method === "Emulation.setDeviceMetricsOverride")).toHaveLength(2);
    f.provider.dispose(); await vi.advanceTimersByTimeAsync(0);
  });
  it("never detaches a debugger owned by something else", async () => {
    const f = fixture(); f.debug.attached = true;
    await expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "tab_busy" });
    expect(f.debug.detach).not.toHaveBeenCalled(); expect(f.debug.sendCommand).not.toHaveBeenCalled();
  });
  it("only maps an explicitly policy-blocked navigation to permission_denied", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    f.debug.handler = method => { if (method === "Page.navigate") { f.provider.policyBlocked(guestId); return {}; } };
    await expect(f.provider.navigate(guestId, "http://127.0.0.1/blocked")).rejects.toMatchObject({ code: "permission_denied" });
    f.debug.handler = undefined; await f.provider.grant(guestId); const ref = await target(f);
    f.debug.handler = method => { if (method === "Input.dispatchMouseEvent") { f.provider.policyBlocked(guestId); return {}; } };
    await expect(f.provider.act(guestId, ref, "click")).rejects.toMatchObject({ code: "outcome_unknown" });
    f.provider.dispose();
  });
  it("parses real screenshot dimensions and rejects invalid image bytes", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    expect(await f.provider.screenshot(guestId)).toMatchObject({ width: 1280, height: 720, mimeType: "image/png",
      viewport: { width: 1280, height: 720 }, captureRect: { x: 0, y: 0, width: 1280, height: 720 },
      imageScale: { x: 1, y: 1 }, displayScale: .5 });
    f.debug.handler = method => method === "Page.captureScreenshot" ? { data: "AAAA" } : undefined;
    await expect(f.provider.screenshot(guestId)).rejects.toMatchObject({ code: "transport_error" });
    f.provider.dispose();
  });
  it("find and conditional wait use the same granted provider without focusing or dispatching input", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    const snapshot = await f.provider.find(guestId, { role: "textbox", name: "Message", exact: true });
    expect(snapshot.nodes).toHaveLength(1); expect(snapshot.nodes[0]!.name).toBe("Message");
    expect(await f.provider.action(guestId, { kind: "wait", condition: { kind: "url", url: cdpFixture.frameTree.frameTree.frame.url } }))
      .toMatchObject({ status: "dispatched", observed: true });
    expect(f.debug.sendCommand.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false);
    expect(f.guest.focus).not.toHaveBeenCalled(); f.provider.ownerTakeover(guestId, "wheel");
    await expect(f.provider.find(guestId, { text: "Message" })).rejects.toMatchObject({ code: "permission_denied" });
    await expect(f.provider.action(guestId, { kind: "reload" })).rejects.toMatchObject({ code: "permission_denied" });
    f.provider.dispose();
  });
  it("rechecks guest identity before every CDP command", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    f.getGuest.mockReturnValue(undefined);
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "target_closed" });
    expect(f.debug.sendCommand.mock.calls.some(([method]) => method === "Page.enable")).toBe(false);
    f.provider.dispose();
  });
  it("serializes pending old cleanup before a new grant and bounds a stuck clear", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.provider.grant(guestId);
    const oldClear = deferred<unknown>(); f.debug.handler = method => method === "Emulation.clearDeviceMetricsOverride" ? oldClear.promise : undefined;
    f.provider.release(guestId);
    const next = f.provider.grant(guestId);
    await vi.advanceTimersByTimeAsync(999); expect(f.debug.attach).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await next; expect(f.debug.attach).toHaveBeenCalledTimes(2);
    const commands = f.debug.sendCommand.mock.calls.length;
    oldClear.resolve({}); await vi.advanceTimersByTimeAsync(0);
    expect(f.debug.sendCommand).toHaveBeenCalledTimes(commands); expect(f.debug.detach).toHaveBeenCalledTimes(1);
    f.debug.handler = undefined; f.provider.dispose(); await vi.advanceTimersByTimeAsync(0);
  });
  it("updates fit scale after resize and does not upscale large cards", async () => {
    const f = fixture(); await f.provider.grant(guestId);
    f.ensureVisible.mockResolvedValue({ width: 2560, height: 1440 }); await target(f);
    expect(f.debug.sendCommand).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, scale: 1 });
    f.provider.dispose();
  });
  it.each(["deadline", "abort"] as const)("bounds visibility preflight by caller %s and ignores its late result", async mode => {
    vi.useFakeTimers(); const f = fixture(); await f.provider.grant(guestId);
    const visible = deferred<{ width: number; height: number }>(), controller = new AbortController();
    f.ensureVisible.mockImplementationOnce(() => visible.promise);
    const calls = f.debug.sendCommand.mock.calls.length;
    const result = expect(f.provider.snapshot(guestId, { signal: controller.signal, deadline: Date.now() + 20 }))
      .rejects.toMatchObject({ code: mode === "deadline" ? "deadline_exceeded" : "cancelled" });
    await until(() => f.ensureVisible.mock.calls.length === 2);
    if (mode === "abort") controller.abort(); else await vi.advanceTimersByTimeAsync(20);
    await result; visible.resolve({ width: 640, height: 360 }); await vi.advanceTimersByTimeAsync(0);
    expect(f.debug.sendCommand).toHaveBeenCalledTimes(calls);
    f.provider.dispose(); await vi.advanceTimersByTimeAsync(0);
  });
  it("rejects already-cancelled operations before visibility or debugger effects", async () => {
    const f = fixture(); await f.provider.grant(guestId); const controller = new AbortController(); controller.abort();
    const calls = f.debug.sendCommand.mock.calls.length;
    await expect(f.provider.snapshot(guestId, { signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    await expect(f.provider.snapshot(guestId, { deadline: Date.now() - 1 })).rejects.toMatchObject({ code: "deadline_exceeded" });
    expect(f.ensureVisible).toHaveBeenCalledTimes(1); expect(f.debug.sendCommand).toHaveBeenCalledTimes(calls);
    f.provider.dispose();
  });
  it("pausing fill sends the focus reset before metrics cleanup and never focuses the guest", async () => {
    const f = fixture(); await f.provider.grant(guestId); const ref = await target(f), pending = deferred<unknown>();
    f.debug.handler = method => method === "Input.insertText" ? pending.promise : undefined;
    const result = expect(f.provider.act(guestId, ref, "fill", "hello")).rejects.toMatchObject({ code: "outcome_unknown" });
    await until(() => f.debug.sendCommand.mock.calls.some(([method]) => method === "Input.insertText"));
    f.provider.ownerTakeover(guestId, "guest-keyboard");
    const calls = f.debug.sendCommand.mock.calls;
    const reset = calls.findIndex(([method, params]) => method === "Emulation.setFocusEmulationEnabled" && params.enabled === false);
    const clear = calls.findIndex(([method]) => method === "Emulation.clearDeviceMetricsOverride");
    expect(reset).toBeGreaterThan(-1); expect(clear).toBeGreaterThan(reset);
    await result; pending.resolve({});
    expect(calls.filter(([method, params]) => method === "Emulation.setFocusEmulationEnabled" && params.enabled === false)).toHaveLength(1);
    expect(f.guest.focus).not.toHaveBeenCalled(); f.provider.dispose();
  });
  // Owner report 2026-10-15 (「浏览器每个操作都要审批」): one grant covers every later call until
  // release / revoke / an explicit owner takeover; re-attach after idle detach is not a new request.
  it("a grant stays granted across reads, screenshots, idle detach and lazy re-attach; only owner takeover pauses", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.provider.grant(guestId);
    for (let round = 0; round < 3; round++) {
      await f.provider.snapshot(guestId);
      await f.provider.screenshot(guestId, { format: "png" });
      await f.provider.act(guestId, await target(f), "click");
      expect(f.provider.controlView(guestId)?.state).toBe("granted");
      await vi.advanceTimersByTimeAsync(30_000); // idle detach
      expect(f.debug.attached).toBe(false); expect(f.provider.controlView(guestId)?.state).toBe("granted");
    }
    expect(f.debug.attach).toHaveBeenCalledTimes(3);
    f.provider.ownerTakeover(guestId, "keydown");
    expect(f.provider.controlView(guestId)?.state).toBe("paused");
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    await f.provider.grant(guestId); // the explicit owner resume
    await f.provider.screenshot(guestId, { format: "png" });
    expect(f.provider.controlView(guestId)?.state).toBe("granted");
    f.provider.dispose(); await vi.advanceTimersByTimeAsync(0);
  });
  it("refuses fill / press before attaching or dispatching when the guest lacks app keyboard focus, keeping the grant", async () => {
    const keyboardFocused = vi.fn(async () => false);
    const f = fixture({ keyboardFocused }); await f.provider.grant(guestId); const ref = await target(f);
    const before = f.debug.sendCommand.mock.calls.length;
    await expect(f.provider.act(guestId, ref, "fill", "hello")).rejects.toMatchObject({ code: "unsupported_operation" });
    await expect(f.provider.action(guestId, { kind: "press", ref, key: "Enter" })).rejects.toMatchObject({ code: "unsupported_operation" });
    expect(f.debug.sendCommand.mock.calls.slice(before).some(([method]) => method.startsWith("Input.") || method.startsWith("Emulation.setFocus"))).toBe(false);
    expect(keyboardFocused).toHaveBeenCalledWith(guestId);
    expect(f.provider.controlView(guestId)?.state).toBe("granted");
    await f.provider.act(guestId, ref, "click"); // pointer input is unaffected
    keyboardFocused.mockResolvedValue(true);
    await f.provider.act(guestId, await target(f), "fill", "hello");
    expect(f.debug.sendCommand).toHaveBeenCalledWith("Input.insertText", { text: "hello" });
    expect(f.guest.focus).not.toHaveBeenCalled(); f.provider.dispose();
  });
  it("does not execute concurrent commands or keep idle timers across disposal", async () => {
    const f = fixture(); await f.provider.grant(guestId); const pending = deferred<unknown>();
    f.debug.handler = method => method === "Accessibility.getFullAXTree" ? pending.promise : undefined;
    const result = expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "cancelled" });
    await until(() => f.debug.sendCommand.mock.calls.some(([method]) => method === "Accessibility.getFullAXTree"));
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "busy" });
    f.provider.dispose(); await result; pending.resolve(cdpFixture.ax);
    await expect(f.provider.grant(guestId)).rejects.toMatchObject({ code: "target_closed" });
  });
});
