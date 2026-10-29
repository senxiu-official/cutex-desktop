// @vitest-environment jsdom
// 复制图片 in the enlarged image view (owner 2026-10-25): the toolbar button, Ctrl/⌘+C (not over a text
// selection), the right-click menu inside the view, and lib/imageCopy's routing — PNG / JPEG straight to main's
// imageAction (blob / media / inline, the existing reads), anything else drawn to PNG first and sent inline.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageImage } from "../src/shared/input";
import type { MenuEntry } from "../src/renderer/src/lib/contextMenu";
const env = vi.hoisted(() => ({ action: vi.fn(), notify: vi.fn(), menus: [] as MenuEntry[] }));
vi.mock("../src/renderer/src/store", () => ({
  featuresOf: () => new Set(["event-media-blobs"]),
  hostApi: (host: string) => ({ imageAction: (...args: unknown[]) => env.action(host, ...args), eventBlob: vi.fn(), historyMedia: vi.fn(), hostFile: vi.fn() }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), { getState: () => ({ hosts: { hosts: [{ id: "remote", conn: { epoch: "one" } }] }, notify: env.notify }), subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: (entries: () => MenuEntry[]) => (event: Event) => { event.preventDefault(); env.menus = entries(); } }));
vi.mock("../src/renderer/src/lib/fileActions", () => ({ fileActions: () => [{ label: "menu.copyPath", onSelect: () => {} }] }));
import { ImageThumb } from "../src/renderer/src/components/ImageThumbs";
import { copyImage, dataUrlMime } from "../src/renderer/src/lib/imageCopy";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("lib/imageCopy", () => {
  const blob = { kind: "blob" as const, sessionId: "cutex.s", sha256: "a".repeat(64) };
  it("PNG / JPEG go to main as they are (the blob / media / inline read main already validates)", async () => {
    const imageAction = vi.fn().mockResolvedValue({ status: "copied" }), toPng = vi.fn();
    await copyImage({ input: { ...blob, mime: "image/jpeg", size: 9 }, mime: "image/jpeg", src: "blob:x" }, { imageAction, toPng });
    expect(imageAction).toHaveBeenCalledWith({ ...blob, mime: "image/jpeg", size: 9 }, "copy");
    // A file's bytes (a data URL read through the host): inline.
    await copyImage({ input: null, mime: null, src: PNG }, { imageAction, toPng });
    expect(imageAction).toHaveBeenLastCalledWith({ kind: "inline", dataUrl: PNG }, "copy");
    expect(toPng).not.toHaveBeenCalled();
  });

  it("WebP / GIF / BMP are drawn to PNG from the shown src and sent inline", async () => {
    const imageAction = vi.fn().mockResolvedValue({ status: "copied" }), toPng = vi.fn().mockResolvedValue(PNG);
    for (const mime of ["image/webp", "image/gif", "image/bmp"]) {
      await copyImage({ input: { ...blob, mime, size: 9 }, mime, src: "blob:shown" }, { imageAction, toPng });
      expect(toPng).toHaveBeenLastCalledWith("blob:shown");
      expect(imageAction).toHaveBeenLastCalledWith({ kind: "inline", dataUrl: PNG }, "copy");
    }
    expect(imageAction).toHaveBeenCalledTimes(3);
    await copyImage({ input: null, mime: null, src: "data:image/webp;base64,UklGRg==" }, { imageAction, toPng });
    expect(toPng).toHaveBeenLastCalledWith("data:image/webp;base64,UklGRg==");
  });

  it("an untyped legacy media ref main cannot decode falls back to the drawn PNG; a typed PNG failure is reported", async () => {
    const imageAction = vi.fn().mockRejectedValueOnce(Error("image_unavailable")).mockResolvedValue({ status: "copied" }), toPng = vi.fn().mockResolvedValue(PNG);
    await copyImage({ input: { kind: "media", sessionId: "cutex.s", sha256: "a".repeat(64) }, mime: null, src: "blob:shown" }, { imageAction, toPng });
    expect(imageAction).toHaveBeenLastCalledWith({ kind: "inline", dataUrl: PNG }, "copy");
    const failing = vi.fn().mockRejectedValue(Error("clipboard"));
    await expect(copyImage({ input: { ...blob, mime: "image/png", size: 9 }, mime: "image/png", src: "blob:x" }, { imageAction: failing, toPng })).rejects.toThrow("clipboard");
    expect(failing).toHaveBeenCalledOnce();
    await expect(copyImage({ input: null, mime: null, src: null }, { imageAction, toPng })).rejects.toThrow("image_unavailable");
    expect(dataUrlMime("data:image/JPEG;base64,AA")).toBe("image/jpeg");
  });
});

describe("the enlarged view", () => {
  let host: HTMLDivElement;
  let root: Root;
  const image: MessageImage = { kind: "url", url: PNG };
  beforeEach(async () => {
    env.action.mockReset().mockResolvedValue({ status: "copied" });
    env.notify.mockReset();
    env.menus = [];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(h(ImageThumb, { image, hostId: "remote", className: "", imgClassName: "", fallback: "file" })));
    act(() => host.querySelector<HTMLElement>('[data-testid="image-thumb"]')!.click());
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  const zoom = () => document.querySelector<HTMLElement>('[data-testid="message-image-zoom"]');
  const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));

  it("has a toolbar with 复制图片 / 图片另存为… / 关闭; copy writes the image and says so", async () => {
    const bar = zoom()!.querySelector("[data-image-zoom-toolbar]")!;
    expect([...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["image.copy", "image.save", "image.close"]);
    expect(bar.querySelector("[data-image-zoom-copy]")!.getAttribute("title")).toBe("image.copy (Ctrl+C)");
    act(() => bar.querySelector<HTMLElement>("[data-image-zoom-copy]")!.click());
    await flush();
    expect(env.action).toHaveBeenCalledWith("remote", { kind: "inline", dataUrl: PNG }, "copy");
    expect(env.notify).toHaveBeenCalledWith("image.copied");
    // Said inside the view as well (the toast is under the overlay).
    expect(zoom()!.querySelector("[data-image-zoom-notice]")?.textContent).toBe("image.copied");
    // The toolbar click does not close the view; 关闭 does.
    expect(zoom()).not.toBeNull();
    act(() => bar.querySelector<HTMLElement>("[data-image-zoom-close]")!.click());
    expect(zoom()).toBeNull();
  });

  it("Ctrl+C copies while it is open — not over a text selection, not with Shift / Alt", async () => {
    key({ key: "c", code: "KeyC", ctrlKey: true });
    await flush();
    expect(env.action).toHaveBeenCalledTimes(1);
    key({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true });
    key({ key: "c", code: "KeyC" });
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "some text" } as Selection);
    key({ key: "c", code: "KeyC", ctrlKey: true });
    await flush();
    expect(env.action).toHaveBeenCalledTimes(1);
  });

  it("a failed copy says so", async () => {
    env.action.mockRejectedValue(Error("clipboard unavailable"));
    act(() => zoom()!.querySelector<HTMLElement>("[data-image-zoom-copy]")!.click());
    await flush();
    expect(env.notify).toHaveBeenCalledWith("image.actionFailed", "error");
    expect(zoom()!.querySelector("[data-image-zoom-notice]")?.textContent).toBe("image.actionFailed");
  });

  it("the right-click menu inside the view has 复制图片 first", async () => {
    act(() => zoom()!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const first = env.menus[0];
    if (!first || typeof first !== "object") throw Error("no menu");
    expect(first.label).toBe("image.copy");
    await act(async () => first.onSelect());
    expect(env.action).toHaveBeenCalledWith("remote", { kind: "inline", dataUrl: PNG }, "copy");
  });
});
