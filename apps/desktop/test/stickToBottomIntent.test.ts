// @vitest-environment jsdom
// Stick-to-bottom lets go only on the owner's own scrolling input (lib/stickToBottom watchScrollIntent):
// wheel / touch over the timeline or its overlay thumb, scroll keys aimed at it, a press in it, a thumb
// drag — never a scroll the layout caused (regression 2026-10-23: the reply streamed below the view).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTENT_WINDOW } from "../src/renderer/src/lib/overlayScrollbars";
import { watchScrollIntent, type ScrollIntentWatch } from "../src/renderer/src/lib/stickToBottom";

describe("stick to bottom: the owner's scrolling input", () => {
  let now = 1000;
  let scroller: HTMLDivElement;
  let row: HTMLDivElement;
  let composer: HTMLTextAreaElement;
  let sidebar: HTMLDivElement;
  let layer: HTMLDivElement;
  let watch: ScrollIntentWatch;

  beforeEach(() => {
    now = 1000;
    document.body.innerHTML = "";
    scroller = document.createElement("div");
    row = document.createElement("div");
    row.tabIndex = 0;
    scroller.appendChild(row);
    composer = document.createElement("textarea");
    sidebar = document.createElement("div");
    sidebar.tabIndex = 0;
    layer = document.createElement("div");
    layer.setAttribute("data-overlay-scrollbars", "");
    layer.appendChild(document.createElement("div"));
    document.body.append(scroller, composer, sidebar, layer);
    watch = watchScrollIntent(scroller, () => now);
  });
  afterEach(() => watch.dispose());

  const wheel = (target: Element) => target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 }));
  const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: k }));
  const pointer = (target: Element, type: string) => target.dispatchEvent(new Event(type, { bubbles: true }));

  it("nothing yet: a scroll is the layout's (a send, a turn starting, anchoring)", () => {
    expect(watch.user()).toBe(false);
  });

  it("a wheel over the timeline (or its overlay thumb) is the owner's for a moment", () => {
    wheel(row);
    expect(watch.user()).toBe(true);
    now += INTENT_WINDOW;
    expect(watch.user()).toBe(true);
    now += 1;
    expect(watch.user()).toBe(false);
    wheel(layer.firstElementChild!);
    expect(watch.user()).toBe(true);
  });

  it("a wheel elsewhere (the sidebar, the composer) is not", () => {
    wheel(sidebar);
    wheel(composer);
    expect(watch.user()).toBe(false);
  });

  it("scroll keys count when aimed at the timeline, not while typing", () => {
    key(composer, "PageUp");
    key(composer, "ArrowUp");
    expect(watch.user()).toBe(false);
    sidebar.focus();
    key(sidebar, "PageUp");
    expect(watch.user()).toBe(false);
    row.focus();
    key(row, "a");
    expect(watch.user()).toBe(false);
    key(row, "PageUp");
    expect(watch.user()).toBe(true);
    now += INTENT_WINDOW + 1;
    row.blur();
    key(document.body, "Home");
    expect(watch.user()).toBe(true);
  });

  it("a press in the timeline (selection drag, scrollbar) lasts until released, then a moment", () => {
    pointer(row, "pointerdown");
    now += 5000;
    expect(watch.user()).toBe(true);
    pointer(document.body, "pointerup");
    now += INTENT_WINDOW + 1;
    expect(watch.user()).toBe(false);
    pointer(composer, "pointerdown");
    expect(watch.user()).toBe(false);
  });

  it("an overlay thumb being dragged", () => {
    layer.firstElementChild!.setAttribute("data-dragging", "");
    expect(watch.user()).toBe(true);
  });

  it("releases synchronously on an upward wheel before a smooth jump's scrollend callback", () => {
    watch.dispose();
    let following = true;
    const release = vi.fn(() => { following = false; });
    watch = watchScrollIntent(scroller, () => now, release);
    wheel(row);
    // No scroll event has run yet. This is the condition the jump completion checks.
    expect(release).toHaveBeenCalledOnce();
    expect(following).toBe(false);
    release.mockClear();
    row.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 20 }));
    row.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -20, ctrlKey: true }));
    row.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -20, shiftKey: true }));
    wheel(sidebar);
    wheel(composer);
    // An unrelated pane's overlay scrollbar is outside this timeline.
    wheel(layer.firstElementChild!);
    expect(release).not.toHaveBeenCalled();
    watch.dispose();
    wheel(row);
    expect(release).not.toHaveBeenCalled();
  });

  it("a send forgets the wheel before it; dispose stops listening", () => {
    wheel(row);
    watch.reset();
    expect(watch.user()).toBe(false);
    watch.dispose();
    wheel(row);
    expect(watch.user()).toBe(false);
  });
});
