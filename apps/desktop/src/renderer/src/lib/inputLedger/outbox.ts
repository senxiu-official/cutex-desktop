// 054 §3.2 / D5: persist only O0, until the first authoritative response or event.
// One key per id avoids one app window overwriting another window's pending sends.
import type { LedgerOwnerOutbox } from "./owner";
import { reportStorageFull } from "../storageFull";

export const LEDGER_OUTBOX_PREFIX = "cutex-desktop.inputLedger.o0.v1:";
const keyOf = (entry: Pick<LedgerOwnerOutbox, "hostId" | "sessionId" | "inputId">) =>
  LEDGER_OUTBOX_PREFIX + JSON.stringify([entry.hostId, entry.sessionId, entry.inputId]);

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function persistLedgerOutbox(entry: LedgerOwnerOutbox, target = storage()): boolean {
  if (!target) return false;
  try { target.setItem(keyOf(entry), JSON.stringify(entry)); return true; }
  catch { reportStorageFull(); return false; }
}

/** Called only after cutex owns this id, or the owner explicitly discards the local draft. */
export function acknowledgeLedgerOutbox(hostId: string, sessionId: string, inputId: string, target = storage()): void {
  try { target?.removeItem(keyOf({ hostId, sessionId, inputId })); } catch { /* retain for recovery */ }
}

export function loadLedgerOutbox(target = storage()): LedgerOwnerOutbox[] {
  const entries: LedgerOwnerOutbox[] = [];
  if (!target) return entries;
  try {
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (!key?.startsWith(LEDGER_OUTBOX_PREFIX)) continue;
      try {
        const value = JSON.parse(target.getItem(key) ?? "null") as Partial<LedgerOwnerOutbox> | null;
        if (!value || typeof value.inputId !== "string" || !value.inputId || typeof value.hostId !== "string"
          || typeof value.sessionId !== "string" || typeof value.text !== "string" || !Array.isArray(value.extra)
          || !["auto", "queue", "interrupt"].includes(value.strategy ?? "") || typeof value.createdAt !== "string"
          || keyOf(value as LedgerOwnerOutbox) !== key) continue;
        // A crashed request is recovered by input/get, never automatically resent.
        entries.push({ ...value, predictedSurface: value.predictedSurface === "timeline" || value.predictedSurface === "nextUp" ? value.predictedSurface : undefined, phase: "unconfirmed" } as LedgerOwnerOutbox);
      } catch { /* one malformed record must not hide the other messages */ }
    }
  } catch { /* unavailable storage */ }
  return entries;
}
