// @vitest-environment jsdom
// Side-pane image previews (owner 2026-10-25: a Shelf artifact / file image could not be enlarged): a left click
// or 查看大图 opens the conversation's enlarged view, 复制图片 copies; in the pane Ctrl+wheel zooms at the cursor,
// a drag pans, 100 % ⇄ 适应. The zoom math (lib/imagePanZoom) and hook (components/PanZoom) are the enlarged
// view's too: zoomed, a click there no longer closes it.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuEntry } from "../src/renderer/src/lib/contextMenu";
const env = vi.hoisted(() => ({ action: vi.fn(), local: vi.fn(), notify: vi.fn(), menus: [] as MenuEntry[] }));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => new Set(),
  hostApi: (host: string) => ({ imageAction: (...args: unknown[]) => env.action(host, ...args) }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { hosts: [] }, notify: env.notify }), subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: { imageAction: (...args: unknown[]) => env.local(...args) } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: (entries: () => MenuEntry[]) => (event: Event) => { event.preventDefault(); env.menus = entries(); } }));
import { SideImage } from "../src/renderer/src/components/SideImage";
import { actualAt, clampPan, fitScale, MAX_SCALE, panBy, wheelFactor, zoomAt } from "../src/renderer/src/lib/imagePanZoom";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("lib/imagePanZoom", () => {
  const img = { w: 800, h: 400 }, box = { w: 400, h: 300 };
  it("zooms keeping the point under the cursor still, within [min, MAX_SCALE]", () => {
    const v = { scale: 0.5, x: 0, y: 50 };
    const z = zoomAt(v, 2, { x: 100, y: 100 }, img, box, 0.5);
    expect(z.scale).toBe(1);
    // The image point under (100, 100) was (200, 100); it still is.
    expect((100 - z.x) / z.scale).toBeCloseTo(200);
    expect((100 - z.y) / z.scale).toBeCloseTo(100);
    expect(zoomAt(v, 1000, { x: 0, y: 0 }, img, box, 0.5).scale).toBe(MAX_SCALE);
    expect(zoomAt(v, 0.01, { x: 0, y: 0 }, img, box, 0.5).scale).toBe(0.5);
  });

  it("pans without leaving an empty edge; an axis the image is smaller than is centred", () => {
    const v = { scale: 1, x: -100, y: -50 };
    expect(panBy(v, 1000, 1000, img, box)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(panBy(v, -1000, -1000, img, box)).toEqual({ scale: 1, x: -400, y: -100 });
    expect(clampPan({ scale: 0.25, x: 7, y: 7 }, img, box)).toEqual({ scale: 0.25, x: 100, y: 100 });
  });

  it("100 % keeps the centre (or the given point); fit never enlarges; the wheel is exponential", () => {
    const v = { scale: 0.5, x: 0, y: 50 };
    const a = actualAt(v, img, box);
    expect(a.scale).toBe(1);
    expect((200 - a.x) / a.scale).toBeCloseTo(400);
    expect(fitScale(img, box)).toBe(0.5);
    expect(fitScale({ w: 10, h: 10 }, box)).toBe(1);
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48));
  });
});

describe("SideImage", () => {
  let host: HTMLDivElement;
  let root: Root;
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
  beforeEach(async () => {
    env.action.mockReset().mockResolvedValue({ status: "copied" });
    env.local.mockReset().mockResolvedValue({ status: "copied" });
    env.notify.mockReset();
    // An 800 × 400 image fitted at 200 × 100 in a 400 × 300 frame (jsdom has no layout).
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(400);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.tagName === "IMG" ? rect(100, 50, 200, 100) : rect(0, 0, 400, 300);
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(h(SideImage, { src: PNG, alt: "shot.png", hostId: "remote" })));
    act(() => void fitted().dispatchEvent(new Event("load")));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  const frame = () => host.querySelector<HTMLElement>("[data-side-image]")!;
  const fitted = () => frame().querySelector<HTMLImageElement>("img:not([data-pan-zoom-image])")!;
  const zoom = () => document.querySelector<HTMLElement>('[data-testid="message-image-zoom"]');
  const wheel = (el: Element, init: WheelEventInit) => act(() => void el.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 100, ...init })));

  it("a left click on the image or 查看大图 opens the enlarged view, which copies too", async () => {
    expect(fitted().getAttribute("title")).toBe("image.enlargeHint");
    act(() => fitted().click());
    expect(zoom()).not.toBeNull();
    expect(zoom()!.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => zoom()!.querySelector<HTMLElement>("[data-image-zoom-copy]")!.click());
    await flush();
    expect(env.action).toHaveBeenCalledWith("remote", { kind: "inline", dataUrl: PNG }, "copy");
    expect(zoom()!.querySelector("[data-image-zoom-notice]")?.textContent).toBe("image.copied");
    act(() => zoom()!.querySelector<HTMLElement>("[data-image-zoom-close]")!.click());
    expect(zoom()).toBeNull();
    act(() => frame().querySelector<HTMLElement>("[data-side-image-enlarge]")!.click());
    expect(zoom()).not.toBeNull();
  });

  it("the pane toolbar and right-click menu copy the image (local host: this window's main)", async () => {
    act(() => frame().querySelector<HTMLElement>("[data-side-image-copy]")!.click());
    await flush();
    expect(env.action).toHaveBeenCalledWith("remote", { kind: "inline", dataUrl: PNG }, "copy");
    expect(env.notify).toHaveBeenCalledWith("image.copied");
    act(() => void frame().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(env.menus.map((m) => (m && typeof m === "object" ? m.label : m))).toEqual(["image.copy", "image.enlarge"]);
    await act(async () => root.render(h(SideImage, { src: PNG, alt: "shot.png" })));
    act(() => frame().querySelector<HTMLElement>("[data-side-image-copy]")!.click());
    await flush();
    expect(env.local).toHaveBeenCalledWith({ kind: "inline", dataUrl: PNG }, "copy");
    env.local.mockRejectedValue(Error("clipboard"));
    act(() => frame().querySelector<HTMLElement>("[data-side-image-copy]")!.click());
    await flush();
    expect(env.notify).toHaveBeenLastCalledWith("image.actionFailed", "error");
  });

  it("Ctrl+wheel zooms in the pane at the cursor (a plain wheel scrolls until zoomed); a drag pans; 适应 returns", () => {
    const plain = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 });
    act(() => void frame().dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(false);
    expect(frame().hasAttribute("data-zoomed")).toBe(false);
    wheel(frame(), { deltaY: -400, ctrlKey: true });
    expect(frame().hasAttribute("data-zoomed")).toBe(true);
    const zoomed = frame().querySelector<HTMLElement>("[data-pan-zoom-image]")!;
    expect(zoomed.style.transform).toMatch(/scale\(0\.4[0-9]*\)/);
    expect(fitted().className).toContain("invisible");
    // Once zoomed the plain wheel zooms (not the pane's scroll).
    const before = zoomed.style.transform;
    wheel(frame(), { deltaY: -100 });
    expect(frame().querySelector<HTMLElement>("[data-pan-zoom-image]")!.style.transform).not.toBe(before);
    // A click while zoomed does not open the enlarged view; a drag moves the image.
    act(() => fitted().click());
    expect(zoom()).toBeNull();
    const t0 = frame().querySelector<HTMLElement>("[data-pan-zoom-image]")!.style.transform;
    act(() => {
      frame().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 200, clientY: 100 }));
      frame().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 150, clientY: 80 }));
      frame().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 150, clientY: 80 }));
    });
    expect(frame().querySelector<HTMLElement>("[data-pan-zoom-image]")!.style.transform).not.toBe(t0);
    // 适应 (the same button, now labelled so) returns to the pane's own layout.
    const toggle = frame().querySelector<HTMLElement>("[data-side-image-actual]")!;
    expect(toggle.getAttribute("aria-label")).toBe("image.fit");
    act(() => toggle.click());
    expect(frame().hasAttribute("data-zoomed")).toBe(false);
    expect(frame().querySelector("[data-pan-zoom-image]")).toBeNull();
  });

  it("100 % shows the image at its own size, centred on the fitted image's centre", () => {
    act(() => frame().querySelector<HTMLElement>("[data-side-image-actual]")!.click());
    const t = frame().querySelector<HTMLElement>("[data-pan-zoom-image]")!.style.transform;
    expect(t).toContain("scale(1)");
    // The fitted image's centre (image point 400, 200) goes to the frame's centre (200, 150), then the pan is
    // clamped so no empty edge shows: y -250 → -100.
    expect(t).toBe("translate(-200px, -100px) scale(1)");
    expect(frame().style.height).toBe("300px");
  });

  it("an image already shown at its own size has no 100 % (the wheel still zooms)", async () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(100);
    await act(async () => root.render(h(SideImage, { key: "small", src: PNG, alt: "small.png" })));
    act(() => void fitted().dispatchEvent(new Event("load")));
    expect(frame().querySelector("[data-side-image-enlarge]")).not.toBeNull();
    expect(frame().querySelector("[data-side-image-actual]")).toBeNull();
    wheel(frame(), { deltaY: -200, ctrlKey: true });
    expect(frame().hasAttribute("data-zoomed")).toBe(true);
    expect(frame().querySelector("[data-side-image-actual]")!.getAttribute("aria-label")).toBe("image.fit");
  });

  it("the enlarged view: zoomed, a click on it does not close it; 适应 then a click does", () => {
    act(() => fitted().click());
    const overlay = zoom()!;
    act(() => void overlay.querySelector("[data-image-zoom-box] img")!.dispatchEvent(new Event("load")));
    const actual = overlay.querySelector<HTMLElement>("[data-image-zoom-actual]")!;
    expect(actual.getAttribute("aria-label")).toBe("image.actual");
    act(() => actual.click());
    expect(overlay.hasAttribute("data-zoomed")).toBe(true);
    act(() => overlay.click());
    expect(zoom()).not.toBeNull();
    // The plain wheel zooms in the enlarged view.
    const before = overlay.querySelector<HTMLElement>("[data-pan-zoom-image]")!.style.transform;
    wheel(overlay, { deltaY: 200 });
    expect(overlay.querySelector<HTMLElement>("[data-pan-zoom-image]")?.style.transform).not.toBe(before);
    // Back to fit; now a click closes. The pane's own zoom did not move meanwhile.
    expect(overlay.querySelector("[data-image-zoom-actual]")!.getAttribute("aria-label")).toBe("image.fit");
    act(() => overlay.querySelector<HTMLElement>("[data-image-zoom-actual]")!.click());
    expect(overlay.hasAttribute("data-zoomed")).toBe(false);
    expect(frame().hasAttribute("data-zoomed")).toBe(false);
    act(() => overlay.click());
    expect(zoom()).toBeNull();
  });
});
