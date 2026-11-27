// @vitest-environment jsdom
// The enlarged image view (components/ImageThumbs ImageZoom), owner 2026-11-28:
// - its buttons work when zoomed: a press on the toolbar never reaches the frame, whose pointer capture (for a pan)
//   took the click away from the button — 关闭 / 复制图片 did nothing;
// - no window drag under it: the view and its toolbar are app-region no-drag (the window bar's drag strip lies under
//   the toolbar where there is no caption band, e.g. Linux);
// - the caption band follows the app's 缩放 (main's band is device-independent px);
// - Esc closes the view and nothing else: the input box's Esc (stop the turn) and the conversation's Esc never see it.
//   The same for the image editor.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ImageZoom } = await import("../src/renderer/src/components/ImageThumbs");
const { captionBand } = await import("../src/renderer/src/components/WindowControls");
const { anyOverlayOpen } = await import("../src/renderer/src/lib/openOverlays");
const { overlayInDom } = await import("../src/renderer/src/lib/escInterrupt");
const { useConversationEsc } = await import("../src/renderer/src/lib/useConversationEsc");

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

describe("the enlarged view", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onClose = vi.fn();
  const onCopy = vi.fn(async () => true);
  beforeEach(async () => {
    onClose.mockReset();
    onCopy.mockClear();
    // An 800 × 400 image fitted at 200 × 100 in a 400 × 300 frame (jsdom has no layout; as test/sideImage.test.tsx).
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(400);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.tagName === "IMG" ? rect(100, 50, 200, 100) : rect(0, 0, 400, 300);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(h(ImageZoom, { src: PNG, onClose, onCopy })));
    act(() => void view().querySelector("img")!.dispatchEvent(new Event("load")));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  const view = () => document.querySelector<HTMLElement>('[data-testid="message-image-zoom"]')!;
  const press = (el: Element, type: string) => act(() => void el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 7, clientX: 380, clientY: 20 } as PointerEventInit)));

  it("zoomed, a press on 关闭 / 复制图片 is not captured by the frame and the click reaches the button", async () => {
    act(() => void view().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 100, deltaY: -400, ctrlKey: true })));
    expect(view().hasAttribute("data-zoomed")).toBe(true);
    const capture = vi.fn();
    view().setPointerCapture = capture;
    const close = view().querySelector<HTMLElement>("[data-image-zoom-close]")!;
    const copy = view().querySelector<HTMLElement>("[data-image-zoom-copy]")!;
    for (const button of [copy, close]) {
      press(button, "pointerdown");
      press(button, "pointerup");
      act(() => button.click());
    }
    expect(capture).not.toHaveBeenCalled();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // A press on the image itself still pans (the capture is the frame's, as before).
    press(view(), "pointerdown");
    expect(capture).toHaveBeenCalledWith(7);
  });

  it("no window drag under the view or its toolbar", () => {
    expect(view().className).toContain("[app-region:no-drag]");
    expect(view().querySelector("[data-image-zoom-toolbar]")!.className).toContain("[app-region:no-drag]");
  });

  it("is a modal dialog: counted as an open overlay and found in the page", () => {
    expect(view().getAttribute("role")).toBe("dialog");
    expect(view().getAttribute("aria-modal")).toBe("true");
    expect(anyOverlayOpen()).toBe(true);
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([rect(0, 0, 400, 300)] as unknown as DOMRectList);
    expect(overlayInDom(document)).toBe(true);
  });

  it("Esc closes it and never reaches the input box or the conversation's stop-the-turn Esc", () => {
    // The input box (its React onKeyDown interrupts on Esc unless an overlay is open) with the focus in it.
    const composerKey = vi.fn();
    const input = document.createElement("textarea");
    input.addEventListener("keydown", composerKey);
    document.body.append(input);
    input.focus();
    // The conversation's Esc (lib/useConversationEsc) while a turn runs.
    const act_ = vi.fn();
    const arm = vi.fn();
    const Conversation = () => {
      useConversationEsc({ preset: "default", turnId: "turn-1", pendingSteers: 0, delegation: false, blocked: false, focused: true } as never, { arm, act: act_ });
      return null;
    };
    const convHost = document.createElement("div");
    document.body.append(convHost);
    const convRoot = createRoot(convHost);
    act(() => convRoot.render(h(Conversation)));
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(composerKey).not.toHaveBeenCalled();
    expect(act_).not.toHaveBeenCalled();
    expect(arm).not.toHaveBeenCalled();
    // The focus outside any input (on the page): the conversation's own Esc would stop the turn.
    input.blur();
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(act_).not.toHaveBeenCalled();
    expect(arm).not.toHaveBeenCalled();
    act(() => convRoot.unmount());
    convHost.remove();
    input.remove();
  });
});

describe("the caption band", () => {
  it("is the window bar's height in device-independent px, so in CSS px it follows the app's zoom", () => {
    expect(captionBand("right", 1)).toBe(40);
    expect(captionBand("right", 0.8)).toBe(50);
    expect(captionBand("left", 1.25)).toBe(32);
    expect(captionBand(null, 0.8)).toBe(0);
  });
});

describe("other full-window layers", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), "src/renderer/src", p), "utf8");
  it("the image editor is a tracked modal dialog that takes Esc in the capture phase", () => {
    const editor = src("components/ImageEditor.tsx");
    expect(editor).toContain("useTrackOverlay(true)");
    expect(editor).toContain('aria-modal="true"');
    expect(editor).toMatch(/addEventListener\("keydown", onKey, true\)/);
    expect(editor).toContain("[app-region:no-drag]");
  });
});
