// A stuck message's details on the cleanup page (待清理 → 卡住的消息): the text, the last delivery error, hints,
// cutex's reasons, and the two ways out side by side (state surfaces WP-D5, S9 / N8): 「确认已结束并关闭」 (the
// evidence-backed close, ./EvidenceClose, when cutex has runtime evidence) and 「结束跟进」 (no
// evidence needed; host feature agent-bus-owner-end-followup-v1, greyed with the reason on an older host). When cutex
// says the recipient is gone (runtime_gone, N6) the details say so and point at 结束跟进. After 结束跟进 the message
// reads 已结束跟进 · 送达未确认.
import { ArmedButton } from "../../components/ArmedButton";
import type { StuckBusMessage } from "../../../../shared/ipc";
import { RUNTIME_GONE } from "../../../../shared/ownerDispositions";
import { useI18n, type MessageKey } from "../../i18n";
import { useAgentMessage } from "../../lib/agentMessageStore";
import { settlementWriteKey, useSettlementWrites } from "../../lib/messageSettlementWrites";
import { useTargetApi } from "../../lib/targetHost";
import { useApp } from "../../store";
import { CLEANUP_ACTION, CLEANUP_ACTION_IDLE, stuckFrom } from "./cleanupText";
import { EvidenceClose } from "./EvidenceClose";
import { endFollowUpKey, endMessageFollowUp, useEndFollowUps } from "./endFollowUp";
import { useFollowUpEnded, useMessageEndFollowUp } from "./useEndFollowUp";
import { knownKind, partyName, stuckHints, type StuckHint } from "./stuck";

type T = ReturnType<typeof useI18n>["t"];

/** cutex answered the evidence read / close with runtime_gone (the recipient was archived or deleted). */
function useRuntimeGone(hostId: string, messageId: string): boolean {
  const error = useSettlementWrites((s) => s.entries[settlementWriteKey(hostId, messageId)]?.error) as string | undefined;
  return error === "runtimeGone" || error === RUNTIME_GONE;
}

export function EndFollowUpButton({ message: m, hostId, onRefresh }: { message: StuckBusMessage; hostId: string; onRefresh(): Promise<void> }) {
  const { t } = useI18n();
  const supported = useMessageEndFollowUp(hostId);
  const api = useTargetApi();
  const entry = useEndFollowUps((s) => s.entries[endFollowUpKey(hostId, m.messageId)]);
  const pending = entry?.phase === "pending";
  const button = (
    <ArmedButton
      shape={`${CLEANUP_ACTION} whitespace-nowrap`}
      idle={CLEANUP_ACTION_IDLE}
      hint={t("followUp.confirmButton")}
      disabled={!supported || pending}
      testId="stuck-end-follow-up"
      onConfirm={() => void endMessageFollowUp(api, hostId, m).then(() => onRefresh().catch(() => {}))}
    >
      {pending ? t("followUp.ending") : t("followUp.end")}
    </ArmedButton>
  );
  // A greyed button says why (an older host); a disabled button gets no hover of its own.
  return <span data-tip={t(supported ? "followUp.confirm" : "followUp.oldHost")}>{button}</span>;
}

/** What the last 结束跟进 left to say: a refusal, or an outcome not known yet. */
function EndFollowUpNote({ hostId, messageId }: { hostId: string; messageId: string }) {
  const { t } = useI18n();
  const entry = useEndFollowUps((s) => s.entries[endFollowUpKey(hostId, messageId)]);
  if (!entry) return null;
  if (entry.phase === "uncertain") return <p className="text-warn-text" role="status">{t("agent-bus.stuck.endUncertain")}</p>;
  if (entry.phase !== "error") return null;
  const text =
    entry.error === "conflict" ? t("followUp.actionConflict")
    : entry.error === "unsupported" ? t("followUp.oldHost")
    : entry.error === "gone" ? t("agent-bus.stuck.endGone")
    : t("agent-bus.stuck.endFailed", { error: entry.message ?? "" });
  return <p className={entry.error === "gone" ? "text-subtle" : "text-danger"} role="alert">{text}</p>;
}

export function MessageDetails({ message: m, hostId, onRefresh }: { message: StuckBusMessage; hostId: string; onRefresh(): Promise<void> }) {
  const { t } = useI18n();
  // The whole text when this window holds the message (the focus host's bus records); else cutex's first 200 characters.
  const record = useAgentMessage(m.messageId);
  const activeHost = useApp((s) => s.hosts?.active);
  const tombstone = useMessageEndFollowUp(hostId);
  const ended = useFollowUpEnded(hostId, m.messageId);
  const gone = useRuntimeGone(hostId, m.messageId);
  const full = (!activeHost || activeHost === hostId) && record?.body ? record.body : null;
  const text = full ?? m.contentPreview;
  const created = m.createdAtEpochSecs ? new Date(m.createdAtEpochSecs * 1000).toLocaleString() : null;
  const kind = knownKind(m.senderKind);
  const hints = stuckHints(m, tombstone);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{text.trim() || t("agent-bus.stuck.noContent")}</p>
      {!full && m.contentPreview.length >= 200 && <p className="text-subtle">{t("agent-bus.cleanup.previewOnly")}</p>}
      {(m.errorCode || m.errorMessage) && (
        <p className="text-danger [overflow-wrap:anywhere]">{t("agent-bus.cleanup.lastError", { error: [m.errorCode, m.errorMessage].filter(Boolean).join(" · ") })}</p>
      )}
      {hints.length > 0 && (
        <ul>
          {hints.map((hint) => (
            <li key={hint.key} className={hint.key === "protected" ? "text-warn-text" : "text-subtle"}>
              {hintText(hint, t)}
            </li>
          ))}
        </ul>
      )}
      {m.reasons.length > 0 && (
        <ul className="text-subtle" lang="en">
          {m.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <p className="text-subtle [overflow-wrap:anywhere]">
        {[stuckFrom(m, t), m.from?.id].filter(Boolean).join(" · ")} → {[partyName(m.to), m.to?.id].filter(Boolean).join(" · ")}
        {kind ? ` · ${t(`agent-bus.stuck.kind.${kind}` as MessageKey)}` : m.senderKind ? ` · ${m.senderKind}` : ""}
        {created ? ` · ${created}` : ""} · {m.messageId}
      </p>
      {gone && !ended && <p className="text-warn-text" role="status" data-testid="stuck-runtime-gone">{t("agent-bus.settlement.runtimeGone")}</p>}
      {ended ? (
        <p className="text-muted" data-testid="stuck-follow-up-ended" data-tip={t("followUp.confirm")}>
          {t("followUp.endedMessage")}
        </p>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="stuck-message-actions">
          <EvidenceClose hostId={hostId} messageId={m.messageId} settlement={m.settlement} sessionId={m.to?.id} onRefresh={onRefresh} />
          <EndFollowUpButton message={m} hostId={hostId} onRefresh={onRefresh} />
        </div>
      )}
      <EndFollowUpNote hostId={hostId} messageId={m.messageId} />
    </div>
  );
}

function hintText(hint: StuckHint, t: T): string {
  return t(`agent-bus.stuck.hint.${hint.key}` as MessageKey, hint.params);
}
