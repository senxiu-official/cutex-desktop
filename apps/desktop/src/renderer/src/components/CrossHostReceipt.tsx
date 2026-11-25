// A cross-host record's delivery receipt and its peer host (cutex peer-delivery-receipts-v1, lib/crossHost). Three
// facts kept apart: which host is the other side (its current name on this desktop when the instance id matches a
// connected host, else the record's snapshot; the full instance id in the hover when two hosts share a name), how
// far delivery got (the receipt and its fixed reason), and whether this desktop is connected to that host — so
// 「目的项目限制跨主机委托」 never reads as 「对端离线」. Opening the other side goes only to the host with the same
// instance id; writes stay with the daemon that issued the record.
import { useState } from "react";
import { ChevronDown, ChevronRight, Globe } from "lucide-react";
import type { CrossHost } from "../../../shared/crossHost";
import { useI18n, type MessageKey } from "../i18n";
import { receiptKey, receiptNeedsNotice, receiptTone, receiptWords, type ReceiptTone } from "../lib/crossHost";
import { openDelegationDetail } from "../lib/delegationOpen";
import { refreshDelegation } from "../lib/delegationStore";
import { formatAbsolute, formatAt } from "../lib/time";
import { usePeerHost } from "../lib/useCrossHost";
import { useSizeFlags, widthAtLeast } from "../lib/sizeFlags";
import { Tag, type TagTone } from "./Tag";

const TEXT: Record<ReceiptTone, string> = { muted: "text-muted", accent: "text-accent", green: "text-ok-text", warn: "text-warn-text", danger: "text-danger" };
const TAG: Record<ReceiptTone, TagTone> = { muted: "neutral", accent: "accent", green: "ok", warn: "attention", danger: "danger" };

/** The peer host's name as this desktop knows it, with the instance id in the hover when the name is shared. */
export function PeerHostName({ instanceId, snapshot, className = "" }: { instanceId: string; snapshot: string; className?: string }) {
  const { t } = useI18n();
  const peer = usePeerHost(instanceId, snapshot);
  if (!peer) return null;
  const title = peer.ambiguous ? t("crossHost.sameName", { name: peer.name, id: instanceId }) : t("delegation.peer.hostMark", { label: peer.name });
  return <span className={`min-w-0 truncate ${className}`} title={title} data-cross-host-peer={instanceId} data-cross-host-ambiguous={peer.ambiguous ? "" : undefined}>{peer.name}</span>;
}

/** A list row's receipt word, only when it needs noticing (waiting with a reason, failed, unconfirmed); reason in the hover. */
export function ReceiptTag({ ch, className = "" }: { ch: CrossHost; className?: string }) {
  const { t } = useI18n();
  if (!receiptNeedsNotice(ch)) return null;
  const words = receiptWords((k, v) => t(k as MessageKey, v), ch);
  return (
    <Tag tone={TAG[receiptTone(ch)]} fit className={className} title={[words.state, words.reason].filter(Boolean).join(" · ")} data-cross-host-receipt={receiptKey(ch.receipt.state)}>
      {words.reason ?? words.state}
    </Tag>
  );
}

const ROOM = { room: widthAtLeast(5) };

/**
 * A list row's receipt tag in the room the title leaves (basis 0: the title keeps its width); shown only when that
 * room fits a readable tag — a narrow list keeps it in the status hover and the detail instead of a clipped 「暂…」.
 */
export function RowReceiptTag({ ch }: { ch: CrossHost }) {
  const [ref, flags] = useSizeFlags(ROOM);
  if (!receiptNeedsNotice(ch)) return null;
  return (
    <span ref={ref} className="flex min-w-0 flex-1 basis-0 overflow-hidden" data-cross-host-row-tag={flags.room ? "" : "hidden"}>
      {flags.room && <ReceiptTag ch={ch} />}
    </span>
  );
}

/**
 * The receipt block of a delegation card (`detail`: the detail page — expanded, with the instance id). `hostId`: the
 * host that issued the record; `askId`: the delegation (the peer keeps the same id) for 打开对端记录 and 刷新.
 */
export function CrossHostReceipt({ ch, hostId, askId, detail = false }: { ch: CrossHost; hostId: string; askId?: string; detail?: boolean }) {
  const { t } = useI18n();
  const peer = usePeerHost(ch.peer.instanceId, ch.peer.label);
  const troubled = receiptNeedsNotice(ch);
  const [open, setOpen] = useState(detail);
  const [busy, setBusy] = useState(false);
  if (!peer) return null;
  const words = receiptWords((k, v) => t(k as MessageKey, v), ch);
  const tone = receiptTone(ch);
  const key = receiptKey(ch.receipt.state);
  const at = ch.receipt.confirmedAt ? Date.parse(ch.receipt.confirmedAt) / 1000 : null;
  const canOpen = !!askId && !!peer.hostId && peer.hostId !== hostId;
  const refresh = async () => {
    if (!askId) return;
    setBusy(true);
    try {
      await refreshDelegation(hostId, askId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1 text-caption/[inherit]" data-testid="cross-host-receipt" data-cross-host-state={key} data-cross-host-direction={ch.direction}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Globe size={12} strokeWidth={1.75} className="shrink-0 text-subtle" />
        <span className="shrink-0 text-subtle">{t(ch.direction === "outbound" ? "crossHost.to" : "crossHost.from")}</span>
        <PeerHostName instanceId={ch.peer.instanceId} snapshot={ch.peer.label} className="font-medium text-foreground" />
        {!peer.hostId && <Tag tone="neutral" data-cross-host-offline="">{t("crossHost.notConnected")}</Tag>}
      </div>
      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 text-subtle">{t("crossHost.receiptLabel")}</span>
        <span className={`font-medium ${TEXT[tone]}`} data-cross-host-word="">{words.state}</span>
        {words.reason && <span className={troubled ? TEXT[tone] : "text-muted"} data-cross-host-reason={ch.receipt.reason ?? ""}>· {words.reason}</span>}
        {!detail && (
          <button type="button" className="press flex items-center gap-0.5 rounded-sm text-subtle hover:text-foreground" aria-expanded={open} onClick={() => setOpen(!open)} data-cross-host-more="">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t("crossHost.more")}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5 rounded-md bg-surface-2/60 px-2 py-1 text-subtle" data-cross-host-detail="">
          <span title={at !== null ? formatAbsolute(at) : undefined}>
            {at !== null ? t("crossHost.confirmedAt", { at: formatAt(at, Date.now()) }) : t("crossHost.noProof")}
          </span>
          {key === "unknown" && <span>{t("crossHost.unknownCode", { code: ch.receipt.state })}</span>}
          <span className="selectable font-mono break-all" data-cross-host-instance="">{t("crossHost.instance", { id: ch.peer.instanceId })}</span>
          {ch.peer.label && ch.peer.label !== peer.name && <span>{t("crossHost.snapshot", { label: ch.peer.label })}</span>}
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {canOpen && (
              <button type="button" className="press rounded-sm text-accent hover:underline" onClick={() => openDelegationDetail(peer.hostId!, askId!)} data-cross-host-open="">
                {t("crossHost.openPeer")}
              </button>
            )}
            {askId && (key === "outcomeUnknown" || key === "queuedAtSource" || detail) && (
              <button type="button" className="press rounded-sm text-accent hover:underline disabled:opacity-50" disabled={busy} onClick={() => void refresh()} data-cross-host-refresh="">
                {t("crossHost.refresh")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One line under a cross-host note (留言): the other host and the receipt. Delivered means it reached that host's bus;
 * whether it was read into a turn stays with the note's own state.
 */
export function CrossHostNote({ ch }: { ch: CrossHost }) {
  const { t } = useI18n();
  const peer = usePeerHost(ch.peer.instanceId, ch.peer.label);
  if (!peer) return null;
  const words = receiptWords((k, v) => t(k as MessageKey, v), ch);
  const tone = receiptTone(ch);
  const at = ch.receipt.confirmedAt ? Date.parse(ch.receipt.confirmedAt) / 1000 : null;
  const hover = [words.state, words.reason, at !== null ? t("crossHost.confirmedAt", { at: formatAbsolute(at) }) : t("crossHost.noProof"), t("crossHost.instance", { id: ch.peer.instanceId })].filter(Boolean).join("\n");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption/[inherit] text-subtle" title={hover} data-testid="cross-host-note" data-cross-host-state={receiptKey(ch.receipt.state)}>
      <Globe size={11} strokeWidth={1.75} className="shrink-0" />
      <span className="shrink-0">{t(ch.direction === "outbound" ? "crossHost.to" : "crossHost.from")}</span>
      <PeerHostName instanceId={ch.peer.instanceId} snapshot={ch.peer.label} />
      {!peer.hostId && <span className="shrink-0">· {t("crossHost.notConnected")}</span>}
      {/* On the receiving side the receipt only matters when something is off. */}
      {(ch.direction === "outbound" || receiptNeedsNotice(ch)) && <span className={`shrink-0 ${TEXT[tone]}`} data-cross-host-word="">· {words.reason ?? words.state}</span>}
    </div>
  );
}
