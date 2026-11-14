import { createRoot } from "react-dom/client";
// @vitest-environment jsdom
// Owner report 2026-10-24: after a send, the user bubble showed a status line under it (发送中… / 已送达 · 等待记录 /
// 发送失败); when the recorded message replaced it the row grew (the status line was h-6, the action row that took its
// place h-7) and the bubble jumped. Now the status is laid over one slot of one height (h-7) that the row keeps from
// the send to the recorded message (components/Timeline Entry, components/PendingSends). Measured in the mock preview
// (row 67 → 71 px before, 71 px throughout after): .claude/previews/send-status/.
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
describe("ledger bubble handoff", () => {
  it("keeps bound old delegation, tell and Task rows behind history paging, then joins each native row once", async () => {
    const { root, show, host } = setup();
    const kinds = ["delegationRequest", "agentMessage", "systemNotice"] as const;
    const start = Date.parse("2026-11-03T03:00:00Z");
    const records = kinds.map((kind, index) => record(`old-${index}`, {
      kind, state: "inContext", turnId: "older-turn", timelineItemId: `native-old-${index}`,
      since: new Date(start - 10000).toISOString(), preview: `old ledger preview ${index}`,
    }));
    fx.state.ledgerOutbox = {};
    fx.state.ledgerOwnerDrafts = {};
    fx.state.inputs = { [key]: ledger(records) };
    const timeline = native();
    timeline.turns[0]!.startedAt = start / 1000;
    await show(timeline, false, { cursor: "older-page", loading: false, error: null, added: 0 });
    for (const record of records) expect(host.textContent).not.toContain(record.preview);
    expect(host.querySelectorAll('[data-testid="input-status"]')).toHaveLength(0);
    expect(host.textContent).toContain(TEXT);
    const oldPage = { thread: { id: "thread-s1", turns: [{ id: "older-turn", status: "completed", startedAt: (start - 20000) / 1000, items: records.map((record, index) => ({
      type: "functionCallOutput", id: record.timelineItemId, name: "external_event", namespace: "external",
      output: JSON.stringify({ source: { kind: "agent", id: "worker" }, type: "agent_message", text: `native old body ${index}` }),
    })) }] } };
    expect(prependHistory(timeline, oldPage)).toBe(1);
    await show(timeline);
    for (const [index, record] of records.entries()) {
      expect(host.textContent).not.toContain(record.preview);
      expect(host.textContent?.split(`native old body ${index}`)).toHaveLength(2);
      expect(host.querySelectorAll(`[data-testid="input-status"][data-input-id="${record.inputId}"]`)).toHaveLength(1);
    }
    expect((fx.state.inputs as Record<string, { records: Map<string, unknown> }>)[key]!.records.size).toBe(3);
    await act(async () => root.unmount()); host.remove();
  });

  it("keeps the DOM bubble through O0, ledger and native without a clientId", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const { root, show, host } = setup();
    const bubble = await show(); expect(bubble).toBeTruthy();
    fx.state.ledgerOutbox = {};
    fx.state.inputs = { [key]: ledger([record(CLIENT, { preview: TEXT, timelineItemId: "native-1", state: "accepted" })]) };
    expect(await show()).toBe(bubble);
    expect(await show(native())).toBe(bubble);
    expect(host.querySelectorAll("[data-send-bubble]")).toHaveLength(1);
    await act(async () => root.unmount()); host.remove();
  });
  it("native echo before ledger deduplicates O0 without changing delivery state", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const { root, show, host } = setup();
    const bubble = await show();
    expect(await show(native(CLIENT))).toBe(bubble);
    expect(host.querySelectorAll("[data-send-bubble]")).toHaveLength(1);
    expect((fx.state.ledgerOutbox as any)[key]).toHaveLength(1);
    expect(host.querySelector('[data-testid="ledger-outbox-status"]')).toBeTruthy();
    await act(async () => root.unmount()); host.remove();
  });
  it("one native batch renders once and keeps the status of every linked input", async () => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = {};
    fx.state.inputs = { [key]: ledger([
      record("result-a", { kind: "delegationResult", preview: "preview-a", timelineItemId: "native-1", batchId: "batch", state: "accepted" }),
      record("result-b", { kind: "delegationResult", preview: "preview-b", timelineItemId: "native-1", batchId: "batch", state: "uncertain", reason: "outcomeUnknown", actions: ["retry", "dismiss"] }),
    ]) };
    const timeline = native();
    timeline.entries.set("native-1", { kind: "received", id: "native-1", turnId: "t1", message: { senderName: "Sender", senderId: "sender", sourceKind: "agent", deliveryMode: "after_turn", text: "Full batch body", envelope: null } } as never);
    await show(timeline);
    expect(host.textContent?.split("Full batch body")).toHaveLength(2);
    expect(host.textContent).not.toContain("preview-a");
    expect(host.textContent).not.toContain("preview-b");
    expect([...host.querySelectorAll<HTMLElement>('[data-testid="input-status"]')].map(node => node.dataset.inputId)).toEqual(["result-a", "result-b"]);
    expect(host.querySelector('[data-effect="retry"]')).not.toBeNull();
    await act(async () => root.unmount()); host.remove();
  });
  it.each(["uncertain", "inContext"] as const)("read-only %s history exposes no mutation actions", async state => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = {};
    fx.state.inputs = { [key]: ledger([record(CLIENT, { preview: TEXT, timelineItemId: "native-1", state, reason: state === "uncertain" ? "outcomeUnknown" : null, evidence: state === "inContext" ? "clientIdEcho" : null, actions: state === "uncertain" ? ["retry", "dismiss"] : [] })]) };
    await show(native(CLIENT), true);
    expect(!!host.querySelector('[data-testid="input-status"]')).toBe(state === "uncertain");
    expect(host.querySelector('[data-user-bar]')).toBeNull();
    expect(host.textContent).not.toContain("inputLedger.retry");
    expect(host.textContent).not.toContain("inputLedger.dismiss");
    await act(async () => root.unmount()); host.remove();
  });
  it("read-only O0 keeps its transport status without retry or discard buttons", async () => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = { [key]: [{ ...o0, phase: "unconfirmed" }] };
    await show(undefined, true);
    expect(host.querySelector('[data-testid="ledger-outbox-status"]')).toBeTruthy();
    expect(host.textContent).not.toContain("inputLedger.retry");
    expect(host.textContent).not.toContain("inputLedger.dismiss");
    await act(async () => root.unmount()); host.remove();
  });
});


describe("057 carried inputs", () => {
  it("hydrates both endpoints before dedup and keeps bodies outside owner text", async () => {
    const { root, show, host } = setup();
    const owner = record(CLIENT, { kind: "owner", turnId: "t1", timelineItemId: "native-1", carries: ["notice", "result"], state: "inContext" });
    const notice = record("notice", { kind: "systemNotice", turnId: "t1", timelineItemId: "received-1", reason: "carriedByOwner", state: "inContext", preview: "notice preview" });
    const result = record("result", { kind: "delegationResult", turnId: "t1", reason: "carriedByOwner", state: "accepted", preview: "result body" });
    const timeline = native(CLIENT);
    const received = { kind: "received", id: "received-1", turnId: "t1", message: { text: "native notice body", senderId: "worker", senderName: "Worker", sourceKind: "agent", deliveryMode: "wake" } } as any;
    timeline.entries.set(received.id, received); timeline.turns[0]!.entryIds.push(received.id);
    fx.state.features = new Set(["input-ledger-v1", "owner-carries-v1"]);
    fx.state.inputs = { [key]: ledger([notice, result]) };
    await show(timeline);
    expect(host.querySelectorAll("[data-carried-input-id]")).toHaveLength(0);
    expect(host.textContent).toContain("native notice body"); expect(host.textContent).toContain("result body");
    fx.state.inputs = { [key]: ledger([owner, notice, result]) };
    await show(timeline);
    expect(host.querySelectorAll("[data-carried-input-id]")).toHaveLength(2);
    expect(host.querySelector('[data-testid="owner-carried-inputs"]')).toBeNull();
    // 已接收 / 已进入上下文 draw nothing on the timeline; the preview-only record still shows.
    for (const id of ["notice", "result"]) expect(host.querySelector(`[data-testid="input-status"][data-input-id="${id}"]`)?.className).toBe("sr-only");
    expect(host.querySelector('[data-carried-input-id="result"]')?.textContent).toContain("result body");
    expect(host.querySelector("[data-send-bubble]")?.textContent).toBe(TEXT);
    expect(host.textContent?.split("native notice body")).toHaveLength(2);
    expect(host.textContent?.split("result body")).toHaveLength(2);
    expect(host.textContent).not.toContain("notice preview");
    fx.state.inputs = { [key]: ledger([{ ...owner, carries: [] }, notice, result]) };
    await show(timeline);
    expect(host.querySelectorAll("[data-carried-input-id]")).toHaveLength(0);
    expect(host.textContent).toContain("native notice body");
    await act(async () => root.unmount()); host.remove();
  });
  it.each([{ features: ["input-ledger-v1"] }, { features: ["owner-carries-v1"] }, { features: [] }])("requires both capabilities %j", async ({ features }) => {
    const { root, show, host } = setup();
    fx.state.features = new Set(features);
    fx.state.inputs = { [key]: ledger([
      record(CLIENT, { kind: "owner", turnId: "t1", timelineItemId: "native-1", carries: ["notice"] }),
      record("notice", { kind: "systemNotice", turnId: "t1", reason: "carriedByOwner", preview: "standalone notice" }),
    ]) };
    await show(native(CLIENT));
    expect(host.querySelectorAll("[data-carried-input-id]")).toHaveLength(0);
    if (features.includes("input-ledger-v1")) expect(host.textContent).toContain("standalone notice");
    await act(async () => root.unmount()); host.remove();
  });
  it("owner 2026-11-10: a message whose turn was interrupted before its first item sits inline at that turn with a note and its send time, not at the bottom", async () => {
    const { root, show, host } = setup();
    fx.state.ledgerOutbox = {}; fx.state.ledgerOwnerDrafts = {};
    const start = Date.parse("2026-11-10T15:10:00Z") / 1000;
    const zaima = record("zaima", { state: "inContext", turnId: "t-int", preview: "在吗", createdAt: "2026-11-10T15:12:15.000Z", since: "2026-11-10T15:12:16.000Z" });
    const queued = record("queued", { state: "waiting", reason: "hostBusy", preview: "still waiting", createdAt: "2026-11-10T15:13:00.000Z" });
    fx.state.inputs = { [key]: ledger([zaima, queued]) };
    const timeline = timelineFromThreadRead({ thread: { id: "thread-s1", turns: [
      { id: "t-a", status: "completed", startedAt: start, items: [{ type: "userMessage", id: "u-a", content: [{ type: "text", text: "first" }] }, { type: "agentMessage", id: "a-a", text: "reply one" }] },
      { id: "t-int", status: "interrupted", startedAt: start + 135, items: [] },
      { id: "t-b", status: "completed", startedAt: start + 165, items: [{ type: "userMessage", id: "u-b", content: [{ type: "text", text: "你不需要继续之前的工作了，先idle" }] }, { type: "agentMessage", id: "a-b", text: "ok idle" }] },
    ] } } as never);
    await show(timeline);
    const rows = [...host.querySelectorAll("[data-tl-row]")];
    const at = (needle: string) => rows.findIndex(row => row.textContent?.includes(needle));
    expect(at("在吗")).toBeGreaterThan(at("reply one"));
    expect(at("在吗")).toBeLessThan(at("先idle"));
    const note = host.querySelector('[data-missing-input="zaima"] [data-stranded-note]');
    expect(note?.getAttribute("data-stranded-note")).toBe("inputLedger.stranded.interrupted");
    expect(note?.textContent).toMatch(/[0-9]{2}:[0-9]{2}/);
    expect(note?.getAttribute("title")).toMatch(/2026-11-1[01] [0-9]{2}:12:15/);
    // A record still waiting stays at the bottom, after everything.
    expect(at("still waiting")).toBe(rows.length - 1);
    await act(async () => root.unmount());
  });
});
