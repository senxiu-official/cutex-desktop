// 范围规则 (owner 2026-11-27): per-project roles plus rules over a scope — all / a project group (sidebar folder) /
// a host / one project; the most specific scope covering a project wins. This app evaluates the draft while the
// owner edits (and says which rule set each project); once saved the host's evaluation is the one that counts.
import { refKey, type PaProjectRef } from "../../lib/personalAssistants";
import { PA_DEFAULT_ROLE, type PaProjectRole, type PaRole, type PaScope, type PaScopeKind, type PaScopeRule } from "./phase1Contract";

/** Narrow beats broad. */
export const SCOPE_RANK: Record<PaScopeKind, number> = { all: 0, group: 1, host: 2, project: 3 };
/** Among rules of the same rank, the more careful role wins (two folders holding one project). */
const ROLE_RANK: Record<PaRole, number> = { observe: 0, coordinate: 1, confirmForYou: 2 };

export function covers(scope: PaScope, ref: PaProjectRef): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "group":
      return scope.members.some((m) => refKey(m) === refKey(ref));
    case "host":
      return scope.instanceId === ref.instanceId;
    case "project":
      return refKey(scope.ref) === refKey(ref);
  }
}

/** The rule in effect for one project (null = none: the default role). */
export function ruleFor(rules: readonly PaScopeRule[], ref: PaProjectRef): PaScopeRule | null {
  let best: PaScopeRule | null = null;
  for (const r of rules) {
    if (!covers(r.scope, ref)) continue;
    if (!best) best = r;
    else {
      const a = SCOPE_RANK[r.scope.kind], b = SCOPE_RANK[best.scope.kind];
      if (a > b || (a === b && ROLE_RANK[r.role] < ROLE_RANK[best.role])) best = r;
    }
  }
  return best;
}

/** Each project's role in effect and the rule that set it. */
export function effectiveRoles(rules: readonly PaScopeRule[], refs: readonly PaProjectRef[]): PaProjectRole[] {
  return refs.map((ref) => {
    const r = ruleFor(rules, ref);
    return { ref, role: r?.role ?? PA_DEFAULT_ROLE, ruleId: r?.id ?? null };
  });
}

/** The projects a rule would actually decide (it covers them and nothing narrower does) if it were saved as `rule`. */
export function affectedBy(rules: readonly PaScopeRule[], rule: PaScopeRule, refs: readonly PaProjectRef[]): PaProjectRef[] {
  const next = [...rules.filter((r) => r.id !== rule.id), rule];
  return effectiveRoles(next, refs).filter((p) => p.ruleId === rule.id).map((p) => p.ref);
}

/** Projects that would newly go to 代你确认 if the draft were saved (the list shown before enabling it broadly). */
export function newlyConfirmForYou(before: readonly PaScopeRule[], after: readonly PaScopeRule[], refs: readonly PaProjectRef[]): PaProjectRef[] {
  const was = new Map(effectiveRoles(before, refs).map((p) => [refKey(p.ref), p.role]));
  return effectiveRoles(after, refs).filter((p) => p.role === "confirmForYou" && was.get(refKey(p.ref)) !== "confirmForYou").map((p) => p.ref);
}

/** The project rule of `ref` set to `role` (added, changed, or removed when it equals what the broader rules give). */
export function withProjectRole(rules: readonly PaScopeRule[], ref: PaProjectRef, role: PaRole, newId: () => string): PaScopeRule[] {
  const own = rules.find((r) => r.scope.kind === "project" && refKey(r.scope.ref) === refKey(ref));
  const rest = rules.filter((r) => r !== own);
  const inherited = ruleFor(rest, ref)?.role ?? PA_DEFAULT_ROLE;
  if (role === inherited && !own?.note) return rest;
  return [...rest, { id: own?.id ?? newId(), scope: { kind: "project", ref }, role, ...(own?.note ? { note: own.note } : {}) }];
}

/** The note of a project's own rule. */
export function projectNote(rules: readonly PaScopeRule[], ref: PaProjectRef): string {
  return rules.find((r) => r.scope.kind === "project" && refKey(r.scope.ref) === refKey(ref))?.note ?? "";
}

/** A project rule's note set (the rule is kept with the inherited role when only the note is new). */
export function withProjectNote(rules: readonly PaScopeRule[], ref: PaProjectRef, note: string, newId: () => string): PaScopeRule[] {
  const own = rules.find((r) => r.scope.kind === "project" && refKey(r.scope.ref) === refKey(ref));
  const rest = rules.filter((r) => r !== own);
  const role = own?.role ?? ruleFor(rest, ref)?.role ?? PA_DEFAULT_ROLE;
  const inherited = ruleFor(rest, ref)?.role ?? PA_DEFAULT_ROLE;
  const text = note.trim();
  if (!text && role === inherited) return rest;
  return [...rest, { id: own?.id ?? newId(), scope: { kind: "project", ref }, role, ...(text ? { note: text } : {}) }];
}

export const newRuleId = () => `rule-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The project groups a group rule can name: sidebar folders (members are host keys `[hostId, projectId]`) holding at
 * least one of the assistant's projects; `instanceOf` maps a desktop host to the instance its projects carry. The rule
 * keeps the members as refs (the host does not know this app's folders).
 */
export function groupScopes(
  sections: readonly { id: string; name: string; members: readonly string[] }[],
  instanceOf: (hostId: string) => string | null,
  refs: readonly PaProjectRef[],
): Extract<PaScope, { kind: "group" }>[] {
  const mine = new Set(refs.map(refKey));
  const out: Extract<PaScope, { kind: "group" }>[] = [];
  for (const s of sections) {
    const members: PaProjectRef[] = [];
    for (const key of s.members) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(key);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") continue;
      const instanceId = instanceOf(parsed[0]);
      if (instanceId) members.push({ instanceId, projectId: parsed[1] });
    }
    if (members.some((m) => mine.has(refKey(m)))) out.push({ kind: "group", groupId: s.id, name: s.name, members });
  }
  return out;
}

/** A group rule whose folder changed: its members re-read (null = the folder is gone, the rule is kept as saved). */
export function refreshGroupRule(rule: PaScopeRule, groups: readonly Extract<PaScope, { kind: "group" }>[]): PaScopeRule {
  if (rule.scope.kind !== "group") return rule;
  const groupId = rule.scope.groupId;
  const now = groups.find((g) => g.groupId === groupId);
  return now ? { ...rule, scope: now } : rule;
}
