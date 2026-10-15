import { Script } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { buildSandboxDocument, mountSandbox, type MountOptions } from "../src/index";

class Frame extends EventTarget {
  title = ""; src = ""; srcdoc = ""; attrs = new Map<string, string>();
  contentWindow = { postMessage: vi.fn() }; remove = vi.fn();
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
}
class Port {
  postMessage = vi.fn(); start = vi.fn(); close = vi.fn();
  addEventListener = vi.fn(); removeEventListener = vi.fn();
}
const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); });
function fixture(factory: NonNullable<MountOptions["documentFactory"]>) {
  const frame = new Frame(), listeners = new Set<(event: MessageEvent) => void>(), append = vi.fn();
  vi.stubGlobal("document", { createElement: () => frame });
  vi.stubGlobal("window", { addEventListener: (_: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) => listeners.delete(listener) });
  const mount = mountSandbox({ append } as unknown as HTMLElement, { resource: { kind: "external-plugin", pluginId: "sample", html: "", script: "", requestedPermissions: [] },
    title: "sample", scope: { hostId: "a" }, grantedPermissions: [], operations: {}, documentFactory: factory });
  disposers.push(mount.dispose);
  return { frame, listeners, append, mount, send(event: object) { for (const listener of listeners) listener(event as MessageEvent); } };
}
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

it("releases a prepared URL that arrives after disposal, without mounting it", async () => {
  let finish!: (resource: { url: string; dispose(): void }) => void;
  const release = vi.fn(), f = fixture(() => new Promise(resolve => { finish = resolve; }));
  await tick(); f.mount.dispose(); finish({ url: "cutex-plugin://frame/late/index.html", dispose: release }); await tick();
  expect(release).toHaveBeenCalledOnce(); expect(f.append).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
  await expect(f.mount.ready).rejects.toThrow("disposed");
});
it("uses an opaque document handshake, rejects a forged origin, and revokes on reload", async () => {
  let identity!: { instanceId: string; channel: string }; const release = vi.fn();
  const f = fixture(async value => { identity = value; return { url: "cutex-plugin://frame/test/index.html", dispose: release }; }); await tick();
  expect(f.frame.attrs.get("sandbox")).toBe("allow-scripts"); expect(f.frame.srcdoc).toBe("");
  expect(f.frame.src).toContain("cutex-plugin:"); expect(f.append).toHaveBeenCalledOnce();
  f.frame.dispatchEvent(new Event("load"));
  const challenge = f.frame.contentWindow.postMessage.mock.calls[0]![0].challenge;
  const port = new Port();
  const event = { data: { version: 1, kind: "ready", ...identity, challenge }, source: f.frame.contentWindow, ports: [port] };
  f.send({ ...event, origin: "cutex-plugin://frame" }); expect(port.start).not.toHaveBeenCalled();
  f.send({ ...event, origin: "null" }); await f.mount.ready; expect(port.start).toHaveBeenCalledOnce();
  f.frame.dispatchEvent(new Event("load")); expect(port.close).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce(); expect(f.frame.remove).toHaveBeenCalledOnce();
});
it("revokes a document navigated before it completes the handshake", async () => {
  const release = vi.fn(), f = fixture(async () => ({ url: "cutex-plugin://frame/test/index.html", dispose: release })); await tick();
  f.frame.dispatchEvent(new Event("load")); f.frame.dispatchEvent(new Event("load"));
  await expect(f.mount.ready).rejects.toThrow("disposed"); expect(release).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0);
});
it("rejects failed preparation without appending a fallback srcdoc", async () => {
  const f = fixture(async () => { throw new Error("package changed"); });
  await expect(f.mount.ready).rejects.toThrow("package changed"); expect(f.append).not.toHaveBeenCalled(); expect(f.listeners.size).toBe(0);
});
it("builds a strict response CSP and syntactically independent bootstrap", () => {
  const document = buildSandboxDocument({ instanceId: "instance", channel: "channel", html: "<p>sample</p>", script: 'window.marker = "</script>";', styles: ["p { color: red; }"] });
  expect(document.csp).toContain("connect-src 'none'"); expect(document.csp).not.toContain("unsafe-eval");
  expect(document.html).not.toContain("window.cutex"); expect(document.html).not.toContain("require(");
  const scripts = [...document.html.matchAll(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/g)].map(match => match[1]!);
  expect(scripts).toHaveLength(2); for (const script of scripts) expect(() => new Script(script)).not.toThrow();
});

it("bootstrap removes WebRTC and WebTransport constructors before plugin script runs", () => {
  const document = buildSandboxDocument({ instanceId: "instance", channel: "channel", html: "", script: "" });
  const bootstrap = [...document.html.matchAll(/<script nonce="[a-f0-9]+">([\s\S]*?)<\/script>/g)][0]![1]!;
  const window: Record<string, unknown> = { RTCPeerConnection() {}, webkitRTCPeerConnection() {}, RTCDataChannel() {}, RTCIceCandidate() {},
    WebTransport() {}, WebSocket() {}, addEventListener() {} };
  new Script(bootstrap).runInNewContext({ window, parent: {}, Object, Promise, Map, setTimeout, clearTimeout, MessageChannel: class {} });
  expect(Object.getOwnPropertyNames(window).sort()).toEqual(["WebSocket", "addEventListener", "sandboxBridge"]);
});

it("does not request a resource after immediate disposal and removes frames despite a release failure", async () => {
  const prepare = vi.fn(async () => ({ url: "cutex-plugin://frame/test/index.html", dispose() {} }));
  const immediate = fixture(prepare); immediate.mount.dispose(); await tick(); expect(prepare).not.toHaveBeenCalled();
  const f = fixture(async () => ({ url: "cutex-plugin://frame/test/index.html", dispose() { throw new Error("release failed"); } }));
  await tick(); expect(() => f.mount.dispose()).toThrow("release failed");
  expect(f.frame.remove).toHaveBeenCalledOnce(); expect(f.listeners.size).toBe(0);
});
