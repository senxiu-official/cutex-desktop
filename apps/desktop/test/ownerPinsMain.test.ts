// 备忘 in main (2026-11-19): the PATCH carries the owner's expectedRevision (validated); a list limit never exceeds cutex's
// 200 (r289+ refuses more with 400); a revision conflict comes back as a refusal, not a throw.
import { describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => {
  class CutexApiError extends Error {
    constructor(public status: number, public code: string, message: string, public details: unknown = {}) { super(`${code}: ${message}`); }
  }
  return { CutexApiError };
});
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {},
  CutexApiError: fx.CutexApiError,
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";

const stub = (request: (...args: unknown[]) => unknown) => ({ requireClient: () => ({ request }) }) as unknown as DaemonService;
const wirePin = { pinId: "pin-a", key: null, author: "agent", agentId: "eva", agentName: "Eva", kind: "todo", title: "t", detail: null, links: [], turnId: null, state: "done", resolvedBy: "owner", resolution: null, createdAt: "2026-11-19T00:00:00Z", updatedAt: "2026-11-19T00:00:00Z", resolvedAt: "2026-11-19T00:00:00Z", revision: 4 };

describe("owner pins in main", () => {
  it("sends expectedRevision with the state, and only a valid one", async () => {
    const request = vi.fn(async () => ({ pin: wirePin }));
    const svc = stub(request);
    await DaemonService.prototype.ownerPinUpdate.call(svc, "pin-a", { state: "done", expectedRevision: 3 });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/v2/owner-pins/pin-a", { body: { state: "done", expectedRevision: 3 } });
    await DaemonService.prototype.ownerPinUpdate.call(svc, "pin-a", { state: "open" });
    expect(request).toHaveBeenLastCalledWith("PATCH", "/v2/owner-pins/pin-a", { body: { state: "open" } });
    for (const bad of [-1, 1.5, Number.NaN, "3"]) await expect(DaemonService.prototype.ownerPinUpdate.call(svc, "pin-a", { state: "done", expectedRevision: bad as number })).rejects.toThrow("bad pin revision");
  });

  it("a 409 revision conflict is a refusal the renderer can read", async () => {
    const svc = stub(async () => { throw new fx.CutexApiError(409, "pin_revision_conflict", "the pin changed (revision 4); reload first", { currentRevision: 4 }); });
    const r = await DaemonService.prototype.ownerPinUpdate.call(svc, "pin-a", { state: "done", expectedRevision: 3 });
    expect(r).toMatchObject({ ok: false, error: { code: "pin_revision_conflict" } });
  });

  it("the list sends no limit by default and never more than 200", async () => {
    const request = vi.fn(async () => ({ hostId: "local", pins: [], openCount: 0 }));
    const svc = stub(request);
    await DaemonService.prototype.ownerPins.call(svc, { state: "all" });
    expect(request).toHaveBeenLastCalledWith("GET", "/v2/owner-pins", { query: { state: "all" } });
    await DaemonService.prototype.ownerPins.call(svc, { state: "all", limit: 300 });
    expect(request).toHaveBeenLastCalledWith("GET", "/v2/owner-pins", { query: { state: "all", limit: 200 } });
  });
});
