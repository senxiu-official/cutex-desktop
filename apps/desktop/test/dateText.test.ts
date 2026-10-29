// lib/dateText: CJK dates without the spaces some ICU builds put around the numbers; the "here" test helper.
import { describe, expect, it } from "vitest";
import { formatDate, localTimeZone, normalizeDateText } from "../src/renderer/src/lib/dateText";
import { fakeLocalTimeZone, withLocalTimeZone } from "./helpers/timeZone";

const AT = Date.UTC(2026, 9, 22, 3, 0, 0);

describe("normalizeDateText", () => {
  it("removes spaces around the numbers of zh / ja dates; zh gets one space before the weekday", () => {
    expect(normalizeDateText("10 月 22 日 周四", "zh-CN")).toBe("10月22日 周四");
    expect(normalizeDateText("10 月 22 日星期四", "zh-CN")).toBe("10月22日 星期四");
    expect(normalizeDateText("2026 年 10 月 22 日", "zh-Hant-CN")).toBe("2026年10月22日");
    expect(normalizeDateText("10 月 22 日 週四", "zh-Hant-CN")).toBe("10月22日 週四");
    expect(normalizeDateText("10 月 22 日 (木)", "ja")).toBe("10月22日(木)");
  });
  it("leaves other languages as written", () => {
    expect(normalizeDateText("10월 22일 (목)", "ko")).toBe("10월 22일 (목)");
    expect(normalizeDateText("Thu, October 22", "en")).toBe("Thu, October 22");
  });
  it("is idempotent", () => {
    for (const t of ["10月22日 周四", "10月22日(木)"]) expect(normalizeDateText(normalizeDateText(t, "zh-CN"), "zh-CN")).toBe(normalizeDateText(t, "zh-CN"));
  });
});

describe("formatDate", () => {
  it("formats through Intl and normalises", () => {
    expect(formatDate(AT, "zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "short" })).toBe("10月22日 周四");
    expect(formatDate(AT, "en-US", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" })).toBe("October 22");
  });
});

describe("test/helpers/timeZone", () => {
  it("fakes here and restores it, also after a throw", () => {
    const real = localTimeZone();
    expect(withLocalTimeZone("Asia/Kolkata", () => localTimeZone())).toBe("Asia/Kolkata");
    expect(localTimeZone()).toBe(real);
    expect(() => withLocalTimeZone("Asia/Kolkata", () => { throw new Error("x"); })).toThrow("x");
    expect(localTimeZone()).toBe(real);
    const spy = fakeLocalTimeZone("Pacific/Chatham");
    expect(localTimeZone()).toBe("Pacific/Chatham");
    expect(new Intl.DateTimeFormat("en").resolvedOptions().locale).toBe("en");
    spy.mockRestore();
    expect(localTimeZone()).toBe(real);
  });
});
