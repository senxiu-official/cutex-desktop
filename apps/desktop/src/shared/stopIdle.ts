// Stop idle agents (cutex `stop-idle-agents`, design 031): cutex decides which online agents are idle
// and may be stopped (`GET /v2/runtimes/idle`), and stops the chosen ones (`POST /v2/runtimes/stop-idle`).
export const STOP_IDLE_FEATURE = "stop-idle-agents";

export type IdleVerdict = "stoppable" | "caution" | "blocked";

/** Blocking reasons, cautions and notes (cutex docs/stop-idle-agents.md). */
export type IdleReason =
  | "offline" | "activeTurn" | "threadBusy" | "ownerQueue" | "handlingDelegation" | "delegationsWaiting"
  | "pendingRequest" | "openQuestion" | "backgroundWork" | "tooRecent"
  | "awaitingDelegations" | "scheduledAlarm" | "runningJobs" | "director" | "backgroundUnknown"
  | "ownerStartOnly" | "ownsServices"
  // Desktop-local (the sidebar pin is device-local): a caution added by the desktop.
  | "pinned";

export interface IdleAgent {
  cutexSessionId: string;
  name: string | null;
  projectId: string | null;
  runtime: "codex" | "claude";
  idleSince: string | null;
  idleSecs: number | null;
  verdict: IdleVerdict;
  reasons: IdleReason[];
}

export interface IdleRuntimes {
  now: string;
  minIdleSecs: number;
  projectId: string | null;
  agents: IdleAgent[];
}

export type StopIdleMode = "wakeable" | "stopped";

export interface StopIdleRequest {
  requestId: string;
  sessionIds: string[];
  minIdleSecs: number;
  mode: StopIdleMode;
  dryRun?: boolean;
}

export interface StopIdleItemResult {
  cutexSessionId: string;
  result: "stopped" | "skipped" | "failed" | "wouldStop";
  reasons?: IdleReason[];
  error?: string;
}

export interface StopIdleResult {
  mode: StopIdleMode;
  dryRun: boolean;
  results: StopIdleItemResult[];
}

/** Reasons that block a stop (cutex never stops these). */
export const BLOCKING_REASONS: ReadonlySet<IdleReason> = new Set([
  "offline", "activeTurn", "threadBusy", "ownerQueue", "handlingDelegation", "delegationsWaiting",
  "pendingRequest", "openQuestion", "backgroundWork", "tooRecent",
]);
