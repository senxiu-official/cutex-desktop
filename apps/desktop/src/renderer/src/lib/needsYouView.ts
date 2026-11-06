// 需要你 (owner 2026-11-05): one list for the tray's 通知中心 and the bell in the status row. It holds every agent of
// the hosts in view that waits on the owner (needs-you, or 出错), the open agent included, so the number does not
// change when the owner switches agents; the list marks agents on screen 「就在这里」. Finished turns are not in it:
// they need no answer (the sidebar keeps their 完成). A dismissed item (× in the list, lib/needsYouDismiss) stays
// hidden until its need changes. What waits on connected hosts outside the view is one count (`elsewhere`).
import { useEffect, useMemo } from "react";
import type { MessageKey } from "../i18n";
import { attentionChips, type AttentionChip, type NeedsYou } from "./agentAttention";
import { taskTag } from "./tasks";
import { hostKey } from "./hostKeys";
import { useOutOfScopeAttention } from "./hostLists";
import { chipDismissed, errorKey, needFingerprint, pruneStoredDismissals, runtimeErrorFingerprint, useDismissals } from "./needsYouDismiss";
import { useScopedAttention, useScopedSidebar } from "./scopedSidebarView";
import { rowKey, type AgentRow } from "./sidebar";
import { turnMarksOn } from "./turnUnread";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
export interface NeedItem {
  chip: AttentionChip;
  /** The agent's host (never undefined, unlike the chip's). */
  host: string;
  /** Host key (host + agent id): dismissals and React keys. */
  key: string;
  row: AgentRow | undefined;
  need: NeedsYou | undefined;
}

/** Why the agent waits, in a few words: its reasons joined (「待审批 · 有提问」, 「需要你 ×5」 style count when it waits on more), or 出错. */
export function needReason(t: Translate, item: Pick<NeedItem, "chip" | "need">): string {
  const { chip, need } = item;
  if (chip.signal === "error") return t("agentStatus.error");
  if (!need || need.reasons.length === 0) return t("agentStatus.reason.confirm");
  const words = need.reasons.map((r) => t(`agentStatus.reason.${r}` as MessageKey)).join(" · ");
  const tag = need.reasons.length === 1 && need.askIds[0] ? ` ${taskTag(need.askIds[0]).label}` : "";
  const more = need.count > need.reasons.length ? ` ×${need.count}` : "";
  return `${words}${tag}${more}`;
}

export function useNeedsYouView() {
  const scoped = useScopedSidebar();
  const { rows, signals, needs, marks } = useScopedAttention(scoped.model, scoped.scope);
  const focus = scoped.scope.focus;
  const dismissals = useDismissals();
  const elsewhere = useOutOfScopeAttention();
  const byKey = useMemo(() => new Map(rows.map((r) => [hostKey(r.hostId ?? focus, r.id), r])), [rows, focus]);
  const markOf = useMemo(() => (row: AgentRow) => ((row.hostId ?? focus) === focus ? marks[row.id] : turnMarksOn(row.hostId!)[row.id]), [marks, focus]);
  const items = useMemo(() => {
    const out: NeedItem[] = [];
    for (const chip of attentionChips(rows, signals, needs, markOf, null)) {
      if (chip.signal === "done") continue;
      const host = chip.hostId ?? focus;
      const key = hostKey(host, chip.id);
      const row = byKey.get(key);
      const need = needs.get(chip.key);
      if (chipDismissed(dismissals, key, chip, need, row, !!(row && markOf(row)?.failed))) continue;
      out.push({ chip, host, key, row, need });
    }
    return out;
  }, [rows, signals, needs, markOf, focus, byKey, dismissals]);
  // Dismissals whose need or runtime error is gone or changed go (a new one shows the item again).
  useEffect(() => {
    const current = new Map<string, string>();
    for (const r of rows) {
      if (signals.get(rowKey(r)) === "needsYou") current.set(hostKey(r.hostId ?? focus, r.id), needFingerprint(needs.get(rowKey(r))));
      const fp = runtimeErrorFingerprint(r.session.runtime);
      if (fp) current.set(errorKey(hostKey(r.hostId ?? focus, r.id)), fp);
    }
    pruneStoredDismissals(current, new Set(rows.map((r) => hostKey(r.hostId ?? focus, r.id))));
  }, [rows, signals, needs, focus]);
  return { items, elsewhere, scope: scoped.scope };
}
