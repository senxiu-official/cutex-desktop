// lib/gitStatusFlight.ts: one git status read at a time per workspace, shared by its views.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitStatusFlight, type GitStatusResult } from "../src/renderer/src/lib/gitStatusFlight";
import type { GitStatus } from "../src/shared/ipc";

const status = (branch: string) => ({ branch, files: [] }) as unknown as GitStatus;

describe("gitStatusFlight", () => {
  let pending: { resolve: (s: GitStatus) => void; reject: (e: unknown) => void }[];
  const read = () => new Promise<GitStatus>((resolve, reject) => pending.push({ resolve, reject }));
  beforeEach(() => {
    vi.useFakeTimers();
    pending = [];
  });
  afterEach(() => vi.useRealTimers());

  it("two views of one workspace share one read and both get its answer", async () => {
    const a: GitStatusResult[] = [];
    const b: GitStatusResult[] = [];
    const watch = gitStatusFlight("local\0session:s1", read);
    const offA = watch.subscribe((r) => a.push(r));
    watch.ensure();
    const header = gitStatusFlight("local\0session:s1", read);
    expect(header).toBe(watch);
    const offB = header.subscribe((r) => b.push(r));
    header.ensure();
    expect(pending).toHaveLength(1);
    pending[0]!.resolve(status("main"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(pending).toHaveLength(1);
    expect(a).toEqual([{ ok: true, status: status("main") }]);
    expect(b).toEqual(a);
    // A third view opening later gets the last answer at once.
    const c: GitStatusResult[] = [];
    const offC = header.subscribe((r) => c.push(r));
    expect(c).toEqual(a);
    offA(); offB(); offC();
    // Nobody watches: the next view starts afresh.
    expect(gitStatusFlight("local\0session:s1", read)).not.toBe(watch);
  });

  it("an error reaches the views and the next change reads again", async () => {
    const seen: GitStatusResult[] = [];
    const flight = gitStatusFlight("local\0session:err", read);
    const off = flight.subscribe((r) => seen.push(r));
    flight.ensure();
    pending[0]!.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen[0]).toMatchObject({ ok: false });
    flight.request();
    await vi.advanceTimersByTimeAsync(2000);
    expect(pending).toHaveLength(2);
    off();
  });

  it("other hosts and scopes read on their own", () => {
    const one = gitStatusFlight("local\0session:x", read);
    const two = gitStatusFlight("remote\0session:x", read);
    const offs = [one.subscribe(() => {}), two.subscribe(() => {})];
    one.ensure();
    two.ensure();
    expect(pending).toHaveLength(2);
    for (const off of offs) off();
  });
});

// Owner 2026-11-16: `git_status_busy` stayed on screen until something changed; now it retries by itself.
describe("gitStatusFlight: transient failures retry with a capped backoff", () => {
  let pending: { resolve: (s: GitStatus) => void; reject: (e: unknown) => void }[];
  const read = () => new Promise<GitStatus>((resolve, reject) => pending.push({ resolve, reject }));
  const busy = () => new Error("git_status_busy: git status is busy; retry shortly");
  beforeEach(() => {
    vi.useFakeTimers();
    pending = [];
  });
  afterEach(() => vi.useRealTimers());

  it("reads again after about 2, 2, 5, 10, then 30 s while busy, and stops backing off once it works", async () => {
    const starts: number[] = [];
    const timed = () => (starts.push(Date.now()), read());
    const seen: GitStatusResult[] = [];
    const flight = gitStatusFlight("local\0session:retry", timed);
    const off = flight.subscribe((r) => seen.push(r));
    flight.ensure();
    for (let i = 0; i < 6; i++) {
      pending[i]!.reject(busy());
      while (pending.length === i + 1) await vi.advanceTimersByTimeAsync(250);
    }
    // The 2 s floor between reads applies to the first retries.
    expect(starts.slice(1).map((t, i) => t - starts[i]!)).toEqual([2000, 2000, 5000, 10000, 30000, 30000]);
    expect(seen.every((r) => !r.ok && r.retrying)).toBe(true);
    pending[6]!.resolve(status("main"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(7);
    expect(seen.at(-1)).toEqual({ ok: true, status: status("main") });
    // Working again: a change reads after the usual short pause.
    flight.request();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pending).toHaveLength(8);
    off();
  });

  it("changes while busy wait for the backoff instead of reading every 2 s", async () => {
    const starts: number[] = [];
    const timed = () => (starts.push(Date.now()), read());
    const flight = gitStatusFlight("local\0session:changes", timed);
    const off = flight.subscribe(() => {});
    flight.ensure();
    // Three busy answers in a row: the next read waits 5 s from the last start, however many changes come.
    for (let i = 0; i < 3; i++) {
      pending[i]!.reject(busy());
      if (i < 2) while (pending.length === i + 1) await vi.advanceTimersByTimeAsync(250);
    }
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 8; i++) {
      flight.request();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(pending).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pending).toHaveLength(4);
    expect(starts[3]! - starts[2]!).toBe(5000);
    off();
  });

  it("a non-transient failure waits; 重新加载 reads now; nobody watching ends the retries", async () => {
    const seen: GitStatusResult[] = [];
    const flight = gitStatusFlight("local\0session:reload", read);
    const off = flight.subscribe((r) => seen.push(r));
    flight.ensure();
    pending[0]!.reject(new Error("git_failed: fatal: bad object"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pending).toHaveLength(1);
    expect(seen).toEqual([{ ok: false, error: expect.any(Error), retrying: false }]);
    flight.reload();
    expect(pending).toHaveLength(2);
    pending[1]!.reject(busy());
    await vi.advanceTimersByTimeAsync(0);
    off();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(pending).toHaveLength(2);
  });

  // cutex (after r286) marks a status read during which files changed; it does not rescan by itself.
  const stale = (branch: string) => ({ ...status(branch), possiblyStale: true }) as GitStatus;

  it("a possibly stale result is shown, then read once more about 1.5 s later", async () => {
    const seen: GitStatusResult[] = [];
    const flight = gitStatusFlight("local\0session:stale-once", read);
    const off = flight.subscribe((r) => seen.push(r));
    flight.ensure();
    await vi.advanceTimersByTimeAsync(2_000);
    pending[0]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([{ ok: true, status: stale("main") }]);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pending).toHaveLength(2);
    pending[1]!.resolve(status("main"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(2);
    expect(seen.at(-1)).toEqual({ ok: true, status: status("main") });
    off();
  });

  it("stale after stale reads only once until a change or a current result", async () => {
    const flight = gitStatusFlight("local\0session:stale-chain", read);
    const off = flight.subscribe(() => {});
    flight.ensure();
    pending[0]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pending).toHaveLength(2);
    pending[1]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(2);
    // A change opens a new chain: its stale answer gets one reread again.
    flight.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(pending).toHaveLength(3);
    pending[2]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pending).toHaveLength(4);
    pending[3]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(4);
    off();
  });

  it("the stale reread joins changes: one read for both, during or after the stale read", async () => {
    const flight = gitStatusFlight("local\0session:stale-join", read);
    const off = flight.subscribe(() => {});
    flight.ensure();
    await vi.advanceTimersByTimeAsync(5_000);
    // A change during the read: the one reread after it covers both.
    flight.request();
    pending[0]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);
    // Stale again: its reread is due; changes meanwhile join it (one read).
    pending[1]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(500);
    flight.request();
    await vi.advanceTimersByTimeAsync(200);
    flight.request();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pending).toHaveLength(3);
    // Those were changes, so this stale answer may reread once more, and only once.
    pending[2]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(pending).toHaveLength(4);
    pending[3]!.resolve(stale("main"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pending).toHaveLength(4);
    off();
  });
});
