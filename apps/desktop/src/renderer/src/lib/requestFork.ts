import { FORK_PROFILE_FEATURE } from "../../../shared/sessionFork";
import { featuresOf, useApp } from "../store";
import { forkProfileDialog } from "./contextMenu";

/** All fork entry points share one chooser; old hosts keep the direct operation. */
export function requestFork(sessionId: string, afterTurnId: string | null, hostId: string): Promise<void> {
  if (featuresOf(useApp.getState(), hostId).has(FORK_PROFILE_FEATURE)) return forkProfileDialog(sessionId, hostId, afterTurnId);
  return useApp.getState().forkSession(sessionId, afterTurnId, hostId);
}
