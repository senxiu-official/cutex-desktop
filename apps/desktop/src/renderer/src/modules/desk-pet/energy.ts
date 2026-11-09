// Energy (pure, test/deskPetEnergy.test.ts): what token reports leave behind, and the pace it gives. A report adds
// log2(1 + tokens): a large report lasts a little longer than a small one, never minutes. Energy has no cap and decays by
// a fixed share per second; below `stopBelow` the pet rests and nothing runs. One report alone keeps it moving about
// 10 to 15 s whatever its size; only reports arriving close together keep it going longer, and they raise the pace.
// The output is a level and a pace, nothing about poses: the window may draw energy another way later (./tapper plays it as taps).

export interface EnergyConfig {
  /** Time constant of the decay: energy × e^(−t / tauMs). */
  tauMs: number;
  /** Below this the pet rests. */
  stopBelow: number;
  /** Taps per second just above `stopBelow` and at `fullAt` or more. */
  minRate: number;
  maxRate: number;
  /** The energy at which the pace stops rising. */
  fullAt: number;
  /** What a report with no tokens adds: a model request that bills later, a call by a runtime that reports no usage. */
  activity: number;
}

export const DEFAULT_ENERGY: EnergyConfig = { tauMs: 5000, stopBelow: 1, minRate: 1.5, maxRate: 6, fullAt: 30, activity: 6 };

export interface EnergyState {
  energy: number;
  /** When `energy` was last brought up to date (ms, any monotonic clock). */
  at: number;
}

export const EMPTY: EnergyState = { energy: 0, at: 0 };

/** Energy of one report of `tokens` tokens (non-cached input + output). */
export function reportEnergy(tokens: number, config: EnergyConfig = DEFAULT_ENERGY): number {
  return tokens > 0 && Number.isFinite(tokens) ? Math.log2(1 + tokens) : config.activity;
}

/** The energy at `now`; 0 once it has fallen below `stopBelow`. */
export function energyAt(state: EnergyState, now: number, config: EnergyConfig = DEFAULT_ENERGY): number {
  if (state.energy <= 0) return 0;
  const energy = state.energy * Math.exp(-Math.max(0, now - state.at) / config.tauMs);
  return energy < config.stopBelow ? 0 : energy;
}

export function addReport(state: EnergyState, tokens: number, now: number, config: EnergyConfig = DEFAULT_ENERGY): EnergyState {
  return { energy: energyAt(state, now, config) + reportEnergy(tokens, config), at: now };
}

/** How far up the scale `energy` is, 0 (resting) to 1 (`fullAt` or more). */
export function levelOf(energy: number, config: EnergyConfig = DEFAULT_ENERGY): number {
  if (energy < config.stopBelow) return 0;
  return Math.min(1, (energy - config.stopBelow) / (config.fullAt - config.stopBelow));
}

/** Taps per second; 0 = rest. Linear in energy: one report alone sits low to mid (a replay of 26 h of real reports: one
 * report of 1.5k tokens starts at 3/s, 1M at 4.4/s), only reports close together reach the top. */
export function paceOf(energy: number, config: EnergyConfig = DEFAULT_ENERGY): number {
  if (energy < config.stopBelow) return 0;
  return config.minRate + (config.maxRate - config.minRate) * levelOf(energy, config);
}

/** When energy from `state` falls below `stopBelow` (ms after `state.at`); 0 = already resting. */
export function restsAfter(state: EnergyState, config: EnergyConfig = DEFAULT_ENERGY): number {
  if (state.energy < config.stopBelow) return 0;
  return config.tauMs * Math.log(state.energy / config.stopBelow);
}
