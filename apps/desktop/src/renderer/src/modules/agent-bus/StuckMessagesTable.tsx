// 待清理 → 卡住的消息 (cutex `agent-bus-stuck-messages`): undelivered bus messages as a compact table —
// what, who → whom, how long it has waited, state, 丢弃 (click twice). A row opens the details: the
// text, the last delivery error, cutex's reasons, warnings (丢弃前先确认对应的作业) and, where cutex
// offers it, 关闭卡住消息. 全部丢弃 (click twice, says how many) leaves out job / control messages, which
// are discarded on their own row. Discarding makes a message terminal in cutex and withdraws it from the
// live queue; it is never redelivered.
import { X } from "lucide-react";
import { ArmedButton } from "../../components/ArmedButton";
import { MessageSettlementControl } from "../../components/MessageSettlementControl";
import type { StuckBusMessage } from "../../../../shared/ipc";
import { EmptyState, ErrorNote, IconButton, Loading, Notice } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useAgentMessage } from "../../lib/agentMessageStore";
import { useTargetHostId } from "../../lib/targetHost";
import { useApp } from "../../store";
import { CleanupTable } from "./CleanupTable";
import { CLEANUP_ACTION, CLEANUP_ACTION_DANGER, cleanupAge, stuckFrom, stuckState } from "./cleanupText";
import { bulkTargets, KNOWN_ERRORS, knownKind, minAgeKey, partyName, protectedCount, refusalText, stuckHints, type StuckHint } from "./stuck";
import type { StuckMessagesState } from "./useStuckMessages";

type T = ReturnType<typeof useI18n>["t"];

function knownError(t: T) {
  return (code: string): string | null => ((KNOWN_ERRORS as readonly string[]).includes(code) ? t(`agent-bus.stuck.error.${code}` as MessageKey) : null);
}

/** 全部丢弃 (the category's header): the armed hint names the count; job / control messages are never in it. */
export function DiscardAllButton({ state }: { state: StuckMessagesState }) {
  const { t } = useI18n();
  const messages = state.view?.messages ?? [];
  if (messages.length === 0) return null;
  const count = bulkTargets(messages).length;
  if (state.bulk) return <span className="text-xs text-subtle">{t("agent-bus.stuck.discardAllProgress", { done: state.bulk.done, total: state.bulk.total })}</span>;
  return (
    <ArmedButton
      shape={`${CLEANUP_ACTION} whitespace-nowrap`}
      idle={CLEANUP_ACTION_DANGER}
      hint={t("agent-bus.stuck.discardAllArmed", { n: count })}
      title={count === 0 ? t("agent-bus.stuck.discardAllNone") : t("agent-bus.stuck.discardAllTitle", { n: count })}
      disabled={count === 0 || state.busy.size > 0}
      resetKey={count}
      testId="stuck-discard-all"
      onConfirm={() => void state.discardEverything()}
    >
      {t("agent-bus.stuck.discardAll")}
    </ArmedButton>
  );
}

export function StuckMessagesTable({ state, minAge }: { state: StuckMessagesState; minAge: number }) {
  const { t } = useI18n();
  const hostId = useTargetHostId();
  const { view } = state;
  if (state.error && !view) return <ErrorNote>{state.error}</ErrorNote>;
  if (!view) return <Loading rows={2} />;
  const { messages } = view;
  const protectedRows = protectedCount(messages);
  const working = state.busy.size > 0 || state.bulk !== null;
  return (
    <>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      <SummaryNotes state={state} />
      {!view.liveQueueAvailable && <Notice>{t("agent-bus.stuck.liveDown", { error: view.liveQueueError ?? "—" })}</Notice>}
      {messages.length === 0 ? (
        <EmptyState>{minAge === 0 ? t("agent-bus.stuck.emptyAll") : t("agent-bus.stuck.empty", { age: t(`agent-bus.stuck.minAge.${minAgeKey(minAge)}` as MessageKey) })}</EmptyState>
      ) : (
        <>
          <CleanupTable
            rows={messages}
            rowKey={(m) => m.messageId}
            testId="stuck-messages"
            foldPrefix="cleanup.stuck"
            cells={(m) => ({
              what: m.contentPreview.trim() || <span className="text-subtle">{t("agent-bus.stuck.noContent")}</span>,
              whatTitle: m.contentPreview || undefined,
              who: `${stuckFrom(m, t)} → ${partyName(m.to) ?? t("agent-bus.stuck.unknownParty")}`,
              whoTitle: [m.from?.id, m.to?.id].filter(Boolean).join(" → ") || undefined,
              age: cleanupAge(m.ageSecs, t),
              state: m.protectedControl ? <span className="text-warn-text">{t("agent-bus.stuck.protected")}</span> : stuckState(m, t),
              // A message with a settlement is closed in its details (关闭卡住消息), never discarded.
              action: m.settlement ? undefined : (
                <ArmedButton
                  shape={`${CLEANUP_ACTION} whitespace-nowrap`}
                  idle={CLEANUP_ACTION_DANGER}
                  hint={t(m.protectedControl ? "agent-bus.cleanup.discardProtectedArmed" : "agent-bus.stuck.discardArmed")}
                  disabled={working}
                  testId="stuck-discard"
                  onConfirm={() => void state.discardOne(m)}
                >
                  {state.busy.has(m.messageId) ? t("agent-bus.cleanup.working") : t("agent-bus.stuck.discard")}
                </ArmedButton>
              ),
            })}
            details={(m) => <MessageDetails message={m} hostId={hostId} onRefresh={state.refresh} />}
          />
          {(view.total > messages.length || protectedRows > 0) && (
            <div className="py-2">
              {view.total > messages.length && <p className="text-xs text-subtle">{t("agent-bus.stuck.truncated", { shown: messages.length, total: view.total })}</p>}
              {protectedRows > 0 && <p className="text-xs text-subtle">{t("agent-bus.stuck.protectedNote", { n: protectedRows })}</p>}
            </div>
          )}
        </>
      )}
    </>
  );
}

function MessageDetails({ message: m, hostId, onRefresh }: { message: StuckBusMessage; hostId: string; onRefresh(): Promise<void> }) {
  const { t } = useI18n();
  // The whole text when this window holds the message (the focus host's bus records); else cutex's first 200 characters.
  const record = useAgentMessage(m.messageId);
  const activeHost = useApp((s) => s.hosts?.active);
  const full = (!activeHost || activeHost === hostId) && record?.body ? record.body : null;
  const text = full ?? m.contentPreview;
  const created = m.createdAtEpochSecs ? new Date(m.createdAtEpochSecs * 1000).toLocaleString() : null;
  const kind = knownKind(m.senderKind);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{text.trim() || t("agent-bus.stuck.noContent")}</p>
      {!full && m.contentPreview.length >= 200 && <p className="text-subtle">{t("agent-bus.cleanup.previewOnly")}</p>}
      {(m.errorCode || m.errorMessage) && (
        <p className="text-danger [overflow-wrap:anywhere]">{t("agent-bus.cleanup.lastError", { error: [m.errorCode, m.errorMessage].filter(Boolean).join(" · ") })}</p>
      )}
      {stuckHints(m).length > 0 && (
        <ul>
          {stuckHints(m).map((hint) => (
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
      <MessageSettlementControl hostId={hostId} messageId={m.messageId} settlement={m.settlement} sessionId={m.to?.id} onRefresh={onRefresh} />
    </div>
  );
}

function hintText(hint: StuckHint, t: T): string {
  return t(`agent-bus.stuck.hint.${hint.key}` as MessageKey, hint.params);
}

/** What the last discard / 全部丢弃 did: refusals and oddities always, the count after 全部丢弃. */
function SummaryNotes({ state }: { state: StuckMessagesState }) {
  const { t } = useI18n();
  const { summary } = state;
  if (!summary) return null;
  const lines: { tone: "info" | "warn" | "error"; text: string }[] = [];
  if (summary.bulk && summary.discarded > 0) lines.push({ tone: "info", text: t("agent-bus.stuck.summary.discarded", { n: summary.discarded }) });
  if (summary.gone > 0) lines.push({ tone: "info", text: t("agent-bus.stuck.summary.gone", { n: summary.gone }) });
  if (summary.liveWarnings > 0) lines.push({ tone: "warn", text: t("agent-bus.stuck.summary.live", { n: summary.liveWarnings }) });
  if (summary.failed.length > 0) {
    const first = summary.failed[0]!;
    lines.push({ tone: "error", text: t("agent-bus.stuck.summary.failed", { n: summary.failed.length, detail: refusalText(first, knownError(t)) }) });
  }
  if (summary.notAttempted > 0) lines.push({ tone: "warn", text: t("agent-bus.stuck.summary.notAttempted", { n: summary.notAttempted }) });
  if (lines.length === 0) return null;
  return (
    <div className="flex items-start gap-2 border-b border-border py-1">
      <div className="min-w-0 flex-1">
        {lines.map((line) =>
          line.tone === "error" ? (
            <ErrorNote key={line.text}>{line.text}</ErrorNote>
          ) : (
            <Notice key={line.text} tone={line.tone}>
              {line.text}
            </Notice>
          ),
        )}
      </div>
      <IconButton label={t("common.close")} onClick={state.dismissSummary}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
