import { createRoot } from "react-dom/client";
// @vitest-environment jsdom
// Window-first derivation, hidden-history joins and note placement on the real TimelineBody.
import { act, createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  decide: vi.fn(), limit: 50, notes: {} as Record<string, any>, state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {} } as Record<string, unknown>,
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
vi.mock("../src/renderer/src/lib/ownerNotifyStore", async (importOriginal) => ({ ...(await importOriginal<object>()), useHostOwnerNotes: () => fx.notes, safetyCheckAct: fx.decide }));
vi.mock("../src/renderer/src/modules/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSlot: () => [],
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));


vi.mock("../src/renderer/src/lib/prefs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/renderer/src/lib/prefs")>();
  return { ...original, useUiPrefs: () => ({ ...original.useUiPrefs(), timelineTurns: fx.limit }) };
});
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: ({ text }: { text: string }) => h("span", null, text) }));
vi.mock("../src/renderer/src/components/OwnerNotifyCard", async () => {
  const { SafetyBlockCard } = await import("../src/renderer/src/components/SafetyBlockCard");
  return { OwnerNotifyCard: ({ notificationId, hostId }: { notificationId: string; hostId: string }) => {
    const record = fx.notes[notificationId];
    return record?.safetyBlock ? h(SafetyBlockCard, { record, block: record.safetyBlock, hostId }) : h("div", { "data-owner-note": notificationId }, notificationId);
  } };
});
vi.mock("../src/renderer/src/components/OwnerNotificationHistory", () => ({ OwnerNotificationHistory: () => null }));

const { ConversationScope } = await import("../src/renderer/src/lib/conversationScope");
const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { emptyTimeline, orderedEntries } = await import("../src/renderer/src/lib/timeline");
const { record, delivery } = await import("../src/renderer/src/lib/inputLedger/testkit");
const { applyInputLedgerSnapshot, emptyInputLedgerSession } = await import("../src/renderer/src/lib/inputLedger/alignment");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");
const { useFocusRequest } = await import("../src/renderer/src/lib/focusRequest");
const { OWNER_NOTIFY_FEATURE } = await import("../src/shared/ownerNotify");
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  useFocusRequest.setState({ request: null });
  fx.notes = {}; fx.limit = 50;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function fixture(scale: number) {
  const state = emptyTimeline();
  state.turns = Array.from({ length: 327 * scale }, (_, i) => ({ id: `t${i}`, status: "completed", startedAt: null, completedAt: null, entryIds: [] }));
  for (let i = 0; i < 7974 * scale; i++) {
    const turn = state.turns[Math.floor(i * state.turns.length / (7974 * scale))]!;
    const entry = { kind: "agent" as const, id: `i${i}`, turnId: turn.id, text: `reply ${i}`, streaming: false };
    turn.entryIds.push(entry.id); state.entries.set(entry.id, entry);
  }
  return state;
}
function mount(timeline: ReturnType<typeof emptyTimeline>, overrides: Partial<React.ComponentProps<typeof TimelineBody>> = {}, hostId = "local") {
  Object.assign(fx.state, { features: new Set<string>(), inputs: {}, ledgerOutbox: {}, ledgerOwnerDrafts: {}, outbox: {} });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); mounted.push({ root, host });
  let version = 0;
  const nameOf = (id: string) => id;
  return { host, show: async (extra: Partial<React.ComponentProps<typeof TimelineBody>> = {}) => {
    await act(async () => root.render(h(ConversationScope.Provider, { value: { hostId, sessionId: "s1", paneId: "main", focused: true, visible: true } }, h(TimelineBody, { timeline, version: ++version, sessionId: "s1", nameOf, ...overrides, ...extra }))));
  } };
}

describe("native TimelineBody window path", () => {
  it.each([1, 10])("counts actual mounted derivation at %sx audit history", async scale => {
    const timeline = fixture(scale);
    const { host, show } = mount(timeline, { readOnly: true });
    const get = vi.spyOn(timeline.entries, "get");
    await show();
    expect(get).toHaveBeenCalledTimes(1219);
    expect(host.textContent).not.toContain("reply 0");
    get.mockClear();
    await show();
    expect(get).not.toHaveBeenCalled();
    const id = timeline.turns.at(-1)!.entryIds.at(-1)!;
    const previous = Map.prototype.get.call(timeline.entries, id);
    timeline.entries.set(id, { ...previous, text: "changed last reply" });
    get.mockClear();
    await show();
    expect(get).toHaveBeenCalledTimes(24);
    expect(host.textContent).toContain("changed last reply");
    expect(orderedEntries(timeline)).toHaveLength(7974 * scale);
  });

  it("does not resurrect hidden native owner or received inputs at the tail", async () => {
    fx.limit = 2;
    const timeline = fixture(1);
    const turn = timeline.turns[0]!;
    const native = { kind: "user" as const, id: "native-owner", clientId: "owner-client", turnId: turn.id, text: "hidden owner body" };
    turn.entryIds.push(native.id); timeline.entries.set(native.id, native);
    const received = { kind: "received" as const, id: "native-received", turnId: turn.id, message: { senderId: "worker", senderName: "worker", deliveryMode: "note", text: "hidden received", schema: null, data: {}, eventType: "MESSAGE", sourceKind: "agent" } };
    turn.entryIds.push(received.id); timeline.entries.set(received.id, received);
    const { host, show } = mount(timeline, { pendingSends: true });
    const key = viewKey("local", "s1");
    const records = [record("owner-client", { kind: "owner", surface: "timeline", timelineItemId: native.id, turnId: turn.id, preview: "owner ledger preview" }), record("received-client", { kind: "agentMessage", surface: "timeline", timelineItemId: received.id, turnId: turn.id, preview: "received ledger preview" }), record("next", { kind: "owner", surface: "nextUp", preview: "waiting next up" })];
    const ledger = applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: "e", stateRevision: 1, records, delivery: delivery("idle", 1), coverage: { kind: "full" } }).session;
    Object.assign(fx.state, { features: new Set(["input-ledger-v1"]), inputs: { [key]: ledger }, ledgerOutbox: { [key]: [{ inputId: native.clientId, strategy: "auto", predictedSurface: "timeline", text: native.text, extra: [] }] } });
    await show();
    for (const text of [native.text, received.message.text, "owner ledger preview", "received ledger preview", "waiting next up"]) expect(host.textContent).not.toContain(text);
    const button = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("conversation.showEarlier"))!;
    await act(async () => { for (let i = 0; i < 164; i++) button.click(); });
    expect(host.textContent).toContain(native.text);
    expect(host.textContent).toContain(received.message.text);
    expect(host.textContent).not.toContain("owner ledger preview");
  });

  it("places pending notes by visible turn and retains hidden bindings across new turns", async () => {
    fx.limit = 2;
    const timeline = fixture(1);
    timeline.turns.forEach((turn, i) => turn.startedAt = i);
    const { host, show } = mount(timeline);
    Object.assign(fx.state, { features: new Set([OWNER_NOTIFY_FEATURE]) });
    const note = (notificationId: string, turnId: string | null, seconds: number) => ({ notificationId, turnId, agentId: "s1", createdAt: new Date(seconds * 1000).toISOString() });
    fx.notes = { hidden: note("hidden", "t0", 326), visible: note("visible", "t326", 326), fallback: note("fallback", "unknown-turn", 326), ancient: note("ancient", null, -1) };
    await show();
    expect(host.querySelector('[data-owner-note="hidden"]')).toBeNull();
    expect(host.querySelector('[data-owner-note="ancient"]')).toBeNull();
    expect(host.querySelector('[data-owner-note="visible"]')).not.toBeNull();
    expect(host.querySelector('[data-owner-note="fallback"]')).not.toBeNull();
    timeline.turns.push({ id: "new", status: "completed", startedAt: 327, completedAt: 328, entryIds: ["new-item"] });
    timeline.entries.set("new-item", { kind: "agent", id: "new-item", turnId: "new", text: "new", streaming: false });
    await show();
    expect(host.querySelector('[data-owner-note="hidden"]')).toBeNull();
    expect(host.querySelector('[data-owner-note="visible"]')).not.toBeNull();
  });
});

// An actionable notice must remain reachable when its bound turn has no rendered segment.
describe("safety decision focus", () => {
  const safetyNote = (turnId: string | null) => ({ notificationId: "blocked", agentId: "s1", turnId, createdAt: new Date(1000).toISOString(), origin: "system", agentName: "Agent", safetyBlock: { blockId: "sb", state: "blocked", command: "rm -rf $OUT/$run", toolName: "Bash", reason: "empty variable", grantSeconds: 1800 } });
  it("shows the decision in place when a loaded, empty turn has no card anchor", async () => {
    const timeline = fixture(1);
    const empty = { id: "empty", status: "completed" as const, startedAt: null, completedAt: null, entryIds: [] };
    timeline.turns.splice(timeline.turns.length - 1, 0, empty);
    timeline.activeTurnId = timeline.turns.at(-1)!.id;
    timeline.turns.at(-1)!.status = "inProgress";
    const { host, show } = mount(timeline);
    Object.assign(fx.state, { features: new Set([OWNER_NOTIFY_FEATURE]), notify: vi.fn() });
    fx.notes = { blocked: safetyNote("empty") };
    await show();
    expect(host.querySelector('[data-owner-note="blocked"]')).toBeNull();
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(fn => window.setTimeout(() => fn(0), 0));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => window.clearTimeout(id));
    await act(async () => { useFocusRequest.setState({ request: { sessionId: "s1", notificationId: "blocked", nonce: 1 } }); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(host.querySelector('[data-owner-note="blocked"]')).not.toBeNull();
    expect(fx.state.notify).not.toHaveBeenCalled();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("does not page native history to decide a recent unresolvable block on an old host", async () => {
    const timeline = fixture(1); // all native startedAt values are null
    const load = vi.fn();
    const { host, show } = mount(timeline, { older: { cursor: "older", loading: false, error: null, added: 0 }, onLoadOlder: load });
    Object.assign(fx.state, { features: new Set([OWNER_NOTIFY_FEATURE]), notify: vi.fn() });
    fx.notes = { blocked: safetyNote("missing-native-turn") };
    await act(async () => { useFocusRequest.setState({ request: { sessionId: "s1", notificationId: "blocked", nonce: 2 } }); });
    await show();
    expect(host.querySelector('[data-owner-note="blocked"]')).not.toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(fx.state.notify).not.toHaveBeenCalled();
  });

  it.each(["grant", "dismiss"] as const)("%s is reachable on a non-focus old host without notification paging", async decision => {
    const timeline = fixture(1);
    const { host, show } = mount(timeline, { older: { cursor: "older", loading: false, error: null, added: 0 }, onLoadOlder: vi.fn() }, "remote");
    Object.assign(fx.state, { byHost: { remote: { features: new Set([OWNER_NOTIFY_FEATURE]), sidebar: null } }, notify: vi.fn() });
    fx.notes = { blocked: safetyNote("missing-native-turn") };
    fx.decide.mockReset(); fx.decide.mockResolvedValue({ ok: true });
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    Element.prototype.scrollIntoView = vi.fn();
    await act(async () => { useFocusRequest.setState({ request: { sessionId: "s1", hostId: "remote", notificationId: "blocked", nonce: 4 } }); });
    await show();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-owner-note="blocked"] button')];
    const button = buttons.find(el => el.textContent === `safetyBlock.${decision}`)!;
    expect(button).toBeDefined();
    await act(async () => button.click());
    expect(fx.decide).toHaveBeenCalledWith(fx.notes.blocked, decision, "remote");
    expect(host.querySelectorAll('[data-owner-note="blocked"]')).toHaveLength(1);
  });

  it("leaves a different host's same-session request for the correct pane", async () => {
    const timeline = fixture(1);
    const { show } = mount(timeline);
    Object.assign(fx.state, { notify: vi.fn() });
    const request = { sessionId: "s1", hostId: "remote", notificationId: "blocked", nonce: 3 };
    await act(async () => { useFocusRequest.setState({ request }); });
    await show();
    expect(useFocusRequest.getState().request).toBe(request);
    expect(fx.state.notify).not.toHaveBeenCalled();
  });
});
