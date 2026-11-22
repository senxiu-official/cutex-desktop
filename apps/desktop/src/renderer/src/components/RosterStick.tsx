// The 花名册's sticky headers (lib/rosterStick; owner 2026-11-18 「我始终能看见所有分区标题」). The real 文件夹 / 系统行
// headers of groups above the view stack at the top edge, those below at the bottom edge, moved by scroll-linked
// animations (a ScrollTimeline of the list, run by the compositor: no script per scroll). The plan is redone only
// when the list's size or contents change. A click on a header while it sits in a stack brings its group into view
// (opening it if folded, through its own toggle) instead of folding it. Groups left out for space (small windows
// only) are behind one 「+N」 row with a menu of them. Without ScrollTimeline (older engine) the headers fall back to
// plain CSS sticky at the top (styles.css; nav[data-stick-js] marks the animated mode).
import { useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import { openMenuAbove } from "../lib/contextMenu";
import { ownerWindowOf, resizeObserverFor } from "../lib/ownerWindow";
import { edgeKeys, hiddenOverflow, moreBottom, moreKeys, nestStickTops, planStack, spanStickHeaders, stuckAt, type EdgeHeader } from "../lib/rosterStick";

/** The height of the 「+N」 row (a header row's height). */
const MORE_HEIGHT = 28;
const MENU_OWNER = "roster-stick-more";

type TimelineCtor = new (options: { source: Element; axis: "block" }) => AnimationTimeline;

const groupsOf = (nav: HTMLElement) => [...nav.querySelectorAll<HTMLElement>(":scope > section[data-stick-group]")];
const headerOf = (section: HTMLElement) => section.querySelector<HTMLElement>(":scope > [data-stick]");
const toggleOf = (section: HTMLElement) => headerOf(section)?.querySelector<HTMLElement>("button[aria-expanded]") ?? null;

/** Scroll so the group starts right under the top stack (`above`: the stack's height above its header). */
function scrollToGroup(nav: HTMLElement, section: HTMLElement, above: number): void {
  const top = section.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop - above;
  const win = ownerWindowOf(nav);
  const reduce = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  nav.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
}

export function RosterStick() {
  const { t } = useI18n();
  const anchor = useRef<HTMLSpanElement>(null);
  const [more, setMore] = useState<{ bottom: number; below: { id: string; label: string }[] } | null>(null);
  const jumpRef = useRef<(id: string) => void>(() => {});
  // The 「+N」 row's element and (re)attaching its scroll-linked slide (lib/rosterStick moreKeys) when it mounts.
  const moreRef = useRef<HTMLDivElement>(null);
  const attachMoreRef = useRef<() => void>(() => {});
  const shows = more !== null;
  useLayoutEffect(() => attachMoreRef.current(), [shows]);

  useLayoutEffect(() => {
    const holder = anchor.current?.parentElement;
    if (!holder) return;
    const win = ownerWindowOf(holder);
    const Timeline = (win as unknown as { ScrollTimeline?: TimelineCtor }).ScrollTimeline;
    const running = new Map<HTMLElement, Animation>();
    // 「+N」: the list's scroll listener while there are left-out groups.
    let unscroll: (() => void) | null = null;
    let raf = 0;
    let bypass = false;
    // The last plan's inputs: the roster re-renders often (rows, counts); the plan is redone only when they change.
    let last = "";
    // Element identity is part of the inputs: a header React mounts anew needs its animation again.
    const ids = new WeakMap<HTMLElement, number>();
    let nextId = 0;
    const idOf = (el: HTMLElement | null) => (el ? (ids.get(el) ?? (ids.set(el, ++nextId), nextId)) : 0);
    // Per group: the top stack's height above its header when it is brought into view (its top slot).
    let aboveOf = new Map<string, number>();
    let markedNav: HTMLElement | null = null;
    const stacked = new Set<HTMLElement>();
    // 「+N」 slides with the titles under it on the same scroll timeline (no script per scroll; owner 2026-11-19).
    let moreSlide: { timeline: AnimationTimeline; keys: { offset: number; y: number }[] } | null = null;
    let moreAnimation: { el: HTMLElement; animation: Animation } | null = null;
    const attachMore = () => {
      const el = moreRef.current;
      if (moreAnimation && (moreAnimation.el !== el || !moreSlide)) {
        moreAnimation.animation.cancel();
        moreAnimation = null;
      }
      if (!el || !moreSlide || moreAnimation) return;
      const animation = el.animate(
        moreSlide.keys.map((k) => ({ transform: `translateY(${k.y}px)`, offset: k.offset })),
        { timeline: moreSlide.timeline, fill: "both", easing: "linear" } as KeyframeAnimationOptions & { timeline: AnimationTimeline },
      );
      moreAnimation = { el, animation };
    };
    attachMoreRef.current = attachMore;
    const navOf = () => holder.querySelector<HTMLElement>('nav[data-sidebar-roster="roster"]');

    const jump = (id: string) => {
      const nav = navOf();
      const section = nav && groupsOf(nav).find((s) => s.dataset.stickGroup === id);
      if (!nav || !section) return;
      const toggle = toggleOf(section);
      // After the click being handled (a nested click() on the same button is ignored while its own click runs).
      queueMicrotask(() => {
        if (toggle?.getAttribute("aria-expanded") === "false") {
          bypass = true;
          try {
            toggle.click();
          } finally {
            bypass = false;
          }
        }
        toggle?.focus({ preventScroll: true });
        win.requestAnimationFrame(() => scrollToGroup(nav, section, aboveOf.get(id) ?? 0));
      });
    };
    jumpRef.current = jump;

    const plan = () => {
      if (raf) win.cancelAnimationFrame(raf);
      raf = 0;
      const nav = navOf();
      if (markedNav && markedNav !== nav) delete markedNav.dataset.stickJs;
      markedNav = Timeline ? nav : null;
      if (nav && Timeline) nav.dataset.stickJs = "";
      const box = nav?.getBoundingClientRect();
      const groups = nav ? groupsOf(nav) : [];
      const headers: (EdgeHeader & { section: HTMLElement })[] = [];
      for (const section of groups) {
        const header = headerOf(section);
        if (!header || !nav || !box) continue;
        headers.push({ id: section.dataset.stickGroup!, system: section.dataset.stickSystem !== undefined, top: Math.round(section.getBoundingClientRect().top - box.top + nav.scrollTop - nav.clientTop), height: header.offsetHeight, section });
      }
      const listHeight = nav?.clientHeight ?? 0;
      const maxScroll = nav ? nav.scrollHeight - nav.clientHeight : 0;
      const stack = planStack(headers, listHeight, MORE_HEIGHT);
      // Nested headers stick under the top stack of their group (cheap; also when the plan below is unchanged).
      if (nav) nestStickTops(nav, Timeline ? (g) => stack.under[g.dataset.stickGroup ?? ""] ?? 0 : undefined);
      // Group titles span the list edge to edge (lib/rosterStick spanStickHeaders).
      if (nav) spanStickHeaders(nav);
      const key = JSON.stringify([headers.map((h) => [h.id, idOf(headerOf(h.section)), h.system, h.top, h.height, h.section.dataset.stickLabel]), listHeight, maxScroll]);
      if (key === last) return;
      last = key;
      for (const a of running.values()) a.cancel();
      running.clear();
      for (const el of stacked) delete el.dataset.stacked;
      stacked.clear();
      unscroll?.();
      unscroll = null;
      moreSlide = null;
      moreAnimation?.animation.cancel();
      moreAnimation = null;
      aboveOf = new Map(headers.map((h) => [h.id, Timeline ? (stack.under[h.id] ?? 0) - (stack.slots.some((x) => x.id === h.id) ? h.height : 0) : 0]));
      if (!nav) return void setMore(null);
      if (Timeline && maxScroll > 0) {
        const timeline = new Timeline({ source: nav, axis: "block" });
        const keys = moreKeys(headers, stack, listHeight, maxScroll);
        if (keys) moreSlide = { timeline, keys };
        // Already shown (a new plan while it is up): its new slide now; a 「+N」 still to mount gets it as it mounts.
        attachMore();
        for (const slot of stack.slots) {
          const h = headers.find((x) => x.id === slot.id)!;
          const header = headerOf(h.section);
          if (!header) continue;
          // A stacking header paints over the headers that only scroll (left out for space).
          header.dataset.stacked = "";
          stacked.add(header);
          const keys = edgeKeys(h, slot, listHeight, maxScroll);
          if (!keys) continue;
          const animation = header.animate(
            keys.map((k) => ({ transform: `translateY(${k.y}px)`, offset: k.offset })),
            { timeline, fill: "both", easing: "linear" } as KeyframeAnimationOptions & { timeline: AnimationTimeline },
          );
          running.set(header, animation);
        }
      }
      if (stack.more === null || !stack.overflow.length) return void setMore(null);
      // 「+N」 is placed in the box, whose padding is below the list (Sidebar data-roster-box): from the list's bottom.
      const pad = Math.max(0, Math.round((holder.getBoundingClientRect().bottom - (box?.bottom ?? 0)) * 100) / 100);
      // 「+N」 lists the left-out groups whose header cannot be seen: out of the list, or covered by either stack
      // (lib/rosterStick hiddenOverflow; review 2026-11-18 — an observer on the whole list counted a header under the
      // top stack as seen). From the plan and the scroll position only: no layout read per scroll, a render only when
      // the list changes.
      const label = (id: string) => groups.find((s) => s.dataset.stickGroup === id)?.dataset.stickLabel ?? id;
      // Unset per plan: its first result is always published, an empty one included (it clears the last plan's row).
      let shown: string | null = null;
      const publish = () => {
        // Without ScrollTimeline nothing stacks (CSS sticky fallback): only the 「+N」 row covers.
        const live = Timeline ? stack : { ...stack, slots: [] };
        const hidden = hiddenOverflow(headers, live, listHeight, MORE_HEIGHT, nav.scrollTop);
        // Its planned slot, on the titles stuck below it; it slides down as they rise (moreSlide, on the compositor).
        const bottom = moreBottom(headers, live, listHeight, -Infinity);
        const key = `${bottom}\n${hidden.join("\n")}`;
        if (key === shown) return;
        shown = key;
        // Kept mounted (hidden) while nothing is listed: its scroll-linked slide keeps running, so it shows at its place
        // the frame it appears (a fresh element's animation applies a frame late; owner 2026-11-19, bottom jitter).
        setMore({ bottom: bottom + pad, below: hidden.map((id) => ({ id, label: label(id) })) });
      };
      publish();
      nav.addEventListener("scroll", publish, { passive: true });
      unscroll = () => nav.removeEventListener("scroll", publish);
    };
    const later = () => (raf ||= win.requestAnimationFrame(plan));
    plan();

    // A click on a header sitting in a stack brings its group into view instead of folding it.
    const click = (e: MouseEvent) => {
      if (bypass) return;
      const target = e.target as HTMLElement | null;
      const toggle = target?.closest<HTMLElement>('[data-stick="edge"] button[aria-expanded]');
      const section = toggle?.closest<HTMLElement>("section[data-stick-group]");
      if (!toggle || !section || !stuckAt(section)) return;
      e.preventDefault();
      e.stopPropagation();
      jump(section.dataset.stickGroup!);
    };
    holder.addEventListener("click", click, { capture: true });
    // A size change is planned before it is painted (no frame with the old keyframes on the new layout).
    const resize = resizeObserverFor(holder, plan);
    const watch = () => {
      const nav = navOf();
      resize?.observe(holder);
      if (nav) for (const s of groupsOf(nav)) resize?.observe(s);
    };
    watch();
    const mutate = new (win as Window & typeof globalThis).MutationObserver(() => {
      watch();
      later();
    });
    mutate.observe(holder, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-folded", "aria-expanded", "data-stick-group"] });
    return () => {
      holder.removeEventListener("click", click, { capture: true });
      resize?.disconnect();
      mutate.disconnect();
      unscroll?.();
      for (const a of running.values()) a.cancel();
      moreAnimation?.animation.cancel();
      attachMoreRef.current = () => {};
      for (const el of stacked) delete el.dataset.stacked;
      if (markedNav) delete markedNav.dataset.stickJs;
      if (raf) win.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      {more && (
        <div ref={moreRef} className="pointer-events-none absolute inset-x-0 z-[4]" style={{ bottom: more.bottom, visibility: more.below.length ? undefined : "hidden" }} aria-hidden={more.below.length ? undefined : true} inert={!more.below.length} data-stick-more="">
          <button
            type="button"
            data-system-row=""
            aria-haspopup="menu"
            onClick={(e) => openMenuAbove(e.currentTarget, more.below.map((g) => ({ label: g.label, onSelect: () => jumpRef.current(g.id) })), { owner: MENU_OWNER })}
            className="pointer-events-auto flex h-7 w-full items-center gap-1.5 bg-[var(--bg)] py-1 pr-3 pl-1 text-left text-caption/[inherit] whitespace-nowrap text-subtle hover:bg-surface-2"
          >
            <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-muted">
              <MoreHorizontal size={14} strokeWidth={2.2} aria-hidden />
            </span>
            <span className="truncate text-ui/[inherit] font-semibold text-muted">{t("sidebar.stickMore", { count: more.below.length })}</span>
            <span className="system-line min-w-2 flex-1" aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}
