// 「我已处理，收起」 on a needs-owner run card (state surfaces S10, owner-approved wording 2026-11-17): the owner says
// they handled it on the host, and the card goes. Remembered per host for that run id only, like the finished-run
// note's dismiss: it does not change the run record and does not claim the host is fixed (the status row still
// says the last update needed handling). A later run that needs the owner shows its card again.
import type { UpgradeRun } from "../../../../shared/backendUpgrade";

const KEY = (hostId: string) => `cutex-desktop.backend-upgrade.handledRun.${hostId}`;

export function readHandled(hostId: string): string | null {
  try {
    return localStorage.getItem(KEY(hostId));
  } catch {
    return null;
  }
}

export function writeHandled(hostId: string, runId: string): void {
  try {
    localStorage.setItem(KEY(hostId), runId);
  } catch {
    // not remembered: the card shows again next time
  }
}

/** The run needs the owner and the owner marked this very run handled. */
export function needsOwnerHandled(run: Pick<UpgradeRun, "phase" | "runId"> | null | undefined, handledRunId: string | null): boolean {
  return !!run && run.phase === "needs-owner" && handledRunId === run.runId;
}
