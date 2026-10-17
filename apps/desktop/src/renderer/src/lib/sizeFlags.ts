// Element-size flags measured with a ResizeObserver: the renderer's replacement for CSS size
// containers (`@container`, `container-type`, `container: … / size`, Tailwind `@container` with
// `@md:` / `@max-[…]:` / `@[…]:` variants, `cqw` / `cqh` units).
//
// Why: Chromium (headless Chrome 151 and the packaged app on Windows) can leave the children of a size
// container without layout boxes after one React commit changes several containers at once — the
// settings cards became empty 10 px bars right after a cutex update while their DOM was complete
// (desktop 0.1.2; fixed in f1c9a1f9; switching container-type off was the only change that helped).
// So no renderer element is a size container (guard: test/settingsCard.test.tsx). Instead:
//
//   const [ref, flags] = useSizeFlags(FLAGS);          // FLAGS: a module-level { name: test }
//   <div ref={ref} {...dataFlags(flags)} className="group/x"> … group-data-[name]/x:… </div>
//
// `units: true` also sets `--cqw` / `--cqh` (1 % of the content box, in px) on the element, so CSS
// writes `calc(4 * var(--cqw, 1vw))` where it wrote `4cqw`. A flag only re-renders when it flips.
import { useCallback, useMemo, useState } from "react";

/** An element's content box (what container queries and `cqw` / `cqh` measure), in px. */
export interface Box {
  width: number;
  height: number;
}

/** One flag: true for this content box (`rem` = the root font size in px). */
export type SizeTest = (box: Box, rem: number) => boolean;

/** Root font size in px (16 when unknown). */
export function remPx(): number {
  const size = typeof document === "undefined" ? NaN : parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/** `width < rem` — Tailwind `@max-[Nrem]:`. */
export const widthBelow = (rem: number): SizeTest => (box, r) => box.width < rem * r;
/** `width >= rem` — Tailwind `@[Nrem]:` / `@md:` (28rem) / `@lg:` (32rem). */
export const widthAtLeast = (rem: number): SizeTest => (box, r) => box.width >= rem * r;

/** The content box of `el` from its client size minus padding. */
export function contentBox(el: HTMLElement): Box {
  const style = getComputedStyle(el);
  const px = (v: string) => parseFloat(v) || 0;
  return {
    width: el.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    height: el.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
  };
}

/** The names of the tests that hold for `box`, space separated (stable order). */
export function sizeFlagKey(tests: Readonly<Record<string, SizeTest>>, box: Box, rem = remPx()): string {
  return Object.keys(tests)
    .filter((name) => tests[name]!(box, rem))
    .join(" ");
}

/** `data-<name>=""` for every set flag (spread onto the measured element). */
export function dataFlags(flags: Readonly<Record<string, boolean>>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, on] of Object.entries(flags)) out[`data-${name}`] = on ? "" : undefined;
  return out;
}

/**
 * Measures the element given to the returned callback ref and returns which `tests` hold for its
 * content box. Before the first measurement (and while the element is not laid out: 0 × 0, e.g. a
 * hidden tab) every flag keeps its last value, initially false. The first measurement happens in
 * the commit that attaches the element, so the right layout is there before the first paint.
 * `tests` should be a module-level constant (a new object re-attaches the observer).
 */
export function useSizeFlags<K extends string>(
  tests: Readonly<Record<K, SizeTest>>,
  options: { units?: boolean } = {},
): [ref: (el: HTMLElement | null) => (() => void) | undefined, flags: Record<K, boolean>] {
  const [key, setKey] = useState("");
  const units = !!options.units;
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return undefined;
      const apply = (box: Box) => {
        if (box.width <= 0 && box.height <= 0) return;
        if (units) {
          el.style.setProperty("--cqw", `${box.width / 100}px`);
          el.style.setProperty("--cqh", `${box.height / 100}px`);
        }
        setKey(sizeFlagKey(tests, box));
      };
      apply(contentBox(el));
      if (typeof ResizeObserver === "undefined") return undefined;
      const ro = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) apply({ width: entry.contentRect.width, height: entry.contentRect.height });
      });
      ro.observe(el);
      return () => ro.disconnect();
    },
    [tests, units],
  );
  const flags = useMemo(() => {
    const on = new Set(key.split(" "));
    return Object.fromEntries(Object.keys(tests).map((name) => [name, on.has(name)])) as Record<K, boolean>;
  }, [key, tests]);
  return [ref, flags];
}
