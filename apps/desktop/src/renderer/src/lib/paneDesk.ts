// The desktop layer (docs/desktop-modules.md §25, contract 1.18 `pane.desktop`; research panes-20261019.md
// §5; canvas principles §7, contract 1.20; §25.4): the window's bottom layer. The first shown `pane.desktop`
// item is the background of the whole window behind every card (components/ChipTray DesktopBackground,
// reason "covered", always drawn); its content shows over the work area (DesktopStage) when no pane is in
// front of it — no conversation (none opened, every pane in the tray) or 「显示桌面」; otherwise the content
// is "covered" (not drawn, its box inert). Nothing floating over it (编辑主页, the tray) changes its box
// (lib/trayModel deskGeometry). Pure rules
// (`desktopReason`, `desktopMounted`; test/homeDesktop.test.ts, test/tray.test.ts) + the hook. Shell file:
// names no feature.
import { useSlot } from "../modules/react";
import type { AppSlotEntry, PaneDesktopProps } from "../modules/slots";
import { useDesktopShown } from "./paneActions";

export interface DesktopInput {
  /** A full-window page (设置) is open. */
  fullWindow: boolean;
  /** Conversation columns with headers (two conversations, or one next to tool panes). */
  framed: boolean;
  /** The single conversation pane's agent (null: empty). */
  sessionId: string | null;
  /** A page shows in the work area. */
  page: boolean;
  /** The first-run guide applies (no host / no agent yet / cutex not installed). */
  firstRun: boolean;
  /** 「显示桌面」 put the panes away (or the owner asked for the desktop). */
  desktopShown: boolean;
  /** The layer's own setting: shown when nothing is open. */
  showWhenEmpty: boolean;
  /** A `pane.desktop` item is available. */
  hasLayer: boolean;
}

/** Why the desktop layer shows now (null: it does not — today's empty state or the panes). */
export function desktopReason(i: DesktopInput): Exclude<PaneDesktopProps["reason"], "covered"> | null {
  if (!i.hasLayer || i.fullWindow || i.framed || i.sessionId || i.page || i.firstRun) return null;
  if (i.desktopShown) return "desktop";
  return i.showWhenEmpty ? "empty" : null;
}

/** Whether the content box is mounted over the work area: not on a full-window page nor the first-run guide (the window background always is). */
export function desktopMounted(i: Pick<DesktopInput, "hasLayer" | "fullWindow" | "firstRun">): boolean {
  return i.hasLayer && !i.fullWindow && !i.firstRun;
}

/** The first shown `pane.desktop` item (null: none). */
export function useDesktopLayer(): AppSlotEntry<"pane.desktop"> | null {
  return useSlot("pane.desktop").find((e) => e.mode === "show") ?? null;
}

export { useDesktopShown };
