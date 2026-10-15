// The status capsule's 进程 (the model's `update_plan` checklist) outlives the agent's own list: the
// last non-empty snapshot stays until a new non-empty one arrives, so the owner can come back later
// and still see what the agent worked through. An empty update (the agent cleared its list) only marks
// it `cleared`; the owner's × hides it (`dismissed`) until a different non-empty snapshot arrives.
// Pure rules here; the per-agent cache that survives restarts / disconnects is lib/planCache.ts.
import type { PlanSnapshot } from "./timeline";

/** Stable identity of a snapshot's content (turn + steps), to notice updates. Ignores the flags. */
export function planSignature(plan: PlanSnapshot | null | undefined): string {
  return plan ? `${plan.turnId}|${plan.steps.map((s) => `${s.status}:${s.step}`).join("\n")}` : "";
}

/** Without the cleared / dismissed flags (a fresh snapshot). */
function bare(plan: PlanSnapshot): PlanSnapshot {
  const { cleared: _c, dismissed: _d, ...rest } = plan;
  return rest;
}

/**
 * The snapshot to keep after `incoming` (live turn/plan/updated or cutex latestPlan) when `prev` is
 * what was kept so far. Non-empty replaces (a dismissal sticks while the content is the same);
 * empty keeps `prev` of the same thread, marked cleared; nothing to keep → null.
 */
export function nextPlan(prev: PlanSnapshot | null | undefined, incoming: PlanSnapshot): PlanSnapshot | null {
  const same = prev && (prev.threadId === incoming.threadId || !incoming.threadId || !prev.threadId) ? prev : null;
  if (incoming.steps.length > 0) {
    const next = bare(incoming);
    return same?.dismissed && planSignature(same) === planSignature(next) ? { ...next, dismissed: true } : next;
  }
  if (!same || same.steps.length === 0) return null;
  return same.cleared ? same : { ...same, cleared: true };
}

/** The owner's ×: hidden until a different non-empty snapshot arrives. */
export function dismissPlan(plan: PlanSnapshot | null | undefined): PlanSnapshot | null {
  if (!plan) return null;
  return plan.dismissed ? plan : { ...plan, dismissed: true };
}

/**
 * Was the turn of a kept plan reverted? Known only when the previous view of the same thread had the
 * turn loaded and the rebuilt one lacks it although an older turn survived (or the whole history is
 * loaded now). A turn that is merely not on the newest page is not "gone".
 */
export function planTurnGone(turnId: string, previousTurns: readonly string[], turns: readonly string[], olderUnloaded: boolean): boolean {
  const at = previousTurns.indexOf(turnId);
  if (at < 0 || turns.includes(turnId)) return false;
  if (!olderUnloaded) return true;
  return previousTurns.slice(0, at).some((id) => turns.includes(id));
}

/** `cutex/session/history/revert` from `beforeTurnId` on drops a kept plan of that turn or a later one. */
export function revertDropsPlan(turnId: string, turns: readonly string[], beforeTurnId: string): boolean {
  const from = turns.indexOf(beforeTurnId);
  const at = turns.indexOf(turnId);
  return from >= 0 && at >= from;
}

export interface BootPlanInput {
  /** The rebuilt timeline's thread and loaded turns (oldest first). */
  threadId: string | null;
  turns: readonly string[];
  /** History pages: older turns not fetched yet. */
  olderUnloaded: boolean;
  /** This desktop's kept snapshot (lib/planCache). */
  cached: PlanSnapshot | null | undefined;
  /** It was updated live on the current connection (nothing missed since). */
  cachedFresh: boolean;
  /** cutex `latestPlan` (recovered from the rollout; may be an empty, cleared list). */
  latest: PlanSnapshot | null | undefined;
}

/**
 * What a rebuilt timeline (agent re-opened, resync, history pages, revert, restart) shows: the newer
 * of the local cache and cutex `latestPlan`, by turn order where the loaded turns tell it; otherwise
 * the local one. Either is accepted for the same thread even when its turn is not loaded (a revert is
 * handled before: planTurnGone / revertDropsPlan). The result keeps the cleared / dismissed flags.
 */
export function bootPlan({ threadId, turns, olderUnloaded, cached, cachedFresh, latest }: BootPlanInput): PlanSnapshot | null {
  if (!threadId) return null;
  const local = cached && cached.threadId === threadId && cached.steps.length > 0 ? cached : null;
  // The rollout trims a reverted turn's plan: one whose turn is missing from a complete history is stale.
  const remote = latest && (latest.threadId ?? threadId) === threadId && (olderUnloaded || turns.includes(latest.turnId)) ? { ...latest, threadId } : null;
  if (!remote) return local;
  if (!local) return nextPlan(null, remote);
  const adopt = () => nextPlan(local, remote) ?? local;
  if (local.turnId === remote.turnId) return cachedFresh || planSignature(local) === planSignature(remote) ? local : adopt();
  const l = turns.indexOf(local.turnId);
  const r = turns.indexOf(remote.turnId);
  return r > l ? adopt() : local;
}
