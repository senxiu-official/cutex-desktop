// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {} } as Record<string, unknown>,
  hostFile: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  agentHost: () => "local",
  selectedSidebar: () => null,
  hostApi: () => ({ hostFile: fx.hostFile }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({ ...(await importOriginal<object>()), useHostOwnerNotes: () => ({}) }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: () => [],
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");
const { record, delivery } = await import("../src/renderer/src/lib/inputLedger/testkit");
const { applyInputLedgerSnapshot, emptyInputLedgerSession } = await import("../src/renderer/src/lib/inputLedger/alignment");
const { resetThumbnailCache } = await import("../src/renderer/src/lib/fileThumbnails");

const SID = "s1", CLIENT = "owner-img-1", TEXT = "see this";
const SENT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PATH = "C:\\Users\\owner\\.cutex\\runtime\\attachments\\s1\\shot.png";
const key = viewKey("local", SID);
const draft = { inputId: CLIENT, sessionId: SID, hostId: "local", text: TEXT, extra: [{ type: "image", url: SENT }], strategy: "auto", createdAt: new Date().toISOString(), phase: "sending" };
const ledger = (records: unknown[]) => applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: "e", stateRevision: 1, records, delivery: delivery("idle", 1), coverage: { kind: "full" } } as never).session;
const copy = (clientId?: string) => timelineFromThreadRead({ thread: { id: "thread-s1", turns: [{ id: "t1", status: "inProgress", items: [{ type: "userMessage", id: "native-1", ...(clientId ? { clientId } : {}), content: [{ type: "text", text: TEXT }, { type: "localImage", path: PATH, width: 1920, height: 1080 }] }] }] } } as never);
const empty = () => timelineFromThreadRead({ thread: { id: "thread-s1", turns: [] } } as never);

describe("ledger image send through the timeline", () => {
  it.each([["with clientId", CLIENT], ["copy without clientId (joined by the record's timelineItemId)", undefined]])("keeps the pasted image until the host read lands (%s)", async (_label, clientId) => {
    resetThumbnailCache(); fx.hostFile.mockClear();
    Object.assign(fx.state, { features: new Set(["input-ledger-v1", "fs-file-read"]), inputs: { [key]: ledger([]) }, ledgerOutbox: { [key]: [draft] }, ledgerOwnerDrafts: { [key]: { [CLIENT]: draft } } });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const show = async (timeline: ReturnType<typeof empty>) => {
      await act(async () => root.render(h(TimelineBody, { timeline, entries: orderedEntries(timeline), sessionId: SID, nameOf: (id: string) => id, pendingSends: true })));
      for (let i = 0; i < 4; i++) await act(async () => {});
    };
    const image = () => host.querySelector<HTMLImageElement>('[data-testid="image-thumb"] img')?.getAttribute("src") ?? null;
    const loading = () => [...host.querySelectorAll('[role="status"]')].filter((el) => el.textContent?.includes("image.loading")).length;
    await show(empty());
    expect(image()).toBe(SENT);
    const bubble = host.querySelector("[data-send-bubble]");
    // The agent's copy lands while the draft still exists.
    fx.state.inputs = { [key]: ledger([record(CLIENT, { kind: "owner", state: "inContext", turnId: "t1", timelineItemId: "native-1", surface: "timeline" })]) };
    fx.state.ledgerOutbox = { [key]: [] };
    await show(copy(clientId));
    expect(host.querySelector("[data-send-bubble]")).toBe(bubble);
    expect(loading()).toBe(0);
    expect(image()).toBe(SENT);
    // Draft cleared, host read still out.
    fx.state.ledgerOwnerDrafts = { [key]: {} };
    await show(copy(clientId));
    expect(fx.hostFile).toHaveBeenCalledWith(PATH, expect.any(Number));
    expect(loading()).toBe(0);
    expect(image()).toBe(SENT);
    const box = host.querySelector<HTMLElement>('[data-testid="image-thumb"]')!;
    expect(box.getAttribute("data-image-box")).toBe("reserved");
    expect(box.style.aspectRatio).toBe("1920 / 1080");
    await act(async () => root.unmount()); host.remove();
  });
});
