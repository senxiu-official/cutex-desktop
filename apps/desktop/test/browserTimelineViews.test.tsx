import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";

const observed = vi.hoisted(() => ({ hostId: "remote-host", images: [] as Array<{ image: unknown; hostId: string }> }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { browser: { forHost: vi.fn() } } }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (selector: (state: object) => unknown) => selector({}),
  viewOf: () => ({ timeline: { entries: new Map([["item-1", { turnId: "turn-1" }]]) } }),
}));
vi.mock("../src/renderer/src/lib/workGroups", () => ({ approvalOutcome: () => null }));
vi.mock("../src/renderer/src/modules/timelineItemsView", () => ({ useTimelineContext: () => ({ hostId: observed.hostId }) }));
vi.mock("../src/renderer/src/modules/browser/browserState", () => ({ browserErrorKey: () => "browser.timeline.imageUnavailable" }));
vi.mock("../src/renderer/src/modules/browser/hosts", () => ({
  useBrowserHostEpoch: () => "connection-1", browserHostCurrent: () => true, afterBrowserHostsDelivered: async () => {},
}));
// The shared thumbnail's fetch/cache/capability checks have their own tests.
// Here the boundary is that a descriptor reaches that component with its host,
// instead of becoming an img src in this browser-specific renderer.
vi.mock("../src/renderer/src/components/ImageThumbs", () => ({
  ImageThumb: ({ image, hostId, fallback }: { image: unknown; hostId: string; fallback: ReactNode }) => {
    observed.images.push({ image, hostId });
    return createElement("span", { "data-media-thumb": hostId }, fallback);
  },
}));

import { BrowserToolRow } from "../src/renderer/src/modules/browser/BrowserTimelineViews";

const hash = "a".repeat(64);
const blob = { type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/png", size: 8 * 1024 * 1024, url: `cutex-blob:cutex.session/${hash}` };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvN8AAAAASUVORK5CYII=";
const item = (blocks: unknown[], extra: Partial<RawItem> = {}): RawItem => ({
  id: "item-1", type: "mcpToolCall", server: "cutex", tool: "browser_screenshot", status: "completed",
  arguments: { title: "Check page" }, result: { content: blocks }, ...extra,
});
const render = (value: RawItem) => renderToStaticMarkup(createElement(BrowserToolRow, { item: value, sessionId: "cutex.session" }));

beforeEach(() => { observed.hostId = "remote-host"; observed.images.length = 0; });

describe("browser timeline media references", () => {
  it("delegates descriptors to the shared thumbnail with the row's host, never a raw img URL", () => {
    const html = render(item([{ type: "image", mimeType: "image/png", data: blob }]));
    expect(observed.images).toEqual([{ image: { kind: "blob", blob }, hostId: "remote-host" }]);
    expect(html).toContain('data-media-thumb="remote-host"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("cutex-media:");
    expect(html).not.toContain("cutex-blob:");
    expect(html).not.toContain("browser.timeline.loadImage");
  });
  it("passes the new host on another binding rather than retaining the focus host", () => {
    const screenshot = item([{ type: "inputImage", imageUrl: blob }]);
    render(screenshot);
    observed.hostId = "another-host";
    render(screenshot);
    expect(observed.images.map(value => value.hostId)).toEqual(["remote-host", "another-host"]);
  });
  it("renders unavailable media quietly without exposing diagnostic content or a reload button", () => {
    const html = render(item([{ type: "image", mimeType: "image/png", data: { type: "imageNotLoaded", reason: "private-fill-value" } }]));
    expect(html).toContain("browser.timeline.imageUnavailable");
    expect(html).not.toContain("private-fill-value");
    expect(html).not.toContain("browser.timeline.loadImage");
    expect(html).not.toContain("<img");
    expect(observed.images).toEqual([]);
  });
  it("retains the old compact full-item loading action", () => {
    const html = render(item([{ type: "imageNotLoaded", fullItemRequired: true }], { truncated: true }));
    expect(html).toContain("browser.timeline.loadImage");
    expect(html).not.toContain("<img");
    expect(observed.images).toEqual([]);
  });
  it("keeps bounded legacy inline screenshots and rejects external image URLs", () => {
    const html = render(item([{ type: "image", mimeType: "image/png", data: PNG }]));
    expect(html).toContain(`src="data:image/png;base64,${PNG}"`);
    expect(observed.images).toEqual([]);
    const bad = render(item([{ type: "inputImage", imageUrl: "https://example.invalid/private?token=secret" }]));
    expect(bad).toContain("browser.timeline.imageUnavailable");
    expect(bad).not.toContain("https://");
    expect(bad).not.toContain("token=secret");
  });
});
