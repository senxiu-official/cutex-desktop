// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApprovalRule, ApprovalRulesView, DaemonApi } from "../src/shared/ipc";
const fx = vi.hoisted(() => ({ profiles: null as any, list: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => {} }, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/components/TypedRuleConfirmation", () => ({ TypedRuleConfirmation: () => h("div", { role: "dialog" }) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfileList: () => fx.profiles, loadProfileList: fx.list }));
import { CutexRulesPanel, kindState, type CutexRulesPanelProps } from "../src/renderer/src/components/CutexRulesChip";
import { rememberApprovalRules } from "../src/renderer/src/lib/rulesSnapshot";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { APPROVAL_RULE_KINDS } from "../src/renderer/src/lib/approvalRuleKinds";
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const rules = (): ApprovalRule[] => (["service_lifetime", "ask_delivery", "browser_open"] as const).map((kind) => ({
  ruleId: `role-${kind}`, revision: 1, enabled: true, subject: { type: "agent", cutexSessionId: "s", displayName: "Fixture" },
  kinds: [kind], constraints: {}, expiry: { mode: "revoked" }, highRiskKindsExplicit: [],
  createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", createdBy: "system", grantedBy: "role:director", source: "role", expired: false,
}));
const view = (): ApprovalRulesView => ({ contractVersion: 1, hostId: "fixture", revision: 4, rules: rules(), catalog: [] });
const props = (api: Partial<DaemonApi>): CutexRulesPanelProps => ({
  hostId: "fixture", api: api as DaemonApi, sessionId: "s", displayName: "Fixture", profile: "claude", projectId: "project", runtimeGeneration: 1, turnId: "turn",
  capabilityFacts: { formalAgent: true, hostFeatures: new Set(["services", "workflows", "agent-asks"]), isDirector: true, declaredTools: null, agentCreate: true }, identityRole: "director",
});
let el: HTMLDivElement, root: Root;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { fireHostReset("fixture"); fx.profiles = { profiles: [{ id: "claude", name: "claude" }] }; fx.list.mockReset().mockResolvedValue(fx.profiles); el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(() => { act(() => root.unmount()); el.remove(); });

const owned = (ruleId: string, kinds: ApprovalRule["kinds"], mode: ApprovalRule["expiry"]["mode"], extra: Partial<ApprovalRule> = {}): ApprovalRule => ({
  ...rules()[0]!, ruleId, kinds, expiry: { mode, ...(mode === "hour" ? { expiresAt: "2026-10-26T10:30:00Z" } : {}) }, grantedBy: undefined, source: "owner", createdBy: "owner", projectId: "project", ...extra,
} as ApprovalRule);
const sw = (kind: string) => el.querySelector<HTMLButtonElement>(`[data-rule-switch=${kind}]`)!;

it("keeps the panel's shape while loading: rows and footer are there, switches wait for the rules", async () => {
  fx.profiles = null;
  const profiles = deferred<any>(), approval = deferred<ApprovalRulesView>();
  fx.list.mockReturnValue(profiles.promise); const read = vi.fn(() => approval.promise);
  await act(async () => root.render(h(CutexRulesPanel, props({ approvalRules: read }))));
  expect(read).toHaveBeenCalledOnce(); expect(fx.list).toHaveBeenCalledOnce();
  expect(el.querySelector('[data-rules-skeleton][aria-busy="true"]')).not.toBeNull();
  expect(el.querySelector("[data-approval-rule-create]")).not.toBeNull();
  expect([...el.querySelectorAll<HTMLButtonElement>("[data-rule-switch]")].every((b) => b.disabled)).toBe(true);
  await act(async () => approval.resolve(view()));
  expect(el.querySelector("[data-rules-skeleton]")).toBeNull();
  expect(sw("service_lifetime").getAttribute("aria-checked")).toBe("true");
  await act(async () => profiles.resolve({ profiles: [{ name: "claude", browserTools: true }] }));
});

it("shows warm rules immediately and does not re-read an already cached profile list", async () => {
  rememberApprovalRules("fixture", view()); const read = vi.fn().mockResolvedValue(view());
  act(() => root.render(h(CutexRulesPanel, props({ approvalRules: read }))));
  expect(el.querySelector("[data-rules-skeleton]")).toBeNull();
  expect(sw("ask_delivery").getAttribute("aria-checked")).toBe("true");
  await act(async () => {});
  expect(read).not.toHaveBeenCalled(); expect(fx.list).not.toHaveBeenCalled();
});

it("one row per action type; a Director grant pauses as a unit and is never deleted", async () => {
  const initial = view(), updated = { ...initial, revision: 5, rules: initial.rules.map((r) => r.kinds[0] === "service_lifetime" ? { ...r, enabled: false } : r) };
  const read = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated), patch = vi.fn().mockResolvedValue({}), del = vi.fn();
  await act(async () => root.render(h(CutexRulesPanel, props({ approvalRules: read, patchApprovalRule: patch, deleteApprovalRule: del }))));
  expect(el.querySelectorAll("[data-rule-kind]")).toHaveLength(APPROVAL_RULE_KINDS.length);
  expect(el.querySelector("[data-approval-identity=director]")).not.toBeNull();
  await act(async () => sw("service_lifetime").click());
  expect(patch).toHaveBeenCalledWith("role-service_lifetime", 4, expect.objectContaining({ enabled: false, kinds: ["service_lifetime"] }));
  expect(del).not.toHaveBeenCalled();
  expect(sw("service_lifetime").getAttribute("aria-checked")).toBe("false");
  expect(el.querySelector("[data-rule-kind=service_lifetime]")!.textContent).toContain("approvals.rules.state.paused");
});

it("plans: one-type rules are revoked, 这一轮 / 一直 rules narrow exactly, 1 小时 / 今天 rules ask first", () => {
  const single = owned("one", ["browser_open"], "hour");
  expect(kindState("browser_open", [single]).plan).toEqual([{ action: "revoke", rule: single }]);
  const forever = owned("many", ["browser_claim", "ask_delivery"], "revoked", { highRiskKindsExplicit: ["browser_claim"] });
  const [narrow] = kindState("browser_claim", [forever]).plan;
  expect(narrow).toMatchObject({ action: "narrow", draft: { kinds: ["ask_delivery"], highRiskKindsExplicit: [], expiry: forever.expiry, projectId: "project", subject: forever.subject } });
  const hour = owned("legacy", ["static_root", "workflow_run"], "hour");
  expect(kindState("static_root", [hour]).plan).toEqual([{ action: "askRevokeAll", rule: hour, others: ["workflow_run"] }]);
  // The r263 capability (keeps the deadline on a non-expanding replace) turns the question into an exact narrowing.
  expect(kindState("static_root", [hour], true).plan[0]).toMatchObject({ action: "narrow", draft: { kinds: ["workflow_run"], expiry: hour.expiry } });
  expect(kindState("managed_service", [hour]).plan).toEqual([{ action: "create" }]);
  expect(kindState("managed_service", [owned("off", ["managed_service"], "today", { enabled: false })]).on).toBe(false);
});

it("a multi-type 1 小时 rule: nothing changes until 整条撤销, cancel leaves it alone", async () => {
  const legacy = owned("legacy", ["static_root", "workflow_run"], "hour");
  const initial = { ...view(), rules: [...rules(), legacy] }, after = { ...initial, revision: 5, rules: rules() };
  const read = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(after), patch = vi.fn(), del = vi.fn().mockResolvedValue({});
  await act(async () => root.render(h(CutexRulesPanel, props({ approvalRules: read, patchApprovalRule: patch, deleteApprovalRule: del }))));
  const row = el.querySelector("[data-rule-kind=static_root]")!;
  expect(row.textContent).toContain("approvals.rules.state.shared");
  await act(async () => sw("static_root").click());
  expect(el.querySelector("[data-rule-ask]")).not.toBeNull();
  expect(patch).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
  const cancel = [...el.querySelectorAll<HTMLButtonElement>("[data-rule-ask] button")].find((b) => b.textContent === "approvals.rules.cancel")!;
  await act(async () => cancel.click());
  expect(el.querySelector("[data-rule-ask]")).toBeNull(); expect(del).not.toHaveBeenCalled();
  await act(async () => sw("static_root").click());
  await act(async () => el.querySelector<HTMLButtonElement>("[data-rule-revoke-all]")!.click());
  expect(del).toHaveBeenCalledWith("legacy", 4); expect(patch).not.toHaveBeenCalled();
  expect(sw("workflow_run").getAttribute("aria-checked")).toBe("false");
});

it("turning a type on makes a one-type rule with the footer's expiry; high-risk types need the typed confirmation", async () => {
  const create = vi.fn().mockResolvedValue({}), confirm = vi.fn().mockResolvedValue({ confirmationToken: "tok" });
  const catalog = [{ kind: "managed_service", risk: "high" }, { kind: "browser_open", risk: "medium" }] as ApprovalRulesView["catalog"];
  const read = vi.fn().mockResolvedValue({ ...view(), catalog });
  await act(async () => root.render(h(CutexRulesPanel, props({ approvalRules: read, createApprovalRule: create, confirmApprovalRule: confirm }))));
  const today = [...el.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === "approvals.rules.expiryShort.today")!;
  await act(async () => today.click());
  await act(async () => sw("workflow_run").click());
  expect(create).toHaveBeenCalledWith(4, expect.objectContaining({ kinds: ["workflow_run"], expiry: { mode: "today" }, projectId: "project", highRiskKindsExplicit: [] }));
  create.mockClear();
  await act(async () => sw("managed_service").click());
  expect(create).not.toHaveBeenCalled();
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
  expect(el.querySelector("[data-risk=high]")).not.toBeNull();
});

it("on a host with approval-rule-exact-narrow, a multi-type 1 小时 rule loses just this type, keeping its deadline", async () => {
  const legacy = owned("legacy", ["static_root", "workflow_run"], "hour", { highRiskKindsExplicit: ["static_root", "workflow_run"] });
  const read = vi.fn().mockResolvedValue({ ...view(), rules: [...rules(), legacy] }), patch = vi.fn().mockResolvedValue({}), del = vi.fn();
  const base = props({ approvalRules: read, patchApprovalRule: patch, deleteApprovalRule: del });
  const flagged = { ...base, capabilityFacts: { ...base.capabilityFacts, hostFeatures: new Set([...base.capabilityFacts.hostFeatures!, "approval-rule-exact-narrow"]) } };
  await act(async () => root.render(h(CutexRulesPanel, flagged)));
  await act(async () => sw("static_root").click());
  expect(el.querySelector("[data-rule-ask]")).toBeNull(); expect(del).not.toHaveBeenCalled();
  expect(patch).toHaveBeenCalledWith("legacy", 4, expect.objectContaining({ kinds: ["workflow_run"], highRiskKindsExplicit: ["workflow_run"], expiry: legacy.expiry, projectId: "project" }));
});
