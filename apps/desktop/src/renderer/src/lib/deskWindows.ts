// Desk windows ("second desk", multi-window P1; .claude/previews/multi-window/proposal.md): another app
// window, on another display, drawn by this renderer — one store, one feed per session, one outbox. Main
// admits the window only with a one-use ticket (main/deskWindows.ts); the window is an `about:blank` child
// of this document that inherits its CSP and gets its look mirrored (lib/deskDocument). React draws into it
// with a portal (components/DeskWindows), so the desk's content is this app's own tree.
//
// Behind the 多窗口 setting (Settings → 通用 → 窗口, default off): main-owned, mirrored by lib/multiWindowPref; main also
// refuses tickets while it is off.
import type { DeskBridge } from "../../../shared/ipc";
import { mirrorDocument } from "./deskDocument";
import { multiWindowOn } from "./multiWindowPref";

/** Multi-window is on for this device (main's 多窗口 setting, default off). */
export function desksEnabled(): boolean {
  return multiWindowOn();
}

export interface DeskHandle {
  deskId: string;
  win: Window;
  /** The React portal target in the desk document (`#root`, styled like the main window's). */
  root: HTMLElement;
  /** Stop mirroring the main document (the window closed). */
  dispose(): void;
}

/**
 * Open a desk window: a ticket from main, then window.open with its one-use name. `deskId` reopens a
 * remembered desk (its bounds come back). Null: refused (too many desks, no bridge, popup failed).
 */
export async function openDeskWindow(desk: DeskBridge | undefined, opener: Window = window, deskId?: string): Promise<DeskHandle | null> {
  if (!desk) return null;
  const ticket = await desk.ticket(deskId);
  if (!ticket) return null;
  const win = opener.open("about:blank", ticket.name);
  if (!win) return null;
  return prepareDeskDocument(ticket.deskId, win, opener.document);
}

/** Set up a fresh desk document: title, mirrored look, the portal root. */
export function prepareDeskDocument(deskId: string, win: Window, from: Document): DeskHandle {
  const doc = win.document;
  doc.title = from.title || "Cutex";
  const stop = mirrorDocument(from, doc);
  let root = doc.getElementById("root");
  if (!root) {
    root = doc.createElement("div");
    root.id = "root";
    doc.body.append(root);
  }
  return { deskId, win, root, dispose: stop };
}
