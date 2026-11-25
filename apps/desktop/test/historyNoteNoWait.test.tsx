// @vitest-environment jsdom
// Owner 2026-11-23 (delegation-347359): history shows only what happened; waiting and its actions belong to 接下来.
import { createRoot } from "react-dom/client";
import { act, createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {} } as Record<string, unknown>,
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

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { newOutboxEntry } = await import("../src/renderer/src/lib/legacyDelivery/outbox");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");


const { record, delivery } = await import("../src/renderer/src/lib/inputLedger/testkit");
const { applyInputLedgerSnapshot, emptyInputLedgerSession } = await import("../src/renderer/src/lib/inputLedger/alignment");
const { prependHistory } = await import("../src/renderer/src/lib/historyPages");
const SID = "s1", CLIENT = "owner-1", TEXT = "keep this bubble";
const key = viewKey("local", SID);
const o0 = { inputId: CLIENT, sessionId: SID, hostId: "local", text: TEXT, extra: [], strategy: "auto", createdAt: new Date().toISOString(), phase: "sending" };
function ledger(records: any[]) { return applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: "e", stateRevision: 1, records, delivery: delivery("idle", 1), coverage: { kind: "full" } }).session; }
function native(clientId?: string) {
  return timelineFromThreadRead({ thread: { id: "thread-s1", turns: [{ id: "t1", status: "inProgress", items: [{ type: "userMessage", id: "native-1", ...(clientId ? { clientId } : {}), content: [{ type: "text", text: TEXT }] }] }] } } as never);
}
function setup() {
  Object.assign(fx.state, { features: new Set(["input-ledger-v1"]), inputs: { [key]: ledger([]) }, ledgerOutbox: { [key]: [o0] }, ledgerOwnerDrafts: { [key]: { [CLIENT]: o0 } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const show = async (timeline = timelineFromThreadRead({ thread: { id: "thread-s1", turns: [] } } as never), readOnly = false, older: React.ComponentProps<typeof TimelineBody>["older"] = null) => {
    await act(async () => root.render(h(TimelineBody, { timeline, entries: orderedEntries(timeline), sessionId: SID, nameOf: (id: string) => id, pendingSends: true, readOnly, older, onLoadOlder: () => {} })));
    return [...host.querySelectorAll("[data-send-bubble]")].find(element => element.textContent === TEXT);
  };
  return { host, root, show };
}

const { InputStatus } = await import("../src/renderer/src/components/InputStatus");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// The receipt of a note the turn carried can come after its body is in history (Claude confirms at the end of the
// turn); the old record was already stalled, so the history row showed 「已等 N 分钟」 + 放弃.
const STALE = new Date(Date.now() - 174 * 60000).toISOString();
const waitingNote = (id: string, patch: Record<string, unknown> = {}) => record(id, { kind: "agentMessage", turnId: "t1", state: "accepted", since: STALE, stalled: { reason: "noProgress", since: STALE }, actions: ["dismiss", "retry"], ...patch });
const receivedEntry = (id: string, text: string) => ({ kind: "received", id, turnId: "t1", message: { text, senderId: "worker", senderName: "Worker", sourceKind: "agent", deliveryMode: "passive" } }) as any;
const noWaitUi = (host: HTMLElement, id: string) => {
  const status = host.querySelector<HTMLElement>(`[data-testid="input-status"][data-input-id="${id}"]`);
  expect(status?.className).toBe("sr-only");
  expect(host.querySelector('[data-testid="next-up-stalled"]')).toBeNull();
  expect(host.querySelector('[data-testid="next-up-label"]')).toBeNull();
  expect(host.querySelector("[data-effect]")).toBeNull();
  return status!;
};

describe("delegation-347359: a note whose body is in history carries no waiting timer or action", () => {
  it("received row: before the receipt nothing but the body; the record stays what the host says (no invented inContext)", async () => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = {}; fx.state.ledgerOwnerDrafts = {};
    fx.state.inputs = { [key]: ledger([waitingNote("note-1", { timelineItemId: "received-1" })]) };
    const timeline = native();
    timeline.entries.set("received-1", receivedEntry("received-1", "note body in history")); timeline.turns[0]!.entryIds.push("received-1");
    await show(timeline);
    expect(host.textContent?.split("note body in history")).toHaveLength(2);
    expect(noWaitUi(host, "note-1").dataset.state).toBe("accepted");
    // The receipt arrives: still nothing.
    fx.state.inputs = { [key]: ledger([waitingNote("note-1", { timelineItemId: "received-1", state: "inContext", evidence: "contextPersisted", stalled: null, actions: [] })]) };
    await show(timeline);
    expect(noWaitUi(host, "note-1").dataset.state).toBe("inContext");
    await act(async () => root.unmount()); host.remove();
  });
  it("carried rows (the owner's message took them along): no 已等 / 放弃 while the receipt is pending, nor after it", async () => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = {}; fx.state.ledgerOwnerDrafts = {};
    fx.state.features = new Set(["input-ledger-v1", "owner-carries-v1"]);
    const owner = record(CLIENT, { kind: "owner", turnId: "t1", timelineItemId: "native-1", carries: ["note-a", "note-b"], state: "inContext" });
    const a = waitingNote("note-a", { timelineItemId: "received-a", reason: "carriedByOwner" });
    const b = waitingNote("note-b", { reason: "carriedByOwner", preview: "preview-only carried note" });
    const timeline = native(CLIENT);
    timeline.entries.set("received-a", receivedEntry("received-a", "carried body a")); timeline.turns[0]!.entryIds.push("received-a");
    fx.state.inputs = { [key]: ledger([owner, a, b]) };
    await show(timeline);
    expect(host.querySelectorAll("[data-carried-input-id]")).toHaveLength(2);
    // note-a has its native body: history, no wait UI. note-b is preview-only (a placeholder, no native item): it keeps
    // its timeline status and actions, which nothing else offers (delegation-a1f0f9).
    const a0 = host.querySelector<HTMLElement>('[data-testid="input-status"][data-input-id="note-a"]')!;
    expect(a0.className).toBe("sr-only");
    const b0 = host.querySelector<HTMLElement>('[data-carried-input-id="note-b"] [data-testid="input-status"][data-input-id="note-b"]')!;
    expect(b0.className).not.toBe("sr-only");
    expect(b0.querySelector('[data-testid="next-up-stalled"]')).not.toBeNull();
    expect(b0.querySelector("[data-effect]")).not.toBeNull();
    expect(host.querySelector('[data-carried-input-id="received-a"] [data-effect], [data-input-id="note-a"] [data-effect]')).toBeNull();
    expect(host.textContent).toContain("carried body a");
    fx.state.inputs = { [key]: ledger([owner, { ...a, state: "inContext", evidence: "contextPersisted", stalled: null, actions: [] }, { ...b, state: "inContext", evidence: "contextPersisted", stalled: null, actions: [] }]) };
    await show(timeline);
    noWaitUi(host, "note-a"); noWaitUi(host, "note-b");
    await act(async () => root.unmount()); host.remove();
  });
  it("a past outcome in history keeps its word and hover lines, but no timer or action", async () => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = {}; fx.state.ledgerOwnerDrafts = {};
    fx.state.inputs = { [key]: ledger([waitingNote("note-u", { timelineItemId: "received-u", state: "uncertain", reason: "outcomeUnknown" })]) };
    const timeline = native();
    timeline.entries.set("received-u", receivedEntry("received-u", "unconfirmed body")); timeline.turns[0]!.entryIds.push("received-u");
    await show(timeline);
    expect(host.querySelector('[data-input-id="note-u"][data-next-up-state="unconfirmed"] [data-testid="next-up-label"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="next-up-stalled"]')).toBeNull();
    expect(host.querySelector("[data-effect]")).toBeNull();
    await act(async () => root.unmount()); host.remove();
  });
  it("a note still waiting in 接下来 / 待读留言 keeps its state, timer and actions there", async () => {
    setup();
    fx.state.features = new Set(["input-ledger-v1"]);
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const waiting = waitingNote("note-w", { surface: "pendingNotes", turnId: null });
    fx.state.inputs = { [key]: ledger([waiting]) };
    await act(async () => root.render(h(InputStatus, { record: waiting, sessionId: SID, hostId: "local" })));
    expect(host.querySelector('[data-next-up-state="passiveNote"] [data-testid="next-up-label"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="next-up-stalled"]')?.textContent).toContain("174");
    expect(host.querySelector("[data-effect]")).not.toBeNull();
    // The same record drawn as a history row: none of it.
    await act(async () => root.render(h(InputStatus, { record: waiting, sessionId: SID, hostId: "local", timeline: true, history: true })));
    noWaitUi(host, "note-w");
    await act(async () => root.unmount()); host.remove();
  });
});
