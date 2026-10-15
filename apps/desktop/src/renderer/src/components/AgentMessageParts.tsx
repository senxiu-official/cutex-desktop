// Small pieces of agent messages v2 (lib/agentMessages): the 留言 / 唤醒 tag, the sender's status
// (dot + word: 未读 / 已读入 hh:mm / 失败, never colour alone) and the received envelope's facts.
import { useI18n } from "../i18n";
import type { AgentEnvelope, DeliveryKind } from "../lib/agentMessages";
import { useAgentMessage } from "../lib/agentMessageStore";
import { formatAbsolute } from "../lib/time";

/** 留言 / 唤醒; `downgraded`: a wake the loop guard delivered as a note (shown as 留言 · 已降级).
 *  `wakeHint`: the 唤醒 tooltip when the caller knows better (cutex wake-busy-wait). */
export function KindTag({ kind, downgraded = false, wakeHint }: { kind: DeliveryKind | null; downgraded?: boolean; wakeHint?: string }) {
  const { t } = useI18n();
  if (!kind) return null;
  return (
    <>
      <span className={`shrink-0 rounded px-1.5 py-px text-[10px] whitespace-nowrap ${kind === "wake" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted"}`} title={kind === "wake" ? (wakeHint ?? t("agentMsg.kind.wakeHint")) : t("agentMsg.kind.noteHint")} data-testid="delivery-kind">
        {t(kind === "wake" ? "agentMsg.kind.wake" : "agentMsg.kind.note")}
      </span>
      {downgraded && (
        <span className="shrink-0 text-[10px] whitespace-nowrap text-subtle" title={t("agentMsg.kind.downgradedHint")}>
          {t("agentMsg.kind.downgraded")}
        </span>
      )}
    </>
  );
}

/**
 * The sender's view of one sent message, live by message id: only this element re-renders when
 * its state changes. Before cutex said anything it is 未读 (the send itself was accepted).
 */
export function SentStatus({ messageId }: { messageId: string }) {
  const { t } = useI18n();
  const record = useAgentMessage(messageId);
  const state = record?.state ?? "pending";
  const at = record?.deliveredAt ?? null;
  const label = state === "delivered" ? (at ? t("agentMsg.state.deliveredAt", { time: formatAbsolute(at).slice(11, 16) }) : t("agentMsg.state.delivered")) : state === "failed" ? t("agentMsg.state.failed") : t("agentMsg.state.pending");
  const title = state === "failed" ? (record?.error ?? undefined) : state === "delivered" ? (at ? formatAbsolute(at) : undefined) : t("agentMsg.state.pendingHint");
  const dot = state === "delivered" ? "bg-accent" : state === "failed" ? "bg-danger" : "border border-subtle";
  const text = state === "failed" ? "text-danger" : state === "delivered" ? "text-muted" : "text-subtle";
  return (
    <span className={`flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap ${text}`} title={title} data-testid="sent-status" data-state={state}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** Facts the structured Sender header carries: narrower capabilities, reply-only, truncated body. */
/**
 * `reveal`: classes that hide the plain ACL facts (只能回复, 已截断) until the row is hovered / focused
 * (quiet pass). 权限较窄 is a caution about the sender and always shows.
 */
export function EnvelopeBadges({ envelope, reveal = "" }: { envelope: AgentEnvelope; reveal?: string }) {
  const { t } = useI18n();
  const badge = "shrink-0 rounded border border-border px-1 py-px text-[10px] whitespace-nowrap";
  return (
    <>
      {envelope.narrower && (
        <span className={`${badge} text-warn`} title={t("agentMsg.narrowerHint")}>
          {t("agentMsg.narrower")}
        </span>
      )}
      {envelope.replyOnly && (
        <span className={`${badge} text-muted ${reveal}`} title={t("agentMsg.replyOnlyHint")}>
          {t("agentMsg.replyOnly")}
        </span>
      )}
      {envelope.bodyTruncated && <span className={`${badge} text-subtle ${reveal}`}>{t("agentMsg.truncated")}</span>}
    </>
  );
}
