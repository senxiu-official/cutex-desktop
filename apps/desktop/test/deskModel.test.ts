// @vitest-environment jsdom
// Design 032 §5 (modules/home/desk): `HomeDoc.desk` — owner instances, module kinds off, bands; the migration from
// the old blocks (nothing written until the owner changes something); settings validated against the schema; the
// legacy blocks kept in step for older desktops; the shared ticker (one timer per cadence).
import { describe, expect, it, vi } from "vitest";
import { currentDesk, deskOf, initialDesk, mirrorBlocks, settingsOf, withDesk, withItem, withKindOff, withoutItem, withSettings } from "../src/renderer/src/modules/home/desk";
import { homeBlocks } from "../src/renderer/src/modules/home/model";
import type { HomeDoc } from "../src/shared/home";

const kinds = [
  { id: "home.profile" as const, defaultPlace: { area: "header-left" as const, order: 0 } },
  { id: "home.clock" as const, defaultPlace: { area: "header-right" as const, order: 0 } },
  { id: "home.tile" as const, instances: "module" as const, defaultPlace: { area: "main" as const, order: 0 } },
  { id: "world-clock.clock" as const, defaultPlace: { area: "side" as const, order: 5 } },
  { id: "x.extra" as const },
];

describe("the desk in the home document", () => {
  it("migration: owner kinds with a default place, minus the blocks hidden before; nothing stored", () => {
    const doc: HomeDoc = { blocks: [{ id: "clock", visible: false }, { id: "tiles", visible: false }] };
    const d = initialDesk(doc, kinds);
    expect(d.items.map((i) => i.id)).toEqual(["home.profile", "world-clock.clock"]);
    expect(d.off).toEqual(["home.tile"]);
    expect(deskOf(doc)).toBeNull();
    expect(currentDesk(doc, kinds)).toEqual(d);
  });
  it("add / duplicate / remove (no reflow: only its boxes go); settings; a module kind off", () => {
    let d = initialDesk({}, kinds);
    const a = withItem(d, "world-clock.clock");
    expect(a.id).toBe("world-clock.clock#2");
    d = { ...a.desk, bands: { w: { width: 1400, at: { "world-clock.clock#2": { x: 0, y: 0, w: 288, h: 144, ax: "l" }, "home.profile": { x: 300, y: 0, w: 352, h: 96, ax: "l" } } } } };
    d = withoutItem(d, "world-clock.clock#2");
    expect(d.items.some((i) => i.id === "world-clock.clock#2")).toBe(false);
    expect(Object.keys(d.bands.w!.at)).toEqual(["home.profile"]);
    expect(d.bands.w!.at["home.profile"]).toEqual({ x: 300, y: 0, w: 352, h: 96, ax: "l" });
    d = withSettings(d, "world-clock.clock", { hour12: true });
    expect(d.items.find((i) => i.id === "world-clock.clock")!.settings).toEqual({ hour12: true });
    expect(withKindOff(withKindOff(d, "home.tile", true), "home.tile", false).off).toBeUndefined();
  });
  it("written as JSON in `desk`; malformed parts dropped on read", () => {
    const doc = withDesk({}, kinds, (d) => d);
    expect(deskOf(doc)!.items.length).toBe(3);
    const bad: HomeDoc = { desk: { v: 1, items: [{ id: "a", kind: "home.clock" }, { id: "a", kind: "dup" }, 7], bands: { w: { width: 1000, at: { a: { x: 1, y: 2, w: 3, h: 4, ax: "l" }, b: { x: "1" } } }, q: {} } } };
    const read = deskOf(bad)!;
    expect(read.items).toEqual([{ id: "a", kind: "home.clock" }]);
    expect(Object.keys(read.bands.w!.at)).toEqual(["a"]);
    expect(deskOf({ desk: { v: 99, items: [] } })).toBeNull();
  });
  it("the legacy blocks follow the desk (older desktops show the same)", () => {
    const desk = withKindOff(withoutItem(initialDesk({}, kinds), "home.clock"), "home.tile", true);
    const doc = mirrorBlocks({}, desk);
    const vis = Object.fromEntries(homeBlocks(doc).map((b) => [b.id, b.visible]));
    expect(vis).toMatchObject({ profile: true, clock: false, tiles: false });
  });
});

describe("settings: defaults under valid stored values", () => {
  const kind = {
    settings: [
      { key: "cities", type: "list" as const, labelKey: "world-clock.cities" as const, max: 2, min: 1, addLabelKey: "world-clock.addCity" as const, itemDefaults: { label: "", tz: "UTC" }, fields: [{ key: "label", type: "text" as const, labelKey: "world-clock.city" as const, maxLength: 5 }, { key: "tz", type: "timezone" as const, labelKey: "world-clock.zone" as const }] },
      { key: "hour12", type: "toggle" as const, labelKey: "world-clock.hour12" as const },
    ],
    defaults: (locale: string) => ({ cities: [{ label: locale, tz: "Asia/Shanghai" }], hour12: false }),
  };
  it("a valid value wins; an invalid one (bad zone, too long, too many) falls back; unknown keys drop", () => {
    expect(settingsOf(kind, { hour12: true, junk: 1 }, "en")).toEqual({ cities: [{ label: "en", tz: "Asia/Shanghai" }], hour12: true });
    expect(settingsOf(kind, { cities: [{ label: "x", tz: "Mars/Olympus" }] }).cities).toEqual([{ label: "zh-CN", tz: "Asia/Shanghai" }]);
    expect(settingsOf(kind, { cities: [{ label: "toolong", tz: "UTC" }] }).cities).toEqual([{ label: "zh-CN", tz: "Asia/Shanghai" }]);
    expect(settingsOf(kind, { cities: [{ label: "a", tz: "UTC" }, { label: "b", tz: "UTC" }, { label: "c", tz: "UTC" }] }).cities).toEqual([{ label: "zh-CN", tz: "Asia/Shanghai" }]);
    expect(settingsOf(kind, { cities: [{ label: "堪培拉", tz: "Australia/Sydney" }] }).cities).toEqual([{ label: "堪培拉", tz: "Australia/Sydney" }]);
  });
});

describe("the shared ticker", () => {
  it("one timer per cadence however many widgets; stops with the last", async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const env = await import("../src/renderer/src/modules/home/deskEnv");
      const { createElement: h, act } = await import("react");
      const { createRoot } = await import("react-dom/client");
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      const seen: number[] = [];
      function Clock() {
        seen.push(env.useTicker("minute"));
        return null;
      }
      const host = document.createElement("div");
      const root = createRoot(host);
      act(() => root.render(h("div", null, h(Clock), h(Clock), h(Clock))));
      expect(env.tickerTimers()).toBe(1);
      const before = seen.length;
      act(() => void vi.advanceTimersByTime(61_000));
      expect(seen.length).toBe(before + 3);
      act(() => root.unmount());
      expect(env.tickerTimers()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
