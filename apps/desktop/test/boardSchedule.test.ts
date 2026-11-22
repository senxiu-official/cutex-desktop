// 项目看板 read schedule (main/boardSchedule.ts): reads only while the board is shown; events are debounced, a host is
// read at most once per gap and never twice at once; hidden = no timers, no reads. Plus where the window opens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardSchedule, boardRelevantEvent, placeBoard } from "../src/main/boardSchedule";

describe("BoardSchedule", () => {
  let reads: string[];
  let resolveRead: Map<string, () => void>;
  let hosts: string[];
  let lives: (() => boolean)[];
  const make = (manual = false) =>
    new BoardSchedule({
      read: (h, live) => {
        reads.push(h);
        lives.push(live);
        return manual ? new Promise<void>((r) => resolveRead.set(h, r)) : Promise.resolve();
      },
      hosts: () => hosts,
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      debounceMs: 2_000, minGapMs: 10_000, safetyMs: 60_000,
    });
  beforeEach(() => {
    vi.useFakeTimers();
    reads = [];
    resolveRead = new Map();
    lives = [];
    hosts = ["eva", "remote"];
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing while hidden", async () => {
    const s = make();
    s.poke("eva");
    s.readNow();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(reads).toEqual([]);
  });

  it("shown: reads every host at once, then debounced events at most once per gap", async () => {
    const s = make();
    s.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(["eva", "remote"]);
    s.poke("eva");
    s.poke("eva");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reads).toEqual(["eva", "remote"]); // gap not over yet
    await vi.advanceTimersByTimeAsync(8_000);
    expect(reads).toEqual(["eva", "remote", "eva"]);
  });

  it("safety read every minute while shown; hiding cancels everything", async () => {
    const s = make();
    s.setActive(true);
    await vi.advanceTimersByTimeAsync(62_000);
    expect(reads.filter((h) => h === "eva")).toHaveLength(2);
    s.poke("remote");
    s.setActive(false);
    const before = reads.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reads).toHaveLength(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never two reads of one host at once: an event during a read re-reads after it", async () => {
    const s = make(true);
    hosts = ["eva"];
    s.setActive(true);
    s.poke("eva");
    s.readNow("eva");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads).toEqual(["eva"]);
    resolveRead.get("eva")!();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reads).toEqual(["eva", "eva"]);
  });
});

// Review P2 (board-window-review C1/C2): these fail on 77c8a2eb8.
describe("BoardSchedule across hide / show", () => {
  let reads: string[];
  let lives: (() => boolean)[];
  let resolveRead: (() => void)[];
  const make = () =>
    new BoardSchedule({
      read: (h, live) => {
        reads.push(h);
        lives.push(live);
        return new Promise<void>((r) => resolveRead.push(r));
      },
      hosts: () => ["eva"],
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      debounceMs: 2_000, minGapMs: 10_000, safetyMs: 60_000,
    });
  beforeEach(() => {
    vi.useFakeTimers();
    reads = [];
    lives = [];
    resolveRead = [];
  });
  afterEach(() => vi.useRealTimers());

  it("hiding makes the running read not live (it starts nothing more)", async () => {
    const s = make();
    s.setActive(true);
    expect(lives[0]!()).toBe(true);
    s.setActive(false);
    expect(lives[0]!()).toBe(false);
    s.setActive(true);
    expect(lives[0]!()).toBe(false); // a later show does not revive the old read
  });

  it("minimise → restore while a read is in flight: no second read of the host until it settles and the gap is over", async () => {
    const s = make();
    s.setActive(true);
    expect(reads).toEqual(["eva"]);
    s.setActive(false);
    s.setActive(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads).toEqual(["eva"]);
    resolveRead[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(["eva", "eva"]); // the gap was over: the fresh read runs right away
    expect(lives[1]!()).toBe(true);
  });

  it("restore soon after a finished read waits for the host's gap", async () => {
    const s = make();
    s.setActive(true);
    resolveRead[0]!();
    await vi.advanceTimersByTimeAsync(1_000);
    s.setActive(false);
    s.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toEqual(["eva"]);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(reads).toEqual(["eva", "eva"]);
  });

  it("a read that settles while hidden schedules nothing", async () => {
    const s = make();
    s.setActive(true);
    s.poke("eva"); // marks a re-read
    s.setActive(false);
    resolveRead[0]!();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reads).toEqual(["eva"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("boardRelevantEvent", () => {
  it("delegation / notice / session / runtime events count; output streaming does not", () => {
    for (const m of ["cutex/ask/created", "cutex/ownerNotify/created", "cutex/approvals/changed", "cutex/session/retired", "cutex/runtime/offline", "cutex/projectEvents/appended", "cutex/services/changed"]) expect(boardRelevantEvent(m)).toBe(true);
    for (const m of ["item/agentMessage/delta", "cutex/userInput/queued", "cutex/focus/changed", null, undefined]) expect(boardRelevantEvent(m)).toBe(false);
  });
});

describe("placeBoard", () => {
  const primary = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 2560, height: 1400 } };
  const portrait = { id: 2, primary: false, workArea: { x: 2560, y: -400, width: 1080, height: 1880 } };
  const landscape = { id: 3, primary: false, workArea: { x: -1920, y: 0, width: 1920, height: 1040 } };
  it("keeps remembered bounds while their display is there", () => {
    const saved = { x: 2600, y: -380, width: 700, height: 1800 };
    expect(placeBoard(saved, [primary, portrait], { width: 720, height: 1100 })).toEqual(saved);
  });
  it("else opens on a secondary display, a portrait one first, inside its work area", () => {
    const r = placeBoard({ x: 9000, y: 9000, width: 700, height: 900 }, [primary, landscape, portrait], { width: 720, height: 1100 });
    expect(r.x).toBeGreaterThanOrEqual(2560);
    expect(r.x + r.width).toBeLessThanOrEqual(2560 + 1080);
    expect(r.height).toBeLessThanOrEqual(1880);
    expect(placeBoard(null, [primary], { width: 720, height: 1100 }).x).toBe(920);
  });
});
