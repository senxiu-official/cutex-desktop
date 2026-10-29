// One set of motion rules (owner 2026-10-22, checklist #24, docs/design/021-motion.md): three durations and one
// curve, the same in CSS (motion.css) and JS (lib/motion); every shell transition / animation uses the tokens —
// literal durations only for loops, countdowns and signals listed here; reduced motion zeroes the tokens; the first
// paint and the JS motions wait for `motionReady`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EASE_STANDARD, MOTION, motionAllowed, motionMs, setMotionReady } from "../src/renderer/src/lib/motion";
import { SHELF_MOTION_MS } from "../src/renderer/src/lib/shelfMotion";

const SRC = join(__dirname, "../src/renderer/src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

afterEach(() => setMotionReady(true));

describe("motion tokens", () => {
  it("CSS and JS name the same three durations and the one curve; reduced motion zeroes them", () => {
    const css = read("motion.css");
    const root = css.slice(0, css.indexOf("@media"));
    expect(root).toContain(`--motion-short: ${MOTION.short}ms;`);
    expect(root).toContain(`--motion-medium: ${MOTION.medium}ms;`);
    expect(root).toContain(`--motion-long: ${MOTION.long}ms;`);
    expect(root).toContain(`--ease-standard: ${EASE_STANDARD};`);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const t of ["short", "medium", "long"]) expect(reduced).toContain(`--motion-${t}: 0ms;`);
    expect(css).toContain(":root[data-motion-hold] *");
  });

  it("the Shelf's box, the row's slide and the chip's flight use the tokens", () => {
    expect(SHELF_MOTION_MS).toBe(MOTION.medium);
    expect(read("lib/columnGlide.ts")).toContain("EASE_STANDARD");
    expect(read("lib/paneFly.ts")).toMatch(/DURATION = MOTION\.long/);
  });

  it("nothing animates before the first paint has settled", () => {
    setMotionReady(false);
    expect(motionAllowed()).toBe(false);
    expect(motionMs("medium")).toBe(0);
    setMotionReady(true);
    expect(motionMs("medium")).toBe(MOTION.medium);
  });

  it("shell CSS has no ad-hoc transition / animation durations (loops, countdowns and signals excepted)", () => {
    // Loops and timed signals are not transitions between layouts: they keep their own timing.
    // fx-flash: the 文件 explorer's 在文件树中显示 signal (docs/design/019), like side-flash.
    const allowed = [/text-shimmer/, /agent-ring-spin/, /agent-ring-tile-pulse/, /side-ping/, /side-flash/, /fx-flash/, /fullscreen-hint/, /armed-countdown/, /armed-seconds/, /tray-breathe/, /THUMB\./, /linear 0s/, /scroll-edge-fade/, /pending-status-in var\(--motion-short\) var\(--ease-standard\) 400ms/];
    const files = ["styles.css", "components/tray.css", "components/foretell.css", "components/strips.css", "components/side/shelfCard.css"];
    const bad: string[] = [];
    for (const f of files) {
      const lines = read(f).split("\n");
      lines.forEach((line, i) => {
        if (!/(transition|animation)/.test(line) && !/^\s+[a-z-]+ [0-9.]+m?s/.test(line)) return;
        if (!/\b[0-9.]+m?s\b/.test(line) || /\b0s\b/.test(line) || /: none/.test(line)) return;
        if (allowed.some((r) => r.test(line))) return;
        // The overlay scrollbar's own constants (lib/overlayScrollbarManager THUMB) are its own.
        if (f === "styles.css" && /osb|0\.12s|0\.1s/.test(line)) return;
        bad.push(`${f}:${i + 1} ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
