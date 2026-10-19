// Owner review of a delegation decided on the delegation itself (owner 2026-10-19): 批准 / 拒绝 on the
// requester's card and the target's queue row, gated like the 审批 page; an outgoing mirror waiting for
// the other host's owner says so instead of 排队中 / 等待你审批. Pure mapping + rendered gating.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApprovalRecord, AskSummary } from "../src/shared/ipc";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import { askReviewApproval, canDecideApprovals, APPROVALS_FEATURE } from "../src/renderer/src/lib/approvals";
import { awaitsOwnerReview, awaitsRemoteReview, delegationBucket, delegationStatus, pendingForAgent } from "../src/renderer/src/lib/delegations";
import { needsYouByAgent } from "../src/renderer/src/lib/agentAttention";
import { approvalClientFacts } from "../src/shared/approvalOrigin";
import { OWNER_ACCESS } from "../src/shared/users";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";

const state = vi.hoisted(() => ({
  locale: "zh-CN",
  record: null as AskSummary | null,
  review: { record: null as ApprovalRecord | null, canDecide: false, approvalsPage: false },
}));
const catalogs: Record<string, Record<string, string>> = { en, "zh-CN": zhCN };
const t = (key: string, params: Record<string, string | number> = {}) => (catalogs[state.locale]![key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: state.locale, t }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (value: unknown) => unknown) => select({ features: new Set(), activity: {}, sessions: {} }), { getState: () => ({ openPage: vi.fn() }) }), agentHost: () => "local", featuresOf: (s: { features: ReadonlySet<string> }) => s.features, selectedFeatures: (s: { features: ReadonlySet<string> }) => s.features }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({
  useDelegationContext: () => () => ({}),
  useAgentNames: () => (id: string) => id,
  useAgentHost: () => "local",
  useStatusWord: () => (status: { key: string; n?: number; host?: string }, name: string) => t(`delegation.status.${status.key}`, { name, n: status.n ?? "", host: status.host ?? "" }),
  useCardDelegation: () => ({ d: state.record, live: true }),
  useResolvedAskId: (id: string) => id,
  useAgentProfile: () => null,
  useOwnerSteered: () => false,
}));
vi.mock("../src/renderer/src/lib/approvalDecision", () => ({ useAskReview: () => state.review, decideApprovalOn: vi.fn() }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ hasDelegationViews: () => true }));
vi.mock("../src/renderer/src/lib/delegationOpen", () => ({ openDelegationDetail: vi.fn() }));
vi.mock("../src/renderer/src/lib/p2Access", () => ({ useP2Access: () => ({ files: true, attachments: true, delegations: true, owner: true }) }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ delegationMenu: vi.fn(), runDelegationCommand: vi.fn() }));
vi.mock("../src/renderer/src/lib/focusRequest", () => ({ focusDelegation: vi.fn(), focusTurn: vi.fn() }));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (id: string) => id }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openPage: vi.fn() } } }));
vi.mock("../src/renderer/src/components/Markdown", () => ({ Markdown: () => null }));
vi.mock("../src/renderer/src/components/Parties", () => ({ Who: () => null }));
vi.mock("../src/renderer/src/components/PeerParty", () => ({ PeerParty: () => null }));
vi.mock("../src/renderer/src/components/DelegationComposer", () => ({ OwnerSteeredBadge: () => null }));
vi.mock("../src/renderer/src/components/DelegationPeer", () => ({ DelegationPeerSection: () => null }));

import { DelegationCard } from "../src/renderer/src/components/DelegationCard";
import { DelegationRow } from "../src/renderer/src/components/DelegationQueue";

const ask = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1", title: "构建 r208 release", requester: { kind: "agent", cutexSessionId: "lead" }, target: "alden",
  targetName: "Alden", execution: "pendingReview", closed: null, attempts: 0, revision: 1,
  createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", ...over,
});
const remote = (remoteState: Record<string, unknown> | null, extra: Partial<NonNullable<AskSummary["remote"]>> = {}): Partial<AskSummary> => ({
  remote: { peerId: "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f", label: "workstation-lab", targetName: "proj-worker", syncState: "synced", remoteState, ...extra },
});
const incoming: Partial<AskSummary> = { requester: { kind: "peer", peerId: "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f", cutexSessionId: "cutex.9b2e4f1d77", name: "proj-research", label: "workstation-lab" } };
const review = (askId = "ask-1", over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  approvalId: "apr-1", kind: "ask_delivery", reason: "target_capabilities_not_subset", requesterCutexSessionId: "lead", summary: "委托 Lead → Alden", details: { askId }, requestSha256: "x", state: "pending", createdAt: "2026-10-19T00:00:00Z", ...over,
});

describe("delegation review mapping", () => {
  it("a local or incoming pendingReview waits for this owner; an outgoing mirror never does", () => {
    expect(awaitsOwnerReview(ask())).toBe(true);
    expect(awaitsOwnerReview(ask(incoming))).toBe(true);
    expect(awaitsOwnerReview(ask({ closed: "cancelled" }))).toBe(false);
    expect(awaitsOwnerReview(ask(remote({ execution: "pendingReview" })))).toBe(false);
    expect(delegationStatus(ask()).key).toBe("pendingReview");
    expect(delegationBucket(ask(incoming))).toBe("needsYou");
  });

  it("maps a mirror the other host's owner reviews to remoteReview with that host, in 等待", () => {
    const mirror = ask(remote({ execution: "pendingReview" }));
    expect(awaitsRemoteReview(mirror)).toBe(true);
    expect(delegationStatus(mirror)).toEqual({ key: "remoteReview", tone: "muted", glyph: "hollow", host: "workstation-lab" });
    expect(delegationBucket(mirror)).toBe("waiting");
    // Only the remote snapshot says so (the mirror's own execution not refreshed yet).
    expect(delegationStatus(ask({ execution: "queued", ...remote({ execution: "pendingReview" }) })).key).toBe("remoteReview");
    // A local overlay hold (peer unreachable) is the newer news.
    const unreachable = ask({ hold: { reason: "peerUnreachable" }, ...remote({ execution: "pendingReview" }, { syncState: "peer_unreachable" }) });
    expect(awaitsRemoteReview(unreachable)).toBe(false);
    expect(delegationStatus(unreachable).key).toBe("peerUnreachable");
    // Approved there: queued, not reviewed any more.
    expect(delegationStatus(ask({ execution: "queued", ...remote({ execution: "queued" }) })).key).toBe("queued");
    expect(delegationStatus(ask({ closed: "cancelled", execution: "rejected", ...remote({ execution: "rejected" }) })).key).toBe("rejected");
  });

  it("finds the ask_delivery record of a delegation and gates deciding like the 审批 page", () => {
    const list = [review("ask-2", { approvalId: "apr-2" }), review("ask-1", { kind: "managed_service" }), review("ask-1", { approvalId: "apr-ok" })];
    expect(askReviewApproval(list, "ask-1")?.approvalId).toBe("apr-ok");
    expect(askReviewApproval(list, "ask-9")).toBeNull();
    expect(askReviewApproval(null, "ask-1")).toBeNull();
    expect(askReviewApproval([review("ask-1", { state: "approved" })], "ask-1")).toBeNull();
    const features = new Set([APPROVALS_FEATURE]);
    expect(canDecideApprovals(features, OWNER_ACCESS)).toBe(true);
    expect(canDecideApprovals(new Set(), OWNER_ACCESS)).toBe(false);
    expect(canDecideApprovals(features, { ...OWNER_ACCESS, scope: "chat" })).toBe(false);
    expect(canDecideApprovals(features, { ...OWNER_ACCESS, token: { id: "t", label: "", scope: "read" } as never })).toBe(false);
    expect(canDecideApprovals(features, { ...OWNER_ACCESS, scope: "full" })).toBe(true);
  });

  it("counts a delegation review once in 需要你 (on its target), not also as its requester's approval", () => {
    const needs = needsYouByAgent({ approvals: [review("ask-1"), review("ask-x", { approvalId: "apr-x", kind: "managed_service" })], delegations: [ask()] });
    expect(needs.get("alden")).toMatchObject({ reasons: ["review"], askIds: ["ask-1"] });
    expect(needs.get("lead")).toMatchObject({ count: 1, reasons: ["approval"] });
    // Without the delegation known (asks off), the approval still counts for its requester.
    expect(needsYouByAgent({ approvals: [review("ask-1")], delegations: null }).get("lead")?.reasons).toEqual(["approval"]);
    // A mirror waiting for the other host is nobody's need here.
    expect(needsYouByAgent({ delegations: [ask({ target: "cutex.4be81f2a9c", ...remote({ execution: "pendingReview" }) })] }).size).toBe(0);
  });

  it("lists a pending review in the target's 待处理委托 and records the decision surface", () => {
    expect(pendingForAgent({ "ask-1": ask(incoming) }, "alden").map((d) => d.askId)).toEqual(["ask-1"]);
    expect(approvalClientFacts({ surface: "delegation", input: "pointer" }, "1", "d")).toMatchObject({ surface: "delegation" });
  });

  it("has the new strings in zh-CN, zh-Hant-CN and en with the term placeholders", () => {
    for (const cat of [zhCN, zhHantCN, en] as Record<string, string>[]) {
      expect(cat["delegation.status.remoteReview"]).toContain("{host}");
      expect(cat["delegation.status.remoteReview"]).toContain("{{owner}}");
      for (const k of ["lead", "openPage", "approveHint", "denyHint"]) expect(cat[`delegation.review.${k}`]).toBeTruthy();
    }
  });
});

const item: RawItem = { id: "delegate-1", type: "mcpToolCall", server: "cutex", tool: "agent_delegate", arguments: { target: "alden", text: "构建" }, result: { structuredContent: { delegation: "ask-1" } } };
const card = () => renderToStaticMarkup(createElement(DelegationCard, { item, sessionId: "lead" }));
const row = () => renderToStaticMarkup(createElement(DelegationRow, { d: state.record!, sessionId: "alden" }));

describe.each(["zh-CN", "en"])("delegation review buttons (%s)", (locale) => {
  beforeEach(() => {
    state.locale = locale;
    state.review = { record: null, canDecide: false, approvalsPage: false };
  });

  it("the sender card offers 批准 / 拒绝 and 到审批页 when this connection can decide", () => {
    state.record = ask();
    state.review = { record: review(), canDecide: true, approvalsPage: true };
    const html = card();
    expect(html).toContain('data-review="approve"');
    expect(html).toContain('data-review="deny"');
    expect(html).toContain(t("approvals.approve"));
    expect(html).toContain(t("delegation.review.openPage"));
    expect(html).not.toContain("delegation-review-line");
  });

  it("keeps the hint line (no buttons) for a connection that cannot decide", () => {
    state.record = ask();
    state.review = { record: review(), canDecide: false, approvalsPage: false };
    const html = card();
    expect(html).not.toContain("data-review=");
    expect(html).toContain(t("delegation.pendingReviewHint"));
  });

  it("the sender card of a cross-host mirror says whose owner reviews it, without buttons", () => {
    state.record = ask({ target: "cutex.4be81f2a9c", ...remote({ execution: "pendingReview" }) });
    state.review = { record: review(), canDecide: true, approvalsPage: true };
    const html = card();
    expect(html).toContain(t("delegation.status.remoteReview", { host: "workstation-lab" }));
    expect(html).not.toContain(t("delegation.status.queued"));
    expect(html).not.toContain("data-review=");
    expect(html).not.toContain("delegation-review-line");
  });

  it("the target's queue row (local and incoming cross-host) has inline 批准 / 拒绝, gated", () => {
    for (const d of [ask(), ask(incoming)]) {
      state.record = d;
      state.review = { record: review(), canDecide: true, approvalsPage: true };
      expect(row()).toContain('data-review="approve"');
      state.review = { record: review(), canDecide: false, approvalsPage: false };
      expect(row()).not.toContain("data-review=");
      expect(row()).toContain(t("delegation.status.pendingReview"));
    }
    state.record = ask({ execution: "queued" });
    state.review = { record: review(), canDecide: true, approvalsPage: true };
    expect(row()).not.toContain("data-review=");
  });
});
