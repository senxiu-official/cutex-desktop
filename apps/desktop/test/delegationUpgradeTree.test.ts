import { describe, expect, it } from "vitest";
import type { UpgradeNode, UpgradeTreeNode } from "../src/renderer/src/modules/delegations/upgradeTypes";
import { buildUpgradeForest, descendantKeys, flattenUpgradeForest, nodeKey } from "../src/renderer/src/modules/delegations/tree";

const node = (id: string, over: Partial<UpgradeNode> = {}): UpgradeNode => ({
  kind: "delegation", ref: { hostId: over.hostId ?? "a", id },
  parent: null, parentState: "none", redactedParentRef: null,
  root: { hostId: over.hostId ?? "a", id }, rootState: "visible", redactedRootRef: null,
  followUp: null, followUpState: "none", parentAttemptId: null,
  id, hostId: "a", projectId: "project", parentId: null, rootId: null, followUpOf: null,
  lineageState: "verified", redactedParent: false, requester: null,
  target: { id: "worker", hostId: "a", name: "Worker" }, title: id,
  execution: "running", closed: null, lastActivityAt: null, resumeEvidence: { kind: "none" },
  continuation: null, routingApproval: null,
  allowedActions: { readAttempts: false, stop: false, stopSelf: false, stopJobs: false, declareContinuation: false, resumeContinuation: false }, revision: 1,
  ...over,
});
const keys = (nodes: readonly UpgradeTreeNode[]) => nodes.map(nodeKey);
const parent = (id: string, hostId = "a"): Pick<UpgradeNode, "parent" | "parentState"> => ({ parent: { hostId, id }, parentState: "visible" });

describe("delegation upgrade forest", () => {
  it("supports an empty page", () => {
    expect(buildUpgradeForest([])).toEqual({ roots: [], unresolved: [] });
    expect(flattenUpgradeForest(buildUpgradeForest([]), new Set())).toEqual([]);
    expect(descendantKeys([], "missing")).toEqual(new Set());
  });

  it("keeps paginated orphans and their known children unresolved until their parent arrives", () => {
    const parent = node("parent");
    const orphan = node("orphan", { parent: parent.ref, parentState: "visible", root: parent.ref });
    const child = node("child", { parent: orphan.ref, parentState: "visible", root: parent.ref });
    const page = buildUpgradeForest([child, orphan]);
    expect(page).toEqual({ roots: [], unresolved: [child, orphan] });
    expect(flattenUpgradeForest(page, new Set()).map((row) => [nodeKey(row.node), row.unresolved])).toEqual([[nodeKey(child), true], [nodeKey(orphan), true]]);
    expect(buildUpgradeForest([child, orphan, parent])).toEqual({
      roots: [{ node: parent, children: [{ node: orphan, children: [{ node: child, children: [] }] }] }], unresolved: [],
    });
  });

  it("uses only full parent refs when duplicate parent ids exist", () => {
    const a = node("parent");
    const b = node("parent", { hostId: "b" });
    const ambiguous = node("ambiguous", { parentId: "parent", parentState: "unknown" });
    const explicit = node("explicit", { ...parent("parent", "b"), root: b.ref });
    const missing = node("missing", { ...parent("parent", "unloaded"), root: b.ref });
    const forest = buildUpgradeForest([a, b, ambiguous, explicit, missing]);
    expect(forest.roots).toEqual([{ node: a, children: [] }, { node: b, children: [{ node: explicit, children: [] }] }]);
    expect(forest.unresolved).toEqual([ambiguous, missing]);
    expect(descendantKeys([a, b, ambiguous, explicit, missing], nodeKey(b))).toEqual(new Set([nodeKey(explicit)]));
    expect(descendantKeys([a, b, ambiguous, explicit, missing], nodeKey(a))).toEqual(new Set());
  });

  it("uses an explicit cross-host ref without relying on legacy parentId", () => {
    const parent = node("parent", { hostId: "b" });
    const child = node("child", { parent: parent.ref, parentState: "visible", root: parent.ref, parentId: null });
    expect(buildUpgradeForest([child, parent]).roots).toEqual([{ node: parent, children: [{ node: child, children: [] }] }]);
    expect(descendantKeys([child, parent], nodeKey(parent))).toEqual(new Set([nodeKey(child)]));
  });

  it.each([
    { lineageState: "legacyUnknown" as const },
    { parentState: "unknown" as const },
    { ...parent("unloaded") },
  ])("preserves unresolved histories and their descendants (%j)", (over) => {
    const unknown = node("unknown", over);
    const child = node("child", { ...parent(unknown.id) });
    expect(buildUpgradeForest([unknown, child])).toEqual({ roots: [], unresolved: [unknown, child] });
  });

  it("does not treat followUpOf or rootId as a parent", () => {
    const first = node("first");
    const followUp = node("followUp", { followUpOf: first.id, rootId: first.id, followUp: first.ref, followUpState: "visible" });
    expect(buildUpgradeForest([first, followUp]).roots.map((entry) => entry.node)).toEqual([first, followUp]);
    expect(descendantKeys([first, followUp], nodeKey(first))).toEqual(new Set());
  });

  it("deduplicates by host and id using the highest revision before resolving parents", () => {
    const old = node("same", { revision: 1 });
    const latest = node("same", { revision: 3, ...parent("unloaded") });
    const middle = node("same", { revision: 2 });
    const remote = node("same", { hostId: "b" });
    const input = Object.freeze([old, latest, remote, middle]);
    expect(buildUpgradeForest(input)).toEqual({ roots: [{ node: remote, children: [] }], unresolved: [latest] });
    expect(nodeKey(node("b:c", { hostId: "a" }))).not.toBe(nodeKey(node("c", { hostId: "a:b" })));
  });

  it("retains cycles, self cycles and their known children without hanging", () => {
    const nodes = [node("a", { ...parent("b") }), node("b", { ...parent("a") }),
      node("child", { ...parent("a") }), node("self", { ...parent("self") }), node("root")] as const;
    const forest = buildUpgradeForest(nodes);
    expect(keys(forest.unresolved)).toEqual(keys(nodes.slice(0, 4)));
    const rows = flattenUpgradeForest(forest, new Set(keys(nodes)));
    expect(new Set(keys(rows.map((row) => row.node)))).toEqual(new Set(keys(nodes)));
    expect(rows).toHaveLength(nodes.length);
    expect(descendantKeys(nodes, nodeKey(nodes[0]))).toEqual(new Set([nodeKey(nodes[2])]));
    expect(descendantKeys(nodes, nodeKey(nodes[3]))).toEqual(new Set());
  });

  it("uses expansion and zero-based depth limits while counting all hidden descendants", () => {
    const nodes = [node("root"), node("child", { ...parent("root") }),
      node("grandchild", { ...parent("child") }), node("leaf", { ...parent("grandchild") }),
      node("deep", { ...parent("leaf") })] as const;
    const forest = buildUpgradeForest(nodes);
    expect(flattenUpgradeForest(forest, new Set())).toEqual([
      { node: nodes[0], depth: 0, hasChildren: true, collapsedCount: 4, unresolved: false },
    ]);
    const expanded = new Set(keys(nodes));
    expect(flattenUpgradeForest(forest, expanded).map(({ depth, collapsedCount }) => [depth, collapsedCount]))
      .toEqual([[0, 0], [1, 0], [2, 0], [3, 1]]);
    expect(flattenUpgradeForest(forest, expanded, 1).map(({ depth, collapsedCount }) => [depth, collapsedCount]))
      .toEqual([[0, 0], [1, 3]]);
    expect(flattenUpgradeForest(forest, expanded, 10)).toHaveLength(5);
    expect(descendantKeys(nodes, nodeKey(nodes[0]))).toEqual(new Set(keys(nodes.slice(1))));
    expect(expanded.size).toBe(5);
  });

  it("does not traverse unverified or redacted child edges for descendant actions", () => {
    const root = node("root");
    const hidden = node("hidden", { parent: null, parentState: "redacted", redactedParent: true, redactedParentRef: { placeholderId: "opaque" } });
    const legacy = node("legacy", { ...parent(root.id), lineageState: "legacyUnknown" });
    const child = node("child", { ...parent(hidden.id) });
    expect(descendantKeys([root, hidden, legacy, child], nodeKey(root))).toEqual(new Set());
  });

  it("handles a deep history without recursive stack overflow", () => {
    const nodes = Array.from({ length: 12000 }, (_, i) => node(String(i), i ? { ...parent(String(i - 1)), root: { hostId: "a", id: "0" } } : {}));
    const forest = buildUpgradeForest([...nodes].reverse());
    expect(forest.unresolved).toEqual([]);
    expect(flattenUpgradeForest(forest, new Set())[0]?.collapsedCount).toBe(nodes.length - 1);
    expect(descendantKeys(nodes, nodeKey({ hostId: "a", id: "0" })).size).toBe(nodes.length - 1);
  });
});
