// The avatar at the top of a Shelf Rail (docs/design/009 实现时定下的细节, owner 2026-10-22): whose Shelf this is
// (the conversation that owns it; a shared page or a Shelf of no agent: a neutral icon) and the Shelf's explicit
// toggle — a click folds it to its rail / expands it; right-click: 收起/展开 · 只看 Shelf · 移到另一边 · 最大化 ·
// 关闭 Shelf · ⚙ Shelf 设置… · 打开它的会话 (when that conversation is not on screen). Each row's preview (design
// 008) and action come from the same effect as elsewhere (lib/menuForetells, lib/workspaceEffects). Clicking the
// page in view does nothing (owner 2026-10-22, lib/shelves railPageClickNow): the avatar is the toggle.
// Shell code: names no feature.
import { Columns2, Eye, Maximize2, Minimize2, Minus, PanelLeft, PanelRight, X } from "lucide-react";
import { translate } from "../i18n";
import type { MenuEntry } from "./contextMenu";
import { shelfCloseForetell, shelfCollapseForetell, shelfGrowForetell, shelfMoveForetell } from "./menuForetells";
import { panelSettingsItem } from "./panelSettings";
import { panelGuideTail } from "./panelGuideMenu";
import { conversationPanes, paneBinding } from "./paneLayout";
import { usePanes } from "./paneStore";
import { findShelf, pagesOfShelf } from "./sideLayout";
import { liveConversation, useSide } from "./sideLayoutStore";
import { closeShelf, moveShelfSide, toggleShelfNow } from "./shelves";
import { canGrow, shelfGrown, toggleShelfGrow } from "./panelGrow";
import { agentEffect, shelfOnlyEffect, type Effect } from "./workspaceEffects";

const ICON = 14;
const t = translate;

/** The conversation a Shelf belongs to (null: a Shelf of no agent). */
export interface ShelfOwner {
  hostId: string;
  sessionId: string;
  name: string;
}

/** The live Shelf now (the avatar's menu acts on it; another workspace's is made live first by its press). */
const liveShelf = (shelfId: string) => {
  const layout = useSide.getState().layout;
  const shelf = findShelf(layout, shelfId);
  return shelf ? { layout, shelf, collapsed: !!shelf.collapsed || !layout.open } : null;
};

/** The avatar's click: fold the Shelf to its rail / expand it (its preview from the same inputs). */
export function shelfToggleEffect(shelfId: string): Effect {
  const live = liveShelf(shelfId);
  if (!live) return { foretell: null, run: () => {} };
  return { foretell: shelfCollapseForetell(live.shelf.side, live.collapsed), run: () => toggleShelfNow(shelfId) };
}

/** The pane showing `owner`'s conversation (null: not on screen). */
function ownerPane(owner: ShelfOwner | null): string | null {
  if (!owner) return null;
  const layout = usePanes.getState().layout;
  return conversationPanes(layout).find((id) => {
    const b = paneBinding(layout, id);
    return b?.hostId === owner.hostId && b.sessionId === owner.sessionId;
  }) ?? null;
}

const row = (label: string, icon: React.ReactNode, eff: Effect, extra: { disabled?: boolean; title?: string } = {}): MenuEntry => ({
  label,
  icon,
  ...extra,
  foretell: () => eff.foretell,
  onSelect: () => eff.run(),
});

/** The avatar's right-click menu. */
export function shelfAvatarMenu(shelfId: string, owner: ShelfOwner | null): MenuEntry[] {
  const live = liveShelf(shelfId);
  if (!live) return [];
  const { layout, shelf, collapsed } = live;
  const side = shelf.side;
  const panes = pagesOfShelf(layout, shelfId).reduce((n, p) => n + p.cards.length, 0);
  const other = side === "left" ? "right" : "left";
  const taken = (layout.shelves ?? []).some((x) => x.side === other);
  const pane = ownerPane(owner);
  const ownedLive = !!owner && liveConversation() === `${owner.hostId}|${owner.sessionId}`;
  const only = pane && ownedLive ? shelfOnlyEffect(pane) : null;
  const grown = shelfGrown(shelfId);
  const canMax = grown || canGrow({ kind: "shelf", conv: liveConversation(), shelfId, card: null });
  const toggle = shelfToggleEffect(shelfId);
  const out: MenuEntry[] = [
    row(t(collapsed ? "shelf.expandTip" : "shelf.collapseRail"), collapsed ? <Maximize2 size={ICON} /> : <Minus size={ICON} />, toggle),
    only && row(t("shelfOnly.action"), <Columns2 size={ICON} />, only, { disabled: !only.foretell, title: t(only.foretell ? "shelfOnly.hint" : "shelfOnly.noShelf") }),
    {
      label: t(side === "left" ? "shelf.moveRight" : "shelf.moveLeft"),
      icon: side === "left" ? <PanelRight size={ICON} /> : <PanelLeft size={ICON} />,
      disabled: taken,
      title: taken ? t("shelf.moveTaken") : undefined,
      foretell: () => (taken ? null : shelfMoveForetell(side)),
      onSelect: () => moveShelfSide(shelfId),
    },
    !collapsed && {
      label: t(grown ? "panel.restore" : "panel.maximiseShelf"),
      icon: grown ? <Minimize2 size={ICON} /> : <Maximize2 size={ICON} />,
      disabled: !canMax,
      title: canMax ? undefined : t("panel.maxNoGap"),
      foretell: () => (canMax ? shelfGrowForetell(side, "grow", grown) : null),
      onSelect: () => void toggleShelfGrow(shelfId),
    },
    // 打开它的会话: only when that conversation is not on screen (替换 / its usual open, the same effect as a sidebar click).
    owner && !pane && row(t("shelfAvatar.openConversation", { name: owner.name }), <Eye size={ICON} />, agentEffect({ hostId: owner.hostId, key: owner.sessionId, title: owner.name }, "replace")),
    "separator",
    { label: t("shelf.close"), icon: <X size={ICON} />, danger: true, info: panes ? t("shelf.closeHint", { n: panes }) : undefined, foretell: () => shelfCloseForetell(side, panes), onSelect: () => closeShelf(shelfId) },
    "separator",
    panelSettingsItem("sides", { panel: `[data-shelf="${shelfId}"]` }),
    ...panelGuideTail({ panel: "shelf", shelfId }),
  ];
  return out;
}

/** The avatar's tooltip: whose Shelf it is (a pinned page in view: 「固定页：…」; no owner: 「Shelf」). */
export function shelfAvatarTip(owner: ShelfOwner | null, pinned = false): string {
  return owner ? t("shelfAvatar.whose", { name: owner.name }) : pinned ? t("shelf.page.pinnedTip") : t("shelfAvatar.neutral");
}

/** What a click and a right-click on the Rail's avatar do (the Rail's ⓘ, design 040 §2.1: not in the tip). */
export function shelfAvatarHowTo(collapsed: boolean): string {
  return `${t("shelfAvatar.neutral")}: ${t(collapsed ? "shelfAvatar.clickExpand" : "shelfAvatar.clickCollapse")} · ${t("shelfAvatar.more")}`;
}
