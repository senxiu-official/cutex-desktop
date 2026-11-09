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
