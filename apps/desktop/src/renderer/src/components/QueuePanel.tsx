import { predictedOwnerSurface, type LedgerOwnerOutbox } from "../lib/inputLedger/owner";
// Docked above the composer (pattern from ZCode's ConversationQueuePanel): first the steers sent
// into the running turn that the native has not read yet (lib/pendingSteers; read-only, in send
// order, one "interrupt & send" for the group since the native reads them all at the same tool
// boundary), then — after a plain stop — the paused section (lib/queuePause: undelivered steers,
// then the queued items cutex holds back, with 继续发送 / 放回输入框 / 清空), then the queued
// follow-ups. With cutex admission-order (`ordered`) the steers and follow-ups are turn cards
// instead (components/TurnQueue: 「下个工具边界」 and 「队列」 by turn); the paused section then only
// carries undelivered steers (the paused owner messages stay in their turns, after a paused divider).
// Optimistic sends (lib/outbox) appear in the steers section / after the queue as 发送中… (or with
// their error + retry) and are replaced in place by the cutex row with the same clientUserMessageId.
// Callers can add sections of their own (`sections`), shown last in the same frame.
// Queue redesign 2026-10-15: one quiet card on the composer's top edge (same width, border and surface
// as the input box), a header line 「接下来 · N」 with the queue actions (暂停委托 / 继续) and a chevron
// that collapses the card to that line (per agent, lib/queueView); an owner row has a small icon, and
// its actions (插入 / 立即发送, edit, remove) show on hover or keyboard focus only.
// Compact (UI review 2026-10-15 #2, lib/queueChips): with `autoCompact` the card starts as its header
// line when more than one kind of thing waits (or the window is short), the header then reads
// 「接下来 · 排队 2 · 留言 1 · 委托 3」; a click on it expands (for this run), the chevron collapses.
// Composer passes `autoCompact` only under the 「接下来」面板 setting 自动折叠; under ★ 始终展开 the card
// collapses by the chevron alone (remembered per agent, lib/queueView).
// Short pane (lib/shortPane, owner 2026-10-26 option B): where the card would leave the history under its minimum, it
// folds to its header line and its list opens as an overlay above that line (over the history; Esc, a click elsewhere
// or focus leaving closes it; a drag keeps it open until it ends). The owner's own collapse / expand wins (see there).
import type { AgentRuntime } from "../lib/agentFeatures";
import { agentState, featuresOf, useApp } from "../store";
import { useConvHost } from "../lib/conversationScope";
import { usesInputLedger } from "../lib/deliveryMode";
import { planQueueMerge } from "../../../shared/queueMerge";
import { queueActionNotice } from "../lib/queueSteer";
import { clearableUncertain, ledgerQueue } from "../lib/inputLedger/nextUp";
import { useNow } from "../lib/time";
import { LedgerTurnQueue } from "./TurnQueue";
import { LedgerPendingMessagesSection } from "./PendingMessagesSection";
import { DeliveryStatus } from "./DeliveryStatus";
import { showStandaloneDelivery } from "../lib/inputLedger/deliveryPresentation";
import { mentionPlainText } from "../lib/mentionWire";
import { Fragment, useEffect, useMemo, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowDownToLine, ChevronDown, ChevronRight, ChevronUp, CornerDownRight, Info, Pencil, Trash2, UserRound, X } from "lucide-react";
import { useShortPaneFold } from "../lib/shortPane";
import type { QueueItem } from "@cutex-desktop/protocol";
import { RailStripContext, useStripInside } from "../lib/railStrip";
import { useI18n, type MessageKey } from "../i18n";
import { useModelOverloadRetry } from "../lib/modelOverloadRetryView";
import { openMenuAt } from "../lib/contextMenu";
import { panelGuideItem } from "../lib/panelGuideMenu";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";
import { outboxStatusCopy, type OutboxEntry } from "../lib/legacyDelivery/outbox";
import { steerDelivery, type PendingSteer } from "../lib/legacyDelivery/pendingSteers";
import type { ImageSteering } from "../lib/imageSteer";
import { queuedRowText, type PausedSection } from "../lib/queuePause";
import { queueViewOf, setQueueView } from "../lib/queueView";
import { autoCompact as startsCompact, mergeChips, openedThisRun, queueChips, setOpenedThisRun, turnCounts, type QueueChip } from "../lib/queueChips";
import { META_YIELDS, QUEUE_ROW, ROW_ACTIONS, ROW_META, ROW_TEXT, rowText } from "../lib/queueRow";
import { KindIcon, SteerDeliveryNote } from "./AdmissionRows";
import { QueuedImages } from "./ImageThumbs";
import { messageImages } from "../../../shared/input";
import { Rail, RailRow } from "./QueueRail";
import { useUserLayoutToggle } from "../lib/userLayoutToggle";
import { TurnQueue, type OrderedQueue, type OwnerRowExtra } from "./TurnQueue";
import { useShownNextStep } from "../lib/legacyDelivery/settledRideAlongs";
import { useUnsettledBusReceipts } from "../lib/legacyDelivery/consumedBusReceipts";
import { useHiddenReceiptIds } from "../lib/legacyDelivery/busReceiptVisibility";
import { openCleanup } from "../lib/cleanupNav";
import { useRestoreClosedReceipts } from "../lib/legacyDelivery/hiddenReceiptClosure";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";
import { Tag, CountBadge } from "./Tag";
import { btn } from "./Button";
import { insertFeedbackOf, insertFinished, insertLocked, insertUnsure, useQueueInsertFeedback } from "../lib/queueInsertFeedback";
import { QueueInsertStatus, QueueInsertUnsureHint } from "./QueueInsertStatus";
import { isElement, isNode, ownerDocumentOf, ownerWindowOf, resizeObserverFor } from "../lib/ownerWindow";

const NO_NEXT_STEP: AdmissionNextStep[] = [];

// Every group (waiting steers, paused, plain queue, extra sections) uses the same unboxed frame — a
// hairline between groups, no box in the card — so a row keeps its position when stopping moves it
// from one group to another.
const SECTION = "flex flex-col gap-0.5 py-0.5";
/** On the tray: every group after the first (`data-queue-section`) gets a hairline above it. */
const SECTION_RULES = "[&>[data-queue-section]~[data-queue-section]]:border-t [&>[data-queue-section]~[data-queue-section]]:border-border/60";
/** A group's heading: a small muted label (not a box), its actions at the end. */
const HEADING = "flex h-6 min-w-0 items-center gap-1.5 pr-1 pl-0.5 text-caption/[inherit] text-subtle";
const ICON_BUTTON = "rounded-md p-1 text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:opacity-30";
const ICON_BUTTON_DANGER = "rounded-md p-1 text-muted hover:text-danger focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";

/** An extra section: its content and the chip it shows while the card is compact. */
export interface QueueSection {
  node: React.ReactNode;
  chip?: QueueChip;
}

/** An extra-section slot with something to show (null / undefined / booleans / "" are empty slots). */
const filled = (section: QueueSection | null | undefined): section is QueueSection => {
  const node = section?.node;
  return node !== null && node !== undefined && typeof node !== "boolean" && node !== "";
};

/** One chip's words (「排队 2」, 「委托已暂停」). */
function ChipText({ chip }: { chip: QueueChip }) {
  const { t } = useI18n();
  return (
    <span className={`whitespace-nowrap ${chip.warn ? "text-warn-text" : "text-muted"}`} data-testid={`queue-chip-${chip.kind}`}>
      {t(`queue.chip.${chip.kind}` as MessageKey, { n: chip.n ?? 0 })}
    </span>
  );
}

export interface OutboxActions {
  onRetry(id: string): void;
  onEdit(id: string): void;
  onDiscard(id: string): void;
}

/**
 * An optimistic send (lib/outbox) in the queue tray: 发送中… while the request is in flight, or the
 * error with 重试 / 放回输入框 / 丢弃. Keyed by clientUserMessageId like the row that replaces it; the
 * same anatomy (kind icon · text · meta) as that row.
 */
function OutboxRow({ entry, kind, actions, hostId }: { entry: OutboxEntry; kind: "steer" | "queue"; actions: OutboxActions; hostId?: string }) {
  const { t } = useI18n();
  const failed = entry.state === "failed";
  const status = outboxStatusCopy(entry);
  return (
    <div className={`${QUEUE_ROW} min-h-6 max-h-6 shrink-0 ${failed ? "bg-danger/5" : ""}`} data-testid={failed ? "outbox-failed" : "outbox-sending"}>
      <KindIcon icon={kind === "steer" ? CornerDownRight : UserRound} label={t(kind === "steer" ? "queue.turn.inserting" : "queue.delivery.owner")} />
      <span className={`${ROW_TEXT} ${failed ? "text-foreground" : "text-muted"}`}>{rowText(mentionPlainText(entry.text))}</span>
      <QueuedImages images={messageImages(entry.extra as { type: string }[])} hostId={hostId} />
      {failed ? (
        <>
          {/* Plain words only; a raw transport / backend error is the 详情 tooltip. */}
          <span className="max-w-[40%] shrink truncate text-caption/[inherit] text-danger-text" title={entry.error ? (entry.errorRaw ? `${t("queue.insert.details")}: ${entry.error}` : entry.error) : undefined} data-testid="outbox-failed-text">
            {t("outbox.failed")}
            {entry.error && !entry.errorRaw ? ` · ${entry.error}` : ""}
          </span>
          {entry.error && entry.errorRaw && (
            <span className="shrink-0 cursor-help rounded p-0.5 text-subtle" title={`${t("queue.insert.details")}: ${entry.error}`} aria-label={t("queue.insert.details")} data-testid="outbox-failed-detail">
              <Info size={11} aria-hidden />
            </span>
          )}
          <button onClick={() => actions.onRetry(entry.id)} title={t("outbox.retryHint")} className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs hover:text-accent">
            {t("outbox.retry")}
          </button>
          <button onClick={() => actions.onEdit(entry.id)} title={t("outbox.edit")} aria-label={t("outbox.edit")} className={ICON_BUTTON}>
            <Pencil size={12} aria-hidden />
          </button>
          <button onClick={() => actions.onDiscard(entry.id)} title={t("outbox.discard")} aria-label={t("outbox.discard")} className={ICON_BUTTON_DANGER}>
            <X size={12} aria-hidden />
          </button>
        </>
      ) : (
        <span className={`${ROW_META} text-subtle`} title={t(status.hint)}>
          {t(status.label, status.vars)}
        </span>
      )}
    </div>
  );
}

function LegacyQueuePanel({
  steers,
  sendingSteers = [],
  sendingQueue = [],
  timelineSends = [],
  outbox,
  onInterruptSendSteers,
  onDismissSteer,
  onRecheckSteer,
  paused,
  pausedHint,
  onResumePaused,
  onRestorePaused,
  onClearPaused,
  items,
  canEdit,
  onSendNow,
  sendNowStartsTurn = false,
  onEdit,
  onDelete,
  sections = [],
  ordered: orderedIn,
  stripEnabled = false,
  stopHold = false,
  running = false,
  sessionId,
  hostId,
  runtime = "codex",
  imageSteering = null,
  autoCompact,
}: {
  steers: PendingSteer[];
  /** Optimistic sends shown in the steers section / after the queue (lib/outbox). */
  sendingSteers?: OutboxEntry[];
  sendingQueue?: OutboxEntry[];
  /** Owner inputs already represented by a timeline echo; feedback stays with that input. */
  timelineSends?: readonly OutboxEntry[];
  outbox: OutboxActions;
  onInterruptSendSteers(): void;
  onDismissSteer(id: string): void;
  onRecheckSteer?(id: string): void;
  /** Undelivered steers + queue items held by the cutex pause. */
  paused: PausedSection;
  /** Replaces the paused title while the user types (what Enter will do with the paused queue). */
  pausedHint?: string | null;
  onResumePaused(): void;
  onRestorePaused(): void;
  onClearPaused(): void;
  items: QueueItem[];
  /** Editing moves the text back into the composer; blocked while a draft exists. */
  canEdit: boolean;
  /**
   * Send the item now (main: queuePromote, strategy `auto`): steers it into the running turn, or —
   * idle — starts a new turn with it. Omitted while busy for agents without same-turn steering (Claude).
   */
  onSendNow?: (item: QueueItem) => void;
  /** Ledger: atomically merge eligible owner items, then insert the retained item. */
  onMergeInsert?: (items: QueueItem[]) => Promise<void>;
  /** The agent is idle: 立即发送 (a new turn) instead of 插入 (steer). */
  sendNowStartsTurn?: boolean;
  onEdit(item: QueueItem): void;
  onDelete(item: QueueItem): void;
  /**
   * Extra sections after the queue, each in the shared section frame. Keyed by position: keep a
   * fixed slot per section and pass null while it has nothing to show (the panel stays hidden
   * when every slot and the queue are empty).
   */
  sections?: (QueueSection | null)[];
  /** admission-order: steers and follow-ups as turn cards (components/TurnQueue). */
  ordered?: OrderedQueue;
  /** 悬停时显示分区名 (lib/railStrip; turn frame only). */
  stripEnabled?: boolean;
  /** An owner stop hold is on (lib/stopHold): 继续发送's hint says it releases everything. */
  stopHold?: boolean;
  /** A turn is running: the next queued item says it is delivered when that turn ends. */
  running?: boolean;
  /** The open agent (collapse remembered per agent); defaults to `ordered.sessionId`. */
  sessionId?: string;
  /** The agent's host: a queued image stored as a host path is read through it (components/ImageThumbs). */
  hostId?: string;
  /** The agent's runtime: a Claude steer with images is sent as the next turn (lib/pendingSteers steerDelivery). */
  runtime?: AgentRuntime;
  /** image-input-steering: the session's declared image steering (lib/imageSteer imageSteerMode); null = unknown / older cutex. */
  imageSteering?: ImageSteering | null;
  /** Start compact by the rule of lib/queueChips; `short` = the window is short. Omitted = never by itself. */
  autoCompact?: { short: boolean };
}) {
  const { t } = useI18n();
  const userToggle = useUserLayoutToggle();
  // Ride-alongs still settling (lib/settledRideAlongs) are left out of everything at once — rows,
  // count, chips and whether the card shows — so the card never flashes empty.
  const receiptHost = hostId ?? "local";
  const receiptSession = sessionId ?? orderedIn?.sessionId ?? "";
  const hiddenReceipts = useHiddenReceiptIds(receiptHost, receiptSession);
  // Hidden rows are never shown here (owner 2026-10-30: no 「已隐藏 N 条」 strip); one the server closed is un-hidden.
  const hiddenRows = useMemo(() => [...hiddenReceipts].map((id) => ({ session: receiptSession, id })), [hiddenReceipts, receiptSession]);
  useRestoreClosedReceipts(receiptHost, hiddenRows);
  const unsettled = useUnsettledBusReceipts(receiptHost, receiptSession, orderedIn?.nextStep ?? NO_NEXT_STEP);
  const nextStep = useShownNextStep(unsettled, orderedIn?.running ?? false, orderedIn);
  const ordered = orderedIn && nextStep !== orderedIn.nextStep ? { ...orderedIn, nextStep } : orderedIn;
  const feedbackHost = hostId ?? "local";
  const feedbackSession = sessionId ?? ordered?.sessionId ?? "";
  const retryStatus = useModelOverloadRetry(feedbackSession, hostId);
  const retry = retryStatus?.holdsAdmission ? retryStatus : null;
  const insertFeedback = useQueueInsertFeedback(insertFeedbackOf(feedbackHost, feedbackSession));
  const matchesFeedback = (feedback: (typeof insertFeedback)[number], id: string) => feedback.item.clientUserMessageId === id || feedback.sentId === id;
  const feedbackFor = (id: string) => insertFeedback.find((f) => matchesFeedback(f, id));
  const insertStatus = (id: string) => {
    const feedback = feedbackFor(id);
    return feedback && !feedback.hidden ? <QueueInsertStatus feedback={feedback} hostId={feedbackHost} sessionId={feedbackSession} inQueue={items.some((q) => matchesFeedback(feedback, q.clientUserMessageId))} /> : null;
  };
  // An SSE can remove the queue/steer row before its request returns (or before the owner sees
  // its result). Retain only the operation receipt, not a synthetic queued item or admission turn.
  const receipts = insertFeedback.filter((f) => !f.hidden && !timelineSends.some(e => matchesFeedback(f, e.id)) && !items.some((q) => matchesFeedback(f, q.clientUserMessageId)) && !steers.some((p) => matchesFeedback(f, p.id)));
  const tray = useRef<HTMLDivElement>(null);
  // The rows below the header shrink with the pane (min-h-0, the Composer / Conversation chain is a flex column) and
  // scroll once they no longer fit: a row is never cut or covered by the input box. Only then a scroll box, so the
  // rail strip may still stand outside the frame (lib/railStrip: a clipping ancestor moves it inside).
  const body = useRef<HTMLDivElement>(null);
  const [bodyScrolls, setBodyScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      setBodyScrolls(el.scrollHeight > el.clientHeight + 1);
      // Folded, the list is out of flow: its size changing is no layout change the pane's observer would see.
      if (tray.current?.hasAttribute("data-short-fold")) shortPane.store?.recheck();
    };
    measure();
    const ro = resizeObserverFor(el, measure);
    if (!ro) return;
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  });
  // The header line's slots for TurnQueue (the insert target overlay while dragging, 「全部合并插入」 at its right).
  const [targetSlot, setTargetSlot] = useState<HTMLElement | null>(null);
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);
  const stripInside = useStripInside(tray, stripEnabled && !!ordered);
  // 清空 is click-twice (lib/armedConfirm): the first click turns the paused section red and leaves only the clear button.
  const [clearArmed, setClearArmed] = useArmed(paused.count);
  const waiting = steers.filter((p) => p.state !== "undelivered");
  const heldIds = new Set(paused.items.map((i) => i.queueId));
  const rest = ordered ? [] : items.filter((i) => !heldIds.has(i.queueId));
  // A running turn alone shows nothing (no current-turn card since the turn frame): no empty tray.
  const orderedCount = ordered ? ordered.turns.length + ordered.nextStep.length : 0;
  const agent = sessionId ?? ordered?.sessionId;
  const [collapsedFor, setCollapsedFor] = useState<{ id: string | undefined; v: boolean } | null>(null);
  const userCollapsed = collapsedFor && collapsedFor.id === agent ? collapsedFor.v : !!queueViewOf(agent).collapsed;
  // Short pane: `pin` = the owner expanded the card by hand. "armed" until the pane measured it once: still short →
  // "held" (stays expanded in place, the auto-fold waits) until the pane has room again; not short → nothing to hold.
  const shortPane = useShortPaneFold();
  const [pin, setPin] = useState<"armed" | "held" | null>(null);
  const setCollapsed = (v: boolean) => {
    userToggle(() => {
      setQueueView(agent, { collapsed: v });
      setOpenedThisRun(agent, !v);
      setCollapsedFor({ id: agent, v });
      setPin(v || !shortPane.store ? null : "armed");
    });
  };
  useLayoutEffect(() => {
    if (pin !== "armed") return;
    shortPane.store?.recheck();
    setPin(shortPane.store?.get() ? "held" : null);
  }, [pin, shortPane.store]);
  useLayoutEffect(() => {
    if (!shortPane.fold && pin === "held") setPin(null);
  }, [shortPane.fold, pin]);
  // The overlay (open while folded) and a drag: the fold and the overlay stay as they were until the drag ends.
  const [overlay, setOverlay] = useState(false);
  const [drag, setDrag] = useState<{ folded: boolean } | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const overlayId = useId();
  const closeOverlay = (refocus: boolean) => {
    openOverlay(false);
    if (refocus) toggle.current?.focus();
  };
  const openOverlay = (open: boolean) => {
    userToggle(() => setOverlay(open));
    // Opened: the list takes the focus (Tab goes on through its rows, then back to the input box).
    if (open) ownerWindowOf(tray.current).requestAnimationFrame(() => body.current?.focus({ preventScroll: true }));
  };
  // Not folded any more (the pane got taller, the owner collapsed it): no overlay to come back to.
  const foldedNow = shortPane.fold && !userCollapsed;
  useEffect(() => {
    if (!foldedNow && !drag) setOverlay(false);
  }, [foldedNow, drag]);
  // A click elsewhere closes it (not during a drag: a drag fires no pointerdown, its end is `drag`).
  useEffect(() => {
    if (!overlay || drag) return;
    const down = (e: PointerEvent) => {
      if (!isNode(e.target) || !tray.current?.contains(e.target)) closeOverlay(false);
    };
    const doc = ownerDocumentOf(tray.current);
    doc.addEventListener("pointerdown", down, true);
    return () => doc.removeEventListener("pointerdown", down, true);
  }, [overlay, drag]);
  // A drag ends even when its row went away (moved, sent): any dragend / drop in the document ends it here.
  useEffect(() => {
    if (!drag) return;
    const end = () => setDrag(null);
    const doc = ownerDocumentOf(tray.current);
    doc.addEventListener("dragend", end, true);
    doc.addEventListener("drop", end, true);
    return () => {
      doc.removeEventListener("dragend", end, true);
      doc.removeEventListener("drop", end, true);
    };
  }, [drag]);
  if (!(ordered && retry) && rest.length === 0 && orderedCount === 0 && waiting.length === 0 && paused.count === 0 && sendingSteers.length === 0 && sendingQueue.length === 0 && receipts.length === 0 && !sections.some(filled)) return null;
  // The header count: what reaches the agent next (the extra sections are not counted).
  const count = (ordered ? orderedCount : rest.length + (paused.count - paused.steers.length)) + waiting.length + paused.steers.length + sendingSteers.length + sendingQueue.length;
  const extras = sections.filter(filled);
  const turnsOf = ordered ? turnCounts(ordered.turns) : { owner: 0, asks: 0 };
  const chips = mergeChips([
    ...queueChips({
      queued: (ordered ? turnsOf.owner - (paused.count - paused.steers.length) : rest.length) + sendingQueue.length,
      inserting: waiting.length + sendingSteers.length + paused.steers.length,
      paused: paused.count - paused.steers.length,
      asks: turnsOf.asks,
      nextStep: ordered?.nextStep ?? [],
    }),
    ...extras.flatMap((x) => (x.chip ? [x.chip] : [])),
  ]);
  // Never compact for an unknown agent (the expand could not be remembered: the card would stay
  // compact) nor while a send failed (its error and 重试 / 放回 / 丢弃 must show).
  const failedSend = sendingSteers.some((e) => e.state === "failed") || sendingQueue.some((e) => e.state === "failed");
  const compact = !!autoCompact && !!agent && !failedSend && !insertFeedback.some((f) => !f.hidden) && !openedThisRun(agent) && startsCompact(chips, count + extras.length, autoCompact.short);
  const collapsed = userCollapsed || compact;
  const autoFold = drag ? drag.folded : shortPane.fold && !collapsed && !pin;
  const overlayOpen = autoFold && overlay;
  /** The header line only (collapsed by the owner / compact, or folded by the short pane). */
  const folded = collapsed || autoFold;
  // 继续 in the header when the paused section (which has its own) is not shown, nor the stop's
  // 委托已随停止暂停 section (a stop hold: it carries 继续发送 for everything the stop held).
  const headerResume = !!ordered && paused.count > 0 && paused.steers.length === 0 && !stopHold;
  // Keyed by clientUserMessageId: an optimistic row and the cutex item that replaces it share the key.
  const itemRow = (item: QueueItem, extra: OwnerRowExtra = {}) => {
    const feedback = feedbackFor(item.clientUserMessageId);
    const locked = !!feedback && (insertLocked(feedback.state) || insertFinished(feedback.state));
    // Unsure and still listed (the resync could not read cutex): it can be deleted / edited, never 插话 again from here.
    const held = locked && !(insertUnsure(feedback) && !feedback.hidden);
    return (
    <div
      key={item.clientUserMessageId || item.queueId}
      {...extra.rowProps}
      className={`${QUEUE_ROW} min-h-6 max-h-6 shrink-0 hover:bg-hover ${extra.rowProps ? "focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none" : ""}`}
      data-testid="queue-item"
    >
      {extra.grip}
      <KindIcon icon={UserRound} label={t("queue.delivery.owner")} />
      <QueuedImages images={messageImages(item.input as { type: string }[])} hostId={hostId} />
      <span className={`${ROW_TEXT} text-foreground`}>{rowText(mentionPlainText(queuedRowText(item)))}</span>
      {feedback && !feedback.hidden ? insertStatus(item.clientUserMessageId) : extra.paused ? (
        // The ❚❚ glyph is the section's (rail / divider); the row just says it.
        <span className={`${ROW_META} ${META_YIELDS} text-warn-text`} title={t("queue.state.paused")} data-testid="queue-item-paused">
          {t("queue.meta.held")}
        </span>
      ) : (
        extra.note && (
          <span className={`${ROW_META} ${META_YIELDS} text-subtle`} data-testid="queue-delivery-note">
            {extra.note}
          </span>
        )
      )}
      {/* Row actions: on hover or keyboard focus only (Tab reaches them; the row's focus shows them too), in the meta's place. */}
      <span className={`${ROW_ACTIONS} h-5 max-h-5`} data-testid="queue-item-actions">
        {onSendNow && (
          <button
            onClick={() => onSendNow(item)}
            disabled={locked}
            title={t(feedback?.hidden && feedback.state === "unknown" ? "queue.insert.unknown" : sendNowStartsTurn ? "queue.sendNowIdleHint" : "queue.sendNowHint")}
            className="rounded-md bg-surface-2 px-2 py-0.5 text-xs hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            data-testid="queue-send-now"
          >
            {t(sendNowStartsTurn ? "queue.sendNowIdle" : "queue.sendNow")}
          </button>
        )}
        <button
          onClick={() => onEdit(item)}
          disabled={!canEdit || held}
          title={canEdit ? t("queue.edit") : t("queue.editDraftConflict")}
          aria-label={canEdit ? t("queue.edit") : t("queue.editDraftConflict")}
          className={ICON_BUTTON}
        >
          <Pencil size={12} aria-hidden />
        </button>
        <button onClick={() => onDelete(item)} disabled={held} title={t("queue.delete")} aria-label={t("queue.delete")} className={ICON_BUTTON_DANGER} data-testid="queue-delete">
          <Trash2 size={12} aria-hidden />
        </button>
      </span>
    </div>
  );
  };
  // A steer the native has not read yet: the same anatomy, its delivery as meta. With the turn frame
  // (rail column) these rows sit on its grid: an empty rail cell first, the heading glyph in that column.
  const glyphCell = `flex ${ordered ? "-ml-0.5 w-[22px]" : "w-4"} shrink-0 items-center justify-center self-stretch`;
  const steerRow = (p: PendingSteer, meta: React.ReactNode, action?: React.ReactNode, testId?: string) => {
    const row = (
      <div key={p.id} className={QUEUE_ROW} data-testid={ordered ? undefined : testId}>
        {steerDelivery(p, runtime, imageSteering) === "nextTurn" ? <KindIcon icon={ArrowDownToLine} label={t("queue.meta.nextTurn")} /> : <KindIcon icon={CornerDownRight} label={t("queue.turn.inserting")} />}
        <span className={`${ROW_TEXT} text-muted`}>{rowText(mentionPlainText(p.text))}</span>
        <QueuedImages images={messageImages((p.extra ?? []) as { type: string }[])} total={p.imageCount} hostId={hostId} />
        {p.state === "checking" ? meta : insertStatus(p.id) ?? meta}
        {action && <span className={`${ROW_ACTIONS} h-5 max-h-5`}>{action}</span>}
      </div>
    );
    return ordered ? (
      <RailRow key={p.id} rail={<Rail />} testId={testId}>
        {row}
      </RailRow>
    ) : (
      row
    );
  };
  return (
    <RailStripContext.Provider value={{ enabled: stripEnabled && !!ordered, inside: stripInside }}>
    {/* Its own block right above the input box (Composer INPUT_IN_CARD, owner 2026-10-26): same width and edges, the
        bottom edge is the input box's top border; it never wraps the input box. */}
    <div
      ref={tray}
      className={`${autoFold ? "relative" : ""} flex min-h-0 flex-col rounded-t-inner border border-b-0 border-border bg-surface px-1 pt-0.5 pb-1`}
      data-queue-tray=""
      data-testid="queue-tray"
      data-collapsed={collapsed || undefined}
      data-auto-retry-explained={ordered && retry?.phase === "pending" && !collapsed && (!autoFold || overlayOpen) ? "" : undefined}
      data-short-fold={autoFold || undefined}
      data-overlay={overlayOpen || undefined}
      // A drag keeps the fold as it was (folded: the overlay stays open) until it ends — a row never turns into or out
      // of the overlay under the pointer.
      onDragStartCapture={shortPane.store ? () => setDrag({ folded: autoFold }) : undefined}
      onKeyDown={overlayOpen ? (e: ReactKeyboardEvent) => {
        if (e.key !== "Escape" || drag) return;
        e.preventDefault();
        e.stopPropagation();
        closeOverlay(true);
      } : undefined}
      // Tab out of the card (or any other way the focus leaves it) closes the overlay.
      onBlur={overlayOpen ? (e) => {
        if (!drag && isNode(e.relatedTarget) && !e.currentTarget.contains(e.relatedTarget)) closeOverlay(false);
      } : undefined}
    >
      <div
        className="relative flex h-6 min-w-0 items-center gap-1.5 pr-0.5 pl-1.5 text-meta text-subtle"
        data-testid="queue-header"
        data-compact={compact || undefined}
        // 「接下来」's own menu: the conversation guide at its 「接下来」 step (lib/panelGuides). Its buttons keep theirs.
        onContextMenu={(e) => {
          if (isElement(e.target) && e.target.closest("button:not([data-testid=queue-chips]), a, input")) return;
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY, [
            panelGuideItem({ panel: "conversation", paneId: queuePaneId(e.currentTarget), sessionId: agent ?? null, step: 1 }),
            // Hidden receipts are listed only in 待清理 (never as a row here); this is the way there.
            hiddenReceipts.size > 0 && { label: t("queue.receipt.hiddenLink", { n: hiddenReceipts.size }), onSelect: () => openCleanup(receiptHost, "receipts") },
          ]);
        }}
      >
        {/* While an owner row is dragged, the line itself is the 「插入当前回合」 drop target (TurnQueue draws it here). */}
        <span ref={setTargetSlot} className="pointer-events-none absolute inset-0 z-10 [&>*]:pointer-events-auto" data-insert-slot="" />
        {folded && chips.length > 1 ? (
          // Collapsed with several kinds: 「接下来 · 排队 2 · 留言 1 · 委托 3」, the whole label expands (folded by the
          // short pane: opens the overlay).
          <button
            onClick={() => (autoFold ? openOverlay(!overlay) : setCollapsed(false))}
            title={t(autoFold ? "queue.overlay.foldedHint" : "queue.header.expand")}
            aria-expanded={autoFold ? overlayOpen : undefined}
            aria-controls={autoFold ? overlayId : undefined}
            className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md px-1 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            data-testid="queue-chips"
          >
            <span className="shrink-0 font-semibold text-foreground">{t("queue.header.title")}</span>
            {chips.map((chip) => (
              <span key={chip.kind} className="flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="text-subtle">·</span>
                <ChipText chip={chip} />
              </span>
            ))}
          </button>
        ) : (
          <>
            <span className="font-semibold text-foreground" title={t("queue.header.titleHint")}>
              {t("queue.header.title")}
            </span>
            {count > 0 && (
              <CountBadge tone="neutral" count={count} data-testid="queue-count" />
            )}
            {folded && chips.length === 1 && chips[0]!.warn && <ChipText chip={chips[0]!} />}
            <span className="flex-1" />
          </>
        )}
        <span ref={setActionSlot} className="flex items-center empty:hidden" data-merge-slot="" />
        {!folded && ordered?.actions}
        {headerResume && (
          <button onClick={onResumePaused} title={t(stopHold ? "paused.resumeHintStop" : "paused.resumeHint")} className="rounded-md px-1.5 py-0.5 text-xs text-warn hover:bg-warn/10 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none" data-testid="queue-header-resume">
            {t("paused.resume")}
          </button>
        )}
        {autoFold ? (
          // Folded by the short pane: the chevron opens / closes the overlay (pointing up, where it opens).
          <button
            ref={toggle}
            onClick={() => openOverlay(!overlay)}
            aria-expanded={overlayOpen}
            aria-controls={overlayId}
            aria-label={t(overlayOpen ? "queue.overlay.close" : "queue.overlay.open")}
            title={t(overlayOpen ? "queue.overlay.close" : "queue.overlay.foldedHint")}
            className="rounded-md p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            data-testid="queue-collapse"
            data-short-fold-toggle=""
          >
            {overlayOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
          </button>
        ) : (
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "queue.header.expand" : "queue.header.collapse")}
          title={t(collapsed ? "queue.header.expand" : "queue.header.collapse")}
          className="rounded-md p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          data-testid="queue-collapse"
        >
          {collapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
        )}
      </div>
      {/* Folded by the short pane: the list is an overlay above the header line (absolute — opening it moves nothing),
          kept mounted while closed (hidden: no focus, no screen reader) so a drag or a scroll position survives. */}
      {!collapsed && (<div
        ref={body}
        id={overlayId}
        {...(autoFold ? { role: "dialog", "aria-label": t("queue.header.title"), "aria-hidden": !overlayOpen || undefined, tabIndex: -1 } : {})}
        className={`flex min-h-0 flex-col ${autoFold ? `absolute right-[-1px] bottom-full left-[-1px] z-20 max-h-[var(--short-pane-overlay-max,240px)] overflow-y-auto overscroll-contain rounded-t-inner border border-b-0 border-border bg-surface px-1 pt-1 shadow-lg outline-none ${overlayOpen ? "" : "pointer-events-none invisible"}` : ""} ${bodyScrolls ? `overflow-y-auto overscroll-contain ${autoFold ? "" : "pb-3.5 [mask-image:linear-gradient(to_bottom,black_calc(100%-14px),transparent)]"}` : ""} ${SECTION_RULES}`}
        data-queue-body=""
        data-scrolls={bodyScrolls || undefined}
        data-testid={autoFold ? "queue-overlay" : undefined}
      >
      {!ordered && (waiting.length > 0 || sendingSteers.length > 0) && (
        <div className={SECTION} data-queue-section="" data-testid="pending-steers">
          <div className={HEADING}>
            <span className={glyphCell} aria-hidden>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            </span>
            <span className="min-w-0 flex-1 truncate" title={t("steer.pendingHint")}>
              {t("steer.pending")}
            </span>
            {waiting.some(p => (p.state ?? "waiting") === "waiting") && (
              <button onClick={onInterruptSendSteers} title={t("steer.interruptSendHint")} className="rounded-md px-1.5 py-0.5 text-xs text-danger hover:bg-danger/10">
                {t("steer.interruptSend")}
              </button>
            )}
          </div>
          {waiting.map((p) =>
            steerRow(
              p,
              <SteerDeliveryNote steer={p} runtime={runtime} imageSteering={imageSteering} onRecheck={onRecheckSteer && (() => onRecheckSteer(p.id))} />,
            ),
          )}
          {sendingSteers.map((e) => (
            <OutboxRow key={e.id} entry={e} kind="steer" actions={outbox} hostId={hostId} />
          ))}
        </div>
      )}
      {(ordered ? paused.steers.length > 0 : paused.count > 0) && (
        <div className={`${SECTION} transition-colors ${clearArmed ? "bg-danger/5" : ""}`} data-queue-section="" data-testid="paused-section">
          <div className={`${HEADING} ${clearArmed ? "text-danger" : "text-warn-text"}`}>
            <span className={`${glyphCell} text-[8px] leading-none`} aria-hidden>
              ❚❚
            </span>
            <span className="min-w-0 flex-1 truncate" title={clearArmed ? undefined : (pausedHint ?? t("paused.titleHint"))} data-testid={pausedHint && !clearArmed ? "paused-hint" : undefined}>
              {clearArmed ? t("paused.clearAgain", { n: paused.count }) : (pausedHint ?? t("paused.title"))}
            </span>
            {!clearArmed && (<>
            <button onClick={onResumePaused} title={t(stopHold ? "paused.resumeHintStop" : "paused.resumeHint")} className={btn({ size: "sm" })}>
              {t("paused.resume")}
            </button>
            <button onClick={onRestorePaused} title={t("paused.restoreHint")} className="rounded-md px-1.5 py-0.5 text-xs text-muted hover:text-foreground">
              {t("paused.restore")}
            </button>
            </>)}
            <button
              onClick={() => (clearArmed ? (setClearArmed(false), onClearPaused()) : setClearArmed(true))}
              title={t("paused.clearHint")}
              className={clearArmed ? ARMED_BUTTON : "rounded-md px-1.5 py-0.5 text-xs text-muted hover:text-danger"}
              data-testid="paused-clear"
            >
              {t("paused.clear")}
            </button>
          </div>
          {paused.steers.map((p) =>
            steerRow(
              p,
              <span className={`${ROW_META} ${META_YIELDS} text-warn-text`} title={t("steer.undeliveredHint")}>
                {t("steer.undelivered")}
              </span>,
              <button onClick={() => onDismissSteer(p.id)} title={t("steer.dismiss")} aria-label={t("steer.dismiss")} className={ICON_BUTTON_DANGER}>
                <X size={12} aria-hidden />
              </button>,
              "undelivered-steer",
            ),
          )}
          {!ordered && paused.items.map((item) => itemRow(item))}
        </div>
      )}
      {ordered && (
        <TurnQueue
          ordered={ordered}
          waiting={waiting}
          insertStatus={insertStatus}
          onRecheckSteer={onRecheckSteer}
          sendingSteers={sendingSteers}
          sendingQueue={sendingQueue}
          renderOutbox={(e, kind) => <OutboxRow key={e.id} entry={e} kind={kind} actions={outbox} hostId={hostId} />}
          onInterruptSendSteers={onInterruptSendSteers}
          heldIds={heldIds}
          paused={{ controls: paused.steers.length === 0, stopHold, onResume: onResumePaused, onRestore: onRestorePaused }}
          itemRow={itemRow}
          hostId={hostId}
          runtime={runtime}
          imageSteering={imageSteering}
          slots={{ target: targetSlot, actions: actionSlot }}
        />
      )}
      {(rest.length > 0 || (!ordered && sendingQueue.length > 0)) && (
        <div className={SECTION} data-queue-section="">
          {rest.map((item, i) => itemRow(item, running && i === 0 ? { note: t("queue.deliverAfterTurn") } : {}))}
          {sendingQueue.map((e) => (
            <OutboxRow key={e.id} entry={e} kind="queue" actions={outbox} hostId={hostId} />
          ))}
        </div>
      )}
      {receipts.length > 0 && <div className={SECTION} data-queue-section="" data-testid="queue-insert-receipts">
        {receipts.map((feedback) => <Fragment key={feedback.item.clientUserMessageId}>
          <div className={QUEUE_ROW} data-testid="queue-insert-receipt">
            <KindIcon icon={CornerDownRight} label={t("queue.sendNow")} />
            <span className={`${ROW_TEXT} text-muted`}>{rowText(mentionPlainText(queuedRowText(feedback.item)))}</span>
            {insertStatus(feedback.item.clientUserMessageId)}
          </div>
          {insertUnsure(feedback) && <QueueInsertUnsureHint feedback={feedback} />}
        </Fragment>)}
      </div>}
      {sections.map((section, i) =>
        filled(section) ? (
          // Inside the card: a hairline above, not a box in the box.
          <div key={i} className={SECTION} data-queue-section="" data-testid="queue-extra-section">
            {section.node}
          </div>
        ) : null,
      )}
      </div>)}
    </div>
    </RailStripContext.Provider>
  );
}

/** The conversation pane a queue header is in: the nearest ancestor's conversation header id. */
function queuePaneId(el: HTMLElement): string | null {
  for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
    const header = p.querySelector("[data-conv-header]");
    if (header) return header.getAttribute("data-conv-header");
  }
  return null;
}

/** Capability belongs to the conversation's host, independently of the focus host. */
export function QueuePanel(props: React.ComponentProps<typeof LegacyQueuePanel>) {
  const convHost = useConvHost();
  const host = props.hostId ?? convHost;
  const ledger = useApp(s => usesInputLedger([...featuresOf(s, host)]));
  return ledger ? <LedgerQueuePanel key={`${host}\n${props.sessionId ?? props.ordered?.sessionId}`} {...props} hostId={host} /> : <LegacyQueuePanel {...props} />;
}

function LedgerQueuePanel(props: React.ComponentProps<typeof LegacyQueuePanel>) {
  const { t } = useI18n();
  const sessionId = props.sessionId ?? props.ordered?.sessionId ?? "";
  const hostId = props.hostId ?? "local";
  const ledger = useApp(s => agentState(s.inputs, hostId, sessionId));
  const localOutbox = useApp(s => agentState(s.ledgerOutbox, hostId, sessionId));
  const preResponse = useMemo(() => (localOutbox ?? []).filter(entry => !ledger?.records.has(entry.inputId) && predictedOwnerSurface(entry, ledger?.delivery) === "nextUp"), [localOutbox, ledger]);
  const now = useNow(true);
  const rows = useMemo(() => ledgerQueue(ledger, now), [ledger, now]);
  const uncertain = useMemo(() => clearableUncertain(ledger), [ledger]);
  const mergePlan = useMemo(() => {
    const byId = new Map(props.items.map(item => [item.clientUserMessageId, item]));
    const eligible = rows.nextUp.flatMap(record => {
      const item = byId.get(record.inputId);
      return record.kind === "owner" && record.state === "waiting" && record.reason === "explicitQueue"
        && record.actions?.includes("sendNow") && record.actions.includes("cancel") && item?.state === "queued" ? [item] : [];
    });
    return planQueueMerge(eligible.slice(0, 20));
  }, [rows.nextUp, props.items]);
  const [merging, setMerging] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [collapsed, setCollapsed] = useState(() => !!queueViewOf(sessionId).collapsed);
  const [overlay, setOverlay] = useState(false);
  const shortPane = useShortPaneFold();
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!overlay) return;
    const doc = frame.current?.ownerDocument;
    const outside = (event: MouseEvent) => { if (isNode(event.target) && !frame.current?.contains(event.target)) setOverlay(false); };
    doc?.addEventListener("pointerdown", outside);
    return () => doc?.removeEventListener("pointerdown", outside);
  }, [overlay]);
  const uncertainIdentity = uncertain.map(record => `${record.inputId}:${record.rev}`).join("\n");
  useEffect(() => { setArmed(false); }, [uncertainIdentity]);
  const clean = async () => {
    if (!armed) { setArmed(true); return; }
    setClearing(true);
    const results: PromiseSettledResult<unknown>[] = [];
    // Large backlogs must not turn one cleanup gesture into hundreds of concurrent RPCs.
    for (let i = 0; i < uncertain.length; i += 4) results.push(...await Promise.allSettled(uncertain.slice(i, i + 4).map(r => useApp.getState().dismissInput(sessionId, r.inputId, hostId))));
    const failures = results.filter(r => r.status === "rejected");
    if (failures.length) useApp.getState().notify(t("inputLedger.cleanupFailed", { n: failures.length }), "error", { hostId, sessionId });
    setClearing(false); setArmed(false);
  };
  const sections = props.sections?.filter(filled) ?? [];
  const count = rows.nextUp.length + rows.notes.length + preResponse.length;
  const showDelivery = showStandaloneDelivery(ledger?.delivery) && (ledger?.delivery?.state === "held" || !!ledger?.delivery?.lease);
  if (!count && !uncertain.length && !showDelivery && !sections.length) return null;
  const folded = collapsed || shortPane.fold;
  return <div ref={frame} className="relative flex min-h-0 flex-col rounded-t-inner border border-b-0 border-border bg-surface px-1 pt-0.5 pb-1" data-queue-tray="" data-testid="queue-tray" data-collapsed={folded || undefined} data-short-fold={shortPane.fold || undefined} onKeyDown={e => { if (e.key === "Escape") { setOverlay(false); setArmed(false); } }} onBlur={e => { if (isNode(e.relatedTarget) && !e.currentTarget.contains(e.relatedTarget)) setOverlay(false); }}>
    <div className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 text-meta text-subtle" data-testid="queue-header">
      <span className="font-semibold text-foreground">{t("queue.header.title")}</span>
      {count > 0 && <CountBadge tone="neutral" count={count} data-testid="queue-count" />}
      <span className="flex-1" />
      {mergePlan && props.onMergeInsert && props.onSendNow && <button type="button" disabled={merging} className="h-5 rounded px-1 text-caption hover:bg-surface-2 disabled:opacity-50" data-testid="queue-merge-insert" title={t("queue.merge.hint", { n: mergePlan.items.length })} onClick={() => {
        setMerging(true);
        void props.onMergeInsert!(mergePlan.items).catch(error => useApp.getState().notify(queueActionNotice(error, t), "error", { hostId, sessionId })).finally(() => setMerging(false));
      }}>{t("queue.merge.action")}</button>}
      {uncertain.length > 0 && <button type="button" disabled={clearing} onBlur={() => setArmed(false)} onClick={() => void clean()} className={`h-5 rounded px-1 text-caption ${armed ? "bg-danger/10 text-danger-text" : "hover:bg-surface-2"}`} data-testid="input-cleanup-all" title={t("inputLedger.cleanupHint")}>{t(armed ? "inputLedger.cleanupAgain" : "inputLedger.cleanup", { n: uncertain.length })}</button>}
      <button type="button" className="h-5 rounded px-1 hover:bg-surface-2" aria-label={t(folded ? "queue.header.expand" : "queue.header.collapse")} aria-expanded={!folded || overlay} data-testid="queue-collapse" onClick={() => { if (shortPane.fold) setOverlay(!overlay); else { setCollapsed(!collapsed); setQueueView(sessionId, { collapsed: !collapsed }); } }}>{folded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
    </div>
    {(!collapsed || shortPane.fold) && <div className={`flex min-h-0 flex-col overflow-y-auto overscroll-contain ${SECTION_RULES} ${shortPane.fold ? `absolute bottom-full left-[-1px] right-[-1px] z-20 max-h-[var(--short-pane-overlay-max,240px)] rounded-t-inner border border-border bg-surface p-1 shadow-lg ${overlay ? "" : "pointer-events-none invisible"}` : ""}`} {...(shortPane.fold ? { role: "dialog", "aria-label": t("queue.header.title"), "aria-hidden": !overlay || undefined } : {})} data-queue-body="" data-testid={shortPane.fold ? "queue-overlay" : undefined}>
      {showDelivery && ledger?.delivery && <div className={HEADING}><DeliveryStatus delivery={ledger.delivery} sessionId={sessionId} hostId={hostId} /></div>}
      <LedgerTurnQueue records={rows.nextUp} items={props.items} sessionId={sessionId} hostId={hostId} canEdit={props.canEdit} onSendNow={props.onSendNow} sendNowStartsTurn={props.sendNowStartsTurn} onEdit={props.onEdit} onDelete={props.onDelete} />
      {preResponse.map(entry => <LedgerOutboxRow key={entry.inputId} entry={entry} sessionId={sessionId} hostId={hostId} />)}
      {rows.notes.length > 0 && <LedgerPendingMessagesSection records={rows.notes} sessionId={sessionId} hostId={hostId} />}
      {sections.map((section, i) => <div key={i} className={SECTION} data-queue-section="">{section.node}</div>)}
    </div>}
  </div>;
}

/** Only O0 predicts placement; the first ledger record replaces this row by id. */
function LedgerOutboxRow({ entry, sessionId, hostId }: { entry: LedgerOwnerOutbox; sessionId: string; hostId: string }) {
  const { t } = useI18n();
  return <div className={`${QUEUE_ROW} min-h-6 max-h-6 shrink-0 overflow-hidden`} data-testid="ledger-nextup-outbox" data-input-id={entry.inputId}>
    <KindIcon icon={UserRound} label={t("queue.delivery.owner")} />
    <span className={`${ROW_TEXT} text-muted`}>{rowText(mentionPlainText(entry.text))}</span>
    <QueuedImages images={messageImages(entry.extra)} hostId={hostId} />
    <span className="truncate text-caption text-subtle" title={entry.error}>{t(entry.phase === "sending" ? "inputLedger.record.sending" : entry.error === "input_not_found" ? "outbox.failed" : "inputLedger.unconfirmed")}</span>
    {entry.phase === "unconfirmed" && <>
      <button type="button" className="h-5 shrink-0 rounded px-1 text-caption hover:bg-surface-2" onClick={() => void useApp.getState().retryLedgerOutbox(sessionId, entry.inputId, hostId).catch(error => useApp.getState().notify(String(error), "error", { hostId, sessionId }))}>{t("inputLedger.retry")}</button>
      <button type="button" className="h-5 shrink-0 rounded px-1 text-caption hover:bg-surface-2" onClick={() => useApp.getState().discardLedgerOutbox(sessionId, entry.inputId, hostId)}>{t("inputLedger.dismiss")}</button>
    </>}
  </div>;
}
