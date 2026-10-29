// Owner 2026-10-28: the Director card of a project view (Shelf, host remote) kept a delegation as
// 「待验收」 after the owner abandoned it from its detail. The row comes from lib/delegationStore; it has to
// follow (1) cutex's event pair for one close (stateChanged + closed at the same revision), (2) the owner
// command itself (re-read that delegation: the capped closed list may not hold it), (3) the detail the
// owner opened (a newer record updates the row), (4) a host feed restart (hostResync) of a watched host.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskDetail, AskSummary } from "../src/shared/ipc";

type Handler = (payload: unknown) => void;
const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  open: [] as unknown[],
  closed: [] as unknown[],
  detail: null as unknown,
}));
const daemon = vi.hoisted(() => ({
  asks: vi.fn(async (f: { state?: string }) => (f.state === "closed" ? h.closed : h.open)),
  ask: vi.fn(async (_id: string): Promise<unknown> => h.detail),
  askCommand: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: daemon,
  apiFor: () => daemon,
  bridge: {
    on: (event: string, fn: Handler) => {
      h.handlers.set(event, [...(h.handlers.get(event) ?? []), fn]);
      return () => h.handlers.set(event, (h.handlers.get(event) ?? []).filter((x) => x !== fn));
    },
  },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));

const { ASKS_FEATURE } = await import("../src/renderer/src/lib/delegations");
const store = await import("../src/renderer/src/lib/delegationStore");
const { focusHostId } = await import("../src/renderer/src/lib/hostKeys");
const { openDelegationsOf, projectAsks } = await import("../src/renderer/src/modules/project-view/model");

const host = focusHostId();
const remote = "ssh-remote";
const DIRECTOR = "cutex.director";
const row = (askId: string, revision = 4): AskSummary =>
  ({
    askId, title: `t-${askId}`, closed: null, execution: "answered", review: "awaitingAcceptance", revision, projectId: "scp",
    target: "worker", requester: { kind: "agent", cutexSessionId: DIRECTOR }, createdAt: "2026-10-28T00:00:00Z", updatedAt: "2026-10-28T00:00:00Z", attempts: 1, attempt: null,
  }) as unknown as AskSummary;
const abandoned = (askId: string, revision: number): AskDetail =>
  ({ ...row(askId, revision), review: "abandoned", closed: "abandoned", closedAt: "2026-10-28T01:00:00Z", targetCutexSessionId: "worker", attempts: [], questions: [] }) as unknown as AskDetail;
const emit = (event: string, payload: unknown) => (h.handlers.get(event) ?? []).forEach((fn) => fn(payload));
/** The Director card's outgoing rows (modules/project-view data.ts: projectAsks → openDelegationsOf). */
const cardOut = (hostId: string) => {
  const asks = Object.values(store.hostDelegations(store.useDelegations.getState().byKey, hostId));
  return openDelegationsOf(projectAsks(asks, "scp", new Set([DIRECTOR, "worker"])), DIRECTOR).out.map((d) => d.askId);
};
const seed = (hostId: string, rows: AskSummary[]) => store.useDelegations.setState((s) => ({ byKey: store.mergeHostRows(s.byKey, hostId, rows) }));

beforeAll(async () => {
  const state = { features: new Set([ASKS_FEATURE]), selectedId: null, selectedHost: null, byHost: { [remote]: { features: new Set([ASKS_FEATURE]) } }, notify() {} };
  store.startDelegationSync({ getState: () => state, subscribe: () => () => {} });
  await vi.waitFor(() => expect(daemon.asks).toHaveBeenCalled());
});

describe("abandoned delegation leaves the project card (owner 2026-10-28)", () => {
  let unwatch: (() => void) | null = null;
  beforeEach(() => {
    store.useDelegations.getState().reset();
    h.open = [];
    h.closed = [];
    h.detail = null;
    daemon.asks.mockClear();
    daemon.ask.mockClear();
    daemon.askCommand.mockClear();
  });
  afterEach(() => {
    unwatch?.();
    unwatch = null;
  });

  it("the host feed's event pair for one close (same revision) drops the row", () => {
    seed(host, [row("ask-a", 4), row("ask-b", 4)]);
    expect(cardOut(host)).toEqual(["ask-a", "ask-b"]);
    const env = (method: string, params: unknown) => ({ hostId: host, epoch: "e1", envelope: { cutex: { method, params } } });
    emit("hostEvent", env("cutex/ask/stateChanged", { askId: "ask-a", execution: "answered", hold: null, review: "abandoned", revision: 5 }));
    emit("hostEvent", env("cutex/ask/closed", { askId: "ask-a", outcome: "abandoned", revision: 5 }));
    const a = store.delegationOn(store.useDelegations.getState().byKey, host, "ask-a");
    expect(a).toMatchObject({ closed: "abandoned", review: "abandoned", revision: 5 });
    expect(cardOut(host)).toEqual(["ask-b"]);
  });

  it("放弃 re-reads that delegation: a watched host, no event and a closed list without it", async () => {
    unwatch = store.watchDelegationHost(remote);
    seed(remote, [row("ask-a", 4), row("ask-b", 4)]);
    expect(cardOut(remote)).toEqual(["ask-a", "ask-b"]);
    // The open list no longer has it; the closed list (newest 1000 by creation) does not reach it.
    h.open = [row("ask-b", 4)];
    h.closed = [];
    h.detail = abandoned("ask-a", 6);
    const r = await store.delegationCommand(remote, { askId: "ask-a", target: "worker" }, "cutex/ask/close", "abandoned");
    expect(r.ok).toBe(true);
    expect(daemon.askCommand).toHaveBeenCalledWith("worker", "cutex/ask/close", { askId: "ask-a", outcome: "abandoned" });
    await vi.waitFor(() => expect(cardOut(remote)).toEqual(["ask-b"]));
    expect(daemon.ask).toHaveBeenCalledWith("ask-a");
    expect(store.delegationOn(store.useDelegations.getState().byKey, remote, "ask-a")).toMatchObject({ closed: "abandoned", revision: 6 });
  });

  it("a refused command (already closed on the host) still corrects the row", async () => {
    unwatch = store.watchDelegationHost(remote);
    seed(remote, [row("ask-a", 4)]);
    daemon.askCommand.mockResolvedValueOnce({ ok: false, error: { code: "ask_closed", message: "it is already closed" } } as never);
    h.open = [];
    h.detail = abandoned("ask-a", 9);
    await store.delegationCommand(remote, { askId: "ask-a", target: "worker" }, "cutex/ask/close", "abandoned");
    await vi.waitFor(() => expect(cardOut(remote)).toEqual([]));
  });

  it("opening the detail of a stale row updates the row; an older record does not", async () => {
    seed(host, [row("ask-a", 4)]);
    h.detail = abandoned("ask-a", 3);
    await store.loadDelegationDetail(host, "ask-a");
    expect(cardOut(host)).toEqual(["ask-a"]);
    h.detail = abandoned("ask-a", 7);
    await store.refreshDelegation(host, "ask-a");
    expect(cardOut(host)).toEqual([]);
  });

  it("withDetailState keeps the row's list fields and takes only a newer state", () => {
    const base = { ...row("ask-a", 4), answerPreview: "kept", targetName: "Worker" } as AskSummary;
    expect(store.withDetailState(base, abandoned("ask-a", 4))).toBe(base);
    const next = store.withDetailState(base, abandoned("ask-a", 5));
    expect(next).toMatchObject({ closed: "abandoned", review: "abandoned", revision: 5, answerPreview: "kept", targetName: "Worker" });
  });

  it("a feed restart (hostResync) of a watched host re-reads its open list", async () => {
    unwatch = store.watchDelegationHost(remote);
    await vi.waitFor(() => expect(daemon.asks).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 1100));
    daemon.asks.mockClear();
    emit("hostResync", { hostId: remote, epoch: "e1", reason: "stream_reset" });
    await vi.waitFor(() => expect(daemon.asks).toHaveBeenCalledWith({ state: "open", background: true }), { timeout: 3000 });
  });
});
