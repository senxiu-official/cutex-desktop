import type { StorageApi, StorageItem, StorageOverview } from "../../../../shared/storage";
import { needsRefresh } from "./model";
export interface StorageState {
  view: StorageOverview | null;
  loading: boolean;
  refreshing: boolean;
  unsupported: boolean;
  error: string | null;
  detail: { storeId: string; items: StorageItem[]; nextCursor: string | null; loading: boolean; error: string | null } | null;
}
const initial = (): StorageState => ({ view: null, loading: false, refreshing: false, unsupported: false, error: null, detail: null });
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
/** One controller per host; all async replies are fenced by lifetime and request order. */
export class StorageController {
  private state = initial();
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private reads = 0;
  private details = 0;
  private autoAttempted = false;
  constructor(private readonly api: StorageApi) {}
  getSnapshot = (): StorageState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<StorageState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  start = (): void => { this.active = true; this.autoAttempted = false; this.patch({ loading: false, refreshing: false, detail: null }); };
  stop = (): void => { this.active = false; ++this.epoch; ++this.reads; ++this.details; };
  private current(epoch: number): boolean { return this.active && epoch === this.epoch; }
  async load(auto = false): Promise<void> {
    if (!this.active) return;
    const epoch = this.epoch, read = ++this.reads;
    this.patch({ loading: true, error: null });
    try {
      const view = await this.api.storage();
      if (!this.current(epoch) || read !== this.reads) return;
      const changed = !!this.state.view && this.state.view.walk.finishedAt !== view?.walk.finishedAt;
      this.patch({ view, loading: false, unsupported: !view });
      if (changed && this.state.detail) void this.openDetails(this.state.detail.storeId);
      if (auto && view && !this.autoAttempted && needsRefresh(view)) { this.autoAttempted = true; await this.refresh(); }
    } catch (error) { if (this.current(epoch) && read === this.reads) this.patch({ loading: false, error: message(error) }); }
  }
  async refresh(): Promise<void> {
    if (!this.active || this.state.refreshing || this.state.view?.walk.state === "running") return;
    const epoch = this.epoch;
    ++this.reads;
    this.patch({ refreshing: true, loading: false, error: null });
    try {
      await this.api.storageRefresh();
      if (!this.current(epoch)) return;
      this.patch({ refreshing: false });
      await this.load();
    } catch (error) { if (this.current(epoch)) this.patch({ refreshing: false, error: message(error) }); }
  }
  closeDetails = (): void => { ++this.details; this.patch({ detail: null }); };
  async openDetails(storeId: string, more = false): Promise<void> {
    if (!this.active || (more && (this.state.detail?.storeId !== storeId || this.state.detail.loading || !this.state.detail.nextCursor))) return;
    const epoch = this.epoch, read = ++this.details;
    const previous = more ? this.state.detail : null;
    this.patch({ detail: { storeId, items: previous?.items ?? [], nextCursor: previous?.nextCursor ?? null, loading: true, error: null } });
    try {
      const result = await this.api.storageItems(storeId, { sort: "bytes", limit: 50, ...(previous?.nextCursor ? { cursor: previous.nextCursor } : {}) });
      if (!this.current(epoch) || read !== this.details) return;
      if (result.store !== storeId) throw new Error("Storage response does not match the selected store");
      const items = [...(previous?.items ?? []), ...result.items];
      this.patch({ detail: { storeId, items: [...new Map(items.map((item) => [item.id, item])).values()], nextCursor: result.nextCursor, loading: false, error: null } });
    } catch (error) { if (this.current(epoch) && read === this.details && this.state.detail) this.patch({ detail: { ...this.state.detail, loading: false, error: message(error) } }); }
  }
  walkChanged(): void {
    void this.load();
    if (this.state.detail) void this.openDetails(this.state.detail.storeId);
  }
}
