import { describe, expect, it, vi } from "vitest";
import type { StorageCleanupApi, StorageCleanupPreview, StorageCleanupRun, StorageCleanupExecuteRequest } from "../src/shared/storageCleanup";
import { CleanupController, highRisk, selectedBytes } from "../src/renderer/src/modules/storage/cleanupController";
import { canCleanup } from "../src/renderer/src/modules/storage/cleanupAccess";
import { OWNER_ACCESS, type HostUserAccess } from "../src/shared/users";
const preview = (action: StorageCleanupPreview["action"] = "old-backups"): StorageCleanupPreview => ({ previewId: "12345678-1234-4234-8234-123456789abc", action, risk: "medium", expiresAt: new Date(Date.now() + 600000).toISOString(), freeableBytes: 30, items: [{ id: "a", path: "backups/a", bytes: 10, files: 1, mtime: null, eligible: true, reason: "old", code: null }, { id: "b", path: "backups/b", bytes: 20, files: 1, mtime: null, eligible: true, reason: "old", code: null }, { id: "c", path: "backups/c", bytes: 90, files: 1, mtime: null, eligible: false, reason: "in use", code: "active" }] });
const run: StorageCleanupRun = { runId: "run-a", requestId: "request-a", state: "completed", freedBytes: 10, items: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function setup(extra: Partial<StorageCleanupApi> = {}, permission = () => true) {
  const api: StorageCleanupApi = { storageCleanupPreview: vi.fn(async () => preview()), storageCleanupExecute: vi.fn(async (request) => ({ ...run, requestId: request.requestId })), storageCleanupHistory: vi.fn(async () => ({ items: [] })), storageCleanupRun: vi.fn(async () => run), ...extra };
  let pending: StorageCleanupExecuteRequest | null = null;
  const store = { read: () => pending, write: (value: typeof pending) => { pending = value; } };
  const controller = new CleanupController(api, permission, store); controller.start(); return { api, controller, store };
}
describe("storage cleanup controller", () => {
  it("previews without mutation, defaults only eligible items, and recalculates selected bytes", async () => {
    const { api, controller } = setup(); await controller.preview({ action: "old-backups" });
    expect(controller.getSnapshot().selected).toEqual(["a", "b"]); controller.select("c", true); controller.select("b", false);
    expect(controller.getSnapshot().selected).toEqual(["a"]); expect(selectedBytes(controller.getSnapshot().preview!, ["a", "c"])).toBe(10);
    expect(api.storageCleanupExecute).not.toHaveBeenCalled();
  });
  it("requires exact high-risk text even if a backend erroneously reports backups medium", async () => {
    const { api, controller } = setup(); await controller.preview({ action: "old-backups" }); expect(highRisk(preview())).toBe(true);
    await controller.execute(); await controller.execute("删除 "); expect(api.storageCleanupExecute).not.toHaveBeenCalled();
    controller.select("b", false); await controller.execute("删除"); expect(api.storageCleanupExecute).toHaveBeenCalledOnce();
    expect(vi.mocked(api.storageCleanupExecute).mock.calls[0]![0]).toMatchObject({ items: ["a"], confirmed: true, confirmText: "删除" }); expect(controller.getSnapshot().preview).toBeNull();
  });
  it("rejects expired, empty-selection and changed permission before mutation", async () => {
    let allowed = true; const { api, controller } = setup({}, () => allowed); await controller.preview({ action: "old-backups" });
    controller.select("a", false); controller.select("b", false); await controller.execute("删除"); expect(api.storageCleanupExecute).not.toHaveBeenCalled();
    controller.select("a", true); allowed = false; await controller.execute("删除"); expect(api.storageCleanupExecute).not.toHaveBeenCalled();
    allowed = true; vi.useFakeTimers(); vi.setSystemTime(Date.now() + 700000); await controller.execute("删除"); expect(controller.getSnapshot().error).toBe("storage.cleanup.expired"); expect(api.storageCleanupExecute).not.toHaveBeenCalled(); vi.useRealTimers();
  });
  it("retries an uncertain submission with the exact same consent and recovers it after page restart", async () => {
    const { api, controller, store } = setup({ storageCleanupExecute: vi.fn().mockRejectedValueOnce(new Error("lost response")).mockImplementation(async (request) => ({ ...run, requestId: request.requestId })) });
    await controller.preview({ action: "old-backups" }); await controller.execute("删除"); const request = store.read()!;
    expect(controller.getSnapshot().pending).toEqual(request); await controller.preview({ action: "old-backups" }); expect(api.storageCleanupPreview).toHaveBeenCalledOnce();
    controller.stop(); const restarted = new CleanupController(api, () => true, store); restarted.start(); await restarted.retry();
    expect(vi.mocked(api.storageCleanupExecute).mock.calls.map(([body]) => body)).toEqual([request, request]); expect(store.read()).toBeNull();
  });
  it("recovers a lost response from history without issuing another mutation", async () => {
    const { api, controller, store } = setup({ storageCleanupExecute: vi.fn().mockRejectedValue(new Error("timeout")) });
    await controller.preview({ action: "old-backups" }); await controller.execute("删除"); const request = store.read()!;
    vi.mocked(api.storageCleanupHistory).mockResolvedValue({ items: [{ ...run, requestId: request.requestId }] }); await controller.loadHistory();
    expect(controller.getSnapshot().pending).toBeNull(); expect(controller.getSnapshot().run?.runId).toBe(run.runId); expect(api.storageCleanupExecute).toHaveBeenCalledOnce();
  });
  it("clears a definitively refused preview so a new one can be requested", async () => {
    const { controller, store } = setup({ storageCleanupExecute: vi.fn().mockRejectedValue(new Error("cleanup_preview_changed: expired")) });
    await controller.preview({ action: "old-backups" }); await controller.execute("删除"); expect(store.read()).toBeNull(); expect(controller.getSnapshot().preview).toBeNull();
  });
  it("fences replaced previews and replies after unmount/host changes", async () => {
    const old = deferred<StorageCleanupPreview>(); const { api, controller } = setup({ storageCleanupPreview: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(preview("old-logs")) });
    const stale = controller.preview({ action: "old-backups" }); await controller.preview({ action: "old-logs" }); old.resolve(preview()); await stale;
    expect(controller.getSnapshot().preview?.action).toBe("old-logs");
    const history = deferred<{ items: StorageCleanupRun[] }>(); vi.mocked(api.storageCleanupHistory).mockReturnValue(history.promise);
    const pending = controller.loadHistory(); controller.stop(); history.resolve({ items: [run] }); await pending; expect(controller.getSnapshot().history).toEqual([]);
  });
  it("permits medium confirmation without a deletion phrase and blocks duplicate clicks", async () => {
    const receipt = deferred<StorageCleanupRun>(); const { api, controller } = setup({ storageCleanupPreview: vi.fn(async () => preview("vacuum")), storageCleanupExecute: vi.fn(() => receipt.promise) });
    await controller.preview({ action: "vacuum" }); const first = controller.execute(); await controller.execute(); expect(api.storageCleanupExecute).toHaveBeenCalledOnce();
    const request = vi.mocked(api.storageCleanupExecute).mock.calls[0]![0]; expect(request.confirmText).toBeUndefined(); receipt.resolve({ ...run, requestId: request.requestId }); await first;
  });
});
describe("storage cleanup admission", () => {
  const features = new Set(["storage-cleanup", "owner-local-only"]); const root = { ...OWNER_ACCESS, token: null, scope: "full", ownerLocal: true } as HostUserAccess;
  it("allows known full owner root/host-cli and refuses old, unknown, phone, narrowed and offline access", () => {
    expect(canCleanup(root, features, true)).toBe(true);
    expect(canCleanup({ ...root, token: { id: "id", label: "", deviceName: null, ownerName: null, platform: "windows", issuedVia: "hostCli", scope: "full" } }, features, true)).toBe(true);
    for (const access of [{ ...root, known: false }, { ...root, ownerLocal: false }, { ...root, isOwner: false }, { ...root, scope: "read" as const }, { ...root, token: undefined }, { ...root, token: { id: "phone", label: "Desktop", deviceName: "Desktop", ownerName: null, platform: "windows", issuedVia: "pairing" as const, scope: "full" as const } }]) expect(canCleanup(access, features, true)).toBe(false);
    expect(canCleanup(root, new Set(), true)).toBe(false); expect(canCleanup(root, features, false)).toBe(false);
  });
});
