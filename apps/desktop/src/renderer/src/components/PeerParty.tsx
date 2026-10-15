// An agent on a paired host (cutex peers-v2) as 「<name> @ <peer label>」 with a host mark (globe):
// never a link (remote ids are not local sessions) and never shown as the owner. Plus the claimed
// capabilities line of an incoming request, labelled as the peer's own claim (display only).
import { Globe } from "lucide-react";
import type { PeerCaps } from "../../../shared/peers";
import { useI18n } from "../i18n";

export function PeerParty({ text, label, size = 14, quiet = false }: { text: string; label: string; size?: number; quiet?: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${quiet ? "" : "text-foreground"}`} title={t("delegation.peer.hostMark", { label })} data-testid="peer-party">
      <span className="flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-subtle" style={{ width: size, height: size }}>
        <Globe size={Math.max(9, size - 5)} strokeWidth={1.75} />
      </span>
      <span className="truncate">{text}</span>
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
    <span className="text-[11px] text-subtle" title={t("delegation.peer.claimedCapsHint")} data-testid="claimed-caps">
      {t("delegation.peer.claimedCapsLine", { label: t("delegation.peer.claimedCaps"), caps: parts.join(" · ") })}
    </span>
  );
}
