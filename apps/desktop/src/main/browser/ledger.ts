import { createHash } from "node:crypto";
import { hasSideEffects } from "@cutex-desktop/browser-protocol";
import { BrowserRelayError, type RelayCommand, type RelayErrorCode, type RelayState } from "./relayTypes";

export interface RelayLedgerEntry { readonly requestId: string; readonly dispatchSeq: number; readonly deadlineMono: number; readonly write: boolean; readonly fingerprint: string; state: RelayState; error?: RelayErrorCode; lateResults: number }
export const terminalRelayState = (state: RelayState): boolean => !["accepted", "dispatched", "running"].includes(state);
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])); return value; }
/** Small metadata only: never retains page contents, filled values, titles or image bodies. */
export class BrowserRelayLedger {
  private readonly entries = new Map<string, RelayLedgerEntry>();
  private highestSeq = 0;
  private watermark = 0;
  constructor(readonly generation: string, private readonly monotonicNow: () => number = () => performance.now(), readonly capacity = 256) { if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 256) throw new BrowserRelayError("invalid_request"); }
  get size(): number { return this.entries.size; }
  get evictedSeq(): number { return this.watermark; }
  get(requestId: string): RelayLedgerEntry | undefined { return this.entries.get(requestId); }
  accept(command: RelayCommand): { entry: RelayLedgerEntry; duplicate: boolean } {
    if (command.connectionGeneration !== this.generation) throw new BrowserRelayError("stale_connection");
    if (!Number.isSafeInteger(command.dispatchSeq) || command.dispatchSeq < 1 || !Number.isSafeInteger(command.remainingMs) || command.remainingMs < 0 || command.remainingMs > 30_000) throw new BrowserRelayError("invalid_request");
    const { remainingMs: _remaining, ...identity } = command;
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex");
    const known = this.entries.get(command.requestId);
    if (known) { if (known.fingerprint !== fingerprint) throw new BrowserRelayError("request_conflict"); this.expire(known); return { entry: known, duplicate: true }; }
    if (command.dispatchSeq <= this.watermark || command.dispatchSeq <= this.highestSeq) throw new BrowserRelayError("stale_request");
    // Even a capacity rejection consumes this dispatch sequence. A later retry may
    // not become executable merely because another entry has since completed.
    this.highestSeq = command.dispatchSeq;
    if (this.entries.size >= this.capacity) { const evictable = [...this.entries.values()].find(entry => terminalRelayState(entry.state)); if (!evictable) throw new BrowserRelayError("busy"); this.entries.delete(evictable.requestId); this.watermark = Math.max(this.watermark, evictable.dispatchSeq); }
    const entry: RelayLedgerEntry = { requestId: command.requestId, dispatchSeq: command.dispatchSeq, deadlineMono: this.monotonicNow() + command.remainingMs, write: hasSideEffects(command.operation), fingerprint, state: "accepted", lateResults: 0 };
    this.entries.set(entry.requestId, entry); if (command.remainingMs <= 250) { entry.state = "failed"; entry.error = "deadline_exceeded"; }
    return { entry, duplicate: false };
  }
  remaining(entry: RelayLedgerEntry): number { return Math.max(0, entry.deadlineMono - this.monotonicNow()); }
  dispatch(entry: RelayLedgerEntry): boolean { this.expire(entry); if (entry.state !== "accepted") return false; if (this.remaining(entry) <= 250) { entry.state = "failed"; entry.error = "deadline_exceeded"; return false; } entry.state = "dispatched"; return true; }
  running(entry: RelayLedgerEntry): void { if (entry.state === "dispatched") entry.state = "running"; }
  expire(entry: RelayLedgerEntry): void { if (!terminalRelayState(entry.state) && this.remaining(entry) <= 0) this.interrupt(entry, "deadline_exceeded"); }
  interrupt(entry: RelayLedgerEntry, code: "cancelled" | "stale_connection" | "deadline_exceeded" | "lease_revoked"): void {
    if (terminalRelayState(entry.state)) return;
    if (entry.state !== "accepted" && entry.write) { entry.state = "outcome_unknown"; entry.error = "outcome_unknown"; }
    else { entry.state = entry.state === "accepted" && code === "cancelled" ? "cancelled" : "failed"; entry.error = code; }
  }
  complete(entry: RelayLedgerEntry, error?: RelayErrorCode): boolean {
    this.expire(entry); if (terminalRelayState(entry.state)) { entry.lateResults++; return false; }
    entry.state = error === undefined ? "succeeded" : error === "outcome_unknown" ? "outcome_unknown" : "failed"; entry.error = error; return true;
  }
  disconnect(): void { for (const entry of this.entries.values()) this.interrupt(entry, "stale_connection"); }
}
