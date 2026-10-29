// @vitest-environment jsdom
// A message's images look the same everywhere (components/ImageThumbs): an insert waiting for the next
// tool boundary (插话), one the stopped turn dropped (未送达), a send still in flight (发送中) and a sent
// message in the timeline show thumbnails that open full size — no 「+N 张图片」 text. A sent image that
// is a host path is read through the agent's host (cutex fs-file-read), never the local disk; a host
// without it keeps the file chip. 编辑并重发 gets the sent message's images and skills back as input items.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "@cutex-desktop/protocol";
import type { MessageImage } from "../src/shared/input";

const host = vi.hoisted(() => ({ fsRead: false, hostFile: vi.fn(), epoch: "one" }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign(
    (select: (s: unknown) => unknown) => {
      try {
        return select({});
      } catch {
        return false;
      }
    },
    { getState: () => ({ hosts: { hosts: [{ id: "local", conn: { epoch: host.epoch } }] } }) },
  ),
  selectedFeatures: () => new Set(),
  agentHost: () => "local",
  featuresOf: () => new Set(host.fsRead ? ["fs-file-read"] : []),
  hostApi: () => ({ hostFile: host.hostFile }),
  queueItemText: (item: QueueItem) => (item.input as { text?: string }[]).map((p) => p.text ?? "").join(""),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { QueuePanel } = await import("../src/renderer/src/components/QueuePanel");
const { TurnQueue } = await import("../src/renderer/src/components/TurnQueue");
const { MessageImages } = await import("../src/renderer/src/components/ImageThumbs");
const { newOutboxEntry } = await import("../src/renderer/src/lib/outbox");
const { entryFromItem } = await import("../src/renderer/src/lib/timeline");
const { messageInputItems } = await import("../src/shared/input");
type PendingSteer = import("../src/renderer/src/lib/pendingSteers").PendingSteer;

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;
const steer = (id: string, extra: unknown[], over: Partial<PendingSteer> = {}): PendingSteer => ({ id, text: `steer-${id}`, imageCount: extra.length, turnId: "t1", baseline: 0, extra, state: "waiting", ...over });

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLDivElement;
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};
const thumbs = (scope: ParentNode = el) => [...scope.querySelectorAll<HTMLButtonElement>('[data-testid="image-thumb"]')];
const zoom = () => document.body.querySelector<HTMLElement>('[data-testid="message-image-zoom"]');

function mountPanel(p: { steers?: PendingSteer[]; undelivered?: PendingSteer[]; sending?: ReturnType<typeof newOutboxEntry>[] }) {
  act(() =>
    root!.render(
      h(QueuePanel, {
        steers: [...(p.steers ?? []), ...(p.undelivered ?? [])],
        sendingSteers: p.sending ?? [],
        outbox: { onRetry() {}, onEdit() {}, onDiscard() {} },
        onInterruptSendSteers() {},
        onDismissSteer() {},
        paused: { steers: p.undelivered ?? [], items: [], count: p.undelivered?.length ?? 0 },
        onResumePaused() {},
        onRestorePaused() {},
        onClearPaused() {},
        items: [],
        canEdit: true,
        onEdit() {},
        onDelete() {},
        hostId: "local",
      }),
    ),
  );
}

beforeEach(() => {
  host.fsRead = false;
  host.epoch = "one";
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

describe("inserts and sends in the queue panel show their images as thumbnails", () => {
  it("a waiting insert (插话): thumbnail that opens full size, no 「+N 张图片」", () => {
    mountPanel({ steers: [steer("s1", [{ type: "image", url: PNG }])] });
    expect(el.textContent).toContain("steer-s1");
    expect(el.textContent).not.toContain("steer.images");
    const [thumb] = thumbs();
    expect(thumb!.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => thumb!.click());
    expect(zoom()!.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => zoom()!.click());
  });

  it("an undelivered insert: its stored attachment is read through cutex fs-file-read", async () => {
    host.fsRead = true;
    host.hostFile.mockResolvedValue({ encoding: "base64", content: PNG_B64, mime: "image/png", size: 70, truncated: false });
    const path = "/home/alex/.cutex/attachments/s1/steer.png";
    mountPanel({ undelivered: [steer("s2", [{ type: "localImage", path }], { state: "undelivered" })] });
    await flush();
    expect(host.hostFile).toHaveBeenCalledWith(path, expect.any(Number));
    expect(thumbs(el.querySelector('[data-testid="undelivered-steer"]')!)).toHaveLength(1);
  });

  it("an insert restored after a restart whose inline images were stripped (storage cap) still says +N", () => {
    mountPanel({ steers: [steer("s3", [], { imageCount: 2 })] });
    expect(thumbs()).toHaveLength(0);
    expect(el.querySelector('[data-testid="queue-item-images"]')!.textContent).toBe("+2");
  });

  it("a send still in flight (发送中) shows its images", () => {
    const entry = newOutboxEntry(null, { id: "cm-1", text: "看这张", extra: [{ type: "image", url: PNG }, { type: "image", url: PNG }], strategy: "auto", placement: "steer" });
    mountPanel({ sending: [entry] });
    const row = el.querySelector('[data-testid="outbox-sending"]')!;
    expect(thumbs(row)).toHaveLength(2);
    expect(row.textContent).not.toContain("steer.images");
  });

  it("a waiting insert in the turn frame (下个工具边界)", () => {
    act(() =>
      root!.render(
        h(TurnQueue, {
          ordered: { turns: [], nextStep: [], running: true, runningSince: null, currentTurn: { kind: "owner" }, mayPass: true, onMove() {}, sessionId: "s" },
          waiting: [steer("s4", [{ type: "image", url: PNG }])],
          sendingSteers: [],
          sendingQueue: [],
          renderOutbox: () => null,
          onInterruptSendSteers() {},
          heldIds: new Set<string>(),
          paused: { controls: false, onResume() {}, onRestore() {} },
          itemRow: () => null,
          hostId: "local",
        }),
      ),
    );
    const row = el.querySelector('[data-testid="boundary-steer"]')!;
    expect(row.textContent).toContain("steer-s4");
    expect(thumbs(row)).toHaveLength(1);
  });
});

describe("a sent message's images in the timeline (MessageImages)", () => {
  const path = "/home/alex/.cutex/attachments/eva/flush-race.png";

  it("keeps the optimistic image DOM and source while its r259 attachment is loading", async () => {
    host.fsRead = true;
    let finish!: (value: unknown) => void;
    host.hostFile.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const images: MessageImage[] = [{ kind: "url", url: PNG }];
    act(() => root!.render(h(MessageImages, { images, hostId: "local", messageId: "send-preview", pending: true })));
    const button = thumbs()[0], img = button!.querySelector("img");
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: "/att/preview-handoff.png" }], hostId: "local", messageId: "send-preview" })));
    await flush();
    expect(host.hostFile).toHaveBeenCalledWith("/att/preview-handoff.png", expect.any(Number));
    expect(thumbs()[0]).toBe(button);
    expect(button!.querySelector("img")).toBe(img);
    expect(img!.getAttribute("src")).toBe(PNG);
    expect(el.querySelector('[role="status"]')).toBeNull();
    await act(async () => finish({ encoding: "base64", content: PNG_B64, mime: "image/png", size: 70, truncated: false }));
    expect(thumbs()[0]).toBe(button);
    expect(button!.querySelector("img")).toBe(img);
  });

  it.each(["message", "host", "authority"])("does not reuse the preview after the %s changes", async (change) => {
    host.fsRead = true;
    host.hostFile.mockReturnValue(new Promise(() => {}));
    act(() => root!.render(h(MessageImages, { images: [{ kind: "url", url: PNG }], hostId: "local", messageId: "before", pending: true })));
    if (change === "authority") host.epoch = "two";
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: `/att/scope-${change}.png` }], hostId: change === "host" ? "remote" : "local", messageId: change === "message" ? "after" : "before" })));
    await flush();
    expect(thumbs()).toHaveLength(0);
    expect(el.querySelector('[role="status"]')).not.toBeNull();
  });

  it("shows a failed attachment read rather than retaining its optimistic preview", async () => {
    host.fsRead = true;
    host.hostFile.mockRejectedValue(new Error("path_not_found"));
    act(() => root!.render(h(MessageImages, { images: [{ kind: "url", url: PNG }], hostId: "local", messageId: "failed-preview", pending: true })));
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: "/att/preview-failed.png" }], hostId: "local", messageId: "failed-preview" })));
    await flush();
    expect(thumbs()).toHaveLength(0);
    expect(el.querySelector('[data-testid="message-image-chip"]')!.textContent).toBe("preview-failed.png");
  });

  it("an image sent as a host path is a thumbnail read through the agent's host", async () => {
    host.fsRead = true;
    host.hostFile.mockResolvedValue({ encoding: "base64", content: PNG_B64, mime: "image/png", size: 70, truncated: false });
    act(() => root!.render(h(MessageImages, { images: [{ kind: "url", url: PNG }, { kind: "path", path }], hostId: "local" })));
    await flush();
    expect(host.hostFile).toHaveBeenCalledWith(path, expect.any(Number));
    expect(thumbs().map((b) => b.querySelector("img")!.getAttribute("src"))).toEqual([PNG, PNG]);
    expect(el.querySelector('[data-testid="message-image-chip"]')).toBeNull();
  });

  it("without fs-file-read (or a file it cannot read) the path keeps its file chip; nothing local is read", async () => {
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path }], hostId: "local" })));
    await flush();
    expect(host.hostFile).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="message-image-chip"]')!.textContent).toBe("flush-race.png");
    host.fsRead = true;
    host.hostFile.mockRejectedValue(new Error("path_not_found"));
    act(() => root!.render(h(MessageImages, { images: [{ kind: "path", path: "/elsewhere/gone.png" }], hostId: "local" })));
    await flush();
    expect(el.querySelector('[data-testid="message-image-chip"]')!.textContent).toBe("gone.png");
  });
});

describe("编辑并重发 input items of a sent message", () => {
  it("a userMessage keeps its images and skills; they map back to the items it was sent with", () => {
    const content = [{ type: "text", text: "看这张" }, { type: "image", url: PNG }, { type: "localImage", path: "/att/a.png" }, { type: "skill", name: "review", path: "/skills/review" }];
    const entry = entryFromItem({ type: "userMessage", id: "u1", content }, "t1");
    if (entry.kind !== "user") throw new Error("not a user entry");
    expect(entry.text).toBe("看这张");
    expect(messageInputItems(entry.images, entry.skills)).toEqual(content.slice(1));
    expect(entryFromItem({ type: "userMessage", id: "u2", content: [{ type: "text", text: "x" }] }, "t1")).not.toHaveProperty("skills");
  });
});
