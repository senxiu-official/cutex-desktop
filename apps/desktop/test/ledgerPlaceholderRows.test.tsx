// @vitest-environment jsdom
// Owner report 2026-11-13: a delegation result (or agent message) first showed as a bare sender line + preview line,
// then turned into its proper row (↩ 收到 [avatar] X 的结果 · #id title preview); switching to an agent while its history
// loaded filled the screen with such lines. A ledger record without its native item is now drawn by the same received
// renderers as that item (lib/inputLedger/placeholder), and settled records wait for the history (inputLedger/owner).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {} } as Record<string, unknown>,
  received: [] as unknown[],
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
  useSlot: (slot: string) => (slot === "timeline.received" ? fx.received : []),
  useModuleEnabled: () => false,
  usePlacement: () => () => "show",
}));
vi.mock("../src/renderer/src/lib/foldView", () => ({ useMessageFold: () => ({ overflowing: false, canFold: false, folded: false, setFolded: () => {} }) }));
vi.mock("../src/renderer/src/components/Foldable", () => ({ Foldable: ({ children }: { children: unknown }) => children }));

const { TimelineBody } = await import("../src/renderer/src/components/Timeline");
const { orderedEntries, timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");
const { record, delivery } = await import("../src/renderer/src/lib/inputLedger/testkit");
const { applyInputLedgerSnapshot, emptyInputLedgerSession } = await import("../src/renderer/src/lib/inputLedger/alignment");
const { AskReceivedRow, ResultsReceivedRow } = await import("../src/renderer/src/modules/conversation/TimelineRows");
const { placeholderMessage } = await import("../src/renderer/src/lib/inputLedger/placeholder");
const { delegationAskRow, delegationResultItems } = await import("../src/renderer/src/lib/delegations");
const { useDelegations } = await import("../src/renderer/src/lib/delegationStore");
const { hostKey } = await import("../src/renderer/src/lib/hostKeys");

const SID = "s1";
const key = viewKey("local", SID);
const ASK = "ask-9f3a1c0b";
const HELPER = "cutex.helper-1";
const LEAD = "cutex.lead-1";
fx.received = [
  { mode: "show", moduleId: "conversation", missing: [], waiting: false, item: { id: "conversation.delegationAsk", order: 200, schemas: ["cutex.delegation-ask.v1"], Row: AskReceivedRow } },
  { mode: "show", moduleId: "conversation", missing: [], waiting: false, item: { id: "conversation.delegationResults", order: 300, schemas: ["cutex.delegation-results.v1"], Row: ResultsReceivedRow } },
];

function ledger(records: unknown[]) {
  return applyInputLedgerSnapshot(emptyInputLedgerSession(), { ledgerEpoch: "e", stateRevision: 1, records: records as never, delivery: delivery("idle", 1), coverage: { kind: "full" } }).session;
}
const thread = (items: unknown[]) => timelineFromThreadRead({ thread: { id: "thread-s1", turns: items.length ? [{ id: "t1", status: "completed", startedAt: 1_700_000_000, items }] : [] } } as never);
const externalEvent = (id: string, source: { kind: string; id: string }, type: string, text: string, view: unknown) =>
  ({ type: "functionCallOutput", id, name: "external_event", namespace: "external", output: JSON.stringify({ source, type, text }), externalInputView: view });

const mounted: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const unmount of mounted.splice(0)) await unmount();
  useDelegations.setState({ byKey: {} });
});

async function render(records: unknown[], items: unknown[] = [], loading = false) {
  Object.assign(fx.state, { features: new Set(["input-ledger-v1"]), inputs: { [key]: ledger(records) }, ledgerOutbox: {}, ledgerOwnerDrafts: {}, sessions: { [key]: { loading, timeline: { activeTurnId: null } } } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const timeline = thread(items);
  await act(async () => root.render(h(TimelineBody, { timeline, entries: orderedEntries(timeline), sessionId: SID, nameOf: (id: string) => id, pendingSends: true })));
  mounted.push(async () => { await act(async () => root.unmount()); host.remove(); });
  return host;
}

/** The row's first line (the button the native renderer draws), as markup: same markup = same shape and text. */
const rowLine = (host: HTMLElement, selector: string) => host.querySelector(selector)?.closest("button")?.outerHTML ?? null;

function seedAsk() {
  useDelegations.setState({ byKey: { [hostKey("local", ASK)]: { askId: ASK, title: "Fix the flaky test", requester: { kind: "agent", cutexSessionId: LEAD, name: "Lead" }, target: HELPER, targetName: "Helper", attempt: { n: 2 } } as never } });
}

describe("ledger placeholder rows", () => {
  it("a delegation result not read in yet is the native 收到…的结果 row: same name, #id and title", async () => {
    seedAsk();
    // cutex names the result's sender by the target's session id (r4 captured trace s18): the old row showed that id.
    const sender = { kind: "agent", id: HELPER, name: HELPER, host: null, cutexSessionId: HELPER } as const;
    const pending = record("res-1", { kind: "delegationResult", askId: ASK, sender, preview: "Fixed: the race was in queue flush.", state: "accepted", turnId: "t2" });
    const placeholder = await render([pending]);
    const row = placeholder.querySelector('[data-ledger-placeholder="delegationResult"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain("Helper");
    expect(row!.textContent).not.toContain(HELPER);
    expect(row!.textContent).toContain("Fix the flaky test");
    expect(row!.querySelector("[data-delegation-tag]")).not.toBeNull();

    const native = await render([{ ...pending, state: "inContext", timelineItemId: "cutex-ask-event-1", turnId: "t1" }], [
      externalEvent("cutex-ask-event-1", { kind: "service", id: "cutex-asks" }, "ANSWER", "[delegation results]\n\n### Fix the flaky test (answer)\n\nFixed: the race was in queue flush.", {
        schema: "cutex.delegation-results.v1",
        data: { items: [{ kind: "answer", askId: ASK, title: "Fix the flaky test", target: { id: HELPER, name: "Helper" }, preview: "Fixed: the race was in queue flush." }] },
      }),
    ]);
    expect(native.querySelector("[data-ledger-placeholder]")).toBeNull();
    expect(rowLine(placeholder, "[data-ledger-placeholder] [data-delegation-tag]")).toBe(rowLine(native, "[data-delegation-tag]"));
  });

  it("an unknown delegation still draws the result row with its peer from the record", async () => {
    const sender = { kind: "agent", id: HELPER, name: "Helper", host: null, cutexSessionId: HELPER } as const;
    const host = await render([record("res-2", { kind: "delegationResult", askId: ASK, sender, preview: "done", state: "accepted" })]);
    const row = host.querySelector('[data-ledger-placeholder="delegationResult"]')!;
    expect(row.textContent).toContain("Helper");
    expect(row.querySelector("[data-delegation-tag]")).not.toBeNull();
    expect(row.textContent).toContain("done");
  });

  it("a delegation request not read in yet is the native 来自…的委托 row", async () => {
    seedAsk();
    const sender = { kind: "agent", id: LEAD, name: "Lead", host: null, cutexSessionId: LEAD } as const;
    const pending = record(ASK, { kind: "delegationRequest", askId: ASK, sender, preview: "Fix the flaky test", state: "accepted" });
    const placeholder = await render([pending]);
    expect(placeholder.querySelector('[data-ledger-placeholder="delegationRequest"] [data-ask-row]')).not.toBeNull();
    const native = await render([{ ...pending, state: "inContext", timelineItemId: "cutex-ask-msg-1", turnId: "t1" }], [
      externalEvent("cutex-ask-msg-1", { kind: "agent", id: LEAD }, "ASK", `[delegation ${ASK} · attempt 2] from Lead\n\nbrief`, {
        schema: "cutex.delegation-ask.v1",
        data: { askId: ASK, attempt: 2, requester: { kind: "agent", cutexSessionId: LEAD, name: "Lead" }, title: "Fix the flaky test", gated: false },
      }),
    ]);
    expect(rowLine(placeholder, "[data-ledger-placeholder] [data-delegation-tag]")).toBe(rowLine(native, "[data-delegation-tag]"));
    expect(rowLine(native, "[data-delegation-tag]")).toContain("Fix the flaky test");
  });

  it("an uncached delegation from a paired host keeps its requester a peer: no local agent, no local jump", async () => {
    // Review 2026-11-13: the remote session id must never become a local agent (wrong-agent navigation on a collision).
    const sender = { kind: "peer", id: LEAD, name: "Lead", host: "host-b", cutexSessionId: LEAD } as const;
    const message = placeholderMessage(record(ASK, { kind: "delegationRequest", askId: ASK, sender, preview: "Fix the flaky test", state: "accepted" }));
    const row = delegationAskRow(message)!;
    expect(row.requesterId).toBeNull();
    expect(row.peerLabel).toBe("host-b");
    expect(row.title).toBe("Fix the flaky test");
    const result = delegationResultItems(placeholderMessage(record("res-p", { kind: "delegationResult", askId: ASK, sender, preview: "done", state: "accepted" })));
    expect(result[0]).toMatchObject({ targetId: null, targetName: "Lead" });
    const host = await render([record(ASK, { kind: "delegationRequest", askId: ASK, sender, preview: "Fix the flaky test", state: "accepted" })]);
    const shown = host.querySelector('[data-ledger-placeholder="delegationRequest"]')!;
    expect(shown.textContent).toContain("host-b");
    expect(shown.textContent).toContain("Fix the flaky test");
  });

  it("an agent message not read in yet is the native 来自 bus row: same name and preview", async () => {
    const sender = { kind: "agent", id: "cutex.worker-1", name: "Worker", host: null, cutexSessionId: "cutex.worker-1" } as const;
    const pending = record("msg-1", { kind: "agentMessage", sender, preview: "build is green", intent: { strategy: null, deliveryMode: "after_turn", timing: "afterTurn" }, state: "accepted" });
    const placeholder = await render([pending]);
    const row = placeholder.querySelector('[data-ledger-placeholder="agentMessage"]')!;
    expect(row.querySelector('[data-testid="bus-message-name"]')?.textContent).toBe("Worker");
    expect(row.querySelector('[data-testid="bus-message-preview"]')?.textContent).toBe("build is green");
    // Its status still shows under it.
    expect(row.querySelector('[data-testid="input-status"][data-input-id="msg-1"]')).not.toBeNull();
    const native = await render([{ ...pending, state: "inContext", timelineItemId: "msg-1", turnId: "t1" }], [
      externalEvent("msg-1", { kind: "agent", id: "cutex.worker-1" }, "MESSAGE", "build is green", { schema: "cutex.agent-message.v1", data: { senderId: "cutex.worker-1", senderName: "Worker", deliveryMode: "after_turn" } }),
    ]);
    expect(rowLine(placeholder, '[data-ledger-placeholder] [data-testid="bus-message-name"]')).toBe(rowLine(native, '[data-testid="bus-message-name"]'));
  });

  it("while the history loads, records already read in wait for it; ones still on their way show", async () => {
    const sender = { kind: "agent", id: "cutex.worker-1", name: "Worker", host: null, cutexSessionId: "cutex.worker-1" } as const;
    const read = record("old", { kind: "agentMessage", sender, preview: "old message", state: "inContext", timelineItemId: "old", turnId: "t0" });
    const coming = record("new", { kind: "agentMessage", sender, preview: "new message", state: "accepted" });
    const loading = await render([read, coming], [], true);
    expect(loading.textContent).not.toContain("old message");
    expect(loading.textContent).toContain("new message");
    const loaded = await render([read, coming], [], false);
    expect(loaded.textContent).toContain("old message");
  });
});
