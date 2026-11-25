// An agent on a paired host (cutex peers-v2) as 「<name> @ <peer label>」 with a host mark (globe):
// never a link (remote ids are not local sessions) and never shown as the owner. Plus the claimed
// capabilities line of an incoming request, labelled as the peer's own claim (display only). With a receipt's peer
// instance id (cutex peer-delivery-receipts-v1, on a host that has it) the host part is the connected host's current
// name when the instance id matches, and the hover gives the full instance id when two hosts share a name.
import { Globe } from "lucide-react";
import type { PeerCaps } from "../../../shared/peers";
import { useI18n } from "../i18n";
import { PEER_RECEIPTS_FEATURE } from "../../../shared/crossHost";
import { featuresOf, useApp } from "../store";
import { usePeerHost } from "../lib/useCrossHost";

/** `instanceId` / `hostId`: the receipt's peer and the host that issued the record (both or neither). */
export function PeerParty({ text, label, size = 14, quiet = false, instanceId = null, hostId = null }: { text: string; label: string; size?: number; quiet?: boolean; instanceId?: string | null; hostId?: string | null }) {
  const { t } = useI18n();
  const on = useApp((s) => !!instanceId && featuresOf(s, hostId).has(PEER_RECEIPTS_FEATURE));
  const peer = usePeerHost(on ? instanceId : null, label);
  const host = peer?.name ?? label;
  // 「name @ label」 (delegations) or cutex's 「name@label」 (notes): the host part becomes the current name.
  const shown = peer && label && host !== label && (text.endsWith(`@ ${label}`) || text.endsWith(`@${label}`)) ? `${text.slice(0, text.length - label.length)}${host}` : text;
  const title = peer?.ambiguous ? t("crossHost.sameName", { name: host, id: peer.instanceId }) : t("delegation.peer.hostMark", { label: host });
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${quiet ? "" : "text-foreground"}`} title={title} data-testid="peer-party" data-cross-host-peer={peer?.instanceId}>
      <span className="flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-subtle" style={{ width: size, height: size }}>
        <Globe size={Math.max(9, size - 5)} strokeWidth={1.75} />
      </span>
      <span className="truncate">{shown}</span>
    </span>
  );
}

/** 「对端声称（仅展示）：沙箱 read-only · 不联网」 — the requester's self-reported caps. */
export function ClaimedCaps({ caps }: { caps: Partial<PeerCaps> | null | undefined }) {
  const { t } = useI18n();
  if (!caps) return null;
  const parts = [
    caps.sandbox ? t("delegation.peer.caps.sandbox", { v: caps.sandbox }) : null,
    caps.networkAccess === true ? t("delegation.peer.caps.network") : caps.networkAccess === false ? t("delegation.peer.caps.noNetwork") : null,
    caps.unrestrictedServices ? t("delegation.peer.caps.services") : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="text-caption/[inherit] text-subtle" title={t("delegation.peer.claimedCapsHint")} data-testid="claimed-caps">
      {t("delegation.peer.claimedCapsLine", { label: t("delegation.peer.claimedCaps"), caps: parts.join(" · ") })}
    </span>
  );
}
