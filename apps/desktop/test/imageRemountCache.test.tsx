// @vitest-environment jsdom
// A conversation with many images mounting again (switch away and back): images already in memory show from the
// first render — no loading placeholder, no read. A host path (a sent attachment, a Markdown file link) may be
// rewritten, so it is checked by its size + mtime (`fs/file` with maxBytes 1: no bytes) at most once a minute, and
// its bytes are read again only when that changed (lib/fileThumbnails `version`).
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
const { fileVersion, loadThumbnail, resetThumbnailCache, useThumbnail } = await import("../src/renderer/src/lib/fileThumbnails");

const PNG_A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_B = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==";
const PATHS = Array.from({ length: 6 }, (_, i) => `C:\\Users\\owner\\.cutex\\runtime\\attachments\\s1\\shot-${i}.png`);
const files = new Map<string, { content: string; modifiedAt: string }>();
// cutex `GET /v2/fs/file`: maxBytes 1 is the version read (size + mtime, one byte of content).
const fsFile = (path: string, maxBytes: number) => {
  const f = files.get(path)!, size = Math.floor(f.content.length * 3 / 4) - (f.content.endsWith("==") ? 2 : f.content.endsWith("=") ? 1 : 0);
  return Promise.resolve({ path, size, modifiedAt: f.modifiedAt, mime: "image/png", encoding: "base64", truncated: maxBytes < size, content: maxBytes < size ? f.content.slice(0, 4) : f.content });
};
const fullReads = () => host.hostFile.mock.calls.filter(([, max]) => max === MAX_IMAGE_BYTES).length;
const versionReads = () => host.hostFile.mock.calls.filter(([, max]) => max === 1).length;

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLDivElement;
let now = 1_800_000_000_000;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => {}); };
const srcs = () => [...el.querySelectorAll<HTMLImageElement>('[data-testid="image-thumb"] img')].map((img) => img.getAttribute("src"));
const placeholders = () => el.querySelectorAll('[role="status"]').length;
const images = PATHS.map((path) => ({ kind: "path" as const, path }));
const mount = () => { el = document.createElement("div"); document.body.appendChild(el); root = createRoot(el); act(() => root!.render(h(MessageImages, { images, hostId: "local" }))); };
const unmount = () => { act(() => root?.unmount()); root = null; el.remove(); };

beforeEach(() => {
  resetThumbnailCache(); host.hostFile.mockReset(); host.hostFile.mockImplementation(fsFile);
  for (const path of PATHS) files.set(path, { content: PNG_A, modifiedAt: "2026-11-12T00:00:00Z" });
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => { unmount(); resetThumbnailCache(); vi.restoreAllMocks(); });

it("a remount within a minute shows every sent image from memory at the first render, with no host request", async () => {
  mount(); await flush();
  expect(fullReads()).toBe(6);
  expect(srcs().every((src) => src?.startsWith("data:image/png;base64,"))).toBe(true);
  unmount(); host.hostFile.mockClear();
  now += 30_000;
  mount(); // no flush: the first commit already has the images
  expect(placeholders()).toBe(0);
  expect(srcs()).toHaveLength(6);
  await flush();
  expect(host.hostFile).not.toHaveBeenCalled();
});

it("after a minute: one byte-free version read per image, no byte reread while the file is unchanged", async () => {
  mount(); await flush(); unmount(); host.hostFile.mockClear();
  now += 61_000;
  mount(); expect(placeholders()).toBe(0); await flush();
  expect(versionReads()).toBe(6);
  expect(fullReads()).toBe(0);
  unmount(); host.hostFile.mockClear();
  // Checked again only after another minute.
  now += 20_000;
  mount(); await flush();
  expect(host.hostFile).not.toHaveBeenCalled();
});

it("a rewritten file (new size / mtime) is read again and the shown image is replaced", async () => {
  mount(); await flush();
  const before = srcs()[0];
  unmount(); host.hostFile.mockClear();
  files.set(PATHS[0]!, { content: PNG_B, modifiedAt: "2026-11-12T01:00:00Z" });
  now += 61_000;
  mount();
  expect(srcs()[0]).toBe(before); // the copy in memory until the check answers
  await flush();
  expect(versionReads()).toBe(6);
  expect(fullReads()).toBe(1);
  expect(host.hostFile).toHaveBeenCalledWith(PATHS[0], MAX_IMAGE_BYTES);
  expect(srcs()[0]).toBe(`data:image/png;base64,${PNG_B}`);
  expect(srcs().slice(1).every((src) => src === before)).toBe(true);
});

it("a failed version read keeps the shown image (a transient error never turns it into a failure)", async () => {
  mount(); await flush(); unmount();
  host.hostFile.mockImplementation((path: string, max: number) => max === 1 ? Promise.reject(Error("timeout")) : fsFile(path, max));
  host.hostFile.mockClear();
  now += 61_000;
  mount(); await flush();
  expect(fullReads()).toBe(0);
  expect(srcs()).toHaveLength(6);
  expect(el.querySelector("[data-image-failed]")).toBeNull();
});

it("version checks run at most four at a time", async () => {
  mount(); await flush(); unmount();
  let active = 0, peak = 0;
  const waiting: (() => void)[] = [];
  host.hostFile.mockImplementation((path: string, max: number) => max !== 1 ? fsFile(path, max) : new Promise((resolve) => {
    active++; peak = Math.max(peak, active);
    waiting.push(() => { active--; resolve(fsFile(path, max)); });
  }));
  host.hostFile.mockClear();
  now += 61_000;
  mount(); await flush();
  expect(versionReads()).toBe(4);
  while (waiting.length) { waiting.shift()!(); await flush(); }
  expect(versionReads()).toBe(6);
  expect(peak).toBe(4);
  expect(fullReads()).toBe(0);
});

it("a reply without a version (an older host) keeps the read on every mount", async () => {
  host.hostFile.mockImplementation((path: string, max: number) => fsFile(path, max).then((f) => ({ ...f, modifiedAt: "" })));
  mount(); await flush(); unmount();
  expect(fullReads()).toBe(6);
  mount(); await flush();
  expect(fullReads()).toBe(12);
});

it("fileVersion is size + mtime, null without an mtime", () => {
  expect(fileVersion({ size: 3, modifiedAt: "2026-11-12T00:00:00Z" })).toBe("3|2026-11-12T00:00:00Z");
  expect(fileVersion({ size: 3, modifiedAt: "" })).toBeNull();
  expect(fileVersion(null)).toBeNull();
});

it("useThumbnail: a cached image is `ok` at the first render; without one it starts idle", async () => {
  await loadThumbnail("k", async () => ({ encoding: "base64", content: PNG_A, mime: "image/png", size: 70, truncated: false }));
  const seen: string[] = [];
  function Probe({ id }: { id: string }) { const { ref, state } = useThumbnail(id, async () => ({ encoding: "base64", content: PNG_A, mime: "image/png", size: 70, truncated: false })); seen.push(`${id}:${state.status}`); return h("span", { ref: ref as never }); }
  el = document.createElement("div"); root = createRoot(el);
  act(() => root!.render(h("div", null, h(Probe, { id: "k" }), h(Probe, { id: "cold" }))));
  expect(seen[0]).toBe("k:ok");
  expect(seen[1]).toBe("cold:idle");
});
