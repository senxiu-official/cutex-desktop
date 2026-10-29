import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import type { StorageApi, StorageItemQuery, StorageItemsPage, StorageOverview, StorageRefresh } from "../shared/storage";

function storeId(id: unknown): string {
  if (typeof id !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(id)) throw new Error("invalid storage store id");
  return id;
}
function itemQuery(input: StorageItemQuery = {}): { sort: "bytes"; limit?: number; cursor?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["sort", "limit", "cursor"].includes(key))) throw new Error("invalid storage query");
  if (input.sort !== undefined && input.sort !== "bytes") throw new Error("invalid storage sort");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500)) throw new Error("invalid storage limit");
  if (input.cursor !== undefined && (typeof input.cursor !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(input.cursor) || !Number.isSafeInteger(Number(input.cursor)))) throw new Error("invalid storage cursor");
  return { sort: "bytes", ...(input.limit === undefined ? {} : { limit: input.limit }), ...(input.cursor === undefined ? {} : { cursor: input.cursor }) };
}
/** Narrow daemon facade: statistics and refresh only, never arbitrary paths or cleanup. */
export function storageApi(client: Pick<CutexClient, "request">): StorageApi {
  return {
    async storage() {
      try { return await client.request<StorageOverview>("GET", "/v2/storage"); }
      catch (error) { if (error instanceof CutexApiError && (error.status === 404 || error.status === 501)) return null; throw error; }
    },
    storageRefresh(stores) {
      if (stores !== undefined && (!Array.isArray(stores) || !stores.length || stores.length > 100)) throw new Error("invalid storage store selection");
      const body = stores === undefined ? {} : { stores: [...new Set(stores.map(storeId))] };
      return client.request<StorageRefresh>("POST", "/v2/storage/refresh", { body });
    },
    storageItems(id, query) {
      return client.request<StorageItemsPage>("GET", `/v2/storage/stores/${encodeURIComponent(storeId(id))}/items`, { query: itemQuery(query) });
    },
  };
}
