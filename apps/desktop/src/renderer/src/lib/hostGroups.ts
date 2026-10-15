// Host group editing (multi-host P2, RFC §7.5; Settings → 主机 → 分组): pure list edits that produce the
// whole draft list `saveHostGroups` takes, validated with the same shared rules main applies
// (`normalizeHostGroups`). Unit-tested in test/hostGroups.test.ts.
import { normalizeHostGroups, type HostGroup, type HostGroupDraft, type HostGroupError } from "../../../shared/hosts";

export type GroupEdit =
  | { kind: "create"; name: string; hosts: string[]; color: string | null }
  | { kind: "rename"; id: string; name: string }
  | { kind: "recolor"; id: string; color: string | null }
  | { kind: "toggleMember"; id: string; hostId: string }
  | { kind: "move"; id: string; delta: -1 | 1 }
  | { kind: "delete"; id: string };

const draftOf = (g: HostGroup): HostGroupDraft => ({ id: g.id, name: g.name, hosts: [...g.hosts], color: g.color ?? null });

/**
 * The draft list after one edit. Members are toggled in host order (`hostOrder`, the switcher's), so the
 * member dots keep the host list order; a move past either end is a no-op.
 */
export function applyGroupEdit(groups: readonly HostGroup[], edit: GroupEdit, hostOrder: readonly string[]): HostGroupDraft[] {
  const drafts = groups.map(draftOf);
  const at = edit.kind === "create" ? -1 : drafts.findIndex((d) => d.id === edit.id);
  const order = (ids: string[]) => [...ids].sort((a, b) => rank(hostOrder, a) - rank(hostOrder, b));
  switch (edit.kind) {
    case "create":
      return [...drafts, { name: edit.name, hosts: order(edit.hosts), color: edit.color }];
    case "rename":
      if (at >= 0) drafts[at] = { ...drafts[at]!, name: edit.name };
      return drafts;
    case "recolor":
      if (at >= 0) drafts[at] = { ...drafts[at]!, color: edit.color };
      return drafts;
    case "toggleMember": {
      if (at < 0) return drafts;
      const hosts = drafts[at]!.hosts;
      drafts[at] = { ...drafts[at]!, hosts: hosts.includes(edit.hostId) ? hosts.filter((id) => id !== edit.hostId) : order([...hosts, edit.hostId]) };
      return drafts;
    }
    case "move": {
      const to = at + edit.delta;
      if (at < 0 || to < 0 || to >= drafts.length) return drafts;
      [drafts[at], drafts[to]] = [drafts[to]!, drafts[at]!];
      return drafts;
    }
    case "delete":
      return drafts.filter((d) => d.id !== edit.id);
  }
}

function rank(order: readonly string[], id: string): number {
  const i = order.indexOf(id);
  return i < 0 ? order.length : i;
}

/** Validate drafts in the renderer before sending (same rules as main; ids are not assigned here). */
export function checkGroupDrafts(drafts: readonly HostGroupDraft[], hostIds: readonly string[]): { ok: true } | { ok: false; error: HostGroupError; index: number } {
  const known = new Set(hostIds);
  // Ids of new drafts are assigned by main; any placeholder passes here.
  let n = 0;
  const r = normalizeHostGroups(drafts, (id) => known.has(id), () => `grp-new${String(++n).padStart(4, "0")}`);
  return r.ok ? { ok: true } : r;
}

/** A free default name for a new group: `base`, then `base 2`, `base 3`, … */
export function freeGroupName(groups: readonly HostGroup[], base: string): string {
  const taken = new Set(groups.map((g) => g.name.trim().toLocaleLowerCase()));
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLocaleLowerCase())) return `${base} ${i}`;
}
