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
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ delegationMenu: () => [], runDelegationCommand: vi.fn() }));
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

import { DelegationQuotaOutcome } from "../src/renderer/src/components/DelegationQuotaOutcome";
import { gateClosedCause } from "../src/renderer/src/lib/delegationHoldText";
import { DelegationCard, DelegationDetailBody } from "../src/renderer/src/components/DelegationCard";
import { delegationStatus } from "../src/renderer/src/lib/delegations";

const ask = (patch: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1", revision: 1, title: "Work", requester: { kind: "owner" }, target: "handler",
  execution: "queued", attempts: 0, closed: null, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z",
  hold: { reason: "heldByRuntime", native: "gate_closed" }, ...patch,
});
const outcome = (result: QuotaContinueOutcome["result"] = "fired", reason: string | null = "started"): QuotaContinueView => ({
  cutexSessionId: "handler", enabled: true, pending: null,
  last: { at: "2025-01-12T03:04:00Z", result, reason, resetAt: null },
});
let root: Root;
let container: HTMLDivElement;
const render = async (d = ask(), host = "record-host") => {
  await act(async () => root.render(h(DelegationQuotaOutcome, { d, host })));
  return container.textContent!;
};
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

describe("handler quota history", () => {
  it.each(["started", "queued", null])("fired %s describes submission only", async (reason) => {
    mock.view = outcome("fired", reason);
    const text = await render();
    expect(text).toContain("delegation.quotaRecovery.title");
    expect(text).toContain(`delegation.quotaRecovery.${reason === "queued" ? "queued" : "sent"}`);
    expect(text).not.toMatch(/completed|running|resume/i);
    expect(mock.quota).toHaveBeenLastCalledWith("record-host", "handler", true);
  });
  it.each([
    ["skipped", "archived", "archived"], ["skipped", "offline", "offline"],
    ["skipped", "runtimeRestarted", "runtimeRestarted"], ["skipped", "paused", "paused"],
    ["skipped", "asksRedelivered", "asksRedelivered"], ["cancelled", "ownerMessage", "owner"],
    ["cancelled", "owner", "owner"], ["cancelled", "ownerStop", "owner"],
    ["cancelled", "runtimeOffline", "offline"], ["cancelled", "turnCompleted", "turnCompleted"],
    ["skipped", "resetUnknown", "resetUnknown"],
  ] as const)("renders %s/%s", async (result, reason, suffix) => {
    mock.view = outcome(result, reason);
    const text = await render();
    expect(text).toContain(`delegation.quotaRecovery.${result}`);
    expect(text).toContain(`delegation.quotaRecovery.reason.${suffix}`);
  });
  it("keeps unknown and failed diagnostics neutral", async () => {
    for (const result of ["failed", "skipped", "cancelled"] as const) {
      mock.view = outcome(result, "new server detail");
      const text = await render();
      expect(text).toContain(`delegation.quotaRecovery.${result}`);
      expect(text).not.toContain("new server detail");
      expect(text).not.toContain(".reason.");
    }
  });
  it("does not borrow history for a different target or outgoing peer", async () => {
    expect(await render(ask({ target: "other" }))).toBe("");
    expect(await render(ask({ remote: { peerId: "p", label: "Peer", targetName: "Handler", syncState: "synced" } }))).toBe("");
    expect(mock.quota).toHaveBeenLastCalledWith("record-host", "handler", false);
  });
  it("gates using the record host capability", async () => {
    expect(await render(ask(), "other-host")).toBe("");
    mock.features.clear();
    expect(await render()).toBe("");
  });
  it.each(["codex", "dsh", "kimi"])("excludes a known %s runtime on the record host", async (runtime) => {
    mock.rows["record-host"] = { active: [{ cutexSessionId: "handler", launchBinding: { runtime } }], retired: [] } as unknown as SidebarSnapshot;
    expect(await render()).toBe("");
  });
  it("ignores another host's colliding id and accepts a known archived Claude", async () => {
    mock.rows["focus-host"] = { active: [{ cutexSessionId: "handler", launchBinding: { runtime: "codex" } }], retired: [] } as unknown as SidebarSnapshot;
    expect(await render()).toContain(".sent");
    mock.rows["record-host"] = { active: [], retired: [{ cutexSessionId: "handler", launchBinding: { runtime: "claude" } }] } as unknown as SidebarSnapshot;
    expect(await render()).toContain(".sent");
  });
  it("renders the full historical date in the chosen locale", async () => {
    for (const locale of ["en", "zh-CN", "de-DE"]) {
      mock.locale = locale;
      await render();
      const time = container.querySelector("time")!;
      expect(time.dateTime).toBe(mock.view!.last!.at);
      expect(time.textContent).toBe(new Date(time.dateTime).toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
      expect(time.textContent).toContain("2025");
    }
  });
  it("does not display a pending-only or missing view as a past outcome", async () => {
    mock.view = { ...outcome(), last: null };
    expect(await render()).toBe("");
    mock.view = null;
    expect(await render()).toBe("");
  });
  it("updates on cache/prop rerender without assigning history to this ask", async () => {
    expect(await render()).toContain(".sent");
    mock.view = outcome("cancelled", "owner");
    expect(await render(ask({ execution: "answered", closed: "completed", hold: null }))).toContain(".cancelled");
  });
});

describe("runtime gate cause evidence", () => {
  it.each(["gate_closed", "Unknown error", "quotas are possible", "", null])("keeps %s neutral", (lastError) => {
    expect(gateClosedCause(ask({ attempt: { n: 1, lastError } }))).toBeNull();
  });
  it.each(["quota", "server_error"] as const)("uses an attached %s diagnostic", (lastError) => {
    expect(gateClosedCause(ask({ attempt: { n: 1, lastError: `Error: ${lastError}` } }))).toBe(lastError);
    expect(gateClosedCause(ask({ closed: "completed", attempt: { n: 1, lastError } }))).toBeNull();
    expect(gateClosedCause(ask({ execution: "running", attempt: { n: 1, lastError } }))).toBeNull();
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
  it("keeps the gate status and history when expanding the actual card", async () => {
    mock.record = ask();
    const item = { type: "mcpToolCall", server: "cutex", tool: "agent_delegate", arguments: { target: "handler", message: "Work" }, result: { content: [{ type: "text", text: JSON.stringify({ ask_id: "ask-1" }) }] } } as unknown as RawItem;
    await act(async () => root.render(h(DelegationCard, { item, sessionId: "requester" })));
    expect(container.querySelector("[data-status]")?.getAttribute("data-status")).toBe(delegationStatus(mock.record).key);
    expect(container.querySelectorAll("[data-delegation-quota-outcome]")).toHaveLength(1);
    expect(container.textContent).toContain("delegation.gateClosedHint");
    expect(container.textContent).not.toContain("delegation.gateClosedServerError");
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelectorAll("[data-delegation-quota-outcome]")).toHaveLength(1);
  });
  it.each(["card", "side"] as const)("shows history and positively known cause in %s detail", async (layout) => {
    await act(async () => root.render(h(DelegationDetailBody, {
      d: ask({ attempt: { n: 1, lastError: "server_error" } }), host: "record-host", here: "requester", brief: null, layout,
    })));
    expect(container.textContent).toContain("delegation.quotaRecovery.title");
    expect(container.textContent).toContain("delegation.gateClosedServerError");
  });
});
