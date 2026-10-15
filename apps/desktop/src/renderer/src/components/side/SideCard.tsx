// One right-side card (docs/desktop-modules.md §18.4): header (category icon = the card's handle,
// a tab row only when it holds several instances of its kind, the component's Actions, ⤢ ⛶ ⋯ on
// hover, ▾ only when the page has more than one card, ×) and a placeholder body. The instance itself
// renders in the instance layer (SideInstanceLayer) aligned to the placeholder, so moving, maximising
// or going full screen never remounts it.
// Drag handles (lib/sideDnd.ts): the category icon = the whole card; a tab, or the title of a
// single-instance card = that one instance. The header is a drop target (above / below, or a tab
// joining a card of its kind).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Expand, Maximize2, Minimize2, MoreHorizontal, Shrink, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { ARMED_BUTTON, useArmed } from "../../lib/armedConfirm";
import { cardCloseWarnings, closeCard, closeTab, joinWarnings, toggleMode } from "../../lib/sideActions";
import { useSideBodyProps } from "../../lib/sideBody";
import type { SideComponentEntry } from "../../lib/sideComponents";
import { activateTab, pinInstance, setCollapsed, type SideCard as Card, type SideInstance, type SidePage } from "../../lib/sideLayout";
import { setFocusedCard, updateLayout, useSide } from "../../lib/sideLayoutStore";
import { cardMenu, tabMenu } from "../../lib/sideMenus";
import { closeWarnings } from "../../lib/sideServices";
import { registerSideSlot } from "../../lib/sideSlots";
import { useSideWidthHandle } from "../../lib/sideResize";
import { sideDragHandle, useSideDnd } from "../../lib/sideDnd";
import { ItemBoundary } from "../../modules/Outlet";

const ICON_BTN = "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground";

function Actions({ entry, id, card, page }: { entry: SideComponentEntry; id: string; card: string; page: string }) {
  const inst = useSide((s) => s.layout.instances[id]);
  if (!inst) return null;
  return <ActionsWith entry={entry} id={id} inst={inst} card={card} page={page} />;
}

function ActionsWith({ entry, id, inst, card, page }: { entry: SideComponentEntry; id: string; inst: SideInstance; card: string; page: string }) {
  const props = useSideBodyProps(id, inst, { cardId: card, pageId: page });
  const A = entry.item.Actions!;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <ItemBoundary moduleId={entry.moduleId} resetKey={id}>
        <A {...props} />
      </ItemBoundary>
    </span>
  );
}

function Tab({ id, active, title, transient, info }: { id: string; active: boolean; title: string; transient: boolean; info: { busy?: boolean; unread?: boolean; attention?: number; tooltip?: string } | undefined }) {
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
      title={armed ? warning : (info?.tooltip ?? title)}
      data-side-tab={id}
      {...sideDragHandle(() => ({ type: "tab", instanceId: id }))}
      onContextMenu={contextMenu(() => tabMenu(id))}
      onAuxClick={(e) => e.button === 1 && pressClose()}
      className={`group/tab flex h-6 max-w-44 min-w-0 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 text-xs ${armed ? "bg-danger/15 text-danger ring-1 ring-danger/70" : active ? "bg-surface-2 text-foreground" : "text-muted hover:bg-hover hover:text-foreground"} ${dragged ? "opacity-45" : ""}`}
    >
      <button
        onClick={() => updateLayout((l) => activateTab(l, id, Date.now()))}
        onDoubleClick={() => transient && updateLayout((l) => pinInstance(l, id))}
        className={`min-w-0 truncate ${transient ? "italic" : ""}`}
        title={transient ? t("side.transientHint") : undefined}
      >
        {title}
      </button>
      {info?.attention ? <span className="shrink-0 rounded-full bg-danger px-1 text-[9px] leading-[13px] font-bold text-white">{info.attention > 9 ? "9+" : info.attention}</span> : null}
      {!info?.attention && info?.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      {info?.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ok" />}
      <button
        data-side-nodrag
        onClick={pressClose}
        aria-label={armed ? warning : t("side.close")}
        title={armed ? warning : t("side.close")}
        className={armed ? "shrink-0 rounded bg-danger p-0.5 text-white" : `shrink-0 rounded p-0.5 text-subtle hover:bg-surface hover:text-foreground ${active ? "opacity-70" : "opacity-0 group-hover/tab:opacity-70"}`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function SideCardView({
  page,
  card,
  entry,
  tabs,
  shown,
  height,
  folded,
  single,
  edge,
  currentWidth,
}: {
  page: SidePage;
  card: Card;
  entry: SideComponentEntry;
  tabs: readonly string[];
  shown: string | null;
  height: number | null;
  folded: boolean;
  /** The only card shown on the page: no ▾. */
  single: boolean;
  /** The card's left edge resizes the column (not while maximised / full screen). */
  edge: boolean;
  currentWidth: () => number;
}) {
  const { t } = useI18n();
  const tabInfo = useSide((s) => s.tabInfo);
  const instances = useSide((s) => s.layout.instances);
  const mode = useSide((s) => s.mode);
  const flash = useSide((s) => (s.flash?.cardId === card.id ? s.flash.nonce : null));
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const width = useSideWidthHandle(currentWidth);
  const title = t(entry.item.titleKey);
  const Icon = entry.item.icon;
  const inMode = mode?.card === card.id ? mode.kind : null;
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
  const joinDrop = useSideDnd((s) => s.target?.kind === "head" && s.target.cardId === card.id && s.target.op === "join");

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

  const transient = (id: string) => !!entry.item.transient && !instances[id]?.pinned;
  const label = (id: string) => tabInfo[id]?.title || title;
  const modeButton = (kind: "maximised" | "fullscreen") => {
    const on = inMode === kind;
    const IconM = kind === "maximised" ? (on ? Minimize2 : Maximize2) : on ? Shrink : Expand;
    const tip = on ? t("side.restoreHint", { key: kind === "maximised" ? "Ctrl+Shift+M" : "Shift+F11" }) : t(kind === "maximised" ? "side.maximiseCard" : "side.fullscreenCard", { key: kind === "maximised" ? "Ctrl+Shift+M" : "Shift+F11" });
    return (
      <button onClick={() => toggleMode(kind, card.id)} title={tip} aria-label={tip} aria-pressed={on} className={ICON_BTN}>
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
      {edge && <div title={t("side.resizeHint")} className="side-handle-v absolute top-3.5 bottom-3.5 left-0 z-10 w-[5px] cursor-col-resize" {...width} />}
      <div
        data-side-card-head={card.id}
        className={`group/head flex h-9 shrink-0 items-center gap-0.5 rounded-t-[13px] pr-1.5 pl-1.5 ${joinDrop ? "bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] shadow-[inset_0_0_0_1.5px_var(--accent)]" : ""}`}
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
        {tabs.length > 1 ? (
          <div role="tablist" data-native-scrollbar className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((id) => (
              <Tab key={id} id={id} active={id === shown} title={label(id)} transient={transient(id)} info={tabInfo[id]} />
            ))}
          </div>
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
        {!folded && shown && entry.item.Actions && <Actions entry={entry} id={shown} card={card.id} page={page.id} />}
        <span className={`flex shrink-0 items-center gap-px transition-opacity ${inMode ? "opacity-100" : "opacity-0 group-hover/head:opacity-100 group-focus-within/head:opacity-100"}`}>
          {modeButton("maximised")}
          {modeButton("fullscreen")}
          <button onClick={(e) => openMenuFrom(e.currentTarget, cardMenu(card.id))} title={t("side.cardMenu")} aria-label={t("side.cardMenu")} className={ICON_BTN}>
            <MoreHorizontal size={14} />
          </button>
        </span>
        {!single && (
          <button
            onClick={() => updateLayout((l) => setCollapsed(l, card.id, !card.collapsed))}
            aria-expanded={!folded}
            title={t(card.collapsed ? "side.expand" : "side.collapse")}
            className={ICON_BTN}
          >
            <ChevronDown size={13} className={`transition-transform ${folded ? "-rotate-90" : ""}`} />
          </button>
        )}
        {closeArmed ? (
          <button
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
          <button onClick={pressClose} title={t("side.closeCard")} aria-label={t("side.closeCard")} className={ICON_BTN}>
            <X size={13} />
          </button>
        )}
      </div>
      {/* The instance layer draws over this box: it leaves the left-edge width handle uncovered. */}
      {!folded && <div ref={body} className={`relative min-h-0 flex-1 ${edge ? "ml-[5px]" : ""}`} />}
    </div>
  );
}
