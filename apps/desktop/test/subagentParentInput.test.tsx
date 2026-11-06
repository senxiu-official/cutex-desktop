// @vitest-environment jsdom
// Report 2026-11-06 (claude-job-study §1): a sub-agent card showed the parent conversation's message,
// cut to its first 80 characters, under the child's running tool row. The card renders the child
// thread with the parent's sessionId, and TimelineBody projected that session's input ledger into it:
// the parent's records are not in the child thread, so they were added as "missing" rows from their
// 80-character preview, and the live line followed the parent's delivery turn. Fixed with
// TimelineBody's explicit `thread="subagent"` scope.
import { createRoot } from "react-dom/client";
import { act, createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {}, subTimelines: {} } as Record<string, unknown>,
  read: null as unknown,
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
  sessionApi: () => ({ subAgentThread: () => new Promise(() => {}) }),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/modules/subagents/threadState", () => ({ useBoundSubAgents: () => new Map() }));
vi.mock("../src/renderer/src/lib/background", async (importOriginal) => ({ ...(await importOriginal<object>()), useAgentRuntimeGeneration: () => 1 }));
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
const { SubagentThreadBody } = await import("../src/renderer/src/modules/subagents/SubagentThread");
const { timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
const { viewKey } = await import("../src/renderer/src/lib/viewKey");
const { record, delivery } = await import("../src/renderer/src/lib/inputLedger/testkit");
const { applyInputLedgerSnapshot, emptyInputLedgerSession } = await import("../src/renderer/src/lib/inputLedger/alignment");

const SID = "s1";
const key = viewKey("local", SID);
const PARENT_TEXT = "请把图 3 的置信带重新画一遍，用 bootstrap 2000 次，画完以后把新图和旧图并排放进报告的附录里，再告诉我差异最大的那几个点在哪里。";
const PREVIEW = [...PARENT_TEXT].slice(0, 80).join("");
const SEND = "parent send not delivered yet";

const CHILDREN = {
  codex: { id: "019a-child", read: { thread: { id: "019a-child", agentNickname: "Laplace", turns: [{ id: "ct1", status: "inProgress", items: [
    { type: "userMessage", id: "cu1", content: [{ type: "text", text: "child task text" }] },
    { type: "commandExecution", id: "cc1", command: "Rscript fig3.R", status: "inProgress", aggregatedOutput: "" },
  ] }] } } },
  claude: { id: "claude:sora:task:t1", read: { thread: { id: "claude:sora:task:t1", parentThreadId: "thread-s1", agentNickname: "核对文档", turns: [{ id: "subagent:toolu_1", status: "inProgress", items: [
    { type: "userMessage", id: "cu1", content: [{ type: "text", text: "child task text" }] },
    { type: "commandExecution", id: "cc1", command: "Read docs/DESKTOP_PARITY.md", status: "inProgress", aggregatedOutput: "" },
  ] }] } } },
};

function parentLedger() {
  // The parent's owner message, in context of the parent's running turn; only its 80-character preview is local.
  const owner = record("owner-1", { kind: "owner", preview: PREVIEW, state: "inContext", turnId: "pt1", timelineItemId: "parent-u1" });
  const notice = record("notice-1", { kind: "systemNotice", preview: "parent notice preview", state: "received" });
  return applyInputLedgerSnapshot(emptyInputLedgerSession(), {
    ledgerEpoch: "e", stateRevision: 1, records: [owner, notice],
    delivery: delivery("turn", 1, { turn: { turnId: "pt1" } as never }), coverage: { kind: "full" },
  }).session;
}

function mount() {
  const o0 = { inputId: "send-1", sessionId: SID, hostId: "local", text: SEND, extra: [], strategy: "auto", createdAt: new Date().toISOString(), phase: "sending" };
  Object.assign(fx.state, {
    features: new Set(["input-ledger-v1", "owner-notify"]),
    inputs: { [key]: parentLedger() },
    ledgerOutbox: { [key]: [o0] },
    ledgerOwnerDrafts: {},
  });
  const host = document.createElement("div"); document.body.append(host);
  return { host, root: createRoot(host) };
}

describe("sub-agent card does not show the parent's inputs", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  it.each(Object.entries(CHILDREN))("%s sub-agent card", async (_shape, child) => {
    const { host, root } = mount();
    fx.state.subTimelines = { [child.id]: { timeline: timelineFromThreadRead(child.read as never), version: 1 } };
    await act(async () => root.render(h(SubagentThreadBody, { instance: { state: { threadId: child.id } }, sessionId: SID } as never)));
    expect(host.textContent).toContain("child task text");
    expect(host.textContent).toContain(child.read.thread.turns[0]!.items[1]!.command);
    expect(host.textContent).not.toContain(PREVIEW);
    expect(host.textContent).not.toContain("parent notice preview");
    expect(host.textContent).not.toContain(SEND);
    expect(host.querySelectorAll("[data-send-bubble]")).toHaveLength(1);
    expect(host.querySelector('[data-testid="input-status"]')).toBeNull();
    expect(host.querySelector('[data-testid="ledger-outbox-status"]')).toBeNull();
    // The live line follows the child's own running turn, not the parent's delivery turn.
    expect(host.querySelector('[data-testid="turn-working"]')?.textContent).not.toContain("turn.activity.working");
    await act(async () => root.unmount()); host.remove();
  });

  it("the same child timeline without the sub-agent scope shows the parent rows (the reported bug)", async () => {
    const { host, root } = mount();
    const timeline = timelineFromThreadRead(CHILDREN.codex.read as never);
    await act(async () => root.render(h(TimelineBody, { timeline, sessionId: SID, nameOf: (id: string) => id, readOnly: true })));
    expect(host.textContent).toContain(PREVIEW);
    expect(host.textContent).toContain(SEND);
    await act(async () => root.render(h(TimelineBody, { timeline, sessionId: SID, nameOf: (id: string) => id, thread: "subagent", readOnly: true })));
    expect(host.textContent).not.toContain(PREVIEW);
    expect(host.textContent).not.toContain(SEND);
    await act(async () => root.unmount()); host.remove();
  });

  it("a read-only view of the agent's own thread keeps its ledger rows", async () => {
    const { host, root } = mount();
    const timeline = timelineFromThreadRead({ thread: { id: "thread-s1", turns: [{ id: "pt1", status: "inProgress", items: [
      { type: "userMessage", id: "parent-u1", content: [{ type: "text", text: PARENT_TEXT }] },
    ] }] } } as never);
    await act(async () => root.render(h(TimelineBody, { timeline, sessionId: SID, nameOf: (id: string) => id, readOnly: true, ownerNotes: true, pendingSends: true })));
    expect(host.textContent).toContain(PARENT_TEXT);
    expect(host.textContent).toContain("parent notice preview");
    expect(host.textContent).toContain(SEND);
    expect(host.querySelector('[data-testid="turn-working"]')?.textContent).toContain("turn.activity.working");
    await act(async () => root.unmount()); host.remove();
  });
});
