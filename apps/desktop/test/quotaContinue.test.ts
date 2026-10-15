// Claude quota auto-continue (cutex claude-quota-auto-continue): the host-event parser, the strip's
// clock and its words in both locales; the closed runtime gate's words are in stopHold.test.ts.
import { describe, expect, it } from "vitest";
import { continueClock, quotaContinueChangeOf, QUOTA_CONTINUE_CHANGED_EVENT } from "../src/shared/quotaContinue";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const view = { cutexSessionId: "cutex.a", enabled: true, pending: { at: "2026-10-14T05:31:11Z", resetAt: "2026-10-14T05:30:00Z", accountId: "default", turnId: "t", scheduledAt: "2026-10-14T03:00:00Z" }, last: null };
const event = (method: string, params: unknown) => ({ cutex: { method, params } });

describe("quota auto-continue events", () => {
  it("takes a well-formed cutex/quotaAutoContinue/changed only", () => {
    const params = { cutexSessionId: "cutex.a", reason: "scheduled", quotaAutoContinue: view, hostId: "h" };
    expect(quotaContinueChangeOf(event(QUOTA_CONTINUE_CHANGED_EVENT, params))).toEqual(params);
    expect(quotaContinueChangeOf(event("cutex/alarms/changed", params))).toBeNull();
    expect(quotaContinueChangeOf(event(QUOTA_CONTINUE_CHANGED_EVENT, { ...params, quotaAutoContinue: { ...view, cutexSessionId: "cutex.b" } }))).toBeNull();
    expect(quotaContinueChangeOf(event(QUOTA_CONTINUE_CHANGED_EVENT, { cutexSessionId: "cutex.a" }))).toBeNull();
    expect(quotaContinueChangeOf(null)).toBeNull();
  });
});

describe("continue clock", () => {
  const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).getTime();
  const now = local(2026, 10, 14, 13, 5);
  it("today: HH:MM; tomorrow: 明天 / tomorrow; later: MM-DD HH:MM", () => {
    expect(continueClock(new Date(local(2026, 10, 14, 14, 32)).toISOString(), now, "zh-CN")).toBe("14:32");
    expect(continueClock(new Date(local(2026, 10, 15, 9, 3)).toISOString(), now, "zh-CN")).toBe("明天 09:03");
    expect(continueClock(new Date(local(2026, 10, 15, 9, 3)).toISOString(), now, "en")).toBe("tomorrow 09:03");
    expect(continueClock(new Date(local(2026, 10, 20, 9, 3)).toISOString(), now, "en")).toBe("10-20 09:03");
    expect(continueClock("not a time", now, "en")).toBe("");
  });

  it("the strip reads 额度用完 · HH:MM 自动继续 · 取消", () => {
    expect(zhCN["quotaContinue.strip"].replace("{at}", "14:32")).toBe("额度用完 · 14:32 自动继续");
    expect(zhCN["quotaContinue.cancel"]).toBe("取消");
    expect(en["quotaContinue.strip"].replace("{at}", "14:32")).toBe("Usage limit reached · continues at 14:32");
    expect(zhCN["quotaContinue.menu"]).toBe("额度用完后自动继续");
  });
});
