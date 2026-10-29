import type { StorageOverview } from "../../../../shared/storage";
/** Small wire fixture shared by request-lifecycle tests; preview data stays in mock.ts. */
export function storageFixture(host = "test-host"): StorageOverview {
  const at = new Date(Date.now() - 90 * 60_000).toISOString();
  return { host, home: "/test/cutex", generatedAt: at, volume: null, totals: { bytes: 1024, files: 1 }, walk: { state: "idle", startedAt: at, finishedAt: at, progress: null, stale: false },
    groups: [{ id: "history", labelKey: "storage.group.history", label: "History", bytes: 1024 }],
    stores: [{ id: "light-homes", group: "history", labelKey: "storage.store.light-homes", label: "Local copies", path: "runtime/light", kind: "directory", measure: "walk", measuredAt: at, datesFrom: "mtime", bytes: 1024, files: 1, links: 0, unreadable: 0, oldestAt: at, newestAt: at, items: { count: 1, unit: "item" }, retention: { rule: "none", days: null, keepReferenced: false, configurable: false, setting: null }, actions: [], drillDown: true }],
  };
}
