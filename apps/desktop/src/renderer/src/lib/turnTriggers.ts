// Who started a turn — desktop approximation until cutex has `turn-triggers` (`cutex/turn/ended`,
// docs/research/notification-levels.md §3.4): a turn is the owner's when a `userMessage` item shows
// up in it (desktop / phone / TUI input, queued messages, steer). Delegations, agent messages and
// cutex wake-ups arrive as `external_event` items, so they stay "other". A turn that started before
// the desktop saw it is "other" (unknown = not the owner's: never disturbs). Pure reducer.

export type TurnOwner = "owner" | "other";

/** agentId → the running turn and whether the owner wrote into it. */
export type TurnTriggerState = ReadonlyMap<string, { turnId: string | null; owner: boolean }>;

interface NativeMessage {
  method: string;
  params?: unknown;
}

function turnIdOf(params: unknown): string | null {
  const p = params as { turn?: { id?: unknown }; turnId?: unknown } | null;
  const id = p?.turn?.id ?? p?.turnId;
  return typeof id === "string" ? id : null;
}

/** The state after one native notification of an agent's bound thread. */
export function applyTurnEvent(state: TurnTriggerState, agentId: string, message: NativeMessage): TurnTriggerState {
  const current = state.get(agentId);
  if (message.method === "turn/started") {
    const next = new Map(state);
    next.set(agentId, { turnId: turnIdOf(message.params), owner: false });
    return next;
  }
  if ((message.method === "item/started" || message.method === "item/completed") && current && !current.owner) {
    const item = (message.params as { item?: { type?: unknown } } | null)?.item;
    if (item?.type === "userMessage") {
      const next = new Map(state);
      next.set(agentId, { ...current, owner: true });
      return next;
    }
  }
  return state;
}

/** Whose turn just ended (call before dropping it with `endTurn`). */
export function turnOwnerOf(state: TurnTriggerState, agentId: string, turnId: string | null): TurnOwner {
  const current = state.get(agentId);
  if (!current?.owner) return "other";
  return current.turnId === null || turnId === null || current.turnId === turnId ? "owner" : "other";
}

export function endTurn(state: TurnTriggerState, agentId: string): TurnTriggerState {
  if (!state.has(agentId)) return state;
  const next = new Map(state);
  next.delete(agentId);
  return next;
}

/**
 * Registered event of a finished turn (cutex registry `turn.*`): the owner's completed / failed /
 * interrupted, or another turn's completed / failed (interrupted counts as failed there).
 */
export function turnEventOf(owner: TurnOwner, status: string): string {
  if (owner === "owner") return status === "failed" ? "turn.owner.failed" : status === "interrupted" ? "turn.owner.interrupted" : "turn.owner.completed";
  return status === "completed" ? "turn.other.completed" : "turn.other.failed";
}

/** Registered event of a native server request: a question (user input / elicitation) or an approval. */
export function serverRequestEventOf(method: string): "native.question" | "native.approval" {
  return /requestUserInput|elicitation/i.test(method) ? "native.question" : "native.approval";
}
