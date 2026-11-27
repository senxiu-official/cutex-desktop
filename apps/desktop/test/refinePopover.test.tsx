// @vitest-environment jsdom
// 输入优化's comparison as a float above the input box (owner 2026-11-28; components/ComposerActionLayer,
// modules/input-refinement/RewritePanel). It used to sit inside the input card with an uncapped change list: the
// composer grew over most of the window and, once the panel closed, the history's only-up rule kept the shrink as
// blank room under the rows (lib/stickToBottom keepRowsUp) — the history was gone from view.
// - the timeline: what an in-flow panel did (room = its height after accept / cancel), and that an input box of
//   constant height leaves the rows exactly where they were through open, accept and cancel;
// - the layer is out of the input box's flow (absolute, above it), capped (60vh / the room above the input), hidden empty;
// - the panel keeps its title and 采用 / 取消 rows fixed and scrolls only its middle; a correction's reason runs on
//   after the change behind 「：」 (no second line).
import { act, createElement as h } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepRowsUp, type RowsAnchor } from "../src/renderer/src/lib/stickToBottom";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "zh-CN" }),
}));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfileList: () => ({ defaultProfile: "p", profiles: [{ id: "p", name: "Main", model: "m" }] }),
  loadProfileList: () => Promise.resolve({ defaultProfile: "p", profiles: [{ id: "p", name: "Main", model: "m" }] }),
}));
vi.mock("../src/renderer/src/lib/featureProfiles", () => ({ useFeatureProfiles: () => ({ list: [] }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ComposerActionLayer } = await import("../src/renderer/src/components/ComposerActionLayer");
const { layerMaxHeight, LAYER_MIN } = await import("../src/renderer/src/lib/composerActionLayer");
const { PromptEnhancePanel } = await import("../src/renderer/src/modules/input-refinement/RewritePanel");

/** The conversation pane as stickToBottomResize.test.ts models it: rows above an input box of `composer` px. */
class Pane {
  height = 700;
  composer = 120;
  rows = [400, 300, 200, 150, 90];
  room = 0;
  private top = 0;
  main = document.createElement("main");
  scroller = document.createElement("div");
  col = document.createElement("div");
  rowEls: HTMLElement[] = [];
  anchor: RowsAnchor | null = null;
  constructor() {
    this.main.append(this.scroller);
    this.scroller.append(this.col);
    document.body.append(this.main);
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 900, width: 900, x: 0, y: top, toJSON() {} }) as DOMRect;
    this.main.getBoundingClientRect = () => rect(0, this.height);
    this.scroller.getBoundingClientRect = () => rect(0, this.clientHeight);
    Object.defineProperties(this.scroller, {
      clientHeight: { get: () => this.clientHeight },
      scrollHeight: { get: () => this.scrollHeight },
      scrollTop: { get: () => this.top, set: (v: number) => (this.top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight))) },
    });
    this.scroller.scrollTo = ((o: ScrollToOptions) => { this.scroller.scrollTop = o.top ?? 0; }) as typeof this.scroller.scrollTo;
    this.rows.forEach((_, i) => {
      const el = document.createElement("div");
      el.setAttribute("data-tl-row", "");
      el.getBoundingClientRect = () => rect(this.rows.slice(0, i).reduce((a, b) => a + b, 0) - this.top, this.rows[i]!);
      this.col.append(el);
      this.rowEls.push(el);
    });
    this.layout();
  }
  get clientHeight() { return Math.max(0, this.height - this.composer); }
  get scrollHeight() { return Math.max(this.clientHeight, this.rows.reduce((a, b) => a + b, 0) + this.room); }
  /** Where each row is on screen. */
  get tops() { return this.rowEls.map((el) => el.getBoundingClientRect().top); }
  layout() {
    this.scroller.scrollTop = this.top;
    this.scroller.scrollTo({ top: this.scrollHeight });
    this.anchor = keepRowsUp(this.scroller, this.col, this.anchor, this.room, (px) => (this.room = px));
  }
}

describe("the timeline while 输入优化 opens, is adopted or cancelled", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("an in-flow panel (before): closing it leaves its height as blank room under the rows", () => {
    const p = new Pane();
    p.composer = 120 + 420; // the comparison inside the input card
    p.layout();
    p.composer = 120; // 采用 / 取消: the card shrinks back
    p.layout();
    expect(p.room).toBe(420);
  });

  it("the float (now): the input box keeps its height, so the rows stay put through open, accept and cancel", () => {
    const p = new Pane();
    const before = p.tops;
    for (const _step of ["open", "accept", "open again", "cancel"]) {
      // The layer is absolute: nothing in the input box's flow changes, its height stays 120.
      p.layout();
      expect(p.tops).toEqual(before);
      expect(p.room).toBe(0);
    }
  });
});

const correctionState = () => ({
  phase: "done" as const,
  draftChanged: false,
  target: { start: 0, end: 30, text: "je pense que je pouvais venir", whole: true },
  template: { id: "grammar-learning-v1", kind: "correction" as const, v2: true },
  shown: 0,
  versions: [{
    text: "je pense que je pourrais venir",
    suggestions: [],
    corrections: [{ start: 16, end: 23, original: "pouvais", replacement: "pourrais", category: "grammar" as const, explanation: "reason 0", language: "fr", alternatives: [] }],
    used: { profileId: "p", model: "m", requestedModel: "m", fallbackUsed: false },
    choices: {},
    dropped: 0,
  }],
});

describe("the float and the panel in it", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("the layer sits above the input box, out of its flow, capped, and hidden while empty", () => {
    act(() => root.render(h("div", { className: "relative", "data-input-box": "" }, h(ComposerActionLayer, { layerRef: () => {} }))));
    const layer = host.querySelector<HTMLElement>("[data-composer-action-panel]")!;
    const cls = layer.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["float", "absolute", "bottom-full", "left-0", "right-0", "empty:hidden", "overflow-hidden", "flex-col"]));
    expect(cls).toContain("max-h-[60vh]");
    expect(layer.parentElement!.className).toContain("relative");
  });

  it("its height stops at 60vh and at the room above the input box (never below a floor)", () => {
    expect(layerMaxHeight(700)).toBe("min(60vh, 688px)");
    expect(layerMaxHeight(240)).toBe("min(60vh, 228px)");
    expect(layerMaxHeight(90)).toBe(`min(60vh, ${LAYER_MIN}px)`);
  });

  it("a panel arriving measures the room between the pane's top and the input box", async () => {
    const main = document.createElement("main");
    const box = document.createElement("div");
    main.append(box);
    host.append(main);
    main.getBoundingClientRect = () => ({ top: 40 }) as DOMRect;
    box.getBoundingClientRect = () => ({ top: 400 }) as DOMRect;
    const boxRoot = createRoot(box);
    let layer: HTMLDivElement | null = null;
    act(() => boxRoot.render(h(ComposerActionLayer, { layerRef: (el) => { layer = el; } })));
    expect(layer!.style.maxHeight).toBe("");
    await act(async () => { layer!.append(document.createElement("div")); await Promise.resolve(); });
    expect(layer!.style.maxHeight).toBe(layerMaxHeight(360));
    act(() => boxRoot.unmount());
  });

  it("the panel's title and 采用 / 取消 rows stay put; only the middle scrolls; a reason follows its change on the same line", () => {
    let layer: HTMLDivElement | null = null;
    const onAdopt = vi.fn();
    const onCancel = vi.fn();
    const Probe = () => {
      const panel = h(PromptEnhancePanel, {
        state: correctionState() as never, hostId: "local", templateLabel: "纠错学习", adoptKey: "Enter",
        onAdopt, onCancel, onRetry: () => {}, onShow: () => {}, onAppend: () => {}, onRegroup: null, onChoose: () => {},
      });
      return h("div", { className: "relative" }, h(ComposerActionLayer, { layerRef: (el) => { layer = el; } }), layer ? createPortal(panel, layer) : null);
    };
    act(() => root.render(h(Probe)));
    act(() => root.render(h(Probe))); // the portal target exists from the second render on
    const panel = host.querySelector<HTMLElement>("[data-testid=prompt-enhance-panel]")!;
    expect(panel.parentElement!.hasAttribute("data-composer-action-panel")).toBe(true);
    expect(panel.className).toContain("min-h-0");
    const [head, body, foot] = [...panel.children] as HTMLElement[];
    expect(head!.hasAttribute("data-prompt-enhance-head")).toBe(true);
    expect(head!.className).toContain("shrink-0");
    expect(body!.hasAttribute("data-prompt-enhance-body")).toBe(true);
    expect(body!.className).toEqual(expect.stringContaining("overflow-y-auto"));
    expect(body!.className).toEqual(expect.stringContaining("min-h-0"));
    expect(foot!.hasAttribute("data-prompt-enhance-foot")).toBe(true);
    expect(foot!.className).toContain("shrink-0");
    // 采用 and 取消 are in the fixed row, not in what scrolls.
    expect(foot!.querySelector("[data-testid=prompt-enhance-adopt]")).not.toBeNull();
    expect(body!.querySelector("[data-testid=prompt-enhance-adopt]")).toBeNull();
    // The change list is in the scrolling middle; each reason is inline after 「：」, not a line of its own.
    const item = body!.querySelector<HTMLElement>("[data-testid=input-refinement-corrections] li")!;
    const reason = item.querySelector<HTMLElement>("[data-correction-reason]")!;
    expect(reason.textContent).toBe("reason 0");
    expect(reason.tagName).toBe("SPAN");
    const line = reason.parentElement!;
    expect(line.querySelector("[data-correction-reason-sep]")!.textContent).toBe("input-refinement.reasonSep");
    expect(line.textContent).toContain("pouvais → pourrais");
    expect(line.textContent!.indexOf("pourrais")).toBeLessThan(line.textContent!.indexOf("reason 0"));
    act(() => foot!.querySelector<HTMLElement>("[data-testid=prompt-enhance-adopt]")!.click());
    expect(onAdopt).toHaveBeenCalledTimes(1);
  });
});
