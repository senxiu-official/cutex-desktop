// The composer while the agent runs a delegation turn (it is the handler of a running attempt):
// which delegation it is (the hint over the empty input), what the send keys do (the steer /
// interrupt-and-send shortcuts queue instead unless the 委托进行中允许插话快捷键 setting is on), and
// the send menu's explicit choices (排队 / 加入此委托 / 打断委托). Pure, so it is unit-tested.
import type { AskSummary } from "../../../shared/ipc";
import { activeDelegationAsk, ASKS_FEATURE } from "./delegations";
import type { ComposerKeyAction } from "./sendKeys";
import type { TimelineState } from "./timeline";

export interface DelegationTurn {
  askId: string;
  title: string;
  requesterId: string | null;
  requesterName: string | null;
  /** The owner made the delegation (no requester agent). */
  owner: boolean;
  /** When the attempt (else the turn) started, ms since epoch; null = unknown. */
  startedAt: number | null;
}

/** States in which the record still allows the running turn to be the delegation's attempt. */
const LIVE = new Set<AskSummary["execution"]>(["queued", "admitted", "running"]);

/**
 * The delegation the agent's running turn handles: the turn opened with an ASK row, and the
 * delegation's record (when loaded) has not finished. Null without `agent-asks` or a running turn.
 */
export function currentDelegationTurn(timeline: TimelineState | null | undefined, byId: Record<string, AskSummary>, features: ReadonlySet<string>): DelegationTurn | null {
  if (!timeline?.activeTurnId || !features.has(ASKS_FEATURE)) return null;
  const row = activeDelegationAsk(timeline);
  if (!row) return null;
  const record = byId[row.askId];
  // The record lags the turn start (queued / admitted until the refresh), never the end.
  if (record && (record.closed || !LIVE.has(record.execution))) return null;
  const attemptStart = record?.attempt?.startedAt ? Date.parse(record.attempt.startedAt) : NaN;
  const turnStart = timeline.turns.find((t) => t.id === timeline.activeTurnId)?.startedAt ?? null;
  return {
    askId: row.askId,
    title: record?.title || row.title,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    owner: row.owner,
    startedAt: Number.isFinite(attemptStart) ? attemptStart : turnStart !== null ? turnStart * 1000 : null,
  };
}

/** Run time of the delegation turn (s); null when its start is unknown. */
export function delegationTurnSeconds(turn: Pick<DelegationTurn, "startedAt">, now: number): number | null {
  return turn.startedAt === null ? null : Math.max(0, Math.round((now - turn.startedAt) / 1000));
}

/**
 * A composer key action during a delegation turn: steering into the delegation's turn or
 * interrupting it from a shortcut becomes queueing (the owner's text runs after the delegation),
 * unless the setting allows it. Everything else (and every key outside a delegation turn) is unchanged.
 */
export function delegationKeyAction(action: ComposerKeyAction, ctx: { delegation: boolean; allowSteerKeys: boolean }): ComposerKeyAction {
  if (!ctx.delegation || ctx.allowSteerKeys) return action;
  return action === "steer" || action === "interruptSend" ? "queue" : action;
}

/** The send menu's explicit choices while a delegation turn runs (first = the ↵ button's default). */
export type DelegationSendChoice = "queue" | "join" | "interrupt";

/** Choices that apply: 加入此委托 needs same-turn steering (not every agent has it). */
export function delegationSendChoices(canSteer: boolean): DelegationSendChoice[] {
  return canSteer ? ["queue", "join", "interrupt"] : ["queue", "interrupt"];
}

/** What the composer's send does for a choice. */
export function sendHowFor(choice: DelegationSendChoice): "queue" | "steer" | "interruptSend" {
  return choice === "join" ? "steer" : choice === "interrupt" ? "interruptSend" : "queue";
}

/**
 * The queue tray's per-item 插入 during a delegation turn: with the setting off it asks first
 * (加入此委托 with a warning, or keep it queued); otherwise (and outside a delegation turn) it
 * steers right away.
 */
export function queueSendNowMode(ctx: { delegation: boolean; allowSteerKeys: boolean }): "steer" | "confirm" {
  return ctx.delegation && !ctx.allowSteerKeys ? "confirm" : "steer";
}
