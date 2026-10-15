// Small pieces of Settings → 跨主机: the state badge, a copy button, the read-only notice.
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { PeerView } from "../../../../shared/peers";
import { Button, HintAction } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { copyText } from "../../lib/menus";
import { usePeerWrites } from "./hooks";
import { PEER_TONE_DOT as TONE_DOT, PEER_TONE_TEXT as TONE_TEXT, peerStateView } from "./model";


export function StateBadge({ peer }: { peer: Pick<PeerView, "state" | "enabled"> }) {
  const { t } = useI18n();
  const v = peerStateView(peer);
  const hint = v.key ? t(`peers.stateHint.${v.key}` as MessageKey) : "";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-xs ${TONE_TEXT[v.tone]}`} title={hint || undefined} data-testid="peer-state">
      <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[v.tone]}`} />
      {v.key ? t(`peers.state.${v.key}` as MessageKey) : v.raw}
    </span>
  );
}

export function CopyButton({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button
      onClick={() => (copyText(text), setDone(true))}
      aria-label={t("peers.copy")}
      title={done ? t("peers.copied") : t("peers.copy")}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
    >
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  );
}

/** The primary 「复制邀请」 button: copies the one-line invite (address + code). */
export function CopyInviteButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <Button primary disabled={disabled} title={t("peers.inviteCopyHint")} onClick={() => (copyText(text), setDone(true))}>
      <span className="inline-flex items-center gap-1" data-testid="peers-invite-copy">
        {done ? <Check size={12} /> : <Copy size={12} />}
        {done ? t("peers.copied") : t("peers.inviteCopy")}
      </span>
    </Button>
  );
}

/** Notice at the top while the connection cannot write (cutex said loopback_only). */
export function ReadOnlyNotice() {
  const { t } = useI18n();
  const writes = usePeerWrites();
  if (!writes.readOnly) return null;
  return (
    <div role="status" className="mb-4 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn" data-testid="peers-readonly">
      {t("peers.readOnlyLink")}
      <HintAction onClick={writes.retry}>{t("peers.retryWrites")}</HintAction>
    </div>
  );
}

