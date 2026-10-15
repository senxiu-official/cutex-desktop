// Settings → 外观 → 运行中智能体 (UI pref `runningAgents`). Running agents that need nothing show as
// compact rows (★, owner 2026-10-12), full rows, or the old 运行中 avatar row. The default was
// "avatars" before, so a stored "avatars" from then switches once to "compact" (runningAgentsRev,
// like sidePreviewRev); a later explicit choice is kept.

export type RunningAgents = "compact" | "full" | "avatars";
export const RUNNING_AGENTS: readonly RunningAgents[] = ["compact", "full", "avatars"];
export const DEFAULT_RUNNING_AGENTS: RunningAgents = "compact";
export const RUNNING_AGENTS_REV = 1;

/** Stored value → setting: a pre-rev-1 "avatars" (the old default) becomes "compact" once; any other choice is kept. */
export function migrateRunningAgents(v: unknown, rev: unknown): RunningAgents {
  if (!(RUNNING_AGENTS as readonly unknown[]).includes(v)) return DEFAULT_RUNNING_AGENTS;
  if (v === "avatars" && (typeof rev !== "number" || rev < RUNNING_AGENTS_REV)) return DEFAULT_RUNNING_AGENTS;
  return v as RunningAgents;
}
