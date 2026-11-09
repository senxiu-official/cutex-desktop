// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ hostFile: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { hosts: [{ id: "local", conn: { epoch: "one" } }] } }) }),
  featuresOf: () => new Set(["fs-file-read"]),
  hostApi: () => ({ hostFile: host.hostFile }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MessageImages } = await import("../src/renderer/src/components/ImageThumbs");
const { resetThumbnailCache } = await import("../src/renderer/src/lib/fileThumbnails");
const { messageImages } = await import("../src/shared/input");
const { rememberedImageSize, rememberImageSize, resetImageSizes } = await import("../src/renderer/src/lib/imageSizes");
type MessageImage = import("../src/shared/input").MessageImage;

const SENT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PATH = "C:\\Users\\owner\\.cutex\\runtime\\attachments\\s1\\shot.png";
const HOST_BYTES = "QUJD";

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLDivElement;
let release: (() => void) | null = null;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => {}); };
const shown = () => el.querySelector<HTMLImageElement>('[data-testid="image-thumb"] img')?.getAttribute("src") ?? null;
const loadingBox = () => el.querySelector('[role="status"]');

beforeEach(() => {
  resetThumbnailCache();
  host.hostFile.mockReset();
  // The host read lands only on release().
  host.hostFile.mockImplementation((path: string) => new Promise((resolve) => { release = () => resolve({ path, size: 3, modifiedAt: "", mime: "image/png", encoding: "base64", truncated: false, content: HOST_BYTES }); }));
  el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el);
});
afterEach(() => { act(() => root?.unmount()); root = null; el.remove(); release = null; resetThumbnailCache(); });

describe("an image send keeps its image through the handoff to the agent's copy", () => {
  it("ledger send: the draft's bytes stand in until the host read lands, also after the draft is cleared", async () => {
    act(() => root!.render(h(MessageImages, { images: [{ kind: "url", url: SENT }], hostId: "local", messageId: "in-1", sent: [{ kind: "url", url: SENT }] })));
    expect(shown()).toBe(SENT);
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "in-1", sent: [{ kind: "url", url: SENT }] })));
    // Draft cleared.
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "in-1" })));
    await flush();
    expect(host.hostFile).toHaveBeenCalledTimes(1);
    expect(loadingBox()).toBeNull();
    expect(shown()).toBe(SENT);
    await act(async () => release!());
    await flush();
    expect(shown()).toBe(`data:image/png;base64,${HOST_BYTES}`);
  });

  it("a send that waited in 接下来: the copy's first render takes the draft's bytes", async () => {
    // No pending row: the first render is already the agent's copy.
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "in-2", sent: [{ kind: "url", url: SENT }] })));
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "in-2" })));
    await flush();
    expect(loadingBox()).toBeNull();
    expect(shown()).toBe(SENT);
  });

  it("another message's bytes are never borrowed", async () => {
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "in-3", sent: [{ kind: "url", url: SENT }] })));
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "other" })));
    await flush();
    expect(shown()).toBeNull();
    expect(loadingBox()).not.toBeNull();
  });
});

describe("a path image with a recorded size reserves its box", () => {
  it("reopened / another device: no bytes here, the box already has the image's shape", async () => {
    const [image] = messageImages([{ type: "localImage", path: PATH, width: 1920, height: 1080 }]);
    expect(image).toEqual({ kind: "path", path: PATH, width: 1920, height: 1080 });
    act(() => root!.render(h(MessageImages, { images: [image!], hostId: "local", messageId: "old" })));
    await flush();
    const box = loadingBox() as HTMLElement;
    expect(box.getAttribute("data-image-box")).toBe("reserved");
    expect(box.style.aspectRatio).toBe("1920 / 1080");
    expect(box.style.width).toBe("240px");
    expect(box.style.boxSizing).toBe("content-box");
    await act(async () => release!());
    await flush();
    const thumb = el.querySelector<HTMLElement>('[data-testid="image-thumb"]')!;
    expect(thumb.getAttribute("data-image-box")).toBe("reserved");
    expect(thumb.style.aspectRatio).toBe("1920 / 1080");
  });

  it("older hosts (no size) and malformed sizes keep auto layout", async () => {
    expect(messageImages([{ type: "localImage", path: PATH }])).toEqual([{ kind: "path", path: PATH }]);
    expect(messageImages([{ type: "localImage", path: PATH, width: -1, height: "9" }])).toEqual([{ kind: "path", path: PATH }]);
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "old" })));
    await flush();
    expect((loadingBox() as HTMLElement).getAttribute("data-image-box")).toBeNull();
  });
});

describe("a path image without a size from cutex reserves the box it had when it last loaded here", () => {
  const PICKED = "C:\\Users\\owner\\Pictures\\picked.png";
  const SIZES_KEY = "cutex-desktop.imageSizes";
  const reopen = async (image: MessageImage = { kind: "path", path: PICKED }) => {
    act(() => root!.unmount());
    resetThumbnailCache();
    resetImageSizes();
    root = createRoot(el);
    act(() => root!.render(h(MessageImages, { images: [image], hostId: "local", messageId: "old" })));
    await flush();
  };
  const loaded = async (width: number, height: number) => {
    await act(async () => release!());
    await flush();
    const img = el.querySelector<HTMLImageElement>('[data-testid="image-thumb"] img')!;
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
    act(() => { img.dispatchEvent(new Event("load")); });
  };
  beforeEach(() => { localStorage.removeItem(SIZES_KEY); resetImageSizes(); });

  it("first time automatic; after a reload the box stands before the bytes, and the image loads inside it", async () => {
    await reopen();
    expect((loadingBox() as HTMLElement).getAttribute("data-image-box")).toBeNull();
    await loaded(1600, 900);
    await reopen();
    const box = loadingBox() as HTMLElement;
    expect(box.getAttribute("data-image-box")).toBe("reserved");
    expect(box.style.aspectRatio).toBe("1600 / 900");
    await act(async () => release!());
    await flush();
    expect(el.querySelector<HTMLElement>('[data-testid="image-thumb"]')!.style.aspectRatio).toBe("1600 / 900");
  });

  it("a size from cutex wins; the same path on another host is another image", async () => {
    await reopen();
    await loaded(1600, 900);
    await reopen({ kind: "path", path: PICKED, width: 300, height: 200 });
    expect((loadingBox() as HTMLElement).style.aspectRatio).toBe("300 / 200");
    expect(rememberedImageSize("other-host", PICKED)).toBeUndefined();
    await act(async () => release!());
  });

  it("a changed file corrects its box on load; a send's scaled preview never counts as its size", async () => {
    await reopen();
    await loaded(1600, 900);
    await reopen();
    await loaded(800, 800);
    expect(el.querySelector<HTMLElement>('[data-testid="image-thumb"]')!.style.aspectRatio).toBe("800 / 800");
    localStorage.removeItem(SIZES_KEY);
    resetImageSizes();
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: "C:\\new.png" }], hostId: "local", messageId: "in-9", sent: [{ kind: "url", url: SENT }] })));
    await flush();
    const preview = el.querySelector<HTMLImageElement>('[data-testid="image-thumb"] img')!;
    expect(preview.getAttribute("src")).toBe(SENT);
    Object.defineProperty(preview, "naturalWidth", { configurable: true, value: 40 });
    Object.defineProperty(preview, "naturalHeight", { configurable: true, value: 40 });
    act(() => { preview.dispatchEvent(new Event("load")); });
    expect(rememberedImageSize("local", "C:\\new.png")).toBeUndefined();
  });

  it("drops the oldest entries past its limit and survives bad storage", () => {
    localStorage.setItem(SIZES_KEY, "not json");
    resetImageSizes();
    expect(rememberedImageSize("local", "/a.png")).toBeUndefined();
    for (let i = 0; i < 2001; i++) rememberImageSize("local", `/p${i}.png`, 10, 20);
    expect(rememberedImageSize("local", "/p0.png")).toBeUndefined();
    expect(rememberedImageSize("local", "/p2000.png")).toEqual({ width: 10, height: 20 });
    resetImageSizes();
    expect(rememberedImageSize("local", "/p2000.png")).toEqual({ width: 10, height: 20 });
    expect(rememberImageSize("local", "/svg.svg", 0, 0)).toBe(false);
  });
});
