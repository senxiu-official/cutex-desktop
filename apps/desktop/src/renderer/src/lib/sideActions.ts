// User actions on the right side (docs/desktop-modules.md §18): the title bar, page buttons, cards,
// menus and keyboard shortcuts all go through these, so a click and its shortcut never diverge.
// Shell code: no feature names (the title bar's "open the default components" comes in as a callback).
import { translate } from "../i18n";
import { closeSideInstances, closeWarnings } from "./sideServices";
import { sideViewNow, sideRegistry } from "./sideComponents";
import {
  cardInstances,
  dropEmptyPage,
  findCard,
  findPage,
  lanePages,
  locate,
  openLauncherPage,
  pageInstances,
  pageInView,
  pageName,
  setCollapsed,
  setOpen,
  switchPage,
  visibleTabs,
  type SideCard,
  type SidePage,
} from "./sideLayout";
import { flashCard, setFocusedCard, setMode, updateLayout, useSide, type SideMode } from "./sideLayoutStore";
import { laneClickAction, type LaneClickAction } from "./sideLaneClick";
import { getUiPrefs, setUiPref } from "./prefs";

/** Show / hide the column. A side with nothing for this agent runs `whenEmpty` (the default components) instead. */
export function toggleColumn(whenEmpty?: () => void): void {
  const s = useSide.getState();
  if (s.mode) setMode(null);
  if (!lanePages(s.layout, sideViewNow()).some((p) => p.cards.length)) {
    if (s.layout.open) updateLayout((l) => setOpen(l, false));
    else if (whenEmpty) whenEmpty();
    else updateLayout((l) => setOpen(l, true));
    return;
  }
  updateLayout((l) => setOpen(l, !l.open));
}

export function closeColumn(): void {
  if (useSide.getState().mode) setMode(null);
  updateLayout((l) => setOpen(l, false));
}

/**
 * A page button (or one of its card icons) clicked (§18.3, rule in lib/sideLaneClick): another page →
 * open the column on it (expanding that card); the page in view → expand a collapsed card, focus a
 * visible one, else nothing (with 点击当前页图标 = 收起侧栏: close the column; otherwise the lane's own
 * collapse button does that). While maximised / full screen the mode follows the page.
 */
export function pageButtonClick(pageId: string, cardId: string | null = null): void {
  const s = useSide.getState();
  const card = cardId ? findCard(s.layout, cardId) : null;
  const action = laneClickAction({
    open: s.layout.open,
    activePage: s.layout.activePage,
    layered: !!s.mode,
    pageId,
    cardId: card ? card.card.id : null,
    cardCollapsed: !!card?.card.collapsed,
    setting: getUiPrefs().sideCurrentPageClick,
  });
  runLaneAction(action);
}

/** Carries out a page-button / launcher click (lib/sideLaneClick, lib/sideLaunchers). */
export function runLaneAction(action: LaneClickAction): void {
  const s = useSide.getState();
  switch (action.kind) {
    case "switch":
      updateLayout((l) => {
        const next = switchPage(l, action.pageId);
        return action.expand ? setCollapsed(next, action.expand, false) : next;
      });
      if (s.mode?.card) setMode({ kind: s.mode.kind, card: null });
      return;
    case "expand":
      updateLayout((l) => setCollapsed(l, action.cardId, false));
      return;
    case "focus":
      focusCard(action.cardId);
      return;
    case "close":
      closeColumn();
      return;
  }
}

/** A visible card of the page in view: make it the focused card, scroll it into view and flash it. */
function focusCard(cardId: string): void {
  setFocusedCard(cardId);
  flashCard(cardId);
  document.querySelector(`[data-side-card="${CSS.escape(cardId)}"]`)?.scrollIntoView({ block: "nearest" });
}

/** Ctrl+Shift+n: the n-th page button (1-based), same rule as clicking it (the page in view again → 点击当前页图标). */
export function goToPage(n: number): void {
  const page = lanePages(useSide.getState().layout, sideViewNow())[n - 1];
  if (page) pageButtonClick(page.id);
}

/** 新页面: an empty launcher page in view (dropped when left empty). */
export function newPage(): void {
  if (useSide.getState().mode) setMode(null);
  updateLayout((l) => openLauncherPage(l).layout);
}

/** ⤢ / ⛶ (and Ctrl+Shift+M / Shift+F11): toggle the mode for a card or the page in view. */
export function toggleMode(kind: SideMode["kind"], card: string | null): void {
  const s = useSide.getState();
  if (s.mode && s.mode.kind === kind && s.mode.card === card) {
    setMode(null);
    return;
  }
  if (!s.layout.pages.length) return;
  if (!s.layout.open) updateLayout((l) => setOpen(l, true));
  setMode({ kind, card });
}

/** Shortcut target: the focused card when it is on the page in view, else the page. */
export function toggleModeForFocus(kind: SideMode["kind"]): void {
  const s = useSide.getState();
  const at = s.focusedCard ? findCard(s.layout, s.focusedCard) : null;
  const card = at && at.page.id === s.layout.activePage ? at.card.id : null;
  if (s.mode && s.mode.kind === kind) {
    setMode(null);
    return;
  }
  toggleMode(kind, card);
}

/** 钉住 (float mode): switch the setting to 并排; unpinning goes back to 悬浮. */
export function togglePin(): void {
  const mode = getUiPrefs().sideMode;
  if (mode === "float") {
    pinnedFromFloat = true;
    setUiPref("sideMode", "push");
  } else if (pinnedFromFloat) {
    pinnedFromFloat = false;
    setUiPref("sideMode", "float");
  }
}
let pinnedFromFloat = false;
export function pinnedFromFloatNow(): boolean {
  return pinnedFromFloat && getUiPrefs().sideMode === "push";
}

// ── Close (§18.2) ──────────────────────────────────────────────────────────────────────────────
// A close that would end something (components' `closeConfirm`, e.g. a running terminal) is
// confirmed in place, click-twice style (lib/armedConfirm.ts): the card × / menu item arms first and
// shows the warnings, the second click closes. Callers ask `…CloseWarnings` before calling the close.

/** A tab's ×: no confirm (same as today's single close; its menu item names what closing ends). */
export function closeTab(id: string): void {
  void closeSideInstances([id]);
}

export function cardName(card: SideCard): string {
  const entry = sideRegistry().get(card.kind);
  if (!entry) return card.kind;
  const info = useSide.getState().tabInfo;
  const shown = card.active && info[card.active] ? info[card.active]!.title : null;
  const title = translate(entry.item.titleKey);
  return card.tabs.length === 1 && shown ? shown : title;
}

export function pageLabel(page: SidePage): string {
  return pageName(page, cardName, translate("side.launcherName"));
}

/** What the card × closes: all its tabs visible to the current agent (others' tabs stay). */
function cardTargets(cardId: string): string[] {
  const s = useSide.getState();
  const at = findCard(s.layout, cardId);
  if (!at) return [];
  const visible = visibleTabs(s.layout, at.card, sideViewNow());
  return visible.length ? visible : cardInstances(s.layout, cardId);
}

/** What 关闭页 closes: what the page shows this agent (other agents' content stays: the page stays for them). */
function pageTargets(pageId: string): string[] {
  const s = useSide.getState();
  const page = findPage(s.layout, pageId);
  if (!page) return [];
  const ctx = sideViewNow();
  const visible = page.cards.flatMap((c) => visibleTabs(s.layout, c, ctx));
  return visible.length ? visible : pageInstances(s.layout, pageId);
}

/** What 关闭其他 closes: the card's other visible tabs. */
function otherTabTargets(id: string): string[] {
  const s = useSide.getState();
  const at = locate(s.layout, id);
  if (!at) return [];
  return visibleTabs(s.layout, at.card, sideViewNow()).filter((t) => t !== id);
}

/** The one-line warnings of each close (empty = no confirm, close right away). */
export const cardCloseWarnings = (cardId: string): string[] => closeWarnings(cardTargets(cardId));
export const pageCloseWarnings = (pageId: string): string[] => closeWarnings(pageTargets(pageId));
export const otherTabsCloseWarnings = (id: string): string[] => closeWarnings(otherTabTargets(id));

/** Warnings shown in an armed button / menu row. */
export const joinWarnings = (lines: readonly string[]): string => lines.join(" · ");

/** Card × (confirmed in place by the caller when `cardCloseWarnings` is non-empty). */
export function closeCard(cardId: string): void {
  const ids = cardTargets(cardId);
  if (ids.length) void closeSideInstances(ids);
}

/** 关闭页 (confirmed in place by the caller when `pageCloseWarnings` is non-empty); an empty page just goes. */
export function closePage(pageId: string): void {
  const s = useSide.getState();
  const page = findPage(s.layout, pageId);
  if (!page) return;
  if (!page.cards.length) {
    updateLayout((l) => dropEmptyPage(l, pageId));
    return;
  }
  const ids = pageTargets(pageId);
  if (ids.length) void closeSideInstances(ids);
}

/** 关闭其他 (confirmed in place by the caller when `otherTabsCloseWarnings` is non-empty). */
export function closeOtherTabs(id: string): void {
  const ids = otherTabTargets(id);
  if (ids.length) void closeSideInstances(ids);
}

/** The page in view for the current agent (title bar actions). */
export function currentPage(): SidePage | null {
  const s = useSide.getState();
  return s.layout.open ? pageInView(s.layout, sideViewNow()) : null;
}
