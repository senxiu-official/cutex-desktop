// Ctrl/⌘ + click on an agent while every column is taken (design 039): the columns light up as click targets (the
// look of a drop preview) and the owner clicks the one the agent replaces; Esc cancels. State only — components/
// ColumnPickLayer draws it. Shell code: names no feature.
import { create } from "zustand";
import { currentWindow, inWindow, MAIN_WINDOW, type WindowKey } from "./windowScope";
import { replaceWith } from "./workspaces";

export interface ColumnPick {
  hostId: string;
  key: string;
  /** The window whose columns are offered (multi-window P3.5: the one the Ctrl/⌘ + click was in). */
  win?: WindowKey;
}

export const useColumnPick = create<{ pick: ColumnPick | null }>(() => ({ pick: null }));

export function startColumnPick(pick: ColumnPick): void {
  useColumnPick.setState({ pick: { ...pick, win: pick.win ?? currentWindow() } });
}

export function cancelColumnPick(): void {
  if (useColumnPick.getState().pick) useColumnPick.setState({ pick: null });
}

/** The owner picked a column: it shows the agent (the column's agent stays in the tray as a workspace of its own). */
export function finishColumnPick(paneId: string): void {
  const { pick } = useColumnPick.getState();
  cancelColumnPick();
  if (pick) inWindow(pick.win ?? MAIN_WINDOW, () => replaceWith(pick.hostId, pick.key, paneId));
}
