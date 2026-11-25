// @vitest-environment jsdom
// Seams for hosts that render the shared conversation rows without the desktop store / bridge (the iPad
// conversation): a tool row's turn state (lib/toolTimeline), ImageThumb's media reader (lib/mediaLoader)
// and the dock's keyboard hints. Unset, each keeps the desktop behaviour.
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageImage } from "../src/shared/input";
const env = vi.hoisted(() => ({ read: vi.fn(), action: vi.fn() }));
// The real store (the desktop path reads it); only the bridge is a stand-in.
vi.mock("../src/renderer/src/bridge", () => {
  const api = { eventBlob: env.read, historyMedia: env.read, imageAction: env.action, hostFile: env.read };
  return { api, apiFor: () => api, bridge: { platform: "win32" }, onEvent: () => () => {} };
});
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key, useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/components/ApprovalSource", () => ({ ApprovalSource: () => null }));
import { PlainToolRow } from "../src/renderer/src/components/PlainToolRow";
import { ImageThumb } from "../src/renderer/src/components/ImageThumbs";
import { InteractionDock } from "../src/renderer/src/components/InteractionDock";
import { ConversationScope } from "../src/renderer/src/lib/conversationScope";
import { ToolTimelineContext, type ToolTimeline } from "../src/renderer/src/lib/toolTimeline";
import { MediaLoaderContext, type MediaLoader } from "../src/renderer/src/lib/mediaLoader";
import { resetThumbnailCache } from "../src/renderer/src/lib/fileThumbnails";
import { useApp } from "../src/renderer/src/store";
import { viewKey } from "../src/renderer/src/lib/viewKey";
import type { RawItem } from "../src/renderer/src/lib/timeline";

let host: HTMLDivElement; let root: Root;
/** The desktop store's view of eva/agent (what PlainToolRow reads without a provider). */
function storeTimeline(timeline: unknown) {
  useApp.setState({ sessions: timeline ? { [viewKey("eva", "agent")]: { timeline } as never } : {} });
}
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  env.read.mockReset(); env.action.mockReset(); storeTimeline(null);
  resetThumbnailCache();
  let count = 0; Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:seam-${++count}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); resetThumbnailCache(); });
const draw = async (node: ReactNode) => { await act(async () => root.render(h(ConversationScope.Provider, { value: { hostId: "eva", sessionId: "agent", paneId: "seam", focused: true, visible: true } }, node))); };

describe("tool rows: ToolTimelineContext", () => {
  const item = { id: "cmd-1", type: "commandExecution", status: "inProgress", command: "pnpm test" } as unknown as RawItem;
  const timeline = (status: string): ToolTimeline["timeline"] => ({ entries: new Map([["cmd-1", { turnId: "turn-1" }]]) as never, turns: [{ id: "turn-1", status }] as never });
  const spinning = () => !!host.querySelector(".animate-spin");
  const stopped = () => !!host.querySelector(".lucide-circle-stop");

  it("without a provider reads the store's view (desktop unchanged)", async () => {
    storeTimeline(timeline("interrupted"));
    await draw(h(PlainToolRow, { item }));
    expect(stopped()).toBe(true);
    storeTimeline(timeline("inProgress"));
    await draw(h(PlainToolRow, { item: { ...item } }));
    expect(spinning()).toBe(true);
  });

  it("a provided timeline replaces the store: an interrupted turn stops the spinner", async () => {
    storeTimeline(timeline("inProgress")); // the store says running; the provided timeline wins
    await draw(h(ToolTimelineContext.Provider, { value: { timeline: timeline("interrupted") } }, h(PlainToolRow, { item })));
    expect(stopped()).toBe(true);
    expect(spinning()).toBe(false);
    await draw(h(ToolTimelineContext.Provider, { value: { timeline: timeline("inProgress") } }, h(PlainToolRow, { item: { ...item } })));
    expect(spinning()).toBe(true);
  });

  it("a provided background list marks a still-running shell", async () => {
    await draw(h(ToolTimelineContext.Provider, { value: { timeline: timeline("completed"), background: ["cmd-1"] } }, h(PlainToolRow, { item })));
    expect(host.querySelector(".lucide-square-terminal.text-accent")).not.toBeNull();
  });
});

describe("ImageThumb: MediaLoaderContext", () => {
  const hash = "c".repeat(64);
  const blob: MessageImage = { kind: "blob", blob: { type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/png", size: 3, url: `cutex-blob:agent/${hash}` } };
  const media: MessageImage = { kind: "url", url: `cutex-media:agent/${hash}` };
  const thumb = (image: MessageImage) => h(ImageThumb, { image, hostId: "eva", className: "h-20", imgClassName: "", fallback: "file" });
  const loader = (): MediaLoader & { read: ReturnType<typeof vi.fn> } => ({ scope: "ipad:eva", read: vi.fn(async () => ({ encoding: "bytes" as const, bytes: new Uint8Array([1, 2, 3]), mime: "image/png", size: 3, truncated: false })) });

  it("reads blob and media refs through the provided loader, not the bridge, without host features", async () => {
    const own = loader();
    await draw(h(MediaLoaderContext.Provider, { value: own }, thumb(blob)));
    await act(async () => {});
    expect(own.read).toHaveBeenCalledWith({ sessionId: "agent", sha256: hash, kind: "blob" }, { mime: "image/png", size: 3 });
    expect(host.querySelector("img")?.getAttribute("src")).toMatch(/^blob:seam-/);
    await draw(h(MediaLoaderContext.Provider, { value: own }, thumb(media)));
    await act(async () => {});
    expect(own.read).toHaveBeenLastCalledWith({ sessionId: "agent", sha256: hash }, undefined);
    expect(env.read).not.toHaveBeenCalled();
  });

  it("with a loader the enlarged view offers no bridge copy", async () => {
    await draw(h(MediaLoaderContext.Provider, { value: loader() }, thumb(blob)));
    await act(async () => {});
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="image-thumb"]')!.click());
    expect(document.querySelector('[data-testid="message-image-zoom"]')).not.toBeNull();
    expect(document.querySelector("[data-image-zoom-close]")).not.toBeNull();
    expect(document.querySelector("[data-image-zoom-copy]")).toBeNull();
    expect(document.querySelector("[data-image-zoom-save]")).toBeNull();
    act(() => document.querySelector<HTMLElement>("[data-image-zoom-close]")!.click());
  });

  it("without a loader keeps the desktop rule: a blob ref needs the host's blob feature", async () => {
    await draw(thumb(blob));
    await act(async () => {});
    expect(env.read).not.toHaveBeenCalled();
    expect(host.textContent).toContain("image.unavailable");
  });
});

describe("InteractionDock: keyHints", () => {
  const approval = [{ id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "t", turnId: "u", itemId: "i", command: "ls" } }];
  it("shows the keyboard hints by default and hides them for touch", async () => {
    await draw(h(InteractionDock, { pending: approval, onReply: () => {} }));
    expect(host.querySelector("[data-interaction-keys]")?.textContent).toContain("interaction.keys");
    await draw(h(InteractionDock, { pending: approval, onReply: () => {}, keyHints: false }));
    expect(host.querySelector("[data-interaction-keys]")).toBeNull();
    expect(host.querySelectorAll("button").length).toBeGreaterThan(0);
  });
});
