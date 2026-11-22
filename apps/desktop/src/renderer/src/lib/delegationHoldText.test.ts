// Pure checks of the runtime-gate hold predicate; the store / quota hooks are stubbed out.
import { describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../../../shared/ipc";

vi.mock("../store", () => ({ featuresOf: () => new Set(), sidebarOf: () => null, useApp: () => false }));
vi.mock("./agentList", () => ({ runtimeOf: () => "codex" }));
vi.mock("./quotaContinue", () => ({ useQuotaContinue: () => null }));

const { gateClosed, gateClosedCause } = await import("./delegationHoldText");

const GATE = { reason: "heldByRuntime", native: "gate_closed" } as const;

function ask(over: Partial<AskSummary> = {}): AskSummary {
  return {
    askId: "ask-1", title: "t", requester: { kind: "agent", cutexSessionId: "req" } as AskSummary["requester"], target: "tgt",
    execution: "running", hold: GATE, attempts: 1, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z", revision: 1,
    ...over,
  } as AskSummary;
}

describe("gateClosed", () => {
  it("holds queued and admitted delegations behind a closed gate", () => {
    expect(gateClosed(ask({ execution: "queued" }))).toBe(true);
    expect(gateClosed(ask({ execution: "admitted" }))).toBe(true);
  });

  it("holds a running delegation whose retained input waits behind the gate", () => {
    expect(gateClosed(ask({ execution: "running" }))).toBe(true);
    expect(gateClosedCause(ask({ execution: "running", attempt: { lastError: "server_error: upstream 500" } as AskSummary["attempt"] }))).toBe("server_error");
  });

  it("ignores a running delegation with no hold or another hold", () => {
    expect(gateClosed(ask({ hold: null }))).toBe(false);
    expect(gateClosed(ask({ hold: { reason: "heldByRuntime", native: "other" } }))).toBe(false);
    expect(gateClosed(ask({ hold: { reason: "waitingForEvent" } }))).toBe(false);
    expect(gateClosed(ask({ hold: { reason: "blocked", by: "quota" } }))).toBe(false);
  });

  it("is false for closed or remote delegations even with the gate hold", () => {
    expect(gateClosed(ask({ closed: "completed" as AskSummary["closed"] }))).toBe(false);
    expect(gateClosed(ask({ remote: { label: "peer" } as AskSummary["remote"] }))).toBe(false);
  });

  it("is false for settled executions carrying a stale gate hold", () => {
    for (const execution of ["answered", "failed", "interrupted", "cancelled", "pendingReview"] as const)
      expect(gateClosed(ask({ execution }))).toBe(false);
  });
});
