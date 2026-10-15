import { describe, expect, it, vi } from "vitest";
import { browserOwnerInputKind, createBrowserOwnerCapture, installBrowserOwnerCapture, redirectBrowserGuestFocus, type BrowserOwnerEvent } from "../src/renderer/src/modules/browser/ownerInput";
import type { BrowserOwnerInputKind } from "../src/shared/browser";

const kinds: BrowserOwnerInputKind[] = ["pointerdown", "wheel", "keydown", "contextmenu", "dragenter", "drop", "touchstart"];
const event = (type: string, extra: Partial<BrowserOwnerEvent> = {}): BrowserOwnerEvent => ({ type, isTrusted: true, key: "a", preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** No DOM or Electron: records native listener options and dispatches the supplied trusted fixture. */
class Target extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  registrations: { type: string; options?: boolean | AddEventListenerOptions }[] = [];
  removals: { type: string; options?: boolean | EventListenerOptions }[] = [];
  attributes = new Map<string, string>();
  operations: string[] = [];
  activeElement: unknown = null;
  focus = vi.fn((_options?: FocusOptions) => {});
  setAttribute(name: string, value: string): void { this.operations.push(`set:${name}`); this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.operations.push(`remove:${name}`); this.attributes.delete(name); }
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (!callback) return;
    this.operations.push(`listen:${type}`);
    this.registrations.push({ type, options });
    let set = this.listeners.get(type); if (!set) this.listeners.set(type, set = new Set()); set.add(callback);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    this.operations.push(`unlisten:${type}`);
    this.removals.push({ type, options });
    if (callback) this.listeners.get(type)?.delete(callback);
  }
  emit(value: BrowserOwnerEvent): void {
    for (const callback of this.listeners.get(value.type) ?? []) {
      if (typeof callback === "function") callback(value as Event);
      else callback.handleEvent(value as Event);
    }
  }
}

describe("D-G browser host owner-input capture", () => {
  it.each(kinds)("accepts trusted %s and consumes it before downgrade IPC", async type => {
    const input = event(type), calls: string[] = [];
    input.preventDefault = () => { calls.push("preventDefault"); };
    const deliver = vi.fn(async (kind: BrowserOwnerInputKind) => { calls.push(`deliver:${kind}`); });
    const control = createBrowserOwnerCapture(deliver, vi.fn());
    control.handle(input);
    expect(calls).toEqual(["preventDefault", `deliver:${type}`]);
    expect(deliver).toHaveBeenCalledWith(type);
    expect(input.stopPropagation).toHaveBeenCalledTimes(type === "keydown" ? 0 : 1);
    await flush(); control.dispose();
  });

  it.each(kinds)("does not consume or deliver synthetic %s", type => {
    const input = event(type, { isTrusted: false }), deliver = vi.fn(async () => {});
    createBrowserOwnerCapture(deliver, vi.fn()).handle(input);
    expect(browserOwnerInputKind(input)).toBeNull();
    expect(input.preventDefault).toHaveBeenCalledTimes(0);
    expect(input.stopPropagation).toHaveBeenCalledTimes(0);
    expect(deliver).toHaveBeenCalledTimes(0);
  });

  it.each(["pointermove", "pointerover", "pointerenter", "mousemove", "mouseenter", "mouseover", "focus", "focusin", "keyup", "click", "dragover"])("does not treat %s as takeover", type => {
    expect(browserOwnerInputKind(event(type))).toBeNull();
  });

  it.each(["Alt", "AltGraph", "Control", "Meta", "Shift", "OS", "Hyper", "Super", "Fn", "FnLock", "CapsLock", "NumLock", "ScrollLock", "Symbol", "SymbolLock"])("ignores a standalone %s modifier", key => {
    const input = event("keydown", { key }), deliver = vi.fn(async () => {});
    createBrowserOwnerCapture(deliver, vi.fn()).handle(input);
    expect(input.preventDefault).toHaveBeenCalledTimes(0);
    expect(deliver).toHaveBeenCalledTimes(0);
  });

  it("accepts the first IME 229 key, Tab, Escape and modifier chords without stopping shortcuts", async () => {
    for (const extra of [{ key: "Process", keyCode: 229 }, { key: "Unidentified", keyCode: 229 }, { key: "Shift", keyCode: 229 }, { key: "Tab" }, { key: "Escape" }, { key: "s", ctrlKey: true }]) {
      const input = event("keydown", extra), deliver = vi.fn(async () => {});
      createBrowserOwnerCapture(deliver, vi.fn()).handle(input);
      expect(input.preventDefault).toHaveBeenCalledTimes(1);
      expect(input.stopPropagation).toHaveBeenCalledTimes(0);
      expect(deliver).toHaveBeenCalledWith("keydown");
    }
    await flush();
  });

  it("accepts right pointer, trackpad and Ctrl+wheel rather than special-casing them", () => {
    for (const input of [event("pointerdown", { button: 2 } as Partial<BrowserOwnerEvent>), event("wheel", { ctrlKey: true, deltaY: 0.25 } as Partial<BrowserOwnerEvent>)]) {
      expect(browserOwnerInputKind(input)).toBe(input.type);
    }
  });

  it("delivers once while pending and after acknowledgement, continuing to consume input", async () => {
    const pending = deferred(), deliver = vi.fn(() => pending.promise), failed = vi.fn();
    const control = createBrowserOwnerCapture(deliver, failed);
    const first = event("pointerdown"), second = event("wheel"), third = event("keydown");
    control.handle(first); control.handle(second); pending.resolve(); await flush(); control.handle(third);
    expect(deliver).toHaveBeenCalledTimes(1);
    for (const input of [first, second, third]) expect(input.preventDefault).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(0);
  });

  it("keeps capture active on failure and retries only after another trusted input", async () => {
    const pending = deferred(), deliver = vi.fn(() => pending.promise), failed = vi.fn();
    const control = createBrowserOwnerCapture(deliver, failed);
    control.handle(event("pointerdown")); pending.reject(new Error("IPC unavailable")); await flush();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    control.handle(event("wheel", { isTrusted: false }));
    expect(deliver).toHaveBeenCalledTimes(1);
    deliver.mockResolvedValue(undefined);
    const retry = event("wheel"); control.handle(retry); await flush();
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(retry.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("handles synchronous delivery failure without dropping protection", () => {
    const failed = vi.fn(), control = createBrowserOwnerCapture(() => { throw new Error("bridge unavailable"); }, failed);
    const first = event("drop"), second = event("touchstart"); control.handle(first); control.handle(second);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("retired layers ignore input and late delivery errors, while a new grant starts fresh", async () => {
    const pending = deferred(), failed = vi.fn(), deliver = vi.fn(() => pending.promise);
    const old = createBrowserOwnerCapture(deliver, failed);
    old.handle(event("pointerdown")); old.dispose(); pending.reject(new Error("late")); await flush();
    const late = event("wheel"); old.handle(late);
    expect(late.preventDefault).toHaveBeenCalledTimes(0);
    expect(failed).toHaveBeenCalledTimes(0);
    expect(deliver).toHaveBeenCalledTimes(1);
    const fresh = vi.fn(async () => {}); createBrowserOwnerCapture(fresh, failed).handle(event("pointerdown"));
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("binds all accepted native events non-passively and removes exact listeners", () => {
    const capture = new Target(), guest = new Target(), doc = new Target(), deliver = vi.fn(async () => {});
    const off = installBrowserOwnerCapture(capture, guest, doc, deliver, vi.fn());
    expect(capture.registrations).toEqual(kinds.map(type => ({ type, options: { capture: true, passive: false } })));
    expect(guest.registrations).toEqual([{ type: "focus", options: true }]);
    expect(doc.registrations).toEqual([{ type: "focusin", options: true }]);
    off();
    expect(capture.removals).toEqual(kinds.map(type => ({ type, options: true })));
    expect([...capture.listeners.values()].every(set => set.size === 0)).toBe(true);
    expect(guest.listeners.get("focus")?.size).toBe(0);
    expect(doc.listeners.get("focusin")?.size).toBe(0);
    capture.emit(event("pointerdown"));
    expect(deliver).toHaveBeenCalledTimes(0);
  });

  it("marks ready only after all input/focus listeners and the initial focus redirect", () => {
    const capture = new Target(), guest = new Target(), doc = new Target();
    doc.activeElement = guest;
    capture.focus.mockImplementation(() => {
      expect(capture.attributes.has("data-browser-owner-ready")).toBe(false);
      expect(capture.registrations).toHaveLength(kinds.length);
      expect(guest.listeners.get("focus")?.size).toBe(1);
      expect(doc.listeners.get("focusin")?.size).toBe(1);
      doc.activeElement = capture;
    });
    const off = installBrowserOwnerCapture(capture, guest, doc, vi.fn(async () => {}), vi.fn());
    expect(capture.focus).toHaveBeenCalledTimes(1);
    expect(capture.attributes.get("data-browser-owner-ready")).toBe("true");
    expect(capture.operations).toEqual(["remove:data-browser-owner-ready", ...kinds.map(kind => `listen:${kind}`), "set:data-browser-owner-ready"]);
    const at = capture.operations.length;
    off();
    expect(capture.attributes.has("data-browser-owner-ready")).toBe(false);
    expect(capture.operations.slice(at)).toEqual(["remove:data-browser-owner-ready", ...kinds.map(kind => `unlisten:${kind}`)]);
  });

  it("failed initialization never becomes ready and removes partial listener installation", () => {
    const capture = new Target(), guest = new Target(), doc = new Target();
    capture.attributes.set("data-browser-owner-ready", "true"); // A reused element cannot keep stale proof.
    doc.activeElement = guest;
    capture.focus.mockImplementation(() => { throw new Error("focus failed"); });
    expect(() => installBrowserOwnerCapture(capture, guest, doc, vi.fn(async () => {}), vi.fn())).toThrow("focus failed");
    expect(capture.attributes.has("data-browser-owner-ready")).toBe(false);
    expect(capture.operations.includes("set:data-browser-owner-ready")).toBe(false);
    expect([...capture.listeners.values()].every(set => set.size === 0)).toBe(true);
    expect(guest.listeners.get("focus")?.size).toBe(0);
    expect(doc.listeners.get("focusin")?.size).toBe(0);
  });
});

describe("D-G browser capture focus ownership", () => {
  it("redirects only the exact focused guest and prevents scrolling", () => {
    const guest = {}, other = {}, capture = { focus: vi.fn() };
    expect(redirectBrowserGuestFocus(other, guest, capture)).toBe(false);
    expect(redirectBrowserGuestFocus(null, null, capture)).toBe(false);
    expect(capture.focus).toHaveBeenCalledTimes(0);
    expect(redirectBrowserGuestFocus(guest, guest, capture)).toBe(true);
    expect(capture.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("redirects guest focus on grant entry and later focus events without pausing", () => {
    const capture = new Target(), guest = new Target(), doc = new Target(), deliver = vi.fn(async () => {});
    doc.activeElement = guest;
    capture.focus.mockImplementation(() => { doc.activeElement = capture; });
    const off = installBrowserOwnerCapture(capture, guest, doc, deliver, vi.fn());
    expect(capture.focus).toHaveBeenCalledTimes(1);
    doc.activeElement = guest; guest.emit(event("focus"));
    expect(capture.focus).toHaveBeenCalledTimes(2);
    doc.activeElement = guest; doc.emit(event("focusin"));
    expect(capture.focus).toHaveBeenCalledTimes(3);
    expect(deliver).toHaveBeenCalledTimes(0);
    off(); doc.activeElement = guest; guest.emit(event("focus"));
    expect(capture.focus).toHaveBeenCalledTimes(3);
  });

  it("does not move focus from composer, another guest or an overlay on grant/reveal", () => {
    const capture = new Target(), guest = new Target(), doc = new Target(), deliver = vi.fn(async () => {});
    doc.activeElement = { name: "composer" };
    const off = installBrowserOwnerCapture(capture, guest, doc, deliver, vi.fn());
    for (const active of [{ name: "dialog" }, new Target(), capture]) { doc.activeElement = active; doc.emit(event("focusin")); guest.emit(event("focus")); }
    expect(capture.focus).toHaveBeenCalledTimes(0);
    expect(deliver).toHaveBeenCalledTimes(0);
    off();
  });
});

describe("owner focus is not taken over by an agent click", () => {
  // Electron 44: a CDP click in the guest gives the <webview> DOM focus. Parking it on the shield
  // turned the owner's next composer keystroke (or IME 229) into a takeover that paused the grant.
  function focusable(doc: Target, connected = true) {
    const element = { isConnected: connected, focus: vi.fn((_options?: FocusOptions) => { doc.activeElement = element; }) };
    return element;
  }
  it("hands guest focus back to the owner's composer without pausing", () => {
    const capture = new Target(), guest = new Target(), doc = new Target(), deliver = vi.fn(async () => {});
    const composer = focusable(doc); doc.activeElement = composer;
    const off = installBrowserOwnerCapture(capture, guest, doc, deliver, vi.fn());
    for (let click = 0; click < 3; click++) { doc.activeElement = guest; guest.emit(event("focus")); }
    expect(composer.focus).toHaveBeenCalledTimes(3);
    expect(composer.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(doc.activeElement).toBe(composer);
    expect(capture.focus).toHaveBeenCalledTimes(0); expect(deliver).toHaveBeenCalledTimes(0);
    off();
  });
  it("follows the owner's latest focus, and falls back to the shield when it cannot be restored", () => {
    const capture = new Target(), guest = new Target(), doc = new Target();
    capture.focus.mockImplementation(() => { doc.activeElement = capture; });
    const composer = focusable(doc), address = focusable(doc);
    doc.activeElement = composer;
    const off = installBrowserOwnerCapture(capture, guest, doc, vi.fn(async () => {}), vi.fn());
    doc.activeElement = address; doc.emit(event("focusin"));
    doc.activeElement = guest; guest.emit(event("focus"));
    expect(address.focus).toHaveBeenCalledTimes(1); expect(composer.focus).toHaveBeenCalledTimes(0);
    address.focus.mockImplementation(() => {}); // e.g. disabled meanwhile: focus stays on the guest
    doc.activeElement = guest; guest.emit(event("focus"));
    expect(capture.focus).toHaveBeenCalledTimes(1); expect(doc.activeElement).toBe(capture);
    off();
    const gone = focusable(doc, false), fresh = new Target(); fresh.focus.mockImplementation(() => { doc.activeElement = fresh; });
    doc.activeElement = gone;
    const off2 = installBrowserOwnerCapture(fresh, guest, doc, vi.fn(async () => {}), vi.fn());
    doc.activeElement = guest; guest.emit(event("focus"));
    expect(gone.focus).toHaveBeenCalledTimes(0); expect(fresh.focus).toHaveBeenCalledTimes(1);
    off2();
  });
});
