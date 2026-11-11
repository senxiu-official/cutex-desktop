import { describe, expect, it } from "vitest";
import { minSec, readsEarly, wakeScheduleOf, wakeSourceOf } from "../src/renderer/src/lib/wakeCountdown";
import { pendingWakeLabel } from "../src/renderer/src/lib/wakeBusyWait";
import { en } from "../src/renderer/src/i18n/en";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";

const queued = "2026-11-10T10:00:00.000Z";
const at = (secs: number) => Date.parse(queued) + secs * 1000;
const iso = (secs: number) => new Date(at(secs)).toISOString();

describe("which runtimes read a wake before the turn ends", () => {
  it("Codex always; Claude only with native external input; DSH / Kimi never", () => {
    expect(readsEarly("codex", null)).toBe(true);
    expect(readsEarly("claude", { externalInput: true })).toBe(true);
    // Older claude-rNN adapters (no native external input) and sessions without a features map: after the turn.
    expect(readsEarly("claude", { externalInput: false })).toBe(false);
    expect(readsEarly("claude", {})).toBe(false);
    expect(readsEarly("claude", null)).toBe(false);
    expect(readsEarly("dsh", { externalInput: true })).toBe(false);
    expect(readsEarly("kimi", { externalInput: true })).toBe(false);
  });

  it("the 待读留言 label follows the same rule (old calls without features keep after-turn for Claude)", () => {
    expect(pendingWakeLabel(true, "claude", 120, { externalInput: true })).toEqual({ key: "busyWait", secs: 120 });
    expect(pendingWakeLabel(true, "claude", 0, { externalInput: true })).toEqual({ key: "nextStep" });
    expect(pendingWakeLabel(true, "claude", 120)).toEqual({ key: "afterTurn" });
    expect(pendingWakeLabel(true, "claude", 120, { externalInput: false })).toEqual({ key: "afterTurn" });
    expect(pendingWakeLabel(true, "dsh", 120, { externalInput: true })).toEqual({ key: "afterTurn" });
    expect(pendingWakeLabel(false, "claude", 120, { externalInput: true })).toEqual({ key: "afterTurn" });
  });
});

describe("the countdown comes only from the server's deadline", () => {
  const item = (patch: object = {}) => ({ enqueuedAt: queued, timing: "afterTurn" as const, nextStepAt: iso(120), ...patch });

  it("counts down to nextStepAt, rounding up, with the share still to go", () => {
    expect(wakeScheduleOf(item(), at(15), true)).toEqual({ kind: "countdown", secs: 105, left: 105 / 120 });
    expect(wakeScheduleOf(item(), at(119.2), true)).toMatchObject({ kind: "countdown", secs: 1 });
    expect(minSec(105)).toBe("1:45");
    expect(minSec(45)).toBe("0:45");
    expect(minSec(3725)).toBe("62:05");
    expect(minSec(0)).toBe("0:00");
  });

  it("waits for a read point once the deadline passes or the server already says nextStep", () => {
    expect(wakeScheduleOf(item(), at(120), true)).toEqual({ kind: "readPoint" });
    expect(wakeScheduleOf(item(), at(400), true)).toEqual({ kind: "readPoint" });
    // Wait 0: cutex answers nextStep at once. It means "may be read from now on", never "inserted".
    expect(wakeScheduleOf(item({ timing: "nextStep", nextStepAt: null }), at(0), true)).toEqual({ kind: "readPoint" });
  });

  it("nothing without a server deadline, without the ride-along, or where the runtime cannot read early", () => {
    // Wait null (never early) / alarms: afterTurn with no nextStepAt.
    expect(wakeScheduleOf(item({ nextStepAt: null }), at(5), true)).toBeNull();
    expect(wakeScheduleOf(item({ nextStepAt: undefined }), at(5), true)).toBeNull();
    expect(wakeScheduleOf(item({ nextStepAt: "not a time" }), at(5), true)).toBeNull();
    // Unknown setting / an r281 without the ride-along for this record: no item.
    expect(wakeScheduleOf(null, at(5), true)).toBeNull();
    expect(wakeScheduleOf(undefined, at(5), true)).toBeNull();
    expect(wakeScheduleOf(item(), at(5), false)).toBeNull();
    expect(wakeScheduleOf(item({ timing: "nextStep" }), at(5), false)).toBeNull();
  });

  it("a deadline at or before the queued time still counts with a full ring", () => {
    expect(wakeScheduleOf(item({ enqueuedAt: iso(200) }), at(60), true)).toEqual({ kind: "countdown", secs: 60, left: 1 });
    expect(wakeScheduleOf(item({ enqueuedAt: "bad" }), at(60), true)).toEqual({ kind: "countdown", secs: 60, left: 1 });
  });

  it("ships both labels and hints in both locales", () => {
    for (const catalog of [zhCN, en] as Record<string, string>[]) {
      expect(catalog["agentMsg.wake.countdown"]).toContain("{time}");
      expect(catalog["agentMsg.wake.countdownHint"]).toContain("{time}");
      expect(catalog["agentMsg.wake.readPoint"]).toBeTruthy();
      expect(catalog["agentMsg.wake.readPointHint"]).toBeTruthy();
    }
  });
});

describe("where the deadline comes from (wakeSourceOf)", () => {
  const created = queued;
  const ride = { id: "m", deliveryKind: "bus", enqueuedAt: queued, timing: "afterTurn" as const, nextStepAt: iso(120) };
  const ws = { nextStepAt: iso(60), waitSecs: 60, capability: "soon", timing: "afterTurn" };

  it("1. the record's wakeSchedule: its capability decides, its wait sets the ring", () => {
    const src = wakeSourceOf({ createdAt: created, wakeSchedule: ws }, ride, false);
    expect(src).toMatchObject({ early: true, read: false, item: { nextStepAt: iso(60), timing: "afterTurn", enqueuedAt: iso(0) } });
    expect(wakeScheduleOf(src!.item, at(15), src!.early)).toEqual({ kind: "countdown", secs: 45, left: 0.75 });
    expect(wakeSourceOf({ createdAt: created, wakeSchedule: { ...ws, capability: "afterTurn" } }, ride, true)?.early).toBe(false);
    expect(wakeSourceOf({ createdAt: created, wakeSchedule: { ...ws, capability: "none" } }, ride, true)?.early).toBe(false);
    // No waitSecs: the ring runs from the record's creation.
    expect(wakeSourceOf({ createdAt: iso(30), wakeSchedule: { ...ws, waitSecs: null } }, null, false)?.item.enqueuedAt).toBe(iso(30));
    // Past the wait vs a frozen after-turn note: both have nextStepAt null, timing tells them apart.
    const past = wakeSourceOf({ createdAt: created, wakeSchedule: { ...ws, nextStepAt: null, timing: "nextStep" } }, null, false)!;
    expect(wakeScheduleOf(past.item, at(200), past.early)).toEqual({ kind: "readPoint" });
    const frozen = wakeSourceOf({ createdAt: created, wakeSchedule: { ...ws, nextStepAt: null } }, null, false)!;
    expect(wakeScheduleOf(frozen.item, at(5), frozen.early)).toBeNull();
    expect(wakeSourceOf({ createdAt: created, wakeSchedule: { ...ws, held: "ownerStop" } }, null, false)?.held).toBe("ownerStop");
  });

  it("2. else the admission ride-along, with the runtime rule, its hold and its native-receipt wait", () => {
    expect(wakeSourceOf({ createdAt: created }, ride, true)).toMatchObject({ early: true, read: false, item: ride });
    expect(wakeSourceOf({ createdAt: created }, ride, false)?.early).toBe(false);
    expect(wakeSourceOf({ createdAt: created }, { ...ride, held: "ownerPause" }, true)?.held).toBe("ownerPause");
    expect(wakeSourceOf({ createdAt: created }, ride, true, "ownerStop")?.held).toBe("ownerStop");
    expect(wakeSourceOf({ createdAt: created }, { ...ride, waitReason: "nativeReceipt" }, true)?.read).toBe(true);
  });

  it("3. neither: nothing", () => {
    expect(wakeSourceOf({ createdAt: created }, null, true)).toBeNull();
    expect(wakeSourceOf({ createdAt: created }, undefined, true)).toBeNull();
  });
});
