// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary, SidebarSnapshot } from "../src/shared/ipc";
import type { QuotaContinueOutcome, QuotaContinueView } from "../src/shared/quotaContinue";
import type { RawItem } from "../src/renderer/src/lib/timeline";

const mock = vi.hoisted(() => ({
  locale: "en", features: new Set(["claude-quota-auto-continue"]),
  rows: {} as Record<string, SidebarSnapshot | null>,
  view: null as QuotaContinueView | null,
  quota: vi.fn(),
  record: null as AskSummary | null,
  live: true, loadCard: vi.fn(),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: mock.locale, t: (key: string) => key }) }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: (select: (state: unknown) => unknown) => select({}),
  featuresOf: (_state: unknown, host: string) => host === "record-host" ? mock.features : new Set(),
  sidebarOf: (_state: unknown, host: string) => mock.rows[host] ?? null,
}));
vi.mock("../src/renderer/src/lib/quotaContinue", () => ({ useQuotaContinue: (...args: unknown[]) => { mock.quota(...args); return mock.view; } }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({
  useAgentNames: () => (id: string) => id, useAgentProfile: () => null,
  useDelegationContext: () => () => ({}), useCardDelegation: () => ({ d: mock.record, live: mock.live }),
  useResolvedAskId: (id: string) => id, useOwnerSteered: () => false,
}));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "record-host" }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  hasDelegationViews: () => true, useDelegations: (select: (s: unknown) => unknown) => select({ progress: {}, questions: {}, details: {} }), loadDelegationDetail: vi.fn(),
  loadCardDelegation: (...args: unknown[]) => mock.loadCard(...args),
}));
vi.mock("../src/renderer/src/lib/p2Access", () => ({ useP2Access: () => ({ delegations: false }) }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ delegationMenu: () => [], runDelegationCommand: vi.fn(), runEndFollowUp: vi.fn(), canEndDelegationFollowUp: () => true, endFollowUpShown: () => true }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (id: string) => id }));
vi.mock("../src/renderer/src/lib/time", () => ({ useNow: () => Date.parse("2026-10-30T00:00:00Z") }));
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (run: () => void) => run() }));
vi.mock("../src/renderer/src/components/DelegationParts", () => ({
  DelegationHops: () => null, DelegationTag: () => null,
  DelegationStatusMark: ({ status }: { status: { key: string } }) => h("span", { "data-status": status.key }),
}));
vi.mock("../src/renderer/src/components/DelegationReview", () => ({ DelegationReviewActions: () => null }));
vi.mock("../src/renderer/src/components/DelegationComposer", () => ({ OwnerSteeredBadge: () => null }));
vi.mock("../src/renderer/src/components/DelegationPeer", () => ({ DelegationPeerSection: () => null }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: () => null }));
vi.mock("../src/renderer/src/components/Parties", () => ({ Who: () => null }));
vi.mock("../src/renderer/src/components/PeerParty", () => ({ PeerParty: () => null }));

import { gateClosedCause } from "../src/renderer/src/lib/delegationHoldText";
import { DelegationCard, DelegationDetailBody } from "../src/renderer/src/components/DelegationCard";
import { delegationStatus } from "../src/renderer/src/lib/delegations";

const ask = (patch: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1", revision: 1, title: "Work", requester: { kind: "owner" }, target: "handler",
  execution: "queued", attempts: 0, closed: null, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z",
  hold: { reason: "heldByRuntime", native: "gate_closed" }, ...patch,
});
const outcome = (result: QuotaContinueOutcome["result"] = "fired", reason: string | null = "started", at = "2026-11-18T05:41:00Z"): QuotaContinueView => ({
  cutexSessionId: "handler", enabled: true, pending: null,
  last: { at, result, reason, resetAt: null },
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mock.locale = "en";
  mock.features = new Set(["claude-quota-auto-continue"]);
  mock.rows = {};
  mock.view = outcome();
  mock.quota.mockClear();
  mock.live = true;
  mock.loadCard.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); });

describe("runtime gate cause evidence", () => {
  it.each(["gate_closed", "Unknown error", "quotas are possible", "", null])("keeps %s neutral", (lastError) => {
    expect(gateClosedCause(ask({ attempt: { n: 1, lastError } }))).toBeNull();
  });
  it.each(["quota", "server_error"] as const)("uses an attached %s diagnostic", (lastError) => {
    expect(gateClosedCause(ask({ attempt: { n: 1, lastError: `Error: ${lastError}` } }))).toBe(lastError);
    expect(gateClosedCause(ask({ closed: "completed", attempt: { n: 1, lastError } }))).toBeNull();
    expect(gateClosedCause(ask({ execution: "running", attempt: { n: 1, lastError } }))).toBe(lastError);
    expect(gateClosedCause(ask({ execution: "running", hold: null, attempt: { n: 1, lastError } }))).toBeNull();
  });
});

describe("card and shared detail integration", () => {
  it("marks transcript-only status as historical and offers a forced retry", async () => {
    mock.record = ask({ revision: -1 });
    mock.live = false;
    const item = { type: "mcpToolCall", server: "cutex", tool: "agent_delegate", arguments: { target: "handler", message: "Work" }, result: { content: [{ type: "text", text: JSON.stringify({ ask_id: "ask-1" }) }] } } as unknown as RawItem;
    await act(async () => root.render(h(DelegationCard, { item, sessionId: "requester" })));
    expect(container.textContent).toContain("delegation.snapshot");
    await act(async () => container.querySelector("button")!.click());
    const retry = [...container.querySelectorAll("button")].find(button => button.textContent === "chat.retry")!;
    await act(async () => retry.click());
    expect(mock.loadCard).toHaveBeenCalledWith("record-host", "ask-1", "requester", true);
  });
  it("keeps the gate status and never shows the handler-wide quota history, collapsed or expanded", async () => {
    mock.record = ask();
    const item = { type: "mcpToolCall", server: "cutex", tool: "agent_delegate", arguments: { target: "handler", message: "Work" }, result: { content: [{ type: "text", text: JSON.stringify({ ask_id: "ask-1" }) }] } } as unknown as RawItem;
    await act(async () => root.render(h(DelegationCard, { item, sessionId: "requester" })));
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe(delegationStatus(mock.record).key);
    expect(container.querySelectorAll("[data-delegation-quota-outcome]")).toHaveLength(0);
    expect(container.textContent).toContain("delegation.gateClosedHint");
    expect(container.textContent).not.toContain("delegation.gateClosedServerError");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelectorAll("[data-delegation-quota-outcome]")).toHaveLength(0);
  });
  it.each(["card", "side"] as const)("shows the positively known cause but no handler history in %s detail", async (layout) => {
    await act(async () => root.render(h(DelegationDetailBody, {
      d: ask({ attempt: { n: 1, lastError: "server_error" } }), host: "record-host", here: "requester", brief: null, layout,
    })));
    expect(container.textContent).not.toContain("quotaRecovery");
    expect(container.textContent).toContain("delegation.gateClosedServerError");
  });
  // nextup-delivery-study (2026-11-25): a new ask showed 「承接方最近额度自动继续 · 已发送 2026年11月18日 05:41」 while undelivered.
  it.each([
    ["a November 18 outcome", "2026-11-18T05:41:00Z"],
    ["a recent unrelated outcome", "2026-10-30T00:00:00Z"],
  ])("%s never appears on a pendingReview or queued card", async (_label, at) => {
    mock.view = outcome("fired", "started", at);
    for (const execution of ["pendingReview", "queued"] as const) {
      await act(async () => root.render(h(DelegationDetailBody, { d: ask({ execution, hold: null, createdAt: "2026-10-29T23:12:00Z" }), host: "record-host", here: "requester", brief: null, layout: "card" })));
      expect(container.querySelector("[data-delegation-quota-outcome]")).toBeNull();
      expect(container.textContent).not.toMatch(/quotaRecovery|2026/);
    }
  });
  it("a genuine quota hold on this ask keeps its own hold text", async () => {
    mock.view = outcome();
    await act(async () => root.render(h(DelegationDetailBody, { d: ask({ attempt: { n: 1, lastError: "quota" } }), host: "record-host", here: "requester", brief: null, layout: "card" })));
    expect(container.textContent).toContain("delegation.status.quota");
    expect(container.textContent).not.toContain("quotaRecovery");
  });
});
