// One tool pane (docs/desktop-modules.md §18.4, §24): header (category icon, a tab row only when it holds
// several instances — or always, with a ＋ after the last tab, for a `tabRow: "always"` kind (the browser)
// — the component's Actions, ⤢ ⛶ ⋯ on hover, ▾ only when the column has more than one pane, 「—」 = a menu of
// 移到另一页 / 关闭 (#7: no tool pane goes to the tray), ×) and a placeholder body. The instance itself renders in the instance layer (SideInstanceLayer)
// aligned to the placeholder, so moving, maximising or going full screen never remounts it.
// Drag handles (lib/sideDnd.ts): the header (its icon, its empty space) = the whole pane; a tab, or the
// title of a single-instance pane = that one instance. Double-click on the header = maximise / restore (a folded pane:
// open it, as its ▾).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, Expand, Maximize2, Minimize2, Minus, MoreHorizontal, Plus, Shrink, X } from "lucide-react";
import { fitTabs, headerCompact, TAB_ACTIVE_MAX, TAB_ACTIVE_MIN, TAB_MAX, TAB_MIN } from "../../lib/tabFit";
import { PaneHeaderCompact } from "../../lib/paneHeader";
import { sharedResizeObserver } from "../../lib/resizeHub";
import { useI18n } from "../../i18n";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { ARMED_BUTTON, ARMED_COUNTDOWN, useArmed } from "../../lib/armedConfirm";
import { cardCloseWarnings, closeCard, closeTab, joinWarnings, toggleMode } from "../../lib/sideActions";
import { toggleExclusive, toggleMaximize } from "../../lib/paneActions";
import { useGrow } from "../../lib/panelGrow";
import { useSideBodyProps } from "../../lib/sideBody";
import type { SideComponentEntry } from "../../lib/sideComponents";
import { activateTab, pinInstance, setCollapsed, type SideCard as Card, type SideInstance, type SidePage } from "../../lib/sideLayout";
import { setFocusedCard, updateLayout, useSide } from "../../lib/sideLayoutStore";
import { useShelfLayout } from "../../lib/shelfSource";
import { cardMenu, cardNewTabParams, newTabInCard, paneDashMenu, tabMenu } from "../../lib/sideMenus";
import { closeWarnings } from "../../lib/sideServices";
import { registerSideSlot } from "../../lib/sideSlots";
import { useSideWidthHandle, type WidthTarget } from "../../lib/sideResize";
import { sideDragHandle, useSideDnd } from "../../lib/sideDnd";
import { ItemBoundary } from "../../modules/Outlet";
import { NarrowChip } from "./NarrowChip";
import { CountBadge } from "../../components/Tag";
import { keyVar } from "../../lib/keybindings";
import { isElement } from "../../lib/ownerWindow";

const ICON_BTN = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground";

function Actions({ entry, id, card, page }: { entry: SideComponentEntry; id: string; card: string; page: string }) {
  const inst = useShelfLayout().instances[id];
  if (!inst) return null;
  return <ActionsWith entry={entry} id={id} inst={inst} card={card} page={page} />;
}

function ActionsWith({ entry, id, inst, card, page }: { entry: SideComponentEntry; id: string; inst: SideInstance; card: string; page: string }) {
  const props = useSideBodyProps(id, inst, { cardId: card, pageId: page });
  const A = entry.item.Actions!;
  return (
    <span data-side-nodrag data-side-actions="" className="flex shrink-0 items-center gap-0.5">
      <ItemBoundary moduleId={entry.moduleId} resetKey={id}>
        <A {...props} />
      </ItemBoundary>
    </span>
  );
}

type TabLook = { busy?: boolean; unread?: boolean; attention?: number; tooltip?: string; favicon?: string };

/** A tab's hover text: its whole title, and what it shows when that says more (a web page's address). */
/** A tab's image: only an inline `data:image/` URL (the renderer never fetches one). */
const tabFavicon = (info: TabLook | undefined): string | null => (info?.favicon?.startsWith("data:image/") ? info.favicon : null);

const tabTooltip = (title: string, info: TabLook | undefined): string => (info?.tooltip && info.tooltip !== title ? `${title}\n${info.tooltip}` : title);

function Tab({ id, active, title, transient, info }: { id: string; active: boolean; title: string; transient: boolean; info: TabLook | undefined }) {
  const { t } = useI18n();
  const dragged = useSideDnd((s) => s.drag?.type === "tab" && s.drag.instanceId === id);
  // × / middle click: closing what would end something (a running terminal) is confirmed in place;
  // a tab with nothing left to end (no closeConfirm warning) closes at once.
  const [armed, setArmed] = useArmed(id);
  const [warning, setWarning] = useState("");
  const pressClose = () => {
    const lines = closeWarnings([id]);
    if (!lines.length || armed) {
      setArmed(false);
      closeTab(id);
      return;
    }
    setWarning(t("side.closeArmed", { what: joinWarnings(lines) }));
    setArmed(true);
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      title={armed ? warning : tabTooltip(title, info)}
      data-side-tab={id}
      {...sideDragHandle(() => ({ type: "tab", instanceId: id }))}
      onContextMenu={contextMenu(() => tabMenu(id))}
      // Middle click closes (no autoscroll cursor on the press).
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => e.button === 1 && pressClose()}
      // Full width when there is room; short of it, every tab gives way evenly down to TAB_MIN (equal bases shrink evenly),
      // the active one from a larger base and to a larger minimum (lib/tabFit).
      style={{ flex: `0 1 ${active ? TAB_ACTIVE_MAX : TAB_MAX}px`, minWidth: active ? TAB_ACTIVE_MIN : TAB_MIN }}
      className={`group/tab flex h-6 items-center gap-1 overflow-hidden rounded-md pr-0.5 pl-1.5 text-xs ${armed ? "bg-danger/15 text-danger ring-1 ring-danger/70" : active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-hover hover:text-foreground"} ${dragged ? "opacity-45" : ""}`}
    >
      {tabFavicon(info) && <img src={tabFavicon(info)!} alt="" width={12} height={12} referrerPolicy="no-referrer" className="size-3 shrink-0 rounded-sm" />}
      <button
        onClick={() => updateLayout((l) => activateTab(l, id, Date.now()))}
        onDoubleClick={() => transient && updateLayout((l) => pinInstance(l, id))}
        className={`min-w-0 flex-1 truncate text-left ${transient ? "italic" : ""}`}
        title={transient ? t("side.transientHint") : undefined}
      >
        {title}
      </button>
      {info?.attention ? <CountBadge tone="danger" count={info.attention} max={9} /> : null}
      {!info?.attention && info?.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      {info?.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ok" />}
      <button
        data-side-nodrag
        onClick={pressClose}
        aria-label={armed ? warning : t("side.close")}
        title={armed ? warning : t("side.close")}
        className={armed ? `${ARMED_COUNTDOWN} shrink-0 rounded bg-danger-solid p-0.5 text-white` : `shrink-0 rounded p-0.5 text-subtle hover:bg-surface hover:text-foreground ${active ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70"}`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

/**
 * The tab row (lib/tabFit): the tabs that fit at their minimum width share it evenly, the rest go into 「⌄ N」 (a
 * list: icon + whole title, a click shows it), ＋ always shows. Never a tab cut off mid-title.
 */
function TabRow({ tabs, shown, label, transient, tabInfo, newTab, cardId }: { tabs: readonly string[]; shown: string | null; label: (id: string) => string; transient: (id: string) => boolean; tabInfo: Record<string, TabLook | undefined>; newTab: boolean; cardId: string }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = sharedResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = fitTabs({ count: tabs.length, active: shown ? tabs.indexOf(shown) : -1, width, plus: newTab });
  const hidden = fit.hidden.map((k) => tabs[k]!);
  return (
    <div ref={box} data-side-tab-row="" className="flex min-w-0 flex-1 items-center gap-0.5">
      <div role="tablist" className="flex min-w-0 items-center gap-0.5">
        {fit.shown.map((k) => {
          const id = tabs[k]!;
          return <Tab key={id} id={id} active={id === shown} title={label(id)} transient={transient(id)} info={tabInfo[id]} />;
        })}
      </div>
      {hidden.length > 0 && (
        <button
          data-side-nodrag
          data-side-tab-more={hidden.length}
          onClick={(e) =>
            openMenuFrom(
              e.currentTarget,
              hidden.map((id) => ({
                label: label(id),
                title: tabTooltip(label(id), tabInfo[id]),
                icon: tabFavicon(tabInfo[id]) ? <img src={tabFavicon(tabInfo[id])!} alt="" width={14} height={14} referrerPolicy="no-referrer" /> : undefined,
                onSelect: () => updateLayout((l) => activateTab(l, id, Date.now())),
              })),
              { owner: `tabs:${cardId}` },
            )
          }
          title={t("side.moreTabs", { n: hidden.length })}
          aria-label={t("side.moreTabs", { n: hidden.length })}
          aria-haspopup="menu"
          className="flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted hover:bg-hover hover:text-foreground"
        >
          <ChevronDown size={12} />
          {hidden.length}
        </button>
      )}
      {newTab && (
        <button data-side-nodrag data-side-new-tab onClick={() => newTabInCard(cardId)} title={t("side.newTab")} aria-label={t("side.newTab")} className={ICON_BTN}>
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}

/**
 * Whether the header's own buttons go compact (lib/tabFit headerCompact): measured on the header, its tab row and its
 * Actions; the Actions' full width is the one last seen at full size (compact they are narrower: no flapping).
 */
function useHeaderCompact(head: RefObject<HTMLDivElement | null>, count: number, plus: boolean): boolean {
  const [compact, setCompact] = useState(false);
  const full = useRef(0);
  const state = useRef(compact);
  state.current = compact;
  useLayoutEffect(() => {
    const el = head.current;
    if (!el || count === 0) return;
    const measure = () => {
      const row = el.querySelector<HTMLElement>("[data-side-tab-row]");
      const actions = el.querySelector<HTMLElement>("[data-side-actions]");
      if (!row) return;
      const a = actions?.offsetWidth ?? 0;
      if (!state.current) full.current = a;
      const fixed = el.clientWidth - row.offsetWidth - a;
      const next = headerCompact({ header: el.clientWidth, fixed, full: full.current, count, plus });
      if (next !== state.current) setCompact(next);
    };
    measure();
    const ro = sharedResizeObserver(measure);
    ro.observe(el);
    const actions = el.querySelector("[data-side-actions]");
    if (actions) ro.observe(actions);
    return () => ro.disconnect();
  }, [head, count, plus]);
  return compact;
}

export function SideCardView({
  page,
  card,
  entry,
  tabs,
  shown,
  height,
  folded,
  onRestore,
  single,
  edge,
  currentWidth,
  target,
}: {
  page: SidePage;
  card: Card;
  entry: SideComponentEntry;
  tabs: readonly string[];
  shown: string | null;
  height: number | null;
  folded: boolean;
  /** Folded (collapsed or short of room, not by another pane's 最大化): opens it (▾, double-click on the title bar). */
  onRestore?: () => void;
  /** The only card shown on the page: no ▾. */
  single: boolean;
  /** The card's edge toward the conversations (left on the right Shelf) resizes its Shelf (not while maximised / full screen). */
  edge: "left" | "right" | null;
  currentWidth: () => number;
  target: WidthTarget | null;
}) {
  const { t } = useI18n();
  const tabInfo = useSide((s) => s.tabInfo);
  const instances = useShelfLayout().instances;
  const mode = useSide((s) => s.mode);
  const flash = useSide((s) => (s.flash?.cardId === card.id ? s.flash.nonce : null));
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const width = useSideWidthHandle(currentWidth, target);
  const title = t(entry.item.titleKey);
  const Icon = entry.item.icon;
  const inMode = mode?.card === card.id ? mode.kind : null;
  const grown = useGrow((s) => s.target?.kind === "shelf" && s.target.card === card.id);
  const dragged = useSideDnd((s) => (s.drag?.type === "card" && s.drag.cardId === card.id) || (s.drag?.type === "tab" && tabs.length === 1 && s.drag.instanceId === tabs[0]));
  // Card ×: closing what would end something (e.g. a running terminal) is confirmed in place.
  const [closeArmed, setCloseArmed] = useArmed(card.id);
  const [closeWarning, setCloseWarning] = useState("");
  const pressClose = () => {
    const lines = cardCloseWarnings(card.id);
    if (!lines.length || closeArmed) {
      setCloseArmed(false);
      closeCard(card.id);
      return;
    }
    setCloseWarning(t("side.closeArmed", { what: joinWarnings(lines) }));
    setCloseArmed(true);
  };

  // The placeholder the instance layer aligns the shown instance to.
  useLayoutEffect(() => {
    if (!shown || folded || !body.current) return;
    return registerSideSlot(shown, { el: body.current, cardId: card.id, pageId: page.id });
  }, [shown, folded, card.id, page.id]);

  useEffect(() => {
    const el = box.current;
    if (flash === null || !el) return;
    el.classList.remove("side-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("side-flash");
    const timer = setTimeout(() => el.classList.remove("side-flash"), 1400);
    return () => clearTimeout(timer);
  }, [flash]);

  // Browser-style header: the tab row even with one tab, and a ＋ (a new tab of this card).
  const alwaysTabs = entry.item.tabRow === "always" && tabs.length > 0;
  const canNewTab = alwaysTabs && cardNewTabParams(entry.item) !== null;
  // Short of room for the tabs: the module's own buttons fold their secondary ones into a ⋯ (lib/paneHeader).
  const head = useRef<HTMLDivElement>(null);
  const compact = useHeaderCompact(head, tabs.length > 1 || alwaysTabs ? tabs.length : 0, canNewTab);
  const transient = (id: string) => !!entry.item.transient && !instances[id]?.pinned;
  const label = (id: string) => tabInfo[id]?.title || title;
  // ⤢ = 最大化 (rule 2, lib/panelGrow: its Shelf takes every gap of the row, it fills its page); 独占 (inMode
  // "maximised", the former ⤢) is in the menus — its button here restores it.
  const modeButton = (kind: "maximised" | "fullscreen") => {
    const on = kind === "maximised" ? inMode === kind || grown : inMode === kind;
    const IconM = kind === "maximised" ? (on ? Minimize2 : Maximize2) : on ? Shrink : Expand;
    const tip = kind === "maximised" ? t(on ? "pane.restoreMax" : "pane.maximize", keyVar("paneMaximise")) : on ? t("side.restoreHint", keyVar("panelFullscreen")) : t("side.fullscreenCard", keyVar("panelFullscreen"));
    return (
      <button data-side-nodrag data-pane-max={kind === "maximised" ? "" : undefined} data-pane-grown={kind === "maximised" && grown ? "" : undefined} onClick={() => (kind === "maximised" ? (inMode === kind ? toggleExclusive({ area: "tools", id: card.id }) : toggleMaximize({ area: "tools", id: card.id })) : toggleMode(kind, card.id))} title={tip} aria-label={tip} aria-pressed={on} className={ICON_BTN}>
        <IconM size={13} />
      </button>
    );
  };

  return (
    <div
      ref={box}
      data-side-card={card.id}
      onPointerDownCapture={() => setFocusedCard(card.id)}
      onFocusCapture={() => setFocusedCard(card.id)}
      style={height === null ? undefined : { height }}
      className={`shell-card relative flex min-h-0 shrink-0 flex-col overflow-hidden ${height === null ? "flex-1" : ""} ${dragged ? "opacity-45" : ""}`}
    >
      {edge && <div data-guide-target="shelf-width" title={t("shelf.resize")} className={`side-handle-v absolute top-3.5 bottom-3.5 z-10 w-[5px] cursor-col-resize ${edge === "left" ? "left-0" : "right-0"}`} {...width} />}
      <div
        ref={head}
        data-side-card-head={card.id}
        {...sideDragHandle(() => ({ type: "card", cardId: card.id }))}
        onDoubleClick={(e) => {
          if (isElement(e.target) && e.target.closest("button, [role=tab], [data-side-nodrag], [data-side-tab]")) return;
          if (onRestore) return onRestore();
          toggleMaximize({ area: "tools", id: card.id });
        }}
        className="group/head flex h-9 shrink-0 cursor-grab items-center gap-0.5 rounded-t-inner pr-1.5 pl-1.5 active:cursor-grabbing"
      >
        <button
          title={title}
          aria-label={`${title} — ${t("side.cardMenu")}`}
          {...sideDragHandle(() => ({ type: "card", cardId: card.id }))}
          onClick={() => setFocusedCard(card.id)}
          onContextMenu={contextMenu(() => cardMenu(card.id))}
          className="flex h-[26px] w-[26px] shrink-0 cursor-grab items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-foreground"
        >
          <Icon size={15} />
        </button>
        {/* Tab strip: no bar at all (not even an overlay thumb over the tabs); wheel / touchpad scroll it. */}
        {tabs.length > 1 || alwaysTabs ? (
          <TabRow tabs={tabs} shown={shown} label={label} transient={transient} tabInfo={tabInfo} newTab={canNewTab} cardId={card.id} />
        ) : (
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 text-xs font-medium"
            title={(shown && tabInfo[shown]?.tooltip) || label(shown ?? "")}
            data-side-tab={shown ?? undefined}
            {...sideDragHandle(() => (shown ? { type: "tab", instanceId: shown } : null))}
            onContextMenu={shown ? contextMenu(() => tabMenu(shown)) : undefined}
            onDoubleClick={() => shown && transient(shown) && updateLayout((l) => pinInstance(l, shown))}
          >
            <span className={`min-w-0 truncate ${shown && transient(shown) ? "italic" : ""}`}>{label(shown ?? "")}</span>
            {shown && tabInfo[shown]?.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ok" />}
            {shown && !tabInfo[shown]?.attention && tabInfo[shown]?.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
          </div>
        )}
        {!folded && shown && entry.item.Actions && (
          <PaneHeaderCompact.Provider value={compact}>
            <Actions entry={entry} id={shown} card={card.id} page={page.id} />
          </PaneHeaderCompact.Provider>
        )}
        <span className={`flex shrink-0 items-center gap-px transition-opacity ${inMode || grown ? "opacity-100" : "opacity-0 group-hover/head:opacity-100 group-focus-within/head:opacity-100"}`}>
          {modeButton("maximised")}
          {modeButton("fullscreen")}
          <button data-side-nodrag onClick={(e) => openMenuFrom(e.currentTarget, cardMenu(card.id))} title={t("side.cardMenu")} aria-label={t("side.cardMenu")} className={ICON_BTN}>
            <MoreHorizontal size={14} />
          </button>
        </span>
        {!single && (
          <button
            data-side-nodrag
            data-side-fold={card.id}
            onClick={() => (onRestore ? onRestore() : updateLayout((l) => setCollapsed(l, card.id, !card.collapsed)))}
            aria-expanded={!folded}
            title={t(folded ? "side.expand" : "side.collapse")}
            className={ICON_BTN}
          >
            <ChevronDown size={13} className={`transition-transform ${folded ? "-rotate-90" : ""}`} />
          </button>
        )}
        <button data-side-nodrag data-pane-dash="" onClick={(e) => openMenuFrom(e.currentTarget, paneDashMenu(card.id))} title={t("pane.dash")} aria-label={t("pane.dash")} aria-haspopup="menu" className={ICON_BTN}>
          <Minus size={13} />
        </button>
        {closeArmed ? (
          <button
            data-side-nodrag
            onClick={pressClose}
            title={closeWarning}
            aria-label={closeWarning}
            data-armed
            className={`${ARMED_BUTTON} flex h-6 max-w-[60%] min-w-0 shrink items-center gap-1`}
          >
            <X size={12} className="shrink-0" />
            <span className="min-w-0 truncate" role="alert">
              {closeWarning}
            </span>
          </button>
        ) : (
          <button data-side-nodrag onClick={pressClose} title={t("side.closeCard")} aria-label={t("side.closeCard")} className={ICON_BTN}>
            <X size={13} />
          </button>
        )}
      </div>
      {!folded && shown && <NarrowChip box={box} entry={entry} instanceId={shown} pageId={page.id} name={label(shown)} />}
      {/* The instance layer draws over this box: it leaves the left-edge width handle uncovered. */}
      {!folded && <div ref={body} data-side-slot="" className={`relative min-h-0 flex-1 ${edge === "left" ? "ml-[5px]" : edge === "right" ? "mr-[5px]" : ""}`} />}
    </div>
  );
}
