import { describe, expect, it, vi } from "vitest";
import { createBrowserHold } from "../src/renderer/src/modules/browser/hold";

function fixture(allowed = true) {
  const callbacks = { keepMounted: vi.fn((hold: boolean) => hold && allowed), ready: vi.fn(async (_id: string, _held: boolean) => {}),
    revoke: vi.fn(async (_id: string) => {}), failed: vi.fn() };
  return { ...callbacks, hold: createBrowserHold(callbacks) };
}
describe("browser lease shell hold", () => {
  it("acquires before ready and refuses without retry when the shell is full", () => {
    const f = fixture(false); f.hold.update("lease-a", false); f.hold.update("lease-a", false);
    expect(f.keepMounted.mock.calls).toEqual([[true]]);
    expect(f.ready.mock.calls).toEqual([["lease-a", false]]);
    expect(f.revoke).not.toHaveBeenCalled();
    expect(f.keepMounted.mock.invocationCallOrder[0]).toBeLessThan(f.ready.mock.invocationCallOrder[0]!);
  });
  it("does not confuse the first stale render with shell revocation", () => {
    const f = fixture(); f.hold.update("lease-a", false); f.hold.update("lease-a", false);
    expect(f.ready.mock.calls).toEqual([["lease-a", true]]); expect(f.revoke).not.toHaveBeenCalled();
    f.hold.update("lease-a", true); f.hold.update("lease-a", false); f.hold.update("lease-a", false);
    expect(f.revoke.mock.calls).toEqual([["lease-a"]]); expect(f.keepMounted.mock.calls).toEqual([[true], [false]]);
  });
  it("releases on lease end and can acquire a later lease, without transferring the old hold", () => {
    const f = fixture(); f.hold.update("lease-a", false); f.hold.update("lease-a", true);
    f.hold.update(undefined, true); f.hold.update(undefined, false); f.hold.update("lease-b", false);
    expect(f.keepMounted.mock.calls).toEqual([[true], [false], [true]]);
    expect(f.ready.mock.calls).toEqual([["lease-a", true], ["lease-b", true]]);
    expect(f.revoke).not.toHaveBeenCalled();
  });
  it("late ready failure cannot revoke a replacement lease", async () => {
    const f = fixture(); let reject!: (error: unknown) => void;
    f.ready.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    f.hold.update("lease-a", false); f.hold.update("lease-b", false);
    reject(new Error("stale_connection")); await Promise.resolve();
    expect(f.revoke).not.toHaveBeenCalled(); expect(f.failed).not.toHaveBeenCalled();
  });
  it("ready failure revokes once and reports; unmount never leaves a live lease", async () => {
    const f = fixture(); f.ready.mockRejectedValueOnce(new Error("target_closed"));
    f.hold.update("lease-a", false); await Promise.resolve(); f.hold.dispose(); f.hold.dispose();
    expect(f.revoke.mock.calls).toEqual([["lease-a"]]); expect(f.failed).toHaveBeenCalledOnce();
    f.hold.update("lease-b", true); expect(f.ready).toHaveBeenCalledOnce();
  });
  it("unmount while the ready acknowledgement is pending revokes the same lease", () => {
    const f = fixture(); f.ready.mockImplementationOnce(() => new Promise(() => {}));
    f.hold.update("lease-a", false); f.hold.dispose(); expect(f.revoke.mock.calls).toEqual([["lease-a"]]);
  });
});
