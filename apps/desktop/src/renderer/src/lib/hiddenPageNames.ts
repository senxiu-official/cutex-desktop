// The words for panes with nothing for the agent in view (lib/hiddenPage): their owners' names and the rail's tooltip.
import { translate } from "../i18n";
import { sidebarOf, useApp } from "../store";
import type { HiddenPageInfo, PageOwner } from "./hiddenPage";

type AppState = ReturnType<typeof useApp.getState>;

/** An agent's display name on its host (its id when the sidebar does not list it). */
export function ownerName(s: AppState, o: Pick<PageOwner, "hostId" | "sessionId">): string {
  const sidebar = sidebarOf(s, o.hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === o.sessionId)?.displayName ?? o.sessionId;
}

/** The owners' names, in the order given (re-rendered only when a name changes). */
export function useOwnerNames(owners: readonly PageOwner[]): string[] {
  const joined = useApp((s) => owners.map((o) => ownerName(s, o)).join("\u0000"));
  return joined ? joined.split("\u0000") : [];
}

/** 「这个Maid在这一页没有内容（Eva 有 2 个、别处 1 个）」 / “Nothing here for this Maid (Eva has 2, 1 elsewhere)”: at most two owners named. */
export function hiddenPageTip(info: HiddenPageInfo, names: readonly string[]): string {
  const parts = info.owners.slice(0, 2).map((o, i) => translate("shelf.page.hiddenOwner", { name: names[i] ?? o.sessionId, n: o.count }));
  const more = info.owners.slice(2).reduce((n, o) => n + o.count, 0) + info.others;
  if (more) parts.push(translate("shelf.page.hiddenOthers", { n: more }));
  return parts.length ? translate("shelf.page.hiddenTipWith", { who: parts.join(translate("shelf.page.hiddenSep")) }) : translate("shelf.page.hiddenTip");
}

/**
 * The rail's hover hint for a page with panes empty for this agent: every pane — 「这个Maid在这一页没有内容（小侦探 有 1 个）」;
 * some — 「有 1 个窗格对这个Maid是空的（小侦探 有 1 个）」.
 */
export function emptySlotsTip(empty: number, panes: number, info: HiddenPageInfo, names: readonly string[]): string {
  if (empty >= panes) return hiddenPageTip(info, names);
  const parts = info.owners.slice(0, 2).map((o, i) => translate("shelf.page.hiddenOwner", { name: names[i] ?? o.sessionId, n: o.count }));
  const more = info.owners.slice(2).reduce((n, o) => n + o.count, 0) + info.others;
  if (more) parts.push(translate("shelf.page.hiddenOthers", { n: more }));
  return translate(parts.length ? "shelf.page.partlyEmptyWith" : "shelf.page.partlyEmpty", { n: empty, who: parts.join(translate("shelf.page.hiddenSep")) });
}
