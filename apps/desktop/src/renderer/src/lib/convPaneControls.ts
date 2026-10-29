// The conversation header's pane controls (owner 2026-10-21; components/ConversationHeader): one row on the
// header's first line after the status items (right side variant A, .claude/preview-header.html `#a`) —
// 「Shelf」 (this conversation's Shelf: expand / fold it to its rail; empty: 「＋ 打开 Shelf」 = the launchers),
// 「放大」 (held: 全屏), 「关闭」 (the pane closes, the agent keeps running; the first time a toast says where to
// find it again) and 「⋯」 (全屏, move, what a narrow header folded, the agent's menu). Replaced the 2×2 block.
// Shell code: names no feature.
import { createElement } from "react";
import { Layers } from "lucide-react";
import { translate } from "../i18n";
import { useApp } from "../store";
import { convKey } from "./convShelves";
import { conversationPanes, moveConversation } from "./paneLayout";
import { focusConversationPane, setPaneLayout, usePanes } from "./paneStore";
import { sideViewNow } from "./sideComponents";
import { collapseShelf, columnsOnScreen, expandShelf, lanePages, setOpen, shelvesOf, type SideLayout, type SideViewContext } from "./sideLayout";
import { liveConversation, updateLayout, useSide } from "./sideLayoutStore";
import { closeWorkspace } from "./workspaces";
import type { MenuEntry } from "./contextMenu";
import { launch, launchable } from "./sideMenus";
import { newPage } from "./sideActions";
import { bindingLabel } from "./keybindings";

/** What the header's Shelf button shows for a conversation's Shelf. */
export type ConvShelfState = "empty" | "folded" | "expanded";

/**
 * The live (focused) conversation's Shelf: empty (no page for it — the launchers), expanded (a Shelf of it on
 * screen at its width) or folded (its rails only, or the tool area closed). Pure.
 */
export function liveShelfState(layout: SideLayout, ctx: SideViewContext): ConvShelfState {
  if (!lanePages(layout, ctx).length) return "empty";
  return layout.open && columnsOnScreen(layout, ctx, null).length > 0 ? "expanded" : "folded";
}

/** Another conversation's Shelf known only by its rail pages (not live on screen): folded, or empty. */
export const otherShelfState = (railPages: number): ConvShelfState => (railPages > 0 ? "folded" : "empty");

/** Every Shelf of the layout expanded (the tool area shown). */
export function expandAll(layout: SideLayout): SideLayout {
  const out = shelvesOf(layout).reduce((acc, x) => expandShelf(acc, x.id), layout);
  return out.open ? out : setOpen(out, true);
}

/** Every Shelf folded to its rail. */
export const foldAll = (layout: SideLayout): SideLayout => shelvesOf(layout).reduce((acc, x) => (x.collapsed ? acc : collapseShelf(acc, x.id)), layout);

/**
 * The Shelf button of a conversation with pages: expanded → its Shelves fold to their rails; folded → they
 * expand. Another workspace's: it gets the focus (its Shelf becomes the live one), then the same toggle (focus not yet moved: expands).
 */
export function toggleConvShelf(paneId: string, hostId: string, sessionId: string): void {
  // Another workspace's (live too, §24.13): it gets the focus, then the same toggle on its own Shelf.
  if (liveConversation() !== convKey(hostId, sessionId)) focusConversationPane(paneId);
  if (liveConversation() !== convKey(hostId, sessionId)) {
    updateLayout(expandAll);
    return;
  }
  const expanded = liveShelfState(useSide.getState().layout, sideViewNow()) === "expanded";
  updateLayout(expanded ? foldAll : expandAll);
}

/**
 * 「＋ 打开 Shelf」 of an empty Shelf (the header's Shelf button, the empty Shelf Rail of Shelf Rail 常驻): the
 * launchers under a note; the pick opens in this conversation's Shelf (`focus` first brings another workspace over).
 * Ends with 新建空页 like the launcher menu of a Shelf with pages: the first page can be an empty one too.
 */
export function shelfLauncherMenu(focus: (() => void) | null): MenuEntry[] {
  const items = launchable();
  return [
    { label: translate("convHeader.shelfLaunch"), note: true, disabled: true, onSelect: () => {} },
    ...(items.length
      ? items.map((i) => ({
          label: i.label,
          icon: i.icon,
          onSelect: () => {
            focus?.();
            launch(i.kind, i.params, null);
          },
        }))
      : [{ label: translate("side.launcher.none"), disabled: true, onSelect: () => {} }]),
    "separator",
    {
      label: translate("side.newPage"),
      icon: createElement(Layers, { size: 14 }),
      hint: bindingLabel("sideNewPage"),
      onSelect: () => {
        focus?.();
        newPage();
      },
    },
  ];
}

/** The pane's 「⋯」: 移到左边 / 移到右边 beside another workspace (null: nothing to move). */
export function moveTarget(paneId: string): "left" | "right" | null {
  const panes = conversationPanes(usePanes.getState().layout);
  if (panes.length < 2) return null;
  return panes.indexOf(paneId) === 0 ? "right" : "left";
}

export function movePane(paneId: string, edge: "left" | "right"): void {
  setPaneLayout((l) => moveConversation(l, paneId, { edge }));
}

/** Remembered (this machine): the first close of a conversation pane said where to find it again. */
export const CLOSE_HINT_KEY = "cutex-desktop.paneCloseHint";

function closeHintShown(): boolean {
  try {
    return localStorage.getItem(CLOSE_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * 「关闭」: the pane closes (the agent keeps running in cutex) — the last one: the tray's next entry takes its place
 * (lib/workspaces closeWorkspace); the first time ever, a toast says where it went.
 */
export function closePaneWithHint(paneId: string): void {
  closeWorkspace(paneId, []);
  if (closeHintShown()) return;
  try {
    localStorage.setItem(CLOSE_HINT_KEY, "1");
  } catch {
    // shown again next time: harmless
  }
  useApp.getState().notify(translate("convHeader.closedToast"), "info");
}
