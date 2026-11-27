import type { StorageCleanupApi, StorageCleanupPreview, StorageCleanupRun } from "../../../../shared/storageCleanup";
import { STORAGE_CLEANUP_FEATURE } from "../../../../shared/storageCleanup";
import type { StorageApi, StorageItem, StorageOverview, StorageStore } from "../../../../shared/storage";
import { STORAGE_FEATURE, STORAGE_WALK_CHANGED } from "../../../../shared/storage";
import type { ModuleMock } from "../../dev/mockTypes";

export function mockStorageView(host = "preview-host"): StorageOverview {
  const measuredAt = new Date(Date.now() - 90 * 60_000).toISOString();
  const definitions = [
    ["light-homes", "history", "runtime/light", 9.4, "none"],
    ["codex-sessions", "history", "codex-home/sessions", 6.4, "native"],
    ["history-media", "media", "runtime/management-v2/history-media", 0.7, "size"],
    ["attachments", "media", "runtime/attachments", 0.15, "forever"],
    ["workflow-runs", "activity", "runtime/workflows/runs.sqlite3", 0.03, "forever"],
    ["diagnostics", "logs", "runtime/diagnostics", 0.57, "none"],
    ["codex-home-backups", "backups", "codex-home/db-backups", 3.4, "none"],
    ["user-input", "management", "runtime/management-v2/user-input-state.json", 0.001, "internal"],
    // cutex storage/stock-tmp-reclaim: Native shell temp dirs (`?nostocktmp`: an older host without it).
    ...(typeof location !== "undefined" && new URLSearchParams(location.search).has("nostocktmp") ? [] : [["stock-tmp", "logs", "runtime/stock-tmp", 1.4, "none"] as const]),
  ] as const;
  const stores: StorageStore[] = definitions.map(([id, group, path, gib, rule]) => ({
    id, group, labelKey: `storage.store.${id}`, label: id, path, kind: id === "user-input" ? "json" : "directory", bytes: Math.round(gib * 1024 ** 3), files: id === "light-homes" ? 208625 : id === "stock-tmp" ? 48210 : 100,
    links: id === "light-homes" ? 160 : 0, unreadable: id === "diagnostics" ? 2 : 0, oldestAt: "2026-06-02T08:14:00Z", newestAt: measuredAt,
    measure: id === "user-input" ? "stat" : "walk", measuredAt, datesFrom: "mtime", items: { count: id === "light-homes" ? 61 : null, unit: "item" },
    retention: { rule, days: id === "user-input" ? 30 : null, keepReferenced: id === "attachments", configurable: false, setting: null, ...(id === "history-media" ? { maxBytes: 2 * 1024 ** 3 } : {}) },
    actions: [], drillDown: id !== "user-input",
  }));
  const groups = [...new Set(stores.map((s) => s.group))].map((id) => ({ id, labelKey: `storage.group.${id}`, label: id, bytes: stores.filter((s) => s.group === id).reduce((sum, s) => sum + s.bytes, 0) }));
  return { host, home: "/preview/cutex", generatedAt: new Date().toISOString(), volume: { totalBytes: 1024 ** 4, freeBytes: 170 * 1024 ** 3 }, totals: { bytes: stores.reduce((n, s) => n + s.bytes, 0), files: stores.reduce((n, s) => n + s.files, 0) }, walk: { state: "idle", startedAt: measuredAt, finishedAt: measuredAt, durationMs: 15193, progress: null, stale: false, error: null }, groups, stores };
}
/** An archived agent's local copy (light-homes item naming it, like cutex): a size from its id, so figures are stable. */
function archivedHome(id: string, name: string, state: "retired" | "active" = "retired"): StorageItem {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { id: `light-homes-${id}`, path: `runtime/light/agents/${id}`, name, cutexSessionId: id, state, bytes: (3 + (h % 900)) * 1024 ** 2 + (h % 1000) * 1024, files: 40 + (h % 4000), links: 0, unreadable: 0, oldestAt: "2026-06-02T08:14:00Z", newestAt: "2026-11-01T08:00:00Z", rolloutBytes: (1 + (h % 60)) * 1024 ** 2 };
}
export function mockStorageApi(legacy: boolean, emit: (method: string, params: Record<string, unknown>) => void, host?: string, archived: () => { id: string; name: string; state?: "retired" | "active" }[] = () => []): StorageApi {
  const view = mockStorageView(host);
  return {
    async storage() { return legacy ? null : structuredClone(view); },
    async storageRefresh() {
      if (legacy) throw new Error("Storage is unavailable");
      if (view.walk.state === "idle") {
        view.walk.state = "running"; view.walk.startedAt = new Date().toISOString(); view.walk.progress = { entries: 2000 };
        emit(STORAGE_WALK_CHANGED, { state: "running", finishedAt: null });
        setTimeout(() => {
          const at = new Date().toISOString();
          view.walk.state = "idle"; view.walk.finishedAt = at; view.walk.progress = null; view.walk.stale = false;
          view.stores.forEach((s) => { s.measuredAt = at; });
          emit(STORAGE_WALK_CHANGED, { state: "idle", finishedAt: at });
        }, 700);
      }
      return { state: "running", startedAt: view.walk.startedAt! };
    },
    async storageItems(storeId, query = {}) {
      if (legacy || !view.stores.some((s) => s.id === storeId)) throw new Error("Unknown storage store");
      const all: StorageItem[] = Array.from({ length: storeId === "light-homes" ? 61 : 5 }, (_, index) => ({
        id: `${storeId}-${index}`, path: `${view.stores.find((s) => s.id === storeId)!.path}/${index + 1}`, name: storeId === "light-homes" ? `Agent ${index + 1}` : undefined,
        state: storeId === "light-homes" ? index % 3 === 0 ? "retired" : "active" : undefined,
        bytes: Math.round((61 - index) * 1024 ** 2), files: 200, links: 0, unreadable: 0, oldestAt: "2026-06-02T08:14:00Z", newestAt: view.walk.finishedAt, rolloutBytes: storeId === "light-homes" ? 4 * 1024 ** 2 : 0,
      }));
      // The host's agents have their copies here too (设置 → 归档's figures, archived and active); largest first like cutex.
      if (storeId === "light-homes") all.push(...archived().map((a) => archivedHome(a.id, a.name, a.state)));
      all.sort((a, b) => b.bytes - a.bytes);
      const from = Number(query.cursor ?? 0), limit = query.limit ?? 50;
      return { store: storeId, items: all.slice(from, from + limit), nextCursor: from + limit < all.length ? String(from + limit) : null };
    },
  };
}
export const mock: ModuleMock = {
  features: { new: [STORAGE_FEATURE, ...(typeof location === "undefined" || !new URLSearchParams(location.search).has("nocleanup") ? [STORAGE_CLEANUP_FEATURE] : [])] },
  api: (core) => ({ ...mockStorageApi(core.legacy, (method, params) => core.emitHost(method, params), undefined, () => { const r = core.projectRecords(); return [...r.retired.map((s) => ({ id: s.cutexSessionId, name: s.displayName })), ...r.active.map((s) => ({ id: s.cutexSessionId, name: s.displayName, state: "active" as const }))]; }), ...mockCleanupApi(core.legacy, (method, params) => core.emitHost(method, params)) }),
  remote: (hostId, emit) => ({ ...mockStorageApi(false, emit, hostId), ...mockCleanupApi(false, emit) }),
};

const query = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);
/** cutex stock-tmp candidates: launch-owned first (stopped = eligible, held / replaced = blocked), then unknown ownership. */
export function mockStockTmpPreview(uuid: () => string = () => crypto.randomUUID()): StorageCleanupPreview {
  const MiB = 1024 ** 2;
  const rows: [string, number, number, boolean, string, string][] = [
    ["runtime/stock-tmp/managed/occ-4f1a/shell", 820, 12400, true, "stock_temp_stopped", "kai · generation 3 · stopped; publication lease released"],
    ["runtime/stock-tmp/managed/occ-9b2c/shell", 214, 3100, true, "stock_temp_stopped", "sora · generation 7 · stopped; publication lease released"],
    ["runtime/stock-tmp/managed/occ-77de/shell", 64, 880, false, "stock_temp_held", "eva · generation 12 · no complete stop or holder evidence"],
    ["runtime/stock-tmp/managed/occ-legacy-3", 12, 140, false, "stock_temp_unknown", "No launch ownership receipt was published"],
    ["runtime/stock-tmp/codex-shell-8f2e", 296, 31690, false, "stock_temp_unknown", "Ownership unknown; older Native or tool temporary data"],
  ];
  return { previewId: uuid(), action: "stock-tmp", expiresAt: new Date(Date.now() + 600000).toISOString(), risk: "high", freeableBytes: (820 + 214) * MiB, complete: true,
    items: rows.map(([path, mib, files, eligible, code, reason]) => ({ id: uuid(), path, bytes: mib * MiB, files, mtime: "2026-11-20T09:30:00Z", eligible, code, reason })) };
}
function mockCleanupApi(legacy: boolean, emit: (method: string, params: Record<string, unknown>) => void): StorageCleanupApi {
  const previews = new Map<string, StorageCleanupPreview>(); const runs = new Map<string, StorageCleanupRun>(); const requests = new Map<string, string>(); let dropped = false;
  const uuid = () => crypto.randomUUID();
  return {
    async storageCleanupPreview(request) {
      if (legacy) throw new Error("storage-cleanup unavailable");
      if (request.action === "stock-tmp") { const preview = mockStockTmpPreview(uuid); previews.set(preview.previewId, preview); return structuredClone(preview); }
      const vacuum = request.action === "vacuum";
      const paths = vacuum ? ["runtime/summary/summary.sqlite3", "runtime/notes/notes.sqlite3", "runtime/activity/active.sqlite3"] : request.action === "old-backups" ? ["codex-home/db-backups/state-20260801.sqlite", "codex-home/db-backups/state-20260901.sqlite", "codex-home/db-backups/current.sqlite"] : request.action === "old-logs" ? ["runtime/diagnostics/20260801.log", "logs/management-r240.log", "logs/management-current.log"] : request.action === "retired-homes" ? ["runtime/light/agents/retired-a/cache", "runtime/light/agents/retired-b/plugins", "runtime/light/agents/active-c/cache"] : ["runtime/light/agents/deleted-a", "runtime/light/agents/deleted-b", "runtime/light/agents/current-c"];
      const preview: StorageCleanupPreview = { previewId: uuid(), action: request.action, expiresAt: new Date(Date.now() + (query().has("cleanupexpired") ? 1200 : 600000)).toISOString(), risk: ["old-logs", "vacuum"].includes(request.action) ? "medium" : "high", freeableBytes: vacuum ? 512 * 1024 : 15 * 1024 ** 2, items: paths.map((path, index) => ({ id: uuid(), path, bytes: (index ? 3 : 12) * 1024 ** 2, files: vacuum ? 1 : 80, mtime: "2026-08-01T00:00:00Z", eligible: index !== 2, reason: index === 2 ? "仍在使用，保留" : request.action === "retired-homes" ? "可重新生成，对话记录保留" : "不再使用且超过保留时间", code: index === 2 ? "active" : "eligible" })) };
      previews.set(preview.previewId, preview); return structuredClone(preview);
    },
    async storageCleanupExecute(request) {
      if (legacy) throw new Error("storage-cleanup unavailable");
      const previous = requests.get(request.requestId); if (previous) return structuredClone(runs.get(previous)!);
      const preview = previews.get(request.previewId); if (!preview || Date.parse(preview.expiresAt) <= Date.now()) throw new Error("cleanup_preview_changed: preview expired");
      if (!request.confirmed || (preview.risk === "high" && request.confirmText !== "删除")) throw new Error("confirmation required");
      const run: StorageCleanupRun = { runId: uuid(), requestId: request.requestId, previewId: preview.previewId, action: preview.action, state: "running", createdAt: new Date().toISOString(), finishedAt: null, freedBytes: 0, items: preview.items.filter((item) => item.eligible && (!request.items || request.items.includes(item.id))).map((item) => ({ id: item.id, path: item.path, state: "queued", outcome: null, freedBytes: 0, reason: null, operation: preview.action })) };
      runs.set(run.runId, run); requests.set(request.requestId, run.runId); emit("cutex/storage/cleanupChanged", { runId: run.runId, state: run.state, freedBytes: 0 });
      setTimeout(() => { run.state = "completed"; run.finishedAt = new Date().toISOString(); run.items.forEach((item, index) => { const changed = index === 1 && preview.action !== "vacuum"; item.state = changed ? "skipped" : preview.action === "vacuum" ? "vacuumed" : "deleted"; item.outcome = item.state; item.code = changed ? "changed" : null; item.reason = changed ? "changed since preview" : null; item.freedBytes = changed ? 0 : preview.action === "vacuum" ? 256 * 1024 : preview.items.find((entry) => entry.id === item.id)!.bytes; }); run.freedBytes = run.items.reduce((sum, item) => sum + item.freedBytes, 0); emit("cutex/storage/cleanupChanged", { runId: run.runId, state: run.state, freedBytes: run.freedBytes }); }, 1000);
      if (query().has("cleanuperror") && !dropped) { dropped = true; throw new Error("Response lost after submission (mock)"); }
      return structuredClone(run);
    },
    async storageCleanupHistory() { return { items: structuredClone([...runs.values()].reverse()) }; },
    async storageCleanupRun(id) { const run = runs.get(id); if (!run) throw new Error("run not found"); return structuredClone(run); },
  };
}
