// @vitest-environment jsdom
// The selection bar of the Shelf's page icons (owner 2026-10-25; until 2026-10-28 also the sidebar's rail): switching shrank the
// old bar to a dot that flashed before it went — a height transition to 0 on a rounded 3 px bar. Now one always
// mounted mark (components/SelectionMark) that never has a zero height: off is instant, on is instant too (owner
// 2026-10-26: fading in from the short height still read as a flashing dot), on ⇄ dim moves between two heights;
// reduced motion has no transition.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SelectionMark, type SelectionLevel } from "../src/renderer/src/components/SelectionMark";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SelectionMark", () => {
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
  const render = (level: SelectionLevel) => act(() => root.render(h(SelectionMark, { level, className: "-left-1 rounded-r-full", on: "h-6 bg-foreground", dim: "h-3 bg-muted" })));
  const mark = () => host.querySelector<HTMLElement>("[data-selection-mark]")!;
  const classes = () => mark().className.split(/\s+/);

  it("stays mounted across on → off → dim → on (the same element), never with a zero height", () => {
    render("on");
    const first = mark();
    for (const level of ["off", "dim", "on", "off"] as const) {
      render(level);
      expect(mark()).toBe(first);
      expect(mark().dataset.selectionMark).toBe(level);
      expect(classes()).not.toContain("h-0");
      expect(classes().some((c) => /^h-\d/.test(c))).toBe(true);
    }
  });

  it("off and on are instant (the bar switches in one frame, no fade / grow from a dot); on ⇄ dim moves its height; reduced motion: none", () => {
    render("off");
    expect(classes()).toEqual(expect.arrayContaining(["opacity-0", "transition-none", "h-3"]));
    // Owner 2026-10-26: turning on from off has no transition (a faint short bar growing read as a flashing dot).
    render("on");
    expect(classes()).toEqual(expect.arrayContaining(["opacity-100", "h-6", "transition-none"]));
    expect(classes().some((c) => c.startsWith("transition-["))).toBe(false);
    // Once on, on ⇄ dim moves between the two heights with the short motion.
    render("dim");
    expect(classes()).toEqual(expect.arrayContaining(["h-3", "bg-muted", "opacity-100", "transition-[height,background-color]", "motion-reduce:transition-none"]));
    expect(classes()).not.toContain("transition-none");
    render("on");
    expect(classes()).toEqual(expect.arrayContaining(["h-6", "transition-[height,background-color]"]));
    // Off → dim is instant too; nothing ever transitions opacity.
    render("off");
    render("dim");
    expect(classes()).toContain("transition-none");
    expect(mark().className).not.toMatch(/transition-\[[^\]]*opacity/);
  });

  it("a Shelf-style switch: the old icon's bar goes and the new one is full height in the same commit", () => {
    const two = (active: 0 | 1) =>
      act(() => root.render(h("div", null, ...[0, 1].map((i) => h(SelectionMark, { key: i, level: i === active ? "on" : "off", className: "-right-[3px] rounded-full", on: "h-4 bg-foreground", dim: "h-2 bg-foreground" })))));
    two(0);
    const [a, b] = [...host.querySelectorAll<HTMLElement>("[data-selection-mark]")] as [HTMLElement, HTMLElement];
    two(1);
    expect([...host.querySelectorAll("[data-selection-mark]")]).toEqual([a, b]);
    expect(a.className).toContain("opacity-0");
    expect(a.className).toContain("transition-none");
    expect(b.className).toMatch(/(^|\s)h-4(\s|$)/);
    expect(b.className).toContain("opacity-100");
    expect(b.className).toContain("transition-none");
  });
});

describe("the rails use it", () => {
  const source = (path: string) => readFileSync(join(__dirname, "../src/renderer/src/components", path), "utf8");
  it("Shelf page icons draw their bar with SelectionMark, none animates a height to 0", () => {
    for (const path of ["side/ShelfRail.tsx"]) {
      const text = source(path);
      expect(text).toContain("<SelectionMark");
      expect(text).not.toMatch(/transition-\[height\][^`"]*w-\[3px\]|w-\[3px\][^`"]*transition-\[height\]/);
    }
  });
});
