// LEGACY(input-ledger-v1): frozen delivery inference for older hosts.
// Delete only when EVERY host advertises input-ledger-v1 (including hachimi).
// A visible external-event item alone is not a model receipt: Claude also presents inputs for
// turns rejected by the provider. Only the same exact input in a completed turn is positive evidence.
import { useEffect, useMemo } from "react";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { useApp, viewOf } from "../../store";
import { dismissReceipt, isDismissibleReceipt, useHiddenReceiptIds, useRestoredReceiptIds } from "./busReceiptVisibility";
import { settlementWriteKey, useSettlementWrites } from "../messageSettlementWrites";
import { useAgentMessages } from "../agentMessageStore";
import type { TimelineState } from "../timeline";

export function consumedBusReceiptIds(items: readonly AdmissionNextStep[], timeline: TimelineState | null | undefined): ReadonlySet<string> {
  const consumed = new Set<string>();
  if (!timeline) return consumed;
  const candidates = new Set(items.filter(isDismissibleReceipt).map(item => item.id));
  if (!candidates.size) return consumed;
  const completed = new Map(timeline.turns.filter(turn => turn.status === "completed").map(turn => [turn.id, turn]));
  for (const entry of timeline.entries.values()) {
    if (entry.kind === "received" && candidates.has(entry.id) && completed.get(entry.turnId)?.entryIds.includes(entry.id)) consumed.add(entry.id);
  }
  return consumed;
}

/** One projection for rows, header count, compact chips and empty-panel visibility. */
export function useUnsettledBusReceipts(host: string, session: string, items: AdmissionNextStep[]): AdmissionNextStep[] {
  const timeline = useApp(s => s.sessions ? viewOf(s, host, session)?.timeline ?? null : null);
  // The timeline is mutated in place, so a revision stands in for it — without the bumps of streamed reply / reasoning
  // text (`textVersion`, store.ts): consumption reads only received items and turn completion, never that text, so
  // the tray does not re-render (and re-measure) per streamed frame.
  const version = useApp(s => {
    const view = s.sessions ? viewOf(s, host, session) : undefined;
    return view ? view.version - (view.textVersion ?? 0) : 0;
  });
  const hidden = useHiddenReceiptIds(host, session);
  const restored = useRestoredReceiptIds(host, session);
  const writes = useSettlementWrites(s => s.entries);
  const messages = useAgentMessages(s => s.byId);
  const activeHost = useApp(s => s.hosts?.active);
  const consumed = useMemo(() => consumedBusReceiptIds(items.filter(item => !hidden.has(item.id) && !restored.has(item.id)), timeline), [items, timeline, version, hidden, restored]);
  useEffect(() => {
    // Preserve this exact positive observation across history paging/re-bootstrap. This is local
    // presentation state, not a server acknowledgement, cancellation, resend or delivery claim.
    for (const item of items) if (consumed.has(item.id) && !hidden.has(item.id)) dismissReceipt(host, session, item);
  }, [host, session, items, consumed, hidden]);
  return useMemo(() => {
    const next = items.filter(item => item.settlement?.state !== "closed" && writes[settlementWriteKey(host, item.id)]?.settlement?.state !== "closed"
      && !((!activeHost || activeHost === host) && messages[item.id]?.settlement?.state === "closed")
      && (!isDismissibleReceipt(item) || (!hidden.has(item.id) && !consumed.has(item.id))));
    return next.length === items.length ? items : next;
  }, [items, hidden, consumed, writes, host, messages, activeHost]);
}
