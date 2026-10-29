// The panes' minimum size (docs/desktop-modules.md §24.5, step 4): a pane kind's `minSize` (default
// 280 × 120; a conversation beside another one: CONVERSATION_MIN_W). A tool column that would not fit the
// work area at that width is not made — an open or a drop adds a tab instead (lib/sideLayout place
// `roomForColumn`, lib/sideDrop), and the tool area becomes the drawer before two conversations and two
// tool columns crowd each other (components/side/SideArea). The work area reports what it shows
// (`setPaneRoom`); this module has no store of its own. Shell code: names no feature.
import { CONVERSATION_MIN_W, DEFAULT_MIN_SIZE } from "./paneLayout";
import { frameMins } from "./sideLayout";
import { currentWindow, type WindowKey } from "./windowScope";

interface Room {
  /** The work area's width (px; Infinity before the first measure). */
  width: number;
  /** Conversation columns on screen. */
  conversations: number;
  /** Tool columns on screen (0: the tool area is hidden). */
  tools: number;
}

const UNMEASURED: Room = { width: Number.POSITIVE_INFINITY, conversations: 1, tools: 0 };
/** Each app window's work area (multi-window P3): read and written in the current window (lib/windowScope). */
const rooms = new Map<WindowKey, Room>();

/** What the work area shows now (components/side/SideArea measures it, in its window). */
export function setPaneRoom(next: Room): void {
  rooms.set(currentWindow(), { ...next, width: next.width > 0 ? next.width : Number.POSITIVE_INFINITY });
}

const roomNow = (): Room => rooms.get(currentWindow()) ?? UNMEASURED;

/** `conversations` conversation columns and `tools` tool columns fit `width` px at their minimum widths. */
export function columnsFit(width: number, conversations: number, tools: number): boolean {
  const mins = frameMins(conversations, tools, CONVERSATION_MIN_W, DEFAULT_MIN_SIZE.w);
  return width >= (conversations ? mins.conversation : 0) + (tools ? mins.side : 0);
}

/**
 * The work area fits one more column at the minimum widths: a tool column next to the conversations and
 * tool columns on screen (else a tab instead), or a conversation column next to the conversations (the
 * tool area gives way as the drawer; else the conversation takes the focused pane's place).
 */
export function roomForColumn(kind: "tool" | "conversation" = "tool"): boolean {
  const room = roomNow();
  if (!Number.isFinite(room.width)) return true;
  return kind === "tool" ? columnsFit(room.width, room.conversations, room.tools + 1) : columnsFit(room.width, room.conversations + 1, 0);
}

/** `n` conversation columns fit the work area at their minimum widths (the tool area gives way as the drawer). */
export function roomForColumns(n: number): boolean {
  const room = roomNow();
  return !Number.isFinite(room.width) || columnsFit(room.width, n, 0);
}
