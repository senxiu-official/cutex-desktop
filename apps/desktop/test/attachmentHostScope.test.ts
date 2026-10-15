import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as any[], read: vi.fn(), stat: vi.fn(), dialog: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: fixture.read, stat: fixture.stat, writeFile: vi.fn() }));
vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: fixture.dialog },
  shell: {},
}));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    uploadAttachment = vi.fn(async (_sid: string, _bytes: Uint8Array, _mime: string) => ({ path: `/remote/${fixture.clients.indexOf(this)}.png` }));
    submitInput = vi.fn(async () => ({ accepted: true }));
    constructor(public endpoint: unknown) { fixture.clients.push(this); }
    // No network, event feed or timer; connection remains in progress.
    host() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function tick() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
let service: DaemonService;
function switchTo(name: string, remote = true) {
  service.useEndpoint({ baseUrl: `http://${name}.invalid`, token: "fake" } as any, { remote });
  return fixture.clients.at(-1);
}
async function pick(paths = ["/fixture/one.png"]) {
  fixture.dialog.mockResolvedValue({ canceled: false, filePaths: paths });
  await service.pickImages();
  fixture.read.mockClear();
}
function send(paths = ["/fixture/one.png"]) {
  return service.submit("same-session", "hello", "auto", false, {
    extra: paths.map((path) => ({ type: "localImage", path })),
    clientUserMessageId: "stable-message",
  });
}
beforeEach(() => {
  fixture.clients.length = 0;
  fixture.read.mockReset().mockResolvedValue(Buffer.from("fake image"));
  fixture.stat.mockReset().mockResolvedValue({ size: 10 });
  fixture.dialog.mockReset();
  service = new DaemonService(() => {});
});
afterEach(() => service.stop());

describe("attachment host routing through real DaemonService", () => {
  it("keeps normal sequential uploads and submit on originating client", async () => {
    const a = switchTo("a");
    await pick(["/fixture/one.png", "/fixture/two.png"]);
    await send(["/fixture/one.png", "/fixture/two.png"]);
    expect(a.uploadAttachment).toHaveBeenCalledTimes(2);
    expect(a.submitInput).toHaveBeenCalledTimes(1);
    expect(a.submitInput.mock.calls[0][3]).toEqual({ startIfOffline: false, clientUserMessageId: "stable-message", onHttpTrace: expect.any(Function) });
  });

  it("rejects host switch during file read before any upload or submit", async () => {
    const a = switchTo("a");
    await pick();
    const gate = deferred<Buffer>();
    fixture.read.mockReturnValueOnce(gate.promise);
    const result = send().catch((error) => error);
    await tick();
    const b = switchTo("b");
    gate.resolve(Buffer.from("secret fixture"));
    expect(await result).toBeInstanceOf(Error);
    expect(a.uploadAttachment).not.toHaveBeenCalled();
    expect(b.uploadAttachment).not.toHaveBeenCalled();
    expect(a.submitInput).not.toHaveBeenCalled();
  });

  it("rejects A to B to A during read despite matching host URL", async () => {
    const a = switchTo("a");
    await pick();
    const gate = deferred<Buffer>();
    fixture.read.mockReturnValueOnce(gate.promise);
    const result = send().catch((error) => error);
    await tick();
    switchTo("b");
    const a2 = switchTo("a");
    gate.resolve(Buffer.from("image"));
    expect(await result).toBeInstanceOf(Error);
    expect(a.uploadAttachment).not.toHaveBeenCalled();
    expect(a2.uploadAttachment).not.toHaveBeenCalled();
  });

  it("stops before reading a second attachment when first upload resolves stale", async () => {
    const a = switchTo("a");
    await pick(["/fixture/one.png", "/fixture/two.png"]);
    const gate = deferred<{ path: string }>();
    a.uploadAttachment.mockReturnValueOnce(gate.promise);
    const result = send(["/fixture/one.png", "/fixture/two.png"]).catch((error) => error);
    await tick();
    expect(a.uploadAttachment).toHaveBeenCalledTimes(1);
    const b = switchTo("b");
    gate.resolve({ path: "/remote/a.png" });
    expect(await result).toBeInstanceOf(Error);
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(b.uploadAttachment).not.toHaveBeenCalled();
    expect(a.submitInput).not.toHaveBeenCalled();
  });

  it("does not submit after a switched first upload rejects", async () => {
    const a = switchTo("a");
    await pick();
    const gate = deferred<{ path: string }>();
    a.uploadAttachment.mockReturnValueOnce(gate.promise);
    const result = send().catch((error) => error);
    await tick();
    const b = switchTo("b");
    gate.reject(new Error("old upload failed"));
    expect(await result).toBeInstanceOf(Error);
    expect(a.submitInput).not.toHaveBeenCalled();
    expect(b.uploadAttachment).not.toHaveBeenCalled();
  });

  it("fences suspend and stop while reading", async () => {
    for (const stop of [() => service.suspend({ kind: "connecting", baseUrl: "" }, { remote: true }), () => service.stop()]) {
      const a = switchTo("a");
      await pick();
      const gate = deferred<Buffer>();
      fixture.read.mockReturnValueOnce(gate.promise);
      const result = send().catch((error) => error);
      await tick();
      stop();
      gate.resolve(Buffer.from("image"));
      expect(await result).toBeInstanceOf(Error);
      expect(a.uploadAttachment).not.toHaveBeenCalled();
    }
  });

  it("fences even local no-upload input across the async preparation boundary", async () => {
    const a = switchTo("local", false);
    const result = send([]).catch((error) => error);
    switchTo("b");
    expect(await result).toBeInstanceOf(Error);
    expect(a.submitInput).not.toHaveBeenCalled();
  });

  it("does not report stale successful submit as current success", async () => {
    const a = switchTo("a");
    const gate = deferred<{ accepted: true }>();
    a.submitInput.mockReturnValueOnce(gate.promise);
    const result = send([]).catch((error) => error);
    await tick();
    expect(a.submitInput).toHaveBeenCalledTimes(1);
    switchTo("b");
    gate.resolve({ accepted: true });
    expect(await result).toBeInstanceOf(Error);
  });

  it("allows same-daemon tunnel retarget without generation change", async () => {
    const a = switchTo("a");
    await pick();
    const gate = deferred<Buffer>();
    fixture.read.mockReturnValueOnce(gate.promise);
    const result = send();
    await tick();
    service.retarget("http://a-new-tunnel.invalid");
    gate.resolve(Buffer.from("image"));
    await result;
    expect(a.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(a.submitInput).toHaveBeenCalledTimes(1);
  });
});
