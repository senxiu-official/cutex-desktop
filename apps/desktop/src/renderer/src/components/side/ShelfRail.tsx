import { isImeComposing } from "../../lib/ime";
// A Shelf's Shelf Rail (docs/desktop-modules.md §24.12; canvas principles §6; prototype
// .claude/preview-shelves.html scenario A): a column of page buttons on the Shelf's outer edge (or inner,
// per Shelf) — each the page's icon with its name as tooltip (Alt+n), the page in view marked — then ＋ (a
// new page, ≤ 50) and, at the bottom, the collapse button and ⋯ (the Shelf's menu). A collapsed Shelf (owner
// 2026-10-21; prototype .claude/preview-design-v1.html §3 a) is this rail only, on its own backdrop, no page
// marked: a page button expands the Shelf to that page; the page in view of an expanded Shelf does nothing (owner
// 2026-10-22) — the avatar at the top is the toggle (ShelfAvatar: click = 收起 / 展开, right-click = the Shelf's menu). Right-click a page button: 重命名 / 换图标 /
// 上移 / 下移 / 删除. Page buttons and ＋ are drop targets while a pane is dragged (lib/sideDnd: hovering
// 0.4 s shows the page; data-shelf-page / data-shelf-add). The rename / icon popover opens beside a page.
// Shelf Rail 常驻 (owner 2026-10-21, default on): a closed tool area's Shelves draw this rail as collapsed (a page
// button opens it to that page); an empty Shelf draws EmptyShelfRail (the avatar + ＋ = the launchers).
// Portrait (lib/portrait RailEdgeContext, owner 2026-10-30): the same rail drawn horizontally across its Shelf's edge toward
// the conversation — the avatar, the page buttons in a row, ⋯ at the far end; the page in view marked on the edge toward
// the panes. Landscape (no context) draws exactly as before.
import { shelfAvatarHowTo, shelfAvatarMenu, shelfAvatarTip, shelfToggleEffect, type ShelfOwner } from "../../lib/shelfAvatar";
import { useForetell, withHandlers } from "../../lib/foretell";
import { focusPeer } from "../../lib/shelfSource";
import { toggleShelfGrow } from "../../lib/panelGrow";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pin, Plus, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ItemId } from "../../modules/types";
import { contextMenu, openMenuAt, openMenuFrom } from "../../lib/contextMenu";
import { panelGuideTail } from "../../lib/panelGuideMenu";
import { cardName, pageLabel, toggleShelfMode } from "../../lib/sideActions";
import { useSideRegistry } from "../../lib/sideComponents";
import { COLLAPSED_SHELF_WIDTH, MAX_SHELF_PAGES, PAGE_ICONS, findPage, pageAsShown, shownCards, type Shelf, type ShelfSide, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { emptySlots, slotInfo } from "../../lib/hiddenPage";
import { emptySlotsTip, ownerName } from "../../lib/hiddenPageNames";
import { useApp } from "../../store";
import { useConvSession } from "../../lib/workspaceRowView";
import { shelfLauncherMenu } from "../../lib/convPaneControls";
import { Avatar } from "../Avatar";
import { useSide } from "../../lib/sideLayoutStore";
import { useRailNews } from "../../lib/railNews";
import { useShelfLayout } from "../../lib/shelfSource";
import { sideDragHandle, useSideDnd } from "../../lib/sideDnd";
import { DROP_TINT, dropTint } from "../../lib/dropTint";
import { PAGE_ICON_COMPONENTS, pageIcon } from "../../lib/shelfIcons";
import { pageMenu, shelfMenu, togglePagePin } from "../../lib/shelfMenus";
import { addPage, closePagePopover, paneIconClick, railPageClickNow, renamePageTo, setPageIconTo, usePagePopover } from "../../lib/shelves";
import { CountBadge } from "../../components/Tag";
import { digitBindingLabel } from "../../lib/keybindings";
import { SelectionMark } from "../SelectionMark";
import { RoomFoldedContext, STACK_RAIL_H, useRailEdge } from "../../lib/portrait";
import { shelfCollapseForetell } from "../../lib/menuForetells";
import { isElement, isNode, ownerWindowOf } from "../../lib/ownerWindow";
import { InfoMark } from "../InfoMark";
import { useRailScroll } from "../../lib/railScroll";

/** The owner avatar's wrapper on a horizontal rail (portrait): the avatar, then a short vertical separator. */
const OWNER_ACROSS = "mr-0.5 flex shrink-0 flex-row items-center gap-1 pl-0.5";

const BTN = "relative flex size-[34px] shrink-0 items-center justify-center rounded-ctl text-muted transition-[background,color,transform] duration-(--motion-short) ease-(--ease-standard) hover:bg-hover hover:text-foreground";

/** The rename / icon popover beside a page button. */
function PagePopover({ page, index, anchor, toward }: { page: SidePage; index: number; anchor: HTMLElement; toward: "left" | "right" | "up" | "down" }) {
  const win = ownerWindowOf(anchor);
  const { t } = useI18n();
  const fresh = usePagePopover((s) => s.fresh);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(page.name ?? (fresh ? t("shelf.page.newName", { n: index }) : pageLabel(page)));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 248;
    const h = box.current?.offsetHeight ?? 200;
    // A horizontal rail (portrait): under the page button, or above it when the rail is at its Shelf's bottom.
    const left = toward === "left" ? r.left - w - 8 : toward === "right" ? r.right + 8 : r.left - 6;
    const top = toward === "down" ? r.bottom + 8 : toward === "up" ? r.top - h - 8 : r.top - 6;
    setPos({ left: Math.max(8, Math.min(left, win.innerWidth - w - 8)), top: Math.max(8, Math.min(top, win.innerHeight - h - 8)) });
  }, [anchor, toward, win]);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const done = (commit: boolean) => {
    if (commit) renamePageTo(page.id, name);
    closePagePopover();
  };
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (box.current && isNode(e.target) && !box.current.contains(e.target) && !anchor.contains(e.target)) done(true);
    };
    win.addEventListener("pointerdown", away, true);
    return () => win.removeEventListener("pointerdown", away, true);
  });
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={t("shelf.page.popoverTitle", { n: index })}
      data-shelf-popover={page.id}
      className="float fixed z-[161] w-[248px] p-2.5"
      style={pos ?? { left: -9999, top: 0 }}
    >
      <div className="mb-1.5 flex items-center text-xs font-medium text-muted">
        <span className="flex-1">{t("shelf.page.popoverTitle", { n: index })}</span>
        <button onClick={() => done(false)} aria-label={t("shelf.page.cancel")} className="flex size-5 items-center justify-center rounded text-subtle hover:bg-hover">
          <X size={12} />
        </button>
      </div>
      <input
        ref={input}
        value={name}
        maxLength={80}
        placeholder={t("shelf.page.namePlaceholder")}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          e.stopPropagation();
          if (e.key === "Enter") done(true);
          if (e.key === "Escape") done(false);
        }}
        className="mb-2 h-7 w-full rounded-md border border-border bg-surface px-2 text-ui/[inherit] outline-none focus:border-accent"
      />
      <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label={t("shelf.page.icon")}>
        <button
          role="radio"
          aria-checked={!page.icon}
          data-tip={t("shelf.page.iconAuto")}
          onClick={() => setPageIconTo(page.id, null)}
          className={`flex size-[26px] items-center justify-center rounded-md text-caption/[inherit] text-subtle hover:bg-hover ${!page.icon ? "bg-accent/15 text-accent ring-1 ring-accent/50" : ""}`}
        >
          {t("shelf.page.iconAutoShort")}
        </button>
        {PAGE_ICONS.map((id) => {
          const I = PAGE_ICON_COMPONENTS[id];
          const on = page.icon === id;
          return (
            <button key={id} role="radio" aria-checked={on} aria-label={id} onClick={() => setPageIconTo(page.id, id)} className={`flex size-[26px] items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground ${on ? "bg-accent/15 text-accent ring-1 ring-accent/50" : ""}`}>
              <I size={15} />
            </button>
          );
        })}
      </div>
    </div>,
    win.document.body,
  );
}

/** The Shelf's collapse / expand icon: a panel toward the window edge it sits on, open or closed (never a page's icon). */
export function shelfToggleIcon(side: ShelfSide, collapsed: boolean) {
  const right = side === "right";
  return collapsed ? (right ? PanelRightOpen : PanelLeftOpen) : right ? PanelRightClose : PanelLeftClose;
}

/**
 * The owning conversation's small avatar at the top of a Shelf Rail (owner 2026-10-21): whose Shelf this is,
 * beside two workspaces above all. `onClick`: another workspace's rail focuses that workspace.
 */
export function RailOwner({ hostId, sessionId, onClick }: { hostId: string; sessionId: string | null; onClick?: () => void }) {
  const session = useConvSession(hostId, sessionId);
  const across = useRailEdge() !== null;
  if (!session) return null;
  const avatar = <Avatar name={session.displayName} avatar={session.avatar} seed={session.cutexSessionId} size={20} />;
  return (
    <span data-shelf-owner={session.cutexSessionId} data-tip={session.displayName} className={across ? OWNER_ACROSS : "mb-0.5 flex shrink-0 flex-col items-center gap-1 pt-0.5"}>
      {onClick ? (
        <button type="button" onClick={onClick} aria-label={session.displayName} className="rounded-full">
          {avatar}
        </button>
      ) : (
        avatar
      )}
      <span aria-hidden className={across ? "h-5 w-px bg-border" : "h-px w-5 bg-border"} />
    </span>
  );
}

/**
 * The avatar at the top of a Shelf's rail (design 009, owner 2026-10-22): whose Shelf this is (`owner`; a pinned
 * page in view: the pin; a Shelf of no agent: the Shelf's toggle icon — same behaviour) and its toggle: a click
 * folds the Shelf to its rail / expands it, right-click the Shelf's menu (lib/shelfAvatar). Another workspace's
 * Shelf (`peerKey`) becomes the live one on the press first. Both carry 动作预告 from the same effects.
 */
export function ShelfAvatar({ shelfId, owner, collapsed, side = "right", pinned = false, peerKey = null }: { shelfId: string; owner: { hostId: string; sessionId: string } | null; collapsed: boolean; side?: ShelfSide; /** The page in view is pinned (固定, `shared`): no single agent's Shelf. */ pinned?: boolean; peerKey?: string | null }) {
  const session = useConvSession(owner?.hostId ?? "", owner?.sessionId ?? null);
  const who: ShelfOwner | null = owner && session ? { hostId: owner.hostId, sessionId: owner.sessionId, name: session.displayName } : null;
  // Portrait (P4): a rail folded only for lack of room in the band — a click shows that Shelf (SideArea showRoomFolded),
  // so it previews that, not 「收成 Rail」 (its layout keeps it expanded).
  const roomFolded = useContext(RoomFoldedContext);
  const fh = useForetell(() => (roomFolded ? shelfCollapseForetell(side, true) : shelfToggleEffect(shelfId).foretell));
  const tip = shelfAvatarTip(who, !who && pinned);
  const Toggle = shelfToggleIcon(side, collapsed);
  const across = useRailEdge() !== null;
  return (
    <span data-shelf-owner={who?.sessionId ?? ""} className={across ? OWNER_ACROSS : "mb-0.5 flex shrink-0 flex-col items-center gap-1 pt-0.5"}>
      <button
        type="button"
        data-shelf-avatar={shelfId}
        data-side-nodrag
        data-tip={tip}
        aria-label={tip}
        aria-expanded={!collapsed}
        {...withHandlers({ onPointerDown: () => peerKey && focusPeer(peerKey) }, fh)}
        onClick={() => shelfToggleEffect(shelfId).run()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (peerKey) focusPeer(peerKey);
          openMenuAt(e.clientX, e.clientY, shelfAvatarMenu(shelfId, who));
        }}
        className="flex size-[26px] items-center justify-center rounded-full text-muted hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {who && session ? (
          <Avatar name={session.displayName} avatar={session.avatar} seed={session.cutexSessionId} size={20} />
        ) : pinned ? (
          // Owner 2026-10-25: a pinned page in view (one pane or a group) is no single agent's — the pin says so.
          <Pin data-shelf-avatar-pinned="" size={15} />
        ) : (
          <Toggle size={15} />
        )}
      </button>
      <span aria-hidden className={across ? "h-5 w-px bg-border" : "h-px w-5 bg-border"} />
    </span>
  );
}

export function ShelfRail({ shelf, pages, shown, collapsed = false, at, owner, ctx }: { shelf: Shelf; pages: readonly SidePage[]; shown: string | null; collapsed?: boolean; at?: ShelfSide; owner?: ReactNode; /** The view the rail is drawn for (its tooltips say what of a page is empty for it). */ ctx?: SideViewContext }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const tabInfo = useSide((s) => s.tabInfo);
  const news = useRailNews((s) => s.pages);
  // The Shelf being drawn: the focused one, or the other workspace's live Shelf (§24.13).
  const layout = useShelfLayout();
  const focused = layout.activePage;
  const popover = usePagePopover((s) => s.pageId);
  const hot = useSideDnd((s) => (s.target?.kind === "page" ? s.target.pageId : null));
  const hotAdd = useSideDnd((s) => s.target?.kind === "newPage" && s.target.shelfId === shelf.id);
  // A page / ＋ under a dragged pane: an accent ring (only 框线+底色 also tints it).
  const hotLook = `scale-[1.08] text-accent ring-1 ring-accent/70 ${DROP_TINT}`;
  const hotTint = dropTint("var(--accent)", 15);
  const dragging = useSideDnd((s) => s.drag !== null);
  const focusedCard = useSide((s) => s.focusedCard);
  const all = layout.pages.filter((p) => p.shelf === shelf.id).length;
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  // The rail sits on the Shelf's window side ("outer") or next to the conversations ("inner"); the mark of
  // the page in view is on the rail's outer edge.
  const side = at ?? shelf.side;
  const atWindowEdge = shelf.options.railPlacement === "outer";
  const markRight = (side === "right") === atWindowEdge;
  // Portrait: across the Shelf's top (or bottom) edge; the page in view marked on the edge toward the panes.
  const edge = useRailEdge();
  const pageLane = useRef<HTMLDivElement>(null);
  useRailScroll(pageLane, shown, pages.map(p => `${p.id}:${p.cards.length}`).join("|"), !!edge, dragging);
  const toward: "left" | "right" | "up" | "down" = edge === "top" ? "down" : edge === "bottom" ? "up" : side === "right" ? "left" : "right";
  const kindIcon = (kind: string) => registry.get(kind as ItemId)?.item.icon ?? null;
  const popPage = popover ? findPage(useSide.getState().layout, popover) : null;
  const popIndex = popPage ? pages.findIndex((p) => p.id === popPage.id) + 1 : 0;
  return (
    <nav
      data-shelf-rail={shelf.id}
      data-shelf-rail-at={shelf.options.railPlacement}
      data-shelf-rail-collapsed={collapsed ? "" : undefined}
      aria-label={t(collapsed ? "shelf.railCollapsed" : "shelf.rail")}
      // A double-click on the rail's own space (its 「header」): 最大化 (rule 2, lib/panelGrow) the whole Shelf / back;
      // in 独占 (§24.16) it puts that back.
      onDoubleClick={(e) => {
        if (isElement(e.target) && e.target.closest("button, input")) return;
        const m = useSide.getState().mode;
        if (m?.kind === "maximised" && !m.card && m.shelf === shelf.id) toggleShelfMode("maximised", shelf.id);
        else toggleShelfGrow(shelf.id);
      }}
      // Collapsed it fills the Shelf's card; expanded it is a full-height card of its own (Rail look A, shelfCard.css).
      data-shelf-rail-edge={edge ?? undefined}
      className={edge ? `flex shrink-0 flex-row items-center gap-[3px] px-1 ${collapsed ? "min-h-0 min-w-0 flex-1" : "shelf-rail-card h-10 min-w-0"}` : `flex min-h-0 max-h-full shrink-0 flex-col items-center gap-[3px] py-1 ${collapsed ? "min-w-0 flex-1" : "shelf-rail-card w-10"}`}
    >
      {owner}
      <div ref={pageLane} data-shelf-rail-pages data-native-scrollbar
        className={edge ? "shelf-rail-pages flex min-w-0 flex-[0_1_auto] items-center gap-[3px] overflow-x-auto overflow-y-hidden px-1" : "shelf-rail-pages flex min-h-0 w-full flex-[0_1_auto] flex-col items-center gap-[3px] overflow-x-hidden overflow-y-auto py-1"}>
      {pages.map((page, k) => {
        // Icon, name and tooltip: what opens (lib/sideLayout pageAsShown).
        const seen = ctx ? pageAsShown(layout, page, ctx) : page;
        const Icon = pageIcon(seen, kindIcon);
        // A collapsed Shelf marks no page (none is on screen).
        const on = !collapsed && page.id === shown;
        // Never the internal page id (p1) in front of the owner.
        let name = page.name ?? t("side.launcherName");
        try {
          name = pageLabel(seen);
        } catch {
          // registry not up
        }
        const attention = page.cards.reduce((n, c) => n + c.tabs.reduce((m, id) => m + (tabInfo[id]?.attention ?? 0), 0), 0);
        const busy = !attention && page.cards.some((c) => c.tabs.some((id) => tabInfo[id]?.busy));
        const pageKey = k === pages.length - 1 ? digitBindingLabel("shelfPage", 9) : k < 8 ? digitBindingLabel("shelfPage", k + 1) : "";
        const keyTip = pageKey ? `${name}  ·  ${pageKey}` : name;
        // Owner 2026-10-23: where the page shows (a shared page: every workspace), and — on hover only — which of its
        // panes are empty for this agent (empty slots, components/side/EmptySlot) and whose things they hold.
        const scopeTip = t(page.shared ? "shelf.page.pinnedTip" : "shelf.page.scopeHere");
        // Only a page that keeps its layout draws empty slots (a page made by placement leaves them out).
        const empty = ctx && (page.kept || page.shared) ? emptySlots(layout, page, ctx) : [];
        const emptyInfo = ctx && empty.length ? slotInfo(layout, empty, ctx) : null;
        const emptyTip = emptyInfo ? emptySlotsTip(empty.length, page.cards.filter((c) => c.tabs.length > 0).length, emptyInfo, emptyInfo.owners.slice(0, 2).map((o) => ownerName(useApp.getState(), o))) : null;
        // Design 038: a page of several panes is a capsule of their icons (the frame drags the page, an icon its pane):
        // the panes the page draws for this agent (empty slots included).
        const cards = ctx ? shownCards(layout, page, ctx) : page.cards.filter((c) => c.tabs.length > 0);
        const multi = cards.length > 1;
        const tip = [keyTip, scopeTip, emptyTip].filter(Boolean).join("\n");
        return (
          // The page button and its pin (a sibling: no button inside a button).
          <div key={page.id} className="group/page relative flex shrink-0">
            <button
              ref={(el) => {
                buttons.current[page.id] = el;
              }}
              data-shelf-page={page.id}
              data-shelf-page-on={on ? "" : undefined}
              data-shelf-page-news={news[page.id] !== undefined ? "" : undefined}
              data-shelf-page-pinned={page.shared ? "" : undefined}
              data-tip={dragging ? undefined : tip}
              aria-label={name}
              aria-current={on ? "page" : undefined}
              // Owner 2026-10-22: a page button drags its page (reorder in this rail, or to the other Shelf's rail); a
              // short press stays a click (lib/sideDnd), the click after a drop is swallowed.
              {...sideDragHandle(() => ({ type: "page", pageId: page.id }))}
              onClick={(e) => {
                const pane = isElement(e.target) ? e.target.closest<HTMLElement>("[data-shelf-pane]") : null;
                if (pane?.dataset.shelfPane) paneIconClick(page.id, pane.dataset.shelfPane);
                else railPageClickNow(page.id);
              }}
              onContextMenu={(e) => {
                const pane = isElement(e.target) ? e.target.closest<HTMLElement>("[data-shelf-pane]") : null;
                contextMenu(() => pageMenu(page.id, pane?.dataset.shelfPane ?? null))(e);
              }}
              data-shelf-capsule={multi ? "" : undefined}
              style={hot === page.id ? hotTint : undefined}
              className={
                multi && edge
                  ? `shelf-capsule relative flex h-[30px] shrink-0 flex-row items-center gap-[3px] rounded-card px-1 text-muted transition-[background,color,box-shadow,transform] duration-(--motion-short) ease-(--ease-standard) ${on ? "bg-surface text-foreground" : ""} ${hot === page.id ? hotLook : ""}`
                  : multi
                  ? `shelf-capsule relative flex w-[30px] shrink-0 flex-col items-center gap-[3px] rounded-card py-1 text-muted transition-[background,color,box-shadow,transform] duration-(--motion-short) ease-(--ease-standard) ${on ? "bg-surface text-foreground" : ""} ${hot === page.id ? hotLook : ""}`
                  : `${BTN} ${on ? "bg-surface text-foreground shadow-e1" : ""} ${hot === page.id ? hotLook : ""} ${on && focused === page.id ? "ring-1 ring-accent/30" : ""}`
              }
            >
              {multi ? (
                cards.map((card) => {
                  const PaneIcon = kindIcon(card.kind) ?? Icon;
                  let pane = card.kind as string;
                  try {
                    pane = cardName(card);
                  } catch {
                    // registry not up
                  }
                  return (
                    <span
                      key={card.id}
                      data-shelf-pane={card.id}
                      data-shelf-pane-focus={on && focusedCard === card.id ? "" : undefined}
                      data-tip={dragging ? undefined : pane}
                      // The icon is the pane's own handle: it claims the press before the capsule (lib/sideDnd).
                      {...sideDragHandle(() => ({ type: "card", cardId: card.id }))}
                      className="flex size-6 items-center justify-center rounded-full"
                    >
                      <PaneIcon size={14} />
                    </span>
                  );
                })
              ) : (
                <Icon size={17} />
              )}
              {edge ? (
                <SelectionMark horizontal level={on ? "on" : "off"} className={`rounded-full ${edge === "top" ? "-bottom-[3px]" : "-top-[3px]"}`} on="w-4 bg-foreground" dim="w-2 bg-foreground" />
              ) : (
                <SelectionMark level={on ? "on" : "off"} className={`rounded-full ${markRight ? "-right-[3px]" : "-left-[3px]"}`} on="h-4 bg-foreground" dim="h-2 bg-foreground" />
              )}
              {attention > 0 && <CountBadge tone="danger" count={attention} max={9} className="absolute -top-1 -right-1" />}
              {busy && <span className="absolute right-1 bottom-1 size-1.5 animate-pulse rounded-full bg-ok" />}
              {/* Design 017: something arrived on this page while its Shelf stayed folded — a flash, then a dot until it is opened. */}
              {news[page.id] !== undefined && <span key={news[page.id]} aria-hidden className="side-flash pointer-events-none absolute inset-0 rounded-ctl" style={{ animationIterationCount: 2 }} />}
              {news[page.id] !== undefined && !attention && <span aria-hidden className="absolute top-1 right-1 size-[7px] rounded-full bg-accent ring-2 ring-background" />}
            </button>
            {/* Owner 2026-10-23: pinned = in every conversation (SidePage.shared), a quiet outline pin in the corner (not
                the tray's red pushpin); unpinned pages show it on hover only, to pin them. */}
            {!dragging && (
              <button
                data-shelf-page-pin={page.id}
                data-shelf-page-shared={page.shared ? "" : undefined}
                aria-pressed={!!page.shared}
                data-tip={t(page.shared ? "shelf.page.unpin" : "shelf.page.pin")}
                aria-label={`${name}: ${t(page.shared ? "shelf.page.unpin" : "shelf.page.pin")}`}
                onClick={() => togglePagePin(page.id)}
                className={`absolute -bottom-0.5 -left-0.5 flex size-3.5 items-center justify-center rounded-full bg-background text-subtle ring-1 ring-border transition-opacity duration-(--motion-short) hover:text-foreground focus-visible:opacity-100 ${page.shared ? "opacity-100" : "opacity-0 group-hover/page:opacity-100"}`}
              >
                <Pin size={8} />
              </button>
            )}
          </div>
        );
      })}
      </div>
      {all < MAX_SHELF_PAGES && (
        <button
          data-shelf-add={shelf.id}
          data-tip={t("shelf.addPage")}
          aria-label={t("shelf.addPage")}
          onClick={() => addPage(shelf.id)}
          data-shelf-add-armed={dragging ? "" : undefined}
          style={hotAdd ? hotTint : undefined}
          className={
            edge
              ? `ml-[3px] flex h-[30px] shrink-0 items-center justify-center rounded-ctl border-[1.5px] border-dashed text-subtle transition-[transform,width,border-color] hover:bg-hover hover:text-foreground ${dragging ? "border-accent/70 px-2 text-caption/[inherit] leading-tight text-accent" : "w-[30px] border-subtle/45"} ${hotAdd ? `border-accent ${hotLook}` : ""}`
              : `mt-[3px] flex w-[30px] shrink-0 items-center justify-center rounded-ctl border-[1.5px] border-dashed text-subtle transition-[transform,height,border-color] hover:bg-hover hover:text-foreground ${dragging ? "h-10 border-accent/70 text-caption/[inherit] leading-tight text-accent" : "h-[30px] border-subtle/45"} ${hotAdd ? `border-accent ${hotLook}` : ""}`
          }
        >
          {/* Design 038: while a page / pane is dragged the ＋ says what a drop there does. */}
          {dragging ? t("shelf.dnd.newPageSlot") : <Plus size={14} />}
        </button>
      )}
      <button data-shelf-menu={shelf.id} data-tip={t("shelf.menu")} aria-label={t("shelf.menu")} onClick={(e) => openMenuFrom(e.currentTarget, shelfMenu(shelf.id))} className={`${BTN} ${edge ? "ml-auto" : "mt-auto"}`}>
        <MoreHorizontal size={16} />
      </button>
      {/* How pages and panes move (design 040 §2.1: not in the tips). */}
      <InfoMark text={[shelfAvatarHowTo(collapsed), t("shelf.page.capsuleTip")].join("\n")} className={`hover-info ${edge ? "px-0.5" : "py-0.5"}`} />
      {popPage && popIndex > 0 && buttons.current[popPage.id] && <PagePopover key={popPage.id} page={popPage} index={popIndex} anchor={buttons.current[popPage.id]!} toward={toward} />}
    </nav>
  );
}

/**
 * An empty Shelf's rail (Shelf Rail 常驻, owner 2026-10-21; §24.12.3): the conversation's avatar and a ＋ that
 * opens the launchers (the pick opens in this conversation's Shelf) — no pages, no collapse button, no ⋯. Drawn
 * where the conversation's Shelf would be (components/side/SideArea). `focus`: another workspace's — a press
 * brings it over first.
 */
export function EmptyShelfRail({ hostId, sessionId, at, order, focus = null, paneId = null }: { hostId: string; sessionId: string; at: ShelfSide; order?: number; focus?: (() => void) | null; paneId?: string | null }) {
  const { t } = useI18n();
  const tip = t("convHeader.shelfLaunch");
  const edge = useRailEdge();
  // Portrait (lib/portrait): a 40 px bar across the stack's end; at the stack's top (swapped) it leaves no tray room under it.
  if (edge)
    return (
      <div data-side-root data-shelf-box={at} data-shelf-rail-empty={at} data-ws-shelf={paneId ?? undefined} className="relative flex shrink-0" style={{ height: STACK_RAIL_H, order, marginBottom: edge === "bottom" ? 0 : undefined }}>
        <nav aria-label={t("shelf.emptyRail")} data-shelf-card="" data-shelf-collapsed="" data-shelf-rail-edge={edge} className="shelf-card flex min-w-0 flex-1 flex-row items-center gap-[3px] shelf-rail-card rounded-xl border border-card-border px-1">
          <RailOwner hostId={hostId} sessionId={sessionId} onClick={focus ?? undefined} />
          <button
            data-shelf-rail-launch=""
            data-tip={tip}
            aria-label={tip}
            aria-haspopup="menu"
            onClick={(e) => openMenuFrom(e.currentTarget, [...shelfLauncherMenu(focus), ...panelGuideTail({ panel: "shelf", paneId, hostId, sessionId })])}
            className="ml-[3px] flex size-[30px] shrink-0 items-center justify-center rounded-ctl border-[1.5px] border-dashed border-subtle/45 text-subtle hover:bg-hover hover:text-foreground"
          >
            <Plus size={14} />
          </button>
        </nav>
      </div>
    );
  return (
    <div data-side-root data-shelf-box={at} data-shelf-rail-empty={at} data-ws-shelf={paneId ?? undefined} className={`relative flex shrink-0 ${at === "left" ? "pr-2" : "justify-end pl-2"}`} style={{ width: COLLAPSED_SHELF_WIDTH, order }}>
      <nav aria-label={t("shelf.emptyRail")} data-shelf-card="" data-shelf-collapsed="" className="shelf-card flex w-10 shrink-0 flex-col items-center gap-[3px] shelf-rail-card rounded-xl border border-card-border py-1">
        <RailOwner hostId={hostId} sessionId={sessionId} onClick={focus ?? undefined} />
        <button
          data-shelf-rail-launch=""
          data-tip={tip}
          aria-label={tip}
          aria-haspopup="menu"
          onClick={(e) => openMenuFrom(e.currentTarget, [...shelfLauncherMenu(focus), ...panelGuideTail({ panel: "shelf", paneId, hostId, sessionId })])}
          className="mt-[3px] flex size-[30px] shrink-0 items-center justify-center rounded-ctl border-[1.5px] border-dashed border-subtle/45 text-subtle hover:bg-hover hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </nav>
    </div>
  );
}
