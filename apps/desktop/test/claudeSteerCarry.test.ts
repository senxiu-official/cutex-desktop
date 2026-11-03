// Claude steers carried over (owner 2026-10-24): two messages (with images) sent to a busy Claude agent; the
// first showed 已插入, the second turned into the paused section (未送达 + 继续发送) while the agent kept working,
// and 继续发送 delivered it twice. The Claude adapter keeps a steer its turn did not read (one with images never
// rides a tool call): a completed turn's leftovers run as the next turns (cute_claude/protocol.py `turn/steer`);
// only an interrupted / failed turn drops them. The desktop took the turn's end as a drop (cute-codex) and
// offered a resend under a new id. Replays the adapter's event order through the real timeline reducer.
import { describe, expect, it } from "vitest";
import { applyEvent, emptyTimeline, type TimelineState } from "../src/renderer/src/lib/timeline";
import { CARRIED_STEER_IDLE_S, newPendingSteer, settlePendingSteers, steerDelivery, type PendingSteer, type SettleOptions } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { pausedSection } from "../src/renderer/src/lib/queuePause";

const T0 = 1_792_800_000;
const native = (method: string, params: Record<string, unknown>) => ({ native: { kind: "notification", message: { method, params: { threadId: "t", ...params } } } }) as never;
const started = (s: TimelineState, id: string, at: number) => applyEvent(s, native("turn/started", { turn: { id, status: "inProgress", items: [], startedAt: at } }));
const completed = (s: TimelineState, id: string, status: string, at: number) => applyEvent(s, native("turn/completed", { turn: { id, status, items: [], completedAt: at } }));
/** The adapter's userMessage of an owner input (a turn's first item, or a steer read at a tool call): it echoes clientId. */
const userMessage = (s: TimelineState, turnId: string, clientId: string, text: string) =>
  applyEvent(s, native("item/completed", { turnId, item: { type: "userMessage", id: `u-${clientId}`, clientId, content: [{ type: "text", text, text_elements: [] }] } }));

const claude = (now: number): SettleOptions => ({ carriesUnread: true, now });

/** Settle like the store does on every event: lost steers are what the history re-check would turn undelivered. */
function settle(steers: PendingSteer[], s: TimelineState, opts: SettleOptions) {
  const r = settlePendingSteers(steers, s, opts);
  return { ...r, ids: r.pending.map((p) => `${p.id}@${p.turnId}:${p.state}`) };
}

describe("Claude steers its turn did not read", () => {
  for (const n of [1, 2, 3]) {
    it(`${n} queued (image) steer(s): carried through the next turns, never lost, never in the paused section`, () => {
      const s = emptyTimeline();
      started(s, "T1", T0);
      let steers: PendingSteer[] = Array.from({ length: n }, (_, i) => ({ ...newPendingSteer(s, `m${i + 1}`, `msg ${i + 1}`, 1, "T1"), extra: [{ type: "image", url: "data:" }] }));
      // T1 completes without reading them (images never ride a tool call).
      completed(s, "T1", "completed", T0 + 10);
      let r = settle(steers, s, claude(T0 + 10));
      expect(r.lost).toEqual([]);
      steers = r.pending;
      // The adapter runs them one per turn, in order.
      for (let i = 1; i <= n; i++) {
        const turn = `T${i + 1}`;
        started(s, turn, T0 + 10 * i + 1);
        userMessage(s, turn, `m${i}`, `msg ${i}`);
        r = settle(steers, s, claude(T0 + 10 * i + 2));
        expect(r.lost).toEqual([]);
        // The one it read leaves; the rest wait for the running turn (打断并发送 still takes them).
        expect(r.ids).toEqual(Array.from({ length: n - i }, (_, k) => `m${i + k + 1}@${turn}:waiting`));
        expect(pausedSection(r.pending, [], null).count).toBe(0);
        steers = r.pending;
        completed(s, turn, "completed", T0 + 10 * i + 9);
        r = settle(steers, s, claude(T0 + 10 * i + 9));
        expect(r.lost).toEqual([]);
        steers = r.pending;
      }
      expect(steers).toEqual([]);
    });
  }

  it("text steer read at T2's tool call (another input ran first): leaves then, never lost", () => {
    const s = emptyTimeline();
    started(s, "T1", T0);
    const steers = [newPendingSteer(s, "m1", "hello", 0, "T1")];
    completed(s, "T1", "completed", T0 + 5);
    started(s, "T2", T0 + 6); // a delegation result
    let r = settle(steers, s, claude(T0 + 6));
    expect(r.ids).toEqual(["m1@T2:waiting"]);
    userMessage(s, "T2", "m1", "hello");
    r = settle(r.pending, s, claude(T0 + 7));
    expect(r.pending).toEqual([]);
    expect(r.lost).toEqual([]);
  });

  it("interrupted or failed turn: the adapter drops unread steers — lost as before (re-checked, resend offered)", () => {
    for (const status of ["interrupted", "failed"]) {
      const s = emptyTimeline();
      started(s, "T1", T0);
      const steers = [newPendingSteer(s, "m1", "hello", 0, "T1")];
      completed(s, "T1", status, T0 + 5);
      const r = settle(steers, s, claude(T0 + 5));
      expect(r.lost.map((p) => p.id)).toEqual(["m1"]);
      expect(r.ids).toEqual(["m1@T1:checking"]);
    }
  });

  it("idle after the turn: waits CARRIED_STEER_IDLE_S (the adapter starts it at once), then re-checked", () => {
    const s = emptyTimeline();
    started(s, "T1", T0);
    const steers = [newPendingSteer(s, "m1", "hello", 0, "T1")];
    completed(s, "T1", "completed", T0 + 5);
    const early = settle(steers, s, claude(T0 + 6));
    expect(early.pending).toBe(steers);
    expect(early.lost).toEqual([]);
    expect(early.recheckAt).toBe(T0 + 5 + CARRIED_STEER_IDLE_S);
    const late = settle(steers, s, claude(T0 + 5 + CARRIED_STEER_IDLE_S));
    expect(late.lost.map((p) => p.id)).toEqual(["m1"]);
  });

  it("Codex (no carriesUnread): a turn's end without the steer still reports it lost", () => {
    const s = emptyTimeline();
    started(s, "T1", T0);
    const steers = [newPendingSteer(s, "m1", "hello", 0, "T1")];
    completed(s, "T1", "completed", T0 + 5);
    started(s, "T2", T0 + 6);
    expect(settle(steers, s, { now: T0 + 6 }).lost.map((p) => p.id)).toEqual(["m1"]);
  });
});

describe("steerDelivery", () => {
  it("only a Claude steer with images (count or image / localImage extra) is sent as the next turn", () => {
    const base = { imageCount: 0 };
    expect(steerDelivery({ imageCount: 1 }, "claude")).toBe("nextTurn");
    expect(steerDelivery({ ...base, extra: [{ type: "localImage", path: "/a.png" }] }, "claude")).toBe("nextTurn");
    expect(steerDelivery({ ...base, extra: [{ type: "skill", name: "x" }] }, "claude")).toBe("toolBoundary");
    expect(steerDelivery(base, "claude")).toBe("toolBoundary");
    expect(steerDelivery({ imageCount: 3 }, "codex")).toBe("toolBoundary");
  });
});
