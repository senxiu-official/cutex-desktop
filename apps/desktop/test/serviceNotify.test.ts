// @vitest-environment jsdom
// 服务通知 (modules/service-notify): quiet hours, history merging / grouping, which entries open, the WhatsApp
// state words, the request helpers main uses, the deep-link path guard and the WhatsApp tab's keep-mounted reason.
import { describe, expect, it, vi } from "vitest";
import type { ServiceView } from "../src/shared/ipc";
import type { ServiceNotificationEntry } from "../src/shared/serviceNotifications";
import { historyQuery, settingsBody, validQuietHours } from "../src/shared/serviceNotificationQueries";
import { channelSummary, crossesMidnight, entryOpenTarget, groupHistory, mergeHistory, minuteLabel, minuteOptions, quietRange, withQuietEnd, historyCap, phoneState, timezoneLabel } from "../src/renderer/src/modules/service-notify/model";
import { whatsAppState, type WhatsAppWatch } from "../src/renderer/src/modules/whatsapp/model";
import { safeServicePath } from "../src/renderer/src/modules/service-notify/open";
import { createHoldReasons } from "../src/renderer/src/modules/browser/media";

const entry = (cursor: number, slug = "demo", extra: Partial<ServiceNotificationEntry> = {}): ServiceNotificationEntry => ({
  cursor, id: `id-${cursor}`, slug, serviceName: slug.toUpperCase(), title: "t", body: null, priority: "normal", target: { kind: "service" },
  createdAt: 1_700_000_000 + cursor, deliverUntil: 0, desktop: true, phone: false, ...extra,
});
const service = (slug: string, archived = false) => ({ slug, archived }) as ServiceView;

describe("quiet hours", () => {
  it("labels, crossing midnight and half-hour choices that keep an off-grid value", () => {
    expect(minuteLabel(0)).toBe("00:00");
    expect(minuteLabel(23 * 60 + 5)).toBe("23:05");
    expect(quietRange({ startMinute: 22 * 60, endMinute: 7 * 60 })).toBe("22:00–07:00");
    expect(crossesMidnight({ startMinute: 22 * 60, endMinute: 7 * 60 })).toBe(true);
    expect(crossesMidnight({ startMinute: 12 * 60, endMinute: 14 * 60 })).toBe(false);
    expect(minuteOptions()).toHaveLength(48);
    const opts = minuteOptions(75);
    expect(opts).toHaveLength(49);
    expect(opts.indexOf(75)).toBe(3);
  });
  it("refuses an edit that makes start and end the same", () => {
    const q = { startMinute: 60, endMinute: 120 };
    expect(withQuietEnd(q, "start", 120)).toBeNull();
    expect(withQuietEnd(q, "end", 30)).toEqual({ startMinute: 60, endMinute: 30 });
  });
  it("validates like cutex", () => {
    expect(validQuietHours(null)).toBe(true);
    expect(validQuietHours({ startMinute: 1380, endMinute: 420 })).toBe(true);
    expect(validQuietHours({ startMinute: 60, endMinute: 60 })).toBe(false);
    expect(validQuietHours({ startMinute: 1440, endMinute: 0 })).toBe(false);
    expect(validQuietHours({ startMinute: 1.5, endMinute: 0 })).toBe(false);
  });
});

describe("request helpers (main)", () => {
  it("PUT body has exactly the five fields cutex accepts", () => {
    const body = settingsBody({ enabled: true, desktop: false, phone: true, retainContent: false, quietHours: { startMinute: 1, endMinute: 2 }, extra: 1 } as never);
    expect(Object.keys(body).sort()).toEqual(["desktop", "enabled", "phone", "quietHours", "retainContent"]);
    expect(() => settingsBody({ enabled: true, desktop: true, phone: true, retainContent: false, quietHours: { startMinute: 5, endMinute: 5 } })).toThrow();
  });
  it("history query: slug and cursor checked, limit bounded", () => {
    expect(historyQuery({})).toEqual({ limit: "50" });
    expect(historyQuery({ service: "whatsapp", before: 42, limit: 500 })).toEqual({ service: "whatsapp", before: "42", limit: "100" });
    expect(() => historyQuery({ service: "../x" })).toThrow();
    expect(() => historyQuery({ before: 0 })).toThrow();
  });
});

describe("history", () => {
  it("merges pages newest first and keeps an entry seen twice once", () => {
    const merged = mergeHistory([entry(9), entry(8)], [entry(8), entry(7)]);
    expect(merged.map((e) => e.cursor)).toEqual([9, 8, 7]);
  });
  it("groups by source in order of each source's newest entry", () => {
    const groups = groupHistory([entry(1, "a"), entry(5, "b"), entry(3, "a"), entry(4, "b")]);
    expect(groups.map((g) => [g.slug, g.entries.map((e) => e.cursor)])).toEqual([["b", [5, 4]], ["a", [3, 1]]]);
  });
  it("opens only a target that still resolves to a registered, unarchived service", () => {
    const services = [service("demo"), service("old", true)];
    expect(entryOpenTarget(entry(1, "demo"), services)).toEqual({ slug: "demo", path: "/" });
    expect(entryOpenTarget(entry(1, "demo", { target: { kind: "servicePath", path: "/lab" } }), services)).toEqual({ slug: "demo", path: "/lab" });
    expect(entryOpenTarget(entry(1, "demo", { target: null }), services)).toBeNull();
    expect(entryOpenTarget(entry(1, "old"), services)).toBeNull();
    expect(entryOpenTarget(entry(1, "gone"), services)).toBeNull();
    expect(entryOpenTarget(entry(1, "demo"), null)).toBeNull();
  });
  it("summarises a service's channels", () => {
    const base = { enabled: true, desktop: true, phone: true, retainContent: false, quietHours: null };
    expect(channelSummary(base)).toBe("both");
    expect(channelSummary({ ...base, phone: false })).toBe("desktop");
    expect(channelSummary({ ...base, desktop: false })).toBe("phone");
    expect(channelSummary({ ...base, desktop: false, phone: false })).toBe("none");
    expect(channelSummary({ ...base, enabled: false })).toBe("off");
  });
});

describe("WhatsApp", () => {
  const w = (status: WhatsAppWatch["status"], linked = false, enabled = true): WhatsAppWatch => ({ tabKey: "k", enabled, preview: false, status, linked });
  it("tells 待关联 from 需重新关联 and treats off as 未启用", () => {
    expect(whatsAppState(null)).toBe("disabled");
    expect(whatsAppState(w("link"))).toBe("link");
    expect(whatsAppState(w("link", true))).toBe("relink");
    expect(whatsAppState(w("ready", true))).toBe("ready");
    expect(whatsAppState(w("offline", true))).toBe("offline");
    expect(whatsAppState(w("ready", true, false))).toBe("disabled");
  });
});

describe("deep link path", () => {
  it("keeps a plain service path, drops anything else to the root", () => {
    expect(safeServicePath("/lab")).toBe("/lab");
    expect(safeServicePath(undefined)).toBe("/");
    expect(safeServicePath("//evil.example/")).toBe("/");
    expect(safeServicePath("/a/../b")).toBe("/");
    expect(safeServicePath("/a?token=x")).toBe("/");
    expect(safeServicePath("https://x")).toBe("/");
  });
});

describe("WhatsApp tab hold", () => {
  it("the watch reason keeps the tab mounted, uncapped, until released", () => {
    const keep = vi.fn((hold: boolean) => hold);
    const mark = vi.fn();
    const r = createHoldReasons(keep, mark);
    expect(r.set("watch", true)).toBe(true);
    expect(mark).toHaveBeenLastCalledWith(true);
    expect(r.set("watch", false)).toBe(false);
    expect(mark).toHaveBeenLastCalledWith(false);
  });
});

describe("final contract (cutex 219a82bc)", () => {
  it("labels the host time zone, with or without an IANA name", () => {
    expect(timezoneLabel({ iana: "Australia/Sydney", offsetSeconds: 39_600 })).toBe("Australia/Sydney · UTC+11:00");
    expect(timezoneLabel({ iana: null, offsetSeconds: -12_600 })).toBe("UTC−03:30");
    expect(timezoneLabel(undefined)).toBeNull();
  });
  it("phone state: unpaired, away, ok, unknown", () => {
    expect(phoneState({ androidPaired: false, reachable: null })).toBe("unpaired");
    expect(phoneState({ androidPaired: true, reachable: false })).toBe("away");
    expect(phoneState({ androidPaired: true, reachable: true })).toBe("ok");
    expect(phoneState({ androidPaired: null, reachable: true })).toBe("unknown");
    expect(phoneState(undefined)).toBe("unknown");
  });
  it("paging stops at the retention bound for one service or the whole host", () => {
    const r = { maxAgeSeconds: 604_800, maxPerService: 200, maxPerHost: 2000 };
    expect(historyCap(r, "whatsapp")).toBe(200);
    expect(historyCap(r, null)).toBe(2000);
    expect(historyCap(null, null)).toBe(Infinity);
  });
});
