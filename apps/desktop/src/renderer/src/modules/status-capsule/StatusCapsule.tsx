// Portions adapted from ZCode packages/ui/src/v4/ConversationStatusPanel.tsx
// (https://github.com/zai-org/ZCode), Copyright 2026 Z.AI Co., Ltd, licensed under the Apache
// License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0); see /NOTICE.
// Modified for Cutex desktop: rewritten over our slot / module contract and styling.
//
// Floating status capsule — ported from ZCode's ConversationStatusPanel (refs/zcode/packages/ui/src/v4)
// in our own styling. It shows the `conversation.status` items (docs/desktop-modules.md §3.2) placed
// in the capsule that are present, in slot order; the shell owns order, placement, folding, geometry,
// Ctrl+. and "empty → hidden", the items own their lines, headers and bodies. One shell with two
// states, both in the same corner (lib/capsuleLayout: a corner, against the window edge or the text
// column's); the open panel grows away from that corner, so toggling never moves the capsule (no
// animation: an animated swap flickered).
// - collapsed: one line per present item, stacked in one capsule (a single line = a pill). A line
//   opens the panel at its section.
// - open: no panel title — the first section's header is the top line, with … (position / size /
//   which items show here) and collapse in the corner. A header folds its section (chevron on hover;
//   remembered as item ids); a folded header shows the item's line, quietly. Esc collapses; Ctrl+.
//   toggles.
// Geometry: the collapsed lines and the open panel's headers share their inset (13px from the left
// edge, first line centred 17px from the top), so a collapsed line's icon and the open section's
// title sit on the same line. It floats over the timeline (absolute, pointer-transparent around it),
// so it never moves content.
// Quiet pass (owner 2026-10-14): the open panel is one surface (soft shadow, the quiet card edge, 12px
// radius), its kinds separated by space and a small muted label instead of borders; a kind whose
// Body has a single item row (lib/capsuleRows `data-capsule-row`, nothing else) shows that row inline
// after its label, without a heading. Rows share lib/capsuleRows. The panel and the collapsed
// capsule fade / scale in (120ms, none under reduced motion).
// v1.2 (docs/desktop-modules.md §16): module `status-capsule`, mounted by the conversation as a
// `conversation.overlay` item; it shows the items whose *effective* placement includes the capsule
// and reserves the column inset itself. Turning the module off unmounts it: Ctrl+., the view
// registration and the reserved space go with it; the prefs (corner, size, folds) stay.
// Compact (UI review 2026-10-15 #1): while the reading column is narrower than COMPACT_COLUMN, a side
// column is open, or (at the window edge) the full capsule would reach into the column's text, the collapsed capsule is one pill (the first line + 「+N」); clicking it opens the panel
// as a popover (transient: Esc / a click outside closes it, it reserves nothing), and a panel left open
// from a wide window does not reopen by itself. The conversation measures what stays floating and pads
// the column by that band (components/Conversation `useReservedBands`), so the capsule never hides the
// first / last message.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, ListChecks, Minimize2, MoreHorizontal } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { CAPSULE_CORNERS, isLeft, isTop } from "../../lib/capsuleLayout";
import { getUiPrefs, setUiPref, useUiPrefs, type UiPrefs } from "../../lib/prefs";
import { setAppearance, useAppearance } from "../../lib/appearance";
import { capsuleToggle, inCapsule, shownOn, type PlacedStatus } from "../../lib/statusItems";
import { setStatusPlace, useStatusItems } from "../../lib/statusItemsView";
import { ItemBoundary } from "../Outlet";
import type { OverlayLayout, StatusLine } from "../slots";
import { capsuleSectionId, registerCapsuleView, revealInCapsule, toggleCapsuleFolded } from "./capsuleState";

const FLASH_MS = 1600;
/** Below this text-column width (px) the capsule is a single pill. */
export const COMPACT_COLUMN = 720;

/** The collapsed capsule's widest box (`max-w-80`), before the size zoom. */
const CAPSULE_MAX = 320;

/**
 * Whether the capsule should be compact: the column (`[data-timeline-root]` content box) is narrow, a
 * side column is open, or — at the window edge — the full capsule would reach into the column's text.
 */
function useCompact(frame: HTMLDivElement | null, edge: "window" | "content", left: boolean): boolean {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const main = frame?.closest("main");
    if (!frame || !main) return;
    const measure = () => {
      const root = main.querySelector<HTMLElement>("[data-timeline-root]");
      let narrow = false;
      if (root) {
        const cs = getComputedStyle(root);
        const r = root.getBoundingClientRect();
        const colLeft = r.left + parseFloat(cs.paddingLeft);
        const colRight = r.right - parseFloat(cs.paddingRight);
        narrow = colRight - colLeft < COMPACT_COLUMN;
        if (!narrow && edge === "window") {
          const f = frame.getBoundingClientRect();
          const zoom = parseFloat(getComputedStyle(frame).getPropertyValue("--capsule-scale")) || 1;
          const width = CAPSULE_MAX * zoom;
          narrow = left ? f.left + width > colLeft : f.right - width < colRight;
        }
      }
      const side = [...document.querySelectorAll<HTMLElement>("[data-side-column]")].some((el) => el.getBoundingClientRect().width > 0);
      setCompact(narrow || side);
    };
    measure();
    // The column narrows when the window or the side area changes size: both resize the frame.
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [frame, edge, left]);
  return compact;
}
/** The … menu's size presets (percent); Settings → 外观 sets any value in RANGES.capsuleScale. */
const CAPSULE_PRESETS = [["small", 90], ["medium", 100], ["large", 135], ["xlarge", 175]] as const;

/**
 * Whether a Body renders exactly one item row and nothing else (lib/capsuleRows markers), re-checked
 * when the Body's DOM changes (the modules update their Bodies on their own).
 */
function useSingleRow(el: HTMLDivElement | null): boolean {
  const [single, setSingle] = useState(false);
  useLayoutEffect(() => {
    if (!el) return setSingle(false);
    const check = () => setSingle(el.querySelectorAll("[data-capsule-row]").length === 1 && el.querySelectorAll("[data-capsule-line]").length === 0);
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [el]);
  return single;
}

const LABEL = "shrink-0 text-[11px] font-medium text-subtle";

/**
 * A panel section: a small muted label (fold toggle, chevron on hover / focus) · when folded, the
 * item's collapsed line · meta (fixed position). With a single item row the heading goes and the label
 * sits beside that row (label · row · meta on one line; nothing to fold). The Body keeps its place in
 * the tree either way, so its state survives the switch.
 */
function Section({ id, first, folded, title, meta, summary, children }: { id: string; first: boolean; folded: boolean; title: string; meta?: ReactNode; summary?: ReactNode; children: ReactNode }) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const single = useSingleRow(folded ? null : body);
  const metaBox = meta && <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-subtle tabular-nums">{meta}</div>;
  // The first section clears the corner controls (… and collapse).
  const inset = `pl-2 ${first ? "pr-14" : "pr-2"}`;
  return (
    <section className={first ? "" : single ? "mt-1" : "mt-2"} data-capsule-single={single ? "" : undefined}>
      {!single && (
        <div className={`flex h-7 min-w-0 items-center gap-1.5 ${inset}`}>
          <button id={capsuleSectionId(id)} onClick={() => toggleCapsuleFolded(id)} aria-expanded={!folded} className={`group flex items-center gap-0.5 rounded hover:text-foreground focus-visible:text-foreground ${LABEL}`}>
            {title}
            {folded ? (
              <ChevronRight size={12} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            ) : (
              <ChevronDown size={12} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            )}
          </button>
          {folded && summary ? <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-subtle">{summary}</div> : <span className="flex-1" />}
          {metaBox}
        </div>
      )}
      {!folded && (
        <div className={single ? `flex min-w-0 items-center gap-1 ${inset}` : ""}>
          {single && (
            <span id={capsuleSectionId(id)} tabIndex={-1} className={`${LABEL} w-[3.75rem] truncate`} title={title}>
              {title}
            </span>
          )}
          <div ref={setBody} className={single ? "-ml-2 min-w-0 flex-1" : ""}>
            {children}
          </div>
          {single && metaBox}
        </div>
      )}
    </section>
  );
}

const ICON_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground";
const CHOICE = "h-7 rounded-md px-2 text-xs";
const choice = (on: boolean) => `${CHOICE} ${on ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground"}`;

/** The panel's … menu: corner, edge (Settings → 状态显示), size (Settings → 状态显示 → 胶囊外观) and which items show here. */
function PlacementMenu({ items, onClose }: { items: readonly PlacedStatus[]; onClose(): void }) {
  const { t } = useI18n();
  const { capsuleCorner, capsuleEdge } = useUiPrefs();
  const { capsuleScale } = useAppearance();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-capsule-more]")) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);
  const set = <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => setUiPref(key, value);
  const label = "px-1 pt-1 pb-0.5 text-[11px] text-subtle";
  return (
    <div ref={root} role="menu" className="absolute top-8 right-1 z-20 w-52 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
      <div className={label}>{t("status-capsule.corner")}</div>
      <div className="grid grid-cols-2 gap-0.5">
        {CAPSULE_CORNERS.map((c) => (
          <button key={c} className={choice(capsuleCorner === c)} onClick={() => set("capsuleCorner", c)}>
            {t(`status-capsule.corner.${c}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className={label}>{t("status-capsule.edge")}</div>
      <div className="grid grid-cols-2 gap-0.5">
        {(["window", "content"] as const).map((e) => (
          <button key={e} className={choice(capsuleEdge === e)} onClick={() => set("capsuleEdge", e)}>
            {t(`status-capsule.edge.${e}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className={label}>{t("status-capsule.size")}</div>
      <div className="grid grid-cols-4 gap-0.5">
        {CAPSULE_PRESETS.map(([s, scale]) => (
          <button key={s} className={choice(capsuleScale === scale)} onClick={() => setAppearance({ capsuleScale: scale })}>
            {t(`status-capsule.size.${s}` as MessageKey)}
          </button>
        ))}
      </div>
      {items.length > 0 && (
        <>
          <div className={label}>{t("status-capsule.items")}</div>
          {items.map((p) => {
            const on = inCapsule(p.place);
            return (
              <button
                key={p.item.id}
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => setStatusPlace(p.item, capsuleToggle(p.place))}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <span className="flex w-3.5 shrink-0 justify-center">{on && <Check size={13} className="text-accent" />}</span>
                <span className="min-w-0 truncate">{t(p.item.titleKey)}</span>
              </button>
            );
          })}
        </>
      )}
      <div className="mt-1.5 border-t border-border px-1 pt-1.5 text-[11px] text-subtle">{t("status-capsule.shortcut")}</div>
    </div>
  );
}

interface Present {
  placed: PlacedStatus;
  data: unknown;
  line: StatusLine;
  pulse: number;
}

/** The pointer-transparent area spanning the timeline; the capsule sits in its corner. */
function Frame({ children, frameRef }: { children: ReactNode; frameRef?: (el: HTMLDivElement | null) => void }) {
  const { capsuleCorner: corner, capsuleEdge: edge } = useUiPrefs();
  return (
    <div
      ref={frameRef}
      className={`pointer-events-none absolute top-2 bottom-2 z-20 flex flex-col ${isLeft(corner) ? "items-start" : "items-end"} ${isTop(corner) ? "justify-start" : "justify-end"} ${edge === "window" ? "inset-x-3" : "side-col inset-x-0 w-full px-6"}`}
    >
      {children}
    </div>
  );
}

/**
 * The capsule for one set of items. Calls each item's `useStatus` in order, so the parent keys it by
 * the item set (a placement change remounts it; hooks never change order).
 */
function CapsuleView({ sessionId, items, all, menu, setMenu, canToggle, compactRef, armed, setArmed }: { sessionId: string; items: readonly PlacedStatus[]; all: readonly PlacedStatus[]; menu: boolean; setMenu(v: boolean): void; canToggle: MutableRefObject<boolean>; compactRef: MutableRefObject<boolean>; /** Compact: the panel was opened while compact (else a saved open state shows the pill). */ armed: boolean; setArmed(v: boolean): void }) {
  const { t } = useI18n();
  const { capsuleCorner: corner, capsuleEdge, capsuleOpen, capsuleAlways, capsuleFoldedItems: folded } = useUiPrefs();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const compact = useCompact(frame, capsuleEdge, isLeft(corner));
  compactRef.current = compact;
  const present: Present[] = [];
  for (const placed of items) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed order per item set (component keyed by it)
    const status = placed.item.useStatus(sessionId);
    if (status) present.push({ placed, data: status.data, line: status.line, pulse: status.pulse ?? 0 });
  }
  const hasContent = present.length > 0;
  canToggle.current = hasContent;
  // The panel stays open until collapsed (owner: no auto-collapse), so it is not an overlay — except
  // while compact, where it is a popover opened from the pill (or by reveal / Ctrl+.).
  const open = capsuleOpen && hasContent && (!compact || armed);
  const setOpen = (v: boolean) => {
    setMenu(false);
    setArmed(v);
    setUiPref("capsuleOpen", v);
  };
  // Compact popover: a click outside closes it.
  const panel = useRef<HTMLElement>(null);
  const popover = open && compact;
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOpen only writes prefs / state
  }, [popover]);

  // A live update (an item's `pulse` going up) briefly highlights the collapsed capsule; the panel
  // does not open by itself.
  const pulseKey = present.map((p) => `${p.placed.item.id}=${p.pulse}`).join(",");
  const seenPulses = useRef(new Map<string, number>());
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const next = new Map(present.map((p) => [p.placed.item.id, p.pulse] as const));
    let live = false;
    for (const [id, pulse] of next) {
      const before = seenPulses.current.get(id);
      if (before === undefined ? pulse > 0 : pulse > before) live = true;
    }
    seenPulses.current = next;
    if (!live) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pulseKey summarises `present`
  }, [pulseKey]);

  const show = (id: string) => {
    setMenu(false);
    setArmed(true);
    revealInCapsule({ sessionId, itemId: id });
  };

  if (!hasContent) {
    // Settings → 状态显示: 始终显示 keeps an empty one-line capsule so it is clear where it lives.
    if (!capsuleAlways) return null;
    return (
      <Frame frameRef={setFrame}>
        <div className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-[17px] border border-border bg-surface px-2.5 text-xs text-subtle shadow-sm" style={{ zoom: "var(--capsule-scale, 1)" }}>
          <ListChecks size={14} className="shrink-0" />
          {t("status-capsule.empty")}
        </div>
      </Frame>
    );
  }

  const align = isLeft(corner) ? "items-start" : "items-end";
  const [first, ...others] = present;
  return (
    <Frame frameRef={setFrame}>
      {/* The compact popover is transient: the conversation reserves no band for it. */}
      <div className={`pointer-events-auto flex min-h-0 max-w-full flex-col ${align}`} style={{ zoom: "var(--capsule-scale, 1)" }} data-overlay-transient={popover ? "" : undefined}>
        {open ? (
          <aside
            key="open"
            ref={panel}
            aria-label={t("status-capsule.title")}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.stopPropagation();
              if (menu) setMenu(false);
              else setOpen(false);
            }}
            className={`capsule-in relative flex max-h-[min(64dvh,32rem)] min-h-0 w-[22rem] max-w-full flex-col rounded-xl border border-card-border bg-surface shadow-[var(--shadow)] ${isTop(corner) ? (isLeft(corner) ? "origin-top-left" : "origin-top-right") : isLeft(corner) ? "origin-bottom-left" : "origin-bottom-right"}`}
          >
            <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
              <button data-capsule-more onClick={() => setMenu(!menu)} title={t("status-capsule.more")} aria-label={t("status-capsule.more")} aria-expanded={menu} className={ICON_BUTTON}>
                <MoreHorizontal size={14} />
              </button>
              <button onClick={() => setOpen(false)} title={`${t("status-capsule.collapse")} (Esc)`} aria-label={t("status-capsule.collapse")} className={ICON_BUTTON}>
                <Minimize2 size={13} />
              </button>
            </div>
            {menu && <PlacementMenu items={all} onClose={() => setMenu(false)} />}
            <div className="flex min-h-0 flex-col overflow-y-auto px-1.5 pt-1.5 pb-2">
              {present.map(({ placed: { item, moduleId }, data, line }, i) => {
                const { Meta, Body } = item;
                return (
                  <Section
                    key={item.id}
                    id={item.id}
                    first={i === 0}
                    folded={folded.includes(item.id)}
                    title={t(item.titleKey)}
                    meta={
                      Meta && (
                        <ItemBoundary moduleId={moduleId} resetKey={sessionId}>
                          <Meta sessionId={sessionId} data={data} />
                        </ItemBoundary>
                      )
                    }
                    summary={
                      <span className="min-w-0 truncate" title={line.title}>
                        {line.text}
                      </span>
                    }
                  >
                    <ItemBoundary moduleId={moduleId} resetKey={sessionId}>
                      <Body sessionId={sessionId} data={data} />
                    </ItemBoundary>
                  </Section>
                );
              })}
            </div>
          </aside>
        ) : compact && first ? (
          // Compact: one pill — the first line, 「+N」 for the rest; opens the panel as a popover.
          <button
            key="compact"
            onClick={() => show(first.placed.item.id)}
            title={`${present.map((p) => p.line.title).join("\n")}\n${t("status-capsule.expand")} (Ctrl+.)`}
            aria-label={t("status-capsule.title")}
            data-capsule-compact=""
            className={`capsule-in flex h-8 max-w-[min(15rem,45vw)] min-w-0 items-center gap-2 rounded-[17px] border bg-surface/95 px-2.5 text-left text-[13px] shadow-[var(--card-shadow)] backdrop-blur transition-colors hover:bg-hover ${flash ? "border-accent/60" : "border-card-border"}`}
          >
            <ItemBoundary moduleId={first.placed.moduleId} resetKey={sessionId}>
              {first.line.icon}
              <span className="min-w-0 flex-1 truncate">{first.line.text}</span>
            </ItemBoundary>
            {others.length > 0 && (
              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] leading-4 text-muted tabular-nums" data-testid="capsule-more">
                +{others.length}
              </span>
            )}
            <ChevronDown size={12} className="shrink-0 text-subtle" aria-hidden />
          </button>
        ) : (
          // One capsule, one line per item; a single line is a pill (34px tall, 17px radius).
          <div
            key="collapsed"
            role="group"
            aria-label={t("status-capsule.title")}
            className={`capsule-in flex max-w-80 min-w-0 flex-col rounded-[17px] border bg-surface/95 p-0.5 shadow-[var(--card-shadow)] backdrop-blur transition-colors ${flash ? "border-accent/60" : "border-card-border"}`}
          >
            {present.map(({ placed: { item, moduleId }, line }) => (
              <button
                key={item.id}
                onClick={() => show(item.id)}
                title={`${line.title}\n${t("status-capsule.expand")} (Ctrl+.)`}
                className="flex h-7 min-w-0 items-center gap-2 rounded-[14px] px-2.5 text-left text-[13px] hover:bg-hover"
              >
                <ItemBoundary moduleId={moduleId} resetKey={sessionId}>
                  {line.icon}
                  <span className="min-w-0 flex-1 truncate">{line.text}</span>
                  {line.trailing}
                </ItemBoundary>
              </button>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

/** The mounted capsule (some item effectively in it): Ctrl+. and the view registration live here. */
function Capsule({ sessionId, items, all }: { sessionId: string; items: readonly PlacedStatus[]; all: readonly PlacedStatus[] }) {
  const [menu, setMenu] = useState(false);
  // Compact: opened here (kept across item-set remounts of the view).
  const [armed, setArmed] = useState(false);

  // Ctrl+. toggles from anywhere (while there is something to show).
  const canToggle = useRef(false);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const compactRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key !== "." || !canToggle.current) return;
      e.preventDefault();
      setMenu(false);
      const next = !(getUiPrefs().capsuleOpen && (!compactRef.current || armedRef.current));
      setArmed(next);
      setUiPref("capsuleOpen", next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // reveal() opens this view only while it is mounted.
  useEffect(() => registerCapsuleView(sessionId, () => setArmed(true)), [sessionId]);

  return <CapsuleView key={items.map((p) => p.item.id).join("\n")} sessionId={sessionId} items={items} all={all} menu={menu} setMenu={setMenu} canToggle={canToggle} compactRef={compactRef} armed={armed} setArmed={setArmed} />;
}

/**
 * The `conversation.overlay` item: mounted per agent while the module is on. Shows (and reserves the
 * column inset for) the items whose effective placement includes the capsule; nothing otherwise.
 */
export function StatusCapsule({ sessionId, reserve }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  const all = useStatusItems(sessionId);
  const items = useMemo(() => all.filter((p) => shownOn(p, "capsule")), [all]);
  const { capsuleCorner, capsuleEdge } = useUiPrefs();
  const shown = items.length > 0;
  const anchor = isTop(capsuleCorner) ? "top" : "bottom";
  const overColumn = capsuleEdge === "content";
  const side = isLeft(capsuleCorner) ? "left" : "right";
  // A fixed inset while the capsule is placed (not tied to it having content, so nothing shifts); the
  // side lets the gutters (§19) keep clear of it at the window edge.
  useLayoutEffect(() => reserve(shown ? { anchor, overColumn, side } : null), [reserve, shown, anchor, overColumn, side]);
  useLayoutEffect(() => () => reserve(null), [reserve]);
  return shown ? <Capsule sessionId={sessionId} items={items} all={all} /> : null;
}
