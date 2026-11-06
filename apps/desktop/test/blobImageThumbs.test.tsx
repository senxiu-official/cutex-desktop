// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MessageImage } from "../src/shared/input";
import type { MenuEntry } from "../src/renderer/src/lib/contextMenu";
const env = vi.hoisted(() => ({ features: new Set<string>(), read: vi.fn(), legacyRead: vi.fn(), action: vi.fn(), menus: [] as MenuEntry[], epoch: "one", subscribers: new Set<() => void>(), notify: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => env.features,
  hostApi: (host: string) => ({ eventBlob: (...args: unknown[]) => env.read(host, ...args), historyMedia: env.legacyRead, imageAction: (...args: unknown[]) => env.action(host, ...args), hostFile: vi.fn() }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { hosts: [{ id: "remote", conn: { epoch: env.epoch } }] }, notify: env.notify }), subscribe: (l: () => void) => { env.subscribers.add(l); return () => env.subscribers.delete(l); } }),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: (entries: () => MenuEntry[]) => (event: Event) => { event.preventDefault(); env.menus = entries(); } }));
vi.mock("../src/renderer/src/lib/fileActions", () => ({ fileActions: () => [] }));
import { ImageThumb } from "../src/renderer/src/components/ImageThumbs";
import { resetThumbnailCache } from "../src/renderer/src/lib/fileThumbnails";
const hash = "b".repeat(64);
const image: MessageImage = { kind: "blob", blob: { type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/png", size: 3, url: `cutex-blob:cutex.session/${hash}` } };
let host: HTMLDivElement; let root: Root; let seen: IntersectionObserverCallback;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  resetThumbnailCache(); env.features = new Set(["event-media-blobs"]); env.epoch = "one";
  env.read.mockReset().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3 });
  env.legacyRead.mockClear(); env.action.mockReset().mockResolvedValue({ status: "saved" }); env.menus = []; env.notify.mockReset();
  let count = 0; Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:image-${++count}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { seen = callback; } observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); resetThumbnailCache(); vi.unstubAllGlobals(); });
const render = async (value: MessageImage = image) => { await act(async () => root.render(h(ImageThumb, { image: value, hostId: "remote", className: "h-20", imgClassName: "", fallback: "file" }))); };
const show = async () => { await act(async () => seen([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)); };

it("reserves the identical aspect-ratio box before bytes load and in the lightbox", async () => {
  let finish!: (value: unknown) => void;
  env.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const sized: MessageImage = { ...image, blob: { ...image.blob, width: 1200, height: 800 } };
  await render(sized);
  const placeholder = host.querySelector<HTMLElement>('[data-image-box="reserved"]')!;
  expect(placeholder.style.aspectRatio).toBe("1200 / 800");
  expect(placeholder.style.width).toBe("480px");
  const reserved = placeholder.getAttribute("style");
  await act(async () => { seen([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
  expect(env.read).toHaveBeenCalledWith("remote", "cutex.session", hash, { mime: "image/png", size: 3 });
  await act(async () => finish({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3 }));
  const loaded = host.querySelector<HTMLElement>('[data-testid="image-thumb"]')!;
  expect(loaded.getAttribute("style")).toBe(reserved);
  const img = loaded.querySelector("img")!;
  expect([img.width, img.height]).toEqual([1200, 800]);
  expect(img.style.objectFit).toBe("contain");
  act(() => loaded.click());
  const zoom = document.querySelector<HTMLElement>("[data-image-zoom-box]")!;
  expect(zoom.style.aspectRatio).toBe("1200 / 800");
  expect(zoom.style.width).toContain("100dvh");
});

it("keeps the old automatic box when dimensions are absent or malformed", async () => {
  await render();
  expect(host.querySelector("[data-image-box]")).toBeNull();
  await render({ ...image, blob: { ...image.blob, width: 640, height: 0 } });
  expect(host.querySelector("[data-image-box]")).toBeNull();
});

it("shows descriptor metadata before a lazy host-bound byte read, then opens the same blob URL", async () => {
  await render(); expect(env.read).not.toHaveBeenCalled(); expect(host.textContent).toContain("image/png");
  await show();
  expect(env.read).toHaveBeenCalledWith("remote", "cutex.session", hash, { mime: "image/png", size: 3 });
  expect(env.legacyRead).not.toHaveBeenCalled();
  expect(host.querySelector("img")!.getAttribute("src")).toBe("blob:image-1");
  act(() => host.querySelector("button")!.click());
  expect(document.querySelector('[data-testid="message-image-zoom"] img')!.getAttribute("src")).toBe("blob:image-1");
});

it("routes strict new blob strings from edit/resend through the blob API too", async () => {
  await render({ kind: "url", url: `cutex-blob:cutex.session/${hash}` }); await show();
  expect(env.read).toHaveBeenCalledWith("remote", "cutex.session", hash);
  expect(env.legacyRead).not.toHaveBeenCalled(); expect(host.querySelector("img")!.src).toBe("blob:image-1");
});

it("shows unavailable metadata without a request on old hosts or explicit unavailable markers", async () => {
  env.features.clear(); await render(); expect(host.textContent).toContain("image.unavailable"); expect(env.read).not.toHaveBeenCalled();
  await render({ kind: "unavailable", mime: "image/webp", size: 2000, reason: "blob_too_large" });
  expect(host.textContent).toContain("image/webp"); expect(host.textContent).toContain("2 KB");
});

it("keeps failed thumbnails visible and retries an authorized fetch on user request", async () => {
  env.read.mockRejectedValueOnce(Error("not granted")); await render(); await show();
  expect(host.textContent).toContain("image.failed");
  const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "image.retry")!;
  await act(async () => retry.click());
  expect(env.read).toHaveBeenCalledTimes(2); expect(host.querySelector("img")).not.toBeNull();
  act(() => host.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(host.querySelector("[data-image-failed]")).not.toBeNull();
});

it("reports a lightbox decoder failure rather than leaving an empty overlay", async () => {
  await render(); await show(); act(() => host.querySelector("button")!.click());
  act(() => document.querySelector('[data-testid="message-image-zoom"] img')!.dispatchEvent(new Event("error")));
  expect(document.querySelector('[data-testid="message-image-zoom"] [role="alert"]')!.textContent).toBe("image.failed");
});

it("sends original session metadata for gesture-bound save/copy, never its object URL", async () => {
  await render(); await show();
  act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  const save = env.menus.find((entry) => entry && typeof entry === "object" && entry.label === "image.save");
  if (!save || typeof save !== "object") throw Error("missing save action");
  await act(async () => save.onSelect());
  expect(env.action).toHaveBeenCalledWith("remote", { kind: "blob", sessionId: "cutex.session", sha256: hash, mime: "image/png", size: 3 }, "save");
  expect(host.textContent).toContain("image.saved");
});

it("surfaces image action failures and does not reuse an action across auth epochs", async () => {
  await render(); await show();
  const open = () => act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  open(); const copy = env.menus.find((entry) => entry && typeof entry === "object" && entry.label === "image.copy");
  if (!copy || typeof copy !== "object") throw Error("missing copy");
  env.action.mockRejectedValueOnce(Error("clipboard unavailable")); await act(async () => copy.onSelect());
  // Copy reports by toast (the lightbox covers the inline note).
  expect(env.notify).toHaveBeenCalledWith("image.actionFailed", "error");
  open(); const saved = env.menus.find((entry) => entry && typeof entry === "object" && entry.label === "image.save");
  if (!saved || typeof saved !== "object") throw Error("missing save");
  env.epoch = "two"; await act(async () => saved.onSelect());
  expect(env.action).toHaveBeenCalledTimes(1);
});
