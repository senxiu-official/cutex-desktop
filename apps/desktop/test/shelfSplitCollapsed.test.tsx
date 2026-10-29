// @vitest-environment jsdom
// fix/shelf-split-collapsed (owner 2026-10-26): a Shelf page split top / bottom whose lower pane is down to its title
// bar (collapsed, or folded by cardHeights for lack of room) — the gap between the two panes was no handle then, so it
// could not be pulled open again. Now the gap pulls it open, its ▾ and a double-click on its title bar open it (to its
// own share when there is room), an empty slot too; only a pane folded by another pane's 最大化 stays a view.
// fix/shelf-collapse-again (owner 2026-10-27): a pane folds for lack of room only when the page cannot fit the open
// panes' min heights — a stored share under the min (a gap dragged to its limit, a shorter window) is drawn at the min.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOOL = "test.tool";
const WS = "test.ws";
const pass = { parseParams: (p: unknown) => p ?? {}, init: (p: unknown) => p, icon: () => null, Body: () => null, useTab: () => ({ title: "t" }), titleKey: "side.column" };
const SIDE = [
  { mode: "show", moduleId: "test", item: { ...pass, id: TOOL, instances: "multi", defaultBinding: "follow", placement: { home: "chat" }, launcher: { params: () => ({}) } } },
  { mode: "show", moduleId: "test", item: { ...pass, id: WS, instances: "multi", defaultBinding: "workspace", placement: { home: "chat" }, launcher: { params: () => ({}) } } },
];
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: (slot: string) => (slot === "side.component" ? SIDE : NONE), statuses: () => new Map(), modules: [] }),
}));

import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, cardHeights, CARD_GAP, emptyLayout, MIN_CARD_HEIGHT, place, placeSpec, shownCards, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { useGrow } from "../src/renderer/src/lib/panelGrow";
import { SidePageView } from "../src/renderer/src/components/side/SidePageView";
import { sideRegistry } from "../src/renderer/src/lib/sideComponents";

const HEIGHT = 600;
let clock = 100;
const ctx = { hostId: "local", sessionId: "eva", workspaceKey: "ws-a", available: () => true };
function withKind(l: SideLayout, kind: string, binding: SideBinding, page?: string): SideLayout {
  const input = { kind: kind as ItemId, binding, key: null, state: { n: clock } as never, v: 1, pinned: true };
  const decision = place(l, { ...input, transient: false, page, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home: "chat" }));
  return applyOpen(l, decision, input, ++clock, { reveal: true, home: "chat" }).layout;
}
/** One page, two panes top / bottom (`bottom`: its share and collapsed); `emptyBottom`: the lower one is another workspace's (an empty slot here, the page kept). */
function split(bottom: { size: number; collapsed?: boolean }, emptyBottom = false): SideLayout {
  let l = withKind(emptyLayout(), TOOL, { kind: "follow", hostId: "local" });
  const page = l.pages[0]!.id;
  l = withKind(l, WS, { kind: "workspace", hostId: "local", key: emptyBottom ? "ws-b" : "ws-a" }, page);
  const p = l.pages[0]!;
  expect(p.cards).toHaveLength(2);
  const cards = [
    { ...p.cards[0]!, size: 1 - bottom.size, collapsed: false },
    { ...p.cards[1]!, size: bottom.size, collapsed: !!bottom.collapsed },
  ];
  return { ...l, pages: [{ ...p, cards, kept: emptyBottom || p.kept }, ...l.pages.slice(1)] };
}
const page = () => useSide.getState().layout.pages[0]!;
/** What the page would draw now (the same cardHeights SidePageView uses). */
const heights = () => cardHeights(page().cards.map((c) => ({ size: c.size, collapsed: c.collapsed })), HEIGHT, CARD_GAP);

let root: Root;
let container: HTMLElement;
const q = <T extends HTMLElement = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const pointer = (el: Element, type: string, y: number) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y, button: 0 }));

/** The page as its Shelf draws it: cards from the live layout (SideArea re-renders on every layout change). */
function Page() {
  const l = useSide((s) => s.layout);
  const p = l.pages[0]!;
  return h(SidePageView, { page: p, cards: shownCards(l, p, ctx), registry: sideRegistry(), ctx, edge: null, currentWidth: () => 400, target: null });
}
async function render() {
  await act(async () => root.render(h(Page)));
}

beforeEach(() => {
  localStorage.clear();
  useGrow.setState({ target: null });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(HEIGHT);
  (HTMLElement.prototype as unknown as { setPointerCapture(): void }).setPointerCapture = () => {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  useGrow.setState({ target: null });
});

describe("a lower split pane down to its title bar can be opened again", () => {
  it("folded: the gap is still a handle; pulling it up opens the pane, the drag goes on", async () => {
    useSide.setState({ layout: split({ size: 0.1, collapsed: true }) });
    expect(heights().map((b) => b.folded)).toEqual([false, true]);
    await render();
    const bottom = page().cards[1]!.id;
    const gap = q(`[role=separator][data-side-gap="${bottom}"]`)!;
    // Was a plain spacer (no role=separator) beside a folded pane.
    expect(gap).toBeTruthy();
    expect(gap.getAttribute("data-side-gap-unfold")).toBe(bottom);
    await act(async () => {
      pointer(gap, "pointerdown", 500);
      pointer(gap, "pointermove", 498); // a nudge is not a pull
    });
    expect(heights()[1]!.folded).toBe(true);
    await act(async () => void pointer(gap, "pointermove", 300));
    let hs = heights();
    expect(hs.map((b) => b.folded)).toEqual([false, false]);
    expect(hs[1]!.height).toBeCloseTo(36 + 200, 0);
    expect(page().cards[1]!.collapsed).toBe(false);
    // Same gesture, now a plain resize of the two.
    await act(async () => void pointer(gap, "pointermove", 250));
    hs = heights();
    expect(hs[1]!.height).toBeCloseTo(36 + 250, 0); // it follows the pointer: 500 - 250 above where it was folded
    await act(async () => void pointer(gap, "pointerup", 250));
    expect(gap.hasAttribute("data-dragging")).toBe(false);
  });

  it("a short pull opens it at its min height; the gap then waits for the pointer and follows it", async () => {
    useSide.setState({ layout: split({ size: 0.1, collapsed: true }) });
    await render();
    const gap = q("[data-side-gap-unfold]")!;
    await act(async () => {
      pointer(gap, "pointerdown", 500);
      pointer(gap, "pointermove", 480);
    });
    const min = heights()[1]!.height;
    expect(heights()[1]!.folded).toBe(false);
    expect(min).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
    expect(min).toBeLessThan(MIN_CARD_HEIGHT + 2);
    await act(async () => void pointer(gap, "pointermove", 450)); // still below the gap: stays at its min
    expect(heights()[1]!.folded).toBe(false);
    expect(Math.abs(heights()[1]!.height - min)).toBeLessThanOrEqual(1);
    await act(async () => void pointer(gap, "pointermove", 300));
    expect(heights()[1]!.height).toBeCloseTo(36 + 200, 0);
    await act(async () => void pointer(gap, "pointerup", 300));
  });

  it("pulling the wrong way (down, into the folded pane) does nothing", async () => {
    useSide.setState({ layout: split({ size: 0.1, collapsed: true }) });
    await render();
    const gap = q("[data-side-gap-unfold]")!;
    await act(async () => {
      pointer(gap, "pointerdown", 500);
      pointer(gap, "pointermove", 590);
      pointer(gap, "pointerup", 590);
    });
    expect(heights()[1]!.folded).toBe(true);
  });

  it("collapsed by the owner: the gap pulls it open too (clears collapsed); double-click on the gap = an even split of the two", async () => {
    useSide.setState({ layout: split({ size: 0.5, collapsed: true }) });
    await render();
    const gap = q("[data-side-gap-unfold]")!;
    expect(gap).toBeTruthy();
    await act(async () => void gap.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(page().cards[1]!.collapsed).toBe(false);
    const hs = heights();
    expect(hs.map((b) => b.folded)).toEqual([false, false]);
    expect(hs[0]!.height).toBeCloseTo(hs[1]!.height, 0);
  });

  it("keyboard: ArrowUp on the focused gap opens the pane below", async () => {
    useSide.setState({ layout: split({ size: 0.05, collapsed: true }) });
    await render();
    const gap = q("[data-side-gap-unfold]")!;
    await act(async () => void gap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(heights()[1]!.folded).toBe(false);
    expect(heights()[1]!.height).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
  });

  it("collapsed with a share under its min: its ▾ opens it at its min height at least", async () => {
    useSide.setState({ layout: split({ size: 0.1, collapsed: true }) });
    await render();
    const bottom = page().cards[1]!.id;
    const fold = q<HTMLButtonElement>(`[data-side-fold="${bottom}"]`)!;
    expect(fold.title).toBe("side.expand");
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fold.click());
    expect(page().cards[1]!.collapsed).toBe(false);
    expect(heights()[1]!.folded).toBe(false);
    expect(heights()[1]!.height).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
  });

  it("collapsed by the owner: ▾ opens it back at its own share when it fits; double-click on its title bar opens it too", async () => {
    useSide.setState({ layout: split({ size: 0.4, collapsed: true }) });
    await render();
    const bottom = page().cards[1]!.id;
    await act(async () => q<HTMLButtonElement>(`[data-side-fold="${bottom}"]`)!.click());
    expect(heights()[1]!.folded).toBe(false);
    expect(heights()[1]!.height).toBeCloseTo(0.4 * (HEIGHT - CARD_GAP), 0);

    useSide.setState({ layout: split({ size: 0.4, collapsed: true }) });
    await render();
    const head = q(`[data-side-card-head="${page().cards[1]!.id}"]`)!;
    await act(async () => void head.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(page().cards[1]!.collapsed).toBe(false);
    expect(useGrow.getState().target).toBeNull(); // opened, not maximised
  });

  it("an empty slot (a kept page, nothing of this workspace in the lower pane) folded: its title bar has a ▾ that opens it", async () => {
    useSide.setState({ layout: split({ size: 0.5, collapsed: true }, true) });
    await render();
    const bottom = page().cards[1]!.id;
    expect(q(`[data-side-empty-slot="${WS}"]`)).toBeTruthy();
    expect(q("[data-side-empty-note]")).toBeNull(); // folded: title bar only
    expect(q("[data-side-gap-unfold]")).toBeTruthy();
    await act(async () => q<HTMLButtonElement>(`[data-side-fold="${bottom}"]`)!.click());
    expect(page().cards[1]!.collapsed).toBe(false);
    expect(q("[data-side-empty-note]")).toBeTruthy();
    expect(q(`[data-side-fold="${bottom}"]`)).toBeNull(); // open: no ▾ in an empty slot
  });

  it("folded because the other pane is maximised (最大化): a view only — no handle, ▾ / double-click do not open it", async () => {
    useSide.setState({ layout: split({ size: 0.5 }) });
    const top = page().cards[0]!.id;
    useGrow.setState({ target: { kind: "shelf", conv: null, shelfId: "s", card: top } });
    await render();
    expect(q("[data-side-gap-unfold]")).toBeNull();
    expect(q("[role=separator]")).toBeNull();
  });
});

describe("fix/shelf-collapse-again: a pane folds for lack of room only when the page cannot fit the min heights", () => {
  const drawnFolded = () => [...container.querySelectorAll("[data-side-card]")].map((el) => !!el.querySelector('[data-side-fold][aria-expanded="false"]'));
  it("dragging the gap down to its limit leaves the lower pane open at its min height (it folded to its title bar at once)", async () => {
    // The mock's page at a 1000 px window: the share the drag stores (120 / 936) came back as 119.99… px and folded.
    const PAGE = 944;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(PAGE);
    const at = () => cardHeights(page().cards.map((c) => ({ size: c.size, collapsed: c.collapsed })), PAGE, CARD_GAP);
    useSide.setState({ layout: split({ size: 0.5 }) });
    await render();
    const gap = q(`[role=separator][data-side-gap="${page().cards[1]!.id}"]`)!;
    await act(async () => {
      pointer(gap, "pointerdown", 300);
      pointer(gap, "pointermove", 1500); // past the page's bottom: clamped at the lower pane's min
      pointer(gap, "pointerup", 1500);
    });
    const hs = at();
    expect(hs.map((b) => b.folded)).toEqual([false, false]);
    expect(hs[1]!.height).toBeCloseTo(MIN_CARD_HEIGHT, 0);
    expect(drawnFolded()).toEqual([false, false]);
    // Same at the upper limit: the upper pane stays open at its min.
    await act(async () => {
      pointer(gap, "pointerdown", 300);
      pointer(gap, "pointermove", -1000);
      pointer(gap, "pointerup", -1000);
    });
    expect(at().map((b) => b.folded)).toEqual([false, false]);
    expect(at()[0]!.height).toBeCloseTo(MIN_CARD_HEIGHT, 0);
    expect(drawnFolded()).toEqual([false, false]);
  });

  it("a shorter page: a pane whose share is now under its min is drawn at its min, not folded (mock: 200 px of 944, then 300)", async () => {
    // The lower pane had 200 px of a 944 px page; the page is 300 px now — 2 × 120 + 8 still fit.
    const share = 200 / (944 - CARD_GAP);
    useSide.setState({ layout: split({ size: share }) });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    await render();
    expect(drawnFolded()).toEqual([false, false]);
    const [top, bottom] = [...container.querySelectorAll<HTMLElement>("[data-side-card]")].map((el) => parseFloat(el.style.height));
    expect(bottom).toBe(MIN_CARD_HEIGHT);
    expect(top! + bottom! + CARD_GAP).toBe(300);
    // Its stored share is untouched: back on a tall page it has its 200 px again.
    expect(page().cards[1]!.size).toBeCloseTo(share, 10);
    expect(cardHeights(page().cards.map((c) => ({ size: c.size, collapsed: false })), 944, CARD_GAP)[1]!.height).toBeCloseTo(200, 6);
  });

  it("a pane held at its min moves with the pointer at once (the drag works from the drawn heights)", async () => {
    useSide.setState({ layout: split({ size: 0.05 }) }); // 30 px of 600 as a share: drawn at 120
    await render();
    expect(heights()[1]!.height).toBeCloseTo(MIN_CARD_HEIGHT, 6);
    const gap = q(`[role=separator][data-side-gap="${page().cards[1]!.id}"]`)!;
    expect(gap.hasAttribute("data-side-gap-unfold")).toBe(false); // open: a plain resize
    await act(async () => {
      pointer(gap, "pointerdown", 470);
      pointer(gap, "pointermove", 420);
      pointer(gap, "pointerup", 420);
    });
    expect(heights()[1]!.height).toBeCloseTo(MIN_CARD_HEIGHT + 50, 6);
  });

  it("three panes: the bottom one folds only when the three minimums do not fit", () => {
    const three = (sizes: number[], total: number) => cardHeights(sizes.map((size) => ({ size, collapsed: false })), total, CARD_GAP);
    // 0.7 / 0.2 / 0.1 of a 464 px page (window 520): 3 × 120 + 16 = 376 fit.
    let hs = three([0.7, 0.2, 0.1], 464);
    expect(hs.map((b) => b.folded)).toEqual([false, false, false]);
    expect(hs.map((b) => Math.round(b.height))).toEqual([448 - 240, 120, 120]);
    hs = three([0.1, 0.1, 0.8], 464);
    expect(hs.map((b) => b.folded)).toEqual([false, false, false]);
    expect(Math.round(hs[0]!.height)).toBe(120);
    // 360 px: 376 do not fit — the bottom one folds, the two above share what is left.
    hs = three([1, 1, 1], 360);
    expect(hs.map((b) => b.folded)).toEqual([false, false, true]);
    expect(hs[0]!.height + hs[1]!.height).toBe(360 - 2 * CARD_GAP - 36);
  });

  it("a page truly too short for two minimums still folds the lower pane (owner rule kept)", async () => {
    useSide.setState({ layout: split({ size: 0.5 }) });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(2 * MIN_CARD_HEIGHT + CARD_GAP - 1);
    await render();
    expect(drawnFolded()).toEqual([false, true]);
  });
});

describe("a kept page whose pane's module is off", () => {
  it("leaves that pane out (it had its height and nothing drawn: a hole, no gap); it is back when the module is", async () => {
    const l = split({ size: 0.5 });
    const p = l.pages[0]!;
    const lower = p.cards[1]!;
    const off = { ...ctx, available: (kind: string) => kind !== WS };
    expect(shownCards(l, p, off).map((c) => c.id)).toEqual([p.cards[0]!.id]);
    expect(shownCards(l, p, ctx).map((c) => c.id)).toEqual([p.cards[0]!.id, lower.id]);
    // Its size is kept in the layout for when it comes back.
    expect(p.cards[1]!.size).toBeCloseTo(0.5);
    useSide.setState({ layout: l });
    await act(async () => root.render(h(SidePageView, { page: p, cards: shownCards(l, p, off), registry: sideRegistry(), ctx: off, edge: null, currentWidth: () => 400, target: null })));
    expect(container.querySelectorAll("[data-side-card]")).toHaveLength(1);
    expect(q("[data-side-gap]")).toBeNull();
  });
});
