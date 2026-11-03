import { createElement as h } from "react";
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

// @vitest-environment jsdom
import { TurnTail } from "../src/renderer/src/components/Timeline";
import { DelegationTag } from "../src/renderer/src/components/DelegationParts";
import { DelegationTurnOverlay, DelegationTurnHint } from "../src/renderer/src/components/DelegationComposer";
import { TimelineViewContext } from "../src/renderer/src/modules/timelineItemsView";
import { emptyTimeline } from "../src/renderer/src/lib/timeline";
import { delivery, T0, iso } from "../src/renderer/src/lib/inputLedger/testkit";
import { showStandaloneDelivery } from "../src/renderer/src/lib/inputLedger/deliveryPresentation";
import type { SessionDelivery } from "@cutex-desktop/protocol";
const turn = { askId: "ask-private", attempt: 1, title: "Review parser", requesterId: null, requesterName: null, owner: true, startedAt: T0 };
const askTurn = { kind: "ask" as const, askId: turn.askId, turnId: "t", inputIds: [], startedAt: iso(T0) };
const lease = { holder: "ask" as const, turnId: "t", since: iso(T0), runtimeGeneration: 1, inputIds: [], reconcile: { state: "checking" as const } };
function tail(state: SessionDelivery) {
  Object.assign(fx.state, { features: new Set(["input-ledger-v1"]), inputs: { "local\ns1": { delivery: state } } });
  return h(TimelineViewContext.Provider, { value: { hostId: "local", sessionId: "s1", tools: [], received: [], agent: {} } as never }, h(TurnTail, { sessionId: "s1", timeline: emptyTimeline() }));
}
describe("one working-on-delegation location", () => {
  it.each(["turn", "held"] as const)("removes the entire duplicate timeline %s line", state => {
    expect(renderToStaticMarkup(tail(delivery(state, 1, { reason: state === "held" ? "delegationLease" : null, turn: state === "turn" ? askTurn : null, lease })))).toBe("");
  });
  it("keeps the existing Composer overlay's title, number, requester and elapsed time", () => {
    const html = renderToStaticMarkup(h("div", {}, tail(delivery("turn", 1, { turn: askTurn, lease })), h(DelegationTurnOverlay, { turn })));
    expect(html).not.toContain('data-testid="turn-working"');
    expect(html.match(/Review parser/g)).toHaveLength(1);
    expect(html).toContain("data-delegation-tag");
    expect(html).toContain("delegation.you");
    expect(html).toContain("delegationTurn.elapsed");
    expect(renderToStaticMarkup(h(DelegationTurnHint, { turn, draft: true }))).toContain("data-delegation-draft-line");
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
    expect(renderToStaticMarkup(tail(state))).toBe("");
    expect(showStandaloneDelivery(state)).toBe(true);
  });
  it("does not suppress unfamiliar session reasons or absent ask identity", () => {
    expect(showStandaloneDelivery({ ...delivery("held", 1, { lease }), reason: "futureReason" } as unknown as SessionDelivery)).toBe(true);
    expect(showStandaloneDelivery(delivery("turn", 1))).toBe(true);
  });
});

describe("delegation identity tooltips", () => {
  it.each([false, true])("link=%s uses the visible number instead of a raw id in the title", linked => {
    const askId = "ask-private-identity";
    const html = renderToStaticMarkup(h(DelegationTag, { askId, ...(linked ? { onJump: () => {} } : {}) }));
    expect(html).not.toContain(askId);
    expect(html).toMatch(/title="#\d+"/);
    expect(html).toContain("data-delegation-tag");
  });
});
