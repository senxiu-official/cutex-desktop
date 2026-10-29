// @vitest-environment jsdom
// Images of a queued message (components/QueuePanel row) and of the composer's attachments
// (components/ImageThumbs, as Composer renders them) show as thumbnails that open full size on click,
// like a sent message's (owner 2026-10-21). A host path is read through cutex fs-file-read, never
// the local disk; without it the row keeps an image glyph.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "@cutex-desktop/protocol";

const host = vi.hoisted(() => ({ fsRead: false, hostFile: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  // Selectors that need more of the store than these mocks read as false (as in the other queue panel tests).
  useApp: Object.assign(
    (select: (s: unknown) => unknown) => {
      try {
        return select({});
      } catch {
        return false;
      }
    },
    { getState: () => ({}) },
  ),
  selectedFeatures: () => new Set(),
  agentHost: () => "local",
  featuresOf: () => new Set(host.fsRead ? ["fs-file-read"] : []),
  hostApi: () => ({ hostFile: host.hostFile }),
  queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map((p) => p.text ?? "").join(""),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { QueuePanel } = await import("../src/renderer/src/components/QueuePanel");
const { ImageThumb } = await import("../src/renderer/src/components/ImageThumbs");
const { draftMessageImage } = await import("../src/shared/input");
const { queuedRowText } = await import("../src/renderer/src/lib/queuePause");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;
const at = "2026-10-21T00:00:00Z";
const queued = (queueId: string, input: unknown[]): QueueItem => ({ queueId, clientUserMessageId: `cm-${queueId}`, origin: { kind: "other", clientId: "desktop" } as never, input, position: 0, revision: 1, state: "queued", createdAt: at, updatedAt: at });
const text = (t: string) => ({ type: "text", text: t, text_elements: [] });

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
function mountPanel(items: QueueItem[]) {
  act(() =>
    root!.render(
      h(QueuePanel, {
        steers: [],
        outbox: { onRetry() {}, onEdit() {}, onDiscard() {} },
        onInterruptSendSteers() {},
        onDismissSteer() {},
        paused: { steers: [], items: [], count: 0 },
        onResumePaused() {},
        onRestorePaused() {},
        onClearPaused() {},
        items,
        canEdit: true,
        onEdit() {},
        onDelete() {},
        hostId: "local",
      }),
    ),
  );
}
const zoom = () => document.body.querySelector<HTMLElement>('[data-testid="message-image-zoom"]');

beforeEach(() => {
  host.fsRead = false;
  host.hostFile.mockReset();
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  el.remove();
});

describe("a queued message's images", () => {
  it("show as a thumbnail (not \"[image]\" text) that opens full size; Esc closes", () => {
    mountPanel([queued("q1", [text("看这张"), { type: "image", url: PNG }])]);
    const row = el.querySelector('[data-testid="queue-item"]')!;
    expect(row.textContent).toContain("看这张");
    expect(row.textContent).not.toContain("[image]");
    const thumb = row.querySelector<HTMLButtonElement>('[data-testid="image-thumb"]')!;
    expect(thumb.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => thumb.click());
    expect(zoom()!.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(zoom()).toBeNull();
  });

  it("a host path (an attachment cutex stored) is read through cutex fs-file-read", async () => {
    host.fsRead = true;
    host.hostFile.mockResolvedValue({ encoding: "base64", content: PNG_B64, mime: "image/png", size: 70, truncated: false });
    const path = "/home/alex/.cutex/attachments/s1/queued-shot.png";
    mountPanel([queued("q2", [{ type: "localImage", path }])]);
    await flush();
    expect(host.hostFile).toHaveBeenCalledWith(path, expect.any(Number));
    const thumb = el.querySelector<HTMLButtonElement>('[data-testid="image-thumb"]')!;
    expect(thumb.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => thumb.click());
    expect(zoom()).not.toBeNull();
    act(() => zoom()!.click());
    expect(zoom()).toBeNull();
  });

  it("without fs-file-read a host path keeps an image glyph and is never read", async () => {
    mountPanel([queued("q3", [text("x"), { type: "localImage", path: "/tmp/elsewhere-shot.png" }])]);
    await flush();
    expect(host.hostFile).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="queue-item-images"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="image-thumb"]')).toBeNull();
  });

  it("row text drops image parts only", () => {
    expect(queuedRowText(queued("q", [text("a"), { type: "image", url: PNG }, { type: "localImage", path: "/p.png" }, text("b")]))).toBe("a\nb");
    expect(queuedRowText(queued("q", [text("a"), { type: "mention", name: "m", path: "app://m" }]))).toBe("a\n[mention]");
  });
});

describe("a composer image", () => {
  it("a pasted image's thumbnail opens full size", () => {
    const pasted = { id: "img-1", name: "paste.png", preview: PNG, source: { kind: "data" as const, url: PNG } };
    act(() => root!.render(h(ImageThumb, { image: draftMessageImage(pasted), hostId: "local", className: "h-14 w-14", imgClassName: "", fallback: "paste.png" })));
    act(() => el.querySelector<HTMLButtonElement>('[data-testid="image-thumb"]')!.click());
    expect(zoom()!.querySelector("img")!.getAttribute("src")).toBe(PNG);
  });

  it("thumbnail source: preview, else data URL, else the (host) path", () => {
    expect(draftMessageImage({ id: "a", name: "a", preview: "data:image/png;base64,QQ==", source: { kind: "path", path: "/x.png" } })).toEqual({ kind: "url", url: "data:image/png;base64,QQ==" });
    expect(draftMessageImage({ id: "b", name: "b", preview: null, source: { kind: "data", url: PNG } })).toEqual({ kind: "url", url: PNG });
    // A message put back from the queue: only the path cutex holds (read through the host, not the local disk).
    expect(draftMessageImage({ id: "c", name: "c", preview: null, source: { kind: "path", path: "/att/c.png" } })).toEqual({ kind: "path", path: "/att/c.png" });
  });
});
