// The hidden sidebar's pop-out timing (owner 2026-10-28): pure lib/sidebarPeek with an injected schedule —
// the rest fires once after PEEK_REST_MS (a re-enter restarts it, leave cancels), the retract after
// PEEK_RETRACT_MS (arm restarts, stay cancels). Rendered behaviour: test/sidebarPeek.test.tsx.
import { describe, expect, it, vi } from "vitest";
import { createPeekRest, createPeekRetract, PEEK_REST_MS, PEEK_RETRACT_MS } from "../src/renderer/src/lib/sidebarPeek";

interface Timer { fire(): void; ms: number; cancelled: boolean }
function recorder() {
  const timers: Timer[] = [];
  return {
    timers,
    schedule: (fire: () => void, ms: number) => {
      const t: Timer = { fire, ms, cancelled: false };
      timers.push(t);
      return () => { t.cancelled = true; };
    },
  };
}

describe("createPeekRest", () => {
  it("rests for PEEK_REST_MS, then pops once", () => {
    const r = recorder();
    const pop = vi.fn();
    const rest = createPeekRest(pop, undefined, r.schedule);
    rest.enter();
    expect(r.timers).toHaveLength(1);
    expect(r.timers[0]!.ms).toBe(PEEK_REST_MS);
    expect(PEEK_REST_MS).toBe(250);
    r.timers[0]!.fire();
    expect(pop).toHaveBeenCalledTimes(1);
  });

  it("a re-enter restarts the rest; leaving cancels it", () => {
    const r = recorder();
    const rest = createPeekRest(vi.fn(), undefined, r.schedule);
    rest.enter();
    rest.enter();
    expect(r.timers).toHaveLength(2);
    expect(r.timers[0]!.cancelled).toBe(true);
    expect(r.timers[1]!.cancelled).toBe(false);
    rest.leave();
    expect(r.timers[1]!.cancelled).toBe(true);
    expect(r.timers.every((t) => t.cancelled)).toBe(true);
  });
});

describe("createPeekRetract", () => {
  it("retracts after PEEK_RETRACT_MS; stay cancels; a re-arm restarts", () => {
    const r = recorder();
    const retract = vi.fn();
    const arm = createPeekRetract(retract, undefined, r.schedule);
    arm.arm();
    expect(r.timers[0]!.ms).toBe(PEEK_RETRACT_MS);
    expect(PEEK_RETRACT_MS).toBe(300);
    arm.stay();
    expect(r.timers[0]!.cancelled).toBe(true);
    arm.arm();
    expect(r.timers).toHaveLength(2);
  });

  it("the default schedule is a plain timeout (wired to the same ms)", () => {
    vi.useFakeTimers();
    try {
      const pop = vi.fn();
      const rest = createPeekRest(pop);
      rest.enter();
      vi.advanceTimersByTime(PEEK_REST_MS - 1);
      expect(pop).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(pop).toHaveBeenCalledTimes(1);
      rest.leave();
    } finally {
      vi.useRealTimers();
    }
  });
});
