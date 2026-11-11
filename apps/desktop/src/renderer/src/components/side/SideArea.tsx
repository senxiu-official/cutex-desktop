import { FillWorkArea } from "./FillWorkArea";
// The Shelves at App level (docs/desktop-modules.md §24.12; §24 / §18 for what they keep; RFC §3.8–§3.9):
// the work area holds the conversation panes and the Shelves beside them — at most one LEFT of the
// conversations and one RIGHT of them. A Shelf shows one page at a time (its Shelf Rail switches pages),
// a page a stack of ≤ 3 panes with their tabs. The right Shelf's box follows the frame
// (lib/sideFrame.ts): in the row (并排 / 让位), over the conversation (悬浮), a drawer (narrow window), or —
// maximised / full screen (§24.16) — in the row with the rest of its width, the conversations a strip of avatars
// and the other Shelves their rails (a conversation maximised: the Shelves fold to their rails the same way). The left Shelf sits in the row before the
// conversations (hidden when the window cannot hold it beside the conversations' minimum). Each Shelf
// has its own width (else appearance.sidePaneWidth), its rail on top of it. A collapsed Shelf (owner
// 2026-10-21) is its rail only, a strip in place on its outer edge; the box moves between the two widths
// (lib/shelfMotion). Instances never live here: panes hold placeholders, SideInstanceLayer draws the instances.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useI18n } from "../../i18n";
import { RANGES, setAppearance, useAppearance, useLiveWidth } from "../../lib/appearance";
import { armRowGlide, glideColumns, noteColumns, onResizeDrag, resizeDrag, resizing } from "../../lib/columnGlide";
import { CARD_CHROME, edgeToEdge, SINGLE_MIN_W, singleColumnWidth } from "../../lib/workSurface";
import { hideWidthTip, showWidthTip, widthPct } from "../../lib/widthTip";
import { growRow, markGrowBaked, rowGrowRoom, setGrowRoom, singleGrowRoom, useGrow } from "../../lib/panelGrow";
import { keepLeadShare, pinnedLead, resetRowDrag, setColumnWidth, setPinnedLead, setShelfPush, useRowDrag } from "../../lib/rowDrag";
import { convKey } from "../../lib/convShelves";
import { publishSideFrame } from "../../lib/gutterStore";
import { useUiPrefs } from "../../lib/prefs";
import { closeColumn } from "../../lib/sideActions";
import { useSideRegistry, useSideView, type SideRegistry } from "../../lib/sideComponents";
import { drawerHeld, sideFrame, type SideFrame } from "../../lib/sideFrame";
import { CARD_GAP, collapseShelf, type SideLayout, setNewShelfRailPlacement, columnsOnScreen, COLLAPSED_SHELF_WIDTH, frameMins, MIN_CONVERSATION, RAIL_WIDTH, railsOnScreen, shelfRow, setOpen, setShelfWidth, shelfLanePages, shelvesOf, shownCards, toolAreaShown, type ShelfOnScreen, type ShelfSide, type SideViewContext } from "../../lib/sideLayout";
import { useColumnFollow, useShelfBoxMotion } from "../../lib/shelfMotion";
import { conversationPanes, CONVERSATION_MIN_W, DEFAULT_MIN_SIZE, paneBinding, type PaneLayout } from "../../lib/paneLayout";
import { usePanes } from "../../lib/paneStore";
import { setPaneRoom } from "../../lib/paneRoom";
import { useInWindow, useWindowKey } from "../../lib/windowScope";
import { collapseConvShelves, liveConversation, setNarrow, syncPeers, updateLayout, updatePeerView, useSide } from "../../lib/sideLayoutStore";
import { restorePanels } from "../../lib/panelFull";
import { focusConversationPane, resizePaneColumns } from "../../lib/paneStore";
import { WorkspaceRail } from "./WorkspaceRail";
import { ConvStrip as ConversationStrip } from "../ConvStrip";
import { EmptyShelfLaunchers } from "./EmptyShelfLaunchers";
import { EMPTY_PREVIEW_LAUNCHERS } from "../../lib/emptyPreviewPages";
import { dataFlags, useSizeFlags, widthBelow } from "../../lib/sizeFlags";
import { commitShelfWidth, openShelfPage } from "../../lib/shelves";
import { setRowHooks, setRowReserve, shelfEdgeDrag, setSideWorkWidth, setShelvesTaken, useSideWidthHandle, type WidthTarget } from "../../lib/sideResize";
import { WS_CONVERSATION_MIN_W } from "../../lib/workspaces";
import { FOLD_HYSTERESIS } from "../../lib/foldHysteresis";
import { setSettingsRowNeed, useSettingsShelf, useSettingsShelfSlot } from "../../lib/settingsShelf";
import { useSidebarEdge } from "../../lib/windowSidebar";
import { columnWant, oneEdgeWidth, groupLead, newlyExpanded, pinIndex, pushEdge, rowWidthMode, seamPush, shiftedLead, shouldFoldShelves, workspaceRow, type PushItem, type RowPin } from "../../lib/workspaceRow";
import { useStripFlags } from "../../lib/convStrips";
import { useShelfOnlyFlags, useShelfOnlyPanes } from "../../lib/shelfOnly";
import { STRIP_W } from "../../lib/workspaceRow";
import { WsRowContext, type WsRowView } from "../../lib/workspaceRowView";
import { focusPeer, usePeerSource, usePeerViewContext, useShelfLayout } from "../../lib/shelfSource";
import { ShelfSourceContext, useShelfPeer, type ShelfPeer } from "../../lib/shelfSourceContext";
import { agentHost, sidebarOf, useApp } from "../../store";
import { registerSideAnchor, slotsRelayout } from "../../lib/sideSlots";
import { observeSync } from "../../lib/syncResize";
import { SidePageView } from "./SidePageView";
import { EmptyShelfRail, RailOwner, ShelfAvatar, ShelfRail } from "./ShelfRail";
import "./shelfCard.css";
import "../../lib/shelfCorners";
import { isElement } from "../../lib/ownerWindow";
import { useOwnerWindow } from "../../lib/ownerContext";
import { ArrowDownUp } from "lucide-react";
import { BAND_SHELF_MIN, bandShelves, bandWeights, clampBand, clampSplit, RoomFoldedContext, stackColumns, stackRows, useSettingsShelfMaximized, DEFAULT_PORTRAIT, RailEdgeContext, setPortraitPrefs, SPLIT_STEP, SPLIT_STEP_BIG, STACK_CONVERSATION_MIN, STACK_GAP, STACK_RAIL_H, STACK_SHELF_MIN, swapPortrait, usePortrait, usePortraitOn, useRailEdge } from "../../lib/portrait";
import { glideStack, noteStackLater, quietNextStackGlide, stopStackGlides } from "../../lib/portraitMotion";
import "./portrait.css";

/**
 * Portrait (lib/portrait): while the row is drawn as a stack the landscape engine below still runs on every render, but it
 * is handed a row this wide — always flow: no drawer, no fold, no column narrowing — so nothing of the landscape layout is
 * written or folded meanwhile; its results are not drawn. Rotating back measures the real row in the flip's own commit.
 */
const PORTRAIT_ROW = 2400;
/** The row before its first measure (the stand-in: whether it was measured while drawn as the portrait stack). */
const UNMEASURED_ROW = { w: 0, stack: false };

const EMPTY_SHELF_SIZES = { compact: widthBelow(17.5) };

function EmptyCard({ title, hint, children, edge }: { title: string; hint?: string; children?: ReactNode; edge: ReactNode }) {
  const [sizeRef, flags] = useSizeFlags(EMPTY_SHELF_SIZES, { units: true });
  return (
    <div ref={sizeRef} {...dataFlags(flags)} className="shell-card empty-shelf relative min-h-0 min-w-0 flex-1 overflow-y-auto text-ui/[inherit] text-subtle">
      {edge}
      <div className="empty-shelf-content">
        <h3 className="m-0 text-ui/[inherit] font-semibold text-muted">{title}</h3>
        {hint && <div className="max-w-72">{hint}</div>}
        {children}
      </div>
    </div>
  );
}

/** A Shelf's page: its panes (or, for an empty page, the launchers). `edge`: the side its panes' width edge is on. */
function ShelfPage({ entry, registry, ctx, edge, currentWidth, target }: { entry: ShelfOnScreen; registry: SideRegistry; ctx: SideViewContext; edge: "left" | "right" | null; currentWidth: () => number; target: WidthTarget }) {
  const { t } = useI18n();
  const layout = useShelfLayout();
  const peer = useShelfPeer();
  const { page, only } = entry;
  // A shared page in the other workspace's Shelf: its one instance is in the focused workspace's (it follows the
  // focus, §24.13) — a click here brings the focus over and it shows here.
  if (peer && page.shared) return <EmptyCard title={t("ws.peerShared")} edge={null} />;
  // A page the owner made or a shared one keeps its layout for every agent: a pane with nothing for this one is an
  // empty slot of the same size (lib/sideLayout shownCards, EmptySlot; owner 2026-10-23).
  let cards = shownCards(layout, page, ctx);
  if (only) cards = cards.filter((c) => c.id === only);
  if (!cards.length) {
    const launcher = !page.cards.length && page.emptyKind ? EMPTY_PREVIEW_LAUNCHERS[page.emptyKind] : undefined;
    const title = launcher && page.emptyKind ? registry.get(page.emptyKind)?.item.titleKey : undefined;
    return (
      <EmptyCard title={t(title ?? (page.cards.length ? "shelf.page.nothingHere" : "shelf.page.empty"))} hint={t(launcher ? "shelf.page.previewEmpty" : "shelf.page.emptyHint")} edge={null}>
        <EmptyShelfLaunchers pageId={launcher ? null : page.id} kinds={launcher ? [launcher] : undefined} />
      </EmptyCard>
    );
  }
  return <SidePageView page={page} cards={cards} registry={registry} ctx={ctx} edge={edge} currentWidth={currentWidth} target={target} />;
}

/**
 * The avatar at the top of a Shelf's rail (owner 2026-10-21; design 009, owner 2026-10-22: the Shelf's toggle and
 * menu): the focused conversation's, the other workspace's for its Shelf (§24.13); a shared page in view or no
 * agent: the neutral icon.
 */
function LiveOwner({ shelfId, collapsed, shared, side }: { shelfId: string; collapsed: boolean; shared: boolean; side: ShelfSide }) {
  const peer = useShelfPeer();
  const selectedHost = useApp(agentHost);
  const selectedId = useApp((s) => s.selectedId);
  const owner = shared ? null : peer ? { hostId: peer.hostId, sessionId: peer.sessionId } : selectedId ? { hostId: selectedHost, sessionId: selectedId } : null;
  return <ShelfAvatar shelfId={shelfId} owner={owner} collapsed={collapsed} side={side} pinned={shared} peerKey={peer?.key ?? null} />;
}

/**
 * One Shelf: its Shelf Rail on its outer edge (or inner, per Shelf) beside its page in view. `resizable`:
 * the panes' edge toward the conversations sizes the Shelf too. `collapsed`: the rail only, on the outer edge.
 */
type ShelfViewProps = { entry: ShelfOnScreen; registry: SideRegistry; ctx: SideViewContext; resizable: boolean; currentWidth: () => number; collapsed?: boolean; at?: ShelfSide };

/**
 * A width drag re-renders the work row on every step (liveWidth): no Shelf's view changes with its width (the box
 * around it does), so both keep their render (perf/shelf-divider-drag). The entry is new each render but its Shelf and
 * page are the layout's own (cached per layout, lib/sideLayout withShelves); `currentWidth` reads its box's ref, so the
 * first closure keeps working.
 */
function sameShelfView(a: ShelfViewProps, b: ShelfViewProps): boolean {
  return a.entry.shelf === b.entry.shelf && a.entry.page === b.entry.page && a.entry.only === b.entry.only && a.registry === b.registry && a.ctx === b.ctx && a.resizable === b.resizable && !!a.collapsed === !!b.collapsed && a.at === b.at;
}

const ShelfView = memo(function ShelfView({ entry, registry, ctx, resizable, currentWidth, collapsed = false, at }: ShelfViewProps) {
  const layout = useShelfLayout();
  const { shelf, page } = entry;
  // Drawn on its own side, or (two workspaces, 工作区的 Shelf Rail) on the side lib/workspaceRow gives it.
  const side = at ?? shelf.side;
  const pages = shelfLanePages(layout, shelf.id, ctx);
  const railFirst = collapsed ? side === "left" : (side === "left") === (shelf.options.railPlacement === "outer");
  const target: WidthTarget = { shelfId: shelf.id, side };
  const edge = resizable && !entry.only ? (side === "right" ? "left" : "right") : null;
  // Portrait (lib/portrait): the rail across the Shelf's edge toward the conversation, the panes under (or over) it.
  const across = useRailEdge();
  return (
    // Rail look A (owner 2026-10-23, shelfCard.css): expanded, the box is no card itself — the rail is a full-height
    // card and each pane its own rounded card attached to it, the standard gap between panes. Collapsed = one card,
    // the rail (as before).
    <div data-shelf={shelf.id} data-shelf-side={shelf.side} data-shelf-at={side} data-shelf-collapsed={collapsed ? "" : undefined} data-shelf-card={across ? `rail-${across}` : railFirst ? "rail-left" : "rail-right"} className={`${collapsed ? "shell-card " : ""}shelf-card relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden ${across ? (across === "top" ? "flex-col" : "flex-col-reverse") : railFirst ? "" : "flex-row-reverse"}`}>
      <ShelfRail shelf={shelf} pages={pages} shown={page.id} collapsed={collapsed} at={side} ctx={ctx} owner={<LiveOwner shelfId={shelf.id} collapsed={collapsed || !layout.open} shared={!!page.shared} side={side} />} />
      {!collapsed && (
        <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col" data-shelf-body="" data-side-column={page.id} data-side-column-focused={page.id === layout.activePage ? "" : undefined}>
          <ShelfPage entry={entry} registry={registry} ctx={ctx} edge={edge} currentWidth={currentWidth} target={target} />
        </div>
      )}
    </div>
  );
}, sameShelfView);

/**
 * A rail folded by a maximised / full-screen panel (§24.16): a click on one of its buttons first puts everything
 * back (then the button does its own thing — a page shows, the Shelf expands).
 */
function foldedClick(e: { target: EventTarget | null }): void {
  if (isElement(e.target) && e.target.closest("button")) restorePanels();
}

/**
 * A Shelf / pane maximised or full screen (§24.16): the conversation card becomes a strip of its conversations'
 * avatars (they stay mounted underneath, hidden); a click on one puts everything back and focuses it. `across`: the
 * portrait stack's strip (lib/portrait), its avatars in a row.
 */
function ConvStrip({ across = false }: { across?: boolean }) {
  const { t } = useI18n();
  const key = usePanes((s) =>
    conversationPanes(s.layout)
      .map((id) => {
        const b = paneBinding(s.layout, id);
        return b?.sessionId ? `${id}\u0000${b.hostId}\u0000${b.sessionId}` : "";
      })
      .filter(Boolean)
      .join("\n"),
  );
  const panes = key ? key.split("\n").map((x) => x.split("\u0000") as [string, string, string]) : [];
  return (
    <nav data-conv-strip="" aria-label={t("panel.convStrip")} title={t("panel.convStrip")} className={across ? "panel-fold flex h-full w-full flex-row items-center gap-1 px-1.5" : "panel-fold flex w-full flex-col items-center gap-1 py-1.5"} onClick={(e) => e.target === e.currentTarget && restorePanels()}>
      {panes.map(([paneId, hostId, sessionId]) => (
        <span key={paneId} data-conv-strip-pane={paneId}>
          <RailOwner
            hostId={hostId}
            sessionId={sessionId}
            onClick={() => {
              restorePanels();
              focusConversationPane(paneId);
            }}
          />
        </span>
      ))}
    </nav>
  );
}

/** While a conversation is maximised: the other conversation column's pane, host and session ("" none). */
function maxedOther(s: { layout: PaneLayout }): string {
  const l = s.layout;
  if (!l.max) return "";
  const panes = conversationPanes(l);
  const other = panes.find((id) => id !== l.max);
  const b = other ? paneBinding(l, other) : null;
  return other && b?.sessionId ? `${other}\u0000${b.hostId}\u0000${b.sessionId}` : "";
}

/**
 * Portrait: the other workspace while a conversation is maximised (§24.16; landscape shows it as its rail) — a 40 px
 * strip across the stack's top, its avatar and name (components/ConvStrip, as the strip of two workspaces without the
 * room); a click focuses it, which puts the layout back.
 */
function PortraitOtherStrip() {
  const key = usePanes(maxedOther);
  if (!key) return null;
  const [paneId, hostId, sessionId] = key.split("\u0000") as [string, string, string];
  return (
    <div data-portrait-part="strip" data-portrait-other={paneId} className="shell-card relative isolate flex shrink-0 overflow-hidden" style={{ height: STACK_RAIL_H, order: -1, marginBottom: STACK_GAP }}>
      <ConversationStrip paneId={paneId} hostId={hostId} sessionId={sessionId} across />
    </div>
  );
}

/** The other workspace while a conversation is maximised / full screen (§24.16): its rail (avatar on top, even with an empty Shelf). */
function OtherWorkspaceStrip({ at }: { at: ShelfSide }) {
  const key = usePanes(maxedOther);
  const name = useApp((s) => {
    if (!key) return "";
    const [, hostId, sessionId] = key.split("\u0000") as [string, string, string];
    const sidebar = sidebarOf(s, hostId);
    return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === sessionId)?.displayName ?? sessionId;
  });
  if (!key) return null;
  const [paneId, hostId, sessionId] = key.split("\u0000") as [string, string, string];
  return <WorkspaceRail paneId={paneId} hostId={hostId} sessionId={sessionId} name={name} at={at} order={at === "left" ? 0 : 6} always />;
}

/**
 * The key a Shelf's box remembers its last width under (lib/shelfMotion): its conversation's and its own id.
 * Shelf ids are unique within a conversation only — every conversation's first Shelf is often `s1`, and a
 * shared page's Shelf keeps its id in each conversation it shows in (lib/convShelves mergeShared) — so beside
 * two workspaces (or after a switch) the id alone mixed two Shelves up: one box moved from the other's width.
 */
function shelfBoxKey(conv: string | null, shelfId: string): string {
  return `${conv ?? ""}\u0000${shelfId}`;
}

/** shelfBoxKey of the focused conversation's Shelf `shelfId` (one workspace). */
function useLiveShelfKey(shelfId: string | null): string | null {
  const conv = useApp((s) => (s.selectedId ? convKey(agentHost(s), s.selectedId) : null));
  return shelfId === null ? null : shelfBoxKey(conv, shelfId);
}

/**
 * A Shelf's outer edge (checklist #38, owner 2026-10-21): by content, where the Shelf borders the desktop gap, it can
 * be dragged too — only the Shelf and the gap change (its column keeps its width, the group's far side stays;
 * lib/sideResize `outer`). Over the gap, outside the box.
 */
function OuterEdge({ shelfId, side, currentWidth, between = false }: { shelfId: string; side: ShelfSide; currentWidth: () => number; between?: boolean }) {
  const { t } = useI18n();
  const handle = useSideWidthHandle(currentWidth, { shelfId, side, outer: true, between });
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("pane.width")}
      tabIndex={0}
      title={t("shelf.resize")}
      data-shelf-outer-edge={between ? "between" : side}
      className={`side-handle-v absolute inset-y-0 z-10 w-2 cursor-col-resize outline-none ${side === "left" ? "-left-2" : "-right-2"}`}
      {...handle}
    />
  );
}

/** A collapsed right Shelf: its rail in the row after the conversations (the seam on its left). */
function RightRail({ entry, hidden, order, folded = false, still = false }: { entry: ShelfOnScreen; hidden: boolean; order?: number; folded?: boolean; still?: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const box = useRef<HTMLDivElement>(null);
  useShelfBoxMotion(box, useLiveShelfKey(entry.shelf.id), COLLAPSED_SHELF_WIDTH, true, true, null, still);
  return (
    <div ref={box} data-side-root data-shelf-box="right" data-panel-folded={folded ? "" : undefined} hidden={hidden} className="panel-fold relative flex shrink-0 justify-end pl-2" style={{ width: COLLAPSED_SHELF_WIDTH, order }} aria-label={t("side.column")} onClickCapture={folded ? foldedClick : undefined}>
      <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={false} currentWidth={() => 0} collapsed />
    </div>
  );
}

/** The right Shelf (or, maximised / full screen, the Shelf holding that page or pane), or the empty state. */
function SideColumns({ frame, registry, ctx }: { frame: SideFrame; registry: SideRegistry; ctx: SideViewContext; currentWidth: () => number }) {
  const { t } = useI18n();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const box = useRef<HTMLDivElement>(null);
  const currentWidth = () => box.current?.closest<HTMLElement>("[data-side-box]")?.offsetWidth ?? 0;
  const entries = columnsOnScreen(layout, ctx, mode);
  const entry = mode ? entries[0] : entries.find((x) => x.shelf.side === "right");
  const resizable = frame.kind === "flow" || frame.kind === "float" || frame.kind === "drawer";
  if (!entry) {
    return (
      <div ref={box} className="flex min-h-0 min-w-0 flex-1 flex-col" data-side-column="">
        <EmptyCard title={t("side.empty.title")} hint={t("side.empty.hint")} edge={null}>
          <EmptyShelfLaunchers pageId={null} />
        </EmptyCard>
      </div>
    );
  }
  return (
    <div ref={box} className="flex min-h-0 min-w-0 flex-1" data-side-columns="">
      <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={resizable} currentWidth={currentWidth} />
    </div>
  );
}

/**
 * The left Shelf: in the row before the conversations, its width handle on its right edge (the 8 px seam).
 * Collapsed: its rail only (no handle).
 */
function LeftShelf({ entry, width, hidden, collapsed, order, folded = false, still = false, outer = false }: { entry: ShelfOnScreen; width: number; hidden: boolean; collapsed: boolean; order?: number; folded?: boolean; still?: boolean; outer?: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const box = useRef<HTMLDivElement>(null);
  const currentWidth = () => (box.current?.offsetWidth ?? 0) - CARD_GAP;
  const handle = useSideWidthHandle(currentWidth, { shelfId: entry.shelf.id, side: "left" });
  const boxWidth = collapsed ? COLLAPSED_SHELF_WIDTH : width + CARD_GAP;
  useShelfBoxMotion(box, useLiveShelfKey(entry.shelf.id), boxWidth, collapsed, true, collapsed ? null : entry.page.id, still);
  return (
    // A maximised conversation pane covers it: hidden, its panes (and instances) stay mounted.
    <div ref={box} data-side-root data-shelf-box="left" data-panel-folded={folded ? "" : undefined} hidden={hidden} className="panel-fold relative flex shrink-0 pr-2" style={{ width: boxWidth, order }} aria-label={t("shelf.left")} onClickCapture={folded ? foldedClick : undefined}>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("pane.width")}
          tabIndex={0}
          title={t("shelf.resize")}
          className="side-handle-v absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize outline-none"
          {...handle}
        />
      )}
      {!collapsed && outer && <OuterEdge shelfId={entry.shelf.id} side="left" currentWidth={currentWidth} />}
      <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={!collapsed} currentWidth={currentWidth} collapsed={collapsed} />
    </div>
  );
}

function SideArea({ frame, areaWidth, covered, shelf, page, order, maxAt = "right", still = false, outer = false }: { frame: SideFrame; areaWidth: number; covered: boolean; shelf: string | null; page: string | null; order?: number; maxAt?: ShelfSide; still?: boolean; outer?: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const box = useRef<HTMLDivElement>(null);
  const motionKey = useLiveShelfKey(shelf);
  useShelfBoxMotion(box, frame.kind === "closed" ? null : motionKey, frame.width, false, frame.kind === "flow", page, still);
  // The box is the Shelf's width + its rail (lib/sideFrame: the 8 px seam is its left padding, inside that width) — as
  // SideColumns measures it. Taking CARD_GAP off here made every drag from the seam start 8 px narrow (a jump on press).
  const currentWidth = () => box.current?.offsetWidth ?? 0;
  const gap = useSideWidthHandle(currentWidth, shelf ? { shelfId: shelf, side: "right" } : null);
  const resizable = frame.kind === "flow" || frame.kind === "float" || frame.kind === "drawer";
  if (frame.kind === "closed") return null;

  let boxClass = "relative flex shrink-0";
  let style: CSSProperties = { width: frame.width };
  switch (frame.kind) {
    case "float":
      boxClass = "relative z-20 flex shrink-0 rounded-card bg-win pb-0 shadow-e2";
      style = { width: frame.width, marginLeft: frame.inFlow - frame.width };
      break;
    case "drawer":
      boxClass = "absolute inset-y-0 right-0 z-30 flex rounded-l-card bg-win shadow-e2";
      break;
    case "maximised":
    case "fullscreen":
      // §24.16: in the row, the rest of its width (the conversations a strip, the other Shelves their rails).
      boxClass = `panel-max relative flex min-w-0 flex-1 ${maxAt === "left" ? "pr-2" : "pl-2"}`;
      style = {};
      break;
  }
  const spacer = frame.kind === "drawer" ? frame.inFlow : 0;
  return (
    <>
      {spacer > 0 && !covered && <div className="shrink-0" style={{ width: spacer, order }} />}
      {/* A maximised conversation pane covers the tool area: hidden, its panes (and instances) stay mounted. */}
      <div ref={box} data-side-root data-side-box data-side-frame={frame.kind} data-panel-maxed={frame.kind === "maximised" || frame.kind === "fullscreen" ? "" : undefined} data-customize-region="sides" hidden={covered} className={boxClass} style={{ ...style, order }} aria-label={t("side.column")}>
        {/* The seam handle fills the 8 px left padding: the cards' (and the tab row's) left edge is flush against it. With the
            lane beside the open column the lane is the gap, the handle a thin strip over its left edge. */}
        <div className={`relative flex min-h-0 min-w-0 flex-1 ${resizable ? "pl-2" : ""}`}>
          {resizable && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("pane.width")}
              tabIndex={0}
              title={t("shelf.resize")}
              className="side-handle-v absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize outline-none"
              {...gap}
            />
          )}
          <SideColumns frame={frame} registry={registry} ctx={ctx} currentWidth={currentWidth} />
        </div>
        {outer && shelf && frame.kind === "flow" && <OuterEdge shelfId={shelf} side="right" currentWidth={currentWidth} />}
      </div>
      {frame.kind === "drawer" && areaWidth > 0 && (
        <span className="sr-only">
          <button onClick={closeColumn}>{t("side.drawerClose")}</button>
        </span>
      )}
    </>
  );
}

/**
 * Portrait (lib/portrait): the stack's Shelf band — a workspace's Shelves side by side (left first; P3, owner 2026-10-30
 * decision 11), the open ones with their Rail across the edge toward the conversation (RailEdgeContext), the others —
 * collapsed, or without the room for both (lib/portrait bandShelves) — as their upright rail at their side; or the tool
 * area's launchers. Its share of the stack's height (the divider sets it); no width handles. At the stack's top
 * (swapped) it leaves no tray room under it. `share` null: a maximised / full-screen Shelf or pane (§24.16) — all of the
 * stack but the conversations' strip. `place`: its grid cell (two workspaces side by side, each a column); `paneId`:
 * the other workspace's column (its Shelves are a peer's, lib/shelfSourceContext); `split`: two workspaces.
 */
function PortraitShelf({ open, rails, roomFolded = [], share, swapped, maxed = false, place = null, paneId = null, split = false }: { open: readonly ShelfOnScreen[]; rails: readonly ShelfOnScreen[]; roomFolded?: readonly string[]; share: number | null; swapped: boolean; maxed?: boolean; place?: CSSProperties | null; paneId?: string | null; split?: boolean }) {
  const { t } = useI18n();
  const peer = useShelfPeer();
  const sidePaneWidth = useLiveWidth("sidePaneWidth");
  const bandShare = usePortrait((s) => s.prefs.band);
  const bandRef = useRef<HTMLDivElement>(null);
  const all = [...open, ...rails].sort((a, b) => (a.shelf.side === b.shelf.side ? 0 : a.shelf.side === "left" ? -1 : 1));
  const both = open.length > 1;
  // P4: left + right side by side — their weights from the handle between them (this window's portrait pref), else
  // from their landscape widths.
  const weights = both ? bandWeights(bandShare, [open.find((e) => e.shelf.side === "left")?.shelf.width ?? sidePaneWidth, open.find((e) => e.shelf.side === "right")?.shelf.width ?? sidePaneWidth]) : null;
  const weightOf = (e: ShelfOnScreen) => (weights ? weights[e.shelf.side === "left" ? 0 : 1] : null);
  return (
    <div
      ref={bandRef}
      data-portrait-part="shelf"
      data-panel-maxed={maxed ? "" : undefined}
      className="relative flex min-h-0 min-w-0 flex-row gap-2"
      style={place ?? { flex: share === null ? "1 1 0px" : `${share} 1 0px`, minHeight: share === null ? 0 : STACK_SHELF_MIN, order: swapped ? 0 : 2 }}
      onPointerDownCapture={peer ? () => focusPeer(peer.key) : undefined}
      onFocusCapture={peer ? () => focusPeer(peer.key) : undefined}
    >
      {open.length ? (
        all.flatMap((e) =>
          open.includes(e) ? (
            [
              both && e.shelf.side === "right" ? <PortraitBandHandle key="band-handle" band={bandRef} share={weights![0] / (weights![0] + weights![1])} /> : null,
              <PortraitShelfBox key={e.shelf.id} entry={e} swapped={swapped} weight={weightOf(e)} paneId={paneId} sideBox={!split && e.shelf.side === "right"} />,
            ]
          ) : (
            <PortraitBandRail key={e.shelf.id} entry={e} swapped={swapped} roomFolded={roomFolded.includes(e.shelf.id)} paneId={paneId} />
          ),
        )
      ) : (
        <div data-side-root data-side-box data-side-frame="portrait" data-customize-region="sides" className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={{ marginBottom: swapped ? 0 : undefined }} aria-label={t("side.column")}>
          <EmptyCard title={t("side.empty.title")} hint={t("side.empty.hint")} edge={null}>
            <EmptyShelfLaunchers pageId={null} />
          </EmptyCard>
        </div>
      )}
    </div>
  );
}

/**
 * Portrait: one open Shelf of the band. `weight`: its share beside the other one (its own width; each keeps
 * BAND_SHELF_MIN); null: the band's whole width. Marked like its landscape box (the right one of a single workspace is
 * the side box; the left one, and any beside two workspaces, a Shelf box; the other workspace's its `data-ws-shelf`).
 */
function PortraitShelfBox({ entry, swapped, weight, paneId, sideBox }: { entry: ShelfOnScreen; swapped: boolean; weight: number | null; paneId: string | null; sideBox: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const box = useRef<HTMLDivElement>(null);
  const side = entry.shelf.side;
  return (
    <div
      ref={box}
      data-side-root
      data-side-box={sideBox ? "" : undefined}
      data-shelf-box={sideBox ? undefined : side}
      data-ws-shelf={paneId ?? undefined}
      data-side-frame="portrait"
      data-customize-region="sides"
      className="relative flex min-h-0 min-w-0 flex-col"
      style={{ flex: weight === null ? "1 1 0px" : `${weight} 1 0px`, minWidth: weight === null ? 0 : BAND_SHELF_MIN, marginBottom: swapped ? 0 : undefined }}
      aria-label={t(side === "left" ? "shelf.left" : "side.column")}
    >
      <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={false} currentWidth={() => box.current?.offsetWidth ?? 0} />
    </div>
  );
}

/**
 * Portrait (P4): the 8 px gap between the band's left and right Shelf is their handle — a drag sets the left one's share
 * of the two (live on the boxes' style, stored per window on release, portrait only: their landscape widths are never
 * written; each keeps BAND_SHELF_MIN); a double-click goes back to their landscape widths' ratio; ← / → step it (Shift:
 * bigger steps). `band`: the band's element (the two boxes are its open Shelves); `share`: the left one's share now.
 */
function PortraitBandHandle({ band, share }: { band: RefObject<HTMLDivElement | null>; share: number }) {
  const { t } = useI18n();
  const key = useWindowKey();
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; left: number; total: number; now: number } | null>(null);
  const boxes = () => [...(band.current?.querySelectorAll<HTMLElement>(':scope > [data-side-frame="portrait"]') ?? [])];
  const measure = () => {
    const [l, r] = boxes();
    const left = l?.getBoundingClientRect().width ?? 0;
    return { left, total: left + (r?.getBoundingClientRect().width ?? 0) };
  };
  const show = (s: number) => {
    const [l, r] = boxes();
    if (l) l.style.flex = `${s} 1 0px`;
    if (r) r.style.flex = `${Math.round((1 - s) * 1000) / 1000} 1 0px`;
    slotsRelayout();
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (d.now !== share) {
      quietNextStackGlide();
      setPortraitPrefs(key, { band: d.now });
    }
    resizeDrag(false);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("orientation.bandDivider")}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title={t("orientation.bandDividerHint")}
      data-portrait-band-handle=""
      data-dragging={dragging ? "" : undefined}
      className="portrait-band-handle"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const m = measure();
        drag.current = { x: e.clientX, left: m.left, total: m.total, now: share };
        setDragging(true);
        // A width drag session (lib/columnGlide): the panes' instances follow by style, the timeline's far rows stay
        // skipped, the turns' attachments keep their width until the release (perf/shelf-divider-drag).
        resizeDrag(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.total <= 0) return;
        d.now = clampBand((d.left + e.clientX - d.x) / d.total, d.total);
        show(d.now);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => setPortraitPrefs(key, { band: undefined })}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const d = (e.shiftKey ? SPLIT_STEP_BIG : SPLIT_STEP) * (e.key === "ArrowLeft" ? -1 : 1);
        setPortraitPrefs(key, { band: clampBand(share + d, measure().total) });
      }}
    />
  );
}

/**
 * Portrait: a Shelf of the band shown as its upright rail at its side — collapsed (its own layout: the rail works as
 * in landscape), or `roomFolded`: no room beside the other open one (a view only, its layout keeps it expanded) — a
 * click on its avatar, a page or the rail shows it in the band instead (its page in focus; the other one folds).
 */
function PortraitBandRail({ entry, swapped, roomFolded, paneId }: { entry: ShelfOnScreen; swapped: boolean; roomFolded: boolean; paneId: string | null }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  return (
    <RailEdgeContext.Provider value={null}>
      <RoomFoldedContext.Provider value={roomFolded}>
        <div
          data-side-root
          data-shelf-box={entry.shelf.side}
          data-ws-shelf={paneId ?? undefined}
          data-portrait-band-rail={roomFolded ? "room" : ""}
          className="relative flex shrink-0"
          style={{ width: RAIL_WIDTH, order: entry.shelf.side === "left" ? -1 : 1, marginBottom: swapped ? 0 : undefined }}
          aria-label={t(entry.shelf.side === "left" ? "shelf.left" : "side.column")}
          onClickCapture={roomFolded ? (e) => showRoomFolded(e, entry) : undefined}
        >
          <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={false} currentWidth={() => 0} collapsed />
        </div>
      </RoomFoldedContext.Provider>
    </RailEdgeContext.Provider>
  );
}

/**
 * A click on a rail folded for lack of room in the band (above): its page (or the one it shows) comes into focus, so
 * the band shows that Shelf — never its collapse toggle (it is not collapsed). The ⋯ menu, ＋ and the rest keep theirs.
 */
function showRoomFolded(e: { target: EventTarget | null; stopPropagation(): void; preventDefault(): void }, entry: ShelfOnScreen): void {
  const button = isElement(e.target) ? e.target.closest("button") : null;
  if (button && !button.matches("[data-shelf-page], [data-shelf-avatar]")) return;
  e.stopPropagation();
  e.preventDefault();
  openShelfPage(button?.getAttribute("data-shelf-page") || entry.page.id);
}

/**
 * Portrait: a folded Shelf (or a closed tool area's Shelf, Shelf Rail 常驻) — its rail as a 40 px bar across the stack's end.
 * `folded`: folded by a maximised conversation (§24.16) — a click on one of its buttons first puts everything back.
 */
function PortraitRail({ entry, swapped, folded = false }: { entry: ShelfOnScreen; swapped: boolean; folded?: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  return (
    <div data-side-root data-shelf-box={entry.shelf.side} data-portrait-part="rail" data-panel-folded={folded ? "" : undefined} className="relative flex min-w-0 flex-1" style={{ height: STACK_RAIL_H, marginBottom: swapped ? 0 : undefined }} aria-label={t(entry.shelf.side === "left" ? "shelf.left" : "side.column")} onClickCapture={folded ? foldedClick : undefined}>
      <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={false} currentWidth={() => 0} collapsed />
    </div>
  );
}

/**
 * Portrait: the 8 px gap between the conversation and its Shelf is the divider — a drag sets the conversation's share of
 * the two (live on the parts' style, stored per window on release; both keep their minimum, a snap near the default);
 * a double-click goes back to the default (58 %); ↑ / ↓ step it (Shift: bigger steps). Hovering it shows ⇅, which swaps
 * the two (also in the Shelf's ⋯ menu and Settings → 外观). `place` (P3, two workspaces side by side): its column's cell
 * of the stack's grid — the drag sets the rows of every column at once (portrait.css `--stack-rows`).
 */
function PortraitDivider({ row, split, swapped, place = null }: { row: RefObject<HTMLDivElement | null>; split: number; swapped: boolean; place?: CSSProperties | null }) {
  const { t } = useI18n();
  const key = useWindowKey();
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; conv: number; total: number; now: number } | null>(null);
  const parts = () => {
    const el = row.current;
    return {
      // One workspace: the conversation card; two (P2): the focused workspace's column (components/PaneHost).
      conv: el?.querySelector<HTMLElement>(':scope > [data-portrait-part="conversation"], :scope > .contents > [data-pane-columns] > [data-portrait-part="conversation"]') ?? null,
      shelf: el?.querySelector<HTMLElement>(':scope > [data-portrait-part="shelf"]') ?? null,
    };
  };
  /** The two parts' heights together (the divider not counted). */
  const total = () => {
    if (place) return Math.max(0, (row.current?.clientHeight ?? 0) - STACK_GAP);
    const { conv, shelf } = parts();
    return (conv?.getBoundingClientRect().height ?? 0) + (shelf?.getBoundingClientRect().height ?? 0);
  };
  const show = (share: number) => {
    if (place) {
      // The grid's rows (React sets the variable again from the stored split after the release).
      row.current?.style.setProperty("--stack-rows", stackRows(share, swapped));
      slotsRelayout();
      return;
    }
    const { conv, shelf } = parts();
    // The card's own style; two workspaces: the focused column follows the stack's variable (portrait.css; React owns it
    // there, so rotating back drops it — the one-workspace row is the landscape row's own element: nothing is left on it).
    if (conv?.hasAttribute("data-conv-card")) conv.style.flex = `${share} 1 0px`;
    else if (row.current?.hasAttribute("data-portrait-split")) row.current.style.setProperty("--stack-conv-flex", `${share} 1 0px`);
    if (shelf) shelf.style.flex = `${Math.round((1 - share) * 1000) / 1000} 1 0px`;
    // The Shelf panes' instances follow their slots in this frame (lib/sideSlots).
    slotsRelayout();
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (d.now !== split) {
      // The release stores what the drag already shows: no glide toward it (lib/portraitMotion).
      quietNextStackGlide();
      setPortraitPrefs(key, { split: d.now });
    }
    resizeDrag(false);
  };
  // ↑ moves the divider up: a smaller conversation on top, a bigger one below (swapped).
  const step = (up: boolean, big: boolean) => {
    const d = (big ? SPLIT_STEP_BIG : SPLIT_STEP) * (up === !swapped ? -1 : 1);
    setPortraitPrefs(key, { split: clampSplit(split + d, total()) });
  };
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("orientation.divider")}
      aria-valuenow={Math.round(split * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      title={t("orientation.dividerHint")}
      data-portrait-divider=""
      data-dragging={dragging ? "" : undefined}
      className="portrait-divider"
      style={place ? { ...place, height: STACK_GAP } : { height: STACK_GAP, order: 1 }}
      onPointerDown={(e) => {
        if (e.button !== 0 || (isElement(e.target) && e.target.closest("[data-portrait-swap]"))) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const { conv } = parts();
        drag.current = { y: e.clientY, conv: place ? split * total() : (conv?.getBoundingClientRect().height ?? 0), total: total(), now: split };
        setDragging(true);
        // As the band handle's: one drag session for the stack's parts (lib/columnGlide resizeDrag).
        resizeDrag(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.total <= 0) return;
        const dy = e.clientY - d.y;
        d.now = clampSplit((d.conv + (swapped ? -dy : dy)) / d.total, d.total);
        show(d.now);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={(e) => {
        if (isElement(e.target) && e.target.closest("[data-portrait-swap]")) return;
        setPortraitPrefs(key, { split: DEFAULT_PORTRAIT.split });
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        step(e.key === "ArrowUp", e.shiftKey);
      }}
    >
      <button type="button" data-portrait-swap="" className="portrait-swap" title={t("orientation.swapHint")} onClick={() => swapPortrait(key)}>
        <ArrowDownUp size={12} />
        {t(swapped ? "orientation.convOnTop" : "orientation.shelfOnTop")}
      </button>
    </div>
  );
}

/**
 * The single conversation column's two edges (in the gaps beside it, owner 2026-10-21): a drag moves only the edge
 * under the pointer, the other stays (docs/design/007: no symmetric exception any more) — the column is left off
 * centre and stays there (`setPinnedLead`; no re-centring after the release); it stops at the minimum and where its
 * Shelves begin (宽度规则 5). Live on the card's / row's style only; the release stores the width (appearance
 * singleColumnW, this machine) and the place; arrows step the same way; a double-click goes back to 单个对话的默认宽度
 * and re-centres. The width shows in a tip beside the edge (px and % of the row, lib/widthTip).
 * `seams`: no column edge on that side. An expanded Shelf borders it — the gap is its seam handle's (lib/sideResize: the
 * column gives what the Shelf takes, the Shelf's far side stays; owner 2026-10-23: the column's edge sat on top of
 * the seam and slid the whole Shelf along with it). A collapsed / empty rail has no Shelf width handle: keep the
 * column edge usable there, with the rail joined to the column as it resizes (owner 2026-10-25).
 */
function SingleColumnEdges({ card, lead, before, after, area, width, free, dragging, seams }: { card: RefObject<HTMLDivElement | null>; lead: number; before: number; after: number; area: number; width: number; free: number; dragging: RefObject<boolean>; seams: Readonly<Record<"left" | "right", boolean>> }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const drag = useRef<{ x: number; edge: "left" | "right"; start: number; now: { width: number; left: number }; moved: boolean } | null>(null);
  const edges = useRef<(HTMLDivElement | null)[]>([]);
  const left = lead + before;
  const rowW = area > 0 ? area : before + free + after;
  const sized = (edge: "left" | "right", start: number, dx: number, from = left) => oneEdgeWidth({ edge, start, dx, left: from, before, after, area: rowW, min: SINGLE_MIN_W });
  const show = (next: { width: number; left: number }) => {
    const el = card.current;
    if (el) {
      // A narrow column can start by filling the row (flex-1), without a stored width yet.
      el.style.flex = "0 1 auto";
      el.style.width = `${next.width}px`;
    }
    const row = el?.parentElement;
    if (row) {
      row.style.justifyContent = "flex-start";
      row.style.paddingLeft = `${next.left - before}px`;
    }
    if (edges.current[0]) edges.current[0].style.left = `${next.left - 8}px`;
    if (edges.current[1]) edges.current[1].style.left = `${next.left + next.width}px`;
  };
  const tip = (el: Element | null, w: number, y?: number, keys = false) => showWidthTip(el, w, { pct: widthPct(w, rowW), y, keys });
  const store = (next: { width: number; left: number }) => {
    setPinnedLead(next.left - before);
    setAppearance({ singleColumnW: next.width });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    dragging.current = false;
    hideWidthTip();
    resizeDrag(false);
    if (d.moved) store(d.now);
  };
  return (
    <>
      {(["left", "right"] as const).map((edge, i) => !seams[edge] && (
        <div
          key={edge}
          ref={(el) => void (edges.current[i] = el)}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("workSurface.columnWidth")}
          aria-valuenow={width}
          tabIndex={0}
          title={t("workSurface.columnWidthHint")}
          data-single-edge={edge}
          className="single-col-edge side-handle-v"
          style={{ left: edge === "left" ? left - 8 : left + width }}
          onDoubleClick={() => {
            setPinnedLead(null);
            setAppearance({ singleColumnW: 0 });
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            dragging.current = true;
            resizeDrag(true);
            drag.current = { x: e.clientX, edge, start: width, now: { width, left }, moved: false };
            tip(e.currentTarget, width, e.clientY);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            d.now = sized(d.edge, d.start, e.clientX - d.x);
            d.moved = true;
            show(d.now);
            tip(e.currentTarget, d.now.width, e.clientY);
          }}
          onPointerUp={end}
          onLostPointerCapture={end}
          onKeyDown={(e) => {
            const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!dir) return;
            e.preventDefault();
            // The same rule as a drag: only this edge moves by the step.
            const next = sized(edge, width, dir * (e.shiftKey ? 64 : 16));
            store(next);
            const el = e.currentTarget;
            win.requestAnimationFrame(() => tip(el, next.width, undefined, true));
          }}
        />
      ))}
    </>
  );
}

/**
 * Two workspaces by content (checklist #38, owner 2026-10-21): the conversation columns' edges that have no handle
 * of their own — between the two columns when nothing sits between them, a column's outer edge where it borders
 * the desktop gap. Only the two panels beside the edge change (the two columns; a column and the gap), the rest
 * of the group stays where it is (`setPinnedLead`); memory only like the Shelf's edge by content (lib/rowDrag
 * colW). Placed over the measured columns after each layout.
 */
function WsColumnEdges({ row, paneIds, between, outerLeft, outerRight, sidebarEdge, widths, lead, area, total }: { row: RefObject<HTMLDivElement | null>; paneIds: readonly string[]; between: boolean; outerLeft: boolean; outerRight: boolean; sidebarEdge: boolean; widths: readonly (number | null)[]; lead: number; area: number; total: number }) {
  const { t } = useI18n();
  const [at, setAt] = useState<{ a: number; b: number; c: number } | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const base = el.getBoundingClientRect().left;
    const box = (id: string | undefined) => (id ? el.querySelector<HTMLElement>(`[data-conv-pane="${CSS.escape(id)}"]`)?.getBoundingClientRect() : undefined);
    const [r0, r1] = [box(paneIds[0]), box(paneIds[1])];
    if (!r0 || !r1) return setAt(null);
    const next = { a: Math.round(r0.left - base), b: Math.round(r1.left - base), c: Math.round(r1.right - base) };
    setAt((prev) => (prev && prev.a === next.a && prev.b === next.b && prev.c === next.c ? prev : next));
  });
  const [w0, w1] = widths;
  if (!at || typeof w0 !== "number" || typeof w1 !== "number") return null;
  // The row as push items (lib/workspaceRow pushEdge): the desktop, what sits before / between / after the columns
  // (Shelves, rails, the seam: they slide), the columns, the desktop.
  const gapL = Math.max(0, lead);
  const gapR = Math.max(0, area - lead - total);
  const min = WS_CONVERSATION_MIN_W;
  const items: PushItem[] = [
    { w: gapL, gap: true },
    { w: Math.max(0, at.a - gapL), fixed: true },
    { w: w0, min },
    { w: Math.max(0, at.b - at.a - w0), fixed: true },
    { w: w1, min },
    { w: Math.max(0, gapL + total - at.c), fixed: true },
    { w: gapR, gap: true },
  ];
  const edge = (kind: "between" | "left" | "right", x: number) => {
    // Only this edge moves; the column it moves toward gives down to its minimum, then slides into the desktop (推挤).
    const sized = (dx: number): { w: [number, number]; lead: number } => {
      const { w } = pushEdge(items, kind === "left" ? 1 : kind === "between" ? 2 : 4, Math.round(dx));
      return { w: [w[2]!, w[4]!], lead: w[0]! };
    };
    const apply = (next: { w: [number, number]; lead: number }) => {
      setPinnedLead(next.lead);
      setColumnWidth(0, next.w[0]);
      setColumnWidth(1, next.w[1]);
    };
    const shown = (next: { w: [number, number] }) => (kind === "right" ? next.w[1] : next.w[0]);
    return (
      <WsEdge
        key={kind}
        kind={kind}
        x={x}
        label={t(kind === "between" ? "pane.split" : "workSurface.columnWidth")}
        sized={sized}
        apply={apply}
        tip={(el, next, y, keys) => showWidthTip(el, shown(next), { pct: widthPct(shown(next), area), y, keys })}
      />
    );
  };
  return (
    <>
      {between && edge("between", at.b - CARD_GAP)}
      {/* Against the sidebar (no desktop before the column) the gap is the sidebar's edge (lib/windowSidebar useSidebarEdge). */}
      {outerLeft && !(sidebarEdge && at.a <= 0) && edge("left", at.a - CARD_GAP)}
      {outerRight && edge("right", at.c)}
    </>
  );
}

function WsEdge({ kind, x, label, sized, apply, tip }: { kind: string; x: number; label: string; sized(dx: number): { w: [number, number]; lead: number }; apply(next: { w: [number, number]; lead: number }): void; tip(el: Element, next: { w: [number, number] }, y?: number, keys?: boolean): void }) {
  const win = useOwnerWindow();
  const drag = useRef<{ x: number; sized: (dx: number) => { w: [number, number]; lead: number } } | null>(null);
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    hideWidthTip();
    resizeDrag(false);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      data-ws-col-edge={kind}
      className="single-col-edge side-handle-v"
      style={{ left: x }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        resizeDrag(true);
        // The widths as the drag started (the props move under it).
        drag.current = { x: e.clientX, sized };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const next = d.sized(e.clientX - d.x);
        apply(next);
        tip(e.currentTarget, next, e.clientY);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = sized(dir * (e.shiftKey ? 64 : 16));
        apply(next);
        const el = e.currentTarget;
        win.requestAnimationFrame(() => tip(el, next, undefined, true));
      }}
    />
  );
}

/**
 * Two workspaces (§24.13, §24.15): one Shelf of a workspace, drawn on the side lib/workspaceRow gives it (工作区的
 * Shelf Rail: 外侧 / 永远偏右) — expanded at its width with its handle on the edge toward its column, or its rail
 * (stored as collapsed, or for lack of room). Both workspaces' Shelves are live (owner 2026-10-21): inside the
 * other workspace's (lib/shelfSourceContext) everything draws its conversation's Shelf with its view context; a
 * press or focus there gives that workspace the focus first (lib/shelfSource focusPeer), so the press acts on it
 * as the live layout — the box, its panes and their instances stay where they are (same keys, nothing remounts).
 */
function WsShelfBox({ entry, motionKey, at, expanded, box: boxWidth, hidden, order, still, paneId, outer = false, between = false }: { entry: ShelfOnScreen; motionKey: string; at: ShelfSide; expanded: boolean; box: number; hidden: boolean; order: number; still: boolean; paneId: string | null; outer?: boolean; between?: boolean }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const peer = useShelfPeer();
  const box = useRef<HTMLDivElement>(null);
  const currentWidth = () => (box.current?.offsetWidth ?? 0) - CARD_GAP;
  const handle = useSideWidthHandle(currentWidth, { shelfId: entry.shelf.id, side: at });
  // The row's width changed (the window resized, the sidebar folded): a Shelf shown as its rail for lack of room
  // (or back) takes its place at once — moving it frame by frame made the columns fly (owner 2026-10-21).
  useShelfBoxMotion(box, motionKey, boxWidth, !expanded, true, expanded ? entry.page.id : null, still);
  return (
    <div
      ref={box}
      data-side-root
      data-shelf-box={at}
      data-ws-shelf-box={entry.shelf.id}
      data-ws-peer={peer?.key}
      data-ws-shelf={peer && paneId ? paneId : undefined}
      onPointerDownCapture={peer ? () => focusPeer(peer.key) : undefined}
      onFocusCapture={peer ? () => focusPeer(peer.key) : undefined}
      hidden={hidden}
      className={`relative flex shrink-0 ${at === "left" ? "pr-2" : "justify-end pl-2"}`}
      style={{ width: boxWidth, order }}
      aria-label={t(at === "left" ? "shelf.left" : "side.column")}
    >
      {expanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("pane.width")}
          tabIndex={0}
          title={t("shelf.resize")}
          className={`side-handle-v absolute inset-y-0 z-10 w-2 cursor-col-resize outline-none ${at === "left" ? "right-0" : "left-0"}`}
          {...handle}
        />
      )}
      {expanded && (outer || between) && <OuterEdge shelfId={entry.shelf.id} side={at} currentWidth={currentWidth} between={between} />}
      <ShelfView entry={entry} registry={registry} ctx={ctx} resizable={expanded} currentWidth={currentWidth} collapsed={!expanded} at={at} />
    </div>
  );
}

/**
 * A workspace's Shelves beside two workspaces, left first: the expanded ones at their page in view, the collapsed
 * ones as their rails; a closed tool area with pages shows its rails (never nothing at all; one workspace: with
 * Shelf Rail 常驻 only). Pure.
 */
function workspaceShelves(layout: SideLayout, ctx: SideViewContext): ShelfOnScreen[] {
  const open = layout.open ? layout : { ...layout, open: true };
  const list = layout.open ? [...columnsOnScreen(open, ctx, null), ...railsOnScreen(open, ctx)] : [...railsOnScreen(open, ctx), ...columnsOnScreen(open, ctx, null)];
  return list.sort((a, b) => (a.shelf.side === b.shelf.side ? 0 : a.shelf.side === "left" ? -1 : 1));
}

/** Each conversation column's conversation (`convKey`, null: no agent), left first, read from the pane layout. */
function useWorkspaceKeys(): readonly (string | null)[] {
  const key = usePanes((s) =>
    conversationPanes(s.layout)
      .map((id) => {
        const b = paneBinding(s.layout, id);
        return b?.sessionId ? convKey(b.hostId, b.sessionId) : "";
      })
      .join("\n"),
  );
  return useMemo(() => key.split("\n").map((k) => k || null), [key]);
}

/** The conversation panes, left first (their ids). */
function useConvPaneIds(): readonly string[] {
  const key = usePanes((s) => conversationPanes(s.layout).join("\n"));
  return useMemo(() => (key ? key.split("\n") : []), [key]);
}

/** The other workspace's column (two workspaces): its host + agent, read from the pane layout. */
function useOtherWorkspace(focused: number): { paneId: string; hostId: string; sessionId: string | null } | null {
  const key = usePanes((s) => {
    const panes = conversationPanes(s.layout);
    const other = panes[focused === 0 ? 1 : 0];
    const b = other ? paneBinding(s.layout, other) : null;
    return b && other ? `${other}\u0000${b.hostId}\u0000${b.sessionId ?? ""}` : "";
  });
  return useMemo(() => {
    if (!key) return null;
    const [paneId, hostId, sessionId] = key.split("\u0000") as [string, string, string];
    return { paneId, hostId, sessionId: sessionId || null };
  }, [key]);
}

/**
 * The work area: the left Shelf, the main card (conversation or page) and, when `side`, the right Shelf.
 * Measures itself (narrow window, the Shelves' width limits). 工作区宽度 (§24.15, lib/workspaceRow): 按内容 =
 * the workspace (its column at its width + its Shelves) centred as a group, the desktop beside it; 铺满窗口 =
 * the column fills the row (widths only: 贴边显示 is its own switch). 宽度规则 (owner 2026-10-21): the focus never
 * changes the layout (both workspaces' Shelves live, each as its conversation left it), the Shelves fold once
 * when the second workspace opens without the room, an explicit expand that does not fit folds the other
 * workspace's; a width drag changes only the two panels beside its edge (a drag session pins the rest), by
 * content nothing re-centres until the row re-lays out (lib/rowDrag).
 * `split` (§24.13, two workspaces side by side): the main card dissolves (`display: contents`) so the two
 * conversation columns (ordered 2 and 5 by components/PaneHost) and the Shelves are items of one row — the
 * workspace's Shelves beside its conversation (order 3·i + 1 / 3·i + 3, on the side 工作区的 Shelf Rail gives
 * them; the other workspace's live too, lib/shelfSourceContext); widths from workspaceRow
 * (WsRowContext). The store's `narrow` (the right Shelf as a drawer) is the single workspace's only: beside two
 * workspaces nothing is a drawer, so Esc never closes the tool area there (the owner's 2026-10-21 report (a)).
 */
function LegacySideWorkArea({ side, covered = false, split = null, desk = false, single = null, children }: { side: boolean; covered?: boolean; split?: { focused: number } | null; desk?: boolean; single?: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The row's element: one workspace and two render different roots (the split row is a provider + its own
  // div), so the measuring follows the element that is mounted now. Bound once to the first one, the
  // observer kept a detached div after a second workspace opened: the row was laid out for a stale (or 0 =
  // "not measured") width — Shelves expanded beside columns that no longer fit, panes over the other
  // workspace — and the instance layer never saw the work area move (owner 2026-10-21).
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (el) setRowEl(el);
  }, []);
  // Portrait (lib/portrait): this window is portrait — the row is drawn as a stack (below), whatever it holds: one
  // workspace, two (the other folds to a strip, P2), a maximised conversation / Shelf / pane (it fills the stack, P2).
  const stack = usePortraitOn();
  const portraitPrefs = usePortrait((s) => s.prefs);
  // The row's width as last measured, and whether it was measured while drawn as the stack. The engine runs on the
  // stand-in (PORTRAIT_ROW) while the stack shows — and for the one render after rotating back, before the real row is
  // measured in that same commit (the measuring effect follows `stack`): no layout, effect or glide ever sees the
  // stack's width as the landscape row's.
  const [measuredRow, setMeasuredRow] = useState(UNMEASURED_ROW);
  const standIn = (stack || measuredRow.stack) && measuredRow.w > 0;
  const areaWidth = standIn ? PORTRAIT_ROW : measuredRow.w;
  // What the last commit drew (the measure reads it: the box it measures is that layout's).
  const stackDrawn = useRef(stack);
  useLayoutEffect(() => {
    stackDrawn.current = stack;
  });
  // The row's left edge on screen: the sidebar's / Settings Shelf's edge dragged moves it (宽度规则 2).
  const [rowLeft, setRowLeft] = useState(0);
  const sessionRef = useRef<RowSession | null>(null);
  const appearance = useAppearance();
  // The card left of the work area draws its width edge over the 8 px gap: the expanded sidebar (not its rail), or
  // the Settings Shelf in its slot beside it. A column against it (no desktop between) draws no left edge of its own
  // there — the whole gap is that card's handle (owner 2026-10-28: a press in the middle of the gap resized the
  // conversation, not the sidebar; like the Shelf seam below).
  const windowKey = useWindowKey();
  const settingsMax = useSettingsShelfMaximized();
  const settingsLeft = useSettingsShelf((s) => s.open && s.win === windowKey && s.side === "left") && !settingsMax;
  const settingsSlot = useSettingsShelfSlot((s) => !!s.left);
  const sidebarShown = useSidebarEdge((s) => s.shown);
  const sidebarEdge = sidebarShown || (settingsLeft && settingsSlot);
  // The default Shelf width (appearance.sidePaneWidth; live while its Settings slider / a default handle moves).
  const sidePaneWidth = useLiveWidth("sidePaneWidth");
  const { sideMode, sideNarrow } = useUiPrefs();
  const ctx = useSideView();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const live = useSide((s) => s.liveWidth);
  // A width drag in progress (lib/columnGlide onResizeDrag): what the row looked like when it started.
  const session = sessionRef.current;
  // An edge outside the row (the sidebar's, the Settings Shelf's) moved it since the drag began, on that side.
  const outsideAt: ShelfSide | null = session && areaWidth !== session.area ? (rowLeft !== session.rowLeft ? "left" : "right") : null;
  const outsideMoved = !session || !outsideAt ? 0 : outsideAt === "left" ? rowLeft - session.rowLeft : session.area - areaWidth;
  // 推挤 (owner 2026-10-23), the row filling: the panel beside that edge gives / takes it — a Shelf there changes its
  // width (down to its minimum: the sidebar's handle stops there, rowGive), the columns keep theirs.
  const besideStart = outsideAt ? session!.beside[outsideAt] : null;
  const beside = besideStart ? { ...besideStart, w: Math.round(Math.min(Math.max(RANGES.sidePaneWidth[1], besideStart.w), Math.max(Math.min(RANGES.sidePaneWidth[0], besideStart.w), besideStart.w - outsideMoved))) } : null;
  /** By the Shelf's shelfBoxKey (its conversation + id: beside two workspaces it may be the other workspace's). */
  const besideW = (key: string) => (beside && beside.key === key ? beside.w : undefined);
  const measured = useRef(0);
  useLayoutEffect(() => {
    const el = rowEl;
    if (!el) return;
    const measure = () => {
      // A detached row (between the swap and this effect) reports 0: never take that for the area.
      if (!el.isConnected) return;
      const w = el.clientWidth;
      // Drawn as the portrait stack: only noted (the stand-in holds); nothing of the landscape row is written from it.
      const inStack = stackDrawn.current;
      if (inStack) {
        setMeasuredRow((p) => (p.w === w && p.stack ? p : { w, stack: true }));
        return;
      }
      // The row changed width by itself (the window resized, a panel beside it opened): a group a drag left off
      // centre keeps its relative place in the free space (no re-centring jump). A width being dragged keeps what
      // it moved (the drag session). Not from the stand-in's row (the render right after rotating back).
      const last = lastRef.current;
      if (!resizing() && w !== measured.current && !last?.standIn) keepLeadShare(last && last.contentRow ? last.area - last.total : 0);
      measured.current = w;
      setMeasuredRow((p) => (p.w === w && !p.stack ? p : { w, stack: false }));
      setRowLeft(Math.round(el.getBoundingClientRect().left));
      setSideWorkWidth(w);
      noteColumns(el);
    };
    measure();
    // Laid out in the same frame (lib/syncResize: flushed synchronously): a ResizeObserver runs after layout and
    // before paint, so a plain state update was painted a frame late — for one frame the columns kept the old
    // window's pixel widths (by content: a 1100 → 1920 jump drew the fill layout, then the centred one; owner
    // 2026-10-21). One observer and one commit for the row, the Settings Shelf and the instance layer.
    const unobserve = observeSync(el, measure);
    const off = registerSideAnchor(el);
    return () => {
      unobserve();
      off();
    };
    // An orientation flip measures again in its own commit (before paint): the first landscape layout after the stack
    // uses the real row, never a frame at the stack's width.
  }, [rowEl, stack]);
  // 工作区宽度 as applied (智能: one workspace by content, two fill the window; lib/workspaceRow rowWidthMode).
  const widthMode = rowWidthMode(appearance.workspaceWidth, split ? 2 : 1);
  const byContent = widthMode === "content";
  // New Shelves' rail: Settings → Shelf Rail 在 Shelf 的 (lib/sideLayoutStore setEveryShelfRail sets the existing ones).
  useLayoutEffect(() => setNewShelfRailPlacement(appearance.shelfRailPlacement), [appearance.shelfRailPlacement]);
  // §24.12: each Shelf on screen shows its page in view; its box = its width + its rail.
  const shown = side && layout.open ? columnsOnScreen(layout, ctx, null) : [];
  // {{shelf}} Rail 常驻 (owner 2026-10-21, appearance.shelfRailAlways, default on): a closed tool area shows its
  // Shelves as their rails, an empty Shelf a rail of its own (the avatar + ＋), beside one workspace or two.
  const always = appearance.shelfRailAlways;
  // Collapsed Shelves: their rail only, a strip in place (not while a tool page / pane is maximised).
  const rails = side && !mode ? (layout.open ? railsOnScreen(layout, ctx) : always ? workspaceShelves(layout, ctx) : []) : [];
  // §24.16 maximised / full screen: a conversation (`covered`) or a Shelf / pane (`mode`) takes the rest of the
  // row; every other Shelf of this workspace shows as its rail (a view only: their layout is not changed), the
  // conversations beside a Shelf / pane as a strip of avatars, the other workspace as its rail.
  const maxEntry = side && mode ? (columnsOnScreen(layout, ctx, mode)[0] ?? null) : null;
  const toolMax = !!maxEntry;
  const panelMax = covered || toolMax;
  const foldable = panelMax ? [...shown, ...(side ? (layout.open ? railsOnScreen(layout, ctx) : always ? workspaceShelves(layout, ctx) : []) : [])] : [];
  const foldedAt = (at: ShelfSide) => foldable.find((x) => x.shelf.side === at && x.shelf.id !== maxEntry?.shelf.id) ?? null;
  const foldLeft = foldedAt("left");
  const foldRight = foldedAt("right");
  const maxAt: ShelfSide = maxEntry?.shelf.side ?? "right";
  const otherAt: ShelfSide = usePanes((s) => (s.layout.max && conversationPanes(s.layout).indexOf(s.layout.max) > 0 ? "left" : "right"));
  const widthOf = (e: ShelfOnScreen | undefined) => (e ? (besideW(shelfBoxKey(null, e.shelf.id)) ?? live[e.shelf.id] ?? e.shelf.width ?? sidePaneWidth) + RAIL_WIDTH : 0);
  const left = shown.find((x) => x.shelf.side === "left");
  const right = shown.find((x) => x.shelf.side === "right");
  const leftRail = left ? undefined : rails.find((x) => x.shelf.side === "left");
  const rightRail = right ? undefined : rails.find((x) => x.shelf.side === "right");
  const conversations = usePanes((s) => conversationPanes(s.layout).length);
  // 只看 Shelf (docs/design/002 补充, lib/shelfOnly), one workspace: the column is its strip — its minimum too.
  const shelfOnlyNow = useShelfOnlyPanes();
  const singleOnly = !!single && !split && shelfOnlyNow.includes(single);
  const convMin = singleOnly ? STRIP_W : conversations <= 1 ? MIN_CONVERSATION : conversations * CONVERSATION_MIN_W;
  // The left Shelf stays in the row while the conversations keep their minimum beside it (and beside the
  // right Shelf's minimum); else it leaves the screen until the window is wide enough again. A collapsed
  // Shelf takes its rail's width only.
  const leftW = widthOf(left);
  // Folds for lack of room keep a slack before they come back (lib/foldHysteresis): what the last render showed.
  const held = useRef({ leftOut: false, narrow: false, forced: false });
  // The row's width changed since the last render (the window resized, the sidebar folded): nothing glides or
  // eases then — every panel takes its new place at once (owner 2026-10-21: panels flying on a window resize).
  // Portrait: the stand-in counts as moved too — the boxes the stack did not draw come back (rotating back) in place,
  // with no open / close motion (two boxes of one Shelf, the maximised conversation's folded rail and its hidden box,
  // otherwise eased open again on that remount).
  const areaBefore = useRef(areaWidth);
  const areaMoved = areaBefore.current !== areaWidth || standIn;
  // §24 step 4 minSize: every conversation column and the right Shelf keep their minimum widths (the right
  // Shelf becomes the drawer before they squeeze).
  const emptyState = side && toolAreaShown(layout, ctx) && !shown.length && !rails.length;
  // Shelf Rail 常驻, one workspace: nothing of the conversation's Shelf on screen (empty, or no page for it) — its
  // empty rail on the right, counted in the row like a collapsed right Shelf's.
  const selectedHost = useApp(agentHost);
  const selectedId = useApp((s) => s.selectedId);
  const emptyRail = always && side && !split && !panelMax && !desk && !!selectedId && !shown.length && !rails.length && !emptyState;
  const { leftFits, leftTaken, rightRail: rightRailTaken, rightRoom } = shelfRow({
    areaWidth,
    left: left ? { collapsed: false, width: leftW } : leftRail ? { collapsed: true } : null,
    right: right ? "expanded" : rightRail || emptyRail ? "collapsed" : null,
    conversationMin: convMin,
    layered: !!mode,
    leftWasOut: held.current.leftOut,
  });
  const rightW = widthOf(right);
  const columns = (leftFits ? 1 : 0) + (right ? 1 : 0);
  // In this component's window (multi-window P3: a desk's work area is its own).
  const inMine = useInWindow();
  // The stand-in (portrait) is not the room a new column would get: the stack's real width is.
  const roomWidth = standIn ? measuredRow.w : areaWidth;
  // In the stack another conversation folds to a strip: it always has room (lib/paneRoom `stacked`).
  useEffect(() => inMine(() => setPaneRoom({ width: roomWidth, conversations, tools: side && toolAreaShown(layout, ctx) ? Math.max(1, columns) : 0, ...(stack ? { stacked: true } : {}) })), [inMine, roomWidth, conversations, side, layout, ctx, columns, stack]);
  const mins = singleOnly ? { ...frameMins(conversations, 1, CONVERSATION_MIN_W, DEFAULT_MIN_SIZE.w + RAIL_WIDTH), conversation: STRIP_W } : frameMins(conversations, 1, CONVERSATION_MIN_W, DEFAULT_MIN_SIZE.w + RAIL_WIDTH);
  // What this row needs beside the Settings Shelf (owner 2026-10-24): one workspace with its right Shelf expanded = the
  // conversation and that Shelf at their minimums (+ what the left Shelf / rails take, + the drawer's fold slack, so a
  // drawer shown for a frame does not hold). The Settings card gives it (down to its own minimum): expanding the Rail
  // takes room from the Settings Shelf instead of drawing the Shelf over the conversation.
  const rowNeed = side && !split && !mode && !!right ? Math.max(0, areaWidth - rightRoom) + mins.conversation + mins.side + FOLD_HYSTERESIS : 0;
  useEffect(() => setSettingsRowNeed(rowNeed), [rowNeed]);
  useEffect(() => () => setSettingsRowNeed(0), []);
  const frame = sideFrame({
    areaWidth: rightRoom,
    stored: right ? rightW : sidePaneWidth,
    open: side && (!!right || emptyState || (!!mode && (toolMax || toolAreaShown(layout, ctx)))),
    pages: 0,
    laneWhenHidden: "hide",
    pageBar: "tabs",
    mode: sideMode,
    layered: side ? (mode?.kind ?? null) : null,
    mins,
    wasNarrow: held.current.narrow,
  });
  const splitRow = !!split && side && !mode;
  // A drawer exists only beside one workspace (two: the Shelves are always in the row).
  const narrow = splitRow ? false : frame.narrow;
  useEffect(() => setNarrow(narrow), [narrow]);
  // The gutters (§19) follow the column: the part of the card a float / drawer covers.
  const cover = !splitRow && (frame.kind === "float" || frame.kind === "drawer") ? Math.max(0, frame.width - frame.inFlow) : 0;
  useEffect(() => publishSideFrame(cover), [cover]);
  // 窄窗口时 = 自动收起: entering a narrow window closes the column (it still opens as a drawer).
  const wasNarrow = useRef(narrow);
  useEffect(() => {
    if (narrow && !wasNarrow.current && sideNarrow === "auto-collapse" && useSide.getState().layout.open) updateLayout((l) => setOpen(l, false));
    wasNarrow.current = narrow;
  }, [narrow, sideNarrow]);
  const drawer = !splitRow && frame.kind === "drawer";

  // ── Two workspaces (§24.13 / §24.15) ──
  // The workspace whose Shelf is the live layout: the one showing the store's live conversation (normally the
  // focused pane; while a selection is still on its way, the Shelves stay where they are — never drawn on the
  // wrong workspace, which would unmount both Shelves' panes for a render).
  const liveIdx = usePanes((s) => {
    const key = liveConversation();
    if (!key) return -1;
    return conversationPanes(s.layout).findIndex((id) => {
      const b = paneBinding(s.layout, id);
      return !!b?.sessionId && convKey(b.hostId, b.sessionId) === key;
    });
  });
  const focusedIdx = split ? (liveIdx >= 0 ? liveIdx : split.focused) : 0;
  const other = useOtherWorkspace(focusedIdx);
  // Both workspaces' Shelves are live (owner 2026-10-21, §24.13): the other conversation's Shelf is a peer of the
  // store (lib/sideLayoutStore `peers`) — its own layout, instances mounted, drawn with its own view context.
  // 宽度规则: each keeps its own expanded / collapsed state and width; the focus never changes the layout.
  const otherKey = split && other?.sessionId ? convKey(other.hostId, other.sessionId) : null;
  useLayoutEffect(() => syncPeers(), [otherKey]);
  const peerSource = usePeerSource(splitRow ? otherKey : null);
  const otherCtx = usePeerViewContext(ctx, peerSource);
  const otherView = peerSource?.layout ?? null;
  const otherShelves: ShelfOnScreen[] = splitRow && otherView && otherCtx ? workspaceShelves(otherView, otherCtx) : [];
  const focusedShelves: ShelfOnScreen[] = splitRow ? workspaceShelves(layout, ctx) : [];
  // Whose each Shelf is (the conversation of its workspace's column): a Shelf id is unique within its conversation
  // only (shelfBoxKey) — the two workspaces' Shelves are told apart by conversation + id.
  const wsKeys = useWorkspaceKeys();
  const ownerOf = (idx: number) => wsKeys[idx] ?? `#${idx}`;
  // Shelf Rail 常驻 beside two workspaces: a workspace with a conversation and nothing of its Shelf on screen shows
  // its empty rail (lib/workspaceRow `rail`: counted in the row, drawn at `railAt`).
  // 收起一个会话 (docs/design/002): a workspace folded to its strip draws no Shelf and no rail (lib/workspaceRow `strip`).
  const stripWs = useStripFlags().map((x) => x && splitRow);
  // 只看 Shelf beside another workspace: a strip that keeps its Shelves (lib/workspaceRow `keepShelves`).
  const onlyWs = useShelfOnlyFlags().map((x) => x && splitRow);
  const emptyWs = [0, 1].map((i) => always && splitRow && !stripWs[i] && !!wsKeys[i] && (i === focusedIdx ? focusedShelves : otherShelves).length === 0);
  const want = columnWant({ area: areaWidth, count: splitRow ? 2 : 1, readingWidth: appearance.readingWidth, mode: appearance.singleWidth, pct: appearance.singleWidthPct, dragged: appearance.singleColumnW });
  // What a drag left of the row (lib/rowDrag), each field on its own: the handle between two filling columns
  // moves their widths in the DOM while dragged and stores the share on release (components/PaneResizer
  // RowSplitter) — nothing here re-renders per move.
  const colW = useRowDrag((s) => s.colW);
  const pinLead = useRowDrag((s) => s.lead);
  const pinShare = useRowDrag((s) => s.leadShare);
  const share = useStoredShare();
  // 推挤: px the dragged Shelf, at its minimum, is pushed on into the free desktop (lib/sideResize, lib/rowDrag push).
  const pushNow = useRowDrag((s) => s.push);
  const push = session?.edge ? pushNow : 0;
  // A width being dragged (liveWidth) is the live layout's Shelf's: the other workspace's Shelf takes the focus
  // before its edge moves (lib/shelfSource focusPeer), and may have a Shelf of the same id.
  // Two Shelves of a workspace on one side (beside two workspaces): the outer one's edge toward its column borders the
  // inner one — that one gives / takes what it takes (推挤: the panel beside the edge), the column keeps its width.
  const pairDragged = session ? Object.keys(live).find((id) => live[id] !== undefined && session.pairs[shelfBoxKey(splitRow ? ownerOf(focusedIdx) : null, id)]) : undefined;
  const pairStart = pairDragged ? session!.pairs[shelfBoxKey(splitRow ? ownerOf(focusedIdx) : null, pairDragged)]! : null;
  const pairNow = pairStart && pairDragged ? { id: pairStart.id, w: Math.max(Math.min(RANGES.sidePaneWidth[0], pairStart.w), pairStart.w - (live[pairDragged]! - pairStart.from)) } : null;
  const boxKeyOf = (e: ShelfOnScreen, peer: boolean) => shelfBoxKey(splitRow ? ownerOf(peer ? 1 - focusedIdx : focusedIdx) : null, e.shelf.id);
  const shelfW = (e: ShelfOnScreen, peer = false) => besideW(boxKeyOf(e, peer)) ?? (peer ? undefined : ((pairNow?.id === e.shelf.id ? pairNow.w : undefined) ?? live[e.shelf.id])) ?? e.shelf.width ?? sidePaneWidth;
  const liveExpanded = splitRow ? focusedShelves.filter((e) => layout.open && !e.shelf.collapsed) : shown;
  // How much the focused workspace's Shelves grew since the drag started (only its own column gives way: 宽度规则 1).
  // (The session's widths are by shelfBoxKey: a drag on the other workspace's Shelf makes it the live one mid-press.)
  const liveOwner = splitRow ? ownerOf(focusedIdx) : null;
  const startW = (e: ShelfOnScreen) => session?.shelfW[shelfBoxKey(liveOwner, e.shelf.id)];
  const shelfDelta = session?.edge ? liveExpanded.reduce((d, e) => d + (startW(e) === undefined ? 0 : shelfW(e) - startW(e)!), 0) : 0;
  // A Shelf's outer edge (#38, by content): only the Shelf and the gap change — its column keeps its width. Between two
  // workspaces' columns (永远偏右, `between`) the next column is what gives.
  const outerEdge = session?.edge?.outer ? session.edge : null;
  const shelfDrag = !!session?.edge && (shelfDelta !== 0 || push > 0);
  const fillSplit = splitRow && (widthMode === "fill" || want === null);
  let pin: RowPin | null = null;
  if (session && fillSplit) {
    const idx = shelfDrag ? (outerEdge?.between ? focusedIdx : pinIndex({ shelfOf: focusedIdx })) : outsideAt ? pinIndex({ edge: outsideAt }) : null;
    const w = idx === null ? undefined : session.widths[idx];
    if (idx !== null && typeof w === "number") pin = { index: idx, width: w };
  }
  // By content an edge outside the row moves nothing but the free desktop (推挤): the group keeps its place, then slides
  // (groupLead keeps it inside the row) — the columns keep their widths, the edge stops where no desktop is left (rowGive).
  // A Shelf's edge toward its column: the column gives down to its minimum, then slides (lib/workspaceRow seamPush).
  const seamOf = (start: number, min: number) => seamPush({ start, min, delta: shelfDelta, push, shelfAt: session!.edge!.side });
  const wantOf = (i: number): number | null => {
    const start = session?.widths[i];
    // An edge outside the row: by content the columns keep their widths (only the desktop changes, 推挤).
    if (session && !fillSplit && outsideAt && !shelfDrag && typeof start === "number") return start;
    if (session && !fillSplit && shelfDrag && typeof start === "number") {
      if (outerEdge?.between) return i === focusedIdx ? start : seamPush({ start, min: WS_CONVERSATION_MIN_W, delta: shelfDelta, push, shelfAt: "left" }).width;
      if (i === focusedIdx) return outerEdge ? start : seamOf(start, WS_CONVERSATION_MIN_W).width;
    }
    return colW[i] ?? want;
  };
  const baseRow = splitRow
    ? workspaceRow({
        area: areaWidth,
        mode: widthMode,
        placement: appearance.wsRailPlacement,
        split: share.value,
        pin,
        held: held.current.forced,
        workspaces: [0, 1].map((i) =>
          i === focusedIdx
            ? { want: wantOf(i), min: WS_CONVERSATION_MIN_W, rail: emptyWs[i]!, shelves: focusedShelves.map((e) => ({ id: e.shelf.id, side: e.shelf.side, width: shelfW(e), collapsed: !layout.open || !!e.shelf.collapsed })) }
            : { want: wantOf(i), min: WS_CONVERSATION_MIN_W, rail: emptyWs[i]!, shelves: otherShelves.map((e) => ({ id: e.shelf.id, side: e.shelf.side, width: shelfW(e, true), collapsed: !otherView!.open || !!e.shelf.collapsed })) },
        ).map((w, i) => (stripWs[i] ? { ...w, strip: true, shelves: [], rail: false } : onlyWs[i] ? { ...w, strip: true, keepShelves: true, rail: false } : w)),
      })
    : null;
  // 最大化 (rule 2, owner 2026-10-21, lib/panelGrow): the maximised panel takes every gap of the row — and, filling,
  // what the other columns give down to the default reading width —, the rest keeps its width and slides aside.
  const grow = useGrow((s) => s.target);
  // 最大化 / 还原 is one change of the whole row: its geometry is taken before the commit (a store listener runs
  // while the DOM is still the old one) and the row slides as a whole (lib/columnGlide armRowGlide) — gliding the
  // columns one by one jumped on the first frame and snapped on the last (owner 2026-10-22).
  useEffect(() => useGrow.subscribe((s, p) => void (s.target !== p.target && armRowGlide(ref.current))), []);
  const convPaneIds = useConvPaneIds();
  const readingW = appearance.readingWidth > 0 ? appearance.readingWidth + CARD_CHROME : WS_CONVERSATION_MIN_W;
  // Drawn on top of the stored widths only until the row stores them (lib/panelGrow baked).
  const baked = useGrow((s) => s.baked);
  const growLive = !!grow && !baked && side && !panelMax && !desk;
  const empties = emptyWs.map((e) => (e ? COLLAPSED_SHELF_WIDTH : 0));
  const shrinkTo = baseRow?.mode === "fill" ? readingW : null;
  const growWs = !growLive || !baseRow ? -1 : grow!.kind === "conv" ? convPaneIds.indexOf(grow!.paneId) : [0, 1].find((i) => ownerOf(i) === grow!.conv) ?? -1;
  const row = baseRow && growWs >= 0 ? growRow({ row: baseRow, area: areaWidth, empties, shrinkTo, target: { ws: growWs, shelfId: grow!.kind === "shelf" ? grow!.shelfId : null } }) : baseRow;

  // The single conversation column (owner 2026-10-21, lib/workSurface): its width; the row centres it with its
  // Shelves (按内容); null = it fills the room the Shelves leave.
  const rightFlow = frame.kind === "flow" ? frame.width : frame.kind === "closed" ? 0 : frame.inFlow;
  // A collapsed right Shelf's strip, or the empty rail (Shelf Rail 常驻).
  const rightStrip = rightRail || emptyRail ? rightRailTaken : 0;
  const free = areaWidth - leftTaken - rightFlow - rightStrip;
  const singleRow = !!(byContent && single && !split && !mode && areaWidth > 0);
  // A drag left the group where it is (a pinned lead): the column keeps its width — no fill snap that would move its far
  // edge by up to FILL_SLACK after the release (推挤 leaves a sliver of desktop as it is).
  let singleW = singleRow ? singleColumnWidth({ area: areaWidth, free, readingWidth: appearance.readingWidth, mode: appearance.singleWidth, pct: appearance.singleWidthPct, dragged: appearance.singleColumnW, snap: pinLead === null }) : null;
  // What it would be without the drag in progress (the release stores the shown one when they differ).
  const singleNatural = singleW;
  // A Shelf's edge dragged beside it: the column gives (or takes) exactly what the Shelf takes (宽度规则 1), down to its
  // minimum, then slides (推挤) — also where its own width would now snap to filling the row (lib/workspaceRow seamPush).
  const singleAdjusted = !!session && singleRow && !splitRow && session.singleW !== null && shelfDrag && !outerEdge;
  const singleSeam = singleAdjusted ? seamOf(session!.singleW!, Math.min(SINGLE_MIN_W, free)) : null;
  if (singleSeam) singleW = Math.min(Math.max(0, free), singleSeam.width);
  // An edge outside the row moved it: the column keeps its width (the desktop beside it gives, then the group slides),
  // or keeps filling the row if it did when the drag began — no fill snap either way mid-drag.
  if (singleRow && !singleOnly && session && outsideAt && session.singleW !== null) singleW = session.filled ? null : Math.min(Math.max(0, free), session.singleW);
  // 只看 Shelf: the column is its strip whatever 工作区宽度 says (its Shelf took the width).
  if (singleOnly) singleW = STRIP_W;
  // The row stopped fitting (narrower window, a second workspace): the live Shelves fold to their rails once
  // before the columns narrow (lib/workspaceRow shouldFoldShelves; not when the owner expanded one).
  const singleFits =
    !byContent || !single || split || mode || sideMode === "float" || want === null
      ? true
      : workspaceRow({ area: areaWidth, mode: "content", placement: "outer", workspaces: [{ want, min: MIN_CONVERSATION, rail: emptyRail, shelves: [...shown, ...rails].map((e) => ({ id: e.shelf.id, side: e.shelf.side, width: shelfW(e), collapsed: !!e.shelf.collapsed || !layout.open })) }] }).fits;
  const fits = row ? row.fits : singleFits;
  // 宽度规则 A (owner 2026-10-21): nothing folds by itself except (1) the second workspace opening without the
  // room — every Shelf on screen folds to its rail once — and (2) the owner expanding a Shelf that does not
  // fit: the other workspace's Shelf folds. The focus moving changes nothing (each Shelf's state is its
  // conversation's), the window narrowing neither (the columns narrow, then a Shelf shows as its rail unstored).
  const focusedKey = useApp((s) => (s.selectedId ? convKey(agentHost(s), s.selectedId) : null));
  const otherRowKey = splitRow ? otherKey : null;
  const expandedNow: Record<string, string[]> = {};
  if (focusedKey) expandedNow[focusedKey] = liveExpanded.map((e) => e.shelf.id);
  if (otherRowKey && otherRowKey !== focusedKey) expandedNow[otherRowKey] = otherShelves.filter((e) => otherView!.open && !e.shelf.collapsed).map((e) => e.shelf.id);
  const expandedSig = Object.entries(expandedNow)
    .map(([k, v]) => `${k}=${v.join(",")}`)
    .sort()
    .join(";");
  const foldAt = useRef<{ area: number; count: number; fits: boolean } | null>(null);
  const expandedAt = useRef<Record<string, string[]> | null>(null);
  useEffect(() => {
    // Maximised / full screen changes nothing of the Shelves (§24.16): the row is compared again once it is back.
    if (covered || mode) return;
    const now = { area: areaWidth, count: splitRow ? 2 : 1, fits };
    const foldLive = () => updateLayout((l) => shelvesOf(l).reduce((acc, x) => (x.collapsed ? acc : collapseShelf(acc, x.id)), l));
    if (side && shouldFoldShelves(foldAt.current, now)) {
      foldLive();
      if (otherRowKey) collapseConvShelves(otherRowKey);
    } else if (side && splitRow && !fits && areaWidth > 0) {
      const opened = newlyExpanded(expandedAt.current, expandedNow);
      if (opened.includes(focusedKey ?? "") && otherRowKey && (expandedNow[otherRowKey]?.length ?? 0) > 0) collapseConvShelves(otherRowKey);
      else if (otherRowKey && opened.includes(otherRowKey) && liveExpanded.length) foldLive();
    }
    foldAt.current = now;
    expandedAt.current = expandedNow;
  }, [areaWidth, splitRow, fits, side, mode, covered, expandedSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // 贴边显示 (owner 2026-10-21): its own switch, only while the panes fill the work area — 铺满窗口 / 智能 only set widths.
  const fills = row ? row.mode === "fill" || !row.fits : singleW === null;
  // The portrait stack fills the work area (its parts span it).
  const edge = edgeToEdge({ setting: appearance.edgeToEdge, deskOn: desk, narrowColumn: !fills && !stack });
  // Before paint: the margins go in the same frame as the layout that fills (a frame of the filling layout with the margins).
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-edge-to-edge", edge);
    return () => root.removeAttribute("data-edge-to-edge");
  }, [edge]);
  const dragging = useRef(false);
  const takenAt = (at: ShelfSide) => (row?.workspaces ?? []).reduce((n, w, i) => n + w.shelves.filter((x) => x.at === at).reduce((m, x) => m + x.box, 0) + (emptyWs[i] && w.railAt === at ? COLLAPSED_SHELF_WIDTH : 0), 0);
  const rightTaken = splitRow ? takenAt("right") : frame.kind === "flow" ? frame.width : rightRailTaken;
  const leftTakenNow = splitRow ? takenAt("left") : leftTaken;
  useEffect(() => setShelvesTaken(leftTakenNow, rightTaken), [leftTakenNow, rightTaken]);
  // Two workspaces: a Shelf's handle stops where the row would have to fold it (both columns' minimum, the gap
  // between them, the Shelf's seam); its own column's minimum is lib/sideResize's row hook (below).
  const reserve = splitRow ? 2 * WS_CONVERSATION_MIN_W + 2 * CARD_GAP - MIN_CONVERSATION : 0;
  useEffect(() => setRowReserve(reserve), [reserve]);

  // By content the group stays where a drag left it (宽度规则 2): the sidebar's / Settings Shelf's edge moves the
  // row under it, the group keeps its place on screen; after the release no re-centring jump.
  let groupTotal = row
    ? row.workspaces.reduce((n, w, i) => n + (w.width ?? 0) + w.shelves.reduce((m, x) => m + x.box, 0) + (emptyWs[i] ? COLLAPSED_SHELF_WIDTH : 0), 0) + CARD_GAP
    : leftTaken + (singleW ?? 0) + rightFlow + rightStrip;
  // 最大化 beside one workspace: the free row (by content) and, filling, the column above the reading width.
  const singleConv = !splitRow ? (convPaneIds[0] ?? single) : null;
  const contentSingle = !row && byContent && singleW !== null && !panelMax;
  const liveConvKey = useApp((s) => (s.selectedId ? convKey(agentHost(s), s.selectedId) : null));
  const singleRoomConv = !row && singleConv && !panelMax && !desk ? singleGrowRoom({ kind: "conv", area: areaWidth, groupTotal, byContent: contentSingle, column: free, readingW }) : 0;
  const singleRoomShelf = !row && !panelMax && !desk ? singleGrowRoom({ kind: "shelf", area: areaWidth, groupTotal, byContent: contentSingle, column: free, readingW }) : 0;
  let growConvPx = 0;
  let growLeftPx = 0;
  let growRightPx = 0;
  let narrowedTo: number | null = null;
  if (growLive && !row && grow) {
    if (grow.kind === "conv" && grow.paneId === singleConv && contentSingle) growConvPx = singleRoomConv;
    else if (grow.kind === "shelf" && grow.conv === liveConvKey) {
      const onLeft = !!left && leftFits && left.shelf.id === grow.shelfId;
      const onRight = !!right && frame.kind === "flow" && right.shelf.id === grow.shelfId;
      if (onLeft || onRight) {
        if (singleW === null && free > readingW) narrowedTo = readingW;
        if (onLeft) growLeftPx = singleRoomShelf;
        else growRightPx = singleRoomShelf;
      }
    }
  }
  const growPx = growConvPx + growLeftPx + growRightPx;
  const singleShown = singleW !== null ? singleW + growConvPx : narrowedTo;
  // Filling by content still has an edge: dragging inward gives it an explicit width. Count the rail in
  // `free`, so even a narrow row cannot grow the conversation underneath the collapsed page buttons.
  const singleEdgeWidth = singleShown ?? (singleRow && !panelMax ? Math.max(0, free) : null);
  if (growPx > 0 && contentSingle) groupTotal += growPx;
  const rowWidths = row ? row.workspaces.map((w) => w.width) : [singleShown];
  // The rooms the 最大化 buttons read (greyed at 0), from the row without it.
  const roomSig = row
    ? `${convPaneIds.map((id, i) => `${id}=${baseRow ? rowGrowRoom({ row: baseRow, area: areaWidth, empties, shrinkTo, target: { ws: i, shelfId: null } }) : 0}`).join(",")}|${baseRow ? rowGrowRoom({ row: baseRow, area: areaWidth, empties, shrinkTo, target: { ws: focusedIdx, shelfId: "" } }) : 0}`
    : `${singleConv ?? ""}=${singleRoomConv}|${singleRoomShelf}`;
  useEffect(() => {
    // Portrait: the stand-in row's gaps are no room (a stack has none; lib/paneActions toggleMaximize fills it instead).
    if (panelMax || desk || !side || stack) return setGrowRoom({ conv: {}, shelf: 0 });
    const [convs, shelf] = roomSig.split("|");
    const conv: Record<string, number> = {};
    for (const part of (convs ?? "").split(",")) {
      const at = part.lastIndexOf("=");
      if (at > 0) conv[part.slice(0, at)] = Number(part.slice(at + 1));
    }
    setGrowRoom({ conv, shelf: Number(shelf) || 0 });
  }, [roomSig, panelMax, desk, side, stack]);
  const contentRow = row ? row.centred : byContent && singleW !== null && !panelMax;
  // A Shelf's edge dragged (推挤): where the group's left edge went — a left Shelf's outer edge moves it by what the
  // Shelf grew, a Shelf pushed at its minimum or a column pushed at its own takes it along when that is to the left.
  const seamShift = !session?.edge
    ? 0
    : outerEdge
      ? outerEdge.side === "left" && !outerEdge.between
        ? push - shelfDelta
        : -push
      : splitRow
        ? typeof session.widths[focusedIdx] === "number"
          ? seamOf(session.widths[focusedIdx] as number, WS_CONVERSATION_MIN_W).shift
          : 0
        : (singleSeam?.shift ?? 0);
  // (A seam that only trades width between the Shelf and its column keeps the group centred as it was: no lead.)
  const leadIn =
    contentRow && session && session.lead !== null && session.edge && (outerEdge || seamShift !== 0 || groupTotal !== session.total)
      ? session.lead + seamShift
      : contentRow && session && session.lead !== null && areaWidth !== session.area
        ? shiftedLead(session.lead, session.rowLeft, rowLeft)
        : contentRow
          ? pinnedLead({ lead: pinLead, leadShare: pinShare }, areaWidth - groupTotal)
          : null;
  const lead = contentRow ? groupLead({ area: areaWidth, total: groupTotal, pinned: leadIn }) : 0;
  // A Shelf's outer edge only where free desktop borders it (else it overlapped the sidebar's edge and did nothing);
  // kept while it is the edge being dragged (it closes the gap itself).
  const outerDragged = (at: ShelfSide) => !!session?.edge?.outer && session.edge.side === at;
  const outerRoom = { left: lead >= 1 || outerDragged("left"), right: areaWidth - lead - groupTotal >= 1 || outerDragged("right") };
  const leadStyle: CSSProperties | undefined = contentRow && leadIn !== null ? { justifyContent: "flex-start", paddingLeft: lead } : undefined;
  // What the drag session and lib/sideResize's row hooks read (the last render).
  const shelfWidths: Record<string, number> = {};
  for (const e of liveExpanded) shelfWidths[e.shelf.id] = shelfW(e);
  // Every expanded Shelf of the row, the other workspace's too: a drag on the other workspace's Shelf edge gives it
  // the focus in the same press (lib/shelfSource focusPeer) — the session must know that Shelf's starting width.
  const shelfWidthsAll: Record<string, number> = {};
  for (const e of liveExpanded) shelfWidthsAll[shelfBoxKey(liveOwner, e.shelf.id)] = shelfW(e);
  if (splitRow) for (const e of otherShelves) if (otherView?.open && !e.shelf.collapsed) shelfWidthsAll[shelfBoxKey(ownerOf(focusedIdx === 0 ? 1 : 0), e.shelf.id)] = shelfW(e, true);
  // Which side of its column each live Shelf is on (推挤: the column slides away from it), and the live Shelf at each end
  // of a filling row (an edge outside the row gives / takes from it).
  const shelfAt: Record<string, ShelfSide> = {};
  for (const e of liveExpanded) shelfAt[e.shelf.id] = splitRow ? (row?.workspaces[focusedIdx]?.shelves.find((x) => x.id === e.shelf.id)?.at ?? e.shelf.side) : e.shelf.side;
  const endShelf = (at: ShelfSide): EndShelf | null => {
    if (contentRow || growLive || panelMax) return null;
    if (!row) {
      const e = at === "left" ? (left && leftFits ? left : undefined) : right && frame.kind === "flow" ? right : undefined;
      return e ? { key: shelfBoxKey(null, e.shelf.id), id: e.shelf.id, w: shelfW(e), peer: null } : null;
    }
    const idx = at === "left" ? 0 : row.workspaces.length - 1;
    const peer = idx !== focusedIdx;
    if (peer && !otherKey) return null;
    // A rail before it only slides (lib/workspaceRow pushEdge): the expanded Shelf nearest the edge is the panel beside it.
    const outs = row.workspaces[idx]!.shelves.filter((x) => x.at === at && x.expanded);
    const end = at === "left" ? outs[0] : outs[outs.length - 1];
    const e = end ? (peer ? otherShelves : liveExpanded).find((x) => x.shelf.id === end.id) : undefined;
    return e ? { key: boxKeyOf(e, peer), id: e.shelf.id, w: shelfW(e, peer), peer: peer ? otherKey : null } : null;
  };
  // Two workspaces, 永远偏右: the left workspace's outermost expanded Shelf before the other column (a rail after it only
  // slides): its far edge is the handle there.
  const betweenOut = row && row.workspaces.length === 2 && !stripWs[0] && !stripWs[1] ? row.workspaces[0]!.shelves.filter((x) => x.at === "right" && x.expanded).at(-1) : undefined;
  const betweenId = betweenOut?.id ?? null;
  // One workspace filling the row: a Shelf in the row grows only as far as the column keeps its minimum (the panel beside
  // the edge gives, 推挤) — past it the left Shelf left the row / the right one narrowed (or became the drawer).
  const fillCap: Record<string, number> = {};
  // A right Shelf in the row narrows below the column's minimum + its seam (lib/sideLayout sideWidth): that is the floor.
  const fillRoom = Math.max(0, free - convMin - (right && frame.kind === "flow" ? CARD_GAP : 0));
  if (!row && !contentRow && !panelMax && !growLive) {
    if (left && leftFits) fillCap[left.shelf.id] = shelfW(left) + fillRoom;
    if (right && frame.kind === "flow") fillCap[right.shelf.id] = shelfW(right) + fillRoom;
  }
  // Two expanded Shelves of a workspace on one side: the outer one (by shelfBoxKey) and the inner one beside its edge.
  const pairs: Record<string, { id: string; w: number; from: number }> = {};
  const pairCap: Record<string, number> = {};
  if (row && !growLive) {
    row.workspaces.forEach((w, idx) => {
      for (const at of ["left", "right"] as const) {
        const outs = w.shelves.filter((x) => x.at === at && x.expanded);
        if (outs.length < 2) continue;
        // From the column outward.
        const order = at === "right" ? outs : [...outs].reverse();
        const list = idx === focusedIdx ? focusedShelves : otherShelves;
        for (let k = 1; k < order.length; k++) {
          const outer = list.find((e) => e.shelf.id === order[k]!.id);
          const inner = list.find((e) => e.shelf.id === order[k - 1]!.id);
          if (!outer || !inner) continue;
          const peer = idx !== focusedIdx;
          const [ow, iw] = [shelfW(outer, peer), shelfW(inner, peer)];
          pairs[shelfBoxKey(ownerOf(idx), outer.shelf.id)] = { id: inner.shelf.id, w: iw, from: ow };
          if (!peer) pairCap[outer.shelf.id] = ow + Math.max(0, iw - RANGES.sidePaneWidth[0]);
        }
      }
    });
  }
  const lastRef = useRef<RowLast | null>(null);
  lastRef.current = {
    area: areaWidth,
    standIn,
    rowLeft,
    split: splitRow,
    fillSplit,
    focusedIdx,
    widths: rowWidths,
    shelfW: shelfWidths,
    shelfWAll: shelfWidthsAll,
    singleW: singleShown,
    singleFill: singleRow && !singleOnly && singleShown === null ? Math.max(0, free) : null,
    singleAdjusted,
    singleWant: want !== null,
    shelfAt,
    beside: { left: endShelf("left"), right: endShelf("right") },
    besideNow: beside,
    fillCap,
    colRoom: fillRoom,
    singleNatural,
    pairs,
    pairCap,
    pairNow,
    shelfDelta,
    pinned: !!pin,
    contentRow,
    lead,
    total: groupTotal,
    sideTaken: { left: leftTakenNow, right: rightTaken },
    defaultShelf: sidePaneWidth,
    share,
  };
  // 最大化 drawn (lib/panelGrow, owner 2026-10-23: 「新的也作为新的参数而不是临时参数」): the geometry this render shows is
  // stored as the panels' own widths — the single column's, the two columns' (by content their widths, filling their
  // share), the Shelf's — so the next render draws the same row from them with no growth on top, and an edge dragged
  // afterwards moves real widths (no jump back). The restore point (the widths before) was taken when it began.
  useLayoutEffect(() => {
    if (!growLive || !grow || useGrow.getState().baked) return;
    if (row && growWs >= 0) {
      const [w0, w1] = row.workspaces.map((w) => w.width);
      if (typeof w0 === "number" && typeof w1 === "number") {
        if (fillSplit) {
          if (w0 + w1 > 0) share.commit(w0 / (w0 + w1));
        } else {
          setColumnWidth(0, w0);
          setColumnWidth(1, w1);
        }
      }
      if (grow.kind === "shelf") {
        // Only the live layout's Shelf can be stored here (the other workspace's stays drawn grown: a view, as before).
        if (growWs !== focusedIdx) return;
        const x = row.workspaces[growWs]!.shelves.find((s) => s.id === grow.shelfId && s.expanded);
        if (x) commitShelfWidth(x.id, Math.max(0, x.box - RAIL_WIDTH - CARD_GAP));
      }
    } else {
      if (growConvPx > 0 && singleShown !== null) setAppearance({ singleColumnW: singleShown });
      const grown = growLeftPx > 0 ? left : growRightPx > 0 ? right : undefined;
      if (grown) commitShelfWidth(grown.shelf.id, shelfW(grown) + growLeftPx + growRightPx);
    }
    markGrowBaked();
  }, [growLive, grow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      onResizeDrag((active) => {
        const last = lastRef.current;
        if (!last) return;
        if (active) {
          sessionRef.current = { area: last.area, rowLeft: last.rowLeft, widths: [...last.widths], shelfW: { ...last.shelfWAll }, singleW: last.singleW ?? last.singleFill, filled: last.singleW === null && last.singleFill !== null, lead: last.contentRow ? last.lead : null, total: last.total, edge: shelfEdgeDrag(), beside: last.beside, pairs: last.pairs };
          return;
        }
        const s0 = sessionRef.current;
        sessionRef.current = null;
        if (!s0) return;
        // The release keeps what the drag showed: the filling ratio, a column's width, the single width, the group's place.
        const [w0, w1] = last.widths;
        if (last.fillSplit && last.pinned && typeof w0 === "number" && typeof w1 === "number" && w0 + w1 > 0) last.share.commit(w0 / (w0 + w1));
        // By content beside two workspaces: each column as the drag left it (all of them after an edge outside the row:
        // narrowed for lack of room, they would widen again on their own).
        if (last.split && !last.fillSplit) last.widths.forEach((w, i) => typeof w === "number" && (w !== s0.widths[i] || last.area !== s0.area) && setColumnWidth(i, w));
        // The single column by content kept its width while an edge outside the row moved: stored when that is not its own.
        if (!last.split && last.contentRow && last.area !== s0.area && last.singleW !== null && last.singleW !== last.singleNatural) setAppearance({ singleColumnW: last.singleW });
        // The inner of two Shelves on one side gave / took what the outer one took.
        if (last.pairNow) commitShelfWidth(last.pairNow.id, last.pairNow.w);
        if (last.singleAdjusted && last.singleW !== null) setAppearance({ singleColumnW: last.singleW });
        // Filling the row when an edge outside it began to move, and wider now: it keeps filling (its width stored as
        // that), not its own narrower width centred again.
        if (s0.filled && last.singleW === null && last.singleWant && last.singleFill !== null && s0.singleW !== null && last.singleFill > s0.singleW) setAppearance({ singleColumnW: last.singleFill });
        // A filling row: the Shelf beside an edge outside it keeps the width the drag gave it (the other workspace's in its own layout).
        const b = last.besideNow;
        if (b) {
          if (b.peer) updatePeerView(b.peer, (v) => setShelfWidth(v, b.id, b.w));
          else commitShelfWidth(b.id, b.w);
        }
        if (last.contentRow && s0.lead !== null && (last.area !== s0.area || last.lead !== s0.lead || last.total !== s0.total)) setPinnedLead(last.lead);
        setShelfPush(0);
      }),
    [],
  );
  useEffect(() => {
    setRowHooks({
      shelfMax(id) {
        const last = lastRef.current;
        if (!last || last.area <= 0 || last.shelfW[id] === undefined) return null;
        // 推挤: by content, past its minimum the column slides into the desktop beyond it (away from the Shelf).
        const beyond = last.contentRow ? Math.max(0, last.shelfAt[id] === "right" ? last.lead : last.area - last.lead - last.total) : 0;
        if (last.pairCap[id] !== undefined) return last.pairCap[id]!;
        if (last.split) {
          const w = last.widths[last.focusedIdx];
          return typeof w === "number" ? last.shelfW[id]! + w - WS_CONVERSATION_MIN_W + beyond : null;
        }
        if (last.singleW !== null) return last.shelfW[id]! + last.singleW - SINGLE_MIN_W + beyond;
        return last.fillCap[id] ?? null;
      },
      shelfReset(id) {
        const last = lastRef.current;
        if (!last || last.shelfW[id] === undefined) return;
        if (last.fillSplit) {
          const [a, b] = last.widths;
          if (typeof a !== "number" || typeof b !== "number") return;
          // The other column keeps its width; the Shelf's own column takes what the Shelf gives back.
          const d = last.shelfW[id]! - last.defaultShelf;
          const w = last.focusedIdx === 0 ? [a + d, b] : [a, b + d];
          if (w[0]! + w[1]! > 0) last.share.commit(w[0]! / (w[0]! + w[1]!));
        } else if (last.split) setColumnWidth(last.focusedIdx, null);
        else if (last.singleW !== null) setAppearance({ singleColumnW: 0 });
      },
      gap(at) {
        const last = lastRef.current;
        if (!last || last.area <= 0 || !last.contentRow) return 0;
        return Math.max(0, at === "left" ? last.lead : last.area - last.lead - last.total);
      },
      beyond() {
        const last = lastRef.current;
        const w = last?.widths[1];
        if (!last || !last.split || typeof w !== "number") return 0;
        return Math.max(0, w - WS_CONVERSATION_MIN_W) + (last.contentRow ? Math.max(0, last.area - last.lead - last.total) : 0);
      },
      give(at) {
        const last = lastRef.current;
        if (!last || last.area <= 0) return Number.POSITIVE_INFINITY;
        // 推挤 (owner 2026-10-23): by content only the free desktop gives — on that side, then the group slides into the
        // other side's; nothing narrows. Filling, only the panel beside the edge: a Shelf down to its minimum, else the column.
        if (last.contentRow) return Math.max(0, last.area - last.total);
        const end = last.beside[at];
        if (end) return Math.max(0, end.w - RANGES.sidePaneWidth[0]);
        // One workspace filling: its column down to the floor a right Shelf beside it keeps (lib/sideLayout sideWidth).
        if (!last.split && last.singleW === null) return last.colRoom;
        const col = last.widths[last.split ? (at === "left" ? 0 : 1) : 0];
        const min = last.split ? WS_CONVERSATION_MIN_W : last.singleW !== null ? SINGLE_MIN_W : MIN_CONVERSATION;
        if (typeof col === "number") return col - min;
        return last.area - last.sideTaken.left - last.sideTaken.right - min;
      },
    });
    return () => setRowHooks(null);
  }, []);
  // The row re-lays out on its own (宽度规则 2): a workspace opening / closing, 工作区宽度 changing.
  useEffect(() => resetRowDrag({ columns: true }), [splitRow]);
  useEffect(() => resetRowDrag(), [widthMode]);

  // A Shelf opening / closing, a second workspace: the columns glide to their new place (lib/columnGlide).
  const widthsKey = row ? row.workspaces.map((w, i) => `${w.width ?? "f"}:${w.shelves.map((x) => `${x.at}${x.box}`).join("")}${emptyWs[i] ? `e${w.railAt}` : ""}`).join("/") : "";
  // Not the focus: it changes nothing of the layout (宽度规则 A) — with it in the key, a focus switch glided the
  // columns from wherever they were last remembered.
  // Beside two workspaces only the row's own geometry: the single row's values (the selected pane, its Shelves' widths)
  // are the focused workspace's — with them in the key a focus switch glided both columns from stale boxes, a jump on
  // the press of the other workspace's Shelf edge (fuzz 2026-10-23).
  const glideKey = row
    ? `s|${conversations}|${widthsKey}|${byContent ? "c" : "f"}|${lead}`
    : `${split ? "s" : "1"}|${single ?? ""}|${leftTaken}|${rightFlow}|${rightRail ? 1 : emptyRail ? 2 : 0}|${singleShown ?? "f"}|${growLeftPx}|${growRightPx}|${conversations}|${widthsKey}|${byContent ? "c" : "f"}|${lead}`;
  const card = useRef<HTMLDivElement>(null);
  // Rotating back (lib/portrait): the stack styled the conversation card; where the landscape row gives it none (left +
  // right Shelves filling the row) React only empties the attribute — no `style=""` is left on the landscape card. From
  // the flip to the first measured landscape commit (the stand-in's render gives it a width first).
  const fromStack = useRef(false);
  useLayoutEffect(() => {
    if (stack) fromStack.current = true;
    if (stack || !fromStack.current) return;
    if (card.current?.getAttribute("style") === "") card.current.removeAttribute("style");
    if (!standIn) fromStack.current = false;
  });
  // A Shelf's box easing open / shut beside the single column: the column's width eases with it (lib/shelfMotion
  // useColumnFollow) — a column switching to filling the row took, on the first frame, all the room the box had not yet.
  useColumnFollow(card, ref, !standIn && !splitRow && !!single && !panelMax && areaWidth > 0 ? (singleShown ?? Math.max(0, free)) : null, dragging.current || areaMoved || resizing() || standIn);
  // Only discrete changes glide: not a drag's steps, not the work area changing width (window, sidebar), not a row
  // not measured yet (just mounted, `areaWidth` 0: 关闭最大化保持 swaps the fill row for this one) — a glide toward that
  // first layout held the column at its unmeasured width, then snapped (unmaximize-jump 2026-10-30).
  // Portrait: nothing glides on the stand-in (the stack's parts change height, not place); rotating back is a row change (still).
  useLayoutEffect(() => glideColumns(ref.current, dragging.current || areaMoved || areaWidth <= 0 || standIn), [glideKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const forcedNow = !!row && row.workspaces.some((w) => w.shelves.some((x) => x.forced));
  const leftOutNow = !!left && !leftFits && !mode;
  useLayoutEffect(() => {
    areaBefore.current = areaWidth;
    // The drawer's slack holds only while the right Shelf is open (lib/sideFrame drawerHeld).
    held.current = { leftOut: leftOutNow, narrow: drawerHeld(frame), forced: forcedNow };
    // The instances over the Shelves' panes follow in this same frame (lib/sideSlots).
    slotsRelayout();
  });
  const rowView = useMemo<WsRowView | null>(
    () => (row ? { mode: row.mode, widths: row.workspaces.map((w) => w.width), railAt: row.workspaces.map((w) => w.railAt), shelfBetween: betweenId !== null } : null),
    [row?.workspaces.map((w) => `${w.width}${w.railAt}`).join(","), row?.mode, betweenId !== null], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // ── Portrait: what the stack (below) draws — computed here for the hooks before it.
  const swapped = portraitPrefs.swapped;
  const stackW = measuredRow.w;
  // Two workspaces side by side in the stack (P3, design decision 9): room for both columns (lib/portrait stackColumns,
  // its hysteresis from what the window shows now); a workspace folded to its strip / 只看 Shelf, or a maximised Shelf /
  // pane, keeps the P2 stack (the other one a strip). Published in the window's store: components/PaneHost lays its
  // conversations out from the same value (both read it; this layout effect corrects it before paint).
  const columnsShown = usePortrait((s) => s.columns);
  const columnsNow = stack && measuredRow.stack ? splitRow && stackColumns(stackW, columnsShown) && !stripWs.some(Boolean) && !onlyWs.some(Boolean) : columnsShown;
  useLayoutEffect(() => {
    if (usePortrait.of(windowKey).getState().columns !== columnsNow) usePortrait.of(windowKey).setState({ columns: columnsNow });
  }, [columnsNow, windowKey]);
  const sideBySide = stack && splitRow && !!row && columnsShown;
  // A band's Shelves (lib/portrait bandShelves): left + right side by side while both have the room, else the one in
  // focus and the other's rail. Each band's last answer is its hysteresis (by workspace).
  const bandWas = useRef<Record<string, boolean>>({});
  const bandNow: Record<string, boolean> = {};
  const bandOf = (key: string, list: readonly ShelfOnScreen[], isOpen: (e: ShelfOnScreen) => boolean, active: string | null, width: number) => {
    const shelves = list.map((e) => ({ id: e.shelf.id, side: e.shelf.side, expanded: isOpen(e), active: e.page.id === active }));
    const out = bandShelves(width, shelves, bandWas.current[key] ?? false);
    bandNow[key] = out.open.length > 1;
    const pick = (ids: readonly string[]) => ids.flatMap((id) => list.filter((e) => e.shelf.id === id));
    return { open: pick(out.open), rails: pick(out.rails), roomFolded: out.rails.filter((id) => shelves.some((s) => s.id === id && s.expanded)) };
  };
  // One workspace (or the focused one over the other's strip): its open Shelves and its collapsed ones' rails in the
  // band; a maximised Shelf / pane alone (§24.16).
  const oneBand = !stack || sideBySide ? null : toolMax ? { open: [maxEntry!], rails: [], roomFolded: [] } : covered || !side || !shown.length ? null : bandOf("", [...shown, ...rails], (e) => shown.includes(e), layout.activePage, stackW);
  // A maximised conversation folds every Shelf to its rail (as in the landscape row, §24.16).
  const railsShown = covered ? foldable : rails;
  // Shelf Rail 常驻: nothing of the focused conversation's Shelf on screen — its empty rail as the bar (two workspaces too:
  // the stack is the focused one's).
  const emptyBar = always && side && !panelMax && !desk && !!selectedId && !shown.length && !rails.length && !emptyState;
  // What sits below (or above) the conversation: its Shelves' band, the tool area's launchers, the folded Shelves' rails
  // (one bar), the empty Shelf's rail (Shelf Rail 常驻), or nothing (the conversation takes the whole stack).
  const part: "shelf" | "rail" | null = oneBand || (emptyState && !covered) ? "shelf" : railsShown.length || emptyBar ? "rail" : null;
  // Split by the divider (a maximised Shelf / pane takes the stack: the conversations are its strip, no divider).
  const divided = part === "shelf" && !toolMax;
  const convShare = Math.round(portraitPrefs.split * 1000) / 1000;
  const shelfShare = Math.round((1 - portraitPrefs.split) * 1000) / 1000;
  // The conversation at the stack's bottom keeps the tray's room under it (components/tray.css); above a part, none.
  const convLast = swapped || !part;
  // Two workspaces side by side: each column's part under (or over) its conversation — its band (the peer's Shelves for
  // the other workspace), its rails as one bar, its empty rail (Shelf Rail 常驻), or nothing.
  const stackColW = Math.max(0, (stackW - STACK_GAP) / 2);
  const colParts = sideBySide
    ? [0, 1].map((idx) => {
        const view = idx === focusedIdx ? layout : otherView;
        const list = idx === focusedIdx ? focusedShelves : otherShelves;
        if (!view) return null;
        const isOpen = (e: ShelfOnScreen) => view.open && !e.shelf.collapsed;
        if (list.some(isOpen)) return { kind: "shelf" as const, band: bandOf(ownerOf(idx), list, isOpen, view.activePage, stackColW) };
        if (list.length) return { kind: "bar" as const, rails: list };
        return emptyWs[idx] ? { kind: "empty" as const } : null;
      })
    : null;
  useLayoutEffect(() => {
    bandWas.current = bandNow;
  });
  // The split stack's own element's variables (portrait.css): two workspaces side by side — the grid's rows; the focused
  // column over the other's strip — its flex / minimum / order. Written here and taken off again with nothing left
  // behind (no `style=""` on the landscape row after rotating back; the divider's drag sets the flex / rows live).
  const stackVars: Record<string, string> | null =
    !stack || !splitRow || !row
      ? null
      : sideBySide
        ? { "--stack-rows": colParts?.some((c) => c?.kind === "shelf") ? stackRows(portraitPrefs.split, swapped) : "minmax(0, 1fr)" }
        : { "--stack-conv-flex": divided ? `${convShare} 1 0px` : "1 1 0px", "--stack-conv-min": divided ? `${STACK_CONVERSATION_MIN}px` : "0px", "--stack-conv-order": swapped ? "2" : "0" };
  const stackVarsKey = stackVars ? JSON.stringify(stackVars) : null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !stackVars) return;
    for (const [k, v] of Object.entries(stackVars)) el.style.setProperty(k, v);
    return () => {
      for (const k of Object.keys(stackVars)) el.style.removeProperty(k);
      if (el.getAttribute("style") === "") el.removeAttribute("style");
    };
  }, [stackVarsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // P4 motion (lib/portraitMotion): the stack's parts glide on a discrete rearrangement — never on a drag's release
  // (quietNextStackGlide), the stack changing width (a window resize), its first commit after a rotation (nothing
  // remembered then), or reduced motion. Going landscape ends every glide in the flip's own commit and forgets the boxes.
  const ids = (list: readonly ShelfOnScreen[] | undefined) => (list ?? []).map((e) => e.shelf.id).join(",");
  const stackMotionKey = stack
    ? [
        swapped,
        part,
        divided,
        convShare,
        portraitPrefs.band ?? "",
        sideBySide,
        covered,
        toolMax,
        splitRow ? focusedIdx : -1,
        stripWs.join(","),
        ids(oneBand?.open),
        ids(oneBand?.rails),
        ids(railsShown),
        (colParts ?? []).map((c) => (c ? `${c.kind}:${c.kind === "shelf" ? `${ids(c.band.open)}/${ids(c.band.rails)}` : ""}` : "-")).join(";"),
      ].join("|")
    : null;
  const stackWas = useRef<{ w: number; stack: boolean }>({ w: 0, stack: false });
  useLayoutEffect(() => {
    const was = stackWas.current;
    stackWas.current = { w: stackW, stack: stack && measuredRow.stack };
    if (!stack) {
      if (was.stack) stopStackGlides(ref.current);
      return;
    }
    glideStack(ref.current, !was.stack || !measuredRow.stack || was.w !== stackW || dragging.current || resizing());
  }, [stackMotionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!stack) return;
    if (stackWas.current.w !== stackW || stackWas.current.stack !== measuredRow.stack) stackWas.current = { w: stackW, stack: measuredRow.stack };
    noteStackLater(ref.current);
  });
  if (stack) {
    // ── Portrait (lib/portrait, design .claude/previews/portrait): the row as a stack — the conversation, then (the
    // divider between) its Shelves' band with their Rails across the edge toward the conversation, or swapped. The tree
    // keeps the landscape row's shape down to the conversation (the row's div, slot 0, the card's div, its `contents`
    // div; two workspaces: the split row's provider, div and `contents` div), so a rotation never remounts the
    // conversations (timelines, composers, scroll positions). The parts are placed by `order` (a swap moves nothing in
    // the tree). The Tray stays at the window's edge: only the stack's bottom part leaves its room.
    // P2 (a view only — nothing of the landscape layout is written): a maximised / full-screen Shelf or pane fills the
    // stack, the conversations a strip of their avatars across its end; a maximised conversation fills it, every Shelf
    // its rail in one bar at the end, the other workspace a strip across the top; two workspaces without the room: the
    // focused one is the stack, the other a strip across the top (components/PaneHost ConversationColumns; a click /
    // keyboard focus on it switches). P3: left + right Shelves side by side in the band; two workspaces with the room
    // side by side, each a column (a grid: its conversation over its own band; one row of dividers for both).
    const gap = <div key="gap" aria-hidden className="shrink-0" style={{ height: STACK_GAP, order: 1 }} />;
    const between = divided ? <PortraitDivider key="divider" row={ref} split={portraitPrefs.split} swapped={swapped} /> : part ? gap : null;
    const end = (
      <RailEdgeContext.Provider key="part" value={swapped ? "bottom" : "top"}>
        {part === "shelf" ? (
          <PortraitShelf open={oneBand?.open ?? []} rails={oneBand?.rails ?? []} roomFolded={oneBand?.roomFolded} share={toolMax ? null : shelfShare} swapped={swapped} maxed={toolMax} split={!!splitRow} />
        ) : railsShown.length ? (
          <div data-portrait-part="rails" className="flex shrink-0 gap-2" style={{ order: swapped ? 0 : 2 }}>
            {railsShown.map((e) => (
              <PortraitRail key={e.shelf.id} entry={e} swapped={swapped} folded={covered} />
            ))}
          </div>
        ) : part === "rail" && selectedId ? (
          <EmptyShelfRail hostId={selectedHost} sessionId={selectedId} at="right" order={swapped ? 0 : 2} />
        ) : null}
      </RailEdgeContext.Provider>
    );
    if (splitRow && row && colParts) {
      // Two workspaces side by side (P3): the split row's tree as below; each column's conversation is placed by
      // portrait.css (its column, its rows: data-portrait-c0 / c1), its divider and part here, in its cell.
      const kinds = colParts.map((c) => (c ? (c.kind === "shelf" ? "shelf" : "bar") : "none"));
      const cells = colParts.flatMap((c, idx) => {
        if (!c) return [];
        const mine = idx === focusedIdx;
        const owner = ownerOf(idx);
        const source = mine ? null : peerSource;
        const paneId = mine ? null : (other?.paneId ?? null);
        const cell = (rows: string, align?: "start" | "end"): CSSProperties => ({ gridColumn: idx + 1, gridRow: rows, ...(align ? { alignSelf: align } : {}) });
        const barAt = cell(swapped ? "1" : "-2 / -1", swapped ? "start" : "end");
        let body: ReactNode = null;
        if (c.kind === "shelf") body = <PortraitShelf open={c.band.open} rails={c.band.rails} roomFolded={c.band.roomFolded} share={null} swapped={swapped} place={cell(swapped ? "1" : "3")} paneId={paneId} split />;
        else if (c.kind === "bar")
          body = (
            <div data-portrait-part="rails" className="flex min-w-0 gap-2" style={barAt} onPointerDownCapture={source ? () => focusPeer(source.key) : undefined}>
              {c.rails.map((e) => (
                <PortraitRail key={e.shelf.id} entry={e} swapped={swapped} />
              ))}
            </div>
          );
        else {
          const host = mine ? selectedHost : other?.hostId;
          const session = mine ? selectedId : other?.sessionId;
          if (host && session)
            body = (
              <div data-portrait-part="rails" className="flex min-w-0 flex-col" style={barAt}>
                <EmptyShelfRail hostId={host} sessionId={session} at="right" paneId={paneId} focus={paneId ? () => focusConversationPane(paneId) : null} />
              </div>
            );
        }
        return [
          c.kind === "shelf" ? <PortraitDivider key={`divider\u0000${owner}`} row={ref} split={portraitPrefs.split} swapped={swapped} place={cell("2")} /> : null,
          <ShelfSourceContext.Provider key={`part\u0000${owner}`} value={source}>
            <RailEdgeContext.Provider value={swapped ? "bottom" : "top"}>{body}</RailEdgeContext.Provider>
          </ShelfSourceContext.Provider>,
        ];
      });
      return (
        <WsRowContext.Provider value={null}>
          <div ref={attach} data-side-work data-portrait-stack="" data-portrait-split="" data-portrait-cols="" data-portrait-c0={kinds[0]} data-portrait-c1={kinds[1]} data-portrait-swapped={swapped ? "" : undefined} data-ws-area={measuredRow.w} className="relative grid min-h-0 min-w-0 flex-1">
            {[]}
            {cells}
            <div className="contents" data-focus-region="main">
              {children}
            </div>
            {null}
          </div>
        </WsRowContext.Provider>
      );
    }
    if (splitRow && row) {
      // Two workspaces: the split row's tree (no remount on rotation); the focused workspace's column is the stack's
      // conversation part (its flex, minimum, order and tray room from the variables above, portrait.css), the other its strip.
      return (
        <WsRowContext.Provider value={null}>
          <div ref={attach} data-side-work data-portrait-stack="" data-portrait-split="" data-portrait-swapped={swapped ? "" : undefined} data-portrait-conv-last={convLast ? "" : undefined} data-ws-area={measuredRow.w} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {[]}
            {[between, end]}
            <div className="contents" data-focus-region="main">
              {children}
            </div>
            {null}
          </div>
        </WsRowContext.Provider>
      );
    }
    return (
      <div ref={attach} data-side-work data-portrait-stack="" data-portrait-swapped={swapped ? "" : undefined} data-ws-area={measuredRow.w} data-panel-max={covered ? "conversation" : toolMax ? (mode?.card ? "pane" : "shelf") : undefined} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {covered ? <PortraitOtherStrip /> : null}
        <div
          ref={card}
          className="shell-card relative isolate flex min-h-0 min-w-0 overflow-hidden"
          data-conv-card=""
          data-focus-region="main"
          data-portrait-part="conversation"
          data-conv-folded={toolMax ? "" : undefined}
          // (`width` in the landscape strip's place: rotating back writes the same declarations in the same order.)
          style={toolMax ? { flex: "none", width: "auto", height: STACK_RAIL_H, order: swapped ? 2 : 0, marginBottom: convLast ? undefined : 0 } : { flex: divided ? `${convShare} 1 0px` : "1 1 0px", minHeight: divided ? STACK_CONVERSATION_MIN : undefined, order: swapped ? 2 : 0, marginBottom: convLast ? undefined : 0 }}
        >
          {null}
          {/* A Shelf / pane maximised: the conversations stay mounted under the strip of their avatars. */}
          <div className="contents" hidden={toolMax || undefined}>
            {children}
          </div>
          {toolMax && <ConvStrip across />}
        </div>
        {between}
        {end}
      </div>
    );
  }
  if (splitRow && row) {
    // Both workspaces' Shelves, in workspace order (left first) whichever has the focus: each keyed by its
    // conversation + its Shelf's id (shelfBoxKey) under a source provider, so a focus switch — the other's Shelf becoming the live
    // layout — keeps every box, pane and placeholder where it is (no remount, §24.13).
    const boxes: { entry: ShelfOnScreen; idx: number; source: ShelfPeer | null }[] = [0, 1].flatMap((idx) =>
      stripWs[idx] ? [] : idx === focusedIdx ? focusedShelves.map((entry) => ({ entry, idx, source: null })) : otherShelves.map((entry) => ({ entry, idx, source: peerSource })),
    );
    return (
      <WsRowContext.Provider value={rowView}>
        <div ref={attach} data-side-work data-ws-area={areaWidth} data-ws-split={focusedIdx} data-ws-width={widthMode} data-ws-width-setting={appearance.workspaceWidth} data-ws-rails={appearance.wsRailPlacement} data-ws-lead={leadIn !== null ? lead : undefined} className={`relative flex min-h-0 min-w-0 flex-1 gap-0 ${row.centred ? "justify-center" : ""}`} style={leadStyle}>
          {[0, 1].map((idx) => {
            const w = row.workspaces[idx];
            if (!emptyWs[idx] || !w) return null;
            const mine = idx === focusedIdx;
            const host = mine ? selectedHost : other?.hostId;
            const session = mine ? selectedId : other?.sessionId;
            if (!host || !session) return null;
            const paneId = mine ? null : (other?.paneId ?? null);
            return (
              <EmptyShelfRail key={`empty\u0000${ownerOf(idx)}`} hostId={host} sessionId={session} at={w.railAt} order={idx * 3 + (w.railAt === "left" ? 1 : 3)} paneId={paneId} focus={paneId ? () => focusConversationPane(paneId) : null} />
            );
          })}
          {boxes.map(({ entry, idx, source }) => {
            const out = row.workspaces[idx]?.shelves.find((x) => x.id === entry.shelf.id);
            if (!out) return null;
            // Keyed by conversation + Shelf id (shelfBoxKey): the same box whichever workspace has the focus; the
            // id alone was not unique — the boxes of two Shelves of the same id were swapped, duplicated or dropped
            // (owner 2026-10-21: the left conversation's Shelf Rail gone after selecting it).
            const k = shelfBoxKey(ownerOf(idx), entry.shelf.id);
            return (
              <ShelfSourceContext.Provider key={k} value={source}>
                <WsShelfBox entry={entry} motionKey={k} at={out.at} expanded={out.expanded} box={out.box} hidden={covered} order={idx * 3 + (out.at === "left" ? 1 : 3)} still={areaMoved} paneId={source ? (other?.paneId ?? null) : null} outer={row.centred && (idx === 0 ? out.at === "left" : out.at === "right") && outerRoom[out.at]} between={idx === 0 && entry.shelf.id === betweenId && !covered && !growLive} />
              </ShelfSourceContext.Provider>
            );
          })}
          <div className="contents" data-focus-region="main">
            {children}
          </div>
          {row.centred && !covered && !growLive && (
            <WsColumnEdges
              row={ref}
              paneIds={convPaneIds}
              between={!row.workspaces[0]!.shelves.some((x) => x.at === "right") && !row.workspaces[1]!.shelves.some((x) => x.at === "left") && !(emptyWs[0] && row.workspaces[0]!.railAt === "right") && !(emptyWs[1] && row.workspaces[1]!.railAt === "left")}
              outerLeft={!row.workspaces[0]!.shelves.some((x) => x.at === "left") && !(emptyWs[0] && row.workspaces[0]!.railAt === "left")}
              outerRight={!row.workspaces[1]!.shelves.some((x) => x.at === "right") && !(emptyWs[1] && row.workspaces[1]!.railAt === "right")}
              sidebarEdge={sidebarEdge}
              widths={row.workspaces.map((w) => w.width)}
              lead={lead}
              area={areaWidth}
              total={groupTotal}
            />
          )}
        </div>
      </WsRowContext.Provider>
    );
  }
  return (
    <div ref={attach} data-side-work data-ws-area={areaWidth} data-ws-width={widthMode} data-ws-width-setting={appearance.workspaceWidth} data-ws-lead={leadIn !== null ? lead : undefined} data-panel-max={covered ? "conversation" : toolMax ? (mode?.card ? "pane" : "shelf") : undefined} className={`relative flex min-h-0 min-w-0 flex-1 ${byContent && !panelMax ? "justify-center" : ""}`} style={leadStyle}>
      {panelMax ? (
        foldLeft ? <LeftShelf entry={foldLeft} width={RAIL_WIDTH} hidden={false} collapsed order={1} folded /> : null
      ) : left && leftFits ? (
        <LeftShelf entry={left} width={leftW + growLeftPx} hidden={covered} collapsed={false} still={areaMoved} outer={contentRow && !growLive && outerRoom.left} />
      ) : leftRail ? (
        <LeftShelf entry={leftRail} width={RAIL_WIDTH} hidden={covered} collapsed still={areaMoved} />
      ) : null}
      {/* A click on the conversation (dimmed) closes the narrow-window drawer. A single conversation: its own width,
          centred with its Shelves (the desktop shows beside them), its edges draggable. */}
      <div
        ref={card}
        className="shell-card relative isolate flex min-w-0 flex-1 overflow-hidden"
        data-conv-card=""
        data-focus-region="main"
        data-glide={single ?? undefined}
        data-single-w={singleShown ?? undefined}
        data-grown={growConvPx > 0 ? "" : undefined}
        data-conv-folded={toolMax ? "" : undefined}
        style={toolMax ? { flex: "0 0 auto", width: RAIL_WIDTH, order: 2 } : singleShown !== null ? { flex: "0 1 auto", width: singleShown } : panelMax ? { order: 2 } : undefined}
        onPointerDownCapture={drawer ? closeColumn : undefined}
      >
        {/* The drawer is on top (owner 2026-10-24: it read as the Shelf overlapping the conversation): the conversation beside it
            is dimmed, a click there closes it. */}
        {drawer && <div data-drawer-scrim="" aria-hidden className="absolute inset-0 z-40 cursor-pointer bg-black/35" />}
        {/* A Shelf / pane maximised: the conversations stay mounted under the strip of their avatars. */}
        <div className="contents" hidden={toolMax || undefined}>
          {children}
        </div>
        {toolMax && <ConvStrip />}
      </div>
      {side && <SideArea frame={growRightPx > 0 ? { ...frame, width: frame.width + growRightPx } : frame} areaWidth={rightRoom} covered={covered} shelf={right?.shelf.id ?? null} page={right?.page.id ?? null} order={toolMax ? (maxAt === "left" ? 1 : 3) : panelMax ? 3 : undefined} maxAt={maxAt} still={areaMoved} outer={contentRow && !growLive && outerRoom.right} />}
      {panelMax ? foldRight && <RightRail entry={foldRight} hidden={false} order={4} folded /> : rightRail && <RightRail entry={rightRail} hidden={covered} still={areaMoved} />}
      {emptyRail && selectedId && <EmptyShelfRail hostId={selectedHost} sessionId={selectedId} at="right" />}
      {single && !split && !mode && !singleOnly && !covered && singleEdgeWidth !== null && <SingleColumnEdges card={card} lead={lead} before={leftTaken + growLeftPx} after={rightFlow + rightStrip + growRightPx} area={areaWidth} width={singleEdgeWidth} free={free} dragging={dragging} seams={{ left: (!!left && leftFits) || (sidebarEdge && lead + leftTaken + growLeftPx <= 0), right: side && !!right && frame.kind === "flow" }} />}
      {covered && <OtherWorkspaceStrip at={otherAt} />}
    </div>
  );
}

/** The expanded Shelf at one end of a filling row: its shelfBoxKey, id, width, and its conversation when it is the other workspace's (null: the live layout's). */
interface EndShelf {
  key: string;
  id: string;
  w: number;
  peer: string | null;
}

/** A width drag's starting point (宽度规则): the row as it was when the drag started. */
interface RowSession {
  area: number;
  rowLeft: number;
  widths: (number | null)[];
  shelfW: Record<string, number>;
  singleW: number | null;
  lead: number | null;
  /** The group's width (by content: where its far side was). */
  total: number;
  /** The single column filled the row (no width of its own): it keeps filling while an edge outside the row moves. */
  filled: boolean;
  /** The Shelf edge dragged (lib/sideResize shelfEdgeDrag): an outer one keeps its column and the group's far side. */
  edge: { side: ShelfSide; outer: boolean; between: boolean } | null;
  /** RowLast beside: the Shelf at each end of a filling row. */
  beside: Readonly<Record<ShelfSide, EndShelf | null>>;
  /** RowLast pairs: two Shelves on one side as the drag began. */
  pairs: Readonly<Record<string, { id: string; w: number; from: number }>>;
}

/** The last render's row, for the drag session and lib/sideResize's row hooks. */
interface RowLast {
  area: number;
  /** Laid out on the portrait stand-in (lib/portrait), not a measured landscape row. */
  standIn: boolean;
  rowLeft: number;
  split: boolean;
  fillSplit: boolean;
  focusedIdx: number;
  widths: (number | null)[];
  shelfW: Record<string, number>;
  /** shelfW with the other workspace's expanded Shelves (a drag session's start). */
  shelfWAll: Record<string, number>;
  singleW: number | null;
  /**
   * By content, the single column filling the row (its width within FILL_SLACK of the room: no width of its own): its
   * width on screen. A seam drag starts from it — else the column, once the Shelf gave a little room, got its own
   * width back and the whole group re-centred mid-drag (the Shelf's far side moved).
   */
  singleFill: number | null;
  singleAdjusted: boolean;
  /** The single column has a width of its own to fill the row with (not 全宽). */
  singleWant: boolean;
  /** Each live expanded Shelf's side of its column. */
  shelfAt: Record<string, ShelfSide>;
  /** The row fills: the expanded Shelf at each end (an edge outside the row gives / takes from it, 推挤). */
  beside: Record<ShelfSide, EndShelf | null>;
  /** That Shelf's width while an edge outside the row moves (stored on the release). */
  besideNow: EndShelf | null;
  /** One workspace filling the row: each Shelf in it at most this wide (the column at its minimum). */
  fillCap: Record<string, number>;
  /** One workspace filling the row: px its column can give (down to the floor a right Shelf beside it keeps). */
  colRoom: number;
  /** The single column's width without the drag in progress. */
  singleNatural: number | null;
  /** Two expanded Shelves of a workspace on one side, by the outer one's shelfBoxKey: the inner one, its width, the outer's. */
  pairs: Record<string, { id: string; w: number; from: number }>;
  /** The outer one of such a pair (live layout): at most this wide (the inner one at its minimum). */
  pairCap: Record<string, number>;
  /** The inner one's width while the outer one's edge is dragged (stored on the release). */
  pairNow: { id: string; w: number } | null;
  shelfDelta: number;
  pinned: boolean;
  contentRow: boolean;
  lead: number;
  total: number;
  sideTaken: { left: number; right: number };
  defaultShelf: number;
  share: StoredShare;
}

interface StoredShare {
  /** The left column's share of the two (the owner's last dragged ratio, the pane layout's). */
  value: number;
  commit(share: number): void;
}

/** Two conversation columns' stored ratio (lib/paneLayout cols) and how to store a new one. */
function useStoredShare(): StoredShare {
  const key = usePanes((s) => {
    const l = s.layout;
    const panes = conversationPanes(l);
    const idx = panes.slice(0, 2).map((p) => l.cols.findIndex((c) => c.rows.some((r) => r.pane === p)));
    const [a, b] = idx;
    if (a === undefined || b === undefined || a < 0 || b !== a + 1) return "";
    return `${a}:${l.cols[a]!.w / (l.cols[a]!.w + l.cols[b]!.w)}`;
  });
  return useMemo(() => {
    if (!key) return { value: 0.5, commit: () => {} };
    const [a, v] = key.split(":");
    const index = Number(a);
    return { value: Number(v), commit: (share: number) => resizePaneColumns(index, share) };
  }, [key]);
}

/** The default path retains its exact DOM and width rules. */
export function SideWorkArea(props: Parameters<typeof LegacySideWorkArea>[0]) {
  const fill = useAppearance().fillMode;
  const mode = useSide(s => s.mode);
  const count = usePanes(s => conversationPanes(s.layout).length);
  // Portrait (lib/portrait): the stack already fills the window — 最大化保持 is landscape's (its value is kept, unused here).
  const stack = usePortraitOn();
  return fill && !stack && props.side && !props.covered && !mode && count > 0
    ? <FillWorkArea Shelf={ShelfView}>{props.children}</FillWorkArea>
    : <LegacySideWorkArea {...props} />;
}
