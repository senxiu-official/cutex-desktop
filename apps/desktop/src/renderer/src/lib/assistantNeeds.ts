// 个人助理 requests waiting for the owner's 发给主管 / 取消请求 (state `awaitingOwner`) as 需要你 items: the 通知中心, the
// status-row bell and the desktop's 需要你 list show them beside the agents (phase 0, 2026-11-27). One item per
// assistant, from what the 个人助理 store already read (lib/personalAssistantStore; the nav badge keeps every supported
// host read) — no new store, no host call. Opening one opens that assistant's 请求 tab (lib/attentionActivate: chip
// ids `pa:<assistant>`). A × hides it on this device
// until the set of waiting requests changes (lib/needsYouDismiss, fingerprint = the request ids).
import type { AttentionChip, NeedsYou } from "./agentAttention";
import { hostKey } from "./hostKeys";
import type { NeedItem } from "./needItems";
import { isDismissed, needFingerprint, type Dismissals } from "./needsYouDismiss";
import { requestGroup } from "./personalAssistants";
import type { HostPa } from "./personalAssistantStore";

/** The chip id prefix of an assistant's item (agent ids never start with it). */
export const ASSISTANT_NEED_PREFIX = "pa:";

/** The host key of an assistant's item. */
export const assistantNeedKey = (hostId: string, assistantId: string) => hostKey(hostId, `${ASSISTANT_NEED_PREFIX}${assistantId}`);

/**
 * Items for the hosts in view, in host then list order; `current` gets each shown or dismissed item's fingerprint and
 * `inView` every assistant's key of a read host (so a × is forgotten once nothing waits there).
 */
export function assistantNeedItems(byHost: Readonly<Record<string, HostPa>>, hosts: readonly string[], dismissals: Dismissals, track?: { current: Map<string, string>; inView: Set<string> }): NeedItem[] {
  const out: NeedItem[] = [];
  for (const hostId of hosts) {
    const h = byHost[hostId];
    if (!h || h.loadedAt == null) continue;
    for (const a of h.assistants) {
      const key = assistantNeedKey(hostId, a.id);
      track?.inView.add(key);
      const ids = (h.requests[a.id] ?? []).filter((r) => requestGroup(r.state) === "decide").map((r) => r.id).sort();
      if (!ids.length) continue;
      const need: NeedsYou = { count: ids.length, reasons: [], askIds: ids };
      track?.current.set(key, needFingerprint(need));
      const chip: AttentionChip = { id: `${ASSISTANT_NEED_PREFIX}${a.id}`, key, hostId, name: a.config.name, signal: "needsYou", reason: null, count: ids.length, askId: null, at: 0 };
      if (isDismissed(dismissals, key, chip, need)) continue;
      out.push({ chip, host: hostId, key, row: undefined, need, assistant: { assistantId: a.id } });
    }
  }
  return out;
}

/** Needs-you items first, then the assistants' requests, then 出错. */
export function withAssistantNeeds(items: readonly NeedItem[], extra: readonly NeedItem[]): NeedItem[] {
  if (!extra.length) return items as NeedItem[];
  const firstOther = items.findIndex((i) => i.chip.signal !== "needsYou");
  return firstOther < 0 ? [...items, ...extra] : [...items.slice(0, firstOther), ...extra, ...items.slice(firstOther)];
}
