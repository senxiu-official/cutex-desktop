import { describe, expect, it, vi } from "vitest";
import { BROWSER_FOCUS_RETURN, installBrowserOwnerCapture } from "../src/renderer/src/modules/browser/ownerInput";

// 0.1.3 co-control: the renderer marker never consumes owner input and never moves focus; it only
// records the owner's last focus outside the guest for main's fixed restore script.
class Node extends EventTarget {
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
}
class Doc extends EventTarget { activeElement: unknown = null; body = new Node(); }
const focusin = (doc: Doc, target: unknown, relatedTarget: unknown = null) => {
  const event = new Event("focusin") as Event & { relatedTarget: unknown };
  Object.defineProperty(event, "target", { value: target }); Object.defineProperty(event, "relatedTarget", { value: relatedTarget });
  for (const listener of (doc as unknown as { listeners: ((event: Event) => void)[] }).listeners) listener(event);
};
function setup() {
  const doc = new Doc(), capture = new Node(), guest = new Node(), composer = new Node(), address = new Node();
  const listeners: ((event: Event) => void)[] = [];
  (doc as unknown as { listeners: typeof listeners }).listeners = listeners;
  vi.spyOn(doc, "addEventListener").mockImplementation((_type, listener) => { listeners.push(listener as (event: Event) => void); });
  vi.spyOn(doc, "removeEventListener").mockImplementation((_type, listener) => { listeners.splice(listeners.indexOf(listener as (event: Event) => void), 1); });
  return { doc, capture, guest, composer, address, listeners };
}

describe("co-control marker and focus return", () => {
  it("is ready after install, marks the owner's current focus, and never adds input listeners", () => {
    const f = setup(); f.doc.activeElement = f.composer;
    const off = installBrowserOwnerCapture(f.capture, f.guest, f.doc as never, "guest-1");
    expect(f.capture.getAttribute("data-browser-owner-ready")).toBe("true");
    expect(f.composer.getAttribute(BROWSER_FOCUS_RETURN)).toBe("guest-1");
    expect(f.doc.addEventListener).toHaveBeenCalledExactlyOnceWith("focusin", expect.any(Function), true);
    off();
    expect(f.capture.getAttribute("data-browser-owner-ready")).toBeNull();
    expect(f.composer.getAttribute(BROWSER_FOCUS_RETURN)).toBeNull(); expect(f.listeners).toHaveLength(0);
  });
  it("follows the owner's latest focus outside the guest; entering the guest records where it came from", () => {
    const f = setup(); f.doc.activeElement = f.doc.body;
    installBrowserOwnerCapture(f.capture, f.guest, f.doc as never, "guest-1");
    focusin(f.doc, f.composer);
    expect(f.composer.getAttribute(BROWSER_FOCUS_RETURN)).toBe("guest-1");
    focusin(f.doc, f.guest, f.address); // e.g. an agent click from the address bar
    expect(f.address.getAttribute(BROWSER_FOCUS_RETURN)).toBe("guest-1"); expect(f.composer.getAttribute(BROWSER_FOCUS_RETURN)).toBeNull();
    focusin(f.doc, f.guest, null); // no previous element: keep the last mark
    expect(f.address.getAttribute(BROWSER_FOCUS_RETURN)).toBe("guest-1");
  });
  it("never marks the guest, the marker or the document body", () => {
    const f = setup(); f.doc.activeElement = f.guest;
    installBrowserOwnerCapture(f.capture, f.guest, f.doc as never, "guest-1");
    focusin(f.doc, f.capture); focusin(f.doc, f.doc.body);
    for (const node of [f.guest, f.capture, f.doc.body]) expect(node.getAttribute(BROWSER_FOCUS_RETURN)).toBeNull();
  });
  it("a failed installation never becomes ready", () => {
    const f = setup();
    vi.mocked(f.doc.addEventListener).mockImplementationOnce(() => { throw new Error("listener failed"); });
    expect(() => installBrowserOwnerCapture(f.capture, f.guest, f.doc as never, "guest-1")).toThrow("listener failed");
    expect(f.capture.getAttribute("data-browser-owner-ready")).toBeNull();
  });
});
