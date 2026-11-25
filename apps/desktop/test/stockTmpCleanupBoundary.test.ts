// Review 2026-11-24 (roster-bottom-review): stock-tmp must pass the real main facade (its action whitelist), not only the mocked UI layer.
import { expect, it, vi } from "vitest";
import { storageCleanupApi } from "../src/main/storageCleanup";
import { CleanupController } from "../src/renderer/src/modules/storage/cleanupController";
import { mockStockTmpPreview } from "../src/renderer/src/modules/storage/mock";

it("the new action reaches the fixed preview route through the production main facade", async () => {
  const request = vi.fn().mockResolvedValue(mockStockTmpPreview());
  const api = storageCleanupApi({ request } as never);
  await api.storageCleanupPreview({ action: "stock-tmp" });
  expect(request).toHaveBeenCalledWith("POST", "/v2/storage/cleanups/preview", { body: { action: "stock-tmp" } });
});

it("stock-tmp only submits selected eligible IDs with exact typed confirmation", async () => {
  const preview = mockStockTmpPreview();
  const execute = vi.fn(async (request) => ({ runId: "run", requestId: request.requestId, state: "completed", freedBytes: 0, items: [] }));
  const controller = new CleanupController({ storageCleanupPreview: async () => preview, storageCleanupExecute: execute, storageCleanupHistory: async () => ({ items: [] }), storageCleanupRun: vi.fn() } as never);
  controller.start(); await controller.preview({ action: "stock-tmp" });
  for (const item of preview.items) controller.select(item.id, true);
  const eligible = preview.items.filter(item => item.eligible).map(item => item.id);
  expect(controller.getSnapshot().selected).toEqual(eligible);
  await controller.execute(); await controller.execute("删除 ");
  expect(execute).not.toHaveBeenCalled();
  controller.select(eligible[1]!, false);
  await controller.execute("删除");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]![0]).toMatchObject({ previewId: preview.previewId, items: [eligible[0]], confirmed: true, confirmText: "删除" });
  controller.stop();
});

it("every shared cleanup action passes the main whitelist; unknown ones are refused", async () => {
  const request = vi.fn().mockResolvedValue(mockStockTmpPreview());
  const api = storageCleanupApi({ request } as never);
  for (const action of ["orphan-homes", "retired-homes", "old-backups", "old-logs", "vacuum", "stock-tmp"] as const) await api.storageCleanupPreview({ action });
  expect(request).toHaveBeenCalledTimes(6);
  expect(() => api.storageCleanupPreview({ action: "stock-temp" } as never)).toThrow("invalid storage cleanup action");
});
