// 接下来 row age and tip text (owner report 2026-11-19; lib/queueRowTime).
import { describe, expect, it } from "vitest";
import { ROW_TIP_MAX, ledgerRowTime, rowAge, rowTip, timeMs } from "../src/renderer/src/lib/queueRowTime";
import { zhCN, en, zhHant } from "../src/renderer/src/lib/queueRowTimeMessages";

const NOW = Date.parse("2026-11-19T12:00:00.000Z");

describe("rowAge", () => {
  it("just now, minutes, hours, days; unknown time gives nothing", () => {
    expect(rowAge(NOW - 20_000, NOW)).toEqual({ key: "queue.row.justNow", n: 0 });
    expect(rowAge(NOW - 12 * 60_000, NOW)).toEqual({ key: "queue.row.minutesAgo", n: 12 });
    expect(rowAge(NOW - 3 * 3600_000 - 59 * 60_000, NOW)).toEqual({ key: "queue.row.hoursAgo", n: 3 });
    expect(rowAge(NOW - 2 * 86_400_000 - 5, NOW)).toEqual({ key: "queue.row.daysAgo", n: 2 });
    expect(rowAge(NOW + 90_000, NOW)).toEqual({ key: "queue.row.justNow", n: 0 }); // a clock a little ahead
    expect(rowAge(null, NOW)).toBeNull();
    expect(rowAge(timeMs("not a time"), NOW)).toBeNull();
    expect(timeMs("2026-11-19T09:00:00Z")).toBe(Date.parse("2026-11-19T09:00:00Z"));
  });
});

describe("ledgerRowTime", () => {
  it("the confirmed message time wins; only without one the record's createdAt, as 记录于", () => {
    expect(ledgerRowTime(1_700_000_000_000, "2026-11-19T12:00:00Z")).toEqual({ at: 1_700_000_000_000, kind: "sent" });
    expect(ledgerRowTime("2026-11-18T09:00:00Z", "2026-11-19T12:00:00Z", "queued")).toEqual({ at: "2026-11-18T09:00:00Z", kind: "queued" });
    expect(ledgerRowTime(null, "2026-11-19T12:00:00Z")).toEqual({ at: "2026-11-19T12:00:00Z", kind: "recorded" });
    expect(ledgerRowTime("garbage", "2026-11-19T12:00:00Z")).toEqual({ at: "2026-11-19T12:00:00Z", kind: "recorded" });
  });
});

describe("rowTip", () => {
  it("full text then the extra lines; trims, folds blank-line runs, caps long text", () => {
    expect(rowTip("  hello\n\n\n\nworld ⏎", "Received 2026-11-19 09:00:00")).toBe("hello\n\nworld\nReceived 2026-11-19 09:00:00");
    expect(rowTip(null, null)).toBe("");
    const long = rowTip("x".repeat(ROW_TIP_MAX + 50));
    expect(long).toHaveLength(ROW_TIP_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("messages", () => {
  it("zh-CN, en and zh-Hant have the same keys with the same placeholders", () => {
    for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(vars(en[key])).toBe(vars(zhCN[key]));
      expect(vars(zhHant[key])).toBe(vars(zhCN[key]));
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });
});
