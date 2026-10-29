// @vitest-environment jsdom
// Design 032 (modules/home/DeskSurface): the instances the desktop shows (owner ones from the desk, module ones from
// their kind — a pinned service's with its service as source; a kind turned off shows none) and the boxes of a
// width band: its own, else derived from the nearest stored band, else the default layout.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { deskInstances, deskLayoutFor } from "../src/renderer/src/modules/home/DeskSurface";
import { initialDesk } from "../src/renderer/src/modules/home/desk";
import { HOME_WIDGETS, TILE_WIDGET } from "../src/renderer/src/modules/home/widgets";
import worldClock from "../src/renderer/src/modules/world-clock";
import type { DesktopWidgetItem } from "../src/renderer/src/modules/widgetTypes";

const entry = (item: DesktopWidgetItem, moduleId: string) => ({ item, moduleId, mode: "show" as const, missing: [], waiting: false });
const kinds = [...HOME_WIDGETS.map((w) => entry(w, "home")), entry((worldClock.contributes!["desktop.widget"] as DesktopWidgetItem[])[0]!, "world-clock")];
const mods = { [TILE_WIDGET]: [{ id: "pin:a", title: "听书", size: [51, 25] as const, source: { kind: "service" as const, hostId: "local", slug: "listen" } }, { id: "pin:b", title: "Eva" }] };

describe("instances", () => {
  it("owner instances from the desk, module ones from their kind with their source; off = none", () => {
    const desk = initialDesk({}, kinds.map((k) => k.item));
    const list = deskInstances(kinds, desk, mods, "zh-CN");
    expect(list.map((i) => i.id)).toEqual(["home.profile", "home.clock", "home.needs", "home.stats", "world-clock.clock", "pin:a", "pin:b"]);
    expect(list.find((i) => i.id === "pin:a")!.source).toEqual({ kind: "service", hostId: "local", slug: "listen" });
    expect(list.find((i) => i.id === "pin:a")!.steps).toEqual([51, 25]);
    expect((list.find((i) => i.id === "world-clock.clock")!.settings.cities as unknown[]).length).toBe(2);
    expect(deskInstances(kinds, { ...desk, off: [TILE_WIDGET] }, mods, "zh-CN").some((i) => i.id.startsWith("pin:"))).toBe(false);
  });
  it("a band on the unit grid (1.24): the default, its own units, derived, the 1.23 cells doubled, or migrated from 1.22 px", () => {
    const desk = initialDesk({}, kinds.map((k) => k.item));
    const list = deskInstances(kinds, desk, mods, "zh-CN");
    const def = deskLayoutFor(desk, list, 1300);
    expect(def).toMatchObject({ band: "w", how: "default", cols: 23 });
    // The two clocks side by side at the right of the header row (owner 2026-10-24); 23 units = 1272 px.
    expect(def.cells["home.clock"]).toEqual({ x: 19, y: 0, w: 4, h: 2 });
    expect(def.cells["world-clock.clock"]).toEqual({ x: 13, y: 0, w: 6, h: 2 });
    expect(def.at["home.clock"]!.x + def.at["home.clock"]!.w).toBe(1272);
    for (const r of Object.values(def.at)) expect([r.x % 56, r.y % 56, (r.w + 16) % 56, (r.h + 16) % 56]).toEqual([0, 0, 0, 0]);
    const own = { ...desk, units: { w: { cols: 23, at: Object.fromEntries(Object.entries(def.cells).map(([k, r]) => [k, { ...r, ax: "l" as const }])) } } };
    expect(deskLayoutFor(own, list, 1320).how).toBe("own");
    const derived = deskLayoutFor(own, list, 900);
    expect(derived).toMatchObject({ band: "m", how: "derived", cols: 16 });
    for (const r of Object.values(derived.cells)) expect(r.x + r.w).toBeLessThanOrEqual(16);
    // A 1.23 band (96 px cells): exactly doubled — nothing moves on screen.
    const big = { ...desk, cells: { w: { cols: 11, at: { "home.profile": { x: 0, y: 1, w: 3, h: 1, ax: "l" as const } } } } };
    const fromBig = deskLayoutFor(big, list, 1300);
    expect(fromBig.how).toBe("migrated");
    expect(fromBig.cells["home.profile"]).toEqual({ x: 0, y: 2, w: 6, h: 2 });
    expect(fromBig.at["home.profile"]).toEqual({ x: 0, y: 112, w: 320, h: 96 });
    const old = { ...desk, bands: { w: { width: 1300, at: { "home.profile": { x: 0, y: 108, w: 352, h: 96, ax: "l" as const } } } } };
    const migrated = deskLayoutFor(old, list, 1300);
    expect(migrated.how).toBe("migrated");
    expect(migrated.cells["home.profile"]).toEqual({ x: 0, y: 2, w: 7, h: 2 });
  });
  it("a module that declares only 1.22 step sizes still lays out (sizes mapped to units)", () => {
    const Widget = () => null;
    const legacy = entry({ id: "legacy.note", titleKey: "home.block.stats", icon: (() => null) as never, size: { min: [20, 10], max: [60, 40], default: [36, 25] }, defaultPlace: { area: "main", order: 0 }, Widget } as DesktopWidgetItem, "legacy");
    const all = [...kinds, legacy];
    const desk = initialDesk({}, all.map((k) => k.item));
    const list = deskInstances(all, desk, {}, "en");
    expect(list.find((i) => i.id === "legacy.note")!.units).toEqual([5, 4]);
    const lay = deskLayoutFor(desk, list, 1300);
    expect(lay.cells["legacy.note"]).toMatchObject({ w: 5, h: 4 });
  });
});
