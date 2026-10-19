import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AskSummary } from "../src/shared/ipc";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import { agentDelegations } from "../src/renderer/src/lib/delegations";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en as moduleEn, zhCN as moduleZh } from "../src/renderer/src/modules/delegations/i18n";

const state = vi.hoisted(() => ({ locale: "zh-CN", offline: true, record: null as AskSummary | null }));
const catalogs: Record<string, Record<string, string>> = { en: { ...en, ...moduleEn }, "zh-CN": { ...zhCN, ...moduleZh } };
const t = (key: string, params: Record<string, string | number> = {}) => (catalogs[state.locale]![key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: state.locale, t }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (value: unknown) => unknown) => select({ features: new Set(), activity: {} }), agentHost: () => "local", featuresOf: (s: { features: ReadonlySet<string> }) => s.features, selectedFeatures: (s: { features: ReadonlySet<string> }) => s.features }));
vi.mock("../src/renderer/src/lib/delegationsView", () => ({
  useDelegationContext: () => () => ({ targetOffline: state.offline }),
  useAgentNames: () => (id: string) => id,
  useAgentHost: () => "local",
  useStatusWord: () => (status: { key: string; n?: number }, name: string) => t(`delegation.status.${status.key}`, { name, n: status.n ?? "" }),
  useCardDelegation: () => ({ d: state.record, live: true }),
  useResolvedAskId: (id: string) => id,
  useAgentProfile: () => null,
  useOwnerSteered: () => false,
}));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({ hasDelegationViews: () => true }));
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
vi.mock("../src/renderer/src/lib/approvalDecision", () => ({ useAskReview: () => ({ record: null, canDecide: false, approvalsPage: false }), decideApprovalOn: vi.fn() }));

import { DelegationCard } from "../src/renderer/src/components/DelegationCard";
import { DelegationsBody, DelegationsMeta } from "../src/renderer/src/modules/delegations/DelegationStatus";

const ask = (over: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-1", title: "Review", requester: { kind: "agent", cutexSessionId: "lead" }, target: "worker",
  targetName: "proj-glm-research-r1", execution: "running", review: "abandoned", closed: null,
  attempts: 1, attempt: { n: 1, state: "running" }, revision: 1,
  createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", ...over,
});
const item: RawItem = { id: "delegate-1", type: "mcpToolCall", server: "cutex", tool: "agent_delegate", arguments: { target: "worker", text: "Review" }, result: { structuredContent: { delegation_id: "ask-1" } } };
const card = () => renderToStaticMarkup(createElement(DelegationCard, { item, sessionId: "lead" }));

describe.each(["zh-CN", "en"])("delegation presentation (%s)", (locale) => {
  beforeEach(() => { state.locale = locale; state.offline = true; });
  it("renders pending abandon consistently in the header, row and card", () => {
    state.record = ask();
    const data = agentDelegations({ "ask-1": state.record }, "lead");
    const header = renderToStaticMarkup(createElement(DelegationsMeta, { data }));
    const body = renderToStaticMarkup(createElement(DelegationsBody, { sessionId: "lead", data }));
    const word = t("delegation.status.abandoningOffline", { name: "proj-glm-research-r1" });
    expect(header).not.toContain(t("delegations.running", { n: 1 }));
    expect(body).toContain(word);
    expect(body).not.toContain(`>${t("delegation.stop")}</button>`);
    expect(card()).toContain(word);
  });

  it.each(["abandoned", "accepted", "completed"] as const)("keeps %s closed despite an old running attempt and hold", (closed) => {
    state.record = ask({ execution: "admitted", review: null, closed, hold: { reason: "targetBusy" } });
    const data = agentDelegations({ "ask-1": state.record }, "lead");
    const header = renderToStaticMarkup(createElement(DelegationsMeta, { data }));
    const body = renderToStaticMarkup(createElement(DelegationsBody, { sessionId: "lead", data }));
    expect(header).toBe("");
    expect(body).toContain(t("delegations.closed", { n: 1 }));
    expect(body).not.toContain(`>${t("delegation.stop")}</button>`);
    expect(card()).toContain(t(`delegation.status.${closed === "completed" ? "ended" : closed}`));
  });

  it("does not let a hold override an admitted abandon", () => {
    state.record = ask({ execution: "admitted", hold: { reason: "targetBusy" } });
    expect(card()).toContain(t("delegation.status.abandoningOffline", { name: "proj-glm-research-r1" }));
  });

  it("still counts a genuinely running delegation and offers stop", () => {
    state.offline = false;
    state.record = ask({ review: null });
    const data = agentDelegations({ "ask-1": state.record }, "lead");
    expect(renderToStaticMarkup(createElement(DelegationsMeta, { data }))).toContain(t("delegations.running", { n: 1 }));
    expect(renderToStaticMarkup(createElement(DelegationsBody, { sessionId: "lead", data }))).toContain(`>${t("delegation.stop")}</button>`);
    expect(card()).toContain(t("delegation.status.running"));
  });
});
