import { randomBytes } from "node:crypto";
import { browserPartition, type BrowserPool } from "./attachPolicy";

export interface BrowserGuestHandle {
  readonly id: number;
  isDestroyed(): boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  close(options?: { waitForBeforeUnload?: boolean }): void;
}
export type BrowserGuestStatus = "unmounted" | "attached" | "crashed";
export interface BrowserGuestRecord {
  readonly guestId: string;
  readonly hostId: string;
  readonly epoch: string;
  readonly tabKey: string;
  readonly partition: string;
  readonly pool: BrowserPool;
  readonly pageGeneration: number;
  readonly status: BrowserGuestStatus;
}
export type BrowserRegistryEvent = BrowserGuestRecord & {
  kind: "created" | "attached" | "unmounted" | "replaced" | "destroyed" | "crashed" | "closed" | "host_changed" | "host_removed";
};
export interface BrowserRegistryOptions {
  newGuestId?: () => string;
  onEvent?: (event: BrowserRegistryEvent) => void;
  /** Synchronous revocation/detach hook. Called before lifecycle events, never grants authority. */
  onRevoke?: (record: BrowserGuestRecord, reason: BrowserRegistryEvent["kind"], guest?: BrowserGuestHandle) => void;
}
type Entry<G> = { record: BrowserGuestRecord; guest?: G; clean?: () => void };

/** Runtime-only identities; LRU unmount keeps the entry, explicit close retires it forever. */
export class BrowserRegistry<G extends BrowserGuestHandle = BrowserGuestHandle> {
  private hosts = new Map<string, string>();
  private entries = new Map<string, Entry<G>>();
  private instances = new Map<string, Map<string, string>>();
  private issued = new Set<string>();
  private contents = new Map<number, string>();
  constructor(private readonly options: BrowserRegistryOptions = {}) {}

  registerHost(hostId: string, epoch: string): void {
    browserPartition(hostId);
    if (typeof epoch !== "string" || !epoch || epoch.length > 256) throw new Error("Invalid host epoch");
    const old = this.hosts.get(hostId);
    if (old === epoch) return;
    // Remove admission first, so callbacks cannot re-enter with the old host binding.
    this.hosts.delete(hostId);
    if (old !== undefined) this.retireHost(hostId, "host_changed");
    this.hosts.set(hostId, epoch);
  }
  removeHost(hostId: string): void {
    this.hosts.delete(hostId);
    this.retireHost(hostId, "host_removed");
  }
  hostIds(): string[] { return [...this.hosts.keys()]; }
  ensure(hostId: string, tabKey: string, pool: BrowserPool = "owner"): BrowserGuestRecord {
    const epoch = this.hosts.get(hostId);
    if (!epoch || typeof tabKey !== "string" || !tabKey || tabKey.length > 256 || /[\x00-\x1f\x7f]/.test(tabKey))
      throw new Error("Unregistered host or invalid browser instance");
    const partition = browserPartition(hostId, pool);
    const old = this.getByTab(hostId, tabKey);
    if (old) {
      if (old.pool !== pool) throw new Error("Browser instance pool cannot change");
      return old;
    }
    const guestId = this.options.newGuestId?.() ?? `browser-${randomBytes(16).toString("hex")}`;
    if (typeof guestId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(guestId) || this.issued.has(guestId))
      throw new Error("Guest identity allocator failed");
    this.issued.add(guestId);
    const record = Object.freeze({ guestId, hostId, epoch, tabKey, partition, pool, pageGeneration: 0, status: "unmounted" as const });
    this.entries.set(guestId, { record });
    let byInstance = this.instances.get(hostId);
    if (!byInstance) this.instances.set(hostId, byInstance = new Map());
    byInstance.set(tabKey, guestId);
    this.emit(record, "created");
    return record;
  }
  get(guestId: string): BrowserGuestRecord | undefined { return this.entries.get(guestId)?.record; }
  getByTab(hostId: string, tabKey: string): BrowserGuestRecord | undefined {
    const id = this.instances.get(hostId)?.get(tabKey);
    return id ? this.get(id) : undefined;
  }
  list(hostId?: string): BrowserGuestRecord[] {
    return [...this.entries.values()].map(e => e.record).filter(r => hostId === undefined || r.hostId === hostId);
  }
  getWebContents(guestId: string): G | undefined { return this.entries.get(guestId)?.guest; }
  getByWebContentsId(id: number): BrowserGuestRecord | undefined {
    const guestId = this.contents.get(id);
    return guestId ? this.get(guestId) : undefined;
  }
  nextPageGeneration(guestId: string): number {
    const entry = this.require(guestId);
    if (entry.record.pageGeneration >= Number.MAX_SAFE_INTEGER) {
      this.close(guestId);
      throw new Error("Browser page generation exhausted");
    }
    entry.record = Object.freeze({ ...entry.record, pageGeneration: entry.record.pageGeneration + 1 });
    return entry.record.pageGeneration;
  }
  /**
   * replace: a carrier hand-over of the same tab (background carrier <-> visible webview). The old
   * guest is closed and its page generation retired like an unmount, but onRevoke learns it was
   * "replaced" so main keeps the tab's lease (it re-prepares control on the new guest itself).
   */
  attach(guestId: string, guest: G, options: { replace?: boolean } = {}): BrowserGuestRecord {
    const entry = this.require(guestId);
    if (guest.isDestroyed() || !Number.isSafeInteger(guest.id) || guest.id <= 0) throw new Error("Invalid browser guest");
    if (entry.guest === guest) return entry.record;
    if (this.contents.has(guest.id)) throw new Error("WebContents already belongs to a guest");
    if (entry.guest) this.detachEntry(entry, options.replace === true ? "replaced" : "unmounted", true);
    this.nextPageGeneration(guestId);
    entry.guest = guest;
    entry.record = Object.freeze({ ...entry.record, status: "attached" });
    this.contents.set(guest.id, guestId);
    const destroyed = () => { if (entry.guest === guest) this.detachEntry(entry, "destroyed", false); };
    const crashed = () => { if (entry.guest === guest) this.detachEntry(entry, "crashed", true); };
    guest.on("destroyed", destroyed);
    guest.on("render-process-gone", crashed);
    entry.clean = () => { guest.removeListener("destroyed", destroyed); guest.removeListener("render-process-gone", crashed); };
    this.emit(entry.record, "attached");
    return entry.record;
  }
  unmount(guestId: string): void {
    const entry = this.entries.get(guestId);
    if (entry?.guest) this.detachEntry(entry, "unmounted", true);
  }
  close(guestId: string): void { this.retire(guestId, "closed"); }
  dispose(): void { for (const hostId of this.hostIds()) this.removeHost(hostId); }
  private require(guestId: string): Entry<G> {
    const entry = this.entries.get(guestId);
    if (!entry || this.hosts.get(entry.record.hostId) !== entry.record.epoch) throw new Error("Browser guest is closed or host changed");
    return entry;
  }
  private detachEntry(entry: Entry<G>, kind: BrowserRegistryEvent["kind"], close: boolean): void {
    const guest = entry.guest;
    entry.clean?.(); entry.clean = undefined; entry.guest = undefined;
    if (guest) this.contents.delete(guest.id);
    // Saturate only for terminal cleanup; allocation itself fails closed above.
    entry.record = Object.freeze({ ...entry.record, pageGeneration: Math.min(Number.MAX_SAFE_INTEGER, entry.record.pageGeneration + 1),
      status: kind === "crashed" ? "crashed" : "unmounted" });
    try { this.options.onRevoke?.(entry.record, kind, guest); } catch { /* Cleanup must finish even if a subscriber fails. */ }
    if (close && guest && !guest.isDestroyed()) { try { guest.close({ waitForBeforeUnload: false }); } catch { /* Already gone. */ } }
    this.emit(entry.record, kind);
  }
  private retire(guestId: string, kind: BrowserRegistryEvent["kind"]): void {
    const entry = this.entries.get(guestId);
    if (!entry) return;
    this.entries.delete(guestId);
    this.instances.get(entry.record.hostId)?.delete(entry.record.tabKey);
    this.detachEntry(entry, kind, true);
  }
  private retireHost(hostId: string, kind: "host_changed" | "host_removed"): void {
    for (const record of this.list(hostId)) this.retire(record.guestId, kind);
    this.instances.delete(hostId);
  }
  private emit(record: BrowserGuestRecord, kind: BrowserRegistryEvent["kind"]): void {
    try { this.options.onEvent?.({ ...record, kind }); } catch { /* Observer failures cannot restore authority. */ }
  }
}
