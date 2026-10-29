import type { DelegationRef, RedactedAncestor, UpgradeNode, UpgradeTreeNode } from "./upgradeTypes";

export interface TreeEntry { node: UpgradeNode; children: TreeEntry[] }
export interface UpgradeForest { roots: TreeEntry[]; unresolved: UpgradeTreeNode[] }
export interface UpgradeTreeRow {
  node: UpgradeTreeNode; depth: number; hasChildren: boolean; collapsedCount: number; unresolved: boolean;
  relatedTo?: string; relation?: "parent" | "root"; unresolvedReason?: "unavailable" | "unknown";
}

export function nodeKey(node: DelegationRef | UpgradeTreeNode): string {
  if ("kind" in node) {
    if (node.kind === "redactedAncestor") return JSON.stringify(["redactedAncestor", node.placeholderId]);
    return nodeKey(node.ref);
  }
  return JSON.stringify([node.hostId, node.id]);
}

function placeholder(placeholderId: string): RedactedAncestor {
  return { kind: "redactedAncestor", placeholderId, labelKey: "delegation.ancestorRestricted",
    reason: "notVisible", expandable: false, allowedActions: {} };
}

function graph(nodes: readonly UpgradeTreeNode[]) {
  const byKey = new Map<string, UpgradeNode>();
  const placeholders = new Map<string, RedactedAncestor>();
  for (const node of nodes) {
    if (node.kind === "redactedAncestor") {
      // Keep exactly the public six-field shape, even for an over-specified input object.
      placeholders.set(node.placeholderId, placeholder(node.placeholderId));
      continue;
    }
    const key = nodeKey(node);
    const previous = byKey.get(key);
    if (!previous || node.revision > previous.revision) byKey.set(key, node);
  }
  const parents = new Map<string, string>();
  const roots = new Set<string>();
  for (const [key, node] of byKey) {
    for (const ref of [node.parentState === "redacted" ? node.redactedParentRef : null,
      node.rootState === "redacted" ? node.redactedRootRef : null]) {
      if (ref && !placeholders.has(ref.placeholderId)) placeholders.set(ref.placeholderId, placeholder(ref.placeholderId));
    }
    if (node.lineageState !== "verified" || node.redactedParent || key !== nodeKey({ hostId: node.hostId, id: node.id })) continue;
    if (node.parentState === "none" && node.parent === null && node.rootState === "visible" && node.root && nodeKey(node.root) === key) {
      roots.add(key);
    } else if (node.parentState === "visible" && node.parent) {
      const parent = nodeKey(node.parent);
      if (byKey.has(parent)) parents.set(key, parent);
    }
  }
  // Resolve parent chains iteratively: long histories and cycles must not overflow the stack.
  const rooted = new Map<string, boolean>();
  const cyclic = new Set<string>();
  for (const start of byKey.keys()) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = start;
    while (current !== undefined && !rooted.has(current) && !positions.has(current)) {
      positions.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    if (current !== undefined && positions.has(current)) {
      for (const key of path.slice(positions.get(current)!)) cyclic.add(key);
    }
    const last = path.at(-1);
    const reachesRoot = current === undefined
      ? last !== undefined && roots.has(last)
      : rooted.get(current) ?? false;
    for (const key of path) rooted.set(key, reachesRoot);
  }
  return { byKey, placeholders, parents, roots, rooted, cyclic };
}

/** Unresolved components stay flat, including their known children; no orphan becomes a root. */
export function buildUpgradeForest(nodes: readonly UpgradeTreeNode[]): UpgradeForest {
  const { byKey, placeholders, parents, roots, rooted } = graph(nodes);
  const entries = new Map<string, TreeEntry>();
  const forest: UpgradeForest = { roots: [], unresolved: [] };
  for (const [key, node] of byKey) {
    if (rooted.get(key)) entries.set(key, { node, children: [] });
    else forest.unresolved.push(node);
  }
  for (const [key, entry] of entries) {
    if (roots.has(key)) forest.roots.push(entry);
    else entries.get(parents.get(key)!)!.children.push(entry);
  }
  for (const ancestor of placeholders.values()) forest.unresolved.push(ancestor);
  return forest;
}

/** Depth is zero-based. A collapsed row counts every hidden descendant, not just children.
 * Unresolved nodes are always individual rows, independent of expansion and depth limits.
 */
export function flattenUpgradeForest(forest: UpgradeForest, expanded: Set<string>, maxDepth = 3): UpgradeTreeRow[] {
  const placeholders = new Map(forest.unresolved.filter((node): node is RedactedAncestor => node.kind === "redactedAncestor")
    .map(node => [node.placeholderId, node]));
  const emitted = new Set<string>();
  const loaded = new Set<string>();
  const counts = new Map<TreeEntry, number>();
  const pending = forest.roots.map((entry) => ({ entry, visited: false }));
  while (pending.length) {
    const { entry, visited } = pending.pop()!;
    loaded.add(nodeKey(entry.node));
    if (visited) counts.set(entry, entry.children.reduce((n, child) => n + 1 + counts.get(child)!, 0));
    else {
      pending.push({ entry, visited: true });
      for (const child of entry.children) pending.push({ entry: child, visited: false });
    }
  }
  for (const node of forest.unresolved) if (node.kind === "delegation") loaded.add(nodeKey(node));
  const rows: UpgradeTreeRow[] = [];
  function append(row: UpgradeTreeRow) {
    const node = row.node;
    if (node.kind === "delegation") {
      for (const relation of ["parent", "root"] as const) {
        const ref = relation === "parent"
          ? node.parentState === "redacted" && node.redactedParentRef
          : node.rootState === "redacted" && node.redactedRootRef;
        if (!ref || emitted.has(ref.placeholderId)) continue;
        const ancestor = placeholders.get(ref.placeholderId);
        if (ancestor) {
          emitted.add(ref.placeholderId);
          rows.push({ node: ancestor, depth: 0, hasChildren: false, collapsedCount: 0, unresolved: false,
            relatedTo: nodeKey(node), relation });
        }
      }
      const unavailable = node.parentState === "visible" && node.parent && !loaded.has(nodeKey(node.parent))
        || node.rootState === "visible" && node.root && !loaded.has(nodeKey(node.root));
      if (unavailable) row.unresolvedReason = "unavailable";
    }
    rows.push(row);
  }
  const stack = forest.roots.map((entry) => ({ entry, depth: 0 })).reverse();
  while (stack.length) {
    const { entry, depth } = stack.pop()!;
    const open = depth < maxDepth && expanded.has(nodeKey(entry.node));
    append({ node: entry.node, depth, hasChildren: entry.children.length > 0,
      collapsedCount: open ? 0 : counts.get(entry)!, unresolved: false });
    if (open) for (const child of entry.children.toReversed()) stack.push({ entry: child, depth: depth + 1 });
  }
  for (const node of forest.unresolved) if (node.kind === "delegation") {
    append({ node, depth: 0, hasChildren: false, collapsedCount: 0, unresolved: true });
  }
  // Unattached placeholders are still visible, but never gain depth, counts or actions.
  for (const node of placeholders.values()) if (!emitted.has(node.placeholderId)) {
    rows.push({ node, depth: 0, hasChildren: false, collapsedCount: 0, unresolved: false });
  }
  return rows;
}

/** Excludes the starting node and cycle edges; never derives ancestry from followUpOf/rootId. */
export function descendantKeys(nodes: readonly UpgradeTreeNode[], key: string): Set<string> {
  const { parents, cyclic } = graph(nodes);
  const children = new Map<string, string[]>();
  for (const [child, parent] of parents) {
    if (cyclic.has(child)) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(child);
    children.set(parent, siblings);
  }
  const result = new Set<string>();
  const pending = [...children.get(key) ?? []];
  while (pending.length) {
    const child = pending.pop()!;
    if (child === key || result.has(child)) continue;
    result.add(child);
    for (const descendant of children.get(child) ?? []) pending.push(descendant);
  }
  return result;
}
