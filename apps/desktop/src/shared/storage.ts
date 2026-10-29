/** Host storage P1 wire types (cutex host-storage). Cleanup is intentionally absent. */
export const STORAGE_FEATURE = "host-storage";
export const STORAGE_WALK_CHANGED = "cutex/storage/walkChanged";
export type StorageRule = "forever" | "age" | "count" | "size" | "rotate" | "archive" | "internal" | "derived" | "native" | "none";
export interface StorageRetention {
  rule: StorageRule | (string & {});
  days: number | null;
  minHours?: number | null;
  maxBytes?: number;
  keepReferenced: boolean;
  configurable: boolean;
  setting: { store: string; key: string } | null;
  detail?: string;
}
export interface StorageMeasurement {
  bytes: number;
  files: number;
  links: number;
  unreadable: number;
  oldestAt: string | null;
  newestAt: string | null;
  rolloutBytes?: number;
  /** Backend measurement bookkeeping; public counts are in store.items.count. */
  itemCount?: number | null;
}
export interface StorageStore extends StorageMeasurement {
  id: string;
  group: string;
  labelKey: string;
  label: string;
  path: string;
  kind: "directory" | "file" | "jsonl" | "json" | "sqlite" | "mixed";
  measure: "walk" | "stat";
  measuredAt: string | null;
  datesFrom: "mtime" | "record" | "filename";
  items: { count: number | null; unit: string };
  retention: StorageRetention;
  actions: readonly unknown[];
  drillDown: boolean;
}
export interface StorageOverview {
  host: string;
  generatedAt: string;
  home: string;
  volume: { totalBytes: number; freeBytes: number } | null;
  totals: { bytes: number; files: number };
  walk: {
    state: "idle" | "running";
    startedAt: string | null;
    finishedAt: string | null;
    durationMs?: number | null;
    nextAutoAt?: string | null;
    progress: { entries?: number } | null;
    stale: boolean;
    error?: string | null;
  };
  groups: { id: string; labelKey: string; label: string; bytes: number }[];
  stores: StorageStore[];
}
export interface StorageItem extends StorageMeasurement {
  id: string;
  path: string;
  name?: string | null;
  cutexSessionId?: string;
  state?: "active" | "retired" | "deleted" | "unknown" | (string & {});
}
export interface StorageItemsPage { store: string; items: StorageItem[]; nextCursor: string | null }
export interface StorageRefresh { state: "running"; startedAt: string }
export interface StorageItemQuery { sort?: "bytes"; limit?: number; cursor?: string }
export interface StorageApi {
  storage(): Promise<StorageOverview | null>;
  storageRefresh(stores?: string[]): Promise<StorageRefresh>;
  storageItems(storeId: string, query?: StorageItemQuery): Promise<StorageItemsPage>;
}
