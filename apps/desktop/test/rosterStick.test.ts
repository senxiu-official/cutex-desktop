// 花名册 sticky headers (owner 2026-11-17 / 11-18): the two stacks' plan (lib/rosterStick) and where unreachable hosts
// go (lib/hostReach).
import { describe, expect, it } from "vitest";
import { edgeKeys, hiddenOverflow, moreBottom, moreKeys, planStack, STACK_SHARE, type EdgeHeader } from "../src/renderer/src/lib/rosterStick";
import { hostUnreachable, rosterHostRows, unreachableDot } from "../src/renderer/src/lib/hostReach";

const h = (id: string, top: number, system = false, height = 28): EdgeHeader => ({ id, top, height, system });

describe("planStack", () => {
  it("everything fits: every header has a top slot (under the ones before it) and a bottom slot (over the ones after it)", () => {
    const plan = planStack([h("folder:a", 0), h("independent", 900, true), h("older", 1300, true), h("chats", 1400, true)], 756, 28);
    expect(plan.slots).toEqual([
      { id: "folder:a", top: 0, bottom: 84 },
      { id: "independent", top: 28, bottom: 56 },
      { id: "older", top: 56, bottom: 28 },
      { id: "chats", top: 84, bottom: 0 },
    ]);
    expect(plan).toMatchObject({ overflow: [], more: null });
    // While inside a group the top stack is everything up to and including its header.
    expect(plan.under).toEqual({ "folder:a": 28, independent: 56, older: 84, chats: 112 });
  });

  it("the cap only bites on a small window: eleven groups fit a normal list whole", () => {
    const groups = [...Array.from({ length: 8 }, (_, i) => h(`folder:${i}`, i * 400)), h("independent", 4000, true), h("older", 4300, true), h("chats", 4400, true)];
    expect(planStack(groups, 760, 28).overflow).toEqual([]);
  });

  it("over the share: 系统行 first, then 文件夹 from the top; the rest behind 「+N」 (bottom stack, where the first left out would be)", () => {
    const folders = Array.from({ length: 8 }, (_, i) => h(`folder:${i}`, i * 400));
    const plan = planStack([...folders, h("independent", 4000, true), h("older", 4300, true), h("chats", 4400, true)], 476, 28);
    const budget = Math.floor(476 * STACK_SHARE);
    expect(plan.slots.map((x) => x.id)).toEqual(["folder:0", "folder:1", "folder:2", "folder:3", "folder:4", "folder:5", "independent", "older", "chats"]);
    expect(plan.overflow).toEqual(["folder:6", "folder:7"]);
    expect(plan.more).toBe(84);
    expect(plan.slots.find((x) => x.id === "folder:5")).toEqual({ id: "folder:5", top: 140, bottom: 112 });
    expect(plan.slots.find((x) => x.id === "independent")).toEqual({ id: "independent", top: 168, bottom: 56 });
    // A left-out group's own header scrolls away: inside it the top stack is the kept ones before it.
    expect(plan.under["folder:6"]).toBe(168);
    expect(plan.slots.length * 28 + 28).toBeLessThanOrEqual(budget);
  });

  it("a tiny list leaves even 系统行 out rather than covering it", () => {
    const plan = planStack([h("independent", 900, true), h("older", 1300, true), h("chats", 1400, true)], 120, 28);
    expect(plan.slots.length * 28 + (plan.more === null ? 0 : 28)).toBeLessThanOrEqual(Math.floor(120 * STACK_SHARE));
    expect(plan.overflow.length).toBeGreaterThan(0);
  });
});

describe("edgeKeys", () => {
  it("never moves when nothing scrolls, or when its place stays between its slots", () => {
    expect(edgeKeys({ top: 900, height: 28 }, { top: 0, bottom: 0 }, 600, 0)).toBeNull();
    expect(edgeKeys({ top: 100, height: 28 }, { top: 0, bottom: 0 }, 600, 50)).toBeNull();
  });

  it("bottom stack, then its place, then the top stack (exact linear pieces)", () => {
    // Bottom slot 56 of a 600 px list: leaves the bottom stack at s = 900 + 28 + 56 − 600 = 384.
    // Top slot 28: joins the top stack at s = 900 − 28 = 872, then moves down with the view.
    expect(edgeKeys({ top: 900, height: 28 }, { top: 28, bottom: 56 }, 600, 1000)).toEqual([
      { offset: 0, y: -384 },
      { offset: 0.384, y: 0 },
      { offset: 0.872, y: 0 },
      { offset: 1, y: 128 },
    ]);
  });

  it("the first group's header is in the top stack from the first pixel scrolled", () => {
    expect(edgeKeys({ top: 0, height: 28 }, { top: 0, bottom: 84 }, 600, 1000)).toEqual([
      { offset: 0, y: 0 },
      { offset: 1, y: 1000 },
    ]);
  });

  it("in the bottom stack through the whole range when its place stays below the slot", () => {
    expect(edgeKeys({ top: 2000, height: 28 }, { top: 0, bottom: 0 }, 600, 1000)).toEqual([{ offset: 0, y: -1428 }, { offset: 1, y: -428 }]);
  });

  it("a top and a bottom stack never hold the same header at once, and slots never overlap", () => {
    const groups = [h("folder:a", 0), h("folder:b", 300), h("folder:c", 900), h("independent", 1500, true), h("chats", 1600, true)];
    const L = 500;
    const max = 1700 - L;
    const plan = planStack(groups, L, 28);
    for (let s = 0; s <= max; s += 7) {
      const at = plan.slots.map((slot) => {
        const g = groups.find((x) => x.id === slot.id)!;
        const keys = edgeKeys(g, slot, L, max) ?? [{ offset: 0, y: 0 }, { offset: 1, y: 0 }];
        const f = s / max;
        const i = keys.findIndex((k) => k.offset >= f);
        const a = keys[Math.max(0, i - 1)]!, b = keys[Math.max(0, i)]!;
        const y = b.offset === a.offset ? b.y : a.y + ((f - a.offset) / (b.offset - a.offset)) * (b.y - a.y);
        return g.top + y - s; // the header's top in the view
      });
      // List order on screen, each at least a header apart, all inside the list.
      for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(28 - 1e-6);
      expect(at[0]!).toBeGreaterThanOrEqual(-1e-6);
      expect(at.at(-1)! + 28).toBeLessThanOrEqual(L + 1e-6);
    }
  });
});

// Owner 2026-11-19 (the titles jumped as the list reached the very top): reaching either end of the list moves no
// stacked title. Where a title is on screen at scroll s (from the list's top), by its keyframes.
function onScreen(header: Pick<EdgeHeader, "top" | "height">, slot: { top: number; bottom: number }, listHeight: number, maxScroll: number, s: number): number {
  const keys = edgeKeys(header, slot, listHeight, maxScroll) ?? [{ offset: 0, y: 0 }, { offset: 1, y: 0 }];
  const f = s / maxScroll;
  const i = Math.max(1, keys.findIndex((k) => k.offset >= f));
  const a = keys[i - 1]!, b = keys[i]!;
  const y = b.offset === a.offset ? b.y : a.y + ((f - a.offset) / (b.offset - a.offset)) * (b.y - a.y);
  return header.top + y - s;
}
describe("titles at the ends of the list", () => {
  const L = 500;
  const max = 1500;
  // Every scroll position over the last 12 px to the top (and to the bottom): the title's place on screen.
  const nearTop = (header: Pick<EdgeHeader, "top" | "height">, slot: { top: number; bottom: number }) => Array.from({ length: 13 }, (_, s) => onScreen(header, slot, L, max, s));
  const nearEnd = (header: Pick<EdgeHeader, "top" | "height">, slot: { top: number; bottom: number }) => Array.from({ length: 13 }, (_, i) => onScreen(header, slot, L, max, max - i));

  it("the first title rests at the list's top edge, its stuck place: scrolling to the top never moves it", () => {
    // No space before the first title in the scroller (Sidebar: the padding is the box's).
    for (const y of nearTop({ top: 0, height: 28 }, { top: 0, bottom: 56 })) expect(y).toBeCloseTo(0, 9);
  });

  it("the last title (folded) rests at the list's bottom edge, its stuck place: scrolling to the end never moves it", () => {
    // Content ends right under it: its bottom is at L + max.
    for (const y of nearEnd({ top: L + max - 28, height: 28 }, { top: 84, bottom: 0 })) expect(y).toBeCloseTo(L - 28, 9);
  });

  it("(the bug) space inside the scroller before the first title moves it in the last pixels to the top", () => {
    // pt-1: resting at 4, stuck at 0 — it slid 4 px down as the list reached the top.
    const at = nearTop({ top: 4, height: 28 }, { top: 0, bottom: 56 });
    expect(Math.max(...at) - Math.min(...at)).toBeCloseTo(4, 9);
    // pb-2 under a folded last title: it rose 8 px off its stuck place at the end.
    const end = nearEnd({ top: L + max - 8 - 28, height: 28 }, { top: 84, bottom: 0 });
    expect(Math.max(...end) - Math.min(...end)).toBeCloseTo(8, 9);
  });
});

// Owner 2026-11-19 (zero gap): 「+N」 sits right on the titles stuck at the bottom below it, never over an empty slot.
describe("moreBottom", () => {
  const H = 28;
  const list = 300;
  const headers: EdgeHeader[] = [
    { id: "a", system: false, top: 0, height: H },
    { id: "b", system: true, top: 400, height: H },
    { id: "c", system: true, top: 800, height: H },
  ];
  // 「+N」's slot is above b and c (bottom 56); a's is above it.
  const plan = { slots: [{ id: "a", top: 0, bottom: 84 }, { id: "b", top: 28, bottom: 28 }, { id: "c", top: 56, bottom: 0 }], overflow: ["x"], more: 56, under: {} };

  it("is its planned slot while every title below it is stuck", () => {
    expect(moreBottom(headers, plan, list, 100)).toBe(56);
  });

  it("slides down as a title below it rises out of the stack, by as much, onto the run still stuck (no empty slot under it)", () => {
    // b leaves the bottom stack at 400 + 28 + 28 - 300 = 156 and has risen its height at 184.
    expect(moreBottom(headers, plan, list, 156)).toBe(56);
    expect(moreBottom(headers, plan, list, 170)).toBe(42);
    expect(moreBottom(headers, plan, list, 184)).toBe(28);
    // c leaves at 800 + 28 - 300 = 528: nothing below 「+N」 at 556, it sits at the list's bottom.
    expect(moreBottom(headers, plan, list, 542)).toBe(14);
    expect(moreBottom(headers, plan, list, 556)).toBe(0);
  });

  // Owner 2026-11-19 (jitter at the bottom): 「+N」 jumped 28 px at once a frame after the title under it started rising.
  it("is continuous and its keyframes on the scroll timeline match it exactly (one title rising: 1 px per px scrolled)", () => {
    const max = 700;
    const keys = moreKeys(headers, plan, list, max)!;
    expect(keys).not.toBeNull();
    const at = (s: number) => {
      const f = s / max;
      const i = Math.max(1, keys.findIndex((k) => k.offset >= f));
      const a = keys[i - 1]!, b = keys[i]!;
      return b.offset === a.offset ? b.y : a.y + ((f - a.offset) / (b.offset - a.offset)) * (b.y - a.y);
    };
    for (let s = 0; s <= max; s++) {
      if (s > 0) expect(Math.abs(moreBottom(headers, plan, list, s) - moreBottom(headers, plan, list, s - 1))).toBeLessThanOrEqual(1);
      // translateY (down) from the planned slot = planned − where it sits.
      expect(at(s)).toBeCloseTo(56 - moreBottom(headers, plan, list, s), 9);
    }
    // Nothing below it that ever rises: no animation.
    expect(moreKeys(headers, plan, list, 100)).toBeNull();
  });

  // Review (P3): two adjacent folded titles under it leave the bottom stack together — 「+N」 may move 2 px per px
  // scrolled then, but never steps, and the keyframes still give exactly that.
  it("two adjacent titles rising together: up to 2 px per px scrolled, still continuous and matching its keyframes", () => {
    // b at 400 and c right under it at 428 (both folded): both leave the bottom stack at s = 156.
    const two: EdgeHeader[] = [headers[0]!, { id: "b", system: true, top: 400, height: H }, { id: "c", system: true, top: 428, height: H }];
    const max = 400;
    const keys = moreKeys(two, plan, list, max)!;
    expect(keys).not.toBeNull();
    const at = (s: number) => {
      const f = s / max;
      const i = Math.max(1, keys.findIndex((k) => k.offset >= f));
      const a = keys[i - 1]!, b = keys[i]!;
      return b.offset === a.offset ? b.y : a.y + ((f - a.offset) / (b.offset - a.offset)) * (b.y - a.y);
    };
    let steepest = 0;
    for (let s = 0; s <= max; s += 0.5) {
      if (s > 0) {
        const d = Math.abs(moreBottom(two, plan, list, s) - moreBottom(two, plan, list, s - 0.5));
        expect(d).toBeLessThanOrEqual(1 + 1e-9);
        steepest = Math.max(steepest, d / 0.5);
      }
      expect(at(s)).toBeCloseTo(56 - moreBottom(two, plan, list, s), 9);
    }
    expect(steepest).toBe(2);
    // Both risen their height: on the list's bottom.
    expect(moreBottom(two, plan, list, 184)).toBe(0);
  });

  it("titles above 「+N」 in the plan do not move it; without overflow it is 0", () => {
    expect(moreBottom(headers, { ...plan, slots: plan.slots.filter((x) => x.id !== "b" && x.id !== "c") }, list, 0)).toBe(0);
    expect(moreBottom(headers, { ...plan, more: null }, list, 0)).toBe(0);
  });

  it("hiddenOverflow counts 「+N」 where it sits now", () => {
    // At 200 b has risen past its height: 「+N」 covers 28..56 from the bottom, so the bottom stack ends 56 up (244 from
    // the top), not 84 (its planned slot, 216). A header whose middle is at 230 from the top is seen.
    const seen: EdgeHeader = { id: "x", system: false, top: 200 + 230 - H / 2, height: H };
    expect(hiddenOverflow([...headers, seen], { ...plan, overflow: ["x"] }, list, H, 200)).toEqual([]);
  });
});

describe("hiddenOverflow (review 2026-11-18)", () => {
  // The reviewer's case: a 476 px list, eight 文件夹 400 px apart, then three 系统行; 文件夹 6 and 7 are left out.
  const groups = [...Array.from({ length: 8 }, (_, i) => h(`folder:${i}`, i * 400)), h("independent", 3200, true), h("older", 3600, true), h("chats", 4000, true)];
  const plan = planStack(groups, 476, 28);

  it("the reviewer's plan: 文件夹 6 and 7 left out", () => {
    expect(plan.overflow).toEqual(["folder:6", "folder:7"]);
  });

  it("a left-out header under the top stack is hidden, though inside the list", () => {
    // At 2300 the six kept 文件夹 stack at 0..168; 文件夹 6's header is at 100..128.
    expect(hiddenOverflow(groups, plan, 476, 28, 2300)).toContain("folder:6");
  });

  it("seen while its middle is in the clear band between the stacks; hidden under the bottom stack or out of the list", () => {
    // At 2250 文件夹 6's middle is at 164 (under the stack, 0..168); at 2200 at 214 (clear).
    expect(hiddenOverflow(groups, plan, 476, 28, 2250)).toContain("folder:6");
    expect(hiddenOverflow(groups, plan, 476, 28, 2200)).not.toContain("folder:6");
    // At 0 both are far below the list.
    expect(hiddenOverflow(groups, plan, 476, 28, 0)).toEqual(["folder:6", "folder:7"]);
    // Just above the bottom stack's top (「+N」 + three 系统行 = 112) a header is under it.
    const s = 2400 + 14 - (476 - 100);
    expect(hiddenOverflow(groups, plan, 476, 28, s)).toContain("folder:6");
  });

  it("nothing left out: nothing hidden", () => {
    const few = groups.slice(0, 3);
    expect(hiddenOverflow(few, planStack(few, 900, 28), 900, 28, 500)).toEqual([]);
  });
});

describe("unreachable hosts", () => {
  const look = (connected: boolean, status: string) => ({ connected, indicator: { status } }) as never;

  it("switched off or not online is unreachable", () => {
    expect(hostUnreachable(look(true, "online"))).toBe(false);
    expect(hostUnreachable(look(true, "offline"))).toBe(true);
    expect(hostUnreachable(look(true, "connecting"))).toBe(true);
    expect(hostUnreachable(look(false, "disconnected"))).toBe(true);
  });

  it("the switcher dot: red for a host that should be connected, grey for switched-off only, none without", () => {
    expect(unreachableDot([])).toBeNull();
    expect(unreachableDot([{ connected: false }])).toBe("subtle");
    expect(unreachableDot([{ connected: false }, { connected: true }])).toBe("danger");
  });

  it("the 花名册 keeps loading / empty live hosts but never an unreachable one", () => {
    const hosts = [
      { id: "a", state: "offline" as const, hasRows: false },
      { id: "b", state: "loading" as const, hasRows: false },
      { id: "c", state: "live" as const, hasRows: false },
      { id: "d", state: "live" as const, hasRows: true },
    ];
    expect(rosterHostRows(hosts, true).map((x) => x.id)).toEqual(["b", "c"]);
    expect(rosterHostRows(hosts, false).map((x) => x.id)).toEqual(["b"]);
  });
});
