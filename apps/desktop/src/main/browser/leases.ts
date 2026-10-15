import type { BrowserControlSettings, BrowserLeaseView } from "../../shared/browser";
import { BrowserRelayError, type RelayGrant, type RelayLease } from "./relayTypes";

export interface BrowserLeasePeer {
  grantLease(input: RelayGrant): Promise<RelayLease>;
  activateLease(id: string): Promise<RelayLease>;
  revokeLease(id: string): Promise<void>;
}
type Entry = { lease: RelayLease; peer: BrowserLeasePeer; settings: BrowserControlSettings; phase: "holding" | "activating" | "active";
  timer?: ReturnType<typeof setTimeout>; resolve(): void; reject(error: unknown): void; done: Promise<void>; admissionCurrent(): boolean };
export interface BrowserLeasesOptions {
  /** Rechecks current registry guest and host identity; must not use selected host. */
  current(lease: RelayLease): boolean;
  prepare(lease: RelayLease, settings: BrowserControlSettings): Promise<void>;
  releaseProvider(guestId: string, leaseId: string): void;
  changed(guestId: string): void;
  timeoutMs?: number;
}
/** Main-only two-phase grants. A renderer hold acknowledgment cannot create a lease. */
export class BrowserLeases {
  private entries = new Map<string, Entry>();
  private attempts = new Map<string, symbol>();
  constructor(private options: BrowserLeasesOptions) {}
  list(hostId?: string): RelayLease[] { return [...this.entries.values()].filter(e => !hostId || e.lease.target.hostId === hostId).map(e => ({ ...e.lease })); }
  forGuest(guestId: string): RelayLease | undefined { return [...this.entries.values()].find(e => e.lease.target.guestId === guestId)?.lease; }
  view(guestId: string): BrowserLeaseView | undefined { const entry = [...this.entries.values()].find(e => e.lease.target.guestId === guestId), l = entry?.lease; return l && { leaseId: l.leaseId, sessionId: l.cutexSessionId, agentName: l.agentName, state: entry!.phase === "active" ? "active" : "pending", origin: l.origin }; }
  /**
   * The relay may accept a command before the activation HTTP reply, but must await this
   * barrier before touching the provider. The original entry's done/timer bounds the wait;
   * revocation never rebinds a waiter to another lease or replays its operation.
   */
  async waitActive(leaseId: string): Promise<RelayLease> {
    const entry = this.entries.get(leaseId);
    if (!entry) throw new BrowserRelayError("lease_revoked");
    if (!this.current(entry)) { this.revoke(leaseId, "lease_revoked"); throw new BrowserRelayError("lease_revoked"); }
    await entry.done;
    if (!this.current(entry) || entry.phase !== "active") throw new BrowserRelayError("lease_revoked");
    return { ...entry.lease, target: { ...entry.lease.target } };
  }
  async grant(peer: BrowserLeasePeer, input: RelayGrant, settings: BrowserControlSettings, admissionCurrent = () => true): Promise<RelayLease> {
    if (!admissionCurrent()) throw new BrowserRelayError("stale_request");
    if (this.forGuest(input.guestId) || this.attempts.has(input.guestId)) throw new BrowserRelayError("lease_conflict");
    const attempt = Symbol(); this.attempts.set(input.guestId, attempt);
    let entry: Entry | undefined;
    try {
      const lease = await peer.grantLease(input);
      if (this.attempts.get(input.guestId) !== attempt || !this.options.current(lease) || !admissionCurrent()) {
        void peer.revokeLease(lease.leaseId).catch(() => {}); throw new BrowserRelayError("stale_connection");
      }
      let resolve!: () => void, reject!: (reason: unknown) => void;
      const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void done.catch(() => {});
      entry = { lease, peer, settings: { ...settings, viewport: { ...settings.viewport } }, phase: "holding", done, resolve, reject, admissionCurrent };
      this.entries.set(lease.leaseId, entry);
      entry.timer = setTimeout(() => this.revoke(lease.leaseId, "lease_revoked"), this.options.timeoutMs ?? 9500); entry.timer.unref?.();
      this.options.changed(input.guestId);
      await done;
      if (!this.current(entry) || entry.phase !== "active") throw new BrowserRelayError("lease_revoked");
      return entry.lease;
    } finally { if (this.attempts.get(input.guestId) === attempt) this.attempts.delete(input.guestId); }
  }
  async held(guestId: string, leaseId: string, held: boolean): Promise<void> {
    const entry = this.entries.get(leaseId);
    if (!entry || entry.lease.target.guestId !== guestId) { if (!held) return; throw new BrowserRelayError("lease_revoked"); }
    if (!held) { this.revoke(leaseId, entry.phase === "holding" ? "lease_limit" : "lease_revoked"); return; }
    if (entry.phase !== "holding") return; // Duplicate readiness never attaches twice or resumes a pause.
    entry.phase = "activating";
    try {
      if (!this.current(entry)) throw new BrowserRelayError("stale_connection");
      await this.options.prepare(entry.lease, entry.settings);
      if (!this.current(entry)) throw new BrowserRelayError("lease_revoked");
      // The peer may deliver a command before this HTTP reply. Inventory admits it to the
      // queue, but waitActive blocks execution until the final consent fence has passed.
      entry.lease = { ...entry.lease, state: "active" };
      await entry.peer.activateLease(leaseId);
      if (!this.current(entry)) throw new BrowserRelayError("lease_revoked");
      entry.phase = "active"; if (entry.timer) clearTimeout(entry.timer); entry.timer = undefined;
      this.options.changed(guestId); entry.resolve();
    } catch (error) { if (this.entries.get(leaseId) === entry) this.revoke(leaseId, "lease_revoked"); throw error; }
  }
  async resume(guestId: string, leaseId: string, settings: BrowserControlSettings): Promise<void> {
    const entry = this.entries.get(leaseId);
    if (!entry || entry.lease.target.guestId !== guestId || entry.phase !== "active" || !this.current(entry)) throw new BrowserRelayError("lease_revoked");
    await this.options.prepare(entry.lease, settings);
    if (!this.current(entry)) throw new BrowserRelayError("lease_revoked");
  }
  /** Close admission synchronously. Called by the peer too; notify=false avoids recursion. */
  revoke(leaseId: string, reason: "lease_revoked" | "stale_connection" | "target_closed" | "lease_limit", notify = true): void {
    const entry = this.entries.get(leaseId); if (!entry) return;
    this.entries.delete(leaseId); this.attempts.delete(entry.lease.target.guestId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.reject(new BrowserRelayError(reason));
    this.options.releaseProvider(entry.lease.target.guestId, leaseId); this.options.changed(entry.lease.target.guestId);
    if (notify) void entry.peer.revokeLease(leaseId).catch(() => {});
  }
  revokeGuest(guestId: string): void { this.attempts.delete(guestId); const lease = this.forGuest(guestId); if (lease) this.revoke(lease.leaseId, "target_closed"); }
  dispose(): void { this.attempts.clear(); for (const id of [...this.entries.keys()]) this.revoke(id, "stale_connection"); }
  private current(entry: Entry): boolean { return this.entries.get(entry.lease.leaseId) === entry && this.options.current(entry.lease)
    && (entry.phase === "active" || entry.admissionCurrent()); }
}
