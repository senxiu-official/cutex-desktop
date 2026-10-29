import type { StorageCleanupExecuteRequest } from "../../../../shared/storageCleanup";
import type { CleanupPendingStore } from "./cleanupController";
const memory = new Map<string, StorageCleanupExecuteRequest>();
/** Only consent IDs/selected item IDs; no file paths or credentials. Removed once the receipt is known. */
export function cleanupPending(hostId: string): CleanupPendingStore {
  const key = `cutex-desktop.storage-cleanup.pending:${hostId}`;
  return {
    read() {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null") as StorageCleanupExecuteRequest | null;
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        if (value && uuid.test(value.requestId) && uuid.test(value.previewId) && value.confirmed === true && Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 10000 && value.items.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(id)) && new Set(value.items).size === value.items.length && (value.confirmText === undefined || value.confirmText === "删除")) return { requestId: value.requestId, previewId: value.previewId, confirmed: true, items: [...value.items], ...(value.confirmText ? { confirmText: value.confirmText } : {}) };
      } catch { /* unavailable/corrupt storage */ }
      return memory.get(key) ?? null;
    },
    write(value) {
      if (value) memory.set(key, value); else memory.delete(key);
      try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch { /* retain memory fallback */ }
    },
  };
}
