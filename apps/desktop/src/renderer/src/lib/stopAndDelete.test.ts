import { describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { isBusyRefusal, stopUntilIdle, type StopAndDeleteDeps } from "./stopAndDelete";

const session = (activeTurnId: string | null, revision = 1) => ({ cutexSessionId: "s1", revision, runtime: { activeTurnId } }) as unknown as SessionResource;

function deps(states: (SessionResource | null)[]) {
  let clock = 0;
  let reads = 0;
  const d: StopAndDeleteDeps & { stop: ReturnType<typeof vi.fn> } = {
    session: () => states[Math.min(reads++, states.length - 1)] ?? null,
    stop: vi.fn(async () => undefined),
    refresh: async () => undefined,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  };
  return d;
}

describe("stopUntilIdle (busy delete: stop, then delete)", () => {
  it("stops once and returns the fresh idle session (its new revision)", async () => {
    const d = deps([session("t1", 1), session("t1", 2), session(null, 3)]);
    const fresh = await stopUntilIdle(d);
    expect(d.stop).toHaveBeenCalledTimes(1);
    expect(fresh?.revision).toBe(3);
  });

  it("gives up (null) when the turn never ends within the wait", async () => {
    const d = deps([session("t1")]);
    expect(await stopUntilIdle(d, 2_000)).toBeNull();
  });

  it("returns null when the agent disappeared", async () => {
    expect(await stopUntilIdle(deps([null]))).toBeNull();
  });

  it("does not wait when the stop fails", async () => {
    const d = deps([session(null)]);
    d.stop.mockRejectedValueOnce(new Error("offline"));
    await expect(stopUntilIdle(d)).rejects.toThrow("offline");
  });

  it("recognises cutex's busy refusal only", () => {
    expect(isBusyRefusal({ code: "session_busy" })).toBe(true);
    expect(isBusyRefusal({ code: "session_referenced" })).toBe(false);
    expect(isBusyRefusal(null)).toBe(false);
  });
});
