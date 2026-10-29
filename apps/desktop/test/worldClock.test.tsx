// @vitest-environment jsdom
// The 世界时钟 widget (design 032 §8; the authoring guide's worked example): its zone arithmetic, its defaults
// (Canberra + Chongqing), what it draws, and the shell-rendered settings form editing its cities.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "en-GB" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { dateIn, dayDiff, dayIn, hourDiff, offsetMinutes, timeIn } from "../src/renderer/src/modules/world-clock/zones";
import { withLocalTimeZone } from "./helpers/timeZone";
import worldClock, { WORLD_CLOCK, worldClockDefaults } from "../src/renderer/src/modules/world-clock";
import { WorldClockWidget, faceLayout } from "../src/renderer/src/modules/world-clock/WorldClock";
import { WidgetSettingsForm } from "../src/renderer/src/modules/home/WidgetSettingsForm";
import { settingsOf } from "../src/renderer/src/modules/home/desk";
import type { DesktopWidgetItem, DesktopWidgetProps, WidgetSettings } from "../src/renderer/src/modules/widgetTypes";

// 2026-10-22 03:05 UTC = 14:05 in Canberra (AEDT, +11), 11:05 in Chongqing (+8).
const AT = Date.UTC(2026, 9, 22, 3, 5, 0);
const kind = (worldClock.contributes!["desktop.widget"] as DesktopWidgetItem[])[0]!;

describe("zones", () => {
  it("offsets, dates, differences (Canberra keeps Sydney's daylight saving)", () => {
    expect(offsetMinutes("Australia/Sydney", AT)).toBe(660);
    expect(offsetMinutes("Asia/Shanghai", AT)).toBe(480);
    expect(hourDiff("Asia/Shanghai", "Australia/Sydney", AT)).toBe(-3);
    expect(hourDiff("Asia/Kolkata", "UTC", AT)).toBe(5.5);
    expect(timeIn("Australia/Sydney", AT, "en-GB", false)).toBe("14:05");
    expect(timeIn("Asia/Shanghai", AT, "en-GB", false)).toBe("11:05");
    // 22:30 UTC: already the next day in Canberra, still the same in Chongqing? (06:30 next day) — both next day vs UTC.
    const late = Date.UTC(2026, 9, 22, 15, 30);
    expect(dayIn("Australia/Sydney", late)).toBe("2026-10-23");
    expect(dayDiff("Australia/Sydney", "Asia/Shanghai", late)).toBe(1);
    expect(dayDiff("America/Los_Angeles", "Australia/Sydney", AT)).toBe(-1);
  });
  it("the date line: month, day, short weekday of that zone", () => {
    expect(dateIn("Asia/Shanghai", AT, "zh-CN")).toMatch(/^10月22日 周四$/);
    expect(dateIn("Asia/Shanghai", AT, "en-US")).toBe("Thu, October 22");
    expect(dateIn("Australia/Sydney", Date.UTC(2026, 9, 22, 15, 30), "en-GB")).toMatch(/23/);
  });
  it("face layout: a column per city while 128 px each fit, then rows; digits follow the room", () => {
    expect(faceLayout(2, 288, 96)).toMatchObject({ columns: 2, rows: 1 });
    expect(faceLayout(4, 288, 160)).toMatchObject({ columns: 2, rows: 2 });
    expect(faceLayout(1, 288, 96).columns).toBe(1);
    expect(faceLayout(2, 100, 60).columns).toBe(1);
    expect(faceLayout(1, 800, 400).big).toBe(64);
  });
});

describe("the widget kind", () => {
  it("is a `desktop.widget` with sizes in grid steps, several instances, the minute ticker, a settings schema", () => {
    expect(kind.id).toBe(WORLD_CLOCK);
    expect(kind.size).toEqual({ min: [16, 8], max: [96, 60], default: [36, 12], units: { min: [3, 2], max: [16, 10], default: [6, 2] } });
    expect(kind.shape).toBe("bare");
    expect(kind.multiple).toBe(true);
    expect(kind.refresh).toBe("minute");
    expect(kind.settings!.map((f) => f.key)).toEqual(["cities", "hour12", "showDate", "showDiff"]);
  });
  it("defaults: Canberra (Australia/Sydney) and Chongqing (Asia/Shanghai), 24 h, the date shown, the difference off — valid against its own schema", () => {
    const d = worldClockDefaults("zh-CN");
    expect((d.cities as { tz: string }[]).map((c) => c.tz)).toEqual(["Australia/Sydney", "Asia/Shanghai"]);
    expect(settingsOf(kind, d)).toEqual(d);
  });
  it("cities saved before the icon field existed are kept (the missing icon = itemDefaults), not reset to the defaults", () => {
    const old = { cities: [{ label: "London", tz: "Europe/London" }, { label: "Tokyo", tz: "Asia/Tokyo" }], hour12: true };
    const s = settingsOf(kind, old);
    expect(s.cities).toEqual([{ label: "London", tz: "Europe/London", icon: "none" }, { label: "Tokyo", tz: "Asia/Tokyo", icon: "none" }]);
    expect(s.hour12).toBe(true);
    // A value that is present but wrong still rejects the list (the defaults come back).
    expect((settingsOf(kind, { cities: [{ label: "x", tz: "Europe/London", icon: "boat" }] }).cities as { tz: string }[])[0]!.tz).toBe("Australia/Sydney");
  });
});

function render(settings: WidgetSettings, size: { width: number; height: number } = { width: 288, height: 144 }) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const props: DesktopWidgetProps = {
    instanceId: WORLD_CLOCK, ...size, steps: { w: size.width / 8, h: size.height / 8 }, cells: { w: Math.max(1, Math.round((size.width + 16) / 112)), h: Math.max(1, Math.round((size.height + 16) / 112)) }, units: { w: Math.max(2, Math.round((size.width + 16) / 56)), h: Math.max(2, Math.round((size.height + 16) / 56)) }, theme: "light", settings, setSettings: () => {}, reducedMotion: false, arranging: false, now: AT, hostId: "local", source: { kind: "module" },
    actions: { openAgent: async () => false, openPage: () => false, openService: async () => false, sendToAgent: async () => false },
  };
  act(() => root.render(h(WorldClockWidget, props)));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("what it draws", () => {
  const withHere = (fn: () => void) => withLocalTimeZone("Australia/Sydney", fn);
  it("a column per city side by side: label, time, date; the difference only in the tooltip by default", () =>
    withHere(() => {
      const a = render(worldClockDefaults("zh-CN"));
      const cols = [...a.host.querySelectorAll<HTMLElement>("[data-world-clock-city]")];
      expect(cols.map((r) => r.dataset.worldClockCity)).toEqual(["Australia/Sydney", "Asia/Shanghai"]);
      expect(a.host.querySelector<HTMLElement>("[data-world-clock]")!.style.gridTemplateColumns).toContain("repeat(2");
      expect(cols[1]!.textContent).toMatch(/11:05/);
      expect(cols[1]!.textContent).toMatch(/22/);
      expect(cols[1]!.textContent).not.toContain("world-clock.ahead");
      expect(cols[1]!.title).toContain("world-clock.behind");
      a.unmount();
    }));
  it("options: the difference line, no date, 12-hour, icons; a small box drops the date", () =>
    withHere(() => {
      const cities = [{ label: "A", tz: "Asia/Shanghai", icon: "pin" }, { label: "B", tz: "UTC", icon: "home" }];
      const a = render({ ...worldClockDefaults("en"), cities, hour12: true, showDiff: true, showDate: false });
      expect(a.host.textContent).toMatch(/\d\s?(am|pm)/i);
      expect(a.host.textContent).toContain("world-clock.behind");
      expect(a.host.querySelectorAll("svg").length).toBe(2);
      a.unmount();
      const b = render(worldClockDefaults("en"), { width: 288, height: 60 });
      expect(b.host.textContent).not.toMatch(/Oct/);
      b.unmount();
    }));
  it("five cities wrap into rows; one city is one centred column", () =>
    withHere(() => {
      const five = Array.from({ length: 5 }, (_, i) => ({ label: `c${i}`, tz: "UTC", icon: "none" }));
      const a = render({ ...worldClockDefaults("en"), cities: five }, { width: 288, height: 200 });
      expect(a.host.querySelector<HTMLElement>("[data-world-clock]")!.style.gridTemplateColumns).toContain("repeat(2");
      expect(a.host.querySelectorAll("[data-world-clock-city]").length).toBe(5);
      a.unmount();
      const b = render({ ...worldClockDefaults("en"), cities: five.slice(0, 1) });
      expect(b.host.querySelector<HTMLElement>("[data-world-clock]")!.style.gridTemplateColumns).toContain("repeat(1");
      b.unmount();
    }));
});

describe("the shell's settings form (WidgetSettingsForm)", () => {
  it("edits the list: a row per city, a valid zone saved, add / remove within min / max", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let saved: WidgetSettings | null = null;
    const draw = (s: WidgetSettings) => act(() => root.render(h(WidgetSettingsForm, { fields: kind.settings!, settings: s, onChange: (n: WidgetSettings) => (saved = n) })));
    const start = worldClockDefaults("zh-CN");
    draw(start);
    expect(host.querySelectorAll("[data-widget-row]").length).toBe(2);
    const tz = host.querySelector<HTMLInputElement>("[data-widget-row='1'] [data-widget-tz]")!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      set.call(tz, "Europe/Paris");
      tz.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((saved!.cities as { tz: string }[])[1]!.tz).toBe("Europe/Paris");
    saved = null;
    act(() => {
      set.call(tz, "Nowhere/Land");
      tz.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(saved).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-widget-list-add]")!.click());
    expect((saved!.cities as unknown[]).length).toBe(3);
    act(() => root.unmount());
    host.remove();
  });
});
