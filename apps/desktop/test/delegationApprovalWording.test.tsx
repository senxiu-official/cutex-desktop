// @vitest-environment jsdom
// Owner 2026-11-25 (delegation-9ca511): the UI term is 「委托审批」 (no 路由, 审核 → 审批); consumed reads 已生效; a stale /
// cancelled approval explains itself and points at 停止委托; starting reads 已接收. r295: a card whose approval went stale
// re-reads the ask once so the renewed approval (still the owner's to decide) replaces it.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpgradeApprovalRead } from "../src/shared/delegationUpgradePreview";
import type { AskSummary } from "../src/shared/ipc";
import { OWNER_ACCESS } from "../src/shared/users";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { zhHantCN } from "../src/renderer/src/i18n/zh-Hant-CN";
import { zhCN as approvalsZh } from "../src/renderer/src/modules/approvals/i18n";
import { en as approvalsEn } from "../src/renderer/src/modules/approvals/i18n.en";
import { zhCN as routingZh } from "../src/renderer/src/modules/delegations/upgradeRoutingMessages";
import { en as routingEn } from "../src/renderer/src/modules/delegations/upgradeRoutingMessages.en";
import { zhCN as treeZh } from "../src/renderer/src/modules/delegations/upgradeTreeMessages";

const fx = vi.hoisted(() => ({ record: null as UpgradeApprovalRead | null, refresh: vi.fn(async () => null) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (s: unknown) => unknown) => select({}), featuresOf: () => new Set(["owner-approvals", "delegation-review-refs"]) }));
vi.mock("../src/renderer/src/lib/hostAccess", () => ({ useHostAccess: () => OWNER_ACCESS }));
vi.mock("../src/renderer/src/lib/approvalDecision", () => ({ decideRoutingReviewOn: vi.fn() }));
vi.mock("../src/renderer/src/lib/delegationMenu", () => ({ runDelegationCommand: vi.fn() }));
vi.mock("../src/renderer/src/lib/routingReviews", () => ({ ROUTING_REVIEW_FEATURE: "delegation-review-refs", useRoutingOperation: () => null, useRoutingReview: () => ({ record: fx.record, error: false }), refreshRoutingReviews: vi.fn(), checkRoutingOutcome: vi.fn() }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ refreshDelegation: fx.refresh }));
vi.mock("../src/renderer/src/components/DelegationReviewerGrant", () => ({ DelegationReviewerGrant: () => null }));
const { RoutingDelegationReview } = await import("../src/renderer/src/components/RoutingReview");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const record = (patch: Partial<UpgradeApprovalRead> = {}) => ({ id: "routing-old", revision: 3, projectId: "p", delegationRef: { hostId: "local", id: "ask-a" }, state: "pending", allowedActions: { approve: true, deny: true }, ...patch }) as UpgradeApprovalRead;
const d = (patch: Partial<AskSummary> = {}) => ({ askId: "ask-a", title: "t", execution: "pendingReview", revision: 1, closed: null, ...patch }) as AskSummary;
const ref = { kind: "routing" as const, approvalId: "routing-old", projectId: "p" };

beforeEach(() => fx.refresh.mockClear());

describe("wording (owner 2026-11-25)", () => {
  const routingKeys = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith("delegation.routing.") || k.startsWith("delegations.upgrade.routing.") || k === "delegations.upgrade.tree.op.policy");
  it("no 路由 and no 审核 on the delegation approval surfaces (zh-CN, zh-Hant), no routing / review in en", () => {
    const zh = routingKeys({ ...zhCN, ...routingZh, ...treeZh } as Record<string, string>);
    expect(zh.length).toBeGreaterThan(30);
    expect(zh.filter(([, v]) => /路由|审核/.test(v))).toEqual([]);
    expect(routingKeys(zhHantCN as Record<string, string>).filter(([, v]) => /路由|審核|審覈/.test(v))).toEqual([]);
    expect(routingKeys({ ...en, ...routingEn } as Record<string, string>).filter(([, v]) => /\brout(e|ing)\b|\breview/i.test(v))).toEqual([]);
    expect(zhCN["delegation.routing.title"]).toBe("委托审批");
    for (const k of ["delegation.review.lead", "delegation.status.remoteReview", "queue.turn.stripReview", "nextUp.state.review", "agentStatus.reason.review"] as const) expect(zhCN[k], k).not.toContain("审核");
  });
  it("consumed reads 已生效 / Applied", () => {
    expect(approvalsZh["approvals.state.consumed"]).toBe("已生效");
    expect(approvalsEn["approvals.state.consumed"]).toBe("Applied");
  });
  it("stale / cancelled labels and their hover", () => {
    expect(zhCN["delegation.routing.stale"]).toBe("已失效（原请求已变化）");
    expect(zhCN["delegation.routing.cancelled"]).toBe("已取消");
    expect(zhCN["delegation.routing.closedHint"]).toBe("此审批请求已失效。要停止相关委托，请使用「停止委托」。");
    expect(en["delegation.routing.closedHint"]).toBe("This approval request is no longer valid. To stop the related delegation, use Stop delegation.");
  });
  it("starting reads 已接收 / Accepted with its hover", () => {
    expect(zhCN["delegation.status.starting"]).toBe("已接收");
    expect(en["delegation.status.starting"]).toBe("Accepted");
    expect(zhCN["delegation.statusHint.starting"]).toBe("对方已收到，还没开始");
    expect(zhHantCN["delegation.status.starting"]).toBe("已接收");
  });
});

describe("a stale approval on a card (r295)", () => {
  const mount = async (rec: UpgradeApprovalRead, ask = d()) => {
    fx.record = rec;
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(h(RoutingDelegationReview, { d: ask, host: "local", variant: "card", refValue: ref })));
    return { host, root };
  };
  it("shows 已失效 with its hover, no decisions, and re-reads the ask once for the renewed approval", async () => {
    const { host, root } = await mount(record({ state: "stale" }));
    expect(host.textContent).toContain("delegation.routing.stale");
    expect(host.querySelector("[title='delegation.routing.closedHint']")).not.toBeNull();
    expect(host.querySelector("[data-routing-decision]")).toBeNull();
    expect(fx.refresh).toHaveBeenCalledTimes(1);
    expect(fx.refresh).toHaveBeenCalledWith("local", "ask-a");
    await act(async () => root.render(h(RoutingDelegationReview, { d: d(), host: "local", variant: "card", refValue: ref })));
    expect(fx.refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
  it("a pending or cancelled approval, or a queued ask, does not re-read", async () => {
    for (const [rec, ask] of [[record(), d()], [record({ state: "cancelled" }), d()], [record({ state: "stale" }), d({ execution: "queued" })]] as const) {
      const { root } = await mount(rec, ask);
      act(() => root.unmount());
    }
    expect(fx.refresh).not.toHaveBeenCalled();
  });
});
