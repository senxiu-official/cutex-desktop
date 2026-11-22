// The state word of an owner notification (ownerNotify.state.*). State surfaces W14 (owner-approved 2026-11-17): an
// acknowledged notice that still waits for a reply reads 「已读，等你回复」, not a bare 已读 that also means "seen,
// nothing more to do".
import type { OwnerNotification } from "@cutex-desktop/protocol";
import { canReply } from "../../../shared/ownerNotify";

export type OwnerNotifyStateWord = OwnerNotification["state"] | "awaitingReply";

export function ownerNotifyStateWord(n: Pick<OwnerNotification, "state" | "needsReply" | "origin">): OwnerNotifyStateWord {
  return n.state === "acknowledged" && canReply(n) ? "awaitingReply" : n.state;
}
