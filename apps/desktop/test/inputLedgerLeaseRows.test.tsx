import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const fx = vi.hoisted(() => ({
  state: { selectedId: "s1", selectedHost: null, hosts: null, sessions: {}, backgroundItems: {}, outbox: {}, features: new Set<string>(), byHost: {} } as Record<string, unknown>,
  // Daemon calls the real store makes (the composer's stop route): recorded, answered with null.
  calls: [] as [string, unknown[]][],
}));
const daemonApi = vi.hoisted(() => new Proxy({}, { get: (_target, key) => key === "then" ? undefined : (...args: unknown[]) => { fx.calls.push([String(key), args]); return Promise.resolve(null); } }));

vi.mock("../src/renderer/src/bridge", () => ({ api: daemonApi, apiFor: () => daemonApi, bridge: { on: () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
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

// @vitest-environment jsdom
import { TurnTail } from "../src/renderer/src/components/Timeline";
import { DelegationTag } from "../src/renderer/src/components/DelegationParts";
import { DelegationTurnOverlay, DelegationTurnHint } from "../src/renderer/src/components/DelegationComposer";
import { TimelineViewContext } from "../src/renderer/src/modules/timelineItemsView";
import { applyEvent, emptyTimeline, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { delivery, T0, iso } from "../src/renderer/src/lib/inputLedger/testkit";
import { showStandaloneDelivery } from "../src/renderer/src/lib/inputLedger/deliveryPresentation";
import type { SessionDelivery } from "@cutex-desktop/protocol";
const turn = { askId: "ask-private", attempt: 1, title: "Review parser", requesterId: null, requesterName: null, owner: true, startedAt: T0 };
const askTurn = { kind: "ask" as const, askId: turn.askId, turnId: "t", inputIds: [], startedAt: iso(T0) };
const lease = { holder: "ask" as const, turnId: "t", since: iso(T0), runtimeGeneration: 1, inputIds: [], reconcile: { state: "checking" as const } };
function tail(state: SessionDelivery, runtime: "codex" | "claude" = "codex", timeline = emptyTimeline()) {
  Object.assign(fx.state, { features: new Set(["input-ledger-v1"]), inputs: { "local\ns1": { delivery: state } } });
  return h(TimelineViewContext.Provider, { value: { hostId: "local", sessionId: "s1", tools: [], received: [], agent: { runtime, map: null } } as never }, h(TurnTail, { sessionId: "s1", timeline }));
}
describe("timeline working line and Composer delegation context", () => {
  for (const runtime of ["codex", "claude"] as const) {
    it.each([
      ["owner", "owner", null],
      ["delegation", "ask", "ask"],
      ["delivery / event-lease", "delivery", "event"],
      ["wake", "delivery", "event"],
      ["unknown", "unknown", null],
    ] as const)(`${runtime}: shows %s using the server's running signal without native history`, (_scene, kind, holder) => {
      const state = delivery("turn", 1, { turn: { ...askTurn, kind, askId: kind === "ask" ? turn.askId : null }, lease: holder ? { ...lease, holder } : null });
      const html = renderToStaticMarkup(tail(state, runtime));
      expect(html).toContain('data-testid="turn-working"');
      expect(html).toContain("turn.activity.working");
      expect(html).not.toContain("inputLedger.delivery.turn");
      expect(html).not.toContain("inputLedger.release");
    });
  }
  it("keeps both the timeline line and Composer requester, number, title and elapsed time", () => {
    const html = renderToStaticMarkup(h("div", {}, tail(delivery("turn", 1, { turn: askTurn, lease })), h(DelegationTurnOverlay, { turn })));
    expect(html).toContain('data-testid="turn-working"');
    expect(html.match(/Review parser/g)).toHaveLength(1);
    expect(html).toContain("data-delegation-tag");
    expect(html).toContain("delegation.you");
    expect(html).toContain("delegationTurn.elapsed");
    expect(renderToStaticMarkup(h(DelegationTurnHint, { turn, draft: true }))).toContain("data-delegation-draft-line");
  });
  it("does not invent a running turn from a held lease or stale native tool", () => {
    const timeline = timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t", status: "inProgress", items: [{ id: "tool", type: "commandExecution", command: "test", status: "inProgress" }] }] } });
    expect(renderToStaticMarkup(tail(delivery("held", 1, { reason: "delegationLease", lease }), "codex", timeline))).toBe("");
    const html = renderToStaticMarkup(tail(delivery("held", 1, { reason: "eventLease", lease: { ...lease, holder: "event" } }), "claude", timeline));
    expect(html).not.toContain("turn.activity.working");
    expect(html).toContain('data-state="held"');
  });
  it.each(["idle", "finishing", "offline", "starting", "disconnected"] as const)("does not show a busy line for %s even with stale native activity", state => {
    const timeline = timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t", status: "inProgress", items: [] }] } });
    expect(renderToStaticMarkup(tail(delivery(state, 1), "codex", timeline))).not.toContain("turn.activity.working");
  });
  it("keeps the requester agent in the existing Composer row", () => {
    const html = renderToStaticMarkup(h(DelegationTurnOverlay, { turn: { ...turn, owner: false, requesterId: "cutex.lead", requesterName: "Lead" } }));
    expect(html).toContain("Lead");
    expect(html).toContain("Review parser");
    expect(html).toContain("data-delegation-tag");
    expect(html).toContain("delegationTurn.elapsed");
  });
  it.each(["owner", "delivery"] as const)("preserves %s working status", kind => {
    expect(renderToStaticMarkup(tail(delivery("turn", 1, { turn: { ...askTurn, kind, askId: null } })))).toContain('data-testid="turn-working"');
  });
  it.each(["offline", "starting", "disconnected", "idle", "finishing"] as const)("preserves %s session information", state => {
    expect(renderToStaticMarkup(tail(delivery(state, 1)))).toContain(`data-state="${state}"`);
  });
  it("leaves stale delegation recovery exclusively in the queue", () => {
    const state = delivery("turn", 1, { turn: askTurn, lease: { ...lease, reconcile: { state: "stale" } } });
    expect(renderToStaticMarkup(tail(state))).toContain("turn.activity.working");
    expect(showStandaloneDelivery(state)).toBe(true);
  });
  it("does not suppress unfamiliar session reasons or absent ask identity", () => {
    expect(showStandaloneDelivery({ ...delivery("held", 1, { lease }), reason: "futureReason" } as unknown as SessionDelivery)).toBe(true);
    expect(showStandaloneDelivery(delivery("turn", 1))).toBe(true);
  });
});

describe("delegation identity tooltips", () => {
  it.each([false, true])("link=%s uses the visible tag instead of the whole id in the title", linked => {
    const askId = "ask-private-identity";
    const html = renderToStaticMarkup(h(DelegationTag, { askId, ...(linked ? { onJump: () => {} } : {}) }));
    expect(html).not.toContain(askId);
    expect(html).toContain('title="#privat"');
    expect(html).toContain("data-delegation-tag");
  });
});

describe("retry line on the input-ledger path", () => {
  const T = 2_000_000_000_000;
  const retained = (extra: Record<string, unknown> = {}) => {
    const timeline = timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t", status: "inProgress", items: [] }] } });
    applyEvent(timeline, { contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "2026-11-15T00:00:00Z", cutexSessionId: "s1", hostId: "local", source: "app_server", sensitivity: "owner", correlation: {},
      native: { kind: "notification", message: { method: "error", params: { threadId: "th", turnId: "t", willRetry: true, message: "Connection interrupted; waiting for network", error: { message: "Connection interrupted; waiting for network", codexErrorInfo: "other", additionalDetails: null }, ...extra } } } } as never);
    return timeline;
  };
  it("shows the retry line, countdown and actions while the delivery already reads idle", () => {
    vi.useFakeTimers({ now: T });
    try {
      const html = renderToStaticMarkup(tail(delivery("idle", 1), "claude", retained({ nextRetryAt: T + 75_000, retryableInput: true })));
      expect(html).toContain('data-testid="turn-retry-notice"');
      expect(html).toContain("turn.retry.retained");
      expect(html).not.toContain("turn.retry.network");
      expect(html).toContain("turn.retry.next(1:15)");
      expect(html).toContain('data-testid="turn-retry-now"');
      expect(html).toContain('data-testid="turn-retry-stop"');
      expect(html).toContain("turn.retry.hintRetained");
    } finally { vi.useRealTimers(); }
  });
  it("shows it under the running line, without actions or countdown when the runtime does not keep the input", () => {
    const html = renderToStaticMarkup(tail(delivery("turn", 1, { turn: { ...askTurn, kind: "owner", askId: null } }), "claude", retained()));
    expect(html).toContain("turn.activity.working");
    expect(html).toContain('data-testid="turn-retry-notice"');
    expect(html).not.toContain("turn-retry-countdown");
    expect(html).not.toContain("turn-retry-now");
    expect(html).not.toContain("turn-retry-stop");
  });
  it("is gone once the turn ends", () => {
    const timeline = retained({ retryableInput: true });
    applyEvent(timeline, { contractVersion: 2, eventId: "e2", cursor: "c", streamId: "s", sequence: 2, receivedAt: "2026-11-15T00:00:00Z", cutexSessionId: "s1", hostId: "local", source: "app_server", sensitivity: "owner", correlation: {},
      native: { kind: "notification", message: { method: "turn/completed", params: { turn: { id: "t", status: "completed", completedAt: 9 } } } } } as never);
    expect(renderToStaticMarkup(tail(delivery("idle", 1), "claude", timeline))).not.toContain("turn-retry-notice");
  });
});

describe("retry line actions", () => {
  const T = 2_000_000_000_000;
  const STORE = "../src/renderer/src/store";
  let host: HTMLDivElement;
  let root: Root;
  // The real store (its interrupt / stop route); the mocked useApp above only feeds the components.
  const realStore = () => vi.importActual<typeof import("../src/renderer/src/store")>(STORE);
  const nativeEvent = (sequence: number, method: string, params: Record<string, unknown>) => ({ contractVersion: 2, eventId: `e${sequence}`, cursor: "c", streamId: "s", sequence, receivedAt: "2026-11-15T00:00:00Z", cutexSessionId: "s1", hostId: "local", source: "app_server", sensitivity: "owner", correlation: {},
    native: { kind: "notification", message: { method, params } } }) as never;
  const retained = () => {
    const timeline = timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t", status: "inProgress", items: [] }] } });
    applyEvent(timeline, nativeEvent(1, "error", { threadId: "th", turnId: "t", willRetry: true, nextRetryAt: T + 30_000, retryableInput: true, error: { message: "Connection interrupted; waiting for network", codexErrorInfo: "other", additionalDetails: null } }));
    return timeline;
  };
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const click = async (id: string) => { await act(async () => { button(id)!.click(); }); };
  async function show(timeline: ReturnType<typeof retained>, features: string[]) {
    const { useApp } = await realStore();
    useApp.setState({ hosts: null, features: new Set(features), sessions: { "local\ns1": { timeline } } } as never);
    act(() => root.render(tail(delivery("idle", 1), "claude", timeline)));
  }
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: T });
    fx.calls.length = 0;
    fx.state.resumeAsks = vi.fn(() => Promise.resolve());
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete fx.state.resumeAsks;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("立即重试 resumes asks on exactly this agent and host, and nothing else", async () => {
    await show(retained(), ["queue-pause"]);
    await click("turn-retry-now");
    expect(fx.state.resumeAsks).toHaveBeenCalledTimes(1);
    expect(fx.state.resumeAsks).toHaveBeenCalledWith("s1", "local");
    expect(fx.calls).toEqual([]);
  });

  it("停止 takes the composer's stop route: with queue-pause, cutex stopTurn for this agent", async () => {
    await show(retained(), ["queue-pause"]);
    await click("turn-retry-stop");
    expect(fx.calls.filter(([m]) => m === "stopTurn")).toEqual([["stopTurn", ["s1"]]]);
    expect(fx.calls.some(([m]) => m === "interrupt")).toBe(false);
    expect(fx.state.resumeAsks).not.toHaveBeenCalled();
  });

  it("停止 without queue-pause interrupts this agent's current turn", async () => {
    await show(retained(), []);
    await click("turn-retry-stop");
    expect(fx.calls.filter(([m]) => m === "interrupt")).toEqual([["interrupt", ["s1", "th", "t"]]]);
    expect(fx.calls.some(([m]) => m === "stopTurn")).toBe(false);
  });

  it("the buttons are gone once the turn completes", async () => {
    const timeline = retained();
    await show(timeline, ["queue-pause"]);
    expect(button("turn-retry-now")).not.toBeNull();
    applyEvent(timeline, nativeEvent(2, "turn/completed", { turn: { id: "t", status: "completed", completedAt: 9 } }));
    act(() => root.render(tail(delivery("idle", 2), "claude", { ...timeline })));
    expect(button("turn-retry-now")).toBeNull();
    expect(button("turn-retry-stop")).toBeNull();
    expect(host.querySelector('[data-testid="turn-retry-notice"]')).toBeNull();
  });
});
