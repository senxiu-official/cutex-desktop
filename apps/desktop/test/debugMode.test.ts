import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserWindow, NativeImage, Rectangle } from "electron";
import { DebugMode } from "../src/main/debugMode";
import { DebugRing, debugEntries, debugError, debugErrorText, debugShortcut } from "../src/shared/debug";
import { parsePrefs } from "../src/shared/shell";

const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function windowFixture(id = 1) {
  const wc = Object.assign(new EventEmitter(), {
    id, isDestroyed: () => false, beginFrameSubscription: vi.fn(), endFrameSubscription: vi.fn(), openDevTools: vi.fn(),
  });
  const win = Object.assign(new EventEmitter(), { webContents: wc });
  const frame = (time = Date.now()) => {
    vi.spyOn(Date, "now").mockReturnValue(time);
    const image = { isEmpty: () => false, getSize: () => ({ width: 1600, height: 1000 }), resize: () => ({ toJPEG: () => Buffer.from("test-jpeg") }) };
    const callback = wc.beginFrameSubscription.mock.calls.at(-1)![1] as (image: NativeImage, rect: Rectangle) => void;
    callback(image as unknown as NativeImage, { x: 1, y: 2, width: 700, height: 600 });
    vi.restoreAllMocks();
  };
  return { wc, win: win as unknown as BrowserWindow, frame };
}

describe("debug mode", () => {
  it("defaults off, ignores malformed stored values and persists an explicit true", () => {
    expect(parsePrefs({}).debugMode).toBeUndefined();
    expect(parsePrefs({ debugMode: "true" }).debugMode).toBeUndefined();
    expect(parsePrefs(JSON.parse(JSON.stringify({ debugMode: true }))).debugMode).toBe(true);
  });
  it.each(["win32", "linux", "darwin"])("uses non-conflicting save keys and platform DevTools keys on %s", platform => {
    const primary = platform === "darwin" ? { meta: true } : { control: true };
    const key = { type: "keyDown", key: "F", ...primary, shift: true };
    expect(debugShortcut(platform, key)).toBeNull(); // existing panel fullscreen
    expect(debugShortcut(platform, { ...key, alt: true })).toBe("save");
    expect(debugShortcut(platform, { ...key, alt: true, isAutoRepeat: true })).toBeNull();
    expect(debugShortcut(platform, { type: "keyDown", key: "i", ...primary, ...(platform === "darwin" ? { alt: true } : { shift: true }) })).toBe("devtools");
    expect(debugShortcut(platform, { ...key, key: "ƒ", code: "KeyF", alt: true })).toBe("save");
    expect(debugShortcut(platform, { type: "keyUp", key: "f", ...primary, shift: true, alt: true })).toBeNull();
  });
  it("bounds memory and age independently, including a quiet buffer", () => {
    const ring = new DebugRing<{ time: number; value: string }>(10, 30);
    ring.push({ time: 1, value: "a" }, 6); ring.push({ time: 2, value: "b" }, 6);
    expect(ring.snapshot(3).map(e => e.value)).toEqual(["b"]);
    ring.push({ time: 3, value: "huge" }, 11);
    expect(ring.bytes).toBe(6);
    expect(ring.snapshot(33)).toEqual([]);
    expect(ring.bytes).toBe(0);
  });
  it("starts no capture or key listeners while off; stops them and clears memory when disabled", async () => {
    const debug = new DebugMode({ logs: () => "unused", emit: vi.fn(), platform: "darwin" });
    const fixture = windowFixture(); debug.register(fixture.win);
    expect(fixture.wc.beginFrameSubscription).not.toHaveBeenCalled();
    expect(fixture.wc.listenerCount("before-input-event")).toBe(0);
    await expect(debug.save()).rejects.toThrow("off");
    debug.setEnabled(true); fixture.frame();
    expect(debug.state().frames).toBe(1);
    fixture.wc.emit("did-finish-load");
    expect(fixture.wc.beginFrameSubscription).toHaveBeenCalledTimes(2);
    debug.setEnabled(false);
    expect(fixture.wc.endFrameSubscription).toHaveBeenCalledTimes(2);
    expect(fixture.wc.listenerCount("before-input-event")).toBe(0);
    expect(debug.state()).toMatchObject({ enabled: false, frames: 0, bytes: 0 });
    debug.setEnabled(true);
    expect(fixture.wc.beginFrameSubscription).toHaveBeenCalledTimes(3);
    debug.setEnabled(false);
  });
  it("captures app and desk windows, and runs Mac shortcuts without Windows APIs", () => {
    const debug = new DebugMode({ logs: () => "unused", emit: vi.fn(), platform: "darwin" });
    const first = windowFixture(1), desk = windowFixture(2);
    debug.register(first.win); debug.setEnabled(true); debug.register(desk.win);
    expect(debug.state().windows).toBe(2);
    const preventDefault = vi.fn();
    desk.wc.emit("before-input-event", { preventDefault }, { type: "keyDown", key: "i", meta: true, alt: true });
    expect(desk.wc.openDevTools).toHaveBeenCalledWith({ mode: "detach" });
    expect(preventDefault).toHaveBeenCalledOnce();
    desk.win.emit("closed");
    expect(debug.state().windows).toBe(1);
    debug.setEnabled(false);
  });
  it("keeps recording when DevTools takes over, reattaches once on close, and never detaches someone else's debugger", async () => {
    const debug = new DebugMode({ logs: () => "unused", emit: vi.fn(), platform: "darwin" });
    const first = windowFixture();
    let attached = false;
    const client = Object.assign(new EventEmitter(), {
      isAttached: () => attached,
      attach: vi.fn(() => { attached = true; }),
      detach: vi.fn(() => { attached = false; }),
      sendCommand: vi.fn(async () => ({})),
    });
    Object.assign(first.wc, { debugger: client });
    debug.register(first.win); debug.setEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
    expect(client.sendCommand).toHaveBeenCalledWith("Page.startScreencast", expect.objectContaining({ format: "jpeg", everyNthFrame: 1 }));
    client.emit("message", {}, "Page.screencastFrame", { data: Buffer.from("jpeg").toString("base64"), sessionId: 2, metadata: { timestamp: Date.now() / 1000 } });
    expect(debug.state().frames).toBe(1);
    client.emit("message", {}, "Page.screencastFrame", { data: Buffer.from("brief blank").toString("base64"), sessionId: 3, metadata: { timestamp: Date.now() / 1000 + 0.005 } });
    expect(debug.state().frames).toBe(2); // do not lose a changed frame just5ms later
    attached = false; client.emit("detach", {}, "replaced_with_devtools");
    expect(first.wc.beginFrameSubscription).toHaveBeenCalledOnce();
    first.wc.emit("devtools-closed");
    await new Promise(resolve => setImmediate(resolve));
    expect(client.attach).toHaveBeenCalledTimes(2);
    expect(client.listenerCount("message")).toBe(1);
    expect(first.wc.endFrameSubscription).toHaveBeenCalledOnce();
    first.wc.emit("devtools-closed"); // new Electron versions keep our client attached
    await new Promise(resolve => setImmediate(resolve));
    expect(first.wc.beginFrameSubscription).toHaveBeenCalledOnce();
    debug.setEnabled(false);
    expect(client.detach).toHaveBeenCalledOnce();
    // A different debugger already owns this window: only use the native fallback.
    attached = true;
    debug.setEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
    debug.setEnabled(false);
    expect(client.detach).toHaveBeenCalledOnce();
  });
  it.each(["darwin", "win32", "linux"])("saves a bounded local bundle on %s, including telemetry flushed immediately before save", async platform => {
    const dir = await mkdtemp(join(tmpdir(), "cutex-debug-")); dirs.push(dir);
    const emit = vi.fn();
    const debug: DebugMode = new DebugMode({ logs: () => dir, emit, platform, flush: async () => debug.report([{ time: Date.now(), kind: "react-commit", source: "React", data: { components: ["Conversation"] } }]) });
    const first = windowFixture(); debug.register(first.win); debug.setEnabled(true); first.frame();
    const one = debug.save(), two = debug.save(); expect(two).toBe(one);
    const state = await one; expect(state.lastBundle?.startsWith(join(dir, "debug"))).toBe(true);
    const files = await readdir(state.lastBundle!); expect(files).toEqual(expect.arrayContaining(["index.html", "manifest.json", "events.json", "frame-00000.jpg"]));
    const manifest = JSON.parse(await readFile(join(state.lastBundle!, "manifest.json"), "utf8"));
    expect(manifest.platform).toBe(platform); expect(manifest.frames[0].rect.width).toBe(700);
    expect(JSON.parse(await readFile(join(state.lastBundle!, "events.json"), "utf8"))[0].kind).toBe("react-commit");
    debug.setEnabled(false);
  });
  it("does not start the fallback on an already destroyed desk when its debugger detaches", async () => {
    const debug = new DebugMode({ logs: () => "unused", emit: vi.fn(), platform: "darwin" });
    const first = windowFixture(); let attached = false;
    const client = Object.assign(new EventEmitter(), { isAttached: () => attached, attach: () => { attached = true; }, detach() {}, sendCommand: async () => ({}) });
    Object.assign(first.wc, { debugger: client }); debug.register(first.win); debug.setEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
    Object.assign(first.wc, { isDestroyed: () => true }); attached = false; client.emit("detach", {}, "target_closed");
    expect(first.wc.beginFrameSubscription).not.toHaveBeenCalled();
    expect(debug.state().error).toBeNull();
    debug.setEnabled(false);
  });
  it("preserves code, raw message and origin and rejects oversized/unbounded telemetry", () => {
    const e = debugError({ code: "side_chat_invalid_message", message: "invalid text" }, "invoke.sideChatSend", 100);
    expect(debugErrorText(e)).toContain("side_chat_invalid_message\ninvalid text");
    expect(debugErrorText(e)).toContain("invoke.sideChatSend");
    expect(debugEntries([e], 101)).toEqual([e]);
    expect(() => debugEntries([{ ...e, time: NaN }], 101)).toThrow();
    expect(() => debugEntries([{ ...e, message: "x".repeat(24_001) }], 101)).toThrow();
    expect(() => debugEntries(Array(129).fill(e), 101)).toThrow();
  });
});
