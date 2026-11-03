// The Shelf menus (docs/desktop-modules.md §24.12; prototype .claude/preview-shelves.html scenario A): a
// page button's right-click (重命名 / 换图标 / 上移 / 下移 / 删除这一页 — undoable) and a Shelf's ⋯ (允许混排,
// 只用一个 Shelf (the layout's, §24.12), Shelf Rail 外侧 / 内侧, 收起 (to its rail) / 展开, 最大化 / 全屏 (§24.16), 移到另一边,
// 关闭 Shelf — undoable). Actions: lib/shelves. Shell code:
// names no feature.
import { shelfCloseForetell, shelfCollapseForetell, shelfGrowForetell, shelfMoveForetell } from "./menuForetells";
import { ArrowDown, ArrowDownUp, ArrowUp, Check, Columns2, Combine, Expand, LayoutTemplate, Maximize2, Minimize2, Minus, PanelLeft, PanelRight, Pencil, Pin, PinOff, Shapes, SquareSplitVertical, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { translate } from "../i18n";
import type { MenuAction, MenuEntry } from "./contextMenu";
import { cardName, pageLabel, toggleShelfMode } from "./sideActions";
import { canGrow, shelfGrown, toggleShelfGrow } from "./panelGrow";
import { liveConversation } from "./sideLayoutStore";
import { sideViewNow } from "./sideComponents";
import { canMergePage, findPage, findShelf, MAX_SHELF_PAGES, pagesOfShelf, shelfLanePages, shelfOfPage, shelfOnSide, shelvesOf, otherSide } from "./sideLayout";
import { saveShelfAsDefault, updateLayout, useSide } from "./sideLayoutStore";
import { closeShelf, collapseShelfNow, deletePage, expandShelfNow, editPage, mergePageUp, movePageBy, splitPaneOut, moveShelfSide, setShelfOption, setSingleShelfNow, showShelfToast } from "./shelves";
import { setPageShared } from "./sideLayout";
import { panelSettingsItem } from "./panelSettings";
import { panelGuideTail } from "./panelGuideMenu";
import { portraitOn, swapPortrait, usePortrait } from "./portrait";
import { currentWindow } from "./windowScope";

const ICON = 14;

const note = (label: string): MenuAction => ({ label, note: true, disabled: true, onSelect: () => {} });

/**
 * Right-click on a page button / capsule. `cardId` (design 038): the pane icon right-clicked in a capsule — 拆开 takes
 * that pane; without it the focused pane of the page, else its bottom one.
 */
/** 固定到所有工作区 / 取消固定 (SidePage.shared): the page menu and the capsule's pin. */
export function togglePagePin(pageId: string): void {
  updateLayout((l) => setPageShared(l, pageId, !findPage(l, pageId)?.shared));
}

export function pageMenu(pageId: string, cardId?: string | null): MenuEntry[] {
  const { layout } = useSide.getState();
  const page = findPage(layout, pageId);
  const shelf = shelfOfPage(layout, pageId);
  if (!page || !shelf) return [];
  const rail = pagesOfShelf(layout, shelf.id);
  const lane = (() => {
    try {
      return shelfLanePages(layout, shelf.id, sideViewNow());
    } catch {
      return rail;
    }
  })();
  const k = rail.indexOf(rail.find((p) => p.id === pageId)!);
  const n = lane.findIndex((p) => p.id === pageId) + 1 || k + 1;
  const panes = page.cards.length;
  const focusedCard = useSide.getState().focusedCard;
  const split = page.cards.find((c) => c.id === cardId) ?? page.cards.find((c) => c.id === focusedCard) ?? page.cards[panes - 1];
  const above = k > 0 ? rail[k - 1] : undefined;
  return [
    note(translate("shelf.page.menuHead", { n, name: pageLabel(page) })),
    { label: translate("shelf.page.rename"), icon: <Pencil size={ICON} />, onSelect: () => editPage(pageId) },
    { label: translate("shelf.page.icon"), icon: <Shapes size={ICON} />, onSelect: () => editPage(pageId) },
    rail.length > 1 && { label: translate("shelf.page.moveUp"), icon: <ArrowUp size={ICON} />, disabled: k <= 0, onSelect: () => movePageBy(pageId, -1) },
    rail.length > 1 && { label: translate("shelf.page.moveDown"), icon: <ArrowDown size={ICON} />, disabled: k >= rail.length - 1, onSelect: () => movePageBy(pageId, 1) },
    // Design 038: a page's panes as a group — split one out to a page of its own, or join the page above.
    {
      label: panes > 1 && split ? translate("shelf.page.splitOut", { name: cardName(split) }) : translate("shelf.page.split"),
      icon: <SquareSplitVertical size={ICON} />,
      disabled: panes < 2 || !split || rail.length >= MAX_SHELF_PAGES,
      onSelect: () => split && splitPaneOut(split.id),
    },
    rail.length > 1 && { label: translate("shelf.page.mergeUp"), icon: <Combine size={ICON} />, disabled: !above || !canMergePage(layout, pageId, above.id), onSelect: () => mergePageUp(pageId) },
    "separator",
    // §24.13; owner 2026-10-23: a page's scope works like pinning an agent to the tray — unpinned (every new page) =
    // this conversation only; pinned = in every conversation's Shelf (one instance, it moves with the focus).
    {
      label: translate(page.shared ? "shelf.page.unpin" : "shelf.page.pin"),
      icon: page.shared ? <PinOff size={ICON} /> : <Pin size={ICON} />,
      onSelect: () => togglePagePin(pageId),
    },
    "separator",
    {
      label: translate("shelf.page.delete"),
      icon: <Trash2 size={ICON} />,
      danger: true,
      info: panes ? translate("shelf.page.deleteHint", { n: panes }) : undefined,
      onSelect: () => deletePage(pageId),
    },
    ...panelGuideTail({ panel: "shelf", shelfId: shelf.id }),
  ];
}

/** Portrait only: the swap of the stack's two parts, then a separator (landscape: nothing). */
function portraitSwapEntry(): MenuEntry[] {
  const key = currentWindow();
  if (!portraitOn(key)) return [];
  const swapped = usePortrait.of(key).getState().prefs.swapped;
  return [{ label: translate(swapped ? "orientation.convOnTop" : "orientation.shelfOnTop"), icon: <ArrowDownUp size={ICON} />, title: translate("orientation.swapHint"), onSelect: () => swapPortrait(key) }, "separator"];
}

/** A Shelf's ⋯ (at the end of its rail). */
export function shelfMenu(shelfId: string): MenuEntry[] {
  const { layout } = useSide.getState();
  const shelf = findShelf(layout, shelfId);
  if (!shelf) return [];
  const pages = pagesOfShelf(layout, shelfId);
  const panes = pages.reduce((n, p) => n + p.cards.length, 0);
  const mixing = shelf.options.allowMixing;
  const to = otherSide(shelf.side);
  const taken = !!shelfOnSide(layout, to);
  const rail = shelf.options.railPlacement;
  const single = layout.singleShelf === true;
  const singleNote = translate(single ? (shelvesOf(layout).length > 1 ? "shelf.singleOnTwo" : "shelf.singleOn") : "shelf.singleOff");
  const mode = useSide.getState().mode;
  const inMode = (kind: "maximised" | "fullscreen") => mode?.kind === kind && !mode.card && mode.shelf === shelfId;
  const toggleMixing = () => setShelfOption(shelfId, { allowMixing: !useSide.getState().layout.shelves?.find((x) => x.id === shelfId)?.options.allowMixing });
  return [
    note(translate(shelf.side === "left" ? "shelf.menu.headLeft" : "shelf.menu.headRight", { n: pages.length })),
    {
      label: translate("shelf.mixing"),
      icon: <Combine size={ICON} />,
      info: translate(mixing ? "shelf.mixingOn" : "shelf.mixingOff"),
      toggle: {
        on: mixing,
        onIcon: <ToggleRight size={15} className="text-accent" />,
        offIcon: <ToggleLeft size={15} />,
        onLabel: translate("shelf.mixingOn"),
        offLabel: translate("shelf.mixingOff"),
        onToggle: (next) => setShelfOption(shelfId, { allowMixing: next }),
      },
      onSelect: toggleMixing,
    },
    {
      label: translate("shelf.single"),
      icon: <Columns2 size={ICON} />,
      info: singleNote,
      toggle: {
        on: single,
        onIcon: <ToggleRight size={15} className="text-accent" />,
        offIcon: <ToggleLeft size={15} />,
        onLabel: translate("shelf.singleOn"),
        offLabel: translate("shelf.singleOff"),
        onToggle: (next) => setSingleShelfNow(next),
      },
      onSelect: () => setSingleShelfNow(useSide.getState().layout.singleShelf !== true),
    },
    "separator",
    { label: translate("shelf.railOuter"), icon: rail === "outer" ? <Check size={ICON} /> : <span className="inline-block w-[14px]" />, onSelect: () => setShelfOption(shelfId, { railPlacement: "outer" }) },
    { label: translate("shelf.railInner"), icon: rail === "inner" ? <Check size={ICON} /> : <span className="inline-block w-[14px]" />, onSelect: () => setShelfOption(shelfId, { railPlacement: "inner" }) },
    "separator",
    // Portrait (lib/portrait): the conversation and its Shelf trade places (this window; also the divider's ⇅ and Settings).
    ...portraitSwapEntry(),
    shelf.collapsed
      ? { label: translate("shelf.expandTip"), icon: <Maximize2 size={ICON} />, foretell: () => shelfCollapseForetell(shelf.side, true), onSelect: () => expandShelfNow(shelfId) }
      : { label: translate("shelf.collapseRail"), icon: <Minus size={ICON} />, title: translate("shelf.collapseTip"), foretell: () => shelfCollapseForetell(shelf.side, false), onSelect: () => collapseShelfNow(shelfId) },
    // 最大化 (rule 2, lib/panelGrow): the Shelf takes every gap of the row; 独占 (§24.16, the former 最大化): the whole
    // row, the rest drawn as rails / strips; 全屏: only it on screen. None stored.
    pages.length > 0 && { label: translate(shelfGrown(shelfId) ? "panel.restore" : "panel.maximiseShelf"), icon: shelfGrown(shelfId) ? <Minimize2 size={ICON} /> : <Maximize2 size={ICON} />, hint: translate("panel.dblRail"), disabled: !shelfGrown(shelfId) && !canGrow({ kind: "shelf", conv: liveConversation(), shelfId, card: null }), title: translate("panel.maxNoGap"), foretell: () => shelfGrowForetell(shelf.side, "grow", shelfGrown(shelfId)), onSelect: () => void toggleShelfGrow(shelfId) },
    pages.length > 0 && { label: translate(inMode("maximised") ? "panel.exclusiveOff" : "panel.exclusive"), icon: <Columns2 size={ICON} />, title: translate("panel.exclusiveHint"), foretell: () => shelfGrowForetell(shelf.side, "exclusive", inMode("maximised")), onSelect: () => toggleShelfMode("maximised", shelfId) },
    pages.length > 0 && { label: translate(inMode("fullscreen") ? "panel.exitFullscreenShort" : "panel.fullscreen"), icon: <Expand size={ICON} />, hint: "F11", foretell: () => shelfGrowForetell(shelf.side, "fullscreen", inMode("fullscreen")), onSelect: () => toggleShelfMode("fullscreen", shelfId) },
    {
      label: translate(to === "left" ? "shelf.moveLeft" : "shelf.moveRight"),
      icon: to === "left" ? <PanelLeft size={ICON} /> : <PanelRight size={ICON} />,
      disabled: taken,
      title: taken ? translate("shelf.moveTaken") : undefined,
      foretell: () => (taken ? null : shelfMoveForetell(shelf.side)),
      onSelect: () => moveShelfSide(shelfId),
    },
    "separator",
    // §24.13: what new conversations' Shelves start as (the default layout; their own pages only).
    {
      label: translate("shelf.menu.setDefault"),
      icon: <LayoutTemplate size={ICON} />,
      title: translate("shelf.menu.setDefaultHint"),
      onSelect: () => {
        saveShelfAsDefault();
        showShelfToast(translate("shelf.menu.setDefaultDone"));
      },
    },
    "separator",
    { label: translate("shelf.close"), icon: <X size={ICON} />, danger: true, info: panes ? translate("shelf.closeHint", { n: panes }) : undefined, foretell: () => shelfCloseForetell(shelf.side, panes), onSelect: () => closeShelf(shelfId) },
    // Design 006 v1: the last row opens Settings → {{shelf}} (its foretell outlines this Shelf).
    "separator",
    panelSettingsItem("sides", { panel: `[data-shelf="${CSS.escape(shelfId)}"]` }),
    ...panelGuideTail({ panel: "shelf", shelfId }),
  ];
}

