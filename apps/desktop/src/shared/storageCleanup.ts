/** Management v2 storage-cleanup. The daemon owns discovery, admission and deletion. */
export const STORAGE_CLEANUP_FEATURE = "storage-cleanup";
export type StorageCleanupAction = "orphan-homes" | "retired-homes" | "old-backups" | "old-logs" | "vacuum";
export interface StorageCleanupPreviewRequest {
  action: StorageCleanupAction;
  /** Root-relative paths, checked against action allowlists by the daemon. */
  items?: string[];
  olderThanDays?: number;
}
export interface StorageCleanupExecuteRequest {
  requestId: string;
  previewId: string;
  /** IDs from this exact preview, never filesystem paths. */
  items?: string[];
  confirmed: true;
  confirmText?: string;
}
export interface StorageCleanupPreviewItem {
  id: string;
  path: string;
  bytes: number;
  files: number;
  mtime: string | null;
  eligible: boolean;
  reason: string | null;
  code: string | null;
}
export interface StorageCleanupPreview {
  previewId: string;
  expiresAt: string;
  action: StorageCleanupAction;
  risk: "high" | "medium";
  items: StorageCleanupPreviewItem[];
  freeableBytes: number;
  /** False when discovery stopped at a budget. Omitted by earlier hosts. Items remain fully inspected. */
  complete?: boolean;
  partialReason?: "time_budget" | "item_limit" | "entry_limit";
  inspectedItems?: number;
  elapsedMs?: number;
}
export interface StorageCleanupRunItem {
  id: string;
  path: string;
  state: "queued" | "moving" | "deleting" | "deleted" | "vacuumed" | "skipped" | "failed";
  outcome?: "deleted" | "vacuumed" | "skipped" | "failed" | null;
  freedBytes: number;
  reason: string | null;
  code?: string | null;
  operation?: StorageCleanupAction;
  retainedPath?: string;
}
export interface StorageCleanupRun {
  runId: string;
  requestId?: string;
  previewId?: string;
  action?: StorageCleanupAction;
  state: "running" | "completed" | "failed";
  /** Durable worker pause/failure detail; absent on earlier cleanup hosts. */
  error?: string | null;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string | null;
  freedBytes: number;
  actor?: { principal: "owner"; clientName: "desktop" | "hostCli"; deviceId: string | null };
  items: StorageCleanupRunItem[];
}
export interface StorageCleanupHistory { items: StorageCleanupRun[]; nextCursor?: string | null }
export interface StorageCleanupApi {
  storageCleanupPreview(request: StorageCleanupPreviewRequest): Promise<StorageCleanupPreview>;
  storageCleanupExecute(request: StorageCleanupExecuteRequest): Promise<StorageCleanupRun>;
  storageCleanupHistory(): Promise<StorageCleanupHistory>;
  storageCleanupRun(runId: string): Promise<StorageCleanupRun>;
}
