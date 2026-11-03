// Pane actions across both areas (docs/desktop-modules.md §24 step 4; research panes-20261019.md §4): the
// work area's conversation panes (lib/paneStore) and the tool area's panes (lib/sideLayoutStore) share one
// tray of chips, one maximised pane, 「显示桌面」, the pane keys and the focused pane. Headers, chips, the
// title bar and the keyboard all go through these, so a click and its shortcut never diverge.
//   「—」            a tool pane: 移到另一页 / 关闭 (#7, owner 2026-10-21; lib/sideMenus paneDashMenu) — no
//                    tool pane goes to the tray any more. A (stored) chip still shown: a click puts it back,
//                    its × closes it; beyond MAX_CHIPS the oldest closes (unless closing it would end
//                    something: `closeConfirm`)
//   ⤢ / 双击标题     最大化 (rule 2, lib/panelGrow: takes every gap of the row; Esc or ⤢ restores; never stored)
//   ⋯ → 独占         a conversation: the other workspaces fold to strips (lib/convStrips, docs/design/002);
//                    a Shelf / pane: the former maximise (the panel takes the whole row, the others as rails)
//   显示桌面         the conversations off screen, the expanded Shelves collapsed to their rails; again
//                    (nothing on screen): the layout before
// Shell code: names no feature.
import { create } from "zustand";
import { currentWindow, windowStore } from "./windowScope";
import { portraitOn } from "./portrait";
import { translate } from "../i18n";
import { sidebarOf, useApp } from "../store";
import { confirmDialog, openMenuAt, openMenuFrom, type MenuEntry } from "./contextMenu";
import { flyFromChip, flyToChip, boxOf, chipElement } from "./paneFly";
import {
  clearMaximized,
  closeChip as closeWorkChip,
  emptyWork,
  collapseConversation,
  conversationPanes,
  focusedConversation,
  focusPane,
  isEmptyPane,
  MAX_CHIPS,
  overflowChips,
  paneBinding,
  paneInDirection,
  panePage,
  restoreConversation,
  toggleMaximized,
  type PaneLayout,
  type TrayEntry,
} from "./paneLayout";
import { closeConversationPane, closePanePage, focusConversationPane, setPaneLayout, usePanes } from "./paneStore";
import { roomForColumn } from "./paneRoom";
import { closePaneWithHint } from "./convPaneControls";
import { setPaneKeyRunner, type PaneKeyAction } from "./paneKeys";
export { paneKeyAction } from "./paneKeys";
import { cardName, closeTab, joinWarnings, toggleMode } from "./sideActions";
import { sideRegistry, sideViewNow } from "./sideComponents";
import { canJoin, cardLastUsed, columnsOnScreen, expandShelf, findCard, findChip, findShelf, joinInto, locate, restoreCard, shownCards, shownTab, type SideChip, type SideLayout } from "./sideLayout";
import { flashCard, paneMaximised, restorePaneMaximised, setFocusedCard, setMode, setWorkMaximised, updateLayout, useSide } from "./sideLayoutStore";
import { launchable } from "./sideMenus";
import { enterFullscreen, exitFullscreen, fullscreenOn, restorePanels, startPanelFull } from "./panelFull";
import { canGrow, endGrow, growOn, toggleGrow, type GrowTarget } from "./panelGrow";
import { startPanelGrow } from "./panelGrowStart";
import { liveConversation } from "./sideLayoutStore";
import { openSide } from "./sideOpen";
import { closeSideInstances, closeWarnings } from "./sideServices";
import { expandStrip, soloWorkspace, stripPanes, useStrips } from "./convStrips";
import { isElement, ownerWindowOf } from "./ownerWindow";
import { onEveryAppWindow, queryAllAppWindows, queryAppWindows } from "./appWindowSet";

// A maximised conversation pane for the Esc layer and the conversation's Esc (lib/sideLayoutStore), and the pane keys (lib/paneKeys).
// 最大化 (lib/panelGrow) counts too: Esc restores it, a tool opening ends it.
setWorkMaximised({
  maximised: () => !!usePanes.getState().layout.max || growOn(),
  restore: () => {
    endGrow();
    if (usePanes.getState().layout.max) setPaneLayout(clearMaximized);
  },
});
setPaneKeyRunner((action) => runKey(action));

/** A pane of either area: a conversation pane (work) or a tool pane (its card id). */
export interface PaneRef {
  area: "work" | "tools";
  id: string;
}

/** A pane's key in the tray and in the DOM (`data-pane-chip`): `w:<pane>` / `t:<card>`. */
export const chipKey = (ref: PaneRef): string => `${ref.area === "work" ? "w" : "t"}:${ref.id}`;
export const refOfKey = (key: string): PaneRef | null => (key.startsWith("w:") ? { area: "work", id: key.slice(2) } : key.startsWith("t:") ? { area: "tools", id: key.slice(2) } : null);

// ── The tray ────────────────────────────────────────────────────────────────────────────────────

/** Every chip of both areas as the tray orders them (oldest first). `visible`: a tool chip's content shows for the focused agent. */
export function trayEntries(work: PaneLayout, side: SideLayout, closable: (chip: SideChip) => boolean = () => true): (TrayEntry & { ref: PaneRef })[] {
  const out: (TrayEntry & { ref: PaneRef })[] = [];
  for (const id of work.chips) out.push({ key: chipKey({ area: "work", id }), at: work.panes[id]?.home?.at ?? 0, closable: true, ref: { area: "work", id } });
  for (const chip of side.chips ?? []) out.push({ key: chipKey({ area: "tools", id: chip.card.id }), at: chip.at, closable: closable(chip), ref: { area: "tools", id: chip.card.id } });
  return out.sort((a, b) => a.at - b.at);
}

/** Closes the oldest chips beyond MAX_CHIPS (a chip whose closing would end something stays). */
export function trimChips(): void {
  const entries = trayEntries(usePanes.getState().layout, useSide.getState().layout, (chip) => closeWarnings(chip.card.tabs).length === 0);
  for (const key of overflowChips(entries, MAX_CHIPS)) {
    const ref = refOfKey(key)!;
    if (ref.area === "work") setPaneLayout((l) => closeWorkChip(l, ref.id));
    else {
      const chip = findChip(useSide.getState().layout, ref.id);
      if (chip) void closeSideInstances(chip.card.tabs);
    }
  }
}

// ── The focused pane ────────────────────────────────────────────────────────────────────────────

/** Which area was used last (a pointer / focus inside a pane): the keys act on its focused pane. */
let lastArea: "work" | "tools" = "work";

/** The focused pane: the tool pane last used (when the tool area was used last and it is on screen), else the focused conversation pane. */
export function focusedPaneRef(): PaneRef | null {
  if (lastArea === "tools") {
    const id = useSide.getState().focusedCard;
    if (id && findCard(useSide.getState().layout, id) && typeof document !== "undefined" && queryAppWindows(`[data-side-card="${CSS.escape(id)}"]`)) return { area: "tools", id };
  }
  const f = focusedConversation(usePanes.getState().layout);
  return f ? { area: "work", id: f } : null;
}

/** A pointer / focus went into a pane (App-level capture listener). */
function noteFocus(target: EventTarget | null): void {
  if (!isElement(target)) return;
  if (target.closest("[data-side-card], [data-side-card-of]")) lastArea = "tools";
  else if (target.closest('[data-conv-pane], [data-focus-region="main"]')) lastArea = "work";
}

// ── DOM of the panes ────────────────────────────────────────────────────────────────────────────

/** A conversation pane's element: its column (several on screen), else the conversation card (one pane). */
function conversationElement(id: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return queryAppWindows<HTMLElement>(`[data-conv-pane="${CSS.escape(id)}"]`) ?? (focusedConversation(usePanes.getState().layout) === id ? queryAppWindows<HTMLElement>('[data-focus-region="main"]') : null);
}

/** The elements a pane is drawn with (a tool pane: its card and its instance boxes). */
function paneElements(ref: PaneRef): HTMLElement[] {
  if (typeof document === "undefined") return [];
  if (ref.area === "work") {
    const el = conversationElement(ref.id);
    return el ? [el] : [];
  }
  return queryAllAppWindows<HTMLElement>(`[data-side-card="${CSS.escape(ref.id)}"], [data-side-card-of="${CSS.escape(ref.id)}"]`);
}

/** A pane's name for the fly ghost: its agent, else its card name. */
function paneTitle(ref: PaneRef): string {
  if (ref.area === "tools") {
    const layout = useSide.getState().layout;
    const card = findCard(layout, ref.id)?.card ?? findChip(layout, ref.id)?.card;
    try {
      return card ? cardName(card) : "";
    } catch {
      return card?.kind ?? ""; // the module host is not up (tests): the kind id
    }
  }
  const b = paneBinding(usePanes.getState().layout, ref.id);
  if (!b?.sessionId) return "";
  const sidebar = sidebarOf(useApp.getState(), b.hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === b.sessionId)?.displayName ?? b.sessionId;
}

// ── Collapse, restore, close a chip ─────────────────────────────────────────────────────────────

/**
 * @deprecated #7 (owner 2026-10-21): a tool pane never goes to the tray (its 「—」 is 移到另一页 / 关闭,
 * lib/sideMenus paneDashMenu): for a tool pane this does nothing. A conversation pane goes to the tray.
 */
export function collapsePane(ref: PaneRef): void {
  if (ref.area !== "work") return;
  const from = boxOf(paneElements(ref)[0]);
  const title = paneTitle(ref);
  setPaneLayout((l) => collapseConversation(l, ref.id, Date.now()));
  useDesktop.setState({ snapshot: null, focus: null });
  flyToChip(from, chipKey(ref), title);
}

function restoreNow(ref: PaneRef, now: number, focus = true): void {
  const room = roomForColumn(ref.area === "work" ? "conversation" : "tool");
  if (ref.area === "work") setPaneLayout((l) => restoreConversation(l, ref.id, now, { room, focus }));
  else {
    updateLayout((l) => restoreCard(l, ref.id, now, { roomForColumn: room }));
    if (focus) {
      setFocusedCard(ref.id);
      lastArea = "tools";
    }
  }
}

/** A click on a chip: the pane comes back next to its old neighbours (the ghost flies out of the chip). @deprecated #7: no new tool chips are made (stored ones are resolved at load, lib/paneFile migrateToolChips); kept for the tray until it stops showing chips. */
export function restoreChip(ref: PaneRef): void {
  const from = boxOf(chipElement(chipKey(ref)));
  const title = paneTitle(ref);
  if (ref.area === "work") lastArea = "work";
  restoreNow(ref, Date.now());
  useDesktop.setState({ snapshot: null, focus: null });
  flyFromChip(from, () => paneElements(ref), title);
}

/** What closing a chip would end (`closeConfirm` lines; empty = nothing). @deprecated #7: no new tool chips are made (stored ones are resolved at load, lib/paneFile migrateToolChips); kept for the tray until it stops showing chips. */
export function chipCloseWarnings(ref: PaneRef): string[] {
  if (ref.area === "work") return [];
  const chip = findChip(useSide.getState().layout, ref.id);
  return chip ? closeWarnings(chip.card.tabs) : [];
}

/** A chip's × (confirmed in place by the caller when `chipCloseWarnings` is non-empty). @deprecated #7: no new tool chips are made (stored ones are resolved at load, lib/paneFile migrateToolChips); kept for the tray until it stops showing chips. */
export function closeChipPane(ref: PaneRef): void {
  if (ref.area === "work") {
    setPaneLayout((l) => closeWorkChip(l, ref.id));
    return;
  }
  const chip = findChip(useSide.getState().layout, ref.id);
  if (chip) void closeSideInstances(chip.card.tabs);
}

// ── Maximise ────────────────────────────────────────────────────────────────────────────────────

/** A pane is maximised (a conversation pane, or a tool pane / column in the tool area's maximised or full-screen mode). */
export const anyMaximized = paneMaximised;

/** Ends a maximised pane (Esc). Returns whether there was one. */
export const restoreMaximized = restorePaneMaximised;

/** The 最大化 target of a pane: a conversation pane, or a Shelf pane (its Shelf grows, it fills its page). */
export function growTargetOf(ref: PaneRef): GrowTarget | null {
  if (ref.area === "work") return { kind: "conv", paneId: ref.id };
  const at = findCard(useSide.getState().layout, ref.id);
  return at?.page.shelf ? { kind: "shelf", conv: liveConversation(), shelfId: at.page.shelf, card: ref.id } : null;
}

/** Whether 最大化 can do anything for the pane now (else its button is greyed: no gap in the row). */
export const canMaximize = (ref: PaneRef): boolean => {
  const t = growTargetOf(ref);
  return !!t && canGrow(t);
};

/**
 * ⤢ / 放大, a double-click on a header, Ctrl+Shift+M: 最大化 (rule 2, owner 2026-10-21, lib/panelGrow) — the pane takes
 * every gap of the row, the others keep their width — or back. In full screen: back to normal.
 */
export function toggleMaximize(ref: PaneRef | null = focusedPaneRef()): void {
  if (!ref) return;
  if (fullscreenOn()) {
    restorePanels();
    return;
  }
  // Portrait (lib/portrait, P2): a stack has no gaps to grow into — 最大化 fills it (§24.16 maximised: a Shelf pane by its
  // mode, a conversation by the layout's max; two workspaces are not folded for it), and again = back.
  if (portraitOn(currentWindow())) {
    if (ref.area === "tools") return toggleExclusive(ref);
    endGrow();
    if (useSide.getState().mode) setMode(null);
    lastArea = "work";
    setPaneLayout((l) => {
      const next = toggleMaximized(l, ref.id);
      return next.max ? focusPane(next, ref.id, Date.now()) : next;
    });
    return;
  }
  const t = growTargetOf(ref);
  if (!t) return;
  if (ref.area === "work") lastArea = "work";
  else {
    lastArea = "tools";
    setFocusedCard(ref.id);
  }
  toggleGrow(t);
}

/** ⋯ → 独占 (the former 「放大」, §24.16): the pane takes the whole row, every other panel drawn as its rail / strip; again = back. */
export function toggleExclusive(ref: PaneRef | null = focusedPaneRef()): void {
  if (!ref) return;
  endGrow();
  // In full screen (§24.16) 放大 / ⤢ / Ctrl+Shift+M mean 「back to normal」.
  if (fullscreenOn()) {
    restorePanels();
    return;
  }
  if (ref.area === "work") {
    if (useSide.getState().mode) setMode(null);
    lastArea = "work";
    // Portrait (P2): a conversation maximised there (the layout's max, toggleMaximize) comes back as it was — nothing folds.
    if (usePanes.getState().layout.max && portraitOn(currentWindow())) {
      setPaneLayout(clearMaximized);
      return;
    }
    // Two workspaces (docs/design/002): 独占 = the others fold to their strips; again = they come back.
    const panes = conversationPanes(usePanes.getState().layout);
    if (panes.length >= 2 && panes.includes(ref.id)) {
      if (usePanes.getState().layout.max) setPaneLayout(clearMaximized);
      const strips = stripPanes(usePanes.getState().layout, useStrips.getState().strips);
      if (strips.length && !strips.includes(ref.id)) for (const id of strips) expandStrip(id);
      else soloWorkspace(ref.id);
      focusConversationPane(ref.id);
      return;
    }
    setPaneLayout((l) => {
      const next = toggleMaximized(l, ref.id);
      return next.max ? focusPane(next, ref.id, Date.now()) : next;
    });
    return;
  }
  if (usePanes.getState().layout.max) setPaneLayout(clearMaximized);
  lastArea = "tools";
  setFocusedCard(ref.id);
  toggleMode("maximised", ref.id);
}

/** F11 / Ctrl/⌘+Shift+F / 「全屏」 (§24.16): the panel (default: the focused one) in full screen, or back to the state before. */
export function toggleFullscreenPanel(ref: PaneRef | null = focusedPaneRef()): boolean {
  if (fullscreenOn()) return exitFullscreen();
  if (!ref) return false;
  if (ref.area === "work") lastArea = "work";
  else {
    lastArea = "tools";
    setFocusedCard(ref.id);
  }
  return enterFullscreen(ref.area === "work" ? { area: "work", id: ref.id } : { area: "tools", card: ref.id });
}

// ── 显示桌面 ─────────────────────────────────────────────────────────────────────────────────────

interface DesktopState {
  /** The panes 显示桌面 put away, in screen order (null: no 显示桌面 to undo). */
  snapshot: PaneRef[] | null;
  /** The focused conversation pane then. */
  focus: string | null;
  /**
   * §24.13 (no conversation chips): the work area before 显示桌面 (its conversation panes are not in the tray;
   * the work area shows none until it comes back). Null: no conversation pane was put away.
   */
  work?: PaneLayout | null;
  /** #7: the Shelves 显示桌面 collapsed to their rails (their tool panes stay in them; no chips), expanded again after. */
  shelves?: string[] | null;
}

/** Per app window (multi-window P3, lib/windowScope). */
export const useDesktop = windowStore(() => create<DesktopState>(() => ({ snapshot: null, focus: null, work: null, shelves: null })));

/** The panes on screen, in screen order: conversation columns left → right (not an empty one), then the tool columns' panes top → bottom. */
export function panesOnScreen(): PaneRef[] {
  const work = usePanes.getState().layout;
  const out: PaneRef[] = conversationPanes(work)
    .filter((id) => !isEmptyPane(work, id))
    .map((id) => ({ area: "work", id }));
  const { layout, mode } = useSide.getState();
  if (!layout.open) return out;
  let ctx: ReturnType<typeof sideViewNow>;
  try {
    ctx = sideViewNow();
  } catch {
    return out;
  }
  for (const { page, only } of columnsOnScreen(layout, ctx, mode)) {
    for (const card of shownCards(layout, page, ctx)) if (!only || card.id === only) out.push({ area: "tools", id: card.id });
  }
  return out;
}

/**
 * The title bar's 「显示桌面」 / Ctrl+Shift+D: the conversations leave the screen, the Shelves on screen collapse
 * to their rails (#7: no tool pane goes to the tray); again with nothing on screen: the layout before (else the
 * newest chip still in the tray).
 */
export function showDesktop(): void {
  // The desktop showing (显示桌面 on): this press puts the layout back — the Shelves are not drawn meanwhile, but
  // their panes are still in the live layout, so panesOnScreen would see them and put the desktop up again.
  const shown = desktopShownNow() ? [] : panesOnScreen();
  if (shown.length) {
    restoreMaximized();
    const before = usePanes.getState().layout;
    const focus = focusedConversation(before);
    const work = shown.some((r) => r.area === "work") ? before : null;
    // Owner 2026-10-22: 显示桌面 shows only the desktop (the sidebar card and the tray as they are) — no
    // conversation, strip, Shelf or Shelf Rail. The Shelves are not touched (no fold to their rails, which Rail 常驻
    // kept on screen): while the desktop shows they are simply not drawn (components/PaneHost `side`), so 恢复 is
    // exactly the layout before. The conversations leave the screen as a whole until 恢复.
    if (work) setPaneLayout(emptyWork);
    useDesktop.setState({ snapshot: shown, focus, work, shelves: null });
    return;
  }
  const work = usePanes.getState().layout;
  const side = useSide.getState().layout;
  const isChip = (ref: PaneRef) => (ref.area === "work" ? work.chips.includes(ref.id) : !!findChip(side, ref.id));
  const { snapshot: before, focus, work: workBefore, shelves } = useDesktop.getState();
  const snapshot = before?.filter(isChip) ?? [];
  const entries = trayEntries(work, side);
  const back = snapshot.length ? snapshot : entries.length && !workBefore && !shelves?.length ? [entries[entries.length - 1]!.ref] : [];
  useDesktop.setState({ snapshot: null, focus: null, work: null, shelves: null });
  // The conversations put away come back as they were (agents deleted meanwhile leave: paneStore dropGoneAgents).
  if (workBefore) setPaneLayout(() => workBefore);
  // The Shelves collapsed to their rails expand again (the ones still there).
  if (shelves?.length) updateLayout((l) => shelves.reduce((acc, id) => (findShelf(acc, id) ? expandShelf(acc, id) : acc), l));
  if (!back.length) return;
  const froms = back.map((ref) => ({ ref, from: boxOf(chipElement(chipKey(ref))), title: paneTitle(ref) }));
  const now = Date.now();
  back.forEach((ref, i) => restoreNow(ref, now + i, i === 0 || ref.area === "tools"));
  // The conversation focused before is the focused one again (else the first one back).
  const first = back.find((r) => r.area === "work" && r.id === focus) ?? back.find((r) => r.area === "work");
  if (first) setPaneLayout((l) => focusPane(l, first.id, now + back.length));
  lastArea = first ? "work" : "tools";
  for (const f of froms) flyFromChip(f.from, () => paneElements(f.ref), f.title);
}

/**
 * v1.18 (§25): show the desktop and keep it — a sidebar entry's click. Panes on screen go to the tray
 * (= 显示桌面); with nothing on screen the desktop is marked as asked for (so it shows even when it would not
 * show by itself), never toggled back.
 */
export function revealDesktop(): void {
  // The desktop already shows: the same entry puts the layout back (as the title-bar button / Ctrl+Shift+D; window audit #9).
  if (desktopShownNow()) {
    if (desktopRestorable()) showDesktop();
    return;
  }
  if (panesOnScreen().length) {
    showDesktop();
    return;
  }
  const { snapshot, focus } = useDesktop.getState();
  if (!snapshot) useDesktop.setState({ snapshot: [], focus });
}

/** The title bar's button: pressed while the desktop shows (nothing on screen, the panes in the tray). */
/** 显示桌面 is on now: a snapshot and no conversation on screen (useDesktopShown's test, not live). */
function desktopShownNow(): boolean {
  const work = usePanes.getState().layout;
  return !!useDesktop.getState().snapshot && conversationPanes(work).every((id) => isEmptyPane(work, id));
}

/** Something to put back: the conversations / Shelves / panes 显示桌面 put away (not a bare 「stay on the desktop」 mark). */
function restorableOf(d: Pick<DesktopState, "snapshot" | "work" | "shelves">): boolean {
  return !!d.snapshot?.length || !!d.work || !!d.shelves?.length;
}
const desktopRestorable = (): boolean => restorableOf(useDesktop.getState());

/** The desktop shows and there is a layout to put back (the sidebar 桌面 entry's tooltip says 恢复). */
export function useDesktopRestorable(): boolean {
  const d = useDesktop();
  const work = usePanes((s) => s.layout);
  return restorableOf(d) && conversationPanes(work).every((id) => isEmptyPane(work, id));
}

export function useDesktopShown(): boolean {
  const snapshot = useDesktop((s) => s.snapshot);
  const work = usePanes((s) => s.layout);
  return !!snapshot && conversationPanes(work).every((id) => isEmptyPane(work, id));
}

// ── Keys ────────────────────────────────────────────────────────────────────────────────────────

/** Runs a pane key; false = it does nothing here (the key goes on). */
function runKey(action: PaneKeyAction): boolean {
  switch (action) {
    case "closeTab":
      return closeFocusedTab();
    case "newTab":
      return newTabInFocused();
    case "maximize":
      toggleMaximize();
      return true;
    case "desktop":
      showDesktop();
      return true;
    case "fullscreen":
      toggleFullscreenPanel();
      return true;
    default:
      return focusPaneToward(action === "focusLeft" ? "left" : action === "focusRight" ? "right" : action === "focusUp" ? "up" : "down");
  }
}

/**
 * Ctrl+W: the focused tool pane's tab (confirmed when closing it would end something); a conversation pane: its page, else the
 * pane — the last one too, exactly as its header × (closes to the desktop, the agent keeps running; window audit 2026-10-23 #3).
 * It never closes the OS window.
 */
export function closeFocusedTab(): boolean {
  const ref = focusedPaneRef();
  if (!ref) return false;
  if (ref.area === "work") {
    if (panePage(usePanes.getState().layout, ref.id)) {
      closePanePage(ref.id);
      return true;
    }
    const layout = usePanes.getState().layout;
    if (conversationPanes(layout).length > 1) {
      closeConversationPane(ref.id);
      return true;
    }
    if (isEmptyPane(layout, ref.id)) return false;
    closePaneWithHint(ref.id);
    return true;
  }
  const { layout } = useSide.getState();
  const at = findCard(layout, ref.id);
  const id = at ? shownTab(layout, at.card, sideViewNow()) : null;
  if (!id) return false;
  const lines = closeWarnings([id]);
  if (!lines.length) closeTab(id);
  else void confirmDialog(translate("pane.closeTabConfirm", { what: joinWarnings(lines) }), true).then((ok) => ok && closeTab(id));
  return true;
}

/** Ctrl+T: the launcher menu at the focused pane; a pick opens there (a tool pane: as its tab; a conversation pane: by the placement rules). */
export function newTabInFocused(): boolean {
  const ref = focusedPaneRef();
  const items = launchable();
  if (!ref) return false;
  const into = ref.area === "tools" ? ref.id : null;
  const entries: MenuEntry[] = [
    { label: translate("pane.newTabMenu"), onSelect: () => {}, disabled: true },
    ...items.map((i) => ({
      label: i.label,
      icon: i.icon,
      onSelect: () => {
        const page = into ? findCard(useSide.getState().layout, into)?.page.id : undefined;
        const opened = openSide(i.kind, i.params, { ...(page ? { page } : {}), focus: true, reveal: true });
        if (into && opened.status === "opened" && "instanceId" in opened && opened.instanceId) {
          const instanceId = opened.instanceId;
          // A new tab of the focused pane — unless its Shelf does not allow mixing and it is another kind (§24.12): then where it was placed.
          const now = useSide.getState().layout;
          if (locate(now, instanceId)?.card.id !== into && canJoin(now, into, [i.kind], [])) updateLayout((l) => joinInto(l, { instance: instanceId }, into, Date.now()));
        }
      },
    })),
  ];
  const head = into ? queryAppWindows<HTMLElement>(`[data-side-card-head="${CSS.escape(into)}"]`) : conversationElement(ref.id)?.querySelector<HTMLElement>("[data-pane-header]");
  if (head) openMenuFrom(head, entries);
  else {
    const box = boxOf(conversationElement(ref.id)) ?? { left: 40, top: 40, width: 0, height: 0 };
    openMenuAt(box.left + 16, box.top + 12, entries);
  }
  return true;
}

/** Ctrl+Alt+arrows: the focus goes to the pane next to the focused one in that direction (its input, else its first control). */
export function focusPaneToward(dir: "left" | "right" | "up" | "down"): boolean {
  const boxes: { id: string; left: number; top: number; width: number; height: number }[] = [];
  const work = usePanes.getState().layout;
  for (const id of conversationPanes(work)) {
    const b = boxOf(conversationElement(id));
    if (b) boxes.push({ id: chipKey({ area: "work", id }), ...b });
  }
  for (const el of queryAllAppWindows<HTMLElement>("[data-side-card]")) {
    const b = boxOf(el);
    if (b && el.dataset.sideCard) boxes.push({ id: chipKey({ area: "tools", id: el.dataset.sideCard }), ...b });
  }
  const from = focusedPaneRef();
  const next = refOfKey(paneInDirection(boxes, from ? chipKey(from) : null, dir) ?? "");
  if (!next || (from && chipKey(from) === chipKey(next))) return false;
  if (next.area === "work") {
    lastArea = "work";
    focusConversationPane(next.id);
    // After the pane re-renders as the focused one: its input, else the pane.
    const focusIn = () => {
      const el = conversationElement(next.id);
      (el?.querySelector<HTMLElement>("textarea:not([disabled])") ?? el)?.focus();
    };
    const view = ownerWindowOf(conversationElement(next.id));
    if (typeof view.requestAnimationFrame === "function") view.requestAnimationFrame(() => view.requestAnimationFrame(focusIn));
    else focusIn();
    return true;
  }
  lastArea = "tools";
  setFocusedCard(next.id);
  flashCard(next.id);
  const target =
    queryAppWindows<HTMLElement>(`[data-side-card-of="${CSS.escape(next.id)}"] :is(textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]))`) ??
    queryAppWindows<HTMLElement>(`[data-side-card-head="${CSS.escape(next.id)}"] button`);
  target?.focus();
  return true;
}

// ── Start ───────────────────────────────────────────────────────────────────────────────────────

let started = false;

/** Mounted once by App: notes which area is used, keeps the tray within MAX_CHIPS whenever chips are added. */
export function startPaneActions(): () => void {
  if (started) return () => {};
  started = true;
  const offFull = startPanelFull();
  const offGrow = startPanelGrow();
  const onPointer = (e: Event) => noteFocus(e.target);
  // Every app window (a desk window's panes too, multi-window).
  const offPointer = onEveryAppWindow((win) => {
    win.addEventListener("pointerdown", onPointer, true);
    win.addEventListener("focusin", onPointer, true);
    return () => {
      win.removeEventListener("pointerdown", onPointer, true);
      win.removeEventListener("focusin", onPointer, true);
    };
  });
  const count = () => usePanes.getState().layout.chips.length + (useSide.getState().layout.chips?.length ?? 0);
  let chips = count();
  const check = () => {
    const n = count();
    if (n > chips && n > MAX_CHIPS) queueMicrotask(trimChips);
    chips = n;
  };
  const offPanes = usePanes.subscribe((s) => {
    check();
    // The focus went to another pane (a click on an agent shown in a hidden column, a key): the maximised one is restored.
    if (s.layout.max && s.layout.focus && s.layout.focus !== s.layout.max) setPaneLayout(clearMaximized);
    // A desktop asked for with nothing to put back (revealDesktop) ends once a conversation opens.
    const desk = useDesktop.getState().snapshot;
    if (desk && desk.length === 0 && conversationPanes(s.layout).some((id) => !isEmptyPane(s.layout, id))) useDesktop.setState({ snapshot: null, focus: null });
  });
  const offSide = useSide.subscribe(check);
  return () => {
    started = false;
    offPointer();
    offPanes();
    offSide();
    offFull();
    offGrow();
  };
}

/** The tool chips' last use (their tabs'), for callers that order them (tests, the tray). */
export const chipLastUsed = (side: SideLayout, chip: SideChip): number => cardLastUsed(side, chip.card);

/** A tool chip's registry entry (its shown tab's kind, else its home kind). @deprecated #7: no new tool chips are made (stored ones are resolved at load, lib/paneFile migrateToolChips); kept for the tray until it stops showing chips. */
export function chipEntry(side: SideLayout, chip: SideChip) {
  const registry = sideRegistry();
  const kind = (chip.card.active && side.instances[chip.card.active]?.kind) || chip.card.kind;
  return registry.get(kind) ?? registry.get(chip.card.kind);
}
