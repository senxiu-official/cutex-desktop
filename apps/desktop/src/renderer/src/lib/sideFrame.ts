// Where the right side sits in the work area (docs/desktop-modules.md §18.3–§18.4; RFC §3.8, §3.8a).
// Pure: the work area's width + settings + layout state → the side box's kind, width, the width it
// takes from the conversation card. Tested. (The reading column centres in its own card: 让位 is gone, owner 2026-10-21.)
// Page buttons (2026-10-13): with the column open they are a row of tabs at the column's top (`strip`,
// inside the box, no width of its own); the vertical 44 px lane only exists while the column is closed.
// 右栏布局 = 竖条 + 标签页 (`pageBar: "lane"`, ★ owner 2026-10-14, the pre-2026-10-13 look): the lane also
// stays beside the open column, between it and the conversation, and takes the place of the 8 px seam:
// the open side is LANE_EXTRA wider, so the cards keep their width in both layouts; no tab row then —
// each card's header is the tab row.
import { foldHeld } from "./foldHysteresis";
import { CARD_GAP, DRAWER_MARGIN, isNarrow, LANE_WIDTH, MIN_SIDE, sideWidth, type FrameMins } from "./sideLayout";

export type SideFrameKind = "closed" | "flow" | "float" | "drawer" | "maximised" | "fullscreen";

export interface SideFrameInput {
  /** The work area (conversation card + right side) in px; 0 = not measured yet. */
  areaWidth: number;
  /** appearance.sidePaneWidth (the column, its 8 px seam to the conversation included). */
  stored: number;
  /** The column is open. */
  open: boolean;
  /** Pages with a page button (lanePages). */
  pages: number;
  laneWhenHidden: "keep" | "hide";
  /** 右栏布局: the vertical lane beside the open column too ("lane"), or the tab row at its top ("tabs"). */
  pageBar: "lane" | "tabs";
  /** Shelf 与会话: side by side (push) or over the conversation (float). */
  mode: "push" | "float";
  /** A maximised / full-screen page or card. */
  layered: "maximised" | "fullscreen" | null;
  /** The minimum widths of the conversations and the tool area (default: one column each; lib/sideLayout frameMins). */
  mins?: FrameMins;
  /** The last frame was narrow (a drawer): it stays one until the area has lib/foldHysteresis's slack more. */
  wasNarrow?: boolean;
}

export interface SideFrame {
  kind: SideFrameKind;
  narrow: boolean;
  /** The vertical page-button lane is shown: ≥ 2 pages and either the column closed with 保留页按钮, or open with 竖条 + 标签页. */
  lane: boolean;
  /** The page tab row at the column's top is shown: column open, ≥ 2 pages and 仅标签页. */
  strip: boolean;
  /** The side box's width (seam included; the closed lane's width); fill for maximised / full screen. */
  width: number;
  /** Width taken from the conversation card's row (a spacer when the box itself is out of flow). */
  inFlow: number;
}

/** What the open lane adds to the stored width (it replaces the 8 px seam, the cards keep their width). */
export const LANE_EXTRA = LANE_WIDTH - CARD_GAP;

/** 悬浮: the box never covers more than this much less than the work area. */
export const FLOAT_KEEP = 160;

export function sideFrame(input: SideFrameInput): SideFrame {
  const narrow = input.areaWidth > 0 && foldHeld((slack) => isNarrow(input.areaWidth - slack, input.mins), !!input.wasNarrow);
  const pagesShown = input.pages >= 2;
  const closedLane = pagesShown && input.laneWhenHidden === "keep";
  // What the closed side takes from the row: an open side that is out of the row (悬浮, drawer, a
  // narrow maximised / full-screen side) keeps that much reserved, so opening never reflows the conversation.
  const closedWidth = closedLane ? LANE_WIDTH : 0;
  if (!input.open) return { kind: "closed", narrow, lane: closedLane, strip: false, width: closedWidth, inFlow: closedWidth };
  const room = input.areaWidth > 0 ? input.areaWidth : input.stored + 1000;
  const openLane = pagesShown && input.pageBar !== "tabs";
  const open = { narrow, lane: openLane, strip: pagesShown && !openLane };
  // The open lane comes on top of the stored width, so switching 右栏布局 keeps the cards' width.
  const stored = input.stored + (openLane ? LANE_EXTRA : 0);
  if (input.layered) {
    // The conversation keeps its open-column width underneath (no reflow; it stays mounted).
    const under = narrow || input.mode === "float" ? closedWidth : sideWidth(stored, room, false, input.mins);
    return { kind: input.layered, ...open, width: room, inFlow: under };
  }
  if (narrow) {
    return { kind: "drawer", ...open, width: sideWidth(stored, room, true, input.mins), inFlow: closedWidth };
  }
  if (input.mode === "float") {
    const width = Math.round(Math.max(Math.min(MIN_SIDE, room - DRAWER_MARGIN), Math.min(stored, room - FLOAT_KEEP)));
    return { kind: "float", ...open, width, inFlow: closedWidth };
  }
  const width = sideWidth(stored, room, false, input.mins);
  return { kind: "flow", ...open, width, inFlow: width };
}

/**
 * The next frame's `wasNarrow` (pure; tested). Only an open right Shelf holds the drawer's slack: a closed / collapsed
 * one is measured with its rail's room, not the Shelf's — held, it made the next opening a drawer or an inline Shelf
 * depending on history and on whether the window had been reloaded (shelf-width-stable 2026-10-27).
 */
export const drawerHeld = (frame: Pick<SideFrame, "kind" | "narrow">): boolean => frame.kind !== "closed" && frame.narrow;
