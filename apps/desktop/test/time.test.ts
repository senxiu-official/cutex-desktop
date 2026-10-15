import { describe, expect, it } from "vitest";
import { formatWhen } from "../src/renderer/src/lib/time";

const now = new Date(2026, 9, 6, 12, 0, 0).getTime();
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).getTime() / 1000;

describe("formatWhen", () => {
  it("is relative under an hour", () => {
    expect(formatWhen(now / 1000 - 20, now, "zh-CN")).toBe("刚刚");
    expect(formatWhen(now / 1000 - 12 * 60, now, "zh-CN")).toBe("12 分钟前");
    expect(formatWhen(now / 1000 - 12 * 60, now, "en")).toBe("12 min ago");
  });
  it("uses clock / yesterday / date beyond that", () => {
    expect(formatWhen(at(2026, 9, 6, 9, 5), now, "zh-CN")).toBe("09:05");
    expect(formatWhen(at(2026, 9, 5, 18, 40), now, "zh-CN")).toBe("昨天 18:40");
    expect(formatWhen(at(2026, 9, 3, 18, 40), now, "en")).toBe("10-03 18:40");
    expect(formatWhen(at(2025, 9, 3, 18, 40), now, "en")).toBe("2025-10-03");
  });
});
