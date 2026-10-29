// 桌面 / 个人页 statistics (modules/home/stats.ts): day rows of every host → today, this week, the
// current and longest run of days, the heatmap's weeks and quartile levels.
import { describe, expect, it } from "vitest";
import { compactTokens, dailyTotals, dayKey, daysBefore, heatWeeks, homeStats } from "../src/renderer/src/modules/home/stats";
import type { UsageReport } from "../src/shared/ipc";

const amounts = (total: number) => ({ turns: 1, requests: 1, input: total, cachedInput: 0, cacheWriteInput: 0, output: 0, reasoningOutput: 0, total });
const report = (rows: [string | undefined, number][]): UsageReport => ({ from: "", to: "", groupBy: ["day"], totals: amounts(0), rows: rows.map(([day, total]) => ({ key: day ? { day } : {}, ...amounts(total) })), recordingSince: null, warnings: [] });

describe("home statistics", () => {
  it("sums the day rows of every host; skips rows without a day, zero rows and missing hosts", () => {
    const days = dailyTotals([report([["2026-10-19", 100], ["2026-10-20", 50]]), null, report([["2026-10-20", 25], [undefined, 999], ["2026-10-18", 0], ["bad", 5]])]);
    expect([...days.entries()].sort()).toEqual([["2026-10-19", 100], ["2026-10-20", 75]]);
  });

  it("today and this week (Monday on, local days)", () => {
    // 2026-10-21 is a Wednesday: the week is Mon 19 – Wed 21; Sunday 18 belongs to the week before.
    const days = new Map([["2026-10-18", 1000], ["2026-10-19", 10], ["2026-10-20", 20], ["2026-10-21", 30], ["2026-10-22", 99]]);
    const s = homeStats(days, "2026-10-21");
    expect(s.today).toBe(30);
    expect(s.week).toBe(60);
    // Future rows (a clock skew between hosts) count nowhere.
    expect(s.total).toBe(1060);
    expect(s.activeDays).toBe(4);
    // On a Monday the week is that day only.
    expect(homeStats(days, "2026-10-19").week).toBe(10);
    // On a Sunday it is the whole Monday – Sunday week.
    expect(homeStats(new Map([["2026-10-12", 1], ["2026-10-18", 2], ["2026-10-11", 4]]), "2026-10-18").week).toBe(3);
  });

  it("current run: ends today, or yesterday while today has no use yet; broken by a day without use", () => {
    const days = new Map([["2026-10-16", 1], ["2026-10-17", 1], ["2026-10-18", 1], ["2026-10-19", 1], ["2026-10-14", 1]]);
    expect(homeStats(days, "2026-10-19").currentStreak).toBe(4);
    expect(homeStats(days, "2026-10-20").currentStreak).toBe(4); // today not used yet
    expect(homeStats(days, "2026-10-21").currentStreak).toBe(0); // yesterday unused: the run is over
    expect(homeStats(new Map(), "2026-10-21")).toMatchObject({ currentStreak: 0, longestStreak: 0, today: 0, week: 0, total: 0 });
  });

  it("longest run over the window, across month and year ends", () => {
    const days = new Map<string, number>();
    for (let i = 0; i < 6; i++) days.set(daysBefore("2026-01-02", i), 5); // 2025-12-28 … 2026-01-02
    days.set("2026-03-01", 1);
    days.set("2026-02-28", 1);
    const s = homeStats(days, "2026-03-01");
    expect(s.longestStreak).toBe(6);
    expect(s.currentStreak).toBe(2);
  });

  it("day keys are local calendar days; daysBefore steps over DST and month ends", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
    expect(daysBefore("2026-10-05", 2)).toBe("2026-10-03"); // Sydney DST starts 2026-10-04
    expect(daysBefore("2026-10-05", -27)).toBe("2026-11-01");
  });

  it("heatmap: 53 weeks of Monday → Sunday ending this week, the days after today not drawn, quartile levels", () => {
    const today = "2026-10-21"; // Wednesday
    const days = new Map<string, number>([["2026-10-21", 400], ["2026-10-20", 300], ["2026-10-19", 200], ["2026-10-18", 100]]);
    const weeks = heatWeeks(days, today);
    expect(weeks).toHaveLength(53);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const last = weeks[52]!;
    expect(last.map((c) => c.day)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(last.map((c) => c.future)).toEqual([false, false, false, true, true, true, true]);
    expect(weeks[0]![0]!.day).toBe(daysBefore("2026-10-19", 52 * 7));
    const level = (d: string) => weeks.flat().find((c) => c.day === d)!.level;
    expect([level("2026-10-18"), level("2026-10-19"), level("2026-10-20"), level("2026-10-21")]).toEqual([1, 2, 3, 4]);
    expect(level("2026-10-17")).toBe(0);
    // One huge day does not wash the rest out to level 1.
    const spiky = new Map([...days, ["2026-10-10", 1e12]]);
    expect(heatWeeks(spiky, today).flat().find((c) => c.day === "2026-10-21")!.level).toBeGreaterThan(1);
  });

  it("compact token counts per locale", () => {
    expect(compactTokens(1_234_567, "en")).toBe("1.2M");
    expect(compactTokens(12_600_000, "zh-CN")).toBe("1260万");
    expect(compactTokens(950, "en")).toBe("950");
  });
});
