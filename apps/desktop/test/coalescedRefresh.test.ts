import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { agentManagementToolCompleted, coalescedRefresh, sidebarIgnoresMethod, sidebarRefreshesForMethod } from "../src/renderer/src/lib/coalescedRefresh";

function fakeClock() {
  let t = 0;
  const timers: { at: number; run: () => void; id: number }[] = [];
  let next = 1;
  return {
    now: () => t,
    setTimer: (run: () => void, ms: number) => {
      const id = next++;
      timers.push({ at: t + ms, run, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        t = due.at;
        due.run();
      }
      t = end;
    },
  };
}

describe("coalesced sidebar refresh", () => {
  it("runs once per burst and at most every minInterval under a constant event stream", () => {
    const clock = fakeClock();
    let runs = 0;
    const refresh = coalescedRefresh(() => runs++, { delayMs: 400, minIntervalMs: 2000, ...clock });
    // An event every 100 ms for 10 s: a restarted debounce would never fire.
    for (let i = 0; i < 100; i++) {
      refresh.request();
      clock.advance(100);
    }
    expect(runs).toBeGreaterThanOrEqual(4);
    expect(runs).toBeLessThanOrEqual(6);
    clock.advance(5000);
    const settled = runs;
    // A single later event refreshes once, after the delay.
    refresh.request();
    clock.advance(399);
    expect(runs).toBe(settled);
    clock.advance(1);
    expect(runs).toBe(settled + 1);
  });

  it("cancel drops the pending run", () => {
    const clock = fakeClock();
    let runs = 0;
    const refresh = coalescedRefresh(() => runs++, { delayMs: 400, minIntervalMs: 2000, ...clock });
    refresh.request();
    refresh.cancel();
    clock.advance(1000);
    expect(runs).toBe(0);
    refresh.request();
    clock.advance(400);
    expect(runs).toBe(1);
  });

  it("ignores events of stores that refresh themselves", () => {
    expect(sidebarIgnoresMethod("cutex/runtimePackages/runUpdated")).toBe(true);
    expect(sidebarIgnoresMethod("cutex/ask/created")).toBe(true);
    expect(sidebarIgnoresMethod("cutex/runtime/online")).toBe(false);
    expect(sidebarIgnoresMethod("cutex/session/updated")).toBe(false);
  });

  it("skips plan/diff payload updates while preserving lifecycle and settings refreshes", () => {
    for (const method of ["turn/plan/updated", "turn/diff/updated", "item/agentMessage/delta", "cutex/ask/created"]) {
      expect(sidebarRefreshesForMethod(method), method).toBe(false);
    }
    for (const method of ["turn/started", "turn/completed", "thread/status/changed", "thread/name/updated", "thread/settings/updated", "cutex/runtime/online", "cutex/userInput/queued"]) {
      expect(sidebarRefreshesForMethod(method), method).toBe(true);
    }
  });

  it("a request while a run is in flight (read pending) gets its own trailing run", () => {
    const clock = fakeClock();
    const reads: (() => void)[] = [];
    let applied = 0;
    // The run starts an async read that resolves later (like refreshSidebar).
    const refresh = coalescedRefresh(() => void reads.push(() => applied++), { delayMs: 400, minIntervalMs: 2000, ...clock });
    refresh.request();
    clock.advance(400);
    expect(reads).toHaveLength(1);
    // An event lands while that read is still in flight: it may have missed the change.
    clock.advance(100);
    refresh.request();
    reads.shift()!();
    clock.advance(2000);
    expect(reads).toHaveLength(1);
    reads.shift()!();
    expect(applied).toBe(2);
  });

  it("refreshes after an Agent Management tool call of the caller completes", () => {
    const completed = (tool: string, type = "mcpToolCall", method = "item/completed") =>
      ({ cutexSessionId: "cutex.d", native: { kind: "notification", message: { method, params: { item: { type, server: "cutex", tool, status: "completed" } } } } }) as unknown as EventEnvelope;
    expect(agentManagementToolCompleted(completed("agent_create"))).toBe(true);
    expect(agentManagementToolCompleted(completed("member_replace"))).toBe(true);
    expect(agentManagementToolCompleted(completed("agent_archive"))).toBe(true);
    expect(agentManagementToolCompleted(completed("mcp__cutex__agent_create"))).toBe(true);
    expect(agentManagementToolCompleted(completed("agent_tell"))).toBe(false);
    expect(agentManagementToolCompleted(completed("agent_create", "commandExecution"))).toBe(false);
    expect(agentManagementToolCompleted(completed("agent_create", "mcpToolCall", "item/started"))).toBe(false);
    expect(agentManagementToolCompleted({ cutexSessionId: "cutex.host", cutex: { method: "cutex/sessions/changed", params: {} } } as unknown as EventEnvelope)).toBe(false);
    expect(sidebarRefreshesForMethod("cutex/sessions/changed")).toBe(true);
  });
});
