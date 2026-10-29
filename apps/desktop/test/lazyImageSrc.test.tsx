// @vitest-environment jsdom
// Inline images far from the view get their src only when they come near (image-heavy fix 2026-10-26); until
// then an empty SVG of the same pixel size, read from the image header, holds their place.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageImage } from "../src/shared/input";
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => new Set<string>(),
  hostApi: () => ({}),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { hosts: [] }, notify: vi.fn() }), subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { ImageThumb } from "../src/renderer/src/components/ImageThumbs";
import { dataUrlDimensions } from "../src/renderer/src/lib/imageHeader";
import { placeholderSrc } from "../src/renderer/src/lib/lazyImageSrc";

const url = (mime: string, bytes: number[] | Buffer, pad = 64) => `data:${mime};base64,${Buffer.concat([Buffer.from(bytes), Buffer.alloc(pad, 0x55)]).toString("base64")}`;
const be16 = (n: number) => [n >> 8, n & 255], le16 = (n: number) => [n & 255, n >> 8], le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const png = (w: number, h: number) => url("image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...Buffer.from("IHDR"), ...be16(0), ...be16(w), ...be16(0), ...be16(h), 8, 6, 0, 0, 0]);
const segment = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
const jpeg = (w: number, h: number, extra: number[] = []) => url("image/jpeg", [0xff, 0xd8, ...segment(0xe0, [...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...extra,
  ...segment(0xdb, Array(65).fill(1)), ...segment(0xc0, [8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), 0xff, 0xda]);

describe("dataUrlDimensions", () => {
  it.each([
    ["png", png(1024, 768), { width: 1024, height: 768 }],
    ["jpeg after APP0 / DQT", jpeg(1920, 1080), { width: 1920, height: 1080 }],
    ["jpeg with a long APP2", jpeg(640, 480, segment(0xe2, Array(40000).fill(7))), { width: 640, height: 480 }],
    ["gif", url("image/gif", [...Buffer.from("GIF89a"), ...le16(320), ...le16(200), 0, 0, 0]), { width: 320, height: 200 }],
    ["webp VP8X", url("image/webp", [...Buffer.from("RIFF"), ...le32(100), ...Buffer.from("WEBPVP8X"), ...le32(10), 0, 0, 0, 0, 799 & 255, 799 >> 8, 0, 599 & 255, 599 >> 8, 0]), { width: 800, height: 600 }],
    ["webp VP8", url("image/webp", [...Buffer.from("RIFF"), ...le32(100), ...Buffer.from("WEBPVP8 "), ...le32(10), 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(400), ...le16(300)]), { width: 400, height: 300 }],
    ["webp VP8L", url("image/webp", [...Buffer.from("RIFF"), ...le32(100), ...Buffer.from("WEBPVP8L"), ...le32(10), 0x2f, ...le32((49) | (29 << 14))]), { width: 50, height: 30 }],
    ["bmp (top-down)", url("image/bmp", [...Buffer.from("BM"), ...le32(0), 0, 0, 0, 0, ...le32(54), ...le32(40), ...le32(16), ...le32(-9)]), { width: 16, height: 9 }],
  ])("%s", (_name, value, expected) => { expect(dataUrlDimensions(value)).toEqual(expected); });

  it.each([
    ["an EXIF JPEG (orientation may swap the sides)", jpeg(100, 50, segment(0xe1, [...Buffer.from("Exif\0\0"), 0x4d, 0x4d]))],
    ["avif", url("image/avif", [0, 0, 0, 0x1c, ...Buffer.from("ftypavif")])],
    ["garbage", url("image/png", [1, 2, 3, 4])],
    ["not base64", "data:image/png,%89PNG"],
    ["a cutex ref", `cutex-blob:cutex.a/${"d".repeat(64)}`],
    ["truncated", png(10, 10).slice(0, 40)],
  ])("unknown for %s", (_name, value) => { expect(dataUrlDimensions(value)).toBeNull(); });
});

let host: HTMLDivElement; let root: Root;
let observed: Element[]; let callback: IntersectionObserverCallback | null; let options: IntersectionObserverInit | undefined;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  observed = []; callback = null; options = undefined;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) { callback = cb; options = init; }
    observe(el: Element) { observed.push(el); }
    unobserve(el: Element) { observed = observed.filter((e) => e !== el); }
    disconnect() { observed = []; }
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (image: MessageImage) => { await act(async () => root.render(h(ImageThumb, { image, hostId: "local", className: "box", imgClassName: "max-h-80", fallback: "file" }))); };
const near = async (el: Element) => { await act(async () => callback!([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)); };

describe("ImageThumb with an inline image", () => {
  it("holds a same-size placeholder until near, then shows the image", async () => {
    const src = png(1024, 768);
    await render({ kind: "url", url: src });
    const img = host.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(placeholderSrc(1024, 768));
    expect(img.hasAttribute("data-image-pending")).toBe(true);
    expect(options).toMatchObject({ root: null, rootMargin: "100% 0px" });
    const button = host.querySelector('[data-testid="image-thumb"]')!;
    expect(observed).toEqual([img]);
    await act(async () => callback!([{ isIntersecting: false, target: img } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(img.getAttribute("src")).toBe(placeholderSrc(1024, 768));
    await near(img);
    expect(host.querySelector("img")!.getAttribute("src")).toBe(src);
    expect(host.querySelector("img")!.hasAttribute("data-image-pending")).toBe(false);
    expect(observed).toEqual([]);
    // The button (its classes and style) is the same before and after.
    expect(host.querySelector('[data-testid="image-thumb"]')).toBe(button);
    expect(button.getAttribute("style")).toBeNull();
  });

  it("observes against the nearest scrolling box (its margin reaches beyond that box's edge)", async () => {
    host.style.overflowY = "auto";
    await render({ kind: "url", url: png(64, 64) });
    expect(options).toMatchObject({ root: host, rootMargin: "100% 0px" });
  });

  it("an image of unknown size, or without IntersectionObserver, gets its src at once", async () => {
    const avif = url("image/avif", [0, 0, 0, 0x1c, ...Buffer.from("ftypavif")]);
    await render({ kind: "url", url: avif });
    expect(host.querySelector("img")!.getAttribute("src")).toBe(avif);
    expect(observed).toEqual([]);
    vi.stubGlobal("IntersectionObserver", undefined);
    const src = png(20, 10);
    await render({ kind: "url", url: src });
    expect(host.querySelector("img")!.getAttribute("src")).toBe(src);
  });

  it("zoom and copy use the real image", async () => {
    const src = jpeg(300, 200);
    await render({ kind: "url", url: src });
    const button = host.querySelector<HTMLElement>('[data-testid="image-thumb"]')!;
    act(() => button.click());
    expect(document.querySelector<HTMLImageElement>('[data-testid="message-image-zoom"] img')!.getAttribute("src")).toBe(src);
  });
});
