import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InAppProvider } from "../src/main/browser/provider";
import { DEFAULT_BROWSER_CONTROL_SETTINGS as settings } from "../src/shared/browser";
import fixtureData from "../../../packages/browser-cdp/fixtures/cdp-shapes.json";

const guestId = "guest-agent-1";
class DebuggerFake extends EventEmitter {
  attached = false;
  attach = vi.fn(() => { this.attached = true; });
  detach = vi.fn(() => { this.attached = false; this.emit("detach", {}, "detached"); });
  isAttached = () => this.attached;
  handler?: (method: string) => unknown;
  sendCommand = vi.fn(async (method: string): Promise<unknown> => {
    const custom = this.handler?.(method); if (custom !== undefined) return custom;
    if (method === "Page.getFrameTree") return fixtureData.frameTree;
    if (method === "Accessibility.getFullAXTree") return fixtureData.ax;
    if (method === "DOM.describeNode") return { node: { attributes: ["type", "text"] } };
    return {};
  });
}
function setup() {
  let generation = 0;
  const debug = new DebuggerFake(), guest = { isDestroyed: () => false, debugger: debug };
  const getGuest = vi.fn(() => guest), onChanged = vi.fn();
  const visible = vi.fn(async () => ({ width: 1280, height: 720 }));
  const provider = new InAppProvider({ getGuest: id => id === guestId ? getGuest() as never : undefined,
    onChanged, ensureVisible: visible, allowUrl: () => true, nextPageGeneration: () => ++generation });
  return { provider, debug, guest, getGuest, onChanged, visible };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await Promise.resolve();
  expect(check()).toBe(true);
}
afterEach(() => vi.useRealTimers());

describe("agent-open deferred in-app grants", () => {
  it("owner turn-shot overrides reveal down to reject before attachment and cannot surface a hidden page", async () => {
    const f = setup();
    await f.provider.grant(guestId, { ...settings, hiddenTarget: "reveal" }, { deferBinding: true });
    f.visible.mockRejectedValue(Object.assign(new Error(), { code: "target_hidden" }));
    await expect(f.provider.screenshot(guestId, { hiddenTarget: "reject" })).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.visible).toHaveBeenCalledWith(guestId, expect.objectContaining({ hiddenTarget: "reject" }), expect.objectContaining({ hiddenTarget: "reject" }));
    expect(f.debug.attach).not.toHaveBeenCalled();
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.visible).toHaveBeenNthCalledWith(2, guestId, expect.objectContaining({ hiddenTarget: "reveal" }), expect.any(Object));
    f.provider.dispose();
  });
  it("creates only authority and the actual grantee label: no visibility, CDP, metrics or idle timer", async () => {
    vi.useFakeTimers(); const f = setup();
    await f.provider.grant(guestId, settings, { grantee: "Alpha", deferBinding: true });
    expect(f.provider.controlView(guestId)).toEqual({ grantee: "Alpha", state: "granted", operating: false });
    expect(f.visible).not.toHaveBeenCalled(); expect(f.debug.attach).not.toHaveBeenCalled();
    expect(f.debug.sendCommand).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    f.provider.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps existing owner grants eager and permits a named eager grantee", async () => {
    const f = setup(); await f.provider.grant(guestId, settings, { grantee: "Owner-selected agent" });
    expect(f.visible).toHaveBeenCalledOnce(); expect(f.debug.attach).toHaveBeenCalledOnce();
    expect(f.provider.controlView(guestId)?.grantee).toBe("Owner-selected agent"); f.provider.dispose();
  });
  it("validates options before replacing an existing grant", async () => {
    const f = setup(); await f.provider.grant(guestId, settings, { grantee: "Original", deferBinding: true });
    for (const options of [{ grantee: "" }, { grantee: "\u0085" }, { grantee: "x".repeat(201) }, { deferBinding: "true" }, { bypassVisibility: true }])
      await expect(f.provider.grant(guestId, settings, options as never)).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.provider.controlView(guestId)?.grantee).toBe("Original"); f.provider.dispose();
  });
  it("does not turn a hidden grant into permission to act, read or screenshot", async () => {
    const f = setup(); f.visible.mockRejectedValue(Object.assign(new Error(), { code: "target_hidden" }));
    await f.provider.grant(guestId, settings, { grantee: "Background", deferBinding: true });
    for (const run of [() => f.provider.snapshot(guestId), () => f.provider.find(guestId, { text: "Message" }),
      () => f.provider.act(guestId, "old-ref", "click"), () => f.provider.screenshot(guestId),
      () => f.provider.navigate(guestId, "about:blank")])
      await expect(run()).rejects.toMatchObject({ code: "target_hidden" });
    expect(f.visible).toHaveBeenCalledTimes(5); expect(f.debug.attach).not.toHaveBeenCalled();
    expect(f.debug.sendCommand).not.toHaveBeenCalled(); f.provider.dispose();
  });
  it("owner takeover pauses an unbound grant idempotently and requires explicit regrant", async () => {
    const f = setup(); await f.provider.grant(guestId, settings, { grantee: "Alpha", deferBinding: true });
    f.provider.ownerTakeover(guestId, "pointerdown"); f.provider.ownerTakeover(guestId, "keydown");
    expect(f.provider.controlView(guestId)).toEqual({ grantee: "Alpha", state: "paused", operating: false });
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    expect(f.visible).not.toHaveBeenCalled(); expect(f.debug.sendCommand).not.toHaveBeenCalled();
    await f.provider.grant(guestId, settings, { grantee: "Alpha", deferBinding: true });
    expect(f.provider.controlView(guestId)?.state).toBe("granted"); f.provider.dispose();
  });
  it("releasing an unbound grant cannot issue cleanup CDP or retain authority", async () => {
    const f = setup(); await f.provider.grant(guestId, settings, { deferBinding: true });
    f.provider.release(guestId); f.provider.release(guestId); f.provider.ownerTakeover(guestId, "wheel");
    expect(f.provider.controlView(guestId)).toBeUndefined(); expect(f.debug.detach).not.toHaveBeenCalled();
    expect(f.debug.sendCommand).not.toHaveBeenCalled();
    await expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" }); f.provider.dispose();
  });
  it("first real observation lazily attaches only after visibility and regrant never borrows old refs", async () => {
    const f = setup(); await f.provider.grant(guestId, settings, { grantee: "First", deferBinding: true });
    const before = await f.provider.snapshot(guestId), ref = before.nodes.find(node => node.name === "Message")!.ref;
    expect(f.visible.mock.invocationCallOrder[0]!).toBeLessThan(f.debug.attach.mock.invocationCallOrder[0]!);
    await f.provider.grant(guestId, settings, { grantee: "Second", deferBinding: true });
    await until(() => !f.debug.attached);
    expect(f.debug.attach).toHaveBeenCalledTimes(1); expect(f.provider.controlView(guestId)?.grantee).toBe("Second");
    await expect(f.provider.act(guestId, ref, "click")).rejects.toMatchObject({ code: "stale_ref" });
    expect(f.debug.attach).toHaveBeenCalledTimes(2);
    expect(f.debug.sendCommand.mock.calls.some(([method]) => method.startsWith("Input."))).toBe(false); f.provider.dispose();
  });
  it("late visibility cannot attach after release of a deferred grant", async () => {
    const f = setup(); let resolve!: (value: { width: number; height: number }) => void;
    f.visible.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    await f.provider.grant(guestId, settings, { deferBinding: true });
    const pending = expect(f.provider.snapshot(guestId)).rejects.toMatchObject({ code: "permission_denied" });
    await until(() => f.visible.mock.calls.length === 1); f.provider.release(guestId);
    resolve({ width: 1280, height: 720 }); await pending;
    expect(f.debug.attach).not.toHaveBeenCalled(); expect(f.debug.sendCommand).not.toHaveBeenCalled(); f.provider.dispose();
  });
  it("deferred regrant cannot race replacement attachment ahead of old debugger cleanup", async () => {
    vi.useFakeTimers(); const f = setup(); await f.provider.grant(guestId);
    let finish!: (value: unknown) => void;
    const cleanup = new Promise(yes => { finish = yes; });
    f.debug.handler = method => method === "Emulation.clearDeviceMetricsOverride" ? cleanup : undefined;
    await f.provider.grant(guestId, settings, { grantee: "Next", deferBinding: true });
    const read = f.provider.snapshot(guestId);
    await vi.advanceTimersByTimeAsync(999); expect(f.debug.attach).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await read;
    expect(f.debug.attach).toHaveBeenCalledTimes(2); expect(f.debug.detach).toHaveBeenCalledTimes(1);
    finish({}); await vi.advanceTimersByTimeAsync(0); expect(f.debug.detach).toHaveBeenCalledTimes(1);
    f.debug.handler = undefined; f.provider.dispose(); await vi.advanceTimersByTimeAsync(0);
  });
});
