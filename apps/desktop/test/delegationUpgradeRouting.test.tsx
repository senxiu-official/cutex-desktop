// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpgradeRouting } from "../src/renderer/src/modules/delegations/UpgradeRouting";
import type { UpgradeActor, UpgradeApproval, UpgradeGrant, UpgradeNode, UpgradeSectionProps, UpgradePanelSnapshot as UpgradeSnapshot } from "../src/renderer/src/modules/delegations/upgradeTypes";
import { zhCN } from "../src/renderer/src/modules/delegations/upgradeRoutingMessages";
import { en } from "../src/renderer/src/modules/delegations/upgradeRoutingMessages.en";
import { applyTerms, DEFAULT_TERMS } from "../src/renderer/src/lib/terms";
import { formatWhen } from "../src/renderer/src/lib/time";

const language = vi.hoisted(() => ({ locale: "en", customTerms: false }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({
  locale: language.locale === "en" ? "en" : "zh-CN",
  t: (key: keyof typeof en, params: Record<string, string | number> = {}) => {
    const catalog = language.locale === "en" ? en : zhCN;
    if (!(key in catalog)) throw new Error(`Missing routing message: ${key}`);
    const locale = language.locale === "en" ? "en" : "zh-CN";
    const defaults = DEFAULT_TERMS[locale];
    const terms = language.customTerms ? {
      ...defaults, owner: { one: "captain", many: "captains" },
      agent: { one: "worker", many: "workers" }, director: { one: "chief", many: "chiefs" },
    } : defaults;
    return applyTerms(catalog[key], terms, locale).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
  },
}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refValue = (id: string, hostId = "host") => JSON.stringify([hostId, id]);
const owner: UpgradeActor = { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false };
const visibleAgent: UpgradeActor = { kind: "agent", hostId: "host", sessionId: "a", name: "Historical A", redacted: false };
const redacted: UpgradeActor = { kind: "agent", hostId: null, sessionId: null, name: null, redacted: true };
function node(id: string, state: UpgradeApproval["state"] = "pending", hostId = "host"): UpgradeNode {
  const ref = { id, hostId };
  return { kind: "delegation", id, hostId, ref, projectId: "project", parentId: null, rootId: id, followUpOf: null,
    parent: null, parentState: "none", redactedParentRef: null, root: ref, rootState: "visible", redactedRootRef: null,
    followUp: null, followUpState: "none", parentAttemptId: null,
    lineageState: "verified", redactedParent: false, requester: { id: "a", hostId: "host", name: "Requester A" },
    target: { id: "b", hostId: "host", name: "Target B" }, title: id, execution: "queued", closed: null,
    lastActivityAt: null, resumeEvidence: { kind: "none" }, continuation: null,
    routingApproval: { id: `approval-${id}`, state, requestDigest: `digest-${id}`, revision: 7,
      policyRevision: 12, authorityEpoch: 4, requestedBy: visibleAgent, decidedBy: null, decisionAuthority: null,
      decisionNote: null, createdAt: "2026-10-26T01:00:00Z", decidedAt: null,
      allowedActions: { approve: true, deny: true } },
    allowedActions: { readAttempts: false, stop: false, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 99 };
}
function grant(id = "grant-1", revoke = true): UpgradeGrant {
  return { id, projectId: "project",
    requesterRef: { hostId: "host", id: "a" }, targetRefs: [{ hostId: "host", id: "b" }], rootDelegationRef: { hostId: "host", id: "root" },
    purpose: "review", maxUses: 1, usedCount: 0, expiresAt: null, authorityEpoch: 4, revision: 2, revokedAt: null, allowedActions: { revoke } };
}
function snapshot(): UpgradeSnapshot {
  return { projectId: "project", revision: "91", nodes: [node("root"), node("stale-root", "stale")], nextCursor: null,
    coverage: "complete", unresolvedEdges: [],
    parties: ["a", "b"].map(id => ({ id, hostId: "host", name: id })),
    approvals: [node("root"), node("stale-root", "stale")].map(node => ({ ...(node.routingApproval as UpgradeApproval), projectId: "project", delegationRef: node.ref })),
    policy: { revision: 17, memberMode: "approvalRequired", allowedActions: { update: true } },
    runControl: { epoch: 1, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: false, pauseAll: false, resume: false } },
    members: ["a", "b"].map(id => ({ id, hostId: "host", name: id, director: true, lastActivityAt: null, observedAt: "2026-10-26", activityStatus: "unknown", archiveKind: "active", restorable: false, allowedActions: [], restoreBlockers: [] })),
    grants: { items: [grant()], allowedActions: { create: true } },
    interruptedDelegations: [], caller: { isOwner: false, canManageMembers: false, canOfflineMembers: false } };
}
let props: UpgradeSectionProps;
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  language.locale = "en";
  language.customTerms = false;
  props = { snapshot: snapshot(), busy: false, onAction: vi.fn().mockResolvedValue(undefined) };
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(() => root.render(h(UpgradeRouting, props)));
function button(name: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(el => el.textContent === name);
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
function card(title: string): HTMLElement {
  const found = [...host.querySelectorAll("article")].find(el => el.querySelector("h3")?.textContent === title);
  if (!found) throw new Error(`Missing card: ${title}`);
  return found;
}
function select(label: string): HTMLSelectElement {
  const found = [...host.querySelectorAll("label")].find(el => el.firstChild?.textContent === label)?.querySelector("select");
  if (!found) throw new Error(`Missing select: ${label}`);
  return found;
}
function radio(label: string): HTMLInputElement {
  const found = [...host.querySelectorAll("label")].find(el => el.textContent === label)?.querySelector("input");
  if (!found) throw new Error(`Missing radio: ${label}`);
  return found;
}
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
function change(label: string, value: string) {
  act(() => { const el = select(label); el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function submitGrant() {
  await act(async () => button("Create one-use grant").closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
function fillGrant() { change("Requester", refValue("a")); change("Target", refValue("b")); change("Root delegation", refValue("root")); }
function delegation(index = 0): UpgradeNode {
  const entry = props.snapshot.nodes[index];
  if (entry?.kind !== "delegation") throw new Error("Expected a real delegation fixture");
  return entry;
}
function approval(index = 0): UpgradeApproval {
  const entry = props.snapshot.approvals[index];
  if (!entry) throw new Error("Expected an approval fixture");
  return entry;
}

describe("routing approval controls", () => {
  it.each(["Approve", "Deny"])("%s sends the approval digest and revision, not node or snapshot revision", async label => {
    render();
    await click(button(label, card("root")));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ kind: "decision", approvalId: "approval-root", decision: label === "Approve" ? "approve" : "deny", expectedDigest: "digest-root", expectedRevision: 7 });
  });
  it("uses approval permissions independently of policy permission or member roles and blocks stale approvals", async () => {
    approval().allowedActions = { approve: false, deny: false };
    render();
    for (const title of ["root", "stale-root"]) for (const label of ["Approve", "Deny"]) {
      const control = button(label, card(title));
      expect(control.disabled).toBe(true);
      await click(control);
    }
    expect(host.textContent).toContain("Approval is stale; refresh before reviewing");
    expect(props.onAction).not.toHaveBeenCalled();
  });
  it("allows approval even when policy update and grant creation are forbidden", async () => {
    props.snapshot.policy.allowedActions.update = false;
    props.snapshot.grants.allowedActions.create = false;
    render();
    await click(button("Approve", card("root")));
    expect(props.onAction).toHaveBeenCalledOnce();
  });
  it("uses fresh approval evidence after a snapshot refresh", async () => {
    render();
    props.snapshot = snapshot();
    approval().requestDigest = "new-digest";
    approval().revision = 8;
    render();
    await click(button("Deny", card("root")));
    expect(props.onAction).toHaveBeenCalledWith(expect.objectContaining({ expectedDigest: "new-digest", expectedRevision: 8 }));
  });
  it.each([
    { approve: false, deny: false }, { approve: false, deny: true },
    { approve: true, deny: false }, { approve: true, deny: true },
  ])("honors each approval flag separately: %o", async flags => {
    approval().allowedActions = flags;
    props.snapshot.policy.allowedActions.update = false;
    props.snapshot.grants.allowedActions.create = false;
    // Current caller and member roles cannot add or remove these resource flags.
    props.snapshot.caller.isOwner = true;
    render();
    expect(button("Approve", card("root")).disabled).toBe(!flags.approve);
    expect(button("Deny", card("root")).disabled).toBe(!flags.deny);
    await click(button("Approve", card("root")));
    await click(button("Deny", card("root")));
    expect(props.onAction).toHaveBeenCalledTimes(Number(flags.approve) + Number(flags.deny));
  });
  it.each(["approved", "denied", "stale", "cancelled"] as const)("retains %s audit without granting new decisions from the historical owner", async state => {
    approval().state = state;
    approval().decidedBy = owner;
    approval().decisionAuthority = "owner";
    approval().decidedAt = "2026-10-26T02:00:00Z";
    // Even inconsistent true flags cannot reopen a terminal/stale approval.
    approval().allowedActions = { approve: true, deny: true };
    render();
    expect(card("root").textContent).toContain("Decided by: Owner");
    expect(card("root").textContent).toContain("Authority at decision time: Owner");
    // Decided at reads like the app's other time labels (lib/time formatWhen); the exact ISO is the tooltip.
    const decidedAt = [...card("root").querySelectorAll("p")].find(p => p.textContent?.startsWith("Decided at:"))!;
    expect(decidedAt.textContent).toBe(`Decided at: ${formatWhen(Date.parse("2026-10-26T02:00:00Z") / 1000, Date.now(), "en")}`);
    expect(decidedAt.textContent).not.toContain("T02:00:00Z");
    expect(decidedAt.title).toBe("2026-10-26T02:00:00Z");
    for (const label of ["Approve", "Deny"]) {
      expect(button(label, card("root")).disabled).toBe(true);
      await click(button(label, card("root")));
    }
    expect(props.onAction).not.toHaveBeenCalled();
  });
  it("writes 决定时间 in the app locale and keeps the ISO as the tooltip", () => {
    language.locale = "zh-CN";
    approval().state = "approved";
    const iso = new Date(Date.now() - 5.5 * 60_000).toISOString();
    approval().decidedAt = iso;
    render();
    const decidedAt = [...card("root").querySelectorAll("p")].find(p => p.textContent?.startsWith("决定时间"))!;
    expect(decidedAt.textContent).toBe("决定时间: 5 分钟前");
    expect(decidedAt.title).toBe(iso);
  });
  it.each([
    { actor: owner, authority: "owner", text: "Owner" },
    { actor: visibleAgent, authority: "director", text: "Agent: Historical A (host · a)" },
    { actor: redacted, authority: "director", text: "Identity restricted" },
    { actor: null, authority: null, text: "Identity unknown" },
  ] satisfies { actor: UpgradeActor | null; authority: UpgradeApproval["decisionAuthority"]; text: string }[])("displays the historical audit projection: $text", ({ actor, authority, text }) => {
    approval().state = "approved";
    approval().decidedBy = actor;
    approval().decisionAuthority = authority;
    // Give all current members a different name; retain the explicit historical name.
    props.snapshot.members[0]!.name = "Current A";
    render();
    expect(card("root").textContent).toContain(`Decided by: ${text}`);
    expect(card("root").textContent).toContain(`Authority at decision time: ${authority === "owner" ? "Owner" : authority === "director" ? "Director authority at the time" : "Authority unknown"}`);
    expect(button("Approve", card("root")).disabled).toBe(true);
  });
  it("shows requested actor redaction and never substitutes current member names for unknown historical names", () => {
    approval().requestedBy = redacted;
    approval().decidedBy = { kind: "agent", hostId: "remote", sessionId: "a", name: null, redacted: false };
    approval().decisionAuthority = "director";
    props.snapshot.members[0]!.name = "Wrong-host name";
    render();
    expect(card("root").textContent).toContain("Requested by: Identity restricted");
    expect(card("root").textContent).toContain("Decided by: Agent: Identity unknown (remote · a)");
    expect(card("root").textContent).not.toContain("Wrong-host name");
    props.snapshot.parties.push({ ...props.snapshot.parties[0]!, hostId: "remote", name: "Remote A" });
    render();
    expect(card("root").textContent).toContain("Decided by: Agent: Identity unknown (remote · a)");
    expect(card("root").textContent).not.toContain("Remote A");
  });
  it("renders notes as plain text, preserves 200 Unicode scalars, and sends no actor or note fields", async () => {
    const note = '<img src=x onerror="alert(1)"> ' + "🙂".repeat(169);
    expect(Array.from(note)).toHaveLength(200);
    approval().decisionNote = note;
    render();
    expect(card("root").textContent).toContain(`Decision note: ${note}`);
    expect(card("root").querySelector("img")).toBeNull();
    await click(button("Approve", card("root")));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ kind: "decision", approvalId: "approval-root", decision: "approve", expectedDigest: "digest-root", expectedRevision: 7 });
  });
  it.each(["en", "zh-CN"])("renders all audit roles using custom terms in %s", locale => {
    language.locale = locale;
    language.customTerms = true;
    approval().requestedBy = owner;
    approval().decidedBy = visibleAgent;
    approval().decisionAuthority = "director";
    render();
    expect(card("root").textContent).toContain(locale === "en" ? "Requested by: Captain" : "申请者: captain");
    expect(card("root").textContent).toContain(locale === "en" ? "Worker: Historical A (host · a)" : "worker：Historical A（host · a）");
    expect(card("root").textContent).toContain(locale === "en" ? "Chief authority at the time" : "当时的 chief 权限");
    expect(card("root").textContent).not.toContain("{{");
  });
});

describe("policy and scoped grants", () => {
  it.each(["Allowlisted only", "Open (not recommended)"])("updates %s with the policy revision", async label => {
    render();
    expect(radio("Approval required (default)").checked).toBe(true);
    await click(radio(label));
    expect(props.onAction).toHaveBeenCalledWith({ kind: "policy", memberMode: label === "Allowlisted only" ? "allowlistedOnly" : "open", expectedRevision: 17 });
    expect(host.textContent).toContain("Changing the policy does not bypass other permission checks.");
    expect(host.textContent).toContain("Open mode lets member routing skip individual approval");
  });
  it("blocks policy without update permission while allowing independently authorized grants and revocation", async () => {
    props.snapshot.policy.allowedActions.update = false;
    render();
    for (const control of host.querySelectorAll("input")) expect(control.matches(":disabled")).toBe(true);
    for (const control of host.querySelectorAll("select")) expect(control.matches(":disabled")).toBe(false);
    await click(radio("Open (not recommended)"));
    expect(props.onAction).not.toHaveBeenCalled();
    await click(button("Revoke"));
    fillGrant();
    await submitGrant();
    expect(props.onAction).toHaveBeenCalledTimes(2);
    expect(props.onAction).toHaveBeenNthCalledWith(1, { kind: "revoke", grantId: "grant-1", expectedRevision: 2 });
    expect(props.onAction).toHaveBeenNthCalledWith(2, { kind: "grant", requesterRef: { hostId: "host", id: "a" }, targetRefs: [{ hostId: "host", id: "b" }], rootDelegationRef: { hostId: "host", id: "root" }, maxUses: 1 });
  });
  it("does not borrow policy update permission for grant creation or per-grant revocation", async () => {
    props.snapshot.grants.allowedActions.create = false;
    props.snapshot.grants.items[0]!.allowedActions.revoke = false;
    render();
    expect(radio("Open (not recommended)").matches(":disabled")).toBe(false);
    for (const control of [...host.querySelectorAll("select"), button("Create one-use grant"), button("Revoke")]) expect(control.matches(":disabled")).toBe(true);
    fillGrant();
    await submitGrant();
    await click(button("Revoke"));
    expect(props.onAction).not.toHaveBeenCalled();
  });
  it("uses each grant's revoke flag even when creation is forbidden and usage is exhausted", async () => {
    props.snapshot.policy.allowedActions.update = false;
    props.snapshot.grants.allowedActions.create = false;
    props.snapshot.grants.items = [grant("blocked", false), { ...grant("exhausted"), usedCount: 1 }];
    render();
    const buttons = [...host.querySelectorAll("button")].filter(el => el.textContent === "Revoke");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
    await click(buttons[0]!);
    await click(buttons[1]!);
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ kind: "revoke", grantId: "exhausted", expectedRevision: 2 });
  });
  it("creates only the selected requester, target, root with maxUses 1", async () => {
    render(); fillGrant();
    await click(button("Create one-use grant"));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ kind: "grant", requesterRef: { hostId: "host", id: "a" }, targetRefs: [{ hostId: "host", id: "b" }], rootDelegationRef: { hostId: "host", id: "root" }, maxUses: 1 });
  });
  it("requires all selections and rejects targeting oneself even on direct form submit", async () => {
    render();
    expect(button("Create one-use grant").disabled).toBe(true);
    fillGrant(); change("Requester", refValue("b"));
    expect(button("Create one-use grant").disabled).toBe(true);
    expect([...select("Target").options].find(option => option.value === refValue("b"))?.disabled).toBe(true);
    await submitGrant();
    expect(props.onAction).not.toHaveBeenCalled();
  });
  it("offers only verified visible unclosed roots and rejects a root closed by refresh", async () => {
    const child = node("child"); child.parentId = "root"; child.rootId = "root";
    child.parentState = "visible"; child.parent = { hostId: "host", id: "root" }; child.root = child.parent;
    const legacy = node("legacy"); legacy.lineageState = "legacyUnknown";
    const redacted = node("redacted"); redacted.redactedParent = true;
    const closed = node("closed"); closed.closed = "accepted";
    props.snapshot.nodes.push(child, legacy, redacted, closed);
    render();
    expect([...select("Root delegation").options].map(option => option.value)).toEqual(["", refValue("root"), refValue("stale-root")]);
    fillGrant();
    delegation().closed = "accepted";
    render();
    expect(button("Create one-use grant").disabled).toBe(true);
    await submitGrant();
    expect(props.onAction).not.toHaveBeenCalled();
  });
  it("ignores redacted ancestors and never infers a root from legacy null IDs or unconfirmed relations", () => {
    const unknownParent = node("unknown-parent"); unknownParent.parentState = "unknown";
    const hiddenRoot = node("hidden-root"); hiddenRoot.rootState = "redacted"; hiddenRoot.root = null; hiddenRoot.redactedRootRef = { placeholderId: "root-token" };
    const unknownRoot = node("unknown-root"); unknownRoot.rootState = "unknown"; unknownRoot.root = null;
    const nonSelfRoot = node("non-self-root"); nonSelfRoot.root = { hostId: "remote", id: "non-self-root" };
    props.snapshot.nodes.push(unknownParent, hiddenRoot, unknownRoot, nonSelfRoot,
      { kind: "redactedAncestor", placeholderId: "parent-token", labelKey: "delegation.ancestorRestricted", reason: "notVisible", expandable: false, allowedActions: {} });
    render();
    expect([...select("Root delegation").options].map(option => option.value)).toEqual(["", refValue("root"), refValue("stale-root")]);
    expect(host.querySelectorAll("article")).toHaveLength(2);
    expect(host.textContent).not.toContain("parent-token");
    expect(host.textContent).not.toContain("root-token");
  });
  it("keeps same-name same-ID cross-host selections distinct and submits full refs", async () => {
    props.snapshot.parties[0]!.name = "Same name";
    props.snapshot.parties.push({ ...props.snapshot.parties[0]!, hostId: "remote" });
    props.snapshot.nodes.push(node("root", "pending", "remote"));
    render();
    for (const label of ["Requester", "Target", "Root delegation"]) {
      const options = [...select(label).options];
      expect(new Set(options.map(option => option.value)).size).toBe(options.length);
    }
    change("Requester", refValue("a", "host"));
    change("Target", refValue("a", "remote"));
    change("Root delegation", refValue("root", "remote"));
    expect([...select("Target").options].find(option => option.value === refValue("a", "host"))?.disabled).toBe(true);
    expect([...select("Target").options].find(option => option.value === refValue("a", "remote"))?.disabled).toBe(false);
    await submitGrant();
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ kind: "grant", requesterRef: { hostId: "host", id: "a" }, targetRefs: [{ hostId: "remote", id: "a" }], rootDelegationRef: { hostId: "remote", id: "root" }, maxUses: 1 });
  });
  it("displays grant names from exact member refs, all targets, and no bare-ID cross-host guesses", () => {
    props.snapshot.parties[0]!.name = "Local A";
    props.snapshot.parties.push({ ...props.snapshot.parties[0]!, hostId: "remote", name: "Remote A" });
    const item = props.snapshot.grants.items[0]!;
    item.requesterRef = { hostId: "remote", id: "a" };
    item.targetRefs = [{ hostId: "host", id: "a" }, { hostId: "unloaded", id: "a" }];
    item.rootDelegationRef = { hostId: "remote", id: "root" };
    render();
    const grantCard = button("Revoke").parentElement!;
    expect(grantCard.textContent).toContain("Remote A (remote · a) → Local A (host · a), Identity unknown (unloaded · a)");
    expect(grantCard.textContent).toContain("Root delegation: remote · root");
  });
  it.each(["Requester", "Target"])("uses the authorized party projection and rejects a %s removed after selection", async label => {
    for (const archiveKind of ["soft", "permanent", "unknown"] as const) {
      props.snapshot.members.push({ ...props.snapshot.members[0]!, id: archiveKind, archiveKind });
    }
    render();
    for (const name of ["Requester", "Target"]) expect([...select(name).options].map(option => option.value)).toEqual(["", refValue("a"), refValue("b")]);
    fillGrant();
    props.snapshot.parties = props.snapshot.parties.filter(party => party.id !== (label === "Requester" ? "a" : "b"));
    render();
    expect(button("Create one-use grant").disabled).toBe(true);
    await submitGrant();
    expect(props.onAction).not.toHaveBeenCalled();
  });
  it("shows remaining uses, revokes by grant ID, and disables busy writes", async () => {
    render();
    expect(host.textContent).toContain("1 / 1 uses remaining");
    await click(button("Revoke"));
    expect(props.onAction).toHaveBeenCalledExactlyOnceWith({ kind: "revoke", grantId: "grant-1", expectedRevision: 2 });
    props.snapshot.grants.items[0]!.revokedAt = "2026-10-26T02:00:00Z";
    props.snapshot.grants.items[0]!.usedCount = 1;
    props.busy = true;
    render();
    expect(host.textContent).toContain("0 / 1 uses remaining");
    expect(host.textContent).toContain("Revoked");
    expect([...host.querySelectorAll("button")].some(el => el.textContent === "Revoke")).toBe(false);
    for (const control of host.querySelectorAll("button")) expect(control.disabled).toBe(true);
  });
  it("reports a failed action without an automatic retry", async () => {
    props.onAction = vi.fn().mockRejectedValue(new Error("conflict"));
    render();
    await click(button("Approve", card("root")));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en["delegations.upgrade.routing.failed"]);
    expect(props.onAction).toHaveBeenCalledOnce();
  });
  it("keeps both catalogs complete and renders Chinese open and permission notices", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    expect(Object.keys(en).every(key => key.startsWith("delegations.upgrade.routing."))).toBe(true);
    language.locale = "zh-CN"; render();
    expect(radio("开放（不推荐）")).toBeTruthy();
    expect(host.textContent).toContain("策略改变不会免除其他权限检查。");
  });
});


it("offers canonical routing parties without depending on activity or archive membership fields", () => {
  props.snapshot.members = [];
  render();
  expect(select("Requester").options).toHaveLength(3);
  expect(select("Target").options).toHaveLength(3);
  expect(card("root")).not.toBeNull();
});
it("shows a full collection approval when its tree node is not on the page", () => {
  props.snapshot.nodes = [];
  render();
  expect(host.textContent).not.toContain(en["delegations.upgrade.routing.empty"]);
  expect(host.textContent).toContain("approval-root");
  expect(host.textContent).toContain("host · root");
  expect(button("Approve", card("approval-root")).disabled).toBe(false);
});
