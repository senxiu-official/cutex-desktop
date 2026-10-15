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
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, CornerDownRight, Pencil, Trash2, UserRound, X } from "lucide-react";
import type { QueueItem } from "@cutex-desktop/protocol";
import { RailStripContext, useStripInside } from "../lib/railStrip";
import { useI18n, type MessageKey } from "../i18n";
import { ARMED_BUTTON, useArmed } from "../lib/armedConfirm";
import { outboxStatusCopy, type OutboxEntry } from "../lib/outbox";
import type { PendingSteer } from "../lib/pendingSteers";
import type { PausedSection } from "../lib/queuePause";
import { queueViewOf, setQueueView } from "../lib/queueView";
import { autoCompact as startsCompact, mergeChips, openedThisRun, queueChips, setOpenedThisRun, turnCounts, type QueueChip } from "../lib/queueChips";
import { queueItemText } from "../store";
import { META_YIELDS, QUEUE_ROW, ROW_ACTIONS, ROW_META, ROW_TEXT, rowText } from "../lib/queueRow";
import { KindIcon } from "./AdmissionRows";
import { Rail, RailRow } from "./QueueRail";
import { TurnQueue, type OrderedQueue, type OwnerRowExtra } from "./TurnQueue";
import { useShownNextStep } from "../lib/settledRideAlongs";
import type { AdmissionNextStep } from "@cutex-desktop/protocol";

const NO_NEXT_STEP: AdmissionNextStep[] = [];

// Every group (waiting steers, paused, plain queue, extra sections) uses the same unboxed frame — a
// hairline between groups, no box in the card — so a row keeps its position when stopping moves it
// from one group to another.
const SECTION = "flex flex-col gap-0.5 py-0.5";
/** On the tray: every group after the first (`data-queue-section`) gets a hairline above it. */
const SECTION_RULES = "[&>[data-queue-section]~[data-queue-section]]:border-t [&>[data-queue-section]~[data-queue-section]]:border-border/60";
/** A group's heading: a small muted label (not a box), its actions at the end. */
const HEADING = "flex h-6 min-w-0 items-center gap-1.5 pr-1 pl-0.5 text-[11px] text-subtle";
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
function OutboxRow({ entry, kind, actions }: { entry: OutboxEntry; kind: "steer" | "queue"; actions: OutboxActions }) {
  const { t } = useI18n();
  const failed = entry.state === "failed";
  const status = outboxStatusCopy(entry);
  return (
    <div className={`${QUEUE_ROW} ${failed ? "bg-danger/5" : ""}`} data-testid={failed ? "outbox-failed" : "outbox-sending"}>
      <KindIcon icon={kind === "steer" ? CornerDownRight : UserRound} label={t(kind === "steer" ? "queue.turn.inserting" : "queue.delivery.owner")} />
      <span className={`${ROW_TEXT} ${failed ? "text-foreground" : "text-muted"}`}>{rowText(entry.text)}</span>
      {entry.imageCount > 0 && <span className="shrink-0 text-[11px] text-subtle">{t("steer.images", { n: entry.imageCount })}</span>}
      {failed ? (
        <>
          <span className="max-w-[40%] shrink truncate text-[11px] text-danger" title={entry.error}>
            {t("outbox.failed")}
            {entry.error ? ` · ${entry.error}` : ""}
          </span>
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

export function QueuePanel({
  steers,
  sendingSteers = [],
  sendingQueue = [],
  outbox,
  onInterruptSendSteers,
  onDismissSteer,
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
  autoCompact,
}: {
  steers: PendingSteer[];
  /** Optimistic sends shown in the steers section / after the queue (lib/outbox). */
  sendingSteers?: OutboxEntry[];
  sendingQueue?: OutboxEntry[];
  outbox: OutboxActions;
  onInterruptSendSteers(): void;
  onDismissSteer(id: string): void;
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
  /** Start compact by the rule of lib/queueChips; `short` = the window is short. Omitted = never by itself. */
  autoCompact?: { short: boolean };
}) {
  const { t } = useI18n();
  // Ride-alongs still settling (lib/settledRideAlongs) are left out of everything at once — rows,
  // count, chips and whether the card shows — so the card never flashes empty.
  const nextStep = useShownNextStep(orderedIn?.nextStep ?? NO_NEXT_STEP, orderedIn?.running ?? false, orderedIn);
  const ordered = orderedIn && nextStep !== orderedIn.nextStep ? { ...orderedIn, nextStep } : orderedIn;
  const tray = useRef<HTMLDivElement>(null);
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
  const setCollapsed = (v: boolean) => {
    setQueueView(agent, { collapsed: v });
    setOpenedThisRun(agent, !v);
    setCollapsedFor({ id: agent, v });
  };
  if (rest.length === 0 && orderedCount === 0 && waiting.length === 0 && paused.count === 0 && sendingSteers.length === 0 && sendingQueue.length === 0 && !sections.some(filled)) return null;
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
  const compact = !!autoCompact && !!agent && !failedSend && !openedThisRun(agent) && startsCompact(chips, count + extras.length, autoCompact.short);
  const collapsed = userCollapsed || compact;
  // 继续 in the header when the paused section (which has its own) is not shown, nor the stop's
  // 委托已随停止暂停 section (a stop hold: it carries 继续发送 for everything the stop held).
  const headerResume = !!ordered && paused.count > 0 && paused.steers.length === 0 && !stopHold;
  // Keyed by clientUserMessageId: an optimistic row and the cutex item that replaces it share the key.
  const itemRow = (item: QueueItem, extra: OwnerRowExtra = {}) => (
    <div
      key={item.clientUserMessageId || item.queueId}
      {...extra.rowProps}
      className={`${QUEUE_ROW} hover:bg-surface-2/60 ${extra.rowProps ? "focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none" : ""}`}
      data-testid="queue-item"
    >
      {extra.grip}
      <KindIcon icon={UserRound} label={t("queue.delivery.owner")} />
      <span className={`${ROW_TEXT} text-foreground`}>{rowText(queueItemText(item))}</span>
      {extra.paused ? (
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
      <span className={ROW_ACTIONS} data-testid="queue-item-actions">
        {onSendNow && (
          <button
            onClick={() => onSendNow(item)}
            title={t(sendNowStartsTurn ? "queue.sendNowIdleHint" : "queue.sendNowHint")}
            className="rounded-md bg-surface-2 px-2 py-0.5 text-xs hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            data-testid="queue-send-now"
          >
            {t(sendNowStartsTurn ? "queue.sendNowIdle" : "queue.sendNow")}
          </button>
        )}
        <button
          onClick={() => onEdit(item)}
          disabled={!canEdit}
          title={canEdit ? t("queue.edit") : t("queue.editDraftConflict")}
          aria-label={canEdit ? t("queue.edit") : t("queue.editDraftConflict")}
          className={ICON_BUTTON}
        >
          <Pencil size={12} aria-hidden />
        </button>
        <button onClick={() => onDelete(item)} title={t("queue.delete")} aria-label={t("queue.delete")} className={ICON_BUTTON_DANGER} data-testid="queue-delete">
          <Trash2 size={12} aria-hidden />
        </button>
      </span>
    </div>
  );
  // A steer the native has not read yet: the same anatomy, its delivery as meta. With the turn frame
  // (rail column) these rows sit on its grid: an empty rail cell first, the heading glyph in that column.
  const glyphCell = `flex ${ordered ? "-ml-0.5 w-[22px]" : "w-4"} shrink-0 items-center justify-center self-stretch`;
  const steerRow = (p: PendingSteer, meta: React.ReactNode, action?: React.ReactNode, testId?: string) => {
    const row = (
      <div key={p.id} className={QUEUE_ROW} data-testid={ordered ? undefined : testId}>
        <KindIcon icon={CornerDownRight} label={t("queue.turn.inserting")} />
        <span className={`${ROW_TEXT} text-muted`}>{rowText(p.text)}</span>
        {p.imageCount > 0 && <span className="shrink-0 text-[11px] text-subtle">{t("steer.images", { n: p.imageCount })}</span>}
        {meta}
        {action && <span className={ROW_ACTIONS}>{action}</span>}
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
    <div ref={tray} className={`-mb-3 flex flex-col rounded-t-2xl border border-b-0 border-border bg-surface px-2 pt-1 pb-4 ${SECTION_RULES}`} data-testid="queue-tray" data-collapsed={collapsed || undefined}>
      <div className="flex h-6 min-w-0 items-center gap-1.5 pr-0.5 pl-1.5 text-[11px] text-subtle" data-testid="queue-header" data-compact={compact || undefined}>
        {collapsed && chips.length > 1 ? (
          // Collapsed with several kinds: 「接下来 · 排队 2 · 留言 1 · 委托 3」, the whole label expands.
          <button
            onClick={() => setCollapsed(false)}
            title={t("queue.header.expand")}
            className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md px-1 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
            data-testid="queue-chips"
          >
            <span className="shrink-0 font-medium text-muted">{t("queue.header.title")}</span>
            {chips.map((chip) => (
              <span key={chip.kind} className="flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="text-subtle">·</span>
                <ChipText chip={chip} />
              </span>
            ))}
          </button>
        ) : (
          <>
            <span className="font-medium text-muted" title={t("queue.header.titleHint")}>
              {t("queue.header.title")}
            </span>
            {count > 0 && (
              <span className="rounded-full bg-surface-2 px-1.5 text-[10px] leading-4 text-muted tabular-nums" data-testid="queue-count">
                {count}
              </span>
            )}
            {collapsed && chips.length === 1 && chips[0]!.warn && <ChipText chip={chips[0]!} />}
            <span className="flex-1" />
          </>
        )}
        {!collapsed && ordered?.actions}
        {headerResume && (
          <button onClick={onResumePaused} title={t(stopHold ? "paused.resumeHintStop" : "paused.resumeHint")} className="rounded-md px-1.5 py-0.5 text-xs text-warn hover:bg-warn/10 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none" data-testid="queue-header-resume">
            {t("paused.resume")}
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "queue.header.expand" : "queue.header.collapse")}
          title={t(collapsed ? "queue.header.expand" : "queue.header.collapse")}
          className="rounded-md p-0.5 text-subtle hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          data-testid="queue-collapse"
        >
          {collapsed ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={14} aria-hidden />}
        </button>
      </div>
      {!collapsed && (<>
      {!ordered && (waiting.length > 0 || sendingSteers.length > 0) && (
        <div className={SECTION} data-queue-section="" data-testid="pending-steers">
          <div className={HEADING}>
            <span className={glyphCell} aria-hidden>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            </span>
            <span className="min-w-0 flex-1 truncate" title={t("steer.pendingHint")}>
              {t("steer.pending")}
            </span>
            {waiting.length > 0 && (
              <button onClick={onInterruptSendSteers} title={t("steer.interruptSendHint")} className="rounded-md px-1.5 py-0.5 text-xs text-danger hover:bg-danger/10">
                {t("steer.interruptSend")}
              </button>
            )}
          </div>
          {waiting.map((p) =>
            steerRow(
              p,
              <span className={`${ROW_META} text-subtle`} title={t("queue.deliverNextStep")} data-testid="steer-delivery-note">
                {t("queue.meta.nextStep")}
              </span>,
            ),
          )}
          {sendingSteers.map((e) => (
            <OutboxRow key={e.id} entry={e} kind="steer" actions={outbox} />
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
            <button onClick={onResumePaused} title={t(stopHold ? "paused.resumeHintStop" : "paused.resumeHint")} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:text-accent">
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
          sendingSteers={sendingSteers}
          sendingQueue={sendingQueue}
          renderOutbox={(e, kind) => <OutboxRow key={e.id} entry={e} kind={kind} actions={outbox} />}
          onInterruptSendSteers={onInterruptSendSteers}
          heldIds={heldIds}
          paused={{ controls: paused.steers.length === 0, stopHold, onResume: onResumePaused, onRestore: onRestorePaused }}
          itemRow={itemRow}
        />
      )}
      {(rest.length > 0 || (!ordered && sendingQueue.length > 0)) && (
        <div className={SECTION} data-queue-section="">
          {rest.map((item, i) => itemRow(item, running && i === 0 ? { note: t("queue.deliverAfterTurn") } : {}))}
          {sendingQueue.map((e) => (
            <OutboxRow key={e.id} entry={e} kind="queue" actions={outbox} />
          ))}
        </div>
      )}
      {sections.map((section, i) =>
        filled(section) ? (
          // Inside the card: a hairline above, not a box in the box.
          <div key={i} className={SECTION} data-queue-section="" data-testid="queue-extra-section">
            {section.node}
          </div>
        ) : null,
      )}
      </>)}
    </div>
    </RailStripContext.Provider>
  );
}
