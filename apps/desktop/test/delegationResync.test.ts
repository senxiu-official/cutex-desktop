// Owner 2026-10-23: delegations the host had closed days ago still showed 待验收 in the 委托 panel (the
// event feed restarts from its live tail and skips what it missed; only the first 20 vanished ones were
// re-read). Reconcile vanished rows using one closed list and retain those whose state is unknown.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";

const daemon = vi.hoisted(() => ({
  open: [] as unknown[],
  asks: vi.fn(async (_filter: unknown) => daemon.open),
  ask: vi.fn(async (_id: string): Promise<unknown> => null),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: daemon, apiFor: () => daemon, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { ASKS_FEATURE } = await import("../src/renderer/src/lib/delegations");
const store = await import("../src/renderer/src/lib/delegationStore");
const { focusHostId } = await import("../src/renderer/src/lib/hostKeys");

const host = focusHostId();
const row = (askId: string): AskSummary => ({ askId, closed: null, execution: "answered", review: "awaitingAcceptance", target: "worker", requester: { kind: "agent", cutexSessionId: "director" } }) as unknown as AskSummary;
const ids = () => Object.keys(store.hostDelegations(store.useDelegations.getState().byKey, host)).sort();

beforeAll(async () => {
  const state = { features: new Set([ASKS_FEATURE]), selectedId: null, selectedHost: null, byHost: {}, notify() {} };
  store.startDelegationSync({ getState: () => state, subscribe: () => () => {} });
  await vi.waitFor(() => expect(daemon.asks).toHaveBeenCalled());
});

describe("delegation re-sync (lib/delegationStore)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.useDelegations.getState().reset();
    daemon.asks.mockReset().mockImplementation(async () => daemon.open);
    daemon.open = [];
  });
  afterEach(() => { store.useDelegations.getState().reset(); vi.useRealTimers(); });
  it("reconciles a burst of vanished rows with one closed list and retains unknown rows", async () => {
    const original = Array.from({ length: 250 }, (_, i) => row(`ask-${i}`));
    daemon.open = original;
    const refresh = store.refreshOpenDelegations(host);
    await vi.advanceTimersByTimeAsync(1000);
    await refresh;
    daemon.asks.mockClear();
    daemon.asks.mockImplementation(async (f: unknown) => (f as { state?: string }).state === "closed"
      ? original.slice(0, 240).map(d => ({ ...d, closed: "completed" })) : []);
    await store.refreshOpenDelegations(host);
    expect(daemon.asks.mock.calls.map(([f]) => f)).toEqual([{ state: "open", background: true }, { state: "closed", limit: 1000, background: true }]);
    expect(daemon.ask).not.toHaveBeenCalled();
    expect(Object.values(store.hostDelegations(store.useDelegations.getState().byKey, host)).filter(d => d.closed)).toHaveLength(240);
    expect(ids()).toHaveLength(250);
  });

  it("opening the panel / the window coming back re-syncs, at most once per RESYNC_MIN_MS per host", async () => {
    store.useDelegations.getState().reset();
    daemon.asks.mockImplementation(async () => []);
    daemon.asks.mockClear();
    const t = 1_000_000_000;
    expect(store.resyncDelegations(host, "director", t)).toBe(true);
    expect(store.resyncDelegations(host, "director", t + 1000)).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.resyncDelegations(host, "director", t + store.RESYNC_MIN_MS)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    // The open list and the agent's own delegations (forced past the once-per-agent load).
    const filters = daemon.asks.mock.calls.map((c) => c[0] as Record<string, string>);
    expect(filters.filter((f) => f.state === "open")).toHaveLength(2);
    expect(daemon.asks.mock.calls.some((c) => (c[0] as { involving?: string }).involving === "director" || (c[0] as { requester?: string }).requester === "director")).toBe(true);
  });

  it("a host without delegations is never asked", () => {
    expect(store.resyncDelegations("elsewhere", undefined, 5e12)).toBe(false);
  });
});

describe("stopped mark (components/DelegationParts)", () => {
  it("被主人停止 / stopped is a static stop mark, not the dashed ring that read as a spinner", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { DelegationGlyph } = await import("../src/renderer/src/components/DelegationParts");
    const html = renderToStaticMarkup(createElement(DelegationGlyph, { glyph: "ring", tone: "neutral" }));
    expect(html).toContain("<rect");
    expect(html).not.toContain("stroke-dasharray");
    expect(html).not.toContain("animate");
  });
});
