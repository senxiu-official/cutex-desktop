// 「{{agent}} 想控制「…」标签页」 in the requesting agent's conversation (conversation.overlay): the owner
// sees a browser_claim where the agent works — next to its right lane — instead of only on 审批. A pending
// browser_open of the agent (自开页面审批 = 每次审批) gets the same card (BrowserOpenCard) when no claim waits.
// UI review 2026-10-15 #1: the card sits in the conversation's dock above the composer (lib/conversationDock,
// normal flow, with the queue / interaction dock), never over the messages; it reserves no overlay space.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { browserClaimApproval } from "../../../../shared/browserClaim";
import { useI18n } from "../../i18n";
import { livePending } from "../../lib/approvals";
import { useConnectedHostData } from "../../lib/hostLists";
import { useClock } from "../../lib/time";
import { useConversationDock } from "../../lib/conversationDock";
import { agentHost, useApp } from "../../store";
import type { OverlayLayout } from "../slots";
import { BrowserClaimPanel } from "./BrowserClaimPanel";
import { BrowserOpenCard } from "./BrowserOpenCard";

/** Main grants local pages and 一直允许 origins by itself within about a second; a card for those would only flash. */
export const CLAIM_CARD_DELAY_MS = 1500;

export function BrowserClaimOverlay({ sessionId }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  const { t } = useI18n();
  const hostId = useApp(agentHost);
  const data = useConnectedHostData().find(d => d.hostId === hostId);
  const now = useClock();
  const pending = livePending(data?.approvals ?? null, now).filter(record => record.requesterCutexSessionId === sessionId);
  const claims = pending.filter(record => !!browserClaimApproval(record, hostId));
  const opens = pending.filter(record => record.kind === "browser_open" && record.state === "pending");
  const first = claims[0] ?? opens[0];
  const more = claims.length + opens.length - 1;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [ready, setReady] = useState<string | null>(null);
  const dock = useConversationDock();
  const firstId = first?.approvalId;
  useEffect(() => {
    if (!firstId) return;
    const timer = setTimeout(() => setReady(firstId), CLAIM_CARD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [firstId]);
  if (!first || hidden.has(first.approvalId) || ready !== first.approvalId || !dock) return null;
  return createPortal(<div className="side-col side-col-composer w-full px-4 pb-2"><div data-browser-claim-card className="relative rounded-xl border border-border bg-surface px-4 py-3">
    <button type="button" aria-label={t("approvals.browser.cancel")} title={t("approvals.browser.cancel")} onClick={() => setHidden(set => new Set([...set, first.approvalId]))}
      className="absolute top-2 right-2 rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground"><X size={13} /></button>
    {first.kind === "browser_open"
      ? <BrowserOpenCard key={first.approvalId} hostId={hostId} approval={first} />
      : <BrowserClaimPanel key={first.approvalId} variant="card" hostId={hostId} approval={first} services={data?.services} />}
    {more > 0 && <p className="mt-1 text-[11px] text-subtle">{t("approvals.claim.more", { n: more })}</p>}
  </div></div>, dock);
}
