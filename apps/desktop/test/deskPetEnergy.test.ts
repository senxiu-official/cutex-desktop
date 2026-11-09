// The desk pet's energy (pure): what a usage report adds by one rule on every runtime, how energy decays and sets the
// pace, how the pace plays as taps, today's number, the waiting mark. Plus the usage feed: no cost without a subscriber.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addReport, DEFAULT_ENERGY, EMPTY, energyAt, levelOf, paceOf, reportEnergy, restsAfter } from "../src/renderer/src/modules/desk-pet/energy";
import { AT_REST, tap } from "../src/renderer/src/modules/desk-pet/tapper";
import { addLive, calibrated, CALIBRATE_EVERY_MS, dueHosts, freshToday, ledgerTokens, localDay, reconnected, todayTotal } from "../src/renderer/src/modules/desk-pet/today";
import { iconAllowed, markOf } from "../src/renderer/src/modules/desk-pet/waiting";

type Listener = (e: { hostId: string; epoch?: string; envelope?: unknown }) => void;
const listeners = new Map<string, Set<Listener>>();
const on = vi.fn((event: string, listener: Listener) => {
  const set = listeners.get(event) ?? new Set();
  set.add(listener);
  listeners.set(event, set);
  return () => set.delete(listener);
});
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (event: string, l: Listener) => on(event, l) } }));
const { countedTokens, subscribeUsage, usageAdded, usageReportOf } = await import("../src/renderer/src/lib/activityFeed");

const b = (input: number, cached = 0, output = 0, cacheWrite = 0, reasoning = 0) => ({ inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: cacheWrite, outputTokens: output, reasoningOutputTokens: reasoning });

describe("what a report counts", () => {
  it("input not read from a cache (cache writes included) plus output; reasoning is part of output", () => {
    expect(countedTokens(b(1000, 900, 50, 60, 30))).toBe(150);
    expect(countedTokens(b(10, 20, 5))).toBe(5);
  });

  it("the growth of the thread's total; a repeat is null, a first sight only sets the baseline unless it is a new thread", () => {
    expect(usageAdded(undefined, b(500, 0, 20), b(500, 0, 20))).toBe(520);
    expect(usageAdded(undefined, b(90_000, 80_000, 900), b(5000, 4000, 100))).toBe(0);
    const prev = { total: b(10_000, 8000, 500), last: b(3000, 2500, 100) };
    expect(usageAdded(prev, b(13_000, 10_500, 600), b(3000, 2500, 100))).toBe(600);
    expect(usageAdded(prev, prev.total, prev.last)).toBeNull();
    // Claude mid-turn: the context changed, the billed total did not.
    expect(usageAdded(prev, prev.total, b(40_000))).toBe(0);
    // A lower total: a new counter, a new baseline.
    expect(usageAdded(prev, b(100, 0, 10), null)).toBe(0);
    // Only cached input grew.
    expect(usageAdded(prev, b(20_000, 18_000, 500), null)).toBe(0);
  });

  it("reads only token usage notifications, and refuses malformed figures", () => {
    const env = (method: string, tokenUsage: unknown, kind = "notification") => ({ cutexSessionId: "s", native: { kind, message: { method, params: { threadId: "t", tokenUsage } } } });
    expect(usageReportOf(env("thread/tokenUsage/updated", { total: b(1, 0, 1), last: null }) as never)).toEqual({ thread: "t", total: b(1, 0, 1), last: null });
    expect(usageReportOf(env("item/started", { total: b(1) }) as never)).toBeNull();
    expect(usageReportOf(env("thread/tokenUsage/updated", { total: { inputTokens: -1 } }) as never)).toBeNull();
    expect(usageReportOf(env("thread/tokenUsage/updated", { total: b(1) }, "serverRequest") as never)).toBeNull();
  });
});

describe("subscribeUsage", () => {
  beforeEach(() => {
    on.mockClear();
    listeners.clear();
  });
  const feed = (hostId: string, epoch: string, total: ReturnType<typeof b>, last: ReturnType<typeof b> | null = null, thread = "t") => {
    for (const l of [...(listeners.get("hostEvent") ?? [])]) l({ hostId, epoch, envelope: { cutexSessionId: "s", native: { kind: "notification", message: { method: "thread/tokenUsage/updated", params: { threadId: thread, tokenUsage: { total, last } } } } } });
  };

  it("nothing listens without a subscriber; the last one removes both listeners", () => {
    expect(on).not.toHaveBeenCalled();
    const off = subscribeUsage(() => {});
    expect([...listeners.keys()].sort()).toEqual(["hostEvent", "hostResync"]);
    off();
    expect(listeners.get("hostEvent")!.size + listeners.get("hostResync")!.size).toBe(0);
  });

  it("per thread and connection; a resync or a new connection starts a new baseline", () => {
    const got: number[] = [];
    const off = subscribeUsage((e) => got.push(e.tokens));
    feed("h", "e1", b(1000, 0, 0));
    feed("h", "e1", b(1500, 0, 100));
    feed("h", "e1", b(1500, 0, 100));
    feed("h", "e1", b(50, 0, 50), b(50, 0, 50), "t2");
    for (const l of [...listeners.get("hostResync")!]) l({ hostId: "h" });
    feed("h", "e1", b(9000, 0, 100));
    feed("h", "e2", b(9500, 0, 100));
    expect(got).toEqual([0, 600, 100, 0, 0]);
    off();
  });
});

describe("energy", () => {
  it("a single report moves it about 10–15 s whatever its size", () => {
    for (const tokens of [100, 1500, 30_000, 1_000_000, 50_000_000]) {
      const s = addReport(EMPTY, tokens, 0);
      expect(restsAfter(s)).toBeGreaterThan(9000);
      expect(restsAfter(s)).toBeLessThan(18_000);
      expect(energyAt(s, restsAfter(s) + 10)).toBe(0);
    }
    expect(reportEnergy(0)).toBe(DEFAULT_ENERGY.activity);
  });

  it("decays by a fixed share, has no cap, and only stacked reports keep it going and raise the pace", () => {
    let s = EMPTY;
    for (let i = 0; i < 20; i++) s = addReport(s, 1500, i * 1000);
    expect(s.energy).toBeGreaterThan(DEFAULT_ENERGY.fullAt);
    expect(paceOf(s.energy)).toBe(DEFAULT_ENERGY.maxRate);
    expect(restsAfter(s)).toBeGreaterThan(15_000);
    expect(energyAt(s, s.at + DEFAULT_ENERGY.tauMs)).toBeCloseTo(s.energy / Math.E, 6);
  });

  it("pace and level are bounded and rise with energy", () => {
    expect(paceOf(0)).toBe(0);
    expect(paceOf(0.99)).toBe(0);
    expect(paceOf(1)).toBe(DEFAULT_ENERGY.minRate);
    expect(paceOf(1e9)).toBe(DEFAULT_ENERGY.maxRate);
    expect(paceOf(10)).toBeLessThan(paceOf(20));
    expect(levelOf(0.5)).toBe(0);
    expect(levelOf(1e9)).toBe(1);
  });
});

describe("tapper", () => {
  it("alternates hands; rests between taps at a slow pace, not at a fast one; rest at pace 0 has no next step", () => {
    let s = AT_REST;
    const poses: string[] = [];
    let time = 0;
    for (let i = 0; i < 6; i++) {
      const step = tap(s, 1.5);
      s = step.state;
      poses.push(step.pose);
      time += step.delay!;
    }
    expect(poses).toEqual(["left", "both", "right", "both", "left", "both"]);
    expect(time).toBeCloseTo(3 * (1000 / 1.5), -1);
    const run = (pace: number, config?: Parameters<typeof tap>[2]) => {
      let state = AT_REST;
      return [0, 1, 2, 3].map(() => {
        const step = tap(state, pace, config);
        state = step.state;
        return step;
      });
    };
    const fast = run(6);
    expect(fast.reduce((sum, x) => sum + x.delay!, 0)).toBeCloseTo(2 * (1000 / 6), -1);
    // Too short a rest is skipped: hand to hand.
    const direct = run(6, { holdMs: 200, minRestMs: 80 });
    expect(direct.map((x) => x.pose)).toEqual(["left", "right", "left", "right"]);
    expect(direct.every((x) => Math.abs(x.delay! - 1000 / 6) < 1)).toBe(true);
    expect(tap({ hand: "left", raised: true }, 0)).toEqual({ state: { hand: "left", raised: false }, pose: "both", delay: null });
  });
});

describe("today's tokens", () => {
  const report = (rows: { source?: string; input: number; cachedInput: number; output: number }[], totals = { input: 0, cachedInput: 0, output: 0 }) => ({ totals, rows: rows.map(({ source, ...a }) => ({ key: source === undefined ? {} : { source }, ...a })) }) as never;

  it("the ledger's cutex rows only, non-cached; an older cutex without sources uses its totals", () => {
    expect(ledgerTokens(report([{ source: "cutex", input: 1000, cachedInput: 900, output: 10 }, { source: "codex", input: 5e6, cachedInput: 0, output: 0 }]))).toBe(110);
    expect(ledgerTokens(report([{ input: 1, cachedInput: 0, output: 0 }], { input: 300, cachedInput: 100, output: 5 }))).toBe(205);
    expect(ledgerTokens(report([{ source: "codex", input: 5, cachedInput: 0, output: 0 }]))).toBe(0);
    expect(ledgerTokens(null)).toBe(0);
  });

  it("ledger plus live per host, connected hosts only; an answer replaces live; another day's answer is dropped", () => {
    let t = freshToday("2026-11-08");
    t = addLive(t, "a", 100);
    t = calibrated(t, "a", "2026-11-08", 1000, 5);
    t = addLive(t, "a", 50);
    t = addLive(t, "b", 7);
    expect(todayTotal(t, ["a", "b"])).toBe(1057);
    expect(todayTotal(t, ["a"])).toBe(1050);
    expect(calibrated(t, "a", "2026-11-07", 1, 6)).toBe(t);
    expect(dueHosts(t, ["a", "b"], 10)).toEqual(["b"]);
    expect(dueHosts(t, ["a", "b"], 5 + CALIBRATE_EVERY_MS)).toEqual(["a", "b"]);
    expect(dueHosts(reconnected(t, "a"), ["a"], 10)).toEqual(["a"]);
    expect(localDay(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
  });
});

describe("the waiting mark", () => {
  const item = (key: string, onScreen = false) => ({ hostId: "h", agentId: "a", key, onScreen });
  it("up until seen on screen; forgets items that stopped waiting", () => {
    let m = markOf([item("1")], new Set());
    expect(m.shown).toBe(true);
    m = markOf([item("1", true)], m.seen);
    expect(m.shown).toBe(false);
    m = markOf([item("1")], m.seen);
    expect(m.shown).toBe(false);
    m = markOf([], m.seen);
    expect(m.seen.size).toBe(0);
    expect(markOf([item("1")], m.seen).shown).toBe(true);
  });

  it("icons at most one per gap", () => {
    expect(iconAllowed(null, 0)).toBe(true);
    expect(iconAllowed(0, 399)).toBe(false);
    expect(iconAllowed(0, 400)).toBe(true);
  });
});
