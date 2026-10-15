// "Open a NEW instance instead of replacing" on the browser convention (owner 2026-10-12;
// lib/openModifiers): Ctrl/⌘ / middle click = new kept tab in the background, + Shift = focused;
// background opens keep the card's shown tab (lib/sideLayout applyOpen keepActive).
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { platform: "linux" }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { enterModifiers, newInstanceKey, newInstanceOpts, openModifiers, PLAIN_OPEN } = await import("../src/renderer/src/lib/openModifiers");
const { applyOpen, emptyLayout, place, placeSpec } = await import("../src/renderer/src/lib/sideLayout");

const ev = (over: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button: number }> = {}) => ({ ctrlKey: false, metaKey: false, shiftKey: false, button: 0, ...over });

describe("openModifiers", () => {
  it("plain click = unchanged", () => {
    expect(openModifiers(ev(), false)).toEqual(PLAIN_OPEN);
    expect(openModifiers(ev({ shiftKey: true }), false)).toEqual(PLAIN_OPEN);
  });

  it("Ctrl (⌘ on macOS) / middle click = new instance in the background; + Shift = focused", () => {
    expect(openModifiers(ev({ ctrlKey: true }), false)).toEqual({ newInstance: true, focus: false });
    expect(openModifiers(ev({ ctrlKey: true, shiftKey: true }), false)).toEqual({ newInstance: true, focus: true });
    expect(openModifiers(ev({ button: 1 }), false)).toEqual({ newInstance: true, focus: false });
    expect(openModifiers(ev({ metaKey: true }), true)).toEqual({ newInstance: true, focus: false });
    // macOS: Ctrl+click is the context menu, not "new"; elsewhere ⌘ (Win key) is not it either
    expect(openModifiers(ev({ ctrlKey: true }), true)).toEqual(PLAIN_OPEN);
    expect(openModifiers(ev({ metaKey: true }), false)).toEqual(PLAIN_OPEN);
  });

  it("Ctrl/⌘ + Enter on a focused row = Ctrl/⌘ + click; plain Enter / other keys = null", () => {
    expect(enterModifiers({ ...ev({ ctrlKey: true }), key: "Enter" }, false)).toEqual({ newInstance: true, focus: false });
    expect(enterModifiers({ ...ev({ ctrlKey: true, shiftKey: true }), key: "Enter" }, false)).toEqual({ newInstance: true, focus: true });
    expect(enterModifiers({ ...ev(), key: "Enter" }, false)).toBeNull();
    expect(enterModifiers({ ...ev({ ctrlKey: true }), key: "a" }, false)).toBeNull();
  });

  it("open options and the hint key", () => {
    expect(newInstanceOpts(PLAIN_OPEN)).toEqual({});
    expect(newInstanceOpts({ newInstance: true, focus: false })).toEqual({ pin: true, background: true });
    expect(newInstanceOpts({ newInstance: true, focus: true })).toEqual({ pin: true, focus: true });
    expect(newInstanceKey(false)).toBe("Ctrl+");
    expect(newInstanceKey(true)).toBe("⌘+");
    expect(newInstanceKey()).toBe("Ctrl+"); // bridge.platform = linux
  });
});

describe("background open keeps the shown tab (a.md stays, Ctrl+click b.md)", () => {
  const spec = placeSpec({ home: "workspace" });
  const binding = { kind: "agent" as const, hostId: "local", sessionId: "A" };
  const open = (layout: ReturnType<typeof emptyLayout>, key: string, transient: boolean, keepActive: boolean) => {
    const decision = place(layout, { kind: "w.preview", binding, key, transient, activePage: layout.activePage, columnOpen: layout.open }, spec);
    return applyOpen(layout, decision, { kind: "w.preview", binding, key, state: { path: key }, v: 1, pinned: !transient }, 1, { reveal: !keepActive, keepActive });
  };

  it("b.md becomes a second kept tab, a.md stays shown", () => {
    const a = open(emptyLayout(), "a.md", true, false);
    const b = open(a.layout, "b.md", false, true);
    const card = b.layout.pages[0]!.cards[0]!;
    expect(card.tabs).toEqual([a.instanceId, b.instanceId]);
    expect(card.active).toBe(a.instanceId);
    expect(b.layout.instances[a.instanceId]).toBeTruthy();
    expect(b.layout.instances[b.instanceId]!.pinned).toBe(true);
  });

  it("a plain open of b.md replaces the transient a.md (unchanged)", () => {
    const a = open(emptyLayout(), "a.md", true, false);
    const b = open(a.layout, "b.md", true, false);
    const card = b.layout.pages[0]!.cards[0]!;
    expect(card.tabs).toEqual([b.instanceId]);
    expect(b.layout.instances[a.instanceId]).toBeUndefined();
  });
});
