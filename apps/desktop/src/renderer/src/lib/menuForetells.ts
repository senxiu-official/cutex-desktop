// 动作预告 for menu rows (docs/design/008; lib/contextMenu MenuAction.foretell): the layout-changing rows of the
// conversation header's ⋯, a Shelf's ⋯, a tool pane's 「—」 and the tray's right-click say what they will do,
// on the area they affect, while hovered or highlighted with the arrows. Each foretell describes exactly the
// action its row's onSelect runs (the row builds both from the same inputs). Shell code: names no feature.
import { translate } from "../i18n";
import { conversationPanes } from "./paneLayout";
import { usePanes } from "./paneStore";
import { canStrip, stripPanes, useStrips } from "./convStrips";
import type { Foretell, ForetellMark } from "./foretell";
import { cardArea, paneArea, shelfSideArea } from "./foretellAreas";

const t = translate;

const shelfBox = shelfSideArea;
const cardBox = cardArea;

// ── The conversation header's ⋯ ─────────────────────────────────────────────────────────────────

/** 全屏 / 退出全屏 of a conversation column. */
export function fullscreenForetell(paneId: string, on: boolean): Foretell {
  return on ? { tone: "open", text: t("foretell.fullscreenOff"), marks: [{ selector: "[data-side-work]" }] } : { tone: "open", text: t("foretell.fullscreen"), marks: [{ selector: paneArea(paneId) }] };
}

/**
 * 独占 / 取消独占 (lib/paneActions toggleExclusive): two workspaces = the other folds to its strip, or the strips
 * come back; one = the whole row, the other panels drawn as their rails.
 */
export function exclusiveForetell(paneId: string, maxed: boolean): Foretell {
  const layout = usePanes.getState().layout;
  const panes = conversationPanes(layout);
  if (panes.length >= 2 && panes.includes(paneId)) {
    const strips = stripPanes(layout, useStrips.getState().strips);
    if (strips.length && !strips.includes(paneId)) return { tone: "open", text: t("foretell.exclusiveBack"), marks: strips.map((id) => ({ selector: paneArea(id) })) };
    const others = panes.filter((id) => id !== paneId && canStrip(layout, id));
    return { tone: "fold", text: t("foretell.solo"), marks: others.map((id) => ({ selector: paneArea(id) })) };
  }
  return maxed ? { tone: "open", text: t("foretell.restore"), marks: [{ selector: "[data-side-work]" }] } : { tone: "open", text: t("foretell.exclusiveOne"), marks: [{ selector: paneArea(paneId) }] };
}

/** 移到左边 / 右边: the two workspaces change places. */
export function moveForetell(paneId: string, to: "left" | "right"): Foretell {
  const other = conversationPanes(usePanes.getState().layout).find((id) => id !== paneId);
  const marks: ForetellMark[] = [{ selector: paneArea(paneId), text: t(to === "left" ? "foretell.moveLeft" : "foretell.moveRight") }];
  if (other) marks.push({ selector: paneArea(other), text: t(to === "left" ? "foretell.moveRight" : "foretell.moveLeft") });
  return { tone: "open", text: t(to === "left" ? "foretell.moveLeft" : "foretell.moveRight"), marks };
}

// ── A Shelf's ⋯ ─────────────────────────────────────────────────────────────────────────────────

export function shelfCollapseForetell(side: "left" | "right", collapsed: boolean): Foretell {
  return collapsed ? { tone: "open", text: t("foretell.shelfExpand"), marks: [{ selector: shelfBox(side) }] } : { tone: "fold", text: t("foretell.shelfCollapse"), marks: [{ selector: shelfBox(side) }] };
}

export function shelfCloseForetell(side: "left" | "right", panes: number): Foretell {
  return { tone: "replace", text: t(panes ? "foretell.shelfCloseN" : "foretell.shelfClose", { n: panes }), marks: [{ selector: shelfBox(side) }] };
}

/** 最大化 / 独占 / 全屏 of a Shelf (or back). */
export function shelfGrowForetell(side: "left" | "right", kind: "grow" | "exclusive" | "fullscreen", on: boolean): Foretell {
  const key = on ? "foretell.restore" : kind === "grow" ? "foretell.maximize" : kind === "exclusive" ? "foretell.exclusiveOne" : "foretell.fullscreenShelf";
  return { tone: "open", text: t(key), marks: [{ selector: on ? "[data-side-work]" : shelfBox(side) }] };
}

/** 移到另一边: the Shelf moves to the other side of its conversation. */
export function shelfMoveForetell(side: "left" | "right"): Foretell {
  return { tone: "open", text: t(side === "left" ? "foretell.shelfToRight" : "foretell.shelfToLeft"), marks: [{ selector: shelfBox(side) }] };
}

// ── A tool pane's 「—」 ──────────────────────────────────────────────────────────────────────────

/** 移到另一页 ▸ a page (`page`: its label) or a new page. */
export function cardMoveForetell(cardId: string, page: string | null): Foretell {
  return { tone: "open", text: page ? t("foretell.cardToPage", { page }) : t("foretell.cardToNewPage"), marks: [{ selector: cardBox(cardId) }] };
}

export function cardCloseForetell(cardId: string): Foretell {
  return { tone: "replace", text: t("foretell.cardClose"), marks: [{ selector: cardBox(cardId) }] };
}

// ── The tray ────────────────────────────────────────────────────────────────────────────────────

/** 关闭 an open (off-screen) item: it leaves the tray. */
export function trayLeaveForetell(name: string): Foretell {
  return { tone: "fold", text: t("foretell.trayLeave", { name }), marks: [{ selector: "[data-pane-tray]" }] };
}
