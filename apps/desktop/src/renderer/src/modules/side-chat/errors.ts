import { useDebug } from "../../lib/debugState";
// Errors of the side-chat routes as shown: an older cutex without them (route_not_found / 404) reads
// as the calm "needs a newer cutex" text, never the raw code. Launchers / turn actions already hide on
// such a host (lib/hostGatingView.ts); this is the safety net.
import { isRouteMissing } from "../../lib/hostGating";
import { SIDE_FORK_BLOCKED } from "../../../../shared/sideChat";

type SideErrorKey = "side-chat.unsupportedHost" | "side-chat.forkBusy" | "side-chat.forkHeld" | "side-chat.runtimeUnsupported" | "side-chat.offline" | "side-chat.stale" | "side-chat.boundaryChanged" | "side-chat.messageEmpty" | "side-chat.messageInvalid" | "side-chat.messageTooLong" | "side-chat.messageIdInvalid" | "side-chat.modelInvalid" | "side-chat.replyInvalid";

/** Main rejected these fields before HTTP; their drafts may be edited without replaying a send. */
export function isSideMessageValidationError(error: string): boolean {
  return /^side_chat_invalid_(?:message|message_id):/.test(error);
}

/**
 * cutex refusal codes with a readable text (docs/SIDE-CHATS.md "Important error codes"; for a Claude
 * parent the adapter's refusals map to the same codes): an adapter without `sideChat`, an offline
 * parent, a chat lost to an adapter restart, a boundary turn not yet on Claude Code's transcript.
 */
const CODE_TEXTS: readonly [RegExp, SideErrorKey][] = [
  [/\bside_chat_invalid_message:\s*empty\b/, "side-chat.messageEmpty"],
  [/\bside_chat_invalid_message:\s*too_long\b/, "side-chat.messageTooLong"],
  [/\bside_chat_invalid_message:/, "side-chat.messageInvalid"],
  [/\bside_chat_invalid_message_id:/, "side-chat.messageIdInvalid"],
  [/\bside_chat_invalid_model:/, "side-chat.modelInvalid"],
  [/\bside_chat_invalid_error_message:/, "side-chat.replyInvalid"],
  [/\bside_runtime_unsupported\b/, "side-chat.runtimeUnsupported"],
  [/\bside_runtime_offline\b/, "side-chat.offline"],
  [/\bside_chat_(?:not_found|stale)\b/, "side-chat.stale"],
  [/\bside_boundary_changed\b|\bnative_transcript_behind\b/, "side-chat.boundaryChanged"],
];

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
  if (useDebug.getState().state.enabled) return error;
  const blocked = FORK_BLOCKED.exec(error);
  if (blocked) return t(blocked[1] === "held" ? "side-chat.forkHeld" : "side-chat.forkBusy");
  const code = CODE_TEXTS.find(([pattern]) => pattern.test(error));
  if (code) return t(code[1]);
  return isRouteMissing(error) ? t("side-chat.unsupportedHost") : error;
}
