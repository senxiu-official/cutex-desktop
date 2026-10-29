import type { StorageCleanupApi, StorageCleanupPreview, StorageCleanupPreviewRequest, StorageCleanupExecuteRequest, StorageCleanupRun } from "../../../../shared/storageCleanup";

export interface CleanupState {
  preview: StorageCleanupPreview | null; selected: readonly string[]; loading: boolean; executing: boolean;
  run: StorageCleanupRun | null; history: readonly StorageCleanupRun[]; historyLoading: boolean;
  error: string | null; historyError: string | null; pending: StorageCleanupExecuteRequest | null;
}
export interface CleanupPendingStore { read(): StorageCleanupExecuteRequest | null; write(request: StorageCleanupExecuteRequest | null): void }
const emptyPending: CleanupPendingStore = { read: () => null, write: () => {} };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export function highRisk(preview: StorageCleanupPreview): boolean {
  return preview.risk === "high" || ["orphan-homes", "retired-homes", "old-backups"].includes(preview.action);
}
export function selectedBytes(preview: StorageCleanupPreview, ids: readonly string[]): number {
  const selected = new Set(ids); return preview.items.filter((item) => item.eligible && selected.has(item.id)).reduce((bytes, item) => bytes + item.bytes, 0);
}
/** Host-bound, lifetime-fenced reads; explicit retries reuse the exact consent and request ID. */
export class CleanupController {
  private state: CleanupState;
  private active = false; private epoch = 0; private reads = 0; private previews = 0; private runReads = 0;
  private listeners = new Set<() => void>();
  constructor(private api: StorageCleanupApi, private canWrite: () => boolean = () => true, private pendingStore: CleanupPendingStore = emptyPending) {
    this.state = { preview: null, selected: [], loading: false, executing: false, run: null, history: [], historyLoading: false, error: null, historyError: null, pending: pendingStore.read() };
  }
  getSnapshot = (): CleanupState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(value: Partial<CleanupState>) { this.state = { ...this.state, ...value }; this.listeners.forEach((listener) => listener()); }
  private live(epoch: number) { return this.active && epoch === this.epoch; }
  start = () => { this.active = true; ++this.epoch; this.patch({ loading: false, executing: false, historyLoading: false }); };
  stop = () => { this.active = false; ++this.epoch; ++this.reads; ++this.previews; ++this.runReads; };
  clearPreview = () => { ++this.previews; this.patch({ preview: null, selected: [], loading: false, error: null }); };
  select = (id: string, selected: boolean) => {
    if (this.state.executing || this.state.pending || !this.state.preview?.items.some((item) => item.id === id && item.eligible)) return;
    this.patch({ selected: selected ? [...new Set([...this.state.selected, id])] : this.state.selected.filter((value) => value !== id) });
  };
  async preview(request: StorageCleanupPreviewRequest): Promise<void> {
    if (!this.active || !this.canWrite() || this.state.pending || this.state.executing || this.state.history.some((run) => run.state === "running")) return;
    const epoch = this.epoch, read = ++this.previews;
    this.patch({ preview: null, selected: [], loading: true, error: null, run: null });
    try {
      const preview = await this.api.storageCleanupPreview(request);
      if (!this.live(epoch) || read !== this.previews || !this.canWrite()) return;
      if (preview.action !== request.action || !Number.isFinite(Date.parse(preview.expiresAt)) || new Set(preview.items.map((item) => item.id)).size !== preview.items.length) throw new Error("storage.cleanup.mismatch");
      this.patch({ preview, selected: preview.items.filter((item) => item.eligible).map((item) => item.id), loading: false });
    } catch (error) { if (this.live(epoch) && read === this.previews) this.patch({ loading: false, error: message(error) }); }
  }
  async execute(confirmText?: string): Promise<void> {
    const { preview, selected } = this.state;
    if (!this.active || !this.canWrite() || this.state.executing || this.state.pending || !preview || !selected.length) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) { this.patch({ error: "storage.cleanup.expired" }); return; }
    if (highRisk(preview) && confirmText !== "删除") return;
    const eligible = new Set(preview.items.filter((item) => item.eligible).map((item) => item.id));
    if (selected.some((id) => !eligible.has(id))) return;
    const request: StorageCleanupExecuteRequest = { requestId: crypto.randomUUID(), previewId: preview.previewId, items: [...selected], confirmed: true, ...(highRisk(preview) ? { confirmText: "删除" } : {}) };
    this.pendingStore.write(request); this.patch({ pending: request });
    await this.send(request);
  }
  retry = async () => { if (this.state.pending) await this.send(this.state.pending); };
  private async send(request: StorageCleanupExecuteRequest): Promise<void> {
    if (!this.active || !this.canWrite() || this.state.executing) return;
    const epoch = this.epoch;
    this.patch({ executing: true, error: null });
    try {
      const run = await this.api.storageCleanupExecute(request);
      if (!this.live(epoch)) return;
      if (run.requestId && run.requestId !== request.requestId) throw new Error("storage.cleanup.mismatch");
      this.pendingStore.write(null);
      this.patch({ pending: null, executing: false, preview: null, selected: [], run });
      await this.loadHistory();
    } catch (error) {
      if (!this.live(epoch)) return;
      const text = message(error);
      if (/cleanup_preview_changed|storage_cleanup_desktop_only|invalid_request/.test(text)) {
        this.pendingStore.write(null);
        this.patch({ pending: null, preview: null, selected: [], executing: false, error: /cleanup_preview_changed/.test(text) ? "storage.cleanup.expired" : text });
      } else this.patch({ executing: false, error: text });
    }
  }
  async loadHistory(): Promise<void> {
    if (!this.active) return;
    const epoch = this.epoch, read = ++this.reads;
    this.patch({ historyLoading: true, historyError: null });
    try {
      const history = await this.api.storageCleanupHistory();
      if (!this.live(epoch) || read !== this.reads) return;
      const recovered = this.state.pending && history.items.find((run) => run.requestId === this.state.pending?.requestId);
      if (recovered) { this.pendingStore.write(null); this.patch({ pending: null, preview: null, selected: [], run: recovered, error: null }); }
      this.patch({ history: history.items, historyLoading: false });
    } catch (error) { if (this.live(epoch) && read === this.reads) this.patch({ historyLoading: false, historyError: message(error) }); }
  }
  async loadRun(id: string): Promise<void> {
    if (!this.active) return;
    const epoch = this.epoch, read = ++this.runReads;
    try {
      const run = await this.api.storageCleanupRun(id);
      if (!this.live(epoch) || read !== this.runReads) return;
      if (run.runId !== id) throw new Error("storage.cleanup.mismatch");
      this.patch({ run, error: null });
      if (run.state !== "running") void this.loadHistory();
    } catch (error) { if (this.live(epoch) && read === this.runReads) this.patch({ error: message(error) }); }
  }
}
