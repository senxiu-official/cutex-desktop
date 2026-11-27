// 需要你 (owner 2026-11-05): one list for the tray's 通知中心 and the bell in the status row. It holds every agent of
// the hosts in view that waits on the owner (needs-you, or 出错), the open agent included, so the number does not
// change when the owner switches agents; the list marks agents on screen 「就在这里」. Finished turns are not in it:
// they need no answer (the sidebar keeps their 完成). A dismissed item (× in the list, lib/needsYouDismiss) stays
// hidden until its need changes. What waits on connected hosts outside the view is one count (`elsewhere`).
// Hosts with cross-device read state (design 061): the person's state on the host decides (lib/needItems), and a ×
// there hides the item on every device of the person.
import { useEffect, useMemo } from "react";
import type { MessageKey } from "../i18n";
import { taskTag } from "./tasks";
import { hostKey } from "./hostKeys";
import { attentionOffOn, useHostAttentionVersion } from "./hostAttention";
import { useOutOfScopeAttention } from "./hostLists";
import { needItems, type NeedItem } from "./needItems";
import { assistantNeedItems, withAssistantNeeds } from "./assistantNeeds";
import { usePa } from "./personalAssistantStore";
import { errorKey, needFingerprint, pruneStoredDismissals, runtimeErrorFingerprint, useDismissals } from "./needsYouDismiss";
import { useScopedAttention, useScopedSidebar } from "./scopedSidebarView";
import { rowKey, type AgentRow } from "./sidebar";
import { turnMarksOn } from "./turnUnread";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
export type { NeedItem };

/** Why the agent waits, in a few words: its reasons joined (「待审批 · 有提问」, 「需要你 ×5」 style count when it waits on more), or 出错. */
export function needReason(t: Translate, item: Pick<NeedItem, "chip" | "need" | "assistant">): string {
  const { chip, need } = item;
  if (item.assistant) return t("personal-assistants.needs.reason", { n: chip.count });
  if (chip.signal === "error") return t("agentStatus.error");
  if (!need || need.reasons.length === 0) return t("agentStatus.reason.confirm");
  const words = need.reasons.map((r) => t(`agentStatus.reason.${r}` as MessageKey)).join(" · ");
  const tag = need.reasons.length === 1 && need.askIds[0] ? ` ${taskTag(need.askIds[0]).label}` : "";
  const more = need.count > need.reasons.length ? ` ×${need.count}` : "";
  return `${words}${tag}${more}`;
}

const IDENTITY_CODES = new Set(["attention_person_binding_required", "attention_owner_identity_unconfirmed"]);

export function useNeedsYouView() {
  const scoped = useScopedSidebar();
  const { rows, signals, needs, marks } = useScopedAttention(scoped.model, scoped.scope);
  const focus = scoped.scope.focus;
  const dismissals = useDismissals();
  const elsewhere = useOutOfScopeAttention();
  const hostState = useHostAttentionVersion();
  const markOf = useMemo(() => (row: AgentRow) => ((row.hostId ?? focus) === focus ? marks[row.id] : turnMarksOn(row.hostId!)[row.id]), [marks, focus, hostState]); // eslint-disable-line react-hooks/exhaustive-deps -- other hosts' marks follow their state
  const agentItems = useMemo(() => needItems({ rows, signals, needs, markOf, focus, dismissals }), [rows, signals, needs, markOf, focus, dismissals, hostState]); // eslint-disable-line react-hooks/exhaustive-deps -- `hostState` stands for every host's attention state
  // 个人助理 requests waiting for the owner, on the hosts in view (lib/assistantNeeds).
  const paHosts = usePa((s) => s.byHost);
  const inScope = scoped.scope.ids as readonly string[] | undefined;
  const paItems = useMemo(() => assistantNeedItems(paHosts, inScope ?? [focus], dismissals), [paHosts, inScope, focus, dismissals]);
  const items = useMemo(() => withAssistantNeeds(agentItems, paItems), [agentItems, paItems]);
  // Dismissals whose need or runtime error is gone or changed go (a new one shows the item again).
  useEffect(() => {
    const current = new Map<string, string>();
    for (const r of rows) {
      if (signals.get(rowKey(r)) === "needsYou") current.set(hostKey(r.hostId ?? focus, r.id), needFingerprint(needs.get(rowKey(r))));
      const fp = runtimeErrorFingerprint(r.session.runtime);
      if (fp) current.set(errorKey(hostKey(r.hostId ?? focus, r.id)), fp);
    }
    const inView = new Set(rows.map((r) => hostKey(r.hostId ?? focus, r.id)));
    assistantNeedItems(paHosts, inScope ?? [focus], {}, { current, inView });
    pruneStoredDismissals(current, inView);
  }, [rows, signals, needs, focus, paHosts, inScope]);
  // A capable host in view that cannot tell who this is yet (multi-person host, device not bound / owner unconfirmed):
  // its reads and ×s stay on this device for now (lib/hostAttention keeps the local records), and the list says so.
  const localOnly = useMemo(() => [...new Set([focus, ...rows.map((r) => r.hostId ?? focus)])].some((h) => IDENTITY_CODES.has(attentionOffOn(h)?.code ?? "")), [rows, focus, hostState]); // eslint-disable-line react-hooks/exhaustive-deps -- `hostState` stands for every host's attention state
  return { items, elsewhere, scope: scoped.scope, localOnly };
}
