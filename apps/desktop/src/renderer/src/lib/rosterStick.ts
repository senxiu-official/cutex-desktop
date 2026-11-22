// Sticky headers of the 花名册 (owner 2026-11-17 / 2026-11-18; docs/GLOSSARY.md 吸附标题).
// 「我始终能看见所有分区标题」: every 文件夹 / 系统行 header stays on screen. The headers of the groups above the view
// stack at the top edge in list order, those below stack at the bottom edge, and the rows of the group you are in
// scroll between them. The real header elements move; nothing is drawn twice.
// - 文件夹 / 系统行 headers: a scroll-linked animation per header (components/RosterStick: Web Animations on the list's
//   ScrollTimeline, run by the compositor; no script per scroll). CSS sticky cannot do it: a header never leaves its
//   own group's box. This file plans it from the list's geometry: which headers stack, their slots, the keyframes.
// - 项目分组 headers inside a group: CSS `position: sticky` (styles.css `[data-stick="project"]`) just under the top
//   stack as it is while you are in that group (--stick-top, nestStickTops).
// Both stacks together never take more than STACK_SHARE of the list; only on a small window does that leave some
// 文件夹 out (系统行 are kept first): those scroll with the list, behind one 「还有 N 个分组」 row in the bottom stack.

/** Both stacks together never take more than this share of the list's height. */
export const STACK_SHARE = 0.6;

/** A 文件夹 / 系统行 header of the 花名册, in list order. Positions are in the list's content (scroll 0). */
export interface EdgeHeader {
  id: string;
  /** 系统行 (未分组, 独立智能体, 工作 / 快速会话, 更早的项目): kept before 文件夹 when not all fit. */
  system: boolean;
  /** Top of its group (= the header's natural top) and the header's height. */
  top: number;
  height: number;
}

export interface StackSlot {
  id: string;
  /** Distance of the header's top edge from the list's top edge while in the top stack. */
  top: number;
  /** Distance of the header's bottom edge from the list's bottom edge while in the bottom stack. */
  bottom: number;
}

export interface StackPlan {
  /** Headers that stack, list order. */
  slots: StackSlot[];
  /** Headers left out for space, list order (behind 「+N」). */
  overflow: string[];
  /** The 「+N」 row's slot in the bottom stack (its bottom edge from the list's bottom), null without overflow. */
  more: number | null;
  /**
   * Per group (every header, kept or not): the height of the top stack while you are inside it — the kept headers
   * above it and its own if kept. Its nested 项目分组 headers stick under that.
   */
  under: Record<string, number>;
}

/**
 * Which headers stack and where. All of them when they fit in STACK_SHARE of `listHeight`; otherwise 系统行 first,
 * then 文件夹 from the top of the list, while they fit with the 「+N」 row (`moreHeight`); the rest go behind 「+N」,
 * which takes the place in the bottom stack of the first one left out.
 */
export function planStack(headers: readonly EdgeHeader[], listHeight: number, moreHeight: number): StackPlan {
  const budget = Math.floor(listHeight * STACK_SHARE);
  const total = headers.reduce((n, h) => n + h.height, 0);
  let keep: Set<string>;
  if (total <= budget) keep = new Set(headers.map((h) => h.id));
  else {
    keep = new Set();
    let used = moreHeight;
    for (const h of [...headers.filter((x) => x.system), ...headers.filter((x) => !x.system)]) {
      if (used + h.height > budget) continue;
      keep.add(h.id);
      used += h.height;
    }
  }
  const overflow = headers.filter((h) => !keep.has(h.id)).map((h) => h.id);
  // Bottom-up: the last header at the very bottom; 「+N」 where the first left-out header would be.
  const order: ({ id: string; height: number } | "more")[] = [];
  let moreAt = false;
  for (const h of headers) {
    if (keep.has(h.id)) order.push(h);
    else if (!moreAt) {
      order.push("more");
      moreAt = true;
    }
  }
  const bottoms = new Map<string, number>();
  let more: number | null = null;
  let bottom = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const o = order[i]!;
    if (o === "more") {
      more = bottom;
      bottom += moreHeight;
    } else {
      bottoms.set(o.id, bottom);
      bottom += o.height;
    }
  }
  // Top-down: each kept header under the kept ones before it.
  const slots: StackSlot[] = [];
  const under: Record<string, number> = {};
  let top = 0;
  for (const h of headers) {
    if (keep.has(h.id)) {
      slots.push({ id: h.id, top, bottom: bottoms.get(h.id)! });
      top += h.height;
    }
    under[h.id] = top;
  }
  return { slots, overflow, more, under };
}

/** One keyframe of a header's edge stick: `offset` of the scroll range (0..1), `y` its shift (px; < 0 up, > 0 down). */
export interface StickKey {
  offset: number;
  y: number;
}

/**
 * The shift of a stacking header as keyframes over the list's scroll range [0, maxScroll]. At scroll s it sits at
 *   the bottom stack while its place is below its bottom slot:  y = s − s1  (s < s1),
 *   its place in between:                                       y = 0,
 *   the top stack once its place has gone above its top slot:   y = s − s2  (s > s2),
 * with s1 = top + height + slot.bottom − listHeight and s2 = top − slot.top. Piecewise linear in s, so linear
 * keyframes at the breakpoints are exact. null = never moves.
 */
export function edgeKeys(header: Pick<EdgeHeader, "top" | "height">, slot: Pick<StackSlot, "top" | "bottom">, listHeight: number, maxScroll: number): StickKey[] | null {
  if (maxScroll <= 0) return null;
  const s1 = header.top + header.height + slot.bottom - listHeight;
  const s2 = Math.max(s1, header.top - slot.top);
  const y = (s: number) => (s < s1 ? s - s1 : s > s2 ? s - s2 : 0);
  const at = [0, maxScroll, ...[s1, s2].filter((s) => s > 0 && s < maxScroll)].sort((a, b) => a - b).filter((s, i, a) => i === 0 || s !== a[i - 1]);
  const keys = at.map((s) => ({ offset: s / maxScroll, y: y(s) }));
  return keys.every((k) => k.y === 0) ? null : keys;
}

/** Where a 花名册 group's header is now: moved to the top stack, to the bottom stack, or in its place. */
export function stuckAt(section: HTMLElement): "top" | "bottom" | null {
  const header = section.querySelector<HTMLElement>(":scope > [data-stick]");
  if (!header) return null;
  const d = header.getBoundingClientRect().top - section.getBoundingClientRect().top;
  return d > 1 ? "top" : d < -1 ? "bottom" : null;
}

/**
 * Where each nested sticky header (项目分组, 更早的项目 inside a folder) sticks at the top: under the top stack as it
 * is while you are in its top-level group (`under`, from planStack; by default just that group's own header), then
 * under the headers of the groups it is nested in, their heights added up per level. Set as --stick-top on the
 * header's own group; a top-level group's is 0 (its header is moved by RosterStick, or CSS-sticks at the edge).
 */
const ownHeader = (g: HTMLElement) => g.querySelector<HTMLElement>(":scope > [data-stick]")?.offsetHeight ?? 0;
export function nestStickTops(nav: HTMLElement, under: (topLevel: HTMLElement) => number = ownHeader): void {
  for (const header of nav.querySelectorAll<HTMLElement>("[data-stick]")) {
    const section = header.parentElement;
    if (!section) continue;
    let top = 0;
    let level: HTMLElement = section;
    for (let up = section.parentElement?.closest<HTMLElement>("section"); up && nav.contains(up); up = up.parentElement?.closest<HTMLElement>("section")) {
      level = up;
      const above = up.querySelector<HTMLElement>(":scope > [data-stick]");
      if (above) top += above.offsetHeight;
    }
    // The outermost group's own header is replaced by the whole top stack while you are in it (`under`).
    if (level !== section) top += under(level) - ownHeader(level);
    const value = `${Math.max(0, top)}px`;
    if (section.style.getPropertyValue("--stick-top") !== value) section.style.setProperty("--stick-top", value);
  }
}

/**
 * Where the 「+N」 row sits at scroll `s` (its bottom edge from the list's bottom; owner 2026-11-19, zero gap): right on
 * the titles below it in the plan that are stuck at the bottom. Its planned slot assumes all of them are; as one rises
 * out of the bottom stack (an open 独立智能体 / 工作 coming into view near the end) 「+N」 slides down by as much as the
 * title has risen, up to its height — the two cross (the title paints over it) and 「+N」 lands on the run still stuck,
 * or the list's bottom. Continuous and piecewise linear in s (owner 2026-11-19, it jumped near the end: placed by the
 * scroll handler a frame behind the titles, in one step), so it runs as keyframes on the list's scroll timeline
 * (moreKeys) like the titles. 0 when nothing stacks.
 */
export function moreBottom(headers: readonly EdgeHeader[], plan: StackPlan, listHeight: number, s: number): number {
  if (plan.more === null) return 0;
  let bottom = 0;
  for (const slot of plan.slots) {
    if (slot.bottom >= plan.more) continue;
    const h = headers.find((x) => x.id === slot.id);
    if (!h) continue;
    const s1 = h.top + h.height + slot.bottom - listHeight;
    bottom += h.height - Math.min(h.height, Math.max(0, s - s1));
  }
  return bottom;
}

/** moreBottom as keyframes over the scroll range: the 「+N」 row's shift from its planned slot (> 0 down). null = never moves. */
export function moreKeys(headers: readonly EdgeHeader[], plan: StackPlan, listHeight: number, maxScroll: number): StickKey[] | null {
  if (plan.more === null || maxScroll <= 0) return null;
  const at = new Set([0, maxScroll]);
  for (const slot of plan.slots) {
    if (slot.bottom >= plan.more) continue;
    const h = headers.find((x) => x.id === slot.id);
    if (!h) continue;
    const s1 = h.top + h.height + slot.bottom - listHeight;
    for (const b of [s1, s1 + h.height]) if (b > 0 && b < maxScroll) at.add(b);
  }
  const planned = moreBottom(headers, plan, listHeight, -Infinity);
  const keys = [...at].sort((a, b) => a - b).map((s) => ({ offset: s / maxScroll, y: planned - moreBottom(headers, plan, listHeight, s) }));
  return keys.every((k) => k.y === 0) ? null : keys;
}

/**
 * Every group title spans the list edge to edge (owner 2026-11-19 「这个黑块有缝隙」): each header's distance to the
 * list's content box edges, as `--stick-left` / `--stick-right`, which its background extension (styles.css
 * [data-stick]::before) reaches out by — whatever its indent. Read when the plan is redone (the list's size or
 * contents changed), never per scroll; written only when it changed.
 */
export function spanStickHeaders(nav: HTMLElement): void {
  // The list's inner edges, fractional (cross-review 2026-11-19): clientWidth / clientLeft are whole pixels, so a list
  // 254.4px wide stopped the band 0.4px short on a see-through card. The box minus its borders and its scrollbar
  // (whole pixels: offsetWidth - clientWidth - the rounded borders) is exact.
  const box = nav.getBoundingClientRect();
  const style = nav.ownerDocument.defaultView?.getComputedStyle(nav);
  const border = (side: "Left" | "Right") => parseFloat(style?.[`border${side}Width`] ?? "") || 0;
  const scrollbar = Math.max(0, nav.offsetWidth - nav.clientWidth - Math.round(border("Left")) - Math.round(border("Right")));
  const left = box.left + border("Left");
  const right = box.right - border("Right") - scrollbar;
  for (const header of nav.querySelectorAll<HTMLElement>("[data-stick]")) {
    const r = header.getBoundingClientRect();
    for (const [name, px] of [["--stick-left", r.left - left], ["--stick-right", right - r.right]] as const) {
      // Rounded outward: never short of the edge (the list clips the overshoot: styles.css overflow-x hidden).
      // (Less a hair of float noise: 263.6 - 257.6 is 6.000000000000014, not a hundredth more.)
      const value = `${Math.max(0, Math.ceil(px * 100 - 1e-6) / 100)}px`;
      if (header.style.getPropertyValue(name) !== value) header.style.setProperty(name, value);
    }
  }
}

/**
 * The left-out (overflow) groups whose header cannot be seen at scroll `s` (review 2026-11-18): out of the list, or
 * covered by either stack — the headers stacked at the top or the bottom right now, and the 「+N」 row. A left-out
 * header only scrolls, under the stacks; it counts as seen while its middle is in the clear band between them. From
 * the plan alone (no layout read), so it can run on every scroll.
 */
export function hiddenOverflow(headers: readonly EdgeHeader[], plan: StackPlan, listHeight: number, moreHeight: number, s: number): string[] {
  if (!plan.overflow.length) return [];
  let topCover = 0;
  let bottomCover = plan.more === null ? 0 : moreBottom(headers, plan, listHeight, s) + moreHeight;
  for (const slot of plan.slots) {
    const h = headers.find((x) => x.id === slot.id);
    if (!h) continue;
    if (s > h.top - slot.top) topCover = Math.max(topCover, slot.top + h.height);
    if (s < h.top + h.height + slot.bottom - listHeight) bottomCover = Math.max(bottomCover, slot.bottom + h.height);
  }
  return plan.overflow.filter((id) => {
    const h = headers.find((x) => x.id === id);
    if (!h) return true;
    const middle = h.top - s + h.height / 2;
    return middle < topCover || middle > listHeight - bottomCover;
  });
}
