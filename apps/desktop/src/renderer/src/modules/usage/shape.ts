// 用量 table 「每回合」 / 「每步上下文」 (token audit 2026-10-22): how heavy one turn is and how much context
// one model request carries, so a runaway agent (a huge context re-sent on every tool step) stands out.
// Pure helpers, unit-tested in test/usageShape.test.ts. The counts come from cutex `/v2/usage`:
// `requests` = model requests (Claude: SDK steps), `maxRequestInput` = the largest single request.

/** A context per step at or above this is flagged (most of a 400k-class window, re-sent each step). */
export const HEAVY_STEP_CONTEXT = 300_000;
/** Input per turn at or above this is flagged (~30+ steps of a 300k context in one turn). */
export const HEAVY_TURN_INPUT = 10_000_000;

export interface TurnShape {
  /** Input tokens per turn (all steps of a turn added up). */
  perTurn: number | null;
  /** Average input per model request: the context one step carried. */
  perStep: number | null;
  /** Model requests per turn. */
  stepsPerTurn: number | null;
  /** The largest single request (cutex `maxRequestInput`), when cutex reports it. */
  peak: number | null;
  /** perStep ≥ HEAVY_STEP_CONTEXT or perTurn ≥ HEAVY_TURN_INPUT (one large request near compaction is not). */
  heavy: boolean;
}

export function turnShape(amounts: { turns?: number; requests?: number; input?: number; maxRequestInput?: number }): TurnShape {
  const { turns = 0, requests = 0, input = 0 } = amounts;
  const perTurn = turns > 0 ? input / turns : null;
  const perStep = requests > 0 ? input / requests : null;
  const stepsPerTurn = turns > 0 && requests > 0 ? requests / turns : null;
  const peak = amounts.maxRequestInput ?? null;
  const heavy = (perStep ?? 0) >= HEAVY_STEP_CONTEXT || (perTurn ?? 0) >= HEAVY_TURN_INPUT;
  return { perTurn, perStep, stepsPerTurn, peak, heavy };
}
