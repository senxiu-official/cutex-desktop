// Errors of the side-chat routes as shown: an older cutex without them (route_not_found / 404) reads
// as the calm "needs a newer cutex" text, never the raw code. Launchers / turn actions already hide on
// such a host (lib/hostGatingView.ts); this is the safety net.
import { isRouteMissing } from "../../lib/hostGating";
import { SIDE_FORK_BLOCKED } from "../../../../shared/sideChat";

type SideErrorKey = "side-chat.unsupportedHost" | "side-chat.forkBusy" | "side-chat.forkHeld";

/**
 * The parent agent still has an unfinished External Input obligation, so the native fork was refused
 * (cutex `side_fork_blocked_external_input`). The message carries the code and `busy` / `held` so it
 * survives a string-only error path.
 */
export class SideForkBlockedError extends Error {
  constructor(readonly blockedBy: "busy" | "held") {
    super(`${SIDE_FORK_BLOCKED}: ${blockedBy}`);
  }
}

const FORK_BLOCKED = new RegExp(`\\b${SIDE_FORK_BLOCKED}\\b(?::\\s*(busy|held)\\b)?`);

export function sideErrorText(error: string | null | undefined, t: (key: SideErrorKey) => string): string | null {
  if (!error) return null;
  const blocked = FORK_BLOCKED.exec(error);
  if (blocked) return t(blocked[1] === "held" ? "side-chat.forkHeld" : "side-chat.forkBusy");
  return isRouteMissing(error) ? t("side-chat.unsupportedHost") : error;
}
