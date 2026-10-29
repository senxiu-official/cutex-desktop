// @vitest-environment jsdom
// The parent-side broker of agent pages (modules/artifacts/pageBroker.ts): only that frame instance, only
// the fixed schema, copy only during a gesture; replies only to that frame.
import { describe, expect, it, vi } from "vitest";
import { PAGE_MAX_IN_FLIGHT, PAGE_MESSAGE_TAG, type PageResult } from "../src/shared/pageBridge";
import { attachPageBroker, frameGestureActive } from "../src/renderer/src/modules/artifacts/pageBroker";

function setup(options: { gesture?: boolean; forward?: (id: string, call: unknown) => Promise<PageResult> } = {}) {
  const host = new EventTarget() as unknown as Window;
  const frameWindow = { postMessage: vi.fn() } as unknown as Window;
  const otherWindow = { postMessage: vi.fn() } as unknown as Window;
  const forward = vi.fn(options.forward ?? (async () => ({ ok: true as const })));
  const copied = vi.fn();
  const detach = attachPageBroker({ frame: { contentWindow: frameWindow }, frameId: "doc-1", forward, gesture: () => options.gesture ?? false, copied, host });
  const post = (data: unknown, source: Window | null = frameWindow, origin = "null") => host.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  const replies = () => (frameWindow.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
  return { forward, copied, detach, post, replies, frameWindow, otherWindow };
}
const msg = (id: number, patch: Record<string, unknown>) => ({ tag: PAGE_MESSAGE_TAG, id, ...patch });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("page broker", () => {
  it("forwards a valid request of this frame with its main frame id and replies to it", async () => {
    const s = setup({ forward: async () => ({ ok: true, value: "v" }) });
    s.post(msg(3, { op: "storage.get", key: "k" }));
    await flush();
    expect(s.forward).toHaveBeenCalledWith("doc-1", { op: "storage.get", key: "k" });
    expect(s.replies()).toEqual([{ tag: PAGE_MESSAGE_TAG, re: 3, ok: true, value: "v" }]);
  });
  it("ignores another window, a non-opaque origin, and non-page messages", async () => {
    const s = setup();
    s.post(msg(1, { op: "storage.keys" }), s.otherWindow);
    s.post(msg(1, { op: "storage.keys" }), null);
    s.post(msg(1, { op: "storage.keys" }), s.frameWindow, "http://127.0.0.1:5173");
    s.post({ hello: 1 });
    await flush();
    expect(s.forward).not.toHaveBeenCalled();
    expect(s.replies()).toEqual([]);
    expect((s.otherWindow.postMessage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
  it("answers bad requests itself without reaching main", async () => {
    const s = setup();
    s.post(msg(1, { op: "fetch", url: "http://example.com" }));
    s.post(msg(2, { op: "storage.get", key: "k", artifactId: "af-x" }));
    await flush();
    expect(s.forward).not.toHaveBeenCalled();
    expect(s.replies().map((r) => r.error)).toEqual(["invalid", "invalid"]);
  });
  it("never forwards a copy without an active gesture", async () => {
    const s = setup({ gesture: false });
    s.post(msg(1, { op: "copy", text: "x" }));
    await flush();
    expect(s.forward).not.toHaveBeenCalled();
    expect(s.copied).not.toHaveBeenCalled();
    expect(s.replies()).toEqual([{ tag: PAGE_MESSAGE_TAG, re: 1, ok: false, error: "no_gesture" }]);
    const g = setup({ gesture: true });
    g.post(msg(2, { op: "copy", text: "x" }));
    await flush();
    expect(g.forward).toHaveBeenCalledOnce();
    expect(g.copied).toHaveBeenCalledOnce();
  });
  it("caps requests in flight", async () => {
    const s = setup({ forward: () => new Promise(() => {}) });
    for (let i = 0; i <= PAGE_MAX_IN_FLIGHT; i++) s.post(msg(i, { op: "storage.keys" }));
    await flush();
    expect(s.forward).toHaveBeenCalledTimes(PAGE_MAX_IN_FLIGHT);
    expect(s.replies()).toEqual([{ tag: PAGE_MESSAGE_TAG, re: PAGE_MAX_IN_FLIGHT, ok: false, error: "busy" }]);
  });
  it("stops listening and replying once detached", async () => {
    let finish!: (r: PageResult) => void;
    const s = setup({ forward: () => new Promise((r) => (finish = r)) });
    s.post(msg(1, { op: "storage.keys" }));
    s.detach();
    finish({ ok: true, value: [] });
    s.post(msg(2, { op: "storage.keys" }));
    await flush();
    expect(s.forward).toHaveBeenCalledOnce();
    expect(s.replies()).toEqual([]);
  });
  it("a gesture means transient activation with focus in that frame", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const nav = navigator as Navigator & { userActivation?: unknown };
    Object.defineProperty(nav, "userActivation", { value: { isActive: true }, configurable: true });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    expect(frameGestureActive(frame)).toBe(false); // focus is elsewhere
    frame.focus();
    Object.defineProperty(document, "activeElement", { value: frame, configurable: true });
    expect(frameGestureActive(frame)).toBe(true);
    Object.defineProperty(nav, "userActivation", { value: { isActive: false }, configurable: true });
    expect(frameGestureActive(frame)).toBe(false);
  });
});
