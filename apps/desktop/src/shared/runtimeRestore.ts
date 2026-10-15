// Restore after an unclean stop (cutex `runtime-restore-candidates`): agents whose runtime was
// online when the host or cutex stopped uncleanly (power loss, crash). Wire shapes of
// `GET|DELETE /v2/runtimes/restore-candidates` (cutex schema export `runtime-restore`). Restoring is
// the ordinary `cutex/runtime/online` per agent; cutex never starts them by itself.

export const RUNTIME_RESTORE_FEATURE = "runtime-restore-candidates";

export interface RestoreCandidate {
  cutexSessionId: string;
  displayName: string;
  /** When its runtime last went online, RFC 3339. */
  lastOnlineAt: string;
}

export interface RestoreCandidates {
  hostId: string;
  /** When a cutex start found the runtimes gone; null when nothing is to restore. */
  uncleanSince: string | null;
  reason: "host_rebooted" | "runtimes_exited" | null;
  /** Still offline and not archived (an agent brought online again leaves the list). */
  items: RestoreCandidate[];
}
