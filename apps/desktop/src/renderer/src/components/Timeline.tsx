import { useAgentPause } from "../lib/agentPause";
import { useAgentPauseHint } from "./AgentPauseParts";
import { viewKey } from "../lib/viewKey";
import type { InputRecord } from "@cutex-desktop/protocol";
import { usesInputLedger, usesOwnerCarries } from "../lib/deliveryMode";
import { showStandaloneDelivery } from "../lib/inputLedger/deliveryPresentation";
import { missingTimelineRecords, placeMissingRecords, strandedNote, timelineRecordIndex, ownerRecordFor, ownerTimelineEntry, ownerOutboxTimelineEntry, predictedOwnerSurface, type LedgerOwnerOutbox } from "../lib/inputLedger/owner";
import { carriedInputs, carriedReceivedRow } from "../lib/inputLedger/carries";
import { placeholderMessage } from "../lib/inputLedger/placeholder";
import { useDelegation } from "../lib/delegationStore";
import { CarriedInputRows } from "./CarriedInputRows";
import { InputStatus } from "./InputStatus";
import { featuresOf } from "../store";
// Timeline rendering shared by the conversation and the read-only sub-agent view: turn headers
// (duration + time), work groups (§4.14), messages incl. compact agent-bus rows (§4.15), and the
// running turn's live line at the end of the stream.
import { MentionText } from "./MentionText";
import { pathTextImages } from "../lib/pathTextImages";
import { useStreamedEntry } from "../lib/streamRender";
import { mentionRichText } from "../lib/mentionWire";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, SearchCheck } from "lucide-react";
import { LOOKUP_PAGES } from "../lib/turnFetch";
import { Checklist, ChecklistEntry, PlanCard } from "./PlanCard";
import { messageImages, messageInputItems, type MessageImage } from "../../../shared/input";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { messageMenu, SESSION_FEATURES } from "../lib/menus";
import { lacks } from "../lib/agentFeatures";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { structuralBlockText, useStructuralBlock } from "../lib/structuralGateView";
import { replyBars, type ReplyBar } from "../lib/replyActions";
import { ReplyActions, UserActions } from "./MessageActions";
import { TurnSummary } from "./TurnSummary";
import { fileChangesByTurn, type TurnChanges } from "../lib/turnSummary";
import { useUiPrefs } from "../lib/prefs";
import { formatAbsolute, formatAt, formatWhen, useClock, useNow } from "../lib/time";
import { orderedEntries, type TimelineEntry, type TimelineState, type TurnView } from "../lib/timeline";
import { segmentEntries } from "../lib/workGroups";
import { pairSentCalls } from "../lib/sentToolPairs";
import { createTimelineWindow, recentEntries } from "../lib/timelineWindow";
import { createTimelineIdentityEntries, createTimelineTurnIndex } from "../lib/timelineEntries";
import { pendingTail, pendingUserEntry, sendRowKey, timelineRowKey, timelineTail, type OutboxEntry } from "../lib/legacyDelivery/outbox";
import { LedgerPendingStatus, SessionDeliveryStatus, PendingStatus } from "./PendingSends";
import type { OlderHistory } from "../lib/historyPages";
import { OlderHistoryRow } from "./OlderHistoryRow";
import { MessageImages } from "./ImageThumbs";
import { ItemMedia } from "./ItemMedia";
import { reasoningPreview } from "../lib/reasoning";
import { liveReasoning, turnActivity } from "../lib/turnActivity";
import { nextProgressAt, silentGapSeconds, turnProgressMark } from "../lib/silentGap";
import { agentState, useApp } from "../store";
import { convNotify, useConvFeatures, useConvHost, useConvScope, useConvView } from "../lib/conversationScope";
import { CodeBlockScope } from "../lib/codeBlockScope";
import { isArchived } from "../lib/archivedAgent";
import { useSenderName, viewRow } from "../lib/viewHost";
import { BusMessage } from "./BusMessage";
import { BusyDots } from "./BusyDots";
import { Markdown } from "./Markdown";
import { ReasoningRow, ToolRow, WorkGroup } from "./WorkGroup";
import { AutoReviewNotice } from "./AutoReview";
import { InteractionRow } from "./InteractionRow";
import { latestReplyIds, type FoldRole } from "../lib/messageFold";
import { useMessageFold, type MessageFold } from "../lib/foldView";
import { Foldable } from "./Foldable";
import { useAgentMessage } from "../lib/agentMessageStore";
import { activeDelegationAsk, askRowTurnOf, delegateEntryOf, handlerReplies, type DelegationAskRow } from "../lib/delegations";
import { clearFocusRequest, flashElement, useFocusRequest } from "../lib/focusRequest";
import { drawRow } from "../lib/farRows";
import { RepliedBadge } from "./DelegationRows";
import { DelegationTag } from "./DelegationParts";
import { OwnerNotifyCard } from "./OwnerNotifyCard";
import { noteNeedsOlderHistory, noteTurnOf, placeOwnerNotes, recordsOf } from "../lib/ownerNotify";
import { OwnerNotificationHistory } from "./OwnerNotificationHistory";
import { useHostOwnerNotes } from "../lib/ownerNotifyStore";
import { OWNER_NOTIFY_FEATURE } from "../../../shared/ownerNotify";
import { ReceivedOutlet } from "../modules/TimelineOutlet";
import { TurnAttachments, TurnMargin } from "../modules/TurnAttachments";
import { TimelineIntro } from "../modules/TimelineIntroView";
import { refActionEntries } from "../lib/refActions";
import { turnRefNow } from "../lib/refServices";
import { TimelineViewContext, useTimelineContext, useTimelineView } from "../modules/timelineItemsView";
import { toolRendererFor } from "../lib/timelineRenderers";
import { ScriptText } from "./ScriptText";
import { turnErrorPlacement, turnInterruptedPlacement } from "../lib/turnErrors";
import { foldAutomaticRetryRows, type AutomaticRetryLink } from "../lib/autoRetryRows";
import { turnRefusedToolSchema } from "../lib/toolSchemaHint";
import { ToolSchemaHint } from "./ToolSchemaHint";
import { retryNoticeText } from "../lib/retryNotice";
import { useActingUser } from "../lib/actingUsers";
import { identityInitials } from "../lib/identity";
import { useUserAvatar } from "../lib/userAvatars";
import { Avatar } from "./Avatar";
import { shownUserName } from "../../../shared/users";
import { useOwnerWindow } from "../lib/ownerContext";
import { useTurnStop } from "../lib/runtimeStops";

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The live elapsed time's width: room for the longest text of its range (「59s」, 「9m 59s」, then 「59m 59s」 / 「9h 59m」). */
function elapsedWidth(seconds: number): string {
  return seconds < 60 ? "3ch" : seconds < 600 ? "6ch" : "7ch";
}

/** A turn's divider: "已工作 1m 30s" once it is over, the time on the right. While it runs the left
 *  stays empty — the live status is the last line of the stream (TurnTail), where new output appears;
 *  the label fills in on the same row when the turn ends, so nothing moves. */
const TurnHeader = memo(TurnHeaderView, (a, b) => sameFields(a.turn, b.turn));
function TurnHeaderView({ turn }: { turn: TurnView }) {
  const { t } = useI18n();
  if (!turn.startedAt) return null;
  const running = turn.status === "inProgress";
  const duration = formatDuration((turn.completedAt ?? turn.startedAt) - turn.startedAt);
  const label = running ? null : turn.status === "interrupted" ? t("conversation.stopped") : turn.status === "failed" ? t("conversation.failed", { duration }) : t("conversation.worked", { duration });
  return (
    <div className="my-2 flex items-baseline border-b border-border pb-1 text-xs text-subtle">
      <span>{label}</span>
      <TurnTime startedAt={turn.startedAt} completedAt={running ? null : turn.completedAt} />
    </div>
  );
}

/** A failed turn's error, after its last row (lib/turnErrors). A typed daemon overload continuation
 *  is linked here; other failures retain their usual owner-directed recovery. A refused tool schema adds the
 *  工具参数严格模式 hint (components/ToolSchemaHint) inside the row, for as long as the error is shown. */
function TurnErrorRow({ turn, retryText, hint, automaticRetry }: { turn: TurnView; retryText: string | null; hint: boolean; automaticRetry?: AutomaticRetryLink }) {
  const { t } = useI18n();
  const { sessionId, hostId } = useTimelineContext();
  return (
    <div role="alert" className="my-2 flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{t("conversation.turnFailed")}</div>
        <div className="selectable whitespace-pre-wrap break-words text-muted">{turn.error}</div>
        {automaticRetry && <div className="mt-1 text-muted" data-testid="overload-retried">{t("conversation.autoRetried", { attempt: automaticRetry.attempt, maxAttempts: automaticRetry.maxAttempts })}</div>}
        {hint && turnRefusedToolSchema(turn) && <ToolSchemaHint hostId={hostId} sessionId={sessionId} retryText={retryText} />}
      </div>
    </div>
  );
}

/** An interrupted turn's end mark, after its last row (lib/turnErrors): a stop or a runtime restart
 *  cut it off, so its last reply may end mid-sentence. On hosts that say who asked for the stop
 *  (lib/runtimeStops) it names them: an agent's command, the agent's own, the owner, the CLI. */
function TurnInterruptedRow({ turn }: { turn: TurnView }) {
  const { t } = useI18n();
  const { sessionId, hostId } = useTimelineContext();
  const stop = useTurnStop(hostId, sessionId, turn);
  return (
    <div data-testid="turn-interrupted" data-stopped-by={stop?.by.kind} className="my-1 text-xs text-subtle">
      {stop?.by.kind === "agent" ? t("conversation.turnStoppedBy.agent", { name: stop.by.name })
        : stop ? t(`conversation.turnStoppedBy.${stop.by.kind}`)
        : t("conversation.turnInterrupted")}
    </div>
  );
}

const NO_ITEMS: string[] = [];

/**
 * The running turn's live line, last in the stream (Claude / ZCode style): busy dots · elapsed · what
 * it is doing now (lib/turnActivity: … 推理中, or 工作中 when nothing tells more) · while reasoning
 * and the reasoning rows aren't open (Settings → 推理过程), a one-line preview of the live text.
 * 16px tall: with the 12px margin under the message above it (its own 6px collapses into that), it
 * takes the space of the reply action bar that replaces it when the turn ends.
 */
export function TurnTail({ timeline, sessionId, thread = "agent" }: { timeline: TimelineState; sessionId: string; thread?: "agent" | "subagent" }) {
  const { t } = useI18n();
  const { reasoningView } = useUiPrefs();
  const { tools, hostId } = useTimelineContext();
  const pause = useAgentPause(hostId, sessionId);
  const pauseHint = useAgentPauseHint(hostId, pause);
  const background = useApp((s) => agentState(s.backgroundItems, hostId, sessionId) ?? NO_ITEMS);
  // The session's delivery state is its own thread's; a sub-agent's live line follows the child timeline.
  const ledgerEnabled = useApp(s => thread === "agent" && usesInputLedger([...featuresOf(s, hostId)]));
  const delivery = useApp(s => ledgerEnabled ? agentState(s.inputs, hostId, sessionId)?.delivery ?? null : null);
  const turnId = ledgerEnabled ? delivery?.turn?.turnId : timeline.activeTurnId;
  const turn = turnId ? timeline.turns.findLast((x) => x.id === turnId) : undefined;
  const now = useNow(!!turn);
  const activity = turnActivity(timeline, background, (item) => toolRendererFor(item, tools)?.item.activity?.(item) ?? null);
  // When the turn last showed progress (lib/silentGap): a mark change restarts the quiet clock.
  const progress = useRef<{ mark: string | null; at: number } | null>(null);
  progress.current = nextProgressAt(progress.current, turnProgressMark(timeline), now);
  // A retrying request says why it is quiet (RetryNoticeLine): no "still working" guess on top.
  const silent = turn?.retry ? null : silentGapSeconds(typeof activity === "string" ? activity : null, progress.current.at, now);
  // cutex's running signal covers every turn kind. Composer keeps the delegation details;
  // a retained lease alone is not a running turn, and its recovery stays in the queue.
  if (pause?.held?.length) return <div className="mt-1.5 flex h-4 min-w-0 items-center gap-2 text-caption text-warn-text" data-testid="turn-working" data-agent-tool-held="" title={pauseHint}>
    <span className="shrink-0" aria-hidden>❚❚</span><span className="truncate">{t("agentPause.workingHeld")}</span>
  </div>;
  if (ledgerEnabled) {
    const running = delivery?.state === "turn";
    if (!running && !showStandaloneDelivery(delivery, false)) return null;
    return <div className="mt-1.5 flex h-4 items-center gap-2" data-testid="turn-working">
      {running ? <><BusyDots /><span className="text-caption text-subtle">{t("turn.activity.working")}</span></>
        : <SessionDeliveryStatus delivery={delivery} sessionId={sessionId} hostId={hostId} />}
    </div>;
  }
  if (!turn || !activity) return null;
  const waiting = activity === "approval" || activity === "question";
  const preview = activity === "reasoning" && reasoningView !== "expanded" ? reasoningPreview(liveReasoning(timeline)) : null;
  // A turn a delegation started: whose delegation this is.
  const handling = activeDelegationAsk(timeline);
  return (
    <>
    <div className="mt-1.5 flex h-4 min-w-0 items-center gap-2 text-xs text-subtle" data-testid="turn-working">
      <BusyDots className="shrink-0" />
      {/* A fixed width (tabular digits): 9s → 10s → 1m 0s no longer pushes the rest of the line sideways every few
          seconds (flicker recorder 2026-10-26); it widens only at one minute and at ten. */}
      {turn.startedAt !== null && <span className="shrink-0 tabular-nums" style={{ minWidth: elapsedWidth(now / 1000 - turn.startedAt) }}>{formatDuration(now / 1000 - turn.startedAt)}</span>}
      <span className="shrink-0">·</span>
      {handling && (
        <>
          <span className="flex shrink-0 items-center gap-1 text-muted">
            {t("delegation.handling", { who: handling.owner ? t("delegation.you") : (handling.requesterName ?? handling.requesterId ?? "") })}
            <DelegationTag askId={handling.askId} />
          </span>
          <span className="shrink-0">·</span>
        </>
      )}
      <span className={`shrink-0 ${waiting ? "text-warn" : "text-muted"}`} data-testid={silent !== null ? "turn-silent-gap" : undefined} title={silent !== null ? t("turn.silentGapHint") : undefined}>
        {silent !== null ? t("turn.silentGap", { n: silent }) : t((activity.includes(".") ? activity : `turn.activity.${activity}`) as MessageKey)}
      </span>
      {preview && (
        <>
          <span className="shrink-0">·</span>
          <span className="min-w-0 truncate" title={preview}>
            {preview}
          </span>
        </>
      )}
    </div>
    {turn.retry && <RetryNoticeLine text={retryNoticeText(turn.retry, t)} />}
    </>
  );
}

/** Native is retrying the model request (lib/retryNotice): a quiet warning under the live line, gone
 *  with the next output or the turn's end. */
function RetryNoticeLine({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div role="status" data-testid="turn-retry-notice" title={t("turn.retry.hint")} className="mt-1 flex h-4 min-w-0 items-center gap-1.5 text-xs text-warn">
      <AlertTriangle size={12} className="shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}

/** Always-visible "12 分钟前" / "11:02" on the right; full timestamps on hover. */
function TurnTime({ startedAt, completedAt }: { startedAt: number; completedAt: number | null }) {
  const { locale } = useI18n();
  const now = useClock();
  const title = completedAt ? `${formatAbsolute(startedAt)} → ${formatAbsolute(completedAt)}` : formatAbsolute(startedAt);
  return (
    <span className="ml-auto shrink-0 tabular-nums" title={title}>
      {formatWhen(completedAt ?? startedAt, now, locale)}
    </span>
  );
}

/**
 * A non-owner ledger record without its native item (not read in yet): the row that item will be, built from the
 * record and its delegation (lib/inputLedger/placeholder), with the record's status under it like the native row.
 */
function LedgerPlaceholderRow({ record, hostId, carried, nameOf, sessionId, readOnly }: { record: InputRecord; hostId: string; carried: boolean; nameOf: (id: string) => string; sessionId: string; readOnly: boolean }) {
  const ask = useDelegation(hostId, record.askId);
  // A new entry per record / ask change: MemoEntry compares the entry, not the ledger record.
  const entry = useMemo<TimelineEntry>(() => ({ kind: "received", id: record.timelineItemId ?? record.inputId, turnId: record.turnId ?? "", message: placeholderMessage(record, ask) }), [record, ask]);
  return <div data-input-id={record.inputId} data-ledger-placeholder={record.kind} data-carried-input-id={carried ? record.inputId : undefined}>
    <MemoEntry entry={entry} ledgerRecord={record} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={false} bar={undefined} dropped={0} foldRole="off" />
  </div>;
}

/** A sent row: the kind cutex reported last (a wake may be downgraded to a note) wins over the event's. */
function SentMessage({ entry, name, onContextMenu }: { entry: Extract<TimelineEntry, { kind: "sent" }>; name: string; onContextMenu: React.MouseEventHandler }) {
  const record = useAgentMessage(entry.messageId ?? null);
  const recipient = useAgentFeatures(entry.to);
  return <BusMessage direction="out" name={name} mode={entry.deliveryMode} text={entry.text} preview={entry.preview ?? null} kind={record?.kind ?? entry.deliveryKind ?? null} downgraded={!!record?.downgraded} messageId={entry.messageId ?? null} recipientId={entry.to || null} recipientRuntime={recipient.runtime} recipientFeatures={recipient.map} onContextMenu={onContextMenu} />;
}

/**
 * users: 「由 X 发送」 under a message a non-owner user sent (cutex routeAccepted `actingUser`), with the
 * name and picture that user set on their own desktop (users-self-profile) when the host has them.
 */
function SentBy({ sessionId, clientId }: { sessionId: string; clientId: string | undefined }) {
  const { t } = useI18n();
  const { hostId } = useTimelineContext();
  const user = useActingUser(hostId, sessionId, clientId);
  const picture = useUserAvatar(hostId, user?.id, user?.avatarEtag);
  if (!user) return null;
  const name = shownUserName(user);
  return (
    <div className="flex items-center gap-1 text-caption/[inherit] text-subtle" data-testid="sent-by" title={user.displayName && user.displayName !== user.name ? user.name : undefined}>
      {(picture || user.avatarEtag) && <Avatar name={name} initial={identityInitials(name)} color="#868e96" picture={picture} size={16} />}
      <span>{t("users.sentBy", { name })}</span>
    </div>
  );
}

/** Shallow equality of two plain objects (or both undefined). */
function sameFields<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a) as (keyof T)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

// Entries are replaced (never mutated) when they change, so a finished entry keeps its identity and
// is skipped on re-render: long histories no longer re-reconcile on every event / clock tick.
/** Under a message whose turn ended before it reached the history: why, and when it was really sent. */
function StrandedNote({ noteKey, sentAt }: { noteKey: "inputLedger.stranded.interrupted" | "inputLedger.stranded.failed" | "inputLedger.stranded.missing"; sentAt: number }) {
  const { t } = useI18n();
  return <div className="-mt-1 mb-2 flex justify-end text-caption text-subtle" data-stranded-note={noteKey} title={formatAbsolute(sentAt)}>
    {t(noteKey)} · {formatAt(sentAt, Date.now())}
  </div>;
}

const MemoEntry = memo(Entry, (a, b) => a.entry === b.entry && a.pending === b.pending && a.nameOf === b.nameOf && a.sessionId === b.sessionId && a.readOnly === b.readOnly && a.actionable === b.actionable && a.dropped === b.dropped && a.foldRole === b.foldRole && sameFields(a.bar, b.bar) && a.changes?.signature === b.changes?.signature && a.reply === b.reply);

/**
 * A live agent reply: its code blocks may carry `timeline.codeBlockAction` items (§22), on the agent's host.
 * Archived agents' history is read-only: no scope there.
 */
function ReplyMarkdown({ sessionId, text, streaming }: { sessionId: string; text: string; streaming: boolean }) {
  const hostId = useConvHost();
  const archived = useApp((s) => isArchived(viewRow(s, hostId, sessionId)));
  const scope = useMemo(() => (archived ? null : { sessionId, hostId }), [archived, sessionId, hostId]);
  return (
    <CodeBlockScope.Provider value={scope}>
      <Markdown text={text} streaming={streaming} />
    </CodeBlockScope.Provider>
  );
}

/** The fold entry of a message's context menu (null: nothing to fold or unfold). */
function foldAction(fold: MessageFold): { folded: boolean; toggle(): void } | null {
  if (fold.overflowing) return { folded: true, toggle: () => fold.setFolded(false) };
  if (fold.canFold) return { folded: false, toggle: () => fold.setFolded(true) };
  return null;
}

function useSentImages(hostId: string, sessionId: string, id: string | null, ledger: boolean): MessageImage[] | undefined {
  const extra = useApp((s) => (!id ? undefined : ledger ? agentState(s.ledgerOwnerDrafts, hostId, sessionId)?.[id]?.extra : agentState(s.outbox, hostId, sessionId)?.find((e) => e.id === id)?.extra));
  return useMemo(() => (extra?.length ? messageImages(extra as { type: string }[]) : undefined), [extra]);
}

function Entry({ entry: initial, ledgerRecord, ledgerRecords, ledgerPending, pending, nameOf, sessionId, readOnly, actionable, bar, dropped, foldRole, changes, reply }: { /** 已回复 (handler side): shown in the reply's action row (design 040 step 10). */ reply?: DelegationAskRow; entry: TimelineEntry; ledgerRecord?: InputRecord; ledgerRecords?: readonly InputRecord[]; ledgerPending?: LedgerOwnerOutbox; /** The user's send not in the thread yet (lib/outbox): the same row, dimmed, with its status line. */ pending?: OutboxEntry; nameOf: (id: string) => string; sessionId: string; readOnly: boolean; actionable: boolean; bar: ReplyBar | undefined; dropped: number; foldRole: FoldRole; /** The finished turn's file changes (turn summary; only with `bar`). */ changes?: TurnChanges }) {
  const entry = useStreamedEntry(sessionId, initial);
  const userDisplay = useMemo(() => {
    if (entry.kind !== "user") return null;
    const displayed = pathTextImages(entry.text);
    return { text: displayed.text, images: [...(entry.images ?? []), ...displayed.images] };
  }, [entry]);
  const { t } = useI18n();
  const fold = useMessageFold(sessionId, entry.id, foldRole);
  // Claude agents without history revert (features.historyRevert = false) get no edit & resend / revert.
  const { agent, hostId } = useTimelineContext();
  // A copy without clientId still matches through its ledger record.
  const sendId = entry.kind === "user" ? ledgerRecord?.inputId ?? ledgerPending?.inputId ?? entry.clientId ?? null : null;
  const sentImages = useSentImages(hostId, sessionId, sendId, !!(ledgerRecord || ledgerPending));
  const canRevert = useConvFeatures().has(SESSION_FEATURES.revert) && !readOnly && !lacks(agent, "historyRevert");
  // A busy Claude agent refuses it (lib/structuralGate): disabled with the reason (the menu checks on open).
  const block = useStructuralBlock(sessionId, agent, "revert");
  // + the modules' `ref.action` items for the turn (§19.8) on the owner's / the agent's messages.
  const menu = (kind: "user" | "agent" | "received" | "sent", text: string, extra?: unknown[]) =>
    contextMenu(() => [
      ...messageMenu({ sessionId, hostId, kind, text, extra, turnId: entry.turnId ?? null, nextTurnId: bar?.nextTurnId ?? null, laterTurns: bar?.laterTurns ?? 0, fold: kind === "user" || kind === "agent" ? foldAction(fold) : null }, t, canRevert),
      ...(!readOnly && entry.turnId && (kind === "user" || kind === "agent") ? refActionEntries(turnRefNow(sessionId, entry.turnId, text), true) : []),
    ]);
  switch (entry.kind) {
    case "user": {
      // A pending send (lib/outbox) is this same row until the native userMessage replaces it under
      // the same key: the bubble keeps its element, its dimming fades out, and the status gives way to
      // the action row — nothing remounts or jumps. Both live in one slot of one height (h-7) under the
      // bubble; the status is laid over it (PendingStatus), so it never sizes the row (owner 2026-10-24:
      // the row grew 4 px when 发送中… went). 「由 X 发送」 shares the slot too (it appears at the handoff).
      const failed = pending?.state === "failed";
      // 编辑并重发 puts its images and skills back with the text (the data URL / host path cutex holds).
      const { text, images } = userDisplay!;
      const extra = images.length || entry.skills ? messageInputItems(images, entry.skills) : undefined;
      return (
        // The action row stands in for the bottom margin (always laid out, faded in on hover).
        <div className="group mt-3 flex flex-col items-end gap-1" data-testid={pending ? (failed ? "outbox-failed" : "outbox-sending") : undefined}>
          {/* A pending send carries its images too (lib/outbox pendingUserEntry): the same element at the handoff. */}
          {!!images.length && <MessageImages images={images} hostId={hostId} messageId={sendId ?? entry.id} pending={!!pending} sent={sentImages} />}
          {text && (
            <div
              onContextMenu={pending || ledgerPending ? undefined : menu("user", mentionRichText(hostId, sessionId, text), extra)}
              className={`selectable message-body max-w-[75%] rounded-2xl border bg-bubble px-4 py-2 text-[length:var(--chat-font-size,14px)] font-chat-context whitespace-pre-wrap transition-[opacity,border-color] duration-200 [font-family:var(--font-chat,var(--font-sans))] motion-reduce:transition-none ${failed ? "border-danger/60" : "border-border"} ${(pending || ledgerPending) && !failed ? "opacity-80" : ""}`}
              data-send-bubble=""
            >
              <Foldable fold={fold} stickyLeft><MentionText text={text} hostId={hostId} sessionId={sessionId} /></Foldable>
            </div>
          )}
          {ledgerPending || (ledgerRecord && ledgerRecord.state !== "inContext") || pending || ((text || extra) && !readOnly) ? (
            <div className="relative flex h-7 w-full items-center justify-end gap-2" data-user-slot="">
              {!pending && <SentBy sessionId={sessionId} clientId={entry.clientId} />}
              {ledgerPending ? <LedgerPendingStatus entry={ledgerPending} sessionId={sessionId} hostId={hostId} readOnly={readOnly} /> : ledgerRecord && ledgerRecord.state !== "inContext" ? <InputStatus record={ledgerRecord} sessionId={sessionId} hostId={hostId} readOnly={readOnly} timeline /> : pending ? <PendingStatus sessionId={sessionId} entry={pending} /> : <UserActions sessionId={sessionId} text={mentionRichText(hostId, sessionId, text)} extra={extra} turnId={entry.turnId ?? null} dropped={dropped} canRevert={canRevert} blocked={block ? structuralBlockText(block) : null} fold={fold} />}
            </div>
          ) : (
            <>
              <SentBy sessionId={sessionId} clientId={entry.clientId} />
              <div className="h-2" />
            </>
          )}
        </div>
      );
    }
    case "review":
      return entry.phase === "entered" ? (
        <div className="my-2 flex items-center gap-1.5 text-xs text-muted">
          <SearchCheck size={13} className="shrink-0 text-accent" />
          <span className="shrink-0">{t("review.started")}</span>
          <span className="min-w-0 truncate text-subtle"><ScriptText text={entry.text} /></span>
        </div>
      ) : (
        <div className="my-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-subtle">
            <SearchCheck size={13} className="text-accent" />
            {t("review.result")}
          </div>
          <Markdown text={entry.text || t("review.empty")} streaming={false} />
        </div>
      );
    case "agent":
      return (
        <div className={bar ? "group mt-3" : "my-3"} onContextMenu={menu("agent", entry.text)}>
          <Foldable fold={fold} className="text-[length:var(--chat-font-size,14px)] leading-relaxed">
            {readOnly ? <Markdown text={entry.text} streaming={entry.streaming} /> : <ReplyMarkdown sessionId={sessionId} text={entry.text} streaming={entry.streaming} />}
          </Foldable>
          {bar && !readOnly && <TurnSummary sessionId={sessionId} turnId={bar.turnId} text={bar.text} changes={changes} latest={bar.latest} />}
          {bar && !readOnly && <TurnAttachments sessionId={sessionId} turnId={bar.turnId} />}
          {bar && <ReplyActions sessionId={sessionId} bar={bar} readOnly={readOnly} fold={fold} status={reply ? <RepliedBadge row={reply} inline /> : null} />}
        </div>
      );
    // Agent-to-agent messages stay left; only the user's own messages go right. A received input
    // renders by its view schema (lib/receivedRows); whatever no branch claims is a bus message.
    case "received":
      return <><ReceivedOutlet message={entry.message} sessionId={sessionId} readOnly={readOnly}
        fallback={<BusMessage direction="in" name={entry.message.senderName} senderId={entry.message.senderId} sourceKind={entry.message.sourceKind} mode={entry.message.deliveryMode} text={entry.message.text} kind={entry.message.envelope?.kind ?? null} envelope={entry.message.envelope ?? null} recipientRuntime={agent.runtime} recipientFeatures={agent.map} onContextMenu={menu("received", entry.message.text)} />} />{(ledgerRecords ?? (ledgerRecord ? [ledgerRecord] : [])).map(record => <span key={record.inputId} title={record.preview ?? record.inputId}><InputStatus record={record} sessionId={sessionId} hostId={hostId} readOnly={readOnly} timeline /></span>)}</>;
    case "sent":
      return <SentMessage entry={entry} name={nameOf(entry.to)} onContextMenu={menu("sent", entry.text)} />;
    case "tool":
      return <ToolRow item={entry.item} sessionId={sessionId} />;
    case "plan":
      return <PlanCard sessionId={sessionId} text={entry.text} streaming={entry.streaming} actionable={actionable && !readOnly} />;
    case "reasoning":
      return <ReasoningRow entry={entry} />;
    case "interaction":
      return <InteractionRow record={entry.record} />;
    case "checklist":
      // Sub-agent views (readOnly) have no status capsule: keep the full list there.
      return readOnly ? <Checklist explanation={entry.explanation} steps={entry.steps} /> : <ChecklistEntry explanation={entry.explanation} steps={entry.steps} />;
    case "notice":
      return entry.media ? <p role="status" className="my-1 text-xs text-subtle" data-media-notice>{entry.text}</p> : <AutoReviewNotice review={entry.review} text={entry.text} />;
    case "other":
      return <ItemMedia item={entry.item} hostId={hostId} />;
  }
}


/**
 * Turns, work groups and messages of one thread. Shared by the conversation and the read-only
 * sub-agent view (`readOnly`: no edit & resend, no reply affordances).
 */
export function TimelineBody({ timeline, entries: suppliedEntries, version, sessionId, nameOf, thread = "agent", readOnly = false, ownerNotes = !readOnly, older = null, onLoadOlder, pendingSends = false, onRelease }: { timeline: TimelineState; entries?: TimelineEntry[]; version?: number; sessionId: string; nameOf: (id: string) => string; /** Whose thread `timeline` is. "subagent": a child thread shown under its parent's sessionId (host, runtime, tools); the session's own inputs (input ledger, owner sends, owner-notify cards, delivery turn) belong to the parent thread and are never projected into it. */ thread?: "agent" | "subagent"; readOnly?: boolean; /** The agent's owner-notify cards (default: not in read-only views). The side agent view is read-only for row actions but keeps them: a card is where the owner answers the agent. */ ownerNotes?: boolean; /** History pages still on the host (lib/historyPages). */ older?: OlderHistory | null; onLoadOlder?: () => void; /** Show the user's sends not in the thread yet (lib/outbox placement "turn"): placed by timelineTail, never below the live line, keyed like the message that replaces them. */ pendingSends?: boolean; /** Let go of stick-to-bottom (a focus request scrolls up to a turn). */ onRelease?: () => void }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const convHost = useConvHost();
  const conv = useConvScope();
  const { reasoningView, timelineTurns, timelineInteractions } = useUiPrefs();
  // Host, agent features and renderers once per timeline, shared by every row (TimelineViewContext).
  const view = useTimelineView(sessionId);
  const tools = view.tools;
  // owner-notify: the agent's messages to the owner, placed among its turns (not in sub-agent views;
  // the side agent view keeps them).
  const features = useConvFeatures();
  const agentThread = thread === "agent";
  const ownerNotify = agentThread && ownerNotes && features.has(OWNER_NOTIFY_FEATURE);
  const notesById = useHostOwnerNotes(view.hostId);
  const notes = useMemo(() => (ownerNotify ? recordsOf(notesById, sessionId) : []), [ownerNotify, notesById, sessionId]);
  // Long histories render only the latest turns (Settings → 通用 → 长对话); 显示更早 adds more.
  // Pages fetched by scrolling to the top are shown at once (the window grows by them).
  const [limit, setLimit] = useState(timelineTurns);
  useEffect(() => setLimit(timelineTurns), [sessionId, timelineTurns]);
  // Select turns before flattening; only changed visible turns need entry reads.
  // The store mutates timeline in place, so callers supply their view revision.
  const shownTurns = limit > 0 ? limit + (older?.added ?? 0) : limit;
  const turnCount = timeline.turns.length;
  const activeTurn = timeline.activeTurnId;
  const selectWindow = useMemo(() => createTimelineWindow(), [sessionId]);
  const window = useMemo(() => selectWindow(timeline, shownTurns),
    [selectWindow, timeline, version, suppliedEntries, turnCount, activeTurn, shownTurns]);
  const { entries: recent, hiddenTurns } = useMemo(() => suppliedEntries
    ? recentEntries(suppliedEntries, timeline.turns, shownTurns) : window,
    [suppliedEntries, timeline.turns, shownTurns, window]);
  const visibleTurns = window.turns;
  const indexTurns = useMemo(() => createTimelineTurnIndex(), [sessionId]);
  const loadedTurns = useMemo(() => indexTurns(timeline.turns), [indexTurns, timeline.turns, turnCount]);
  const retryVisible = features.has("model-overload-retry-visible");
  // A sent message and the tool call that sent it are one row (lib/sentToolPairs).
  const { entries, retried, folded } = useMemo(() => foldAutomaticRetryRows(pairSentCalls(recent), visibleTurns, retryVisible),
    [recent, visibleTurns, version, turnCount, activeTurn, retryVisible]);
  const derived = useMemo(() => ({
    turnOf: new Map(visibleTurns.map((turn) => [turn.id, turn])),
    bars: replyBars(visibleTurns, entries),
    latestReply: latestReplyIds(entries),
    // Handler side: the final reply of a turn a delegation started gets the 已回复 badge.
    replied: handlerReplies(entries, visibleTurns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [entries, visibleTurns, version, turnCount, activeTurn]);
  const { turnOf, bars, latestReply, replied } = derived;
  const droppedFrom = (turnId: string) => {
    const index = visibleTurns.findIndex(turn => turn.id === turnId);
    return index < 0 ? 0 : visibleTurns.length - index;
  };
  // Turn summary: each turn's completed fileChange items, merged per file.
  const turnChanges = useMemo(() => fileChangesByTurn(recent), [recent]);
  // focusTurn / focusDelegation (lib/focusRequest): widen the window to the target, then scroll + flash.
  const request = useFocusRequest((s) => (!readOnly && s.request?.sessionId === sessionId && (!s.request.hostId || s.request.hostId === view.hostId) ? s.request : null));
  // A safety decision must not depend on a native history anchor. Reveal the same card here
  // when its turn/DOM target cannot be reached; all decisions still go to the notice's host.
  const [revealedSafety, setRevealedSafety] = useState<{ hostId: string; sessionId: string; notificationId: string } | null>(null);
  const revealedSafetyId = revealedSafety?.hostId === view.hostId && revealedSafety.sessionId === sessionId ? revealedSafety.notificationId : null;
  const loading = useConvView(sessionId, (v) => v?.loading ?? false);
  // The session view's failed load gates the opening too (below); TimelineBody's own error row is Conversation's.
  const failed = useConvView(sessionId, (v) => !!v?.error);
  // Older pages this focus request has fetched (a target before every loaded turn pages history in).
  const paged = useRef({ nonce: 0, pages: 0 });
  useEffect(() => {
    if (!request || loading) return;
    const note = request.notificationId ? notesById[request.notificationId] : undefined;
    const revealed = !!request.notificationId && request.notificationId === revealedSafetyId;
    const miss = (key: MessageKey) => {
      if (note?.safetyBlock && !revealed) {
        setRevealedSafety({ hostId: view.hostId, sessionId, notificationId: note.notificationId });
        return; // the next render lands on the decision without another history read
      }
      clearFocusRequest(request.nonce);
      if (request.onDone) request.onDone(false);
      else convNotify(conv, t(key));
    };
    let turnId = request.turnId ?? null;
    if (request.notificationId) turnId = note ? noteTurnOf(note, timeline.turns) : null;
    // A delegation: its card here (requester), else the turn its ASK row started (handler).
    // Full history is expanded only for an explicit delegation focus lookup.
    const lookupEntries = request.askId ? suppliedEntries ?? orderedEntries(timeline) : [];
    const card = request.askId ? delegateEntryOf(lookupEntries, request.askId) : null;
    if (request.askId) turnId = card?.turnId ?? askRowTurnOf(lookupEntries, request.askId);
    const index = turnId ? timeline.turns.findIndex((x) => x.id === turnId) : -1;
    // A message older than every loaded turn: page its turn in first while there is older history
    // (an open agent's pending notice from many turns ago, composer 等你回复 row); fully loaded, it sits
    // at the top (no turn to widen to).
    const noteOlder = !!note && noteNeedsOlderHistory(note, timeline.turns, !!older?.cursor && !older.error && !!onLoadOlder);
    if (!revealed && note?.safetyBlock && noteOlder) return miss("ownerNotify.notLoaded");
    if (!revealed && index < 0 && (!(request.notificationId && note) || noteOlder)) {
      // Not among the loaded turns: page older history in (≤ LOOKUP_PAGES per request, like 跳过去) and
      // look again once the page lands; a thread fully loaded (no cursor) or a failed page is a miss.
      if ((!request.notificationId || noteOlder) && older?.cursor && !older.error && onLoadOlder) {
        if (older.loading) return;
        if (paged.current.nonce !== request.nonce) paged.current = { nonce: request.nonce, pages: 0 };
        if (paged.current.pages < LOOKUP_PAGES) {
          paged.current.pages++;
          onLoadOlder();
          return;
        }
      }
      return miss(request.askId ? "delegation.cardNotFound" : request.notificationId ? "ownerNotify.notLoaded" : "delegation.notLoaded");
    }
    const needed = revealed || index < 0 ? 0 : timeline.turns.length - index;
    const shown = limit > 0 ? limit + (older?.added ?? 0) : Infinity;
    if (needed > shown) {
      setLimit(needed - (older?.added ?? 0));
      return; // runs again once the turn is rendered
    }
    const selector = request.notificationId
      ? `[data-owner-note="${CSS.escape(request.notificationId)}"][data-owner-note-host="${CSS.escape(view.hostId)}"]`
      : card
        ? `[data-ask-id="${CSS.escape(request.askId!)}"]`
        : request.askId
          ? `[data-ask-row="${CSS.escape(request.askId)}"]`
          : `[data-turn-id="${CSS.escape(turnId!)}"]`;
    const frame = win.requestAnimationFrame(() => {
      const el = win.document.querySelector(selector);
      if (!el) return miss(request.askId ? "delegation.cardNotFound" : request.notificationId ? "ownerNotify.notLoaded" : "delegation.notLoaded");
      clearFocusRequest(request.nonce);
      onRelease?.();
      if (request.land) {
        drawRow(el);
        request.land(el);
      } else flashElement(el);
      // An owner note: keyboard focus on its 回复 (else the card) so Enter / Space answers it.
      if (request.notificationId && !request.land) (el.querySelector<HTMLElement>("[data-note-reply]") ?? (el as HTMLElement)).focus?.({ preventScroll: true });
      request.onDone?.(true);
    });
    return () => win.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, loading, limit, suppliedEntries, version, timeline.turns.length, notesById, older?.cursor, older?.loading, older?.error, revealedSafetyId]);
  // Every turn's first rendered row carries its id (TurnHeader is not always rendered).
  const anchored = new Set<string>();
  const anchor = (turnId: string | null | undefined): string | undefined => {
    if (!turnId || anchored.has(turnId)) return undefined;
    anchored.add(turnId);
    return turnId;
  };
  const foldRoleOf = (e: TimelineEntry): FoldRole =>
    e.kind === "user" ? "user" : e.kind === "agent" && !e.streaming ? (latestReply.has(e.id) ? "latest" : "older") : "off";
  // "Working N s" header goes after a turn's inputs (user / received messages), before its work.
  const headed = new Set<string>();
  // The latest proposed plan gets "implement" actions once its turn is over and nothing followed it
  // (TUI: the "Implement this plan?" prompt after a Plan-mode turn).
  const actionablePlan = useMemo(() => {
    if (activeTurn) return null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.kind === "plan") return e.id;
      if (e.kind === "user" || e.kind === "received") break;
    }
    return null;
  }, [entries, activeTurn]);
  const reasoningShown = reasoningView !== "hidden";
  const segments = useMemo(
    () => segmentEntries(entries, { reasoning: reasoningShown, interactions: timelineInteractions, standalone: (item) => !!toolRendererFor(item, tools)?.item.standalone?.(item) }),
    [entries, reasoningShown, timelineInteractions, tools],
  );
  const olderHistory = hiddenTurns > 0 || !!older?.cursor;
  // An explicitly bound hidden note must not fall back to its creation time in the visible
  // window. This metadata-only check changes on paging/window changes, not streamed text.
  const notesForWindow = useMemo(() => {
    if (!hiddenTurns || !notes.length) return notes;
    const visible = new Set(window.turns.map(turn => turn.id));
    return notes.filter(note => !note.turnId || visible.has(note.turnId) || !loadedTurns.has(note.turnId));
  }, [loadedTurns, notes, timeline.turns, turnCount, hiddenTurns]);
  // timeline.turnAttachment (§19.3) inline items go at the end of a turn: inside a finished turn's last
  // reply (after its turn summary, before its action row), else after the turn's last rendered row.
  const segTurn = (seg: (typeof segments)[number]) => (seg.kind === "work" ? seg.turnId : seg.entry.turnId);
  const placement = useMemo(() => {
    const segTurns = segments.map(segTurn);
    const lastSegOf = new Map<string, number>();
    segTurns.forEach((turnId, i) => {
      if (turnId) lastSegOf.set(turnId, i);
    });
    return {
      placed: notes.length ? placeOwnerNotes(segTurns.length ? notesForWindow : notes, segTurns, visibleTurns, { olderHistory }) : { head: [], after: new Map() },
      turnErrors: turnErrorPlacement(segTurns, visibleTurns),
      turnStops: turnInterruptedPlacement(segTurns, visibleTurns),
      lastSegOf,
      barTurns: new Set([...bars.values()].map((b) => b.turnId)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, notes, notesForWindow, visibleTurns, version, turnCount, activeTurn, olderHistory, bars]);
  const { placed, turnErrors, turnStops, lastSegOf, barTurns } = placement;
  const tailAttachments = (i: number) => {
    const turnId = segTurn(segments[i]!);
    return turnId && !readOnly && lastSegOf.get(turnId) === i && !barTurns.has(turnId) ? <TurnAttachments sessionId={sessionId} turnId={turnId} /> : null;
  };
  const turnUserText = (turn: TurnView) => {
    for (const id of turn.entryIds) {
      const entry = timeline.entries.get(id);
      if (entry?.kind === "user" && entry.text.trim()) return mentionRichText(convHost, sessionId, entry.text);
    }
    return null;
  };
  const errorRows = (i: number) => [
    ...(turnErrors.get(i)?.map((turn) => <TurnErrorRow key={`error-${turn.id}`} turn={turn} hint={!readOnly} retryText={turnUserText(turn)} automaticRetry={retried.get(turn.id)} />) ?? []),
    ...(turnStops.get(i)?.map((turn) => <TurnInterruptedRow key={`stopped-${turn.id}`} turn={turn} />) ?? []),
  ];
  const noteCards = (list: readonly { notificationId: string }[] | undefined) => list?.filter(r => r.notificationId !== revealedSafetyId).map((r) => <OwnerNotifyCard key={r.notificationId} notificationId={r.notificationId} sessionId={sessionId} hostId={view.hostId} />);
  // The user's pending sends: same row component and key (lib/outbox sendRowKey) as the timeline's
  // user message that replaces them, in the same flat list, so the handoff is a prop change.
  const outbox = useApp((s) => (agentThread && pendingSends ? agentState(s.outbox, view.hostId, sessionId) : undefined));
  const ledgerEnabled = agentThread && usesInputLedger([...features]);
  const ledger = useApp(s => ledgerEnabled ? agentState(s.inputs, view.hostId, sessionId) : undefined);
  const ownerDrafts = useApp(s => ledgerEnabled ? agentState(s.ledgerOwnerDrafts, view.hostId, sessionId) : undefined);
  const ledgerOutbox = useApp(s => ledgerEnabled ? agentState(s.ledgerOutbox, view.hostId, sessionId) : undefined);
  const ledgerIndex = useMemo(() => timelineRecordIndex(ledger?.records), [ledger?.records]);
  const identityEntries = useMemo(() => createTimelineIdentityEntries(), [sessionId]);
  // Match native identities even in hidden history, without flattening it.
  const ledgerEntries = useMemo(() => suppliedEntries ?? identityEntries(timeline, [
    ...[...ledgerIndex.byInputId.values()].flatMap(record => [record.inputId, record.timelineItemId ?? ""]),
    ...Object.keys(ownerDrafts ?? {}),
    ...(ledgerOutbox ?? []).map(entry => entry.inputId),
  ], loadedTurns), [identityEntries, suppliedEntries, timeline, version, ledgerIndex, ownerDrafts, ledgerOutbox, recent, loadedTurns]);
  const ledgerRows = useMemo(() => ledgerEnabled ? missingTimelineRecords(ledger?.records, ledgerEntries, ledgerIndex, { hasOlder: !!older?.cursor, turns: timeline.turns, hasTurn: id => loadedTurns.has(id), loading }) : [],
    [ledgerEnabled, ledger?.records, ledgerEntries, ledgerIndex, older?.cursor, timeline.turns, turnCount, loadedTurns, loading]);
  const carries = useMemo(() => {
    const joined = carriedInputs(ledger?.records, usesOwnerCarries([...features]));
    const visibleOwners = new Set(ledgerRows.filter(r => r.kind === "owner").map(r => r.inputId));
    for (const seg of segments) if (seg.kind !== "work" && seg.entry.kind === "user" && !folded.has(seg.entry.id)) {
      const owner = ownerRecordFor(ledger?.records, seg.entry, ledgerIndex);
      if (owner) visibleOwners.add(owner.inputId);
    }
    const byOwner = new Map([...joined.byOwner].filter(([id]) => visibleOwners.has(id)));
    return { byOwner, inputIds: new Set([...byOwner.values()].flatMap(rows => rows.map(r => r.inputId))) };
  }, [ledger?.records, features, ledgerRows, segments, ledgerIndex, folded]);
  // Records without their native item (owner 2026-11-10): only those still on their way stay at the bottom; the
  // rest go inline at their turn (or send time), never below the divider for good.
  const missingPlaced = useMemo(() => {
    const visibleIds = new Set(visibleTurns.map(turn => turn.id));
    const firstShown = visibleTurns[0]?.startedAt;
    const hidden = (record: InputRecord) => record.turnId && loadedTurns.has(record.turnId) ? !visibleIds.has(record.turnId)
      : olderHistory && firstShown != null && Date.parse(record.createdAt) < firstShown * 1000;
    return placeMissingRecords(ledgerRows.filter(record => !carries.inputIds.has(record.inputId)), segments.map(segTurn), visibleTurns, hidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerRows, carries, segments, visibleTurns, loadedTurns, olderHistory, turnCount]);
  const receivedEntries = useMemo(() => {
    const native = new Map(ledgerEntries.filter(entry => carriedReceivedRow(entry, ledgerIndex, carries.inputIds)).map(entry => [entry.id, entry]));
    const claimed = new Set<string>();
    const byOwner = new Map<string, Map<string, TimelineEntry>>();
    for (const [ownerId, children] of carries.byOwner) {
      const entries = new Map<string, TimelineEntry>();
      for (const child of children) {
        const id = child.timelineItemId ?? child.inputId;
        const entry = native.get(id);
        if (entry && !claimed.has(id)) { entries.set(id, entry); claimed.add(id); }
      }
      byOwner.set(ownerId, entries);
    }
    return byOwner;
  }, [ledgerEntries, ledgerIndex, carries]);
  // A non-owner ledger record without a native row: drawn as that row will be, with its status.
  const ledgerInputRow = (record: InputRecord) => <LedgerPlaceholderRow record={record} hostId={view.hostId} carried={carries.inputIds.has(record.inputId)} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} />;
  // A record without its native item, inline or at the bottom: same key as the native row that may replace it.
  const missingRow = (record: InputRecord) => {
    const note = strandedNote(record, visibleTurns);
    return <Fragment key={sendRowKey(record.inputId)}><div data-turn-id={undefined} data-tl-row="" data-missing-input={record.inputId}>
      {false}{undefined}
      {record.kind === "owner" ? <MemoEntry entry={ownerTimelineEntry(record, ownerDrafts?.[record.inputId])} ledgerRecord={record} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={false} bar={undefined} dropped={0} foldRole="user" /> : ledgerInputRow(record)}
      {note && <StrandedNote noteKey={note.key} sentAt={note.sentAt} />}
      {record.kind === "owner" && carriedRows(record.inputId)}
    </div></Fragment>;
  };
  const carriedRows = (ownerId: string | undefined) => ownerId && carries.byOwner.has(ownerId)
    ? <CarriedInputRows records={carries.byOwner.get(ownerId)!} received={receivedEntries.get(ownerId)!} renderRecord={ledgerInputRow} renderReceived={(entry, records) => <>
      <MemoEntry entry={entry} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={false} bar={undefined} dropped={0} foldRole={foldRoleOf(entry)} />
      {records.map(record => <span key={record.inputId} title={record.preview ?? record.inputId} data-carried-input-id={record.inputId}><InputStatus record={record} sessionId={sessionId} hostId={view.hostId} readOnly={readOnly} timeline /></span>)}
    </>} /> : null;
  // Native items now own the full body/attachments. Do not keep a second unbounded history in local drafts.
  useEffect(() => {
    if (!ledgerEnabled || !ownerDrafts) return;
    const joined = new Set(ledgerEntries.flatMap(entry => {
      const record = ownerRecordFor(ledger?.records, entry, ledgerIndex);
      return [record?.inputId, entry.kind === "user" ? entry.clientId : undefined].filter((id): id is string => !!id && !!ownerDrafts[id]);
    }));
    if (!joined.size) return;
    useApp.setState(state => {
      const key = viewKey(view.hostId, sessionId);
      const drafts = state.ledgerOwnerDrafts[key];
      if (!drafts || ![...joined].some(id => drafts[id])) return state;
      const next = { ...drafts };
      for (const id of joined) delete next[id];
      return { ledgerOwnerDrafts: { ...state.ledgerOwnerDrafts, [key]: next } };
    });
  }, [ledgerEnabled, ownerDrafts, ledgerEntries, ledger?.records, ledgerIndex, sessionId, view.hostId]);
  const pendingRows = agentThread && pendingSends && !ledgerEnabled ? pendingTail(outbox, timeline) : [];
  const o0 = ledgerEnabled ? (ledgerOutbox ?? []).filter(entry => !ledger?.records.has(entry.inputId)) : [];
  const nativeOwnerIds = new Set(ledgerEntries.flatMap(entry => entry.kind === "user" ? [entry.id, entry.clientId ?? ""] : []));
  const pendingLedgerRows = o0.filter(entry => predictedOwnerSurface(entry, ledger?.delivery) === "timeline" && !nativeOwnerIds.has(entry.inputId));
  const usedKeys = new Set<string>();
  const rowKeyOf = (entry: TimelineEntry) => {
    const record = ledgerEnabled ? ownerRecordFor(ledger?.records, entry, ledgerIndex) : undefined;
    const pending = entry.kind === "user" ? o0.find(item => item.inputId === entry.clientId || item.inputId === entry.id) : undefined;
    const key = record ? sendRowKey(record.inputId) : pending ? sendRowKey(pending.inputId) : timelineRowKey(entry);
    // Never two rows under one key (a clientId seen twice keeps its later rows by id).
    const unique = usedKeys.has(key) ? entry.id : key;
    usedKeys.add(unique);
    return unique;
  };
  return (
    <TimelineViewContext.Provider value={view}>
      {/* timeline.intro (§19.3): the session's opening, only while its start is on screen — never
          while the first page is loading / failed (it would appear, then vanish when history lands). */}
      {!readOnly && <TimelineIntro sessionId={sessionId} hiddenTurns={hiddenTurns} olderCursor={older?.cursor ?? null} loading={loading} failed={failed} />}
      {hiddenTurns > 0 && (
        <button onClick={() => setLimit((n) => n + timelineTurns)} className="mx-auto my-2 block rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground">
          {t("conversation.showEarlier", { n: hiddenTurns })}
        </button>
      )}
      {hiddenTurns === 0 && older?.cursor && onLoadOlder && <OlderHistoryRow older={older} onLoad={onLoadOlder} />}
      {ownerNotify && <OwnerNotificationHistory hostId={view.hostId} agentId={sessionId} />}
      {revealedSafetyId && <OwnerNotifyCard notificationId={revealedSafetyId} sessionId={sessionId} hostId={view.hostId} />}
      {noteCards(placed.head)}
      {[...segments.flatMap((seg, i) => [...(missingPlaced.before.get(i)?.map(missingRow) ?? []), (() => {
        const after = placed.after.get(i);
        if (seg.kind === "work") {
          let header: TurnView | undefined;
          if (!headed.has(seg.turnId)) {
            headed.add(seg.turnId);
            header = turnOf.get(seg.turnId);
          }
          const first = anchor(seg.turnId);
          return (
            <Fragment key={seg.id}>
              <div data-turn-id={first} data-tl-row="">
                {first && !readOnly && <TurnMargin sessionId={sessionId} turnId={first} />}
                {header && <TurnHeader turn={header} />}
                <WorkGroup sessionId={sessionId} steps={seg.steps} open={seg.open} summary={seg.summary} />
              </div>
              {tailAttachments(i)}
              {errorRows(i)}
              {noteCards(after)}
            </Fragment>
          );
        }
        const entry = seg.entry;
        const isInput = entry.kind === "user" || entry.kind === "received";
        let header: TurnView | undefined;
        if (!isInput && entry.turnId && !headed.has(entry.turnId)) {
          headed.add(entry.turnId);
          header = turnOf.get(entry.turnId);
        }
        const reply = replied.get(entry.id);
        // A final reply with its action row carries the 已回复 line in that row (design 040 step 10).
        const inBar = entry.kind === "agent" && bars.has(entry.id);
        const first = anchor(entry.turnId);
        return (
          <Fragment key={rowKeyOf(entry)}>
            {!folded.has(entry.id) && !carriedReceivedRow(entry, ledgerIndex, carries.inputIds) && <div data-turn-id={first} data-tl-row="">
              {/* timeline.turnAttachment (§19.3): margin boxes beside the turn's first line, inline ones at the turn's end. */}
              {first && !readOnly && <TurnMargin sessionId={sessionId} turnId={first} />}
              {header && <TurnHeader turn={header} />}
              <MemoEntry entry={entry} ledgerRecords={ledgerEnabled && entry.kind === "received" ? (carries.inputIds.size ? ledgerIndex.byItemId.get(entry.id)?.filter(record => !carries.inputIds.has(record.inputId)) : ledgerIndex.byItemId.get(entry.id)) : undefined} ledgerRecord={ledgerEnabled ? ownerRecordFor(ledger?.records, entry, ledgerIndex) : undefined} ledgerPending={ledgerEnabled && entry.kind === "user" ? o0.find(item => item.inputId === entry.clientId || item.inputId === entry.id) : undefined} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={entry.id === actionablePlan} bar={bars.get(entry.id)} dropped={entry.kind === "user" ? droppedFrom(entry.turnId) : 0} foldRole={foldRoleOf(entry)} changes={bars.has(entry.id) ? turnChanges.get(entry.turnId ?? "") : undefined} reply={inBar ? reply : undefined} />
              {entry.kind === "user" && carriedRows(ownerRecordFor(ledger?.records, entry, ledgerIndex)?.inputId)}
              {reply && !inBar && <RepliedBadge row={reply} />}
            </div>}
            {tailAttachments(i)}
            {errorRows(i)}
            {noteCards(after)}
          </Fragment>
        );
      })()]),
      ...missingPlaced.end.map(missingRow),
      ...pendingLedgerRows.map(entry => <Fragment key={sendRowKey(entry.inputId)}><div data-turn-id={undefined} data-tl-row="">
        {false}{undefined}
        <MemoEntry entry={ownerOutboxTimelineEntry(entry)} ledgerPending={entry} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={false} bar={undefined} dropped={0} foldRole="user" />
        {undefined}
      </div></Fragment>),
      ...missingPlaced.trailing.map(missingRow),
      ...timelineTail(ledgerEnabled ? ledger?.delivery?.turn?.turnId ?? null : timeline.activeTurnId, headed).flatMap((slot) => {
        if (slot === "pending")
          return pendingRows.flatMap((p) => {
            const key = sendRowKey(p.id);
            if (usedKeys.has(key)) return [];
            usedKeys.add(key);
            // Same element structure as a message segment above (Fragment > div > slots > MemoEntry).
            return [
              <Fragment key={key}>
                <div data-turn-id={undefined} data-tl-row="">
                  {false}
                  {undefined}
                  <MemoEntry entry={pendingUserEntry(p)} pending={p} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={false} bar={undefined} dropped={0} foldRole="user" />
                  {undefined}
                </div>
              </Fragment>,
            ];
          });
        const active = turnOf.get(timeline.activeTurnId ?? "");
        if (slot === "header") return active ? [<TurnHeader key="header" turn={active} />] : [];
        return [<TurnTail key="tail" timeline={timeline} sessionId={sessionId} thread={thread} />];
      })]}

    </TimelineViewContext.Provider>
  );
}

// The conversation measures its overlays and its room while the Shelf opens; those state changes do
// not describe the timeline. Stable callbacks keep this shallow compare intact for those passes.
export const MemoTimelineBody = memo(TimelineBody);
