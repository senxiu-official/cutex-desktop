import { isImeComposing } from "./ime";
// The Esc chain's layer rows (docs/desktop-modules.md §19.10, lib/escChain.ts rows 3–5), run by the
// App-level key listener (lib/useSideShortcuts.ts): restore a maximised / full-screen pane (a
// conversation pane or the tool area's, §24 step 4: maximise first), else close the reference card,
// else close the narrow-window drawer, else (focus in an expanded Shelf) collapse that Shelf to its rail, else (a page
// over the focused conversation column, 占用会话) close that page. The rows before them (popups,
// handlers that used the key) and after them (the conversation's own Esc) are decided here too, so
// one key press does one thing.
import { escChainStep, type EscChainStep } from "./escChain";
import { inSideRoot, isEditableTarget } from "./escInterrupt";
import { getUiPrefs } from "./prefs";
import { closePeek, peekOpen } from "./peekStore";
import { collapseShelf, findCard, findShelf, setOpen, shelfOfPage } from "./sideLayout";
import { paneMaximised, restorePaneMaximised, updateLayout, useSide } from "./sideLayoutStore";
import { closeSettingsShelf, inSettingsShelf, settingsShelfCovers } from "./settingsShelf";
import { useApp } from "../store";
import { isElement, ownerDocumentOf } from "./ownerWindow";

/** The expanded Shelf holding the element (its rail, its page, or an instance drawn over one of its panes); null: none. */
export function shelfOfTarget(target: EventTarget | null): string | null {
  if (!isElement(target)) return null;
  const { layout } = useSide.getState();
  const own = target.closest<HTMLElement>("[data-shelf]")?.dataset.shelf;
  const card = own ? null : target.closest<HTMLElement>("[data-side-card-of]")?.dataset.sideCardOf;
  const at = card ? findCard(layout, card) : null;
  const shelf = own ? findShelf(layout, own) : at ? shelfOfPage(layout, at.page.id) : null;
  return shelf && !shelf.collapsed ? shelf.id : null;
}

/** One Esc key press; `overlay` = a popup was open when it started (capture-phase snapshot). Returns the row taken. */
export function runEscChain(e: KeyboardEvent, overlay: boolean): EscChainStep {
  const s = useSide.getState();
  const active = typeof document === "undefined" ? null : ownerDocumentOf(e.target).activeElement;
  const shelf = shelfOfTarget(e.target) ?? shelfOfTarget(active);
  const step = escChainStep({
    modifiers: e.ctrlKey || e.altKey || e.metaKey || e.shiftKey,
    repeat: e.repeat,
    composing: isImeComposing(e),
    overlay,
    handled: e.defaultPrevented,
    peek: peekOpen(),
    mode: paneMaximised(),
    drawer: s.narrow && s.layout.open && getUiPrefs().sideNarrow === "overlay",
    editable: isEditableTarget(e.target) || isEditableTarget(active),
    inSide: inSideRoot(e.target) || inSideRoot(active),
    shelf: !!shelf,
    editing: !!useApp.getState().customize,
    settings: settingsShelfCovers() || inSettingsShelf(e.target) || inSettingsShelf(active),
    page: useApp.getState().view.kind === "page",
  });
  if (step === "close-peek") {
    e.preventDefault();
    closePeek();
  } else if (step === "restore") {
    e.preventDefault();
    restorePaneMaximised();
  } else if (step === "close-drawer") {
    e.preventDefault();
    updateLayout((l) => setOpen(l, false));
  } else if (step === "collapse-shelf" && shelf) {
    e.preventDefault();
    updateLayout((l) => collapseShelf(l, shelf));
  } else if (step === "finish-edit") {
    e.preventDefault();
    useApp.getState().closeCustomize();
  } else if (step === "close-settings") {
    e.preventDefault();
    closeSettingsShelf();
  } else if (step === "close-page") {
    // 占用会话: the page over the focused column closes (components/PageHeader ×).
    e.preventDefault();
    useApp.getState().closePage();
  }
  return step;
}
