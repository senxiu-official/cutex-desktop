// The two sides (docs/desktop-modules.md §19; RFC §7, §8 item 4): gutter geometry, where the reference
// card opens, the Esc chain, 回到, the margin push-down, the turn lookup order and the core turn
// reference's toRef → fromRef round trip.
import { describe, expect, it, vi } from "vitest";
import type { SessionHistory } from "@cutex-desktop/protocol";
import { escChainStep, type EscChainInput } from "../src/renderer/src/lib/escChain";
import { CAPSULE_BAND, COLUMN_PADDING, freeSpan, gutterLayout, gutterPopoverPosition, gutterTriggerLocation, marginWidth, overlayPeekWidth, OVERLAY_GAP, PEEK_BESIDE_MIN, PEEK_MAX, PEEK_MIN, peekPlacement, peekWidth, placeBelow, popoverWidth, POPOVER_MAX, POPOVER_MIN, TRIGGER_MIN, type GutterInput } from "../src/renderer/src/lib/gutterLayout";
import { marginStack } from "../src/renderer/src/lib/marginStack";
import { edgeOverlay, withReservation } from "../src/renderer/src/lib/overlayLayout";
import { peekTarget } from "../src/renderer/src/lib/peekTarget";
import { returnLabel, returnReduce, type ReturnPoint, type ReturnState } from "../src/renderer/src/lib/returnPoint";
import { findTurn, LOOKUP_PAGES, PageCache, singleTurn, type PageReader } from "../src/renderer/src/lib/turnFetch";
import { timelineFromThreadRead } from "../src/renderer/src/lib/timeline";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const input = (over: Partial<GutterInput> = {}): GutterInput => ({ cardWidth: 1600, shift: 0, sideCover: 0, readingWidth: 768, columnPadding: COLUMN_PADDING, capsule: null, conversationVisible: true, ...over });

describe("gutterLayout", () => {
  it("centres the column; both gutters get the rest", () => {
    const g = gutterLayout(input());
    expect(g).toMatchObject({ columnLeft: 416, columnWidth: 768 });
    expect(g.left).toEqual({ width: 416, trigger: "gutter", topInset: 0, bottomBand: 0 });
    expect(g.right.width).toBe(416);
  });

  it("让位: the column moves by half the shift (clamped to the card); the right gutter shrinks by the rest", () => {
    const g = gutterLayout(input({ cardWidth: 1180, shift: 420 }));
    // (1180 + 420 − 768) / 2 = 416, clamped to 1180 − 768 = 412: the column hugs the card's right edge.
    expect(g.columnLeft).toBe(412);
    expect(g.left.width).toBe(412);
    expect(g.right.width).toBe(0);
  });

  it("悬浮 / drawer: the covered part does not count for the right gutter", () => {
    const g = gutterLayout(input({ sideCover: 300 }));
    expect(g.left.width).toBe(416);
    expect(g.right.width).toBe(116);
  });

  it("full width (readingWidth 0), a covered conversation or no card: no gutters, triggers in the composer", () => {
    for (const over of [{ readingWidth: 0 }, { conversationVisible: false }, { cardWidth: 0 }]) {
      const g = gutterLayout(input(over));
      expect(g.left.width, JSON.stringify(over)).toBe(0);
      expect(g.right.width).toBe(0);
      expect(g.left.trigger).toBe(COLUMN_PADDING >= TRIGGER_MIN ? "gutter" : "composer");
    }
  });

  it("triggers move into the composer when G + padding < 44", () => {
    expect(gutterLayout(input({ cardWidth: 768 + 2 * 19 })).left.trigger).toBe("composer");
    expect(gutterLayout(input({ cardWidth: 768 + 2 * 20 })).left.trigger).toBe("gutter");
  });

  it("a capsule at a window-edge corner takes a band on its side only", () => {
    const top = gutterLayout(input({ capsule: { side: "left", anchor: "top" } }));
    expect(top.left.topInset).toBe(CAPSULE_BAND);
    expect(top.left.bottomBand).toBe(0);
    expect(top.right.topInset).toBe(0);
    const bottom = gutterLayout(input({ capsule: { side: "right", anchor: "bottom" } }));
    expect(bottom.right.bottomBand).toBe(CAPSULE_BAND);
    expect(bottom.left.bottomBand).toBe(0);
  });

  it("card / popover / margin widths", () => {
    expect(peekWidth(416)).toBe(416 + COLUMN_PADDING - 16);
    expect(peekWidth(2000)).toBe(PEEK_MAX);
    expect(popoverWidth(0)).toBe(POPOVER_MIN);
    expect(popoverWidth(1000)).toBe(POPOVER_MAX);
    expect(overlayPeekWidth(1000)).toBe(420);
    expect(overlayPeekWidth(300)).toBe(252);
    expect(marginWidth(200)).toBe(208);
    expect(marginWidth(1000)).toBe(320);
  });
});

describe("top gutter entries", () => {
  it("stay at the top in full-width and narrow conversations, without changing the reading geometry", () => {
    for (const over of [{ readingWidth: 0, cardWidth: 1920 }, { cardWidth: 460 }, { cardWidth: 1600 }]) {
      const geometry = gutterLayout(input(over));
      for (const side of [geometry.left, geometry.right]) {
        expect(gutterTriggerLocation("top", side)).toBe("top");
        expect(gutterTriggerLocation(undefined, side)).toBe(side.trigger);
        expect(gutterTriggerLocation("composer", side)).toBe(side.trigger);
      }
    }
    expect(gutterLayout(input({ readingWidth: 0, cardWidth: 1920 })).columnWidth).toBe(1920);
  });

  const popover = (over: Partial<Parameters<typeof gutterPopoverPosition>[0]> = {}) => gutterPopoverPosition({
    side: "left", direction: "down", edge: 24, minTop: 32, width: 360,
    anchorTop: 32, anchorBottom: 62, viewportWidth: 1000, viewportHeight: 800, ...over,
  });

  it("opens below the top trigger, respecting the capsule reservation", () => {
    expect(popover()).toEqual({ width: 360, left: 24, top: 68, maxHeight: 470 });
    expect(popover({ minTop: 32 + CAPSULE_BAND, anchorTop: 80, anchorBottom: 110 }).top).toBe(116);
  });

  it("clamps a narrow / short viewport instead of extending beyond its edges", () => {
    expect(popover({ viewportWidth: 220, viewportHeight: 200, edge: 90 })).toEqual({ width: 204, left: 8, top: 68, maxHeight: 124 });
    expect(popover({ side: "right", viewportWidth: 460, edge: 800 })).toMatchObject({ width: 360, right: 92 });
    const short = popover({ viewportHeight: 90, anchorBottom: 110 });
    expect(short.top! + short.maxHeight).toBeLessThanOrEqual(82);
  });

  it("keeps composer entries opening above their trigger", () => {
    expect(popover({ direction: "up", anchorTop: 700, anchorBottom: 730 })).toEqual({ width: 360, left: 24, bottom: 106, maxHeight: 470 });
  });
});

describe("peekTarget", () => {
  it("自动: the gutter when ≥ peekMin, else the right side", () => {
    expect(peekTarget("auto", PEEK_MIN, PEEK_MIN, true)).toBe("gutter");
    expect(peekTarget("auto", PEEK_MIN - 1, PEEK_MIN, true)).toBe("page");
  });
  it("总在右侧 / 总在左侧 (narrow: over the column)", () => {
    expect(peekTarget("right", 900, PEEK_MIN, true)).toBe("page");
    expect(peekTarget("left", 900, PEEK_MIN, true)).toBe("gutter");
    expect(peekTarget("left", 40, PEEK_MIN, true)).toBe("overlay");
  });
  it("the conversation covered (maximised / full screen): always the right side", () => {
    for (const s of ["auto", "left", "right"] as const) expect(peekTarget(s, 900, PEEK_MIN, false)).toBe("page");
  });
});

describe("escChainStep", () => {
  const esc = (over: Partial<EscChainInput> = {}): EscChainInput => ({ modifiers: false, repeat: false, composing: false, overlay: false, handled: false, peek: false, mode: false, drawer: false, editable: false, inSide: false, ...over });
  it("row 0: modifiers, key repeat and IME do nothing", () => {
    for (const over of [{ modifiers: true }, { repeat: true }, { composing: true }]) expect(escChainStep(esc({ ...over, peek: true }))).toBe("ignore");
  });
  it("rows 1–2: an open popup or a handler that used the key wins", () => {
    expect(escChainStep(esc({ overlay: true, peek: true, mode: true }))).toBe("overlay");
    expect(escChainStep(esc({ handled: true, peek: true }))).toBe("handled");
  });
  it("row 3: the reference card closes first — also from the composer — but not while typing in a side input", () => {
    expect(escChainStep(esc({ peek: true, drawer: true }))).toBe("close-peek");
    expect(escChainStep(esc({ peek: true, editable: true }))).toBe("close-peek");
    expect(escChainStep(esc({ peek: true, editable: true, inSide: true }))).toBe("side");
  });
  it("row 3 waits while a maximised / full-screen side hides the card: restore first, the card is back, then it closes", () => {
    expect(escChainStep(esc({ peek: true, mode: true, drawer: true }))).toBe("restore");
    expect(escChainStep(esc({ peek: true, mode: true, editable: true }))).toBe("restore");
    expect(escChainStep(esc({ peek: true }))).toBe("close-peek");
  });
  it("rows 4–5: restore a mode, then the drawer (not from a text field)", () => {
    expect(escChainStep(esc({ mode: true, drawer: true }))).toBe("restore");
    expect(escChainStep(esc({ drawer: true }))).toBe("close-drawer");
    expect(escChainStep(esc({ drawer: true, editable: true }))).toBe("conversation");
  });
  it("rows 6–7: focus in a side / gutter never reaches the conversation", () => {
    expect(escChainStep(esc({ inSide: true }))).toBe("side");
    expect(escChainStep(esc())).toBe("conversation");
  });
});

describe("回到 (returnReduce)", () => {
  const point: ReturnPoint = { hostId: "local", sessionId: "a", agentName: "Lead", turnId: "t250", offset: 12, atBottom: false, ordinal: 250 };
  const jumped = returnReduce(null, { type: "jump", point, target: { sessionId: "a", turnId: "t36" } })!;
  it("a jump records the point; a chained jump keeps the first point", () => {
    expect(jumped).toEqual({ point, target: { sessionId: "a", turnId: "t36" }, armed: false });
    const again = returnReduce(jumped, { type: "jump", point: { ...point, turnId: "t36" }, target: { sessionId: "a", turnId: "t10" } })!;
    expect(again.point.turnId).toBe("t250");
    expect(again.target.turnId).toBe("t10");
  });
  it("goes away when used, on a scope change, on a send in either agent, on a sidebar switch", () => {
    expect(returnReduce(jumped, { type: "used" })).toBeNull();
    expect(returnReduce(jumped, { type: "scope" })).toBeNull();
    expect(returnReduce(jumped, { type: "sent", sessionId: "a" })).toBeNull();
    expect(returnReduce(jumped, { type: "sent", sessionId: "z" })).toBe(jumped);
    expect(returnReduce(jumped, { type: "select", sessionId: "b", byJump: false })).toBeNull();
    expect(returnReduce(jumped, { type: "select", sessionId: "b", byJump: true })).toBe(jumped);
  });
  it("scrolling back near the point (after having been away) or > 3 screens from both", () => {
    const near = returnReduce(jumped, { type: "scroll", sessionId: "a", fromPoint: 0.5, fromTarget: 5 });
    expect(near).toBe(jumped); // not armed yet: the jump starts far away, nothing happened
    const armed = returnReduce(jumped, { type: "scroll", sessionId: "a", fromPoint: 8, fromTarget: 0 })!;
    expect(armed.armed).toBe(true);
    expect(returnReduce(armed, { type: "scroll", sessionId: "a", fromPoint: 1, fromTarget: 7 })).toBeNull();
    expect(returnReduce(armed, { type: "scroll", sessionId: "a", fromPoint: 4, fromTarget: 4 })).toBeNull();
    expect(returnReduce(armed, { type: "scroll", sessionId: "a", fromPoint: 4, fromTarget: 2 })).toBe(armed);
  });
  it("label: the agent after a cross-agent jump, the ordinal when known, else 刚才的位置", () => {
    const s: ReturnState = jumped;
    expect(returnLabel(s, "b")).toEqual({ key: "gutter.return.agent", vars: { name: "Lead" } });
    expect(returnLabel(s, "a")).toEqual({ key: "gutter.return.ordinal", vars: { n: 250 } });
    expect(returnLabel({ ...s, point: { ...point, ordinal: null } }, "a")).toEqual({ key: "gutter.return.place", vars: {} });
  });
});

describe("marginStack", () => {
  it("keeps boxes at their anchors and pushes overlapping ones down (anchor order)", () => {
    const tops = marginStack([
      { id: "c", anchor: 300, height: 40 },
      { id: "a", anchor: 0, height: 100 },
      { id: "b", anchor: 50, height: 60 },
    ]);
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(108);
    expect(tops.get("c")).toBe(300);
  });
});

describe("overlay reservations (the gutters avoid a window-edge capsule)", () => {
  it("keeps the side; a side change is a change; edgeOverlay finds the window-edge one", () => {
    const m1 = withReservation(new Map(), "cap", { anchor: "top", overColumn: false, side: "left" });
    expect(m1.get("cap")).toEqual({ anchor: "top", overColumn: false, side: "left" });
    expect(withReservation(m1, "cap", { anchor: "top", overColumn: false, side: "left" })).toBe(m1);
    const m2 = withReservation(m1, "cap", { anchor: "top", overColumn: false, side: "right" });
    expect(m2).not.toBe(m1);
    expect(edgeOverlay(m2.values())).toEqual({ side: "right", anchor: "top" });
    expect(edgeOverlay([{ anchor: "top", overColumn: true, side: "left" }])).toBeNull();
    expect(edgeOverlay([{ anchor: "top", overColumn: false }])).toBeNull();
  });
});

// ── Turn lookup ────────────────────────────────────────────────────────────────────────────────────

const turn = (n: number) => ({ id: `t${n}`, status: "completed", startedAt: 1000 + n, completedAt: 1001 + n, items: [{ type: "userMessage", id: `u${n}`, content: [{ type: "text", text: `turn ${n}` }] }, { type: "agentMessage", id: `a${n}`, text: `reply ${n}` }] });
const TOTAL = 1300;
/** Pages of `size` turns, newest first; cursor `before:<index>`. */
function pages(size = 200, thread = "thread-1", total = TOTAL): { read: PageReader; calls: (string | null)[] } {
  const calls: (string | null)[] = [];
  const read: PageReader = async (cursor) => {
    calls.push(cursor);
    const end = cursor ? Number(cursor.slice("before:".length)) : total;
    const start = Math.max(0, end - size);
    const next = start > 0 ? `before:${start}` : null;
    return {
      contractVersion: 2,
      cutexSessionId: "s",
      threadId: thread,
      source: "live",
      native: { method: "thread/read", result: { thread: { id: thread, turns: Array.from({ length: end - start }, (_, i) => turn(start + i + 1)) } } },
      page: { limit: size, cursor, nextCursor: next, hasMore: next !== null },
    } as unknown as SessionHistory;
  };
  return { read, calls };
}
const loadedFrom = (from: number, to: number, opts: { complete?: boolean; thread?: string } = {}) => ({
  timeline: timelineFromThreadRead({ thread: { id: opts.thread ?? "thread-1", turns: Array.from({ length: to - from + 1 }, (_, i) => turn(from + i)) } } as never),
  olderCursor: opts.complete ? null : `before:${from - 1}`,
  complete: !!opts.complete,
});

describe("findTurn", () => {
  it("a loaded turn: no reads; the ordinal only when the whole history is loaded", async () => {
    const { read, calls } = pages();
    const loaded = loadedFrom(1271, 1300);
    const r = await findTurn({ agent: "x", turnId: "t1290", loaded, cache: new PageCache(), read });
    expect(r).toMatchObject({ status: "found", found: { from: "loaded", ordinal: null } });
    expect(calls).toEqual([]);
    const all = await findTurn({ agent: "x", turnId: "t5", loaded: loadedFrom(1, 10, { complete: true }), cache: new PageCache(), read });
    expect(all).toMatchObject({ status: "found", found: { ordinal: 5 } });
    if (r.status === "found") expect(r.found.timeline.turns.map((t) => t.id)).toEqual(["t1290"]);
  });

  it("pages back from the loaded cursor into the reference cache; a second lookup reads nothing", async () => {
    const { read, calls } = pages();
    const cache = new PageCache();
    const loaded = loadedFrom(1271, 1300);
    const r = await findTurn({ agent: "x", turnId: "t1000", loaded, cache, read });
    expect(r).toMatchObject({ status: "found", found: { from: "pages" } });
    expect(calls).toEqual(["before:1270", "before:1070"]);
    const again = await findTurn({ agent: "x", turnId: "t1000", loaded, cache, read });
    expect(again).toMatchObject({ status: "found", found: { from: "cache" } });
    expect(calls).toHaveLength(2);
  });

  it("further back than 5 pages: too-old; the first page reached without it: reverted", async () => {
    const { read, calls } = pages();
    const r = await findTurn({ agent: "x", turnId: "t3", loaded: loadedFrom(1271, 1300), cache: new PageCache(), read });
    expect(r).toEqual({ status: "not-found", reason: "too-old" });
    expect(calls).toHaveLength(LOOKUP_PAGES);
    const short = pages(200, "thread-1", 300);
    const gone = await findTurn({ agent: "y", turnId: "t9999", loaded: null, cache: new PageCache(), read: short.read });
    expect(gone).toEqual({ status: "not-found", reason: "reverted" });
  });

  it("an agent not loaded starts from the newest page; another native thread = reverted", async () => {
    const { read, calls } = pages(200, "thread-1", 300);
    const r = await findTurn({ agent: "z", turnId: "t50", loaded: null, cache: new PageCache(), read });
    expect(r).toMatchObject({ status: "found", found: { ordinal: 50 } });
    expect(calls[0]).toBeNull();
    const other = await findTurn({ agent: "z2", turnId: "t50", threadId: "thread-OLD", loaded: null, cache: new PageCache(), read });
    expect(other).toEqual({ status: "not-found", reason: "reverted" });
    const loadedOther = await findTurn({ agent: "z3", turnId: "t1", threadId: "thread-OLD", loaded: loadedFrom(281, 300), cache: new PageCache(), read });
    expect(loadedOther).toEqual({ status: "not-found", reason: "reverted" });
  });

  it("no stored history: unknown", async () => {
    const r = await findTurn({ agent: "x", turnId: "t1", loaded: null, cache: new PageCache(), read: async () => null });
    expect(r).toEqual({ status: "not-found", reason: "unknown" });
  });

  it("the cache keeps the last 3 pages per agent and expires old ones", () => {
    let now = 0;
    const cache = new PageCache(3, () => now);
    const page = {} as SessionHistory;
    for (const c of ["a", "b", "c", "d"]) cache.put("x", c, page);
    expect(cache.get("x", "a")).toBeNull();
    expect(cache.get("x", "d")).toBe(page);
    now = 11 * 60_000;
    expect(cache.get("x", "d")).toBeNull();
  });

  it("singleTurn keeps only that turn's entries", () => {
    const tl = loadedFrom(1, 3, { complete: true }).timeline;
    const one = singleTurn(tl, "t2")!;
    expect(one.index).toBe(1);
    expect(one.timeline.turns).toHaveLength(1);
    expect(one.timeline.entries.size).toBe(one.turn.entryIds.length);
  });
});

describe("the core turn reference (conversation.turnPeek)", () => {
  it("toRef → fromRef round-trips through a stored ref", async () => {
    const { turnPeekComponent } = await import("../src/renderer/src/modules/conversation/turnPeekItem");
    const { parseRef } = await import("../src/renderer/src/lib/refs");
    const state = turnPeekComponent.parseParams({ hostId: "local", sessionId: "lead", turnId: "turn-36", threadId: "th-1", ordinal: 36, agentName: "Lead", snippet: "look at #36" })!;
    expect(state).toBeTruthy();
    const r = turnPeekComponent.toRef!(turnPeekComponent.init(state, null))!;
    expect(r.key).toBe("lead:turn-36");
    const stored = parseRef(JSON.parse(JSON.stringify({ hostId: "local", kind: "turn", key: r.key, title: r.title, params: r.params, snapshot: { at: "2026-10-10T00:00:00Z", snippet: r.snippet } })));
    expect(stored).not.toBeNull();
    const back = turnPeekComponent.fromRef!(stored!.params);
    expect(back).toMatchObject({ sessionId: "lead", turnId: "turn-36", threadId: "th-1", ordinal: 36 });
    expect(turnPeekComponent.parseParams({ sessionId: "has space", turnId: "t" })).toBeNull();
  }, 30_000); // the first dynamic import transforms the whole TurnPeek graph (markdown + font routing), > 5 s when cold
});

describe("the reference card in the Esc chain", () => {
  it("counts as a layer in front: the conversation's Esc stands back while it is open", async () => {
    const { usePeek } = await import("../src/renderer/src/lib/peekStore");
    const { sideLayersActive } = await import("../src/renderer/src/lib/sideLayoutStore");
    expect(sideLayersActive()).toBe(false);
    usePeek.setState({ peek: { id: "p1", kind: "conversation.turnPeek", binding: { kind: "host", hostId: "local" }, key: "k", params: null, state: null, v: 1, hostId: "local", where: "gutter" } as never });
    expect(sideLayersActive()).toBe(true);
    usePeek.setState({ peek: null });
    expect(sideLayersActive()).toBe(false);
  });
});

describe("keeping clear of overlay boxes (the capsule as drawn)", () => {
  // A 700 px window with the side card open: a ~290 px conversation card, the expanded capsule
  // (multi-line, right corner) spans almost all of it from the top.
  const capsule = { left: 20, top: 8, right: 282, bottom: 178 };

  it("placeBelow: a top entry that would intersect moves below the box; one that does not stays", () => {
    expect(placeBelow(8, 120, 8, 30, [capsule])).toBe(178 + OVERLAY_GAP);
    expect(placeBelow(8, 120, 8, 30, [])).toBe(8);
    // Collapsed capsule in the right corner, entry in the left corner: no horizontal overlap.
    expect(placeBelow(8, 120, 8, 30, [{ left: 160, top: 8, right: 282, bottom: 42 }])).toBe(8);
    // Touching edges do not count as an overlap.
    expect(placeBelow(8, 20, 8, 30, [capsule])).toBe(8);
  });

  it("placeBelow: moving below one box can run into the next (each passed once), boxes in any order", () => {
    const boxes = [{ left: 0, top: 200, right: 100, bottom: 260 }, { left: 0, top: 0, right: 100, bottom: 190 }];
    expect(placeBelow(8, 60, 8, 30, boxes)).toBe(260 + OVERLAY_GAP);
    // A gap big enough between the two: it stops there.
    expect(placeBelow(8, 60, 8, 30, [{ left: 0, top: 0, right: 100, bottom: 100 }, { left: 0, top: 200, right: 100, bottom: 260 }])).toBe(108);
  });

  it("freeSpan: a box near the top pushes the top down, one near the bottom pulls the bottom up", () => {
    expect(freeSpan(8, 300, 8, 600, [capsule])).toEqual({ top: 186, bottom: 600 });
    expect(freeSpan(8, 300, 8, 600, [{ left: 20, top: 500, right: 282, bottom: 590 }])).toEqual({ top: 8, bottom: 492 });
    expect(freeSpan(8, 300, 8, 600, [capsule, { left: 20, top: 500, right: 282, bottom: 590 }])).toEqual({ top: 186, bottom: 492 });
    expect(freeSpan(400, 500, 8, 600, [capsule])).toEqual({ top: 8, bottom: 600 });
    // A box covering everything leaves nothing.
    const full = freeSpan(8, 300, 8, 600, [{ left: 0, top: 0, right: 400, bottom: 700 }]);
    expect(full.bottom).toBeLessThanOrEqual(full.top);
  });

  it("peekPlacement: unchanged without an intersecting box", () => {
    expect(peekPlacement({ x0: 8, width: 420, top: 8, bottom: 600, obstacles: [] })).toEqual({ top: 8, bottom: 600, width: 420 });
    expect(peekPlacement({ x0: 8, width: 300, top: 8, bottom: 600, obstacles: [{ left: 600, top: 8, right: 900, bottom: 300 }] })).toEqual({ top: 8, bottom: 600, width: 300 });
  });

  it("peekPlacement: a collapsed capsule over the card's top corner → the card starts just below it", () => {
    // The capsule (one line, 34 px) at the top right over the column: 42 px less height beats 56 px less width.
    const pill = { left: 380, top: 8, right: 552, bottom: 42 };
    expect(peekPlacement({ x0: 8, width: 420, top: 8, bottom: 600, obstacles: [pill] })).toEqual({ top: 50, bottom: 600, width: 420 });
  });

  it("peekPlacement: a wide expanded capsule → the card moves below it at full width", () => {
    const panel = { left: 120, top: 8, right: 440, bottom: 300 };
    // Beside would be 104 px wide (< PEEK_BESIDE_MIN): below instead.
    expect(120 - OVERLAY_GAP - 8).toBeLessThan(PEEK_BESIDE_MIN);
    expect(peekPlacement({ x0: 8, width: 420, top: 8, bottom: 600, obstacles: [panel] })).toEqual({ top: 308, bottom: 600, width: 420 });
  });

  it("peekPlacement: picks whichever of below / beside leaves the larger area", () => {
    // Tall but narrow box at the right: beside (300 × 592) beats below (420 × 92).
    const tall = { left: 316, top: 8, right: 440, bottom: 500 };
    expect(peekPlacement({ x0: 8, width: 420, top: 8, bottom: 600, obstacles: [tall] })).toEqual({ top: 8, bottom: 600, width: 300 });
    // Short and wide enough to leave little beside: below.
    const short = { left: 260, top: 8, right: 440, bottom: 40 };
    expect(peekPlacement({ x0: 8, width: 420, top: 8, bottom: 600, obstacles: [short] })).toEqual({ top: 48, bottom: 600, width: 420 });
  });
});
