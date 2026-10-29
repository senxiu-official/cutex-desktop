// 待读留言 (agent-messages-v2): the queue tray section of messages other agents sent to this agent
// that it has not read in yet (lib/agentMessages pendingMessagesFor). A note is read at the agent's
// next step / next turn; a wake to a busy agent waits for the turn to end (cutex wake-busy-wait: a
// Codex agent waits at most agentBus.wakeBusyWaitSecs, then reads it at its next step; the row says
// which; a wake cutex already fixed to after the turn (system alarms) or to the next step says
// that instead, lib/agentMessages `timing`). A row leaves when it is read in (messageDelivered, or its external_event item shows up in
// the timeline). Failures seen live stay, marked 失败, until dismissed. 唤醒 (owner): start a turn on
// the idle agent so it reads its pending notes in. A note from an agent on another host (peers
// cross-host tell, `remote`) shows its `name@host` sender with a small 另一台主机 tag; on cutex older than
// 0.1.5 (no `remote`) the `ptell-` row's sender label gives both (lib/agentMessages peerSenderOf).
import type { AgentRuntime } from "../lib/agentFeatures";
import { MessageSettlementControl } from "./MessageSettlementControl";
import { useState } from "react";
import { CancelSendButton } from "./CancelSendButton";
import { HiddenUndo } from "./HiddenUndo";
import { matchCancelable, useCancelableSends, type CancelSend } from "../lib/cancelSend";
import { hiddenKey, useHiddenRows, visibleRows } from "../lib/hiddenRows";
import { ArrowDownLeft } from "lucide-react";
import { useI18n } from "../i18n";
import { peerSenderOf, wakeableNotes, type AgentMessageRecord } from "../lib/agentMessages";
import { useAgentMessages } from "../lib/agentMessageStore";
import { useApp } from "../store";
import { convNotify, convSidebarOf, useConvScope, useConvViewHost } from "../lib/conversationScope";
import { rowsOf } from "../lib/viewHost";
import { MESSAGES_WAKE_METHOD } from "../../../shared/ipc";
import { senderLabel } from "../lib/systemSenders";
import { SenderAvatar } from "./SystemAvatar";
import { KindTag } from "./AgentMessageParts";
import { pendingWakeLabel, wakeHintOf, type PendingWakeLabel } from "../lib/wakeBusyWait";
import { useWakeBusyWait } from "../lib/wakeBusyWaitView";
import { Tag } from "./Tag";

function wakeTexts(t: ReturnType<typeof useI18n>["t"], label: PendingWakeLabel): { text: string; hint?: string } {
  const hint = wakeHintOf(label);
  const hintText = hint.n === undefined ? t(hint.key) : t(hint.key, { n: hint.n });
  if (label.key === "busyWait") return { text: t("agentMsg.pending.busyWait", { n: label.secs }), hint: hintText };
  if (label.key === "nextStep") return { text: t("agentMsg.pending.nextStep"), hint: hintText };
  return { text: t("agentMsg.pending.afterTurn") };
}

/** The row's label: cutex's own timing when it decided already (alarms: after the turn), else the section's. */
function rowLabel(message: AgentMessageRecord, section: PendingWakeLabel): PendingWakeLabel {
  if (message.timing === "afterTurn") return { key: "afterTurn" };
  if (message.timing === "nextStep") return { key: "nextStep" };
  return section;
}

function MessageRow({ message, busy, label, cancel, ranSince, hostId }: { message: AgentMessageRecord; busy: boolean; label: PendingWakeLabel; cancel: CancelSend; ranSince: boolean; hostId: string }) {
  const { t } = useI18n();
  const wake = wakeTexts(t, rowLabel(message, label));
  const conv = useConvScope();
  const agentName = useApp((s) => message.senderName ?? rowsOf(s.sidebar, convSidebarOf(conv, s)).find((r) => r.cutexSessionId === message.from)?.displayName ?? message.from ?? "?");
  const peer = peerSenderOf(message);
  const name = peer ? peer.label : senderLabel(t, message.from, message.sourceKind, agentName);
  const failed = message.state === "failed";
  // 取消发送: cutex still holds it (pending / stale_held); one already in the inbox has no button (cutex refuses it).
  const target = !failed ? matchCancelable(cancel.list, { fromId: message.from, from: message.senderName, text: message.body }) : null;
  // 清除: it lingers although the agent ran a turn since it was sent — hide it on this desktop only.
  const lingering = !message.settlement && !failed && !target && ranSince;
  return (
    <div className="min-w-0">
      <div className={`flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 text-xs ${failed ? "bg-danger/5" : ""}`} title={message.body} data-testid="pending-message" data-state={message.state}>
        <ArrowDownLeft size={13} className="shrink-0 text-accent" />
        <span className="shrink-0 text-muted">{t("conversation.from")}</span>
        <SenderAvatar id={message.from} sourceKind={peer ? null : message.sourceKind} name={name} size={16} />
        <span className="min-w-0 max-w-[16em] shrink-0 truncate whitespace-nowrap font-medium" title={name}>{name}</span>
        {peer && (
          <Tag title={t("agentMsg.remoteHint", { host: peer.host })} data-testid="pending-message-remote">
            {t("agentMsg.remote")}
          </Tag>
        )}
        <KindTag kind={message.kind} wakeHint={wake.hint} />
        <span className="min-w-0 flex-1 truncate text-subtle">{message.body.replace(/\s+/g, " ")}</span>
        {message.settlement?.state === "outcome_unknown" ? <span className="text-warn-text">{t("agent-bus.settlement.unknown")}</span> : failed ? (
          <>
            <span className="flex shrink-0 items-center gap-1 text-caption/[inherit] text-danger" title={message.error ?? undefined}>
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
              {t("agentMsg.state.failed")}
            </span>
            <button onClick={() => useAgentMessages.getState().dismiss(message.messageId)} title={t("agentMsg.pending.dismiss")} className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:text-danger">
              ✕
            </button>
          </>
        ) : (
          message.kind === "wake" && busy && <span className="shrink-0 text-caption/[inherit] text-subtle">{wake.text}</span>
        )}
        {!message.settlement && target && <CancelSendButton onCancel={() => cancel.cancel(target)} />}
        {lingering && (
          <button onClick={() => useHiddenRows.getState().hide([hiddenKey("note", hostId, message.messageId)], `notes:${hostId}`)} title={t("hide.noteHint")} className="shrink-0 rounded-md px-1.5 py-0.5 text-caption/[inherit] text-muted hover:text-foreground" data-testid="clear-note">
            {t("hide.note")}
          </button>
        )}
      </div>
      <MessageSettlementControl hostId={hostId} messageId={message.messageId} settlement={message.settlement} sessionId={message.to ?? undefined} />
    </div>
  );
}

/** `runtime`: the agent's runtime (lib/agentFeatures); Claude agents always wait for the turn end. */
export function PendingMessagesSection({ sessionId, messages: all, busy, runtime = "codex", readSince = null }: { sessionId: string; messages: AgentMessageRecord[]; busy: boolean; runtime?: AgentRuntime; readSince?: number | null }) {
  const { t } = useI18n();
  const [waking, setWaking] = useState(false);
  const conv = useConvScope();
  const hostId = useConvViewHost(sessionId);
  const hidden = useHiddenRows((s) => s.keys);
  const last = useHiddenRows((s) => s.last);
  const messages = visibleRows(all, (m) => hiddenKey("note", hostId, m.messageId), hidden);
  const cancel = useCancelableSends(hostId, sessionId, all.length > 0);
  const busyWait = useWakeBusyWait(messages.some((m) => m.kind === "wake"));
  const label = pendingWakeLabel(busyWait.supported, runtime, busyWait.wait);
  const notes = wakeableNotes(messages);
  const wake = async () => {
    setWaking(true);
    try {
      await useApp.getState().sessionAction(sessionId, MESSAGES_WAKE_METHOD, {}, hostId);
    } catch (e) {
      convNotify(conv, t("agentMsg.wakeFailed", { error: e instanceof Error ? e.message : String(e) }), "error");
    } finally {
      setWaking(false);
    }
  };
  return (
    <div data-testid="pending-messages">
      <div className="flex h-6 items-center gap-2 px-2 text-caption/[inherit] text-subtle">
        <span className="flex-1" title={t("agentMsg.pending.titleHint")}>
          {t("agentMsg.pending.title", { n: messages.length })}
        </span>
        {!busy && notes > 0 && (
          <button onClick={() => void wake()} disabled={waking} title={t("agentMsg.wakeHint")} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:text-accent disabled:opacity-50" data-testid="wake-notes">
            {t("agentMsg.wake")}
          </button>
        )}
      </div>
      {messages.map((m) => (
        <MessageRow key={m.messageId} message={m} busy={busy} label={label} cancel={cancel} hostId={hostId} ranSince={readSince !== null && m.sentAt !== null && m.state === "pending" && readSince > m.sentAt} />
      ))}
      {last?.scope === `notes:${hostId}` && <HiddenUndo scope={last.scope} n={last.keys.length} />}
    </div>
  );
}
