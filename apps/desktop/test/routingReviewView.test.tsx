import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UpgradeApprovalRead } from "../src/shared/delegationUpgradePreview";
import { OWNER_ACCESS } from "../src/shared/users";
import { askReviewFields, reviewReferences } from "../src/shared/delegationReviews";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const fx = vi.hoisted(() => ({ access: {} as typeof OWNER_ACCESS, features: new Set<string>(), operation: null as unknown, record: null as UpgradeApprovalRead | null }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: keyof typeof zhCN, params: Record<string, string> = {}) => (zhCN[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? "") }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: unknown) => unknown) => select({}), featuresOf: () => fx.features }));
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ useHostAccess: () => fx.access }));
vi.mock("../src/renderer/src/lib/approvalDecision", () => ({ decideRoutingReviewOn: vi.fn(), useAskReview: () => ({ record: null, canDecide: true, loaded: true, routingSupported: false }) }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ runDelegationCommand: vi.fn() }));
vi.mock("../src/renderer/src/lib/routingReviews", () => ({ ROUTING_REVIEW_FEATURE: "delegation-review-refs", useRoutingOperation: () => fx.operation, useRoutingReview: () => ({ record: fx.record, error: false }), refreshRoutingReviews: vi.fn(), checkRoutingOutcome: vi.fn() }));
import { RoutingDecision, RoutingDelegationReview } from "../src/renderer/src/components/RoutingReview";
import { DelegationReviewActions } from "../src/renderer/src/components/DelegationReview";

const record = { id: "routing-a", projectId: "project-a", delegationRef: { hostId: "local", id: "ask-a" }, state: "pending", allowedActions: { approve: true, deny: true } } as UpgradeApprovalRead;
const d = { askId: "ask-a", title: "review", execution: "pendingReview", revision: 1, closed: null } as import("../src/shared/ipc").AskSummary;
const render = (value: React.ReactElement) => renderToStaticMarkup(value);
beforeEach(() => { fx.access = OWNER_ACCESS; fx.features = new Set(["owner-approvals", "delegation-review-refs"]); fx.operation = null; fx.record = record; });

it("only full owner authority exposes decisions, respecting per-record actions and state", () => {
  const html = () => render(createElement(RoutingDecision, { host: "local", record }));
  expect(html()).toContain('data-routing-decision="approve"');
  fx.access = { ...OWNER_ACCESS, isOwner: false };
  expect(html()).not.toContain("data-routing-decision");
  fx.access = { ...OWNER_ACCESS, scope: "chat" } as typeof OWNER_ACCESS;
  expect(html()).not.toContain("data-routing-decision");
  fx.access = OWNER_ACCESS;
  expect(render(createElement(RoutingDecision, { host: "local", record: { ...record, allowedActions: { approve: false, deny: true } } }))).not.toContain('data-routing-decision="approve"');
  expect(render(createElement(RoutingDecision, { host: "local", record: { ...record, state: "approved" } }))).not.toContain("data-routing-decision");
});
it("an unresolved project operation disables both mutation buttons", () => {
  fx.operation = { actionId: "original" };
  const html = render(createElement(RoutingDecision, { host: "local", record }));
  expect(html.match(/data-routing-decision="(?:approve|deny)" disabled=""/g)).toHaveLength(2);
  expect(html).toContain(zhCN["delegation.routing.check"]);
});
it("approved routing remains waiting for delivery conditions, without new decisions", () => {
  fx.record = { ...record, state: "approved" };
  const html = render(createElement(RoutingDelegationReview, { host: "local", d, variant: "row", refValue: { kind: "routing", approvalId: "routing-a", projectId: "project-a" } }));
  expect(html).toContain(zhCN["delegation.routing.waitingGrant"]);
  expect(html).not.toContain("data-routing-decision");
});
it("old hosts show update and stop, without linking to the empty approvals page", () => {
  fx.features.delete("delegation-review-refs");
  const html = render(createElement(DelegationReviewActions, { host: "local", d, variant: "card" }));
  expect(html).toContain(zhCN["delegation.routing.upgradeHost"]);
  expect(html).toContain(zhCN["delegation.stop"]);
  expect(html).not.toContain(zhCN["delegation.pendingReviewHint"]);
});
it("denial explanation remains visible after a delegation closes", () => {
  const html = render(createElement(DelegationReviewActions, { host: "local", d: { ...d, closed: "cancelled", reviewDenialReason: "outside project scope" }, variant: "side" }));
  expect(html).toContain("delegation-review-denial");
  expect(html).toContain("outside project scope");
  expect(html).not.toContain("data-routing-decision");
});
it("a reference to another delegation never places its decision buttons on this card", () => {
  fx.record = { ...record, delegationRef: { hostId: "local", id: "other-ask" } };
  const html = render(createElement(RoutingDelegationReview, { host: "local", d, variant: "card", refValue: { kind: "routing", approvalId: "routing-a", projectId: "project-a" } }));
  expect(html).toContain(zhCN["delegation.routing.unavailable"]);
  expect(html).not.toContain("data-routing-decision");
});
it("typed references coexist with legacy result review and survive omitted event fields", () => {
  const fields = askReviewFields({ review: "required", reviewRef: { kind: "routing", approvalId: "r1", projectId: "p" }, reviewRefs: [{ kind: "capability", approvalId: "c1", projectId: null }] });
  expect(reviewReferences(fields).map(r => r.kind)).toEqual(["routing", "capability"]);
  expect(askReviewFields({ execution: "queued" })).toEqual({});
  expect(askReviewFields({ reviewRef: { kind: "routing", approvalId: "../bad", projectId: "p" } })).toEqual({ reviewRef: null });
  expect(fields).not.toHaveProperty("review");
});
