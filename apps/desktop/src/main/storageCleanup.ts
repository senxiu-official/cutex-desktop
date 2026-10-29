import type { CutexClient } from "@cutex-desktop/cutex-client";
import type { StorageCleanupApi, StorageCleanupExecuteRequest, StorageCleanupHistory, StorageCleanupPreview, StorageCleanupPreviewRequest, StorageCleanupRun } from "../shared/storageCleanup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["orphan-homes", "retired-homes", "old-backups", "old-logs", "vacuum"]);
function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !fields.includes(key))) throw new Error("invalid storage cleanup request");
  return input as Record<string, unknown>;
}
function uuid(input: unknown): string {
  if (typeof input !== "string" || !UUID.test(input)) throw new Error("invalid storage cleanup UUID");
  return input;
}
function relativePath(input: unknown): string {
  // Canonical wire paths use '/'. No drive, UNC, ADS, traversal or controls.
  if (typeof input !== "string" || input.length > 4096 || /[\\:\x00-\x1f\x7f]/.test(input) || input.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid storage cleanup relative path");
  return input;
}
function itemId(input: unknown): string {
  if (typeof input !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(input)) throw new Error("invalid storage cleanup item id");
  return input;
}
function selection(input: unknown, validate: (value: unknown) => string): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || !input.length || input.length > 10000) throw new Error("invalid storage cleanup selection");
  const items = input.map(validate);
  if (new Set(items).size !== items.length || items.reduce((size, value) => size + value.length, 0) > 1024 * 1024) throw new Error("invalid storage cleanup selection");
  return items;
}
function previewRequest(input: StorageCleanupPreviewRequest): StorageCleanupPreviewRequest {
  const value = object(input, ["action", "items", "olderThanDays"]);
  if (typeof value.action !== "string" || !ACTIONS.has(value.action)) throw new Error("invalid storage cleanup action");
  const days = value.olderThanDays;
  if (days !== undefined && (!Number.isSafeInteger(days) || (days as number) < 1 || (days as number) > 4294967295)) throw new Error("invalid storage cleanup age");
  const items = selection(value.items, relativePath);
  return { action: value.action as StorageCleanupPreviewRequest["action"], ...(items === undefined ? {} : { items }), ...(days === undefined ? {} : { olderThanDays: days as number }) };
}
function executeRequest(input: StorageCleanupExecuteRequest): StorageCleanupExecuteRequest {
  const value = object(input, ["requestId", "previewId", "items", "confirmed", "confirmText"]);
  if (value.confirmed !== true) throw new Error("storage cleanup requires confirmation");
  if (value.confirmText !== undefined && value.confirmText !== "删除") throw new Error("invalid storage cleanup confirmation text");
  const items = selection(value.items, itemId);
  return { requestId: uuid(value.requestId), previewId: uuid(value.previewId), confirmed: true, ...(items === undefined ? {} : { items }), ...(value.confirmText === undefined ? {} : { confirmText: value.confirmText as string }) };
}
/** Fixed routes only. Mutations are sent once; admission and preview binding stay server-side. */
export function storageCleanupApi(client: Pick<CutexClient, "request">): StorageCleanupApi {
  return {
    storageCleanupPreview(input) {
      return client.request<StorageCleanupPreview>("POST", "/v2/storage/cleanups/preview", { body: previewRequest(input) });
    },
    storageCleanupExecute(input) {
      return client.request<StorageCleanupRun>("POST", "/v2/storage/cleanups", { body: executeRequest(input) });
    },
    storageCleanupHistory() {
      return client.request<StorageCleanupHistory>("GET", "/v2/storage/cleanups");
    },
    storageCleanupRun(runId) {
      return client.request<StorageCleanupRun>("GET", `/v2/storage/cleanups/${uuid(runId)}`);
    },
  };
}
