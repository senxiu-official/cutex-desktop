// Timeline rendering shared by the conversation and the read-only sub-agent view: turn headers
// (duration + time), work groups (§4.14), messages incl. compact agent-bus rows (§4.15), and the
// running turn's live line at the end of the stream.
import { createPortal } from "react-dom";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Image as ImageIcon, SearchCheck } from "lucide-react";
import { LOOKUP_PAGES } from "../lib/turnFetch";
import { Checklist, ChecklistEntry, PlanCard } from "./PlanCard";
import type { MessageImage } from "../../../shared/input";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { messageMenu, SESSION_FEATURES } from "../lib/menus";
import { lacks } from "../lib/agentFeatures";
import { useAgentFeatures } from "../lib/agentFeaturesView";
import { structuralBlockText, useStructuralBlock } from "../lib/structuralGateView";
import { replyBars, turnsFrom, type ReplyBar } from "../lib/replyActions";
import { ReplyActions, UserActions } from "./MessageActions";
import { TurnSummary } from "./TurnSummary";
import { fileChangesByTurn, type TurnChanges } from "../lib/turnSummary";
import { useUiPrefs } from "../lib/prefs";
import { formatAbsolute, formatWhen, useClock, useNow } from "../lib/time";
import type { TimelineEntry, TimelineState, TurnView } from "../lib/timeline";
import { segmentEntries } from "../lib/workGroups";
import { recentEntries } from "../lib/timelineWindow";
import { pendingTail, pendingUserEntry, sendRowKey, timelineRowKey, timelineTail, type OutboxEntry } from "../lib/outbox";
import { PendingStatus } from "./PendingSends";
import type { OlderHistory } from "../lib/historyPages";
import { OlderHistoryRow } from "./OlderHistoryRow";
import { reasoningPreview } from "../lib/reasoning";
import { liveReasoning, turnActivity } from "../lib/turnActivity";
import { nextProgressAt, silentGapSeconds, turnProgressMark } from "../lib/silentGap";
import { agentHost, selectedFeatures, useApp } from "../store";
import { CodeBlockScope } from "../lib/codeBlockScope";
import { isArchived } from "../lib/archivedAgent";
import { viewRow } from "../lib/viewHost";
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
import { activeDelegationAsk, askRowTurnOf, delegateEntryOf, handlerReplies } from "../lib/delegations";
import { clearFocusRequest, flashElement, useFocusRequest } from "../lib/focusRequest";
import { RepliedBadge } from "./DelegationRows";
import { DelegationTag } from "./DelegationParts";
import { OwnerNotifyCard } from "./OwnerNotifyCard";
import { noteNeedsOlderHistory, noteTurnOf, placeOwnerNotes, recordsOf } from "../lib/ownerNotify";
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
import { retryNoticeText } from "../lib/retryNotice";
import { useActingUser } from "../lib/actingUsers";
import { identityInitials } from "../lib/identity";
import { useUserAvatar } from "../lib/userAvatars";
import { Avatar } from "./Avatar";
import { shownUserName } from "../../../shared/users";

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
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

/** A failed turn's error, after its last row (lib/turnErrors). The input is not retried by the
 *  runtime: the owner sends it again (or a new instruction). */
function TurnErrorRow({ turn }: { turn: TurnView }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="my-2 flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{t("conversation.turnFailed")}</div>
        <div className="whitespace-pre-wrap break-words text-muted">{turn.error}</div>
      </div>
    </div>
  );
}

/** An interrupted turn's end mark, after its last row (lib/turnErrors): a stop or a runtime restart
 *  cut it off, so its last reply may end mid-sentence. */
function TurnInterruptedRow() {
  const { t } = useI18n();
  return (
    <div data-testid="turn-interrupted" className="my-1 text-xs text-subtle">
      {t("conversation.turnInterrupted")}
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
function TurnTail({ timeline, sessionId }: { timeline: TimelineState; sessionId: string }) {
  const { t } = useI18n();
  const { reasoningView } = useUiPrefs();
  const background = useApp((s) => s.backgroundItems[sessionId] ?? NO_ITEMS);
  const turn = timeline.turns.find((x) => x.id === timeline.activeTurnId);
  const now = useNow(!!turn);
  const { tools } = useTimelineContext();
  const activity = turnActivity(timeline, background, (item) => toolRendererFor(item, tools)?.item.activity?.(item) ?? null);
  // When the turn last showed progress (lib/silentGap): a mark change restarts the quiet clock.
  const progress = useRef<{ mark: string | null; at: number } | null>(null);
  progress.current = nextProgressAt(progress.current, turnProgressMark(timeline), now);
  // A retrying request says why it is quiet (RetryNoticeLine): no "still working" guess on top.
  const silent = turn?.retry ? null : silentGapSeconds(typeof activity === "string" ? activity : null, progress.current.at, now);
  if (!turn?.startedAt || !activity) return null;
  const waiting = activity === "approval" || activity === "question";
  const preview = activity === "reasoning" && reasoningView !== "expanded" ? reasoningPreview(liveReasoning(timeline)) : null;
  // A turn a delegation started: whose delegation this is.
  const handling = activeDelegationAsk(timeline);
  return (
    <>
    <div className="mt-1.5 flex h-4 min-w-0 items-center gap-2 text-xs text-subtle">
      <BusyDots className="shrink-0" />
      <span className="shrink-0 tabular-nums">{formatDuration(now / 1000 - turn.startedAt)}</span>
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

/** A sent row: the kind cutex reported last (a wake may be downgraded to a note) wins over the event's. */
function SentMessage({ entry, name, onContextMenu }: { entry: Extract<TimelineEntry, { kind: "sent" }>; name: string; onContextMenu: React.MouseEventHandler }) {
  const record = useAgentMessage(entry.messageId ?? null);
  const recipient = useAgentFeatures(entry.to);
  return <BusMessage direction="out" name={name} mode={entry.deliveryMode} text={entry.text} kind={record?.kind ?? entry.deliveryKind ?? null} downgraded={!!record?.downgraded} messageId={entry.messageId ?? null} recipientRuntime={recipient.runtime} onContextMenu={onContextMenu} />;
}

/** Image parts of a user message: thumbnails (click → full size); local paths as file chips. */
function MessageImages({ images }: { images: MessageImage[] }) {
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  return (
    <div className="flex max-w-[75%] flex-wrap justify-end gap-1.5">
      {images.map((img, i) =>
        img.kind === "url" ? (
          <button key={i} onClick={() => setZoom(img.url)} className="overflow-hidden rounded-xl border border-border">
            <img src={img.url} alt="" className="max-h-40 max-w-60 object-cover" />
          </button>
        ) : (
          <span key={i} className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-muted" title={img.path}>
            <ImageIcon size={12} />
            {img.path.split(/[\\/]/).pop()}
          </span>
        ),
      )}
      {/* Portaled: inside the conversation column a `fixed` overlay is boxed by it, and the right side pane cut the image off. */}
      {zoom &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setZoom(null)} data-testid="message-image-zoom">
            <img src={zoom} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
          </div>,
          document.body,
        )}
    </div>
  );
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
    <div className="flex items-center gap-1 text-[11px] text-subtle" data-testid="sent-by" title={user.displayName && user.displayName !== user.name ? user.name : undefined}>
      {(picture || user.avatarEtag) && <Avatar name={name} initial={identityInitials(name)} color="#868e96" picture={picture} size={14} />}
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
const MemoEntry = memo(Entry, (a, b) => a.entry === b.entry && a.pending === b.pending && a.nameOf === b.nameOf && a.sessionId === b.sessionId && a.readOnly === b.readOnly && a.actionable === b.actionable && a.dropped === b.dropped && a.foldRole === b.foldRole && sameFields(a.bar, b.bar) && a.changes?.signature === b.changes?.signature);

/**
 * A live agent reply: its code blocks may carry `timeline.codeBlockAction` items (§22), on the agent's host.
 * Archived agents' history is read-only: no scope there.
 */
function ReplyMarkdown({ sessionId, text, streaming }: { sessionId: string; text: string; streaming: boolean }) {
  const hostId = useApp(agentHost);
  const archived = useApp((s) => isArchived(viewRow(s, sessionId)));
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

function Entry({ entry, pending, nameOf, sessionId, readOnly, actionable, bar, dropped, foldRole, changes }: { entry: TimelineEntry; /** The user's send not in the thread yet (lib/outbox): the same row, dimmed, with its status line. */ pending?: OutboxEntry; nameOf: (id: string) => string; sessionId: string; readOnly: boolean; actionable: boolean; bar: ReplyBar | undefined; dropped: number; foldRole: FoldRole; /** The finished turn's file changes (turn summary; only with `bar`). */ changes?: TurnChanges }) {
  const { t } = useI18n();
  const fold = useMessageFold(sessionId, entry.id, foldRole);
  // Claude agents without history revert (features.historyRevert = false) get no edit & resend / revert.
  const { agent } = useTimelineContext();
  const canRevert = useApp((s) => selectedFeatures(s).has(SESSION_FEATURES.revert)) && !readOnly && !lacks(agent, "historyRevert");
  // A busy Claude agent refuses it (lib/structuralGate): disabled with the reason (the menu checks on open).
  const block = useStructuralBlock(sessionId, agent);
  // + the modules' `ref.action` items for the turn (§19.8) on the owner's / the agent's messages.
  const menu = (kind: "user" | "agent" | "received" | "sent", text: string) =>
    contextMenu(() => [
      ...messageMenu({ sessionId, kind, text, turnId: entry.turnId ?? null, nextTurnId: bar?.nextTurnId ?? null, laterTurns: bar?.laterTurns ?? 0, fold: kind === "user" || kind === "agent" ? foldAction(fold) : null }, t, canRevert),
      ...(!readOnly && entry.turnId && (kind === "user" || kind === "agent") ? refActionEntries(turnRefNow(sessionId, entry.turnId, text), true) : []),
    ]);
  switch (entry.kind) {
    case "user": {
      // A pending send (lib/outbox) is this same row until the native userMessage replaces it under
      // the same key: the bubble keeps its element, its dimming fades out, and the status line gives
      // way to the action row of the same height — nothing remounts or jumps.
      const failed = pending?.state === "failed";
      return (
        // The action row stands in for the bottom margin (always laid out, faded in on hover).
        <div className="group mt-3 flex flex-col items-end gap-1" data-testid={pending ? (failed ? "outbox-failed" : "outbox-sending") : undefined}>
          {/* A pending send carries its images too (lib/outbox pendingUserEntry): the same element at the handoff. */}
          {entry.images && <MessageImages images={entry.images} />}
          {entry.text && (
            <div
              onContextMenu={pending ? undefined : menu("user", entry.text)}
              className={`max-w-[75%] rounded-2xl border bg-bubble px-4 py-2 text-[length:var(--chat-font-size,14px)] font-chat-context whitespace-pre-wrap transition-[opacity,border-color] duration-200 [font-family:var(--font-chat,var(--font-sans))] motion-reduce:transition-none ${failed ? "border-danger/60" : "border-border"} ${pending && !failed ? "opacity-80" : ""}`}
              data-send-bubble=""
            >
              <Foldable fold={fold} stickyLeft><ScriptText text={entry.text} /></Foldable>
            </div>
          )}
          {pending ? null : <SentBy sessionId={sessionId} clientId={entry.clientId} />}
          {pending ? <PendingStatus sessionId={sessionId} entry={pending} /> : entry.text && !readOnly ? <UserActions sessionId={sessionId} text={entry.text} turnId={entry.turnId ?? null} dropped={dropped} canRevert={canRevert} blocked={block ? structuralBlockText(block) : null} fold={fold} /> : <div className="h-2" />}
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
          {bar && <ReplyActions sessionId={sessionId} bar={bar} readOnly={readOnly} fold={fold} />}
        </div>
      );
    // Agent-to-agent messages stay left; only the user's own messages go right. A received input
    // renders by its view schema (lib/receivedRows); whatever no branch claims is a bus message.
    case "received":
      return <ReceivedOutlet message={entry.message} sessionId={sessionId} readOnly={readOnly}
        fallback={<BusMessage direction="in" name={entry.message.senderName} senderId={entry.message.senderId} sourceKind={entry.message.sourceKind} mode={entry.message.deliveryMode} text={entry.message.text} kind={entry.message.envelope?.kind ?? null} envelope={entry.message.envelope ?? null} recipientRuntime={agent.runtime} onContextMenu={menu("received", entry.message.text)} />} />;
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
      return <AutoReviewNotice review={entry.review} text={entry.text} />;
    case "other":
      return null;
  }
}


/**
 * Turns, work groups and messages of one thread. Shared by the conversation and the read-only
 * sub-agent view (`readOnly`: no edit & resend, no reply affordances).
 */
export function TimelineBody({ timeline, entries: allEntries, sessionId, nameOf, readOnly = false, ownerNotes = !readOnly, older = null, onLoadOlder, pendingSends = false, onRelease }: { timeline: TimelineState; entries: TimelineEntry[]; sessionId: string; nameOf: (id: string) => string; readOnly?: boolean; /** The agent's owner-notify cards (default: not in read-only views). The side agent view is read-only for row actions but keeps them: a card is where the owner answers the agent. */ ownerNotes?: boolean; /** History pages still on the host (lib/historyPages). */ older?: OlderHistory | null; onLoadOlder?: () => void; /** Show the user's sends not in the thread yet (lib/outbox placement "turn"): placed by timelineTail, never below the live line, keyed like the message that replaces them. */ pendingSends?: boolean; /** Let go of stick-to-bottom (a focus request scrolls up to a turn). */ onRelease?: () => void }) {
  const { t } = useI18n();
  const { reasoningView, timelineTurns, timelineInteractions } = useUiPrefs();
  // Host, agent features and renderers once per timeline, shared by every row (TimelineViewContext).
  const view = useTimelineView(sessionId);
  const tools = view.tools;
  // owner-notify: the agent's messages to the owner, placed among its turns (not in sub-agent views;
  // the side agent view keeps them).
  const ownerNotify = useApp((s) => ownerNotes && selectedFeatures(s).has(OWNER_NOTIFY_FEATURE));
  const notesById = useHostOwnerNotes(view.hostId);
  const notes = useMemo(() => (ownerNotify ? recordsOf(notesById, sessionId) : []), [ownerNotify, notesById, sessionId]);
  // Long histories render only the latest turns (Settings → 通用 → 长对话); 显示更早 adds more.
  // Pages fetched by scrolling to the top are shown at once (the window grows by them).
  const [limit, setLimit] = useState(timelineTurns);
  useEffect(() => setLimit(timelineTurns), [sessionId, timelineTurns]);
  const { entries, hiddenTurns } = recentEntries(allEntries, timeline.turns, limit > 0 ? limit + (older?.added ?? 0) : limit);
  const turnOf = new Map(timeline.turns.map((turn) => [turn.id, turn]));
  const bars = replyBars(timeline.turns, entries);
  // Turn summary: each turn's completed fileChange items, merged per file.
  const turnChanges = useMemo(() => fileChangesByTurn(allEntries), [allEntries]);
  const latestReply = latestReplyIds(entries);
  // Handler side: the final reply of a turn a delegation started gets the 已回复 badge.
  const replied = handlerReplies(entries, timeline.turns);
  // focusTurn / focusDelegation (lib/focusRequest): widen the window to the target, then scroll + flash.
  const request = useFocusRequest((s) => (!readOnly && s.request?.sessionId === sessionId ? s.request : null));
  const loading = useApp((s) => s.sessions[sessionId]?.loading ?? false);
  // The session view's failed load gates the opening too (below); TimelineBody's own error row is Conversation's.
  const failed = useApp((s) => !!s.sessions[sessionId]?.error);
  // Older pages this focus request has fetched (a target before every loaded turn pages history in).
  const paged = useRef({ nonce: 0, pages: 0 });
  useEffect(() => {
    if (!request || loading) return;
    const miss = (key: MessageKey) => {
      clearFocusRequest(request.nonce);
      if (request.onDone) request.onDone(false);
      else useApp.getState().notify(t(key));
    };
    let turnId = request.turnId ?? null;
    const note = request.notificationId ? notesById[request.notificationId] : undefined;
    if (request.notificationId) turnId = note ? noteTurnOf(note, timeline.turns) : null;
    // A delegation: its card here (requester), else the turn its ASK row started (handler).
    const card = request.askId ? delegateEntryOf(allEntries, request.askId) : null;
    if (request.askId) turnId = card?.turnId ?? askRowTurnOf(allEntries, request.askId);
    const index = turnId ? timeline.turns.findIndex((x) => x.id === turnId) : -1;
    // A message older than every loaded turn: page its turn in first while there is older history
    // (an open agent's pending notice from many turns ago, composer 等你回复 row); fully loaded, it sits
    // at the top (no turn to widen to).
    const noteOlder = !!note && noteNeedsOlderHistory(note, timeline.turns, !!older?.cursor && !older.error && !!onLoadOlder);
    if (index < 0 && (!(request.notificationId && note) || noteOlder)) {
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
    const needed = index < 0 ? 0 : timeline.turns.length - index;
    const shown = limit > 0 ? limit + (older?.added ?? 0) : Infinity;
    if (needed > shown) {
      setLimit(needed - (older?.added ?? 0));
      return; // runs again once the turn is rendered
    }
    const selector = request.notificationId
      ? `[data-owner-note="${CSS.escape(request.notificationId)}"]`
      : card
        ? `[data-ask-id="${CSS.escape(request.askId!)}"]`
        : request.askId
          ? `[data-ask-row="${CSS.escape(request.askId)}"]`
          : `[data-turn-id="${CSS.escape(turnId!)}"]`;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector(selector);
      clearFocusRequest(request.nonce);
      if (!el) return miss(request.askId ? "delegation.cardNotFound" : request.notificationId ? "ownerNotify.notLoaded" : "delegation.notLoaded");
      onRelease?.();
      if (request.land) request.land(el);
      else flashElement(el);
      // An owner note: keyboard focus on its 回复 (else the card) so Enter / Space answers it.
      if (request.notificationId && !request.land) (el.querySelector<HTMLElement>("[data-note-reply]") ?? (el as HTMLElement)).focus?.({ preventScroll: true });
      request.onDone?.(true);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, loading, limit, allEntries, timeline.turns.length, notesById, older?.cursor, older?.loading, older?.error]);
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
  let actionablePlan: string | null = null;
  if (!timeline.activeTurnId) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.kind === "plan") {
        actionablePlan = e.id;
        break;
      }
      if (e.kind === "user" || e.kind === "received") break;
    }
  }
  const segments = segmentEntries(entries, { reasoning: reasoningView !== "hidden", interactions: timelineInteractions, standalone: (item) => !!toolRendererFor(item, tools)?.item.standalone?.(item) });
  const placed = placeOwnerNotes(
    notes,
    segments.map((seg) => (seg.kind === "work" ? seg.turnId : seg.entry.turnId)),
    timeline.turns,
    { olderHistory: hiddenTurns > 0 || !!older?.cursor },
  );
  const turnErrors = turnErrorPlacement(segments.map((seg) => (seg.kind === "work" ? seg.turnId : seg.entry.turnId)), timeline.turns);
  // timeline.turnAttachment (§19.3) inline items go at the end of a turn: inside a finished turn's last
  // reply (after its turn summary, before its action row), else after the turn's last rendered row.
  const segTurn = (seg: (typeof segments)[number]) => (seg.kind === "work" ? seg.turnId : seg.entry.turnId);
  const lastSegOf = new Map<string, number>();
  segments.forEach((seg, i) => {
    const turnId = segTurn(seg);
    if (turnId) lastSegOf.set(turnId, i);
  });
  const barTurns = new Set([...bars.values()].map((b) => b.turnId));
  const tailAttachments = (i: number) => {
    const turnId = segTurn(segments[i]!);
    return turnId && !readOnly && lastSegOf.get(turnId) === i && !barTurns.has(turnId) ? <TurnAttachments sessionId={sessionId} turnId={turnId} /> : null;
  };
  const turnStops = turnInterruptedPlacement(segments.map(segTurn), timeline.turns);
  const errorRows = (i: number) => [
    ...(turnErrors.get(i)?.map((turn) => <TurnErrorRow key={`error-${turn.id}`} turn={turn} />) ?? []),
    ...(turnStops.get(i)?.map((turn) => <TurnInterruptedRow key={`stopped-${turn.id}`} />) ?? []),
  ];
  const noteCards = (list: readonly { notificationId: string }[] | undefined) => list?.map((r) => <OwnerNotifyCard key={r.notificationId} notificationId={r.notificationId} sessionId={sessionId} />);
  // The user's pending sends: same row component and key (lib/outbox sendRowKey) as the timeline's
  // user message that replaces them, in the same flat list, so the handoff is a prop change.
  const outbox = useApp((s) => (pendingSends ? s.outbox[sessionId] : undefined));
  const pendingRows = pendingSends ? pendingTail(outbox, timeline) : [];
  const usedKeys = new Set<string>();
  const rowKeyOf = (entry: TimelineEntry) => {
    const key = timelineRowKey(entry);
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
      {noteCards(placed.head)}
      {[...segments.map((seg, i) => {
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
              <div data-turn-id={first}>
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
        const first = anchor(entry.turnId);
        return (
          <Fragment key={rowKeyOf(entry)}>
            <div data-turn-id={first}>
              {/* timeline.turnAttachment (§19.3): margin boxes beside the turn's first line, inline ones at the turn's end. */}
              {first && !readOnly && <TurnMargin sessionId={sessionId} turnId={first} />}
              {header && <TurnHeader turn={header} />}
              <MemoEntry entry={entry} nameOf={nameOf} sessionId={sessionId} readOnly={readOnly} actionable={entry.id === actionablePlan} bar={bars.get(entry.id)} dropped={entry.kind === "user" ? turnsFrom(timeline.turns, entry.turnId) : 0} foldRole={foldRoleOf(entry)} changes={bars.has(entry.id) ? turnChanges.get(entry.turnId ?? "") : undefined} />
              {reply && <RepliedBadge row={reply} />}
            </div>
            {tailAttachments(i)}
            {errorRows(i)}
            {noteCards(after)}
          </Fragment>
        );
      }),
      ...timelineTail(timeline.activeTurnId, headed).flatMap((slot) => {
        if (slot === "pending")
          return pendingRows.flatMap((p) => {
            const key = sendRowKey(p.id);
            if (usedKeys.has(key)) return [];
            usedKeys.add(key);
            // Same element structure as a message segment above (Fragment > div > slots > MemoEntry).
            return [
              <Fragment key={key}>
                <div data-turn-id={undefined}>
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
        return [<TurnTail key="tail" timeline={timeline} sessionId={sessionId} />];
      })]}
    </TimelineViewContext.Provider>
  );
}
