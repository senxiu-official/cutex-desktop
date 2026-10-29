// 「替换这一栏…」 (design 039): a column is only replaced on purpose — by a drop on it, or by this row of its menu: the
// agents not on screen listed in the sidebar's order, the one chosen takes this column (the one it showed stays in the
// tray as a workspace of its own). Shell code: names no feature.
import type { MenuEntry } from "./contextMenu";
import type { MessageKey } from "../i18n";
import { conversationPanes, paneBinding } from "./paneLayout";
import { usePanes } from "./paneStore";
import { sidebarOf, useApp } from "../store";
import { replaceWith } from "./workspaces";

/** How many agents the pick lists (the sidebar has the rest). */
export const REPLACE_LIST_MAX = 40;

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** The agents of `hostId` that a column could show now: online, not on screen, not archived. */
export function replaceCandidates(hostId: string): { sessionId: string; name: string }[] {
  const layout = usePanes.getState().layout;
  const shown = new Set(conversationPanes(layout).flatMap((id) => paneBinding(layout, id)?.sessionId ?? []));
  const sidebar = sidebarOf(useApp.getState(), hostId);
  return (sidebar?.active ?? [])
    .filter((r) => !shown.has(r.cutexSessionId))
    .slice(0, REPLACE_LIST_MAX)
    .map((r) => ({ sessionId: r.cutexSessionId, name: r.displayName ?? r.cutexSessionId }));
}

/** The 「替换这一栏…」 row of a column's menu (null: nothing to put there). */
export function replaceColumnEntry(paneId: string, hostId: string, t: T): MenuEntry {
  const list = replaceCandidates(hostId);
  return {
    label: t("columnPick.menu"),
    disabled: list.length === 0,
    title: list.length === 0 ? t("columnPick.none") : undefined,
    submenu: list.map((a) => ({ label: a.name, onSelect: () => replaceWith(hostId, a.sessionId, paneId) })),
    onSelect: () => {},
  };
}
