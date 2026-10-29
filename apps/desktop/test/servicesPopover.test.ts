// The header's 「N 个服务」 popover (lib/servicesPopover; owner 2026-10-25: with 16 services it ran off the window):
// height cap below (or above) the pill, two paged columns when wide, one scrolling column when narrow, and a status
// line without empty parts (「运行中 · :」 for a static service).
import { describe, expect, it } from "vitest";
import { pageOf, POP_CHROME, POP_GAP, POP_MARGIN, POP_W, POP_W_WIDE, ROW_H_COMPACT, serviceStatusLine, serviceWhere, servicesPopoverLayout } from "../src/renderer/src/lib/servicesPopover";

const PILL = { top: 40, bottom: 58, right: 900 };

describe("servicesPopoverLayout", () => {
  it("a few services: one column below the pill, right-aligned to it, natural height", () => {
    const l = servicesPopoverLayout(3, PILL, { width: 1440, height: 900 });
    expect(l).toMatchObject({ top: PILL.bottom + POP_GAP, columns: 1, width: POP_W, left: PILL.right - POP_W, pageSize: Infinity });
    expect(l.maxHeight).toBe(900 - PILL.bottom - POP_GAP - POP_MARGIN);
  });

  it("never taller than the room below the pill", () => {
    for (const n of [3, 16, 40, 200])
      for (const [w, hgt] of [[1440, 900], [1280, 640], [500, 700], [400, 300]] as const) {
        const l = servicesPopoverLayout(n, PILL, { width: w, height: hgt });
        expect(l.top! + l.maxHeight).toBeLessThanOrEqual(hgt - POP_MARGIN);
        expect(l.left).toBeGreaterThanOrEqual(POP_MARGIN);
        expect(l.left + l.width).toBeLessThanOrEqual(w - POP_MARGIN);
      }
  });

  it("16 services in a normal window: two columns, all on one page", () => {
    const l = servicesPopoverLayout(16, PILL, { width: 1440, height: 900 });
    expect(l.columns).toBe(2);
    expect(l.width).toBe(POP_W_WIDE);
    expect(l.pageSize).toBe(2 * Math.floor((l.maxHeight - POP_CHROME) / ROW_H_COMPACT));
    expect(l.pageSize).toBeGreaterThanOrEqual(16);
    expect(POP_CHROME + (l.pageSize / 2) * ROW_H_COMPACT).toBeLessThanOrEqual(l.maxHeight);
  });

  it("40 services: two columns, paged to what fits", () => {
    const l = servicesPopoverLayout(40, PILL, { width: 1440, height: 900 });
    expect(l.columns).toBe(2);
    expect(l.pageSize).toBeLessThan(40);
    expect(pageOf(Array.from({ length: 40 }, (_, i) => i), l.pageSize, 0).pages).toBe(Math.ceil(40 / l.pageSize));
  });

  it("a narrow window: one column that scrolls (no paging), as wide as the window allows", () => {
    const l = servicesPopoverLayout(40, { top: 40, bottom: 58, right: 300 }, { width: 330, height: 700 });
    expect(l).toMatchObject({ columns: 1, pageSize: Infinity, left: POP_MARGIN, width: 330 - 2 * POP_MARGIN });
  });

  it("flips above a pill near the bottom when above is roomier", () => {
    const l = servicesPopoverLayout(16, { top: 700, bottom: 718, right: 900 }, { width: 1440, height: 760 });
    expect(l.top).toBeUndefined();
    expect(l.bottom).toBe(760 - 700 + POP_GAP);
    expect(l.maxHeight).toBe(700 - POP_GAP - POP_MARGIN);
  });
});

describe("pageOf", () => {
  const list = Array.from({ length: 40 }, (_, i) => i);
  it("slices a page; out-of-range pages clamp (services went away)", () => {
    expect(pageOf(list, 16, 1)).toEqual({ rows: list.slice(16, 32), page: 1, pages: 3 });
    expect(pageOf(list, 16, 9).page).toBe(2);
    expect(pageOf(list, 16, 9).rows).toEqual(list.slice(32));
    expect(pageOf(list, 16, -1).page).toBe(0);
    expect(pageOf(list, Infinity, 3)).toEqual({ rows: list, page: 0, pages: 1 });
  });
});

describe("status line", () => {
  it("leaves empty parts out: no dangling 「 · :」", () => {
    expect(serviceStatusLine("运行中", serviceWhere({ port: 24301, runtime: "managed" }, "静态"))).toBe("运行中 · :24301");
    expect(serviceStatusLine("运行中", serviceWhere({ port: 0, runtime: "static" }, "静态"))).toBe("运行中 · 静态");
    expect(serviceStatusLine("运行中", serviceWhere({ port: null as unknown as number, runtime: "static" }, "静态"))).toBe("运行中 · 静态");
    expect(serviceStatusLine("已停止", serviceWhere({ port: 0, runtime: "external" }, "静态"))).toBe("已停止");
    expect(serviceStatusLine("运行中", null)).not.toMatch(/[·:]/);
  });
});
