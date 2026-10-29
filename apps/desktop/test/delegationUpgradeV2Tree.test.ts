import { describe, expect, it } from "vitest";
import { buildUpgradeForest, descendantKeys, flattenUpgradeForest, nodeKey } from "../src/renderer/src/modules/delegations/tree";
import type { RedactedAncestor, UpgradeNode } from "../src/renderer/src/modules/delegations/upgradeTypes";

function node(id: string, over: Partial<UpgradeNode> = {}): UpgradeNode {
  const ref = { hostId: over.hostId ?? "eva", id };
  return { kind: "delegation", id, hostId: ref.hostId, ref, projectId: "project",
    parent: null, parentState: "none", redactedParentRef: null, root: ref, rootState: "visible", redactedRootRef: null,
    followUp: null, followUpState: "none", parentId: null, rootId: null, followUpOf: null, parentAttemptId: null,
    lineageState: "verified", redactedParent: false, requester: null, target: { id: "worker", hostId: "eva", name: "Worker" }, title: id,
    execution: "running", closed: null, lastActivityAt: null, resumeEvidence: { kind: "none" }, continuation: null, routingApproval: null,
    allowedActions: { readAttempts: false, stop: false, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 1, ...over };
}
function placeholder(placeholderId: string): RedactedAncestor {
  return { kind: "redactedAncestor", placeholderId, labelKey: "delegation.ancestorRestricted", reason: "notVisible", expandable: false, allowedActions: {} };
}

describe("delegation contract v2 tree", () => {
  it("deduplicates exact refs by revision without merging the same id on different hosts", () => {
    const local = node("same", { revision: 2 });
    const remote = node("same", { hostId: "remote", revision: 1 });
    const child = node("child", { hostId: "third", parent: remote.ref, parentState: "visible", root: remote.ref,
      parentId: "same", rootId: "misleading-local-root" });
    const nodes = [node("same"), local, remote, child, node("same", { revision: 0 })];
    const forest = buildUpgradeForest(nodes);
    expect(forest.roots).toEqual([{ node: local, children: [] }, { node: remote, children: [{ node: child, children: [] }] }]);
    expect(descendantKeys(nodes, nodeKey(local))).toEqual(new Set());
    expect(descendantKeys(nodes, nodeKey(remote))).toEqual(new Set([nodeKey(child)]));
  });

  it("never reconstructs an edge from legacy ids, same-host proximity or a unique id candidate", () => {
    const root = node("root");
    const orphan = node("orphan", { hostId: "remote", parentState: "visible", parent: null, parentId: root.id, rootId: root.id, root: root.ref });
    const unknown = node("unknown", { parentState: "unknown", parent: root.ref, parentId: root.id });
    const nodes = [root, orphan, unknown];
    expect(buildUpgradeForest(nodes)).toEqual({ roots: [{ node: root, children: [] }], unresolved: [orphan, unknown] });
    expect(descendantKeys(nodes, nodeKey(root))).toEqual(new Set());
  });

  const unconfirmed: Partial<UpgradeNode>[] = [
    { parentState: "unknown" },
    { rootState: "unknown", root: null },
    { rootState: "visible", root: { hostId: "other-host", id: "candidate" } },
    { parentState: "none", rootState: "visible", root: null },
    { lineageState: "legacyUnknown" },
    { parentState: "visible", parent: { hostId: "eva", id: "not-loaded" } },
  ];
  it.each(unconfirmed)("does not promote an unconfirmed root (%j)", over => {
    const candidate = node("candidate", over);
    expect(buildUpgradeForest([candidate])).toEqual({ roots: [], unresolved: [candidate] });
  });

  it("only confirms parentState none plus a visible self root", () => {
    const confirmed = node("confirmed");
    expect(buildUpgradeForest([confirmed])).toEqual({ roots: [{ node: confirmed, children: [] }], unresolved: [] });
  });

  it("preserves the exact six-field placeholder and attaches distinct parent/root refs", () => {
    const parent = placeholder("opaque-parent");
    const root = placeholder("opaque-root");
    const visible = node("visible", { parentState: "redacted", redactedParent: true,
      redactedParentRef: { placeholderId: parent.placeholderId }, rootState: "redacted", root: null,
      redactedRootRef: { placeholderId: root.placeholderId } });
    const input = Object.freeze([visible, Object.freeze(parent), root, parent]);
    const forest = buildUpgradeForest(input);
    expect(forest.roots).toEqual([]);
    const rows = flattenUpgradeForest(forest, new Set(input.map(nodeKey)), Infinity);
    const ancestors = rows.filter(row => row.node.kind === "redactedAncestor");
    expect(ancestors.map(row => row.node)).toEqual([parent, root]);
    expect(ancestors.map(row => [row.relation, row.relatedTo])).toEqual([["parent", nodeKey(visible)], ["root", nodeKey(visible)]]);
    for (const row of ancestors) {
      expect(Object.keys(row.node).sort()).toEqual(["allowedActions", "expandable", "kind", "labelKey", "placeholderId", "reason"]);
      expect(row).toMatchObject({ depth: 0, hasChildren: false, collapsedCount: 0 });
    }
    expect(descendantKeys(input, nodeKey(parent))).toEqual(new Set());
    expect(descendantKeys(input, nodeKey(root))).toEqual(new Set());
  });

  it("drops extra placeholder content without changing the caller's object", () => {
    const hidden = { ...placeholder("opaque"), hostId: "secret-host", id: "secret-id", title: "Secret title", count: 999, depth: 99,
      allowedActions: {}, target: { name: "Secret name" } };
    const forest = buildUpgradeForest([hidden]);
    expect(forest.unresolved).toEqual([placeholder("opaque")]);
    expect(JSON.stringify(forest)).not.toMatch(/secret|Secret|999/);
    expect(hidden.count).toBe(999);
  });

  it("does not mistake a visible unloaded ref for a redacted or unknown relationship", () => {
    const pending = node("pending", { parentState: "visible", parent: { hostId: "remote", id: "same" }, rootState: "unknown", root: null });
    const local = node("same");
    const forest = buildUpgradeForest([local, pending]);
    const row = flattenUpgradeForest(forest, new Set()).find(item => nodeKey(item.node) === nodeKey(pending));
    expect(row?.unresolvedReason).toBe("unavailable");
    expect(forest.unresolved).toEqual([pending]);
    expect(forest.roots).toHaveLength(1);
    const loaded = node("same", { hostId: "remote" });
    const complete = buildUpgradeForest([local, pending, loaded]);
    expect(complete.unresolved).toEqual([]);
    expect(complete.roots.find(item => nodeKey(item.node) === nodeKey(loaded))?.children.map(item => item.node)).toEqual([pending]);
  });

  it("does not infer a shared ancestor from separate opaque edge tokens", () => {
    const a = node("a", { parentState: "redacted", redactedParent: true, redactedParentRef: { placeholderId: "edge-a" } });
    const b = node("b", { parentState: "redacted", redactedParent: true, redactedParentRef: { placeholderId: "edge-b" } });
    const rows = flattenUpgradeForest(buildUpgradeForest([a, b, placeholder("edge-a"), placeholder("edge-b")]), new Set(), Infinity);
    expect(rows.filter(row => row.node.kind === "redactedAncestor").map(row => row.relatedTo)).toEqual([nodeKey(a), nodeKey(b)]);
    expect(descendantKeys([a, b], nodeKey(a))).toEqual(new Set());
  });
});
