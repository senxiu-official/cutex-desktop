// 闹钟 status category (cutex alarms-api): partition, time labels, parties, event parsing, cache keys.
import { describe, expect, it } from "vitest";
import { ALARM_ID, alarmChangeOf, type AlarmView } from "../src/shared/alarms";
import { agentAlarms, alarmClock, alarmParties, alarmsWorthShowing, FRESH_MS, keysTouched, relativeParts, shortAgent, withAlarm } from "../src/renderer/src/modules/alarms/model";

const A = "cutex.00000000-0000-0000-0000-00000000000a";
const B = "cutex.00000000-0000-0000-0000-00000000000b";
const NOW = new Date(2026, 9, 11, 12, 0, 0).getTime();

function alarm(id: string, at: number, state: AlarmView["state"] = "scheduled", extra: Partial<AlarmView> = {}): AlarmView {
  return {
    id: `alarm-${id}`,
    alarmId: id,
    ownerKind: "agent",
    ownerCutexSessionId: A,
    ownerName: "Eva",
    targetCutexSessionId: B,
    targetName: "Rei",
    at: new Date(at).toISOString(),
    delaySeconds: null,
    state,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    messagePreview: `text ${id}`,
    messageChars: 6,
    messageTruncated: false,
    ...extra,
  };
}

describe("alarms model", () => {
  it("splits pending (earliest first) from recent sent / cancelled (newest first, last 24 h)", () => {
    const list = [
      alarm("late", NOW + 3_600_000),
      alarm("soon", NOW + 60_000),
      alarm("sent", NOW - 10 * 60_000, "queued"),
      alarm("old", NOW - 30 * 3_600_000, "queued"),
      alarm("cancelledFuture", NOW + 7_200_000, "cancelled"),
    ];
    const data = agentAlarms(list, NOW);
    expect(data.pending.map((a) => a.alarmId)).toEqual(["soon", "late"]);
    expect(data.recent.map((a) => a.alarmId)).toEqual(["cancelledFuture", "sent"]);
    expect(data.nextAt).toBe(NOW + 60_000);
    expect(agentAlarms([], NOW)).toEqual({ pending: [], recent: [], nextAt: null });
  });

  it("shows while something is scheduled or an alarm went off less than 30 min ago", () => {
    expect(alarmsWorthShowing(agentAlarms([alarm("a", NOW + 1000)], NOW), NOW)).toBe(true);
    expect(alarmsWorthShowing(agentAlarms([alarm("a", NOW - 60_000, "queued")], NOW), NOW)).toBe(true);
    expect(alarmsWorthShowing(agentAlarms([alarm("a", NOW - FRESH_MS - 1, "queued")], NOW), NOW)).toBe(false);
    expect(alarmsWorthShowing(agentAlarms([alarm("a", NOW - 60_000, "cancelled")], NOW), NOW)).toBe(false);
    expect(alarmsWorthShowing(agentAlarms([], NOW), NOW)).toBe(false);
  });

  it("clock labels: today, tomorrow, yesterday, this year, another year", () => {
    const at = (d: number, h: number, m: number, y = 2026, mo = 9) => new Date(y, mo, d, h, m).getTime();
    expect(alarmClock(at(11, 14, 30), NOW, "zh-CN")).toBe("14:30");
    expect(alarmClock(at(12, 9, 5), NOW, "zh-CN")).toBe("明天 09:05");
    expect(alarmClock(at(12, 9, 5), NOW, "en")).toBe("Tomorrow 09:05");
    expect(alarmClock(at(10, 18, 40), NOW, "en")).toBe("Yesterday 18:40");
    expect(alarmClock(at(14, 9, 0), NOW, "en")).toBe("10-14 09:00");
    expect(alarmClock(at(2, 9, 0, 2027, 0), NOW, "en")).toBe("2027-01-02 09:00");
  });

  it("relative parts round up ahead and down behind", () => {
    expect(relativeParts(NOW + 30_000, NOW)).toEqual({ past: false, unit: "now", n: 0 });
    expect(relativeParts(NOW + 22 * 60_000 + 1, NOW)).toEqual({ past: false, unit: "min", n: 23 });
    expect(relativeParts(NOW - 22 * 60_000 - 1, NOW)).toEqual({ past: true, unit: "min", n: 22 });
    expect(relativeParts(NOW + 3 * 3_600_000, NOW)).toEqual({ past: false, unit: "hour", n: 3 });
    expect(relativeParts(NOW + 3 * 86_400_000, NOW)).toEqual({ past: false, unit: "day", n: 3 });
  });

  it("parties: names, the owner, self, and a short id without a name", () => {
    expect(alarmParties(alarm("a", NOW))).toEqual({ from: "Eva", to: "Rei", self: false });
    expect(alarmParties(alarm("a", NOW, "scheduled", { ownerKind: "human", ownerCutexSessionId: null, ownerName: null }))).toEqual({ from: null, to: "Rei", self: false });
    expect(alarmParties(alarm("a", NOW, "scheduled", { targetCutexSessionId: A })).self).toBe(true);
    expect(alarmParties(alarm("a", NOW, "scheduled", { targetName: null })).to).toBe(shortAgent(B));
    expect(shortAgent(B)).toBe("…0000000b");
    expect(shortAgent("eva")).toBe("eva");
  });

  it("withAlarm replaces in place and keeps the row's relation", () => {
    const list = [alarm("a", NOW, "scheduled", { relation: "outgoing" }), alarm("b", NOW + 1)];
    const next = withAlarm(list, { ...alarm("a", NOW, "cancelled") });
    expect(next.map((a) => [a.alarmId, a.state, a.relation])).toEqual([
      ["a", "cancelled", "outgoing"],
      ["b", "scheduled", undefined],
    ]);
  });

  it("an alarm change touches the cached agents of its host only", () => {
    const keys = [`h1|${A}`, `h1|${B}`, `h2|${A}`, "h1|cutex.other"];
    expect(keysTouched(keys, "h1", [A, null])).toEqual([`h1|${A}`]);
    expect(keysTouched(keys, "h1", [A, B])).toEqual([`h1|${A}`, `h1|${B}`]);
    expect(keysTouched(keys, "h3", [A, B])).toEqual([]);
  });
});

describe("alarms wire", () => {
  it("parses cutex/alarms/changed and ignores other events", () => {
    const params = { reason: "cancelled", id: "alarm-x", alarm: null, ownerCutexSessionId: A, targetCutexSessionId: B, hostId: "h" };
    expect(alarmChangeOf({ cutex: { method: "cutex/alarms/changed", params } })).toEqual(params);
    expect(alarmChangeOf({ cutex: { method: "cutex/services/changed", params } })).toBeNull();
    expect(alarmChangeOf({ cutex: { method: "cutex/alarms/changed", params: { reason: "x" } } })).toBeNull();
    expect(alarmChangeOf(null)).toBeNull();
  });

  it("alarm ids are the delivery message ids", () => {
    expect(ALARM_ID.test("alarm-11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(ALARM_ID.test("check-build")).toBe(false);
    expect(ALARM_ID.test("alarm-../x")).toBe(false);
  });
});
