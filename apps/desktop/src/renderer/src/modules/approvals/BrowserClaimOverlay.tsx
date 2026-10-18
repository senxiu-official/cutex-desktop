// 「{{agent}} 想控制「…」标签页」 in the requesting agent's conversation (conversation.overlay): the owner
// sees a browser_claim where the agent works — next to its right lane — instead of only on 审批. A pending
// browser_open of the agent (自开页面审批 = 每次审批) gets the same card (BrowserOpenCard) when no claim waits.
// UI review 2026-10-15 #1: the card sits in the conversation's dock above the composer (lib/conversationDock,
// normal flow, with the queue / interaction dock), never over the messages; it reserves no overlay space.
// 2026-10-17: every other pending approval of the agent (a managed / persistent service, an agent on an
// approval-gated profile, a workflow plan, …) gets the same dock card (PendingCard inline) after the
// browser ones, so the owner decides where the agent asked instead of only on 审批.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { browserClaimApproval } from "../../../../shared/browserClaim";
import { useI18n } from "../../i18n";
import { agentPendingApprovals, APPROVAL_WAIT_FEATURE, holdLeftMs } from "../../lib/approvals";
import { useListHosts } from "../../lib/hostLists";
import { useConnectedHostData } from "../../lib/hostLists";
import { useClock, useNow } from "../../lib/time";
import { useConversationDock } from "../../lib/conversationDock";
import { agentHost, featuresOf, useApp } from "../../store";
import type { OverlayLayout } from "../slots";
import { BrowserClaimPanel } from "./BrowserClaimPanel";
import { BrowserOpenCard } from "./BrowserOpenCard";
import { PendingCard } from "./PendingApprovalCard";

/** Main grants local pages and 一直允许 origins by itself within about a second; a card for those would only flash. */
export const CLAIM_CARD_DELAY_MS = 1500;

export function BrowserClaimOverlay({ sessionId }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  const { t } = useI18n();
  const hostId = useApp(agentHost);
  const data = useConnectedHostData().find(d => d.hostId === hostId);
  const clock = useClock();
  // cutex approval-wait: a call holding for the owner shows first with a countdown; once it stops holding
  // (it answered approval_required) the card leaves the conversation and the request stays on 审批.
  const holds = useApp((s) => featuresOf(s, hostId).has(APPROVAL_WAIT_FEATURE));
  const holding = holds && (data?.approvals ?? []).some((a) => a.requesterCutexSessionId === sessionId && holdLeftMs(a, Date.now()) !== null);
  const tick = useNow(holding);
  const now = holding ? tick : clock;
  const pending = agentPendingApprovals(data?.approvals ?? null, sessionId, now, holds);
  const claims = pending.filter(record => !!browserClaimApproval(record, hostId));
  const opens = pending.filter(record => record.kind === "browser_open" && record.state === "pending");
  // Holding first, then oldest first: the one the agent waits on longest (cutex lists newest first).
  const rest = pending.filter(record => record.kind !== "browser_claim" && record.kind !== "browser_open");
  const others = [...rest.filter(record => holdLeftMs(record, now) !== null), ...rest.filter(record => holdLeftMs(record, now) === null).reverse()];
  // The agent is blocked on a holding call: its card goes before browser requests.
  const held = others[0] && holdLeftMs(others[0], now) !== null ? others[0] : undefined;
  const first = held ?? claims[0] ?? opens[0] ?? others[0];
  const more = claims.length + opens.length + others.length - 1;
  const hosts = useListHosts();
  const look = hosts.look(hostId);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [ready, setReady] = useState<string | null>(null);
  const dock = useConversationDock();
  const firstId = first?.approvalId;
  const browser = first?.kind === "browser_claim" || first?.kind === "browser_open";
  useEffect(() => {
    if (!firstId) return;
    // Only browser requests may be granted by main itself within a second; the rest show at once.
    const timer = setTimeout(() => setReady(firstId), browser ? CLAIM_CARD_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [firstId, browser]);
  if (!first || hidden.has(first.approvalId) || ready !== first.approvalId || !dock) return null;
  return createPortal(<div className="side-col side-col-composer w-full px-4 pb-2"><div data-browser-claim-card data-approval-kind={first.kind} className="relative rounded-xl border border-border bg-surface px-4 py-3">
    <button type="button" aria-label={t("approvals.browser.cancel")} title={t("approvals.browser.cancel")} onClick={() => setHidden(set => new Set([...set, first.approvalId]))}
      className="absolute top-2 right-2 rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground"><X size={13} /></button>
    {first.kind === "browser_open"
      ? <BrowserOpenCard key={first.approvalId} hostId={hostId} approval={first} />
      : first.kind === "browser_claim"
        ? <BrowserClaimPanel key={first.approvalId} variant="card" hostId={hostId} approval={first} services={data?.services} />
        : <PendingCard key={first.approvalId} variant="inline" record={first} origin={{ hostId, sidebar: data?.sidebar ?? null, services: data?.services, look, mark: false, stale: hosts.stale.has(hostId) }} />}
    {more > 0 && <p className="mt-1 text-[11px] text-subtle">{t("approvals.claim.more", { n: more })}</p>}
  </div></div>, dock);
}
