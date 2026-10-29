// The pane keys (docs/desktop-modules.md §24 step 4), routed by lib/useSideShortcuts: the commands of
// lib/keybindings — paneCloseTab (Ctrl / ⌘ + W), paneNewTab (+ T), paneMaximise (+ Shift+M), panelFullscreen
// (F11, + Shift+F, Shift+F11; §24.16), paneDesktop (+ Shift+D), paneFocus* (+ Alt+arrows) by default.
// Pure routing; lib/paneActions installs what runs them (so the shortcut hook stays light). Shell code:
// names no feature.
import { commandOf, type CommandId, type KeyLike } from "./keybindings";

export type PaneKeyAction = "closeTab" | "newTab" | "maximize" | "fullscreen" | "desktop" | "focusLeft" | "focusRight" | "focusUp" | "focusDown";

const ACTIONS = {
  panelFullscreen: "fullscreen",
  paneCloseTab: "closeTab",
  paneNewTab: "newTab",
  paneMaximise: "maximize",
  paneDesktop: "desktop",
  paneFocusLeft: "focusLeft",
  paneFocusRight: "focusRight",
  paneFocusUp: "focusUp",
  paneFocusDown: "focusDown",
} as const satisfies Partial<Record<CommandId, PaneKeyAction>>;
const IDS = Object.keys(ACTIONS) as (keyof typeof ACTIONS)[];

/** The pane key of a key press, or null. */
export function paneKeyAction(e: KeyLike): PaneKeyAction | null {
  const id = commandOf(e, IDS);
  return id ? ACTIONS[id] : null;
}

let runner: (action: PaneKeyAction) => boolean = () => false;

/** lib/paneActions: what runs a pane key (false = it does nothing here, the key goes on). */
export function setPaneKeyRunner(run: (action: PaneKeyAction) => boolean): void {
  runner = run;
}

export function runPaneKey(action: PaneKeyAction): boolean {
  return runner(action);
}
