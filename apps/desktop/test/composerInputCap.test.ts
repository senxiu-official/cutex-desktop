// @vitest-environment jsdom
// The composer's input cap (lib/shortPane composerInputMax, owner 2026-10-27): in a short pane a long draft no longer
// squeezes the history to nothing — the input grows only while the history keeps max(120 px, 30 % of the pane), keeps
// at least 3 lines, then scrolls inside itself. The CSS takes min(15rem, cap): a tall pane is exactly as before.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { composerInputMax, historyMin, INPUT_MIN_LINES, measureComposerInput } from "../src/renderer/src/lib/shortPane";

const ROOT = resolve(__dirname, "../src/renderer/src");
const src = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** 3 lines of 21 px + py-1. */
const FLOOR = 71;
const TALL_MAX = 240; // 15rem: the input's own max-h

describe("composerInputMax", () => {
  it("lets the input take what the history has above its minimum", () => {
    // 900×520 (pane 349, min 120): empty input 50, history 117 under its minimum already → the floor.
    expect(composerInputMax(349, 117, { input: 50, floor: FLOOR })).toBe(FLOOR);
    // Room above the minimum: input + (history − min).
    expect(composerInputMax(349, 200, { input: 50, floor: FLOOR })).toBe(130);
    // A long draft at the cap: the history at its minimum, the cap unchanged (a fixed point — no flapping).
    expect(composerInputMax(349, 120, { input: 130, floor: FLOOR })).toBe(130);
  });
  it("never goes under the floor (900×400: the pane is too short for both, the history gives way)", () => {
    expect(composerInputMax(229, 0, { input: 50, floor: FLOOR })).toBe(FLOOR);
    // A draft from before the cap was known (restored, 240 px, history 0): down to what leaves the history its minimum.
    // History measures 0 (not negative) while the pane overflows: one pass at a time down to the floor.
    expect(composerInputMax(229, 0, { input: 240, floor: FLOOR })).toBe(120);
    expect(composerInputMax(229, 0, { input: 120, floor: FLOOR })).toBe(FLOOR);
    expect(composerInputMax(229, 7, { input: FLOOR, floor: FLOOR })).toBe(FLOOR);
  });
  it("is above 15rem in a tall pane (1440×960), so min(15rem, cap) is today's max-h-60", () => {
    expect(historyMin(789)).toBe(237);
    expect(composerInputMax(789, 398, { input: 240, floor: FLOOR })).toBeGreaterThan(TALL_MAX);
    expect(composerInputMax(789, 533, { input: 50, floor: FLOOR })).toBeGreaterThan(TALL_MAX);
  });
  it("typing a long draft (the layout gives input + history a fixed sum): the history never goes under its minimum", () => {
    for (const [pane, sum] of [[349, 50 + 200], [500, 50 + 300], [789, 50 + 533]] as const) {
      let input = 50;
      let cap = composerInputMax(pane, sum - input, { input, floor: FLOOR });
      for (let lines = 2; lines <= 60; lines++) {
        const natural = lines * 21 + 8;
        input = Math.min(TALL_MAX, cap, natural);
        const history = sum - input;
        expect(history).toBeGreaterThanOrEqual(historyMin(pane));
        cap = composerInputMax(pane, history, { input, floor: FLOOR }); // the observer's next pass
      }
      // At rest the input scrolls inside itself: it never took more than the room above the minimum.
      expect(input).toBe(Math.min(TALL_MAX, sum - historyMin(pane)));
    }
  });
});

describe("measureComposerInput", () => {
  const pane = (shown: boolean) => {
    const main = document.createElement("main");
    const block = document.createElement("div");
    block.setAttribute("data-composer-block", "");
    const input = document.createElement("textarea");
    input.setAttribute("data-composer-input", "");
    input.style.lineHeight = "21px";
    input.style.paddingTop = "4px";
    input.style.paddingBottom = "4px";
    block.append(input);
    main.append(block);
    document.body.append(main);
    Object.defineProperty(input, "offsetParent", { configurable: true, value: shown ? block : null });
    Object.defineProperty(input, "offsetHeight", { configurable: true, value: 240 });
    return main;
  };
  it("reads the input's height and its 3-line floor (line height × 3 + padding)", () => {
    expect(INPUT_MIN_LINES).toBe(3);
    expect(measureComposerInput(pane(true))).toEqual({ input: 240, floor: FLOOR });
  });
  it("no input shown (archived, an interaction waiting): nothing to cap", () => {
    expect(measureComposerInput(pane(false))).toBeNull();
    expect(measureComposerInput(document.createElement("main"))).toBeNull();
  });
});

describe("wiring", () => {
  it("both composer inputs (textarea and the @-mention input) take min(15rem, the pane's cap)", () => {
    const composer = src("components/Composer.tsx");
    expect(composer.match(/max-h-\[min\(15rem,var\(--composer-input-max,15rem\)\)\]/g)).toHaveLength(2);
    expect(composer).not.toMatch(/data-composer-input[\s\S]{0,1200}?className="max-h-60/);
  });
  it("Conversation sets --composer-input-max on the pane in the short-pane pass, after the fold", () => {
    const conv = src("components/Conversation.tsx");
    const fit = conv.slice(conv.indexOf("const fitShortPane"), conv.indexOf("useEffect(", conv.indexOf("const fitShortPane")));
    expect(fit).toMatch(/shortPaneFold\(m\)[\s\S]*measureComposerInput\(main\)[\s\S]*setProperty\("--composer-input-max"/);
    // …and again when only the composer block resized (an overflowing pane: the history stays 0 px).
    expect(conv).toMatch(/querySelector\("\[data-composer-block\]"\)[\s\S]{0,200}fitComposerInput\(pane, scroller\.current\)[\s\S]{0,80}capRo\.observe\(block\)/);
  });
});
