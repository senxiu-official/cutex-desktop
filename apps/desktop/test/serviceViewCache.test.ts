// @vitest-environment jsdom
// Service view cache (owner 2026-11-18: A → B → A reloaded the service page and lost its place). Renderer policy
// (modules/browser/viewCache.ts) and main's remembered place (main/browser/viewMemo.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIEW_CACHE_BUDGET_MB, VIEW_CACHE_IDLE_MS, VIEW_CACHE_PAGES, registerViewCache, viewCachePlan, viewCacheTesting, type ViewCacheEntry } from "../src/renderer/src/modules/browser/viewCache";
import { ViewMemos, memoryPressure, readScroll, viewRestoreScript } from "../src/main/browser/viewMemo";
import { createHoldReasons } from "../src/renderer/src/modules/browser/media";

const opts = { pages: VIEW_CACHE_PAGES, idleMs: VIEW_CACHE_IDLE_MS, budgetMB: VIEW_CACHE_BUDGET_MB, pressure: false };
const hidden = (key: string, lastSeen: number, extra: Partial<ViewCacheEntry> = {}): ViewCacheEntry => ({ key, visible: false, lastSeen, gone: false, ...extra });

describe("viewCachePlan", () => {
  it("keeps the visible pages and the 4 most recently seen hidden ones", () => {
    const now = 1_000_000;
    const entries = [{ ...hidden("v", now), visible: true }, ...[1, 2, 3, 4, 5].map((i) => hidden(`h${i}`, now - i * 1000))];
    expect([...viewCachePlan(entries, now, opts)].sort()).toEqual(["h1", "h2", "h3", "h4", "v"]);
  });
  it("lets a hidden page go 30 min after it was last seen, and one whose service was stopped / unregistered", () => {
    const now = 10 * VIEW_CACHE_IDLE_MS;
    const entries = [hidden("fresh", now - VIEW_CACHE_IDLE_MS + 1), hidden("old", now - VIEW_CACHE_IDLE_MS - 1), hidden("stopped", now, { gone: true })];
    expect([...viewCachePlan(entries, now, opts)]).toEqual(["fresh"]);
  });
  it("memory budget: the oldest go once the hidden pages pass it; a shared process counts once", () => {
    const now = 1_000_000;
    const entries = [hidden("a", now - 1, { memory: { pid: 1, privateMB: 120 } }), hidden("b", now - 2, { memory: { pid: 1, privateMB: 120 } }),
      hidden("c", now - 3, { memory: { pid: 2, privateMB: 120 } }), hidden("d", now - 4, { memory: { pid: 3, privateMB: 30 } })];
    expect([...viewCachePlan(entries, now, opts)].sort()).toEqual(["a", "b", "c"]);
  });
  it("memory pressure keeps only what is on screen", () => {
    const now = 1_000_000;
    expect([...viewCachePlan([{ ...hidden("v", now), visible: true }, hidden("h", now)], now, { ...opts, pressure: true })]).toEqual(["v"]);
  });
});

describe("registered service cards", () => {
  afterEach(() => viewCacheTesting.reset());
  it("a card holds while seen, stays held off screen, and the 5th hidden one lets the oldest go", () => {
    let t = 0;
    viewCacheTesting.setNow(() => t);
    const applied: Record<string, boolean[]> = {};
    const cards = [1, 2, 3, 4, 5].map((i) => {
      const key = `local\u0000tab${i}`;
      applied[key] = [];
      return registerViewCache(key, (on) => applied[key]!.push(on), async () => null);
    });
    for (const card of cards) { t += 1000; card.update({ visible: true, gone: false }); t += 1000; card.update({ visible: false, gone: false }); }
    expect(applied["local\u0000tab1"]).toEqual([true, false]);
    expect(viewCacheTesting.held()).toEqual(["local\u0000tab2", "local\u0000tab3", "local\u0000tab4", "local\u0000tab5"]);
    // Expiry: 30 min after the last sight everything hidden goes at the next check.
    t += VIEW_CACHE_IDLE_MS + 5000;
    cards[4]!.update({ visible: false, gone: false });
    expect(viewCacheTesting.held()).toEqual([]);
  });
  it("memory pressure from main lets hidden pages go at the next tick", async () => {
    viewCacheTesting.setNow(() => 1000);
    const apply = vi.fn();
    const card = registerViewCache("local\u0000x", apply, async () => ({ pid: 5, privateMB: 10, pressure: true }));
    card.update({ visible: true, gone: false });
    card.update({ visible: false, gone: false });
    expect(apply.mock.calls).toEqual([[true]]);
    await viewCacheTesting.tick();
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });
  it("the cache reason holds uncapped beside the lease / media reasons", () => {
    const keep = vi.fn((on: boolean) => on), uncapped = vi.fn();
    const reasons = createHoldReasons(keep, uncapped);
    expect(reasons.set("cache", true)).toBe(true);
    expect(uncapped).toHaveBeenLastCalledWith(true);
    expect(reasons.set("cache", false)).toBe(false);
    expect(uncapped).toHaveBeenLastCalledWith(false);
  });
});

describe("main's remembered place", () => {
  it("reads only finite scroll numbers, clamped", () => {
    expect(readScroll({ x: 0, y: 1200.4 })).toEqual({ x: 0, y: 1200 });
    expect(readScroll({ x: -5, y: 1e12 })).toEqual({ x: 0, y: 10_000_000 });
    for (const bad of [null, [], { y: 1 }, { x: "1", y: 2 }]) expect(readScroll(bad)).toBeNull();
  });
  it("restores once, and only at the same address", () => {
    const memos = new ViewMemos();
    memos.set("local", "t", { display: "cutex:service/fix/long", x: 0, y: 1200 });
    expect(memos.take("local", "t", "cutex:service/fix/other")).toBeNull();
    memos.set("local", "t", { display: "cutex:service/fix/long", x: 0, y: 1200 });
    expect(memos.take("local", "t", "cutex:service/fix/long")).toEqual({ display: "cutex:service/fix/long", x: 0, y: 1200 });
    expect(memos.take("local", "t", "cutex:service/fix/long")).toBeNull();
  });
  it("the restore script carries only numbers", () => {
    expect(viewRestoreScript(0, 1200)).toContain("scrollTo(0, 1200)");
    expect(viewRestoreScript(Number.NaN, -3)).toContain("scrollTo(0, 0)");
  });
  it("memory pressure: under 1 GiB free or under 8 %", () => {
    expect(memoryPressure(512 * 1024 ** 2, 64 * 1024 ** 3)).toBe(true);
    expect(memoryPressure(4 * 1024 ** 3, 64 * 1024 ** 3)).toBe(true);
    expect(memoryPressure(24 * 1024 ** 3, 64 * 1024 ** 3)).toBe(false);
  });
});
