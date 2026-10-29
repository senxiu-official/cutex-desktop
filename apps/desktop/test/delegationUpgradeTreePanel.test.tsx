// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreePanel } from "../src/renderer/src/modules/delegations/TreePanel";
import { en as moduleMessages } from "../src/renderer/src/modules/delegations/i18n.en";
import { en as treeMessages } from "../src/renderer/src/modules/delegations/upgradeTreeMessages.en";
import type { RedactedAncestor, UpgradeContinuation, UpgradeNode, UpgradeSectionProps, UpgradePanelSnapshot as UpgradeSnapshot, UpgradeTreeNode } from "../src/renderer/src/modules/delegations/upgradeTypes";

const messages: Record<string, string> = { ...moduleMessages, ...treeMessages,
  "delegations.upgrade.tree.ancestorRestricted": "Ancestor delegation is restricted",
  "delegations.upgrade.tree.unloaded": "Related delegation is not loaded",
};
function t(key: string, params: Record<string, string | number> = {}): string {
  const message = messages[key];
  if (message === undefined) throw new Error(`Missing tree message: ${key}`);
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t, locale: "en" }) }));

function node(id: string, over: Partial<UpgradeNode> = {}): UpgradeNode {
  const ref = { hostId: over.hostId ?? "host-a", id };
  return {
    kind: "delegation", ref, parent: null, parentState: "none", redactedParentRef: null,
    root: ref, rootState: "visible", redactedRootRef: null, followUp: null, followUpState: "none", parentAttemptId: null,
    id, hostId: "host-a", projectId: "project", parentId: null, rootId: null, followUpOf: null,
    lineageState: "verified", redactedParent: false, requester: null,
    target: { id: "worker", hostId: "host-a", name: "Worker" }, title: `Task ${id}`,
    execution: "running", closed: null, lastActivityAt: null, resumeEvidence: { kind: "none" },
    continuation: null, routingApproval: null, allowedActions: allowed(), revision: 17,
    ...over,
  };
}
function allowed(over: Partial<UpgradeNode["allowedActions"]> = {}): UpgradeNode["allowedActions"] {
  return { readAttempts: false, stop: true, stopSelf: true, stopJobs: false, declareContinuation: false, resumeContinuation: true, ...over };
}
function ancestor(placeholderId: string): RedactedAncestor {
  return { kind: "redactedAncestor", placeholderId, labelKey: "delegation.ancestorRestricted", reason: "notVisible", expandable: false, allowedActions: {} };
}
const parent = (id: string): Pick<UpgradeNode, "parent" | "parentState" | "root"> => ({ parent: { hostId: "host-a", id }, parentState: "visible", root: { hostId: "host-a", id: "root" } });
function limited(): UpgradeContinuation {
  return { state: "limited", roundNumber: 3, maxRounds: 3, maxElapsedSeconds: 7200,
    waitingFor: null, nextWakeAt: null, limitReason: "rounds", revision: 29 };
}
function snapshot(nodes: UpgradeTreeNode[]): UpgradeSnapshot {
  return {
    projectId: "project", revision: "101", nodes, nextCursor: null, coverage: "complete", unresolvedEdges: [],
    parties: [], approvals: [],
    policy: { revision: 1, memberMode: "approvalRequired", allowedActions: { update: false } },
    runControl: { epoch: 5, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: false, pauseAll: false, resume: false } },
    members: [], grants: { items: [], allowedActions: { create: false } }, interruptedDelegations: [],
    caller: { isOwner: false, canManageMembers: false, canOfflineMembers: false },
  };
}

const onAction = vi.fn<UpgradeSectionProps["onAction"]>();
let props: UpgradeSectionProps & { continuation?: boolean };
let root: Root;
let host: HTMLDivElement;
const dialogMethods = ["showModal", "close"] as const;
const originalDialogMethods = new Map(dialogMethods.map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)]));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-26T02:00:00Z"));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
  onAction.mockReset().mockResolvedValue(undefined);
  props = { snapshot: snapshot([node("root")]), busy: false, onAction };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const name of dialogMethods) {
    const original = originalDialogMethods.get(name);
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(h(TreePanel, props)));
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
function button(name: string, scope: ParentNode = host): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(el => (el.getAttribute("aria-label") ?? el.textContent) === name);
  if (!found) throw new Error(`Missing button: ${name}`);
  return found;
}
function article(id: string): HTMLElement {
  const found = [...host.querySelectorAll("article")].find(el => el.dataset.nodeId === id);
  if (!found) throw new Error(`Missing node: ${id}`);
  return found;
}
function input(selector: string, scope: ParentNode = host): HTMLInputElement {
  const found = scope.querySelector<HTMLInputElement>(selector);
  if (!found) throw new Error(`Missing input: ${selector}`);
  return found;
}
function dialog(): HTMLDialogElement {
  const found = document.querySelector("dialog");
  if (!found) throw new Error("Missing stop dialog");
  return found;
}
function search(value: string) {
  act(() => {
    const field = input('input[type="text"], input:not([type])');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const visibleIds = () => [...host.querySelectorAll<HTMLElement>("article[data-node-id]")].map(el => el.dataset.nodeId);
function chain() {
  return [node("root"), node("child", { ...parent("root") }), node("grandchild", { ...parent("child") }),
    node("deep", { ...parent("grandchild"), title: "Needle task", requester: { id: "requester", hostId: "host-b", name: "Requester Iris" }, target: { id: "target", hostId: "host-a", name: "Target Finch" } }),
    node("leaf", { ...parent("deep") })];
}

describe("delegation upgrade TreePanel", () => {
  it("shows three levels by default, expands and collapses the whole tree", async () => {
    props.snapshot.nodes = chain(); render();
    expect(visibleIds()).toEqual(["root", "child", "grandchild"]);
    expect(button("Task grandchild").getAttribute("aria-expanded")).toBe("false");
    expect(article("grandchild").textContent).toContain("2 more items");
    await click(button("Expand all"));
    expect(visibleIds()).toEqual(["root", "child", "grandchild", "deep", "leaf"]);
    await click(button("Collapse all"));
    expect(visibleIds()).toEqual(["root", "child", "grandchild"]);
  });

  it("expands a depth-limited branch and supports collapsing individual nodes", async () => {
    props.snapshot.nodes = chain(); render();
    await click(button("2 more items", article("grandchild")));
    expect(visibleIds()).toEqual(["root", "child", "grandchild", "deep", "leaf"]);
    await click(button("Task child"));
    expect(visibleIds()).toEqual(["root", "child"]);
    expect(article("child").textContent).toContain("3 more items");
    await click(button("Task child"));
    expect(visibleIds()).toEqual(["root", "child", "grandchild", "deep", "leaf"]);
  });

  it.each(["  nEeDlE  ", "Requester Iris", "Target Finch"])("searches hidden nodes by title or member: %s", query => {
    props.snapshot.nodes = chain(); render();
    search(query);
    expect(visibleIds()).toEqual(["deep"]);
    search("does not exist");
    expect(visibleIds()).toEqual([]);
    expect(host.textContent).toContain("No matching delegations");
    search("");
    expect(visibleIds()).toEqual(["root", "child", "grandchild"]);
  });

  it("filters anomalies, keeps unresolved nodes, and combines issues with search", async () => {
    props.snapshot = snapshot([
      node("healthy"), node("quiet", { lastActivityAt: "2026-10-26T01:40:00Z" }),
      node("invalid-time", { lastActivityAt: "invalid" }),
      node("closed-quiet", { closed: "accepted", lastActivityAt: "2026-10-26T00:00:00Z" }),
      node("orphan", { ...parent("unloaded") }), node("legacy", { lineageState: "legacyUnknown" }),
      node("pending", { routingApproval: { id: "approval", state: "pending", requestDigest: "digest", policyRevision: 1, authorityEpoch: 1, revision: 1,
        requestedBy: { kind: "owner", hostId: null, sessionId: null, name: null, redacted: false }, decidedBy: null, decisionAuthority: null,
        decisionNote: null, createdAt: "2026-10-26T00:00:00Z", decidedAt: null, allowedActions: { approve: false, deny: false } } }),
      node("limited", { continuation: limited() }), node("recovered", { resumeEvidence: { kind: "restartRecovery" } }),
    ]);
    props.snapshot.coverage = "partial"; props.snapshot.unresolvedEdges = [{ from: { hostId: "host-a", id: "orphan" }, relation: "parent", reason: "unavailable" }]; render();
    expect(host.textContent).toContain(treeMessages["delegations.upgrade.tree.partial"]);
    expect(article("orphan").textContent).toContain("Related delegation is not loaded");
    await click(input('input[type="checkbox"]'));
    expect(new Set(visibleIds())).toEqual(new Set(["quiet", "orphan", "legacy", "pending", "limited", "recovered"]));
    expect(article("quiet").textContent).toContain("No activity for 20 min");
    search("orphan"); expect(visibleIds()).toEqual(["orphan"]);
    search("healthy"); expect(visibleIds()).toEqual([]);
  });

  it("confirms root stop with default descendants, stopJobs false and the node revision", async () => {
    props.snapshot.nodes = chain(); render();
    await click(button("Stop delegation", article("root")));
    expect(dialog().open).toBe(true);
    expect(dialog().querySelector("h2")?.textContent).toBe("Stop “Task root”?");
    expect(input('input[type="radio"]', dialog()).checked).toBe(true);
    expect(dialog().textContent).toContain("Also stop its 4 descendants");
    expect(onAction).not.toHaveBeenCalled();
    await click(button("Stop delegation", dialog()));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "stop", nodeId: "root", nodeHostId: "host-a", cascade: "descendants", stopJobs: false, expectedRevision: 17 });
    expect(document.querySelector("dialog")).toBeNull();
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalledOnce();
  });

  it("allows stopping only one node and resets to cascade on the next dialog", async () => {
    render(); await click(button("Stop delegation", article("root")));
    await click(input('input[type="radio"]:not(:checked)', dialog()));
    await click(button("Stop delegation", dialog()));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ cascade: "none", stopJobs: false }));
    await click(button("Stop delegation", article("root")));
    expect(input('input[type="radio"]', dialog()).checked).toBe(true);
    await click(button("Cancel", dialog()));
    expect(document.querySelector("dialog")).toBeNull();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("keeps the stop dialog open when onAction rejects, without retrying", async () => {
    onAction.mockRejectedValue(new Error("revision conflict"));
    render(); await click(button("Stop delegation", article("root")));
    const opened = dialog();
    await click(button("Stop delegation", opened));
    expect(dialog()).toBe(opened);
    expect(opened.open).toBe(true);
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("hides stop for closed records and missing permission, and disables it while busy", async () => {
    props.snapshot.nodes = [node("closed", { closed: "accepted" }), node("forbidden", { allowedActions: allowed({ stop: false, stopSelf: false }) }), node("root")];
    props.busy = true; render();
    for (const id of ["closed", "forbidden"]) expect(article(id).querySelector('button[aria-label="Stop delegation"]')).toBeNull();
    expect(article("closed").textContent).toContain("Ended");
    const stop = button("Stop delegation", article("root"));
    expect(stop.disabled).toBe(true); await click(stop);
    expect(document.querySelector("dialog")).toBeNull(); expect(onAction).not.toHaveBeenCalled();
  });

  it("marks only explicit restartRecovery evidence as recovered", () => {
    props.snapshot.nodes = (["none", "unknown", "newAttempt", "restartRecovery"] as const)
      .map(kind => node(kind, { resumeEvidence: { kind } }));
    props.snapshot.interruptedDelegations = ["none", "unknown", "newAttempt"].map(id => ({ hostId: "host-a", id }));
    render();
    for (const kind of ["none", "unknown", "newAttempt"]) expect(article(kind).textContent).not.toContain("Recovered after restart");
    expect(article("restartRecovery").textContent).toContain("Recovered after restart");
  });

  it.each([undefined, false])("hides continuation details and actions with capability %s", continuation => {
    props.continuation = continuation;
    props.snapshot.nodes = [node("limited", { continuation: limited() })]; render();
    expect(host.querySelector("[data-continuation-state]")).toBeNull();
    expect(host.textContent).not.toContain("Approve another segment");
    expect(host.textContent).not.toContain("In progress (round");
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["running", "pausing", "paused", "partial"] as const)("gates limited continuation by run phase %s and uses continuation revision", async phase => {
    props.continuation = true;
    props.snapshot.nodes = [node("limited", { continuation: limited() })];
    props.snapshot.runControl.phase = phase; render();
    expect(host.querySelector('[data-continuation-state="limited"]')).not.toBeNull();
    expect(host.textContent).toContain("Each segment allows 3 rounds / 2 hours, including waiting and pauses");
    const approve = button("Approve another segment");
    expect(approve.disabled).toBe(phase !== "running");
    await click(approve);
    if (phase === "running") expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "resumeContinuation", nodeId: "limited", nodeHostId: "host-a", expectedRevision: 29 });
    else expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["forbidden", "closed", "busy"] as const)("blocks limited continuation when %s", async state => {
    props.continuation = true;
    props.snapshot.nodes = [node("limited", { continuation: limited(), closed: state === "closed" ? "accepted" : null,
      allowedActions: allowed({ resumeContinuation: state !== "forbidden" }) })];
    props.busy = state === "busy"; render();
    if (state === "busy") {
      const approve = button("Approve another segment");
      expect(approve.disabled).toBe(true); await click(approve);
    } else expect(host.textContent).not.toContain("Approve another segment");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("attaches separate parent/root placeholders without titles, identities, counts or controls", async () => {
    const visible = node("visible", { parentState: "redacted", parent: null, redactedParent: true,
      redactedParentRef: { placeholderId: "opaque-parent" }, rootState: "redacted", root: null,
      redactedRootRef: { placeholderId: "opaque-root" } });
    props.snapshot.nodes = [visible, ancestor("opaque-parent"), ancestor("opaque-root")];
    props.continuation = true; render();
    for (const relation of ["parent", "root"]) {
      const placeholder = host.querySelector<HTMLElement>(`article[data-relation="${relation}"]`);
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toBe("Ancestor delegation is restricted");
      expect(placeholder?.querySelector("button, input, a, [aria-expanded], [data-continuation-state]")).toBeNull();
      expect(placeholder?.getAttribute("data-node-host")).toBeNull();
      expect(placeholder?.getAttribute("data-node-id")).toBeNull();
      expect(placeholder?.getAttribute("style")).toBeNull();
      expect(placeholder?.querySelector(".font-medium")).toBeNull();
    }
    expect(visibleIds()).toEqual(["visible"]);
    await click(button("Expand all"));
    expect(host.querySelectorAll("[data-placeholder-id]")).toHaveLength(2);
    search("Task visible");
    expect(host.querySelectorAll("[data-placeholder-id]")).toHaveLength(2);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders a placeholder-only snapshot safely and never offers a mutation", () => {
    props.snapshot.nodes = [ancestor("opaque")]; props.continuation = true; render();
    expect(visibleIds()).toEqual([]);
    expect(host.querySelector("article")?.textContent).toBe("Ancestor delegation is restricted");
    expect(host.querySelector("article button")).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("distinguishes a visible unloaded parent from unknown history and uses unresolvedEdges arrays", () => {
    props.snapshot.nodes = [node("unloaded", { ...parent("missing") }), node("unknown", { parentState: "unknown", root: null, rootState: "unknown" })];
    props.snapshot.unresolvedEdges = [{ from: { hostId: "host-a", id: "unloaded" }, relation: "parent", reason: "unavailable" }];
    render();
    expect(article("unloaded").textContent).toContain("Related delegation is not loaded");
    expect(article("unknown").textContent).toContain(treeMessages["delegations.upgrade.tree.unknown"]);
    expect(article("unknown").textContent).not.toContain("Related delegation is not loaded");
    expect(host.querySelectorAll("[data-placeholder-id]")).toHaveLength(0);
    expect(host.textContent).toContain(treeMessages["delegations.upgrade.tree.partial"]);
  });

  it.each([
    { stop: false, stopSelf: true, cascade: "none" },
    { stop: true, stopSelf: false, cascade: "descendants" },
  ] as const)("authorizes stop=$stop and stopSelf=$stopSelf independently", async ({ stop, stopSelf, cascade }) => {
    props.snapshot.nodes = [node("root", { allowedActions: allowed({ stop, stopSelf }) })]; render();
    await click(button("Stop delegation", article("root")));
    const radios = [...dialog().querySelectorAll("input")];
    const descendants = radios[0]; const self = radios[1];
    expect(descendants?.disabled).toBe(!stop); expect(self?.disabled).toBe(!stopSelf);
    expect(descendants?.checked).toBe(cascade === "descendants"); expect(self?.checked).toBe(cascade === "none");
    const forbidden = stop ? self : descendants;
    if (!forbidden) throw new Error("Missing forbidden stop scope");
    await click(forbidden);
    await click(button("Stop delegation", dialog()));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "stop", nodeId: "root", nodeHostId: "host-a", cascade, stopJobs: false, expectedRevision: 17 });
  });

  it.each(["stop", "stopSelf", "resumeContinuation", "allowedActions"])("keeps malformed contracts read-only when %s is missing", key => {
    const malformed = node("malformed", { continuation: limited() });
    if (key === "allowedActions") Reflect.deleteProperty(malformed, key);
    else Reflect.deleteProperty(malformed.allowedActions, key);
    props.continuation = true; props.snapshot.nodes = [malformed]; render();
    expect(article("malformed").querySelector('button[aria-label="Stop delegation"]')).toBeNull();
    expect(host.textContent).not.toContain("Approve another segment");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("rechecks permission and revision after refresh while the stop dialog is open", async () => {
    render(); await click(button("Stop delegation", article("root")));
    props.snapshot = snapshot([node("root", { revision: 18, allowedActions: allowed({ stop: false, stopSelf: true }) })]); render();
    expect(button("Stop delegation", dialog()).disabled).toBe(true);
    await click(button("Stop delegation", dialog())); expect(onAction).not.toHaveBeenCalled();
    await click(input('input[type="radio"]:not(:checked)', dialog()));
    await click(button("Stop delegation", dialog()));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "stop", nodeId: "root", nodeHostId: "host-a", cascade: "none", stopJobs: false, expectedRevision: 18 });
  });

  it("sends a cross-host same-id stop to the selected node ref", async () => {
    props.snapshot.nodes = [node("same"), node("same", { hostId: "host-b", revision: 42 })]; render();
    const remote = host.querySelector<HTMLElement>('article[data-node-host="host-b"]');
    if (!remote) throw new Error("Missing remote node");
    await click(button("Stop delegation", remote)); await click(button("Stop delegation", dialog()));
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ kind: "stop", nodeId: "same", nodeHostId: "host-b", cascade: "descendants", stopJobs: false, expectedRevision: 42 });
  });

  it.each(["revoked", "closed", "removed"] as const)("prevents a stale dialog mutation after the node is %s", async state => {
    render(); await click(button("Stop delegation", article("root")));
    props.snapshot = snapshot(state === "removed" ? [] : [node("root", {
      closed: state === "closed" ? "accepted" : null,
      allowedActions: allowed({ stop: state !== "revoked", stopSelf: state !== "revoked" }),
    })]); render();
    if (state === "removed") expect(document.querySelector("dialog")).toBeNull();
    else {
      const confirm = button("Stop delegation", dialog());
      expect(confirm.disabled).toBe(true); await click(confirm);
    }
    expect(onAction).not.toHaveBeenCalled();
  });
});
