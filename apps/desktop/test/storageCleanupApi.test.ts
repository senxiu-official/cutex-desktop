import { describe, expect, it, vi } from "vitest";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import { storageCleanupApi } from "../src/main/storageCleanup";
import type { StorageCleanupExecuteRequest, StorageCleanupPreviewRequest } from "../src/shared/storageCleanup";

const previewId = "1ac311bc-c3e7-42ad-84d9-369373f1976d";
const requestId = "714048e0-7f51-438a-a71b-08f115a5d0fd";
const item = "2582b687-ccbe-421f-9ec5-914ac961322d";
function harness() {
  const request = vi.fn().mockResolvedValue({});
  return { request, api: storageCleanupApi({ request } as unknown as CutexClient) };
}
const execute = { requestId, previewId, confirmed: true as const, items: [item], confirmText: "删除" };

describe("storage cleanup daemon facade", () => {
  it("uses fixed preview, execute, history and run routes and preserves server replies", async () => {
    const { request, api } = harness();
    const preview = { previewId, items: [{ id: item, reason: null, code: null, mtime: null, eligible: false }] };
    request.mockResolvedValueOnce(preview);
    expect(await api.storageCleanupPreview({ action: "old-logs", olderThanDays: 30, items: ["runtime/diagnostics/旧日志.log"] })).toBe(preview);
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/storage/cleanups/preview", { body: { action: "old-logs", olderThanDays: 30, items: ["runtime/diagnostics/旧日志.log"] } });
    await api.storageCleanupExecute(execute);
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/storage/cleanups", { body: execute });
    await api.storageCleanupHistory();
    expect(request).toHaveBeenLastCalledWith("GET", "/v2/storage/cleanups");
    await api.storageCleanupRun(requestId);
    expect(request).toHaveBeenLastCalledWith("GET", `/v2/storage/cleanups/${requestId}`);
  });

  it("leaves omitted selections and action-specific eligibility decisions to the server", async () => {
    const { request, api } = harness();
    await api.storageCleanupPreview({ action: "vacuum" });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/storage/cleanups/preview", { body: { action: "vacuum" } });
    await api.storageCleanupExecute({ requestId, previewId, confirmed: true });
    expect(request).toHaveBeenLastCalledWith("POST", "/v2/storage/cleanups", { body: { requestId, previewId, confirmed: true } });
  });

  it.each(["/root", "../x", "a/../x", "a/./x", "a//x", "C:/x", "C:x", "\\\\host\\x", "a\\x", "a:x", "a\u0000b", "", "x".repeat(4097)])("rejects malformed preview path %j before HTTP", (path) => {
    const { request, api } = harness();
    expect(() => api.storageCleanupPreview({ action: "old-backups", items: [path] })).toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, [], { action: "unknown" }, { action: "vacuum", extra: true }, { action: "old-logs", olderThanDays: 0 }, { action: "old-logs", olderThanDays: 1.5 }, { action: "old-logs", olderThanDays: Number.NaN }, { action: "old-logs", olderThanDays: 4294967296 }, { action: "old-logs", items: [] }, { action: "old-logs", items: ["x", "x"] }, { action: "old-logs", items: Array.from({ length: 10001 }, (_, i) => `x${i}`) }])("rejects invalid preview body %#", (body) => {
    const { request, api } = harness();
    expect(() => api.storageCleanupPreview(body as StorageCleanupPreviewRequest)).toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([{ ...execute, requestId: "../x" }, { ...execute, previewId: "bad" }, { ...execute, confirmed: false }, { ...execute, confirmed: "true" }, { ...execute, confirmText: "Delete" }, { ...execute, items: ["runtime/diagnostics/x"] }, { ...execute, items: [item, item] }, { ...execute, items: [] }, { ...execute, token: "renderer-credential" }])("rejects invalid execute body %# before HTTP", (body) => {
    const { request, api } = harness();
    expect(() => api.storageCleanupExecute(body as StorageCleanupExecuteRequest)).toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("bounds the total selection payload", () => {
    const { request, api } = harness();
    expect(() => api.storageCleanupPreview({ action: "orphan-homes", items: Array.from({ length: 300 }, (_, i) => `${i}/${"x".repeat(4000)}`) })).toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects run route injection", () => {
    const { request, api } = harness();
    for (const id of ["", "../x", `${requestId}?x=1`, `${requestId}/preview`, "https://host"]) expect(() => api.storageCleanupRun(id)).toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("propagates backend admission and mutation failures without retrying", async () => {
    const { request, api } = harness();
    const denied = new Error("storage_cleanup_desktop_only");
    request.mockRejectedValueOnce(denied);
    await expect(api.storageCleanupExecute(execute)).rejects.toBe(denied);
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new Error("preview expired"));
    await expect(api.storageCleanupExecute(execute)).rejects.toThrow("preview expired");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
