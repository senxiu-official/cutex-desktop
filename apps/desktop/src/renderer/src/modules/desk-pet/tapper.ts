// How a pace becomes poses (pure, test/deskPetEnergy.test.ts): hands alternate at `pace` taps a second. A raised hand
// is held a short, fixed time; at a slow pace both hands rest between taps, at a fast one a hand goes straight to the
// other. Pace 0 = rest: both hands, no next step, so no timer.
import type { DeskPetPose } from "../../../../shared/deskPet";

export interface TapperConfig {
  /** The longest a raised hand is held. */
  holdMs: number;
  /** Shorter rests between taps are skipped. */
  minRestMs: number;
}

export const DEFAULT_TAPPER: TapperConfig = { holdMs: 200, minRestMs: 40 };

export interface TapperState {
  hand: "left" | "right";
  raised: boolean;
}

export const AT_REST: TapperState = { hand: "right", raised: false };

export interface TapStep {
  state: TapperState;
  pose: DeskPetPose;
  /** Run the next step after this long; null = at rest, no timer. */
  delay: number | null;
}

export function tap(state: TapperState, pace: number, config: TapperConfig = DEFAULT_TAPPER): TapStep {
  if (!(pace > 0)) return { state: { ...state, raised: false }, pose: "both", delay: null };
  const period = 1000 / pace;
  const hold = Math.min(config.holdMs, period * 0.6);
  const rest = period - hold;
  if (state.raised && rest >= config.minRestMs) return { state: { ...state, raised: false }, pose: "both", delay: Math.round(rest) };
  const hand = state.hand === "left" ? "right" : "left";
  return { state: { hand, raised: true }, pose: hand, delay: Math.round(rest >= config.minRestMs ? hold : period) };
}
