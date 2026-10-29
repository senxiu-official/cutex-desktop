// @vitest-environment jsdom
// A sent image (r259+: uploaded, sent as the attachment's host path) is shown from its optimistic preview
// until the userMessage arrives, then read through cutex fs-file-read — and read again when the agent's
// conversation is closed and opened later (bootstrap: the same `localImage` path). Images up to the send
// cap (MAX_IMAGE_BYTES, 8 MB) must come back whole: read with the 5 MB Markdown thumbnail cap, a 5–8 MB
// screenshot was truncated and turned into a file chip after the handoff and on every reopen.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "../src/shared/ipc";

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

const PREVIEW = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PATH = "C:\\Users\\owner\\.cutex\\runtime\\attachments\\s1\\shot.png";
// A 6 MB screenshot: over the 5 MB thumbnail cap, within the 8 MB send cap.
const SIZE = 6 * 1024 * 1024;
const BODY = "A".repeat((SIZE / 3) * 4);
// cutex `GET /v2/fs/file`: at most `maxBytes`, `truncated` when the file is larger.
const fsFile = (path: string, maxBytes: number) => Promise.resolve({ path, size: SIZE, modifiedAt: "", mime: "image/png", encoding: "base64", truncated: SIZE > maxBytes, content: SIZE > maxBytes ? BODY.slice(0, (maxBytes / 3) * 4) : BODY });

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => {}); };
const shown = () => el.querySelector<HTMLImageElement>('[data-testid="image-thumb"] img')?.getAttribute("src") ?? null;
const open = () => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); };
const close = () => { act(() => root?.unmount()); root = null; el.remove(); };

beforeEach(() => { resetThumbnailCache(); host.hostFile.mockReset(); host.hostFile.mockImplementation(fsFile); open(); });
afterEach(() => { close(); resetThumbnailCache(); });

it("a 6 MB sent screenshot stays an image after the handoff and after the conversation is closed and reopened", async () => {
  // Sending: the optimistic data URL; then the userMessage brings the attachment's host path.
  act(() => root!.render(h(MessageImages, { images: [{ kind: "url", url: PREVIEW }], hostId: "local", messageId: "cm-1", pending: true })));
  act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "cm-1" })));
  await flush();
  expect(host.hostFile).toHaveBeenCalledWith(PATH, MAX_IMAGE_BYTES);
  expect(shown()).toBe(`data:image/png;base64,${BODY}`);
  expect(el.querySelector('[data-testid="message-image-chip"]')).toBeNull();

  // Close the conversation, reopen it: the row comes back from bootstrap (no preview) and reads the same path.
  close(); open();
  act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "cm-1" })));
  await flush();
  expect(shown()).toBe(`data:image/png;base64,${BODY}`);

  // Reopened after the cached bytes expired (or after a restart): read again through the host, still whole.
  close(); resetThumbnailCache(); host.hostFile.mockClear(); open();
  act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local", messageId: "cm-1" })));
  await flush();
  expect(host.hostFile).toHaveBeenCalledTimes(1);
  expect(host.hostFile).toHaveBeenCalledWith(PATH, MAX_IMAGE_BYTES);
  expect(shown()).toBe(`data:image/png;base64,${BODY}`);
});

it("a file over the send cap still falls back to its file chip (truncated read)", async () => {
  host.hostFile.mockImplementation((path: string) => Promise.resolve({ path, size: MAX_IMAGE_BYTES + 1, modifiedAt: "", mime: "image/png", encoding: "base64", truncated: true, content: "AAAA" }));
  act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: PATH }], hostId: "local" })));
  await flush();
  expect(shown()).toBeNull();
  expect(el.querySelector('[data-testid="message-image-chip"]')!.textContent).toBe("shot.png");
});
