// 待清理 → 卡住的消息 (cutex `agent-bus-stuck-messages`): undelivered bus messages as a compact table —
// what, who → whom, how long it has waited, state, 丢弃 (click twice). A row opens the details: the
// text, the last delivery error, cutex's reasons, warnings (丢弃前先确认对应的作业) and the ways out
// (MessageDetails: 确认已结束并关闭 where cutex has evidence, 结束跟进 always). 全部丢弃 (click twice, says how
// many) leaves out job / control messages, which are discarded on their own row. Discarding makes a durable
// message terminal in cutex and withdraws it from the live queue; it is never redelivered. A live-only message's
// button says 从队列撤下, with （可能被再次排入） on a host that does not remember withdrawn ones (L2 / N9).
import { X } from "lucide-react";
import { ArmedButton } from "../../components/ArmedButton";
import type { StuckBusMessage } from "../../../../shared/ipc";
import { EmptyState, ErrorNote, IconButton, Loading, Notice } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { useTargetHostId } from "../../lib/targetHost";
import { CleanupTable } from "./CleanupTable";
import { CLEANUP_ACTION, CLEANUP_ACTION_DANGER, cleanupAge, stuckFrom, stuckState } from "./cleanupText";
import { endedOn, endFollowUpKey, useEndFollowUps } from "./endFollowUp";
import { MessageDetails } from "./MessageDetails";
import { bulkTargets, discardWords, KNOWN_ERRORS, minAgeKey, partyName, protectedCount, refusalText } from "./stuck";
import { useMessageEndFollowUp } from "./useEndFollowUp";
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
  const tombstone = useMessageEndFollowUp(hostId);
  const endEntries = useEndFollowUps((s) => s.entries);
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
              state:
                endEntries[endFollowUpKey(hostId, m.messageId)]?.phase === "ended" ? (
                  <span className="text-muted" data-tip={t("followUp.confirm")}>{t("followUp.endedMessage")}</span>
                ) : m.protectedControl ? (
                  <span className="text-warn-text">{t("agent-bus.stuck.protected")}</span>
                ) : (
                  stuckState(m, t)
                ),
              // A message with a settlement is closed in its details (确认已结束并关闭 / 结束跟进), never discarded.
              action: m.settlement ? undefined : <DiscardButton m={m} tombstone={tombstone} working={working} state={state} />,
            })}
            details={(m) => <MessageDetails message={m} hostId={hostId} onRefresh={state.refresh} />}
          />
          <EndedNotes hostId={hostId} listed={new Set(messages.map((m) => m.messageId))} />
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

function DiscardButton({ m, tombstone, working, state }: { m: StuckBusMessage; tombstone: boolean; working: boolean; state: StuckMessagesState }) {
  const { t } = useI18n();
  const words = discardWords(m, tombstone);
  return (
    <span data-tip={words.tip ? t(words.tip) : undefined}>
      <ArmedButton shape={`${CLEANUP_ACTION} whitespace-nowrap`} idle={CLEANUP_ACTION_DANGER} hint={t(words.armed)} disabled={working} testId="stuck-discard" onConfirm={() => void state.discardOne(m)}>
        {state.busy.has(m.messageId) ? t("agent-bus.cleanup.working") : t(words.label)}
      </ArmedButton>
    </span>
  );
}

/** Messages whose follow-up ended here this session: they leave the stuck list, this says what became of them. */
function EndedNotes({ hostId, listed }: { hostId: string; listed: ReadonlySet<string> }) {
  const { t } = useI18n();
  const entries = useEndFollowUps((s) => s.entries);
  const ended = endedOn(entries, hostId).filter((e) => !listed.has(e.messageId));
  if (ended.length === 0) return null;
  return (
    <div className="py-2 text-xs" data-testid="stuck-ended">
      <p className="text-subtle">{t("agent-bus.stuck.ended")}</p>
      <ul>
        {ended.map((e) => (
          <li key={e.messageId} className="flex min-w-0 gap-2" data-tip={t("followUp.confirm")}>
            <span className="min-w-0 truncate text-muted">{e.preview.trim() || e.messageId}</span>
            <span className="shrink-0 text-subtle">{t("followUp.endedMessage")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
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
